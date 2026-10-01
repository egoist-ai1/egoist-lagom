using System;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal static class WinwsProcessSnapshotCommand
{
    internal static async Task<int> RunAsync()
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        ListenerProcess[]? processes = null;
        try
        {
            processes = await Task.Run(() => WindowsServiceListenerSnapshot.ReadWinwsProcesses(deadline.Token), CancellationToken.None)
                .WaitAsync(deadline.Token);
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or System.IO.IOException or
            ArgumentException or OverflowException or OperationCanceledException or DllNotFoundException or EntryPointNotFoundException)
        { }
        Console.WriteLine(SerializeSnapshot(processes));
        return 0;
    }

    internal static string SerializeSnapshot(ListenerProcess[]? processes)
    {
        string output = JsonSerializer.Serialize(new
        {
            schemaVersion = 1, operation = "winws-process-snapshot", processName = "winws.exe",
            snapshotAvailable = processes != null,
            identityComplete = processes != null && processes.All(row => row.CreatedAt != null && !string.IsNullOrWhiteSpace(row.ExecutablePath)),
            processes = processes ?? Array.Empty<ListenerProcess>()
        }, JsonDefaults.Options);
        return Encoding.UTF8.GetByteCount(output) <= 60 * 1024 ? output : SerializeSnapshot(null);
    }
}
