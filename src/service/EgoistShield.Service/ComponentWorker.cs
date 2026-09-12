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
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private WorkerRequests _requests = new();
    private Process? _process;
    private bool _disposed;

    public ComponentWorker(string installRoot)
    {
        _installRoot = Path.GetFullPath(installRoot);
        _startWorker = StartInstalledWorker;
    }

    internal ComponentWorker(Func<Process> startWorker)
    {
        _installRoot = string.Empty;
        _startWorker = startWorker;
    }

    public async Task<JsonElement> ExecuteAsync(JsonElement payload, bool query, CancellationToken cancellationToken)
    {
        if (payload.ValueKind != JsonValueKind.Object) throw new ArgumentException("Component payload must be an object.");
        string component = payload.GetProperty("component").GetString() ?? "";
        string method = payload.GetProperty("method").GetString() ?? "";
        if (component is not ("SystemDoH" or "Zapret" or "TelegramProxy")) throw new ArgumentException("Unknown component.");
        if (query && method is not ("status" or "listProfiles" or "getUserLists" or "dryRunProfile" or "checkForUpdates" or "shouldCheckUpdates" or "tailLogs" or "cancelAutoSelect" or "autoSelectProgress"))
            throw new ArgumentException("A mutation cannot use the component query endpoint.");
        if (!payload.TryGetProperty("args", out JsonElement args) || args.ValueKind != JsonValueKind.Array || args.GetArrayLength() > 4)
            throw new ArgumentException("Invalid component arguments.");

        string id = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        WorkerRequests? requests = null;
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            EnsureStarted();
            requests = _requests;
            requests.Add(id, completion);
            string line = JsonSerializer.Serialize(new { id, component, method, args, query });
            await _process!.StandardInput.WriteLineAsync(line.AsMemory(), cancellationToken);
            await _process.StandardInput.FlushAsync(cancellationToken);
        }
        catch
        {
            requests?.Remove(id);
            throw;
        }
        finally { _writeLock.Release(); }

        try
        {
            // A timed-out mutation is never automatically replayed.
            return await completion.Task.WaitAsync(TimeSpan.FromMinutes(20), cancellationToken);
        }
        finally { requests.Remove(id); }
    }

    private void EnsureStarted()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_process is { HasExited: false }) return;
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
            while (await worker.StandardOutput.ReadLineAsync() is string line)
            {
                if (line.Length > 4 * 1024 * 1024) throw new IOException("Worker response is too large.");
                using JsonDocument json = JsonDocument.Parse(line);
                JsonElement response = json.RootElement;
                string id = response.GetProperty("id").GetString() ?? "";
                bool ok = response.GetProperty("ok").GetBoolean();
                JsonElement result = ok ? response.GetProperty("result").Clone() : default;
                string? error = ok ? null : response.GetProperty("error").GetString() ?? "Component operation failed.";
                // Keep the completion registered until every response field is validated.
                var completion = requests.Remove(id);
                if (completion == null) continue;
                if (ok) completion.TrySetResult(result);
                else completion.TrySetException(new InvalidOperationException(error));
            }
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
