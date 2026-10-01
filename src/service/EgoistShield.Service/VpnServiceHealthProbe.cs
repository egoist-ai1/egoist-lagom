using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal static class VpnServiceHealthProbe
{
    private static readonly WindowsServiceListenerSnapshot Snapshot = new(ServiceContract.VpnServiceName);
    internal static Task<ServiceListenerSnapshot?> ReadSnapshotAsync(CancellationToken cancellationToken) => Snapshot.ReadAsync(ServiceContract.VpnProxyPort, cancellationToken);

    internal static async Task<LocalServiceHealth> ProbeAsync(string productRoot, OwnedServiceController services, CancellationToken cancellationToken)
    {
        try
        {
            using var config = VpnServiceConfiguration.Open(productRoot);
            string executable = services.ReadOwnedExecutablePath(ServiceContract.VpnServiceName, cancellationToken);
            return await ProbeAsync(executable, token => Snapshot.ReadAsync(ServiceContract.VpnProxyPort, token), cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException or System.Text.Json.JsonException)
        { return LocalServiceHealth.Unknown; }
    }

    internal static async Task<LocalServiceHealth> ProbeAsync(string executable,
        Func<CancellationToken, Task<ServiceListenerSnapshot?>> readSnapshot, CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(8));
        try
        {
            var before = await readSnapshot(deadline.Token).WaitAsync(deadline.Token);
            var ownership = OwnedTcpListenerProbe.Classify(before, IPAddress.Loopback, ServiceContract.VpnProxyPort, executable);
            if (ownership != TcpListenerOwnership.Owned) return Health(ownership);
            if (await SocksAsync(ServiceContract.VpnProxyPort, TimeSpan.FromSeconds(2), deadline.Token) != LocalServiceHealth.Responsive)
                return LocalServiceHealth.Unresponsive;
            var after = await readSnapshot(deadline.Token).WaitAsync(deadline.Token);
            ownership = OwnedTcpListenerProbe.Classify(after, IPAddress.Loopback, ServiceContract.VpnProxyPort, executable);
            if (ownership != TcpListenerOwnership.Owned) return Health(ownership);
            var previous = Array.Find(before!.Processes, value => value.ProcessId == before.ServiceProcessId);
            var current = Array.Find(after!.Processes, value => value.ProcessId == after.ServiceProcessId);
            if (before.ServiceProcessId != after.ServiceProcessId || previous?.CreatedAt != current?.CreatedAt)
                return LocalServiceHealth.Unknown;
            return LocalServiceHealth.Responsive;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception error) when (error is IOException or SocketException or TimeoutException or OperationCanceledException or ArgumentException or InvalidOperationException)
        { return LocalServiceHealth.Unknown; }
    }

    internal static async Task<LocalServiceHealth> SocksAsync(int port, TimeSpan timeout, CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(timeout);
        try
        {
            using var socket = new TcpClient(AddressFamily.InterNetwork);
            await socket.ConnectAsync(IPAddress.Loopback, port, deadline.Token);
            using var stream = socket.GetStream();
            await stream.WriteAsync(new byte[] { 5, 1, 0 }, deadline.Token);
            byte[] response = new byte[2];
            await stream.ReadExactlyAsync(response, deadline.Token);
            return response[0] == 5 && response[1] == 0 ? LocalServiceHealth.Responsive : LocalServiceHealth.Unresponsive;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception error) when (error is IOException or SocketException or OperationCanceledException)
        { return LocalServiceHealth.Unresponsive; }
    }

    private static LocalServiceHealth Health(TcpListenerOwnership ownership) => ownership switch
    { TcpListenerOwnership.Missing => LocalServiceHealth.Unresponsive, TcpListenerOwnership.Foreign => LocalServiceHealth.Conflict, _ => LocalServiceHealth.Unknown };
}
