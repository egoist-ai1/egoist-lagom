using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal enum TcpListenerOwnership { Owned, Missing, Foreign, Unknown }
internal sealed record ListenerProcess(int ProcessId, int ParentProcessId, DateTimeOffset? CreatedAt, string? ExecutablePath);
internal sealed record ListenerEndpoint(string LocalAddress, int LocalPort, int OwningProcess);
internal sealed record ServiceListenerSnapshot(int ServiceProcessId, string ServiceState, ListenerProcess[] Processes,
    ListenerEndpoint[] Listeners, bool Stable);

internal static class OwnedTcpListenerProbe
{
    internal static async Task<LocalServiceHealth> ProbeAsync(string serviceName, string expectedExecutable,
        IPAddress address, int port, TimeSpan timeout,
        Func<string, CancellationToken, Task<ProcessResult>> readSnapshot,
        CancellationToken cancellationToken)
    {
        string script = CreateSnapshotScript(serviceName, port);
        return await ProbeSnapshotAsync(expectedExecutable, address, port, timeout, async token =>
        {
            var result = await readSnapshot(script, token);
            return result.ExitCode == 0 ? JsonSerializer.Deserialize<ServiceListenerSnapshot>(result.StandardOutput, JsonDefaults.Options) : null;
        }, cancellationToken);
    }

    internal static async Task<LocalServiceHealth> ProbeSnapshotAsync(string expectedExecutable,
        IPAddress address, int port, TimeSpan timeout,
        Func<CancellationToken, Task<ServiceListenerSnapshot?>> readSnapshot,
        CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(timeout);
        try
        {
            async Task<ServiceListenerSnapshot?> Read()
            {
                return await readSnapshot(deadline.Token).WaitAsync(deadline.Token);
            }
            var before = await Read();
            var ownership = Classify(before, address, port, expectedExecutable);
            if (ownership != TcpListenerOwnership.Owned) return Health(ownership);
            if (await LocalServiceHealthProbe.TcpAsync(address, port, timeout, deadline.Token) != LocalServiceHealth.Responsive)
                return LocalServiceHealth.Unresponsive;
            // A foreign process can take the endpoint after the first snapshot.
            // Do not turn its successful accept into an owned healthy service.
            var after = await Read();
            ownership = Classify(after, address, port, expectedExecutable);
            if (ownership != TcpListenerOwnership.Owned) return Health(ownership);
            if (before!.ServiceProcessId != after!.ServiceProcessId ||
                before.Processes.Single(x => x.ProcessId == before.ServiceProcessId).CreatedAt !=
                after.Processes.Single(x => x.ProcessId == after.ServiceProcessId).CreatedAt)
                return LocalServiceHealth.Unknown;
            return LocalServiceHealth.Responsive;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception error) when (error is JsonException or IOException or TimeoutException or
            OperationCanceledException or ArgumentException or InvalidOperationException)
        { return LocalServiceHealth.Unknown; }
    }

    private static LocalServiceHealth Health(TcpListenerOwnership ownership) => ownership switch
    {
        TcpListenerOwnership.Missing => LocalServiceHealth.Unresponsive,
        TcpListenerOwnership.Foreign => LocalServiceHealth.Conflict,
        _ => LocalServiceHealth.Unknown
    };

    internal static TcpListenerOwnership Classify(ServiceListenerSnapshot? snapshot, IPAddress address, int port, string expectedExecutable)
    {
        if (snapshot == null || !snapshot.Stable || snapshot.Listeners == null || snapshot.Processes == null ||
            snapshot.Listeners.Length > 128 || snapshot.Processes.Length > 128 ||
            snapshot.Listeners.Any(x => x == null || x.LocalPort < 1 || x.LocalPort > 65535 || x.OwningProcess <= 0 || !IPAddress.TryParse(x.LocalAddress, out _)) ||
            snapshot.Processes.Any(x => x == null || x.ProcessId <= 0) ||
            snapshot.Processes.Select(x => x.ProcessId).Distinct().Count() != snapshot.Processes.Length)
            return TcpListenerOwnership.Unknown;
        var matching = snapshot.Listeners.Where(x => x != null && x.LocalPort == port && MatchesAddress(x.LocalAddress, address)).ToArray();
        if (snapshot.ServiceState == "Stopped" && snapshot.ServiceProcessId == 0)
            return matching.Length > 0 ? TcpListenerOwnership.Foreign : TcpListenerOwnership.Missing;
        if (snapshot.ServiceState != "Running" || snapshot.ServiceProcessId <= 0) return TcpListenerOwnership.Unknown;
        var processes = snapshot.Processes.ToDictionary(x => x.ProcessId);
        if (!processes.TryGetValue(snapshot.ServiceProcessId, out var root) || root.CreatedAt == null ||
            string.IsNullOrWhiteSpace(root.ExecutablePath)) return TcpListenerOwnership.Unknown;
        try
        {
            if (!Path.GetFullPath(root.ExecutablePath).Equals(Path.GetFullPath(expectedExecutable), StringComparison.OrdinalIgnoreCase))
                return TcpListenerOwnership.Unknown;
        }
        catch (ArgumentException) { return TcpListenerOwnership.Unknown; }
        if (matching.Length == 0) return TcpListenerOwnership.Missing;
        bool unknown = false;
        foreach (var endpoint in matching)
        {
            var result = DescendsFrom(endpoint.OwningProcess, root, processes);
            if (result == TcpListenerOwnership.Foreign) return result;
            if (result != TcpListenerOwnership.Owned) unknown = true;
        }
        return unknown ? TcpListenerOwnership.Unknown : TcpListenerOwnership.Owned;
    }

