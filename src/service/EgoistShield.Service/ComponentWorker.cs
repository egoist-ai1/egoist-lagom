using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

// Only installed, administrator-owned code is executed. No executable path,
// script, environment or command line is accepted from an IPC caller.
internal sealed class ComponentWorker : IDisposable
{
    private sealed class WorkerRequests
    {
        // Registration and reader failure share a lock; each process owns its own state.
        private readonly Dictionary<string, TaskCompletionSource<JsonElement>> _pending = new();
        private Exception? _failure;

        internal bool Failed { get { lock (_pending) return _failure != null; } }

        public void Add(string id, TaskCompletionSource<JsonElement> completion)
        {
            lock (_pending)
            {
                if (_failure != null) throw new IOException("Component worker response stream stopped; verify component state before retrying.", _failure);
                _pending.Add(id, completion);
            }
        }

        public TaskCompletionSource<JsonElement>? Remove(string id)
        {
            lock (_pending) return _pending.Remove(id, out var completion) ? completion : null;
        }

        public void Fail(Exception error)
        {
            lock (_pending)
            {
                _failure ??= error;
                foreach (var completion in _pending.Values)
                    completion.TrySetException(new IOException("Component worker response stream stopped; verify component state before retrying.", _failure));
                _pending.Clear();
            }
        }
    }

    private readonly string _installRoot;
    private readonly Func<Process> _startWorker;
    private readonly TimeSpan? _responseTimeout;
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private WorkerRequests _requests = new();
    private Process? _process;
    private bool _disposed;

    public ComponentWorker(string installRoot)
    {
        _installRoot = Path.GetFullPath(installRoot);
        _startWorker = StartInstalledWorker;
    }

    internal ComponentWorker(Func<Process> startWorker, TimeSpan? responseTimeout = null)
    {
        _installRoot = string.Empty;
        _startWorker = startWorker;
        _responseTimeout = responseTimeout;
    }

