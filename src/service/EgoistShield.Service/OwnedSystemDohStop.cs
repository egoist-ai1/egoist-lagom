using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

// Fixed SystemDoH callers supply the native exact-path boundary. This is not a
// generic process control API; the dispatcher mutation slot owns the entire stop.
internal static class OwnedSystemDohStop
{
    internal static async Task<OwnedServiceStatus> StopAsync(
        Func<CancellationToken, Task<OwnedServiceStatus>> readStatus,
        Func<CancellationToken, Task> gracefulStop,
        Func<CancellationToken, Task> assertGeneration,
        Func<CancellationToken, Task> cleanupRuntime,
        Func<CancellationToken, Task> stopPendingWrapper,
        CancellationToken cancellationToken, TimeSpan? runtimeGrace = null, TimeSpan? finalGrace = null)
    {
        cancellationToken.ThrowIfCancellationRequested();
        try { await gracefulStop(cancellationToken); }
        catch (TimeoutException) { cancellationToken.ThrowIfCancellationRequested(); }
        await assertGeneration(cancellationToken);
        var status = await readStatus(cancellationToken);
        if (status.Installed && status.State is not ("stopped" or "stop_pending"))
            throw new IOException("System DoH did not accept the stop control; process termination is refused.");
        // A stopped wrapper is insufficient: an orphan can still own DNS port 53.
        await cleanupRuntime(cancellationToken);
        if (status.Installed && status.State == "stop_pending")
        {
            status = await WaitStoppedAsync(readStatus, runtimeGrace ?? TimeSpan.FromSeconds(3), cancellationToken);
            if (status.Installed && status.State != "stopped")
            {
                if (status.State != "stop_pending") throw new IOException("System DoH changed state after runtime cleanup.");
                await assertGeneration(cancellationToken);
                await stopPendingWrapper(cancellationToken);
                status = await WaitStoppedAsync(readStatus, finalGrace ?? TimeSpan.FromSeconds(10), cancellationToken);
                if (status.Installed && status.State != "stopped") throw new TimeoutException("System DoH wrapper did not stop after exact owned process termination.");
            }
            await assertGeneration(cancellationToken);
            await cleanupRuntime(cancellationToken);
        }
        await assertGeneration(cancellationToken);
        status = await readStatus(cancellationToken);
        if (status.Installed && status.State != "stopped") throw new IOException("System DoH restarted during stop; no stopped result is published.");
        return status;
    }

    private static async Task<OwnedServiceStatus> WaitStoppedAsync(Func<CancellationToken, Task<OwnedServiceStatus>> read,
        TimeSpan duration, CancellationToken token)
    {
        var clock = Stopwatch.StartNew();
        while (true)
        {
            token.ThrowIfCancellationRequested();
            var status = await read(token);
            if (!status.Installed || status.State == "stopped" || status.State != "stop_pending" || clock.Elapsed >= duration) return status;
            var remaining = duration - clock.Elapsed;
            if (remaining > TimeSpan.Zero) await Task.Delay(remaining < TimeSpan.FromMilliseconds(100) ? remaining : TimeSpan.FromMilliseconds(100), token);
        }
    }

    // Hold existing state/config handles without write/delete sharing while a
    // fallback is pending. Missing files are rechecked rather than assumed stable.
    internal sealed class Generation : IDisposable
    {
        private readonly string _root;
        private readonly (string Path, FileStream? Held, string? Hash)[] _files;
        internal Generation(string componentRoot, string productRoot)
        {
            _root = Path.GetFullPath(productRoot);
            var state = Path.Combine(componentRoot, "state.json"); var config = Path.Combine(componentRoot, "config.json");
            _files = new (string, FileStream?, string?)[2];
            try
            {
                int index = 0;
                foreach (string path in new[] { state, config })
                {
                    TrustedPath.AssertPathUnderRoot(path, _root, false);
                    FileStream? held = null;
                    try { held = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read); }
                    catch (FileNotFoundException) { }
                    catch (DirectoryNotFoundException) { }
                    _files[index] = (path, held, null);
                    _files[index++] = (path, held, held == null ? null : Digest(held));
                }
            }
            catch { Dispose(); throw; }
        }
        internal Task AssertAsync(CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            foreach (var item in _files)
            {
                TrustedPath.AssertPathUnderRoot(item.Path, _root, false);
                if (item.Held == null)
                { if (File.Exists(item.Path)) throw new IOException("System DoH state/config generation changed during stop."); }
                else if (!File.Exists(item.Path) || Digest(item.Held) != item.Hash)
                    throw new IOException("System DoH state/config generation changed during stop.");
            }
            token.ThrowIfCancellationRequested(); return Task.CompletedTask;
        }
        private static string Digest(FileStream stream)
        {
            if (stream.Length > 65536) throw new InvalidDataException("System DoH state/config exceeds its stop guard bound.");
            stream.Position = 0; return Convert.ToHexString(SHA256.HashData(stream));
        }
        public void Dispose() { foreach (var item in _files) item.Held?.Dispose(); }
    }
}