    private static TcpListenerOwnership DescendsFrom(int owner, ListenerProcess root, Dictionary<int, ListenerProcess> processes)
    {
        var seen = new HashSet<int>();
        for (int depth = 0; depth < 32; depth++)
        {
            if (!seen.Add(owner) || !processes.TryGetValue(owner, out var process) || process.CreatedAt == null)
                return TcpListenerOwnership.Unknown;
            if (process.CreatedAt < root.CreatedAt) return TcpListenerOwnership.Foreign;
            if (owner == root.ProcessId) return TcpListenerOwnership.Owned;
            if (process.ParentProcessId == 0) return TcpListenerOwnership.Foreign;
            if (!processes.TryGetValue(process.ParentProcessId, out var parent) || parent.CreatedAt == null)
                return TcpListenerOwnership.Unknown;
            // ParentProcessId can refer to a new process that reused the PID.
            if (parent.CreatedAt > process.CreatedAt) return TcpListenerOwnership.Foreign;
            owner = parent.ProcessId;
        }
        return TcpListenerOwnership.Unknown;
    }

    internal static bool MatchesAddress(string candidate, IPAddress address) => IPAddress.TryParse(candidate, out var value) &&
        (value.Equals(address) || value.Equals(IPAddress.IPv6Any) ||
            address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && value.Equals(IPAddress.Any));

    internal static string CreateSnapshotScript(string serviceName, int port)
    {
        if (serviceName != "EgoistShieldTelegramProxy" || port < 1 || port > 65535)
            throw new ArgumentException("Listener snapshot requires the owned Telegram service and a valid port.");
        return $$"""
            $ErrorActionPreference = 'Stop'
            $serviceBefore = Get-CimInstance Win32_Service -Filter "Name='{{serviceName}}'" -ErrorAction Stop
            if (-not $serviceBefore) { throw 'Owned service metadata is unavailable.' }
            $all = @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, CreationDate, ExecutablePath)
            $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { [int]$_.LocalPort -eq {{port}} })
            if ($listeners.Count -gt 128) { throw 'Listener snapshot exceeds its bound.' }
            $byId = @{}
            foreach ($process in $all) { $byId[[int]$process.ProcessId] = $process }
            $needed = New-Object 'System.Collections.Generic.HashSet[int]'
            [void]$needed.Add([int]$serviceBefore.ProcessId)
            foreach ($listener in $listeners) {
              $cursor = [int]$listener.OwningProcess
              for ($depth = 0; $depth -lt 32 -and $cursor -gt 0; $depth++) {
                if (-not $needed.Add($cursor)) { break }
                $process = $byId[$cursor]
                if (-not $process) { break }
                $cursor = [int]$process.ParentProcessId
              }
            }
            if ($needed.Count -gt 128) { throw 'Listener ancestry exceeds its bound.' }
            $rows = @()
            foreach ($processId in $needed) {
              $process = $byId[$processId]
              if (-not $process) { continue }
              $created = $null
              if ($process.CreationDate) { $created = ([DateTimeOffset]$process.CreationDate).ToString('o') }
              $rows += [pscustomobject]@{ processId=[int]$process.ProcessId; parentProcessId=[int]$process.ParentProcessId; createdAt=$created; executablePath=[string]$process.ExecutablePath }
            }
            $serviceAfter = Get-CimInstance Win32_Service -Filter "Name='{{serviceName}}'" -ErrorAction Stop
            $stable = $serviceAfter -and [int]$serviceAfter.ProcessId -eq [int]$serviceBefore.ProcessId -and [string]$serviceAfter.State -eq [string]$serviceBefore.State
            [pscustomobject]@{
              serviceProcessId=[int]$serviceBefore.ProcessId
              serviceState=[string]$serviceBefore.State
              stable=[bool]$stable
              processes=@($rows)
              listeners=@($listeners | ForEach-Object { [pscustomobject]@{ localAddress=[string]$_.LocalAddress; localPort=[int]$_.LocalPort; owningProcess=[int]$_.OwningProcess } })
            } | ConvertTo-Json -Compress -Depth 6
            """;
    }
}