    public async Task<JsonElement> ExecuteAsync(JsonElement payload, bool query, CancellationToken cancellationToken)
    {
        if (payload.ValueKind != JsonValueKind.Object) throw new ArgumentException("Component payload must be an object.");
        string component = payload.GetProperty("component").GetString() ?? "";
        string method = payload.GetProperty("method").GetString() ?? "";
        if (component is not ("SystemDoH" or "Zapret" or "TelegramProxy")) throw new ArgumentException("Unknown component.");
        if (query && method is not ("status" or "listProfiles" or "getUserLists" or "dryRunProfile" or "checkForUpdates" or "shouldCheckUpdates" or "tailLogs" or "cancelAutoSelect" or "autoSelectProgress" or "bootstrapServers"))
            throw new ArgumentException("A mutation cannot use the component query endpoint.");
        if (!payload.TryGetProperty("args", out JsonElement args) || args.ValueKind != JsonValueKind.Array || args.GetArrayLength() > 4)
            throw new ArgumentException("Invalid component arguments.");

        string id = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        WorkerRequests? requests = null;
        Process? worker = null;
        TimeSpan timeout = _responseTimeout ?? (query ? TimeSpan.FromMinutes(1) :
            method == "autoSelectBestProfile" ? TimeSpan.FromMinutes(20) :
            method is "installCoreUpdate" or "installCoreVersion" or "installDiscordRescueCore" or "installUpdate" ? TimeSpan.FromMinutes(10) : TimeSpan.FromMinutes(5));
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(timeout);
        try
        {
            await _writeLock.WaitAsync(deadline.Token);
            try
            {
                EnsureStarted();
                worker = _process!;
                requests = _requests;
                requests.Add(id, completion);
                string line = JsonSerializer.Serialize(new { id, component, method, args, query });
                await worker.StandardInput.WriteLineAsync(line.AsMemory(), deadline.Token);
                await worker.StandardInput.FlushAsync(deadline.Token);
            }
            finally { _writeLock.Release(); }
            // The same budget covers pipe writes and the reply; a blocked stdin
            // can no longer hold the Core mutation slot forever.
            return await completion.Task.WaitAsync(deadline.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested && deadline.IsCancellationRequested)
        {
            var error = new TimeoutException($"Component {component}.{method} exceeded {timeout.TotalSeconds:0} seconds; verify its actual state before retrying.");
            // Do not replay the mutation. Retire only this owned protocol worker;
            // Windows services launched by SCM retain their own lifetime.
            requests?.Remove(id);
            requests?.Fail(error);
            try { if (worker is { HasExited: false }) worker.Kill(entireProcessTree: true); } catch { }
            throw error;
        }
        catch (Exception error) when (error is IOException or ObjectDisposedException)
        {
            requests?.Remove(id);
            requests?.Fail(error);
            try { if (worker is { HasExited: false }) worker.Kill(entireProcessTree: true); } catch { }
            throw;
        }
        finally { requests?.Remove(id); }
    }

    private void EnsureStarted()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_process is { HasExited: false } && !_requests.Failed) return;
        try { if (_process is { HasExited: false }) _process.Kill(entireProcessTree: true); } catch { }
        _process?.Dispose();
        _process = _startWorker();
        Process worker = _process;
        var requests = new WorkerRequests();
        _requests = requests;
        _ = ReadResponsesAsync(worker, requests);
        // Drain stderr to avoid deadlock; worker output is diagnostic data,
        // never interpreted as commands or mixed with the JSON response stream.
        _ = DrainErrorsAsync(worker);
    }

    private Process StartInstalledWorker()
    {
        string executable = Path.Combine(_installRoot, "EgoistShield.exe");
        string script = Path.Combine(_installRoot, "resources", "component-worker.cjs");
        TrustedPath.AssertPathUnderRoot(executable, _installRoot, requireLeaf: true);
        TrustedPath.AssertPathUnderRoot(script, _installRoot, requireLeaf: true);
        var start = new ProcessStartInfo(executable)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
            WorkingDirectory = _installRoot,
        };
        start.ArgumentList.Add(script);
        foreach (string key in new[] { "NODE_OPTIONS", "NODE_PATH", "ELECTRON_ENABLE_LOGGING", "ELECTRON_ENABLE_STACK_DUMPING" }) start.Environment.Remove(key);
        start.Environment["ELECTRON_RUN_AS_NODE"] = "1";
        start.Environment["NODE_ENV"] = "production";
        return Process.Start(start) ?? throw new InvalidOperationException("Component worker did not start.");
    }

    private static async Task DrainErrorsAsync(Process worker)
    {
        var buffer = new char[4096];
        try { while (await worker.StandardError.ReadAsync(buffer) > 0) { } } catch { }
    }

    private static async Task ReadResponsesAsync(Process worker, WorkerRequests requests)
    {
        try
        {
            var buffer = new char[4096];
            var line = new StringBuilder();
            int count;
            while ((count = await worker.StandardOutput.ReadAsync(buffer)) > 0)
            {
                for (int offset = 0; offset < count; offset++)
                {
                    char value = buffer[offset];
                    if (value == '\n')
                    {
                        CompleteResponse(line.ToString(), requests);
                        line.Clear();
                    }
                    else
                    {
                        if (line.Length >= 4 * 1024 * 1024) throw new IOException("Worker response is too large.");
                        line.Append(value);
                    }
                }
            }
            if (line.Length > 0) throw new IOException("Worker response stream ended before a complete frame.");
        }
        catch (Exception error) { requests.Fail(error); }
        finally
        {
            requests.Fail(new IOException("Component worker stopped."));
            // A live process with a closed/broken protocol stream is unusable.
            // Kill only this owned worker tree so the next request can restart it.
            try { if (!worker.HasExited) worker.Kill(entireProcessTree: true); } catch { }
        }
    }

    private static void CompleteResponse(string line, WorkerRequests requests)
    {
        using JsonDocument json = JsonDocument.Parse(line);
        JsonElement response = json.RootElement;
        string id = response.GetProperty("id").GetString() ?? "";
        bool ok = response.GetProperty("ok").GetBoolean();
        JsonElement result = ok ? response.GetProperty("result").Clone() : default;
        string? error = ok ? null : response.GetProperty("error").GetString() ?? "Component operation failed.";
        var completion = requests.Remove(id);
        if (completion == null) return;
        if (ok) completion.TrySetResult(result);
        else completion.TrySetException(new InvalidOperationException(error));
    }

    public void Dispose()
    {
        _writeLock.Wait();
        try
        {
            if (_disposed) return;
            _disposed = true;
            _requests.Fail(new ObjectDisposedException(nameof(ComponentWorker)));
            var worker = _process;
            _process = null;
            if (worker == null) return;
            try { worker.StandardInput.Close(); } catch { }
            try
            {
                if (!worker.WaitForExit(5000))
                {
                    worker.Kill(entireProcessTree: true);
                    worker.WaitForExit(2000);
                }
            }
            catch { }
            finally { worker.Dispose(); }
        }
        finally { _writeLock.Release(); }
    }
}
