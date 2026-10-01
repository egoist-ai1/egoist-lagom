using System.Text.Json;

namespace EgoistShield.Service;

internal static class TelegramRuntimeCleanupCommand
{
    internal static async Task<int> RunAsync(string target)
    {
        string name = target switch
        {
            "primary" => "egoistshield-tg-ws-proxy.exe",
            "legacy" => "TgWsProxy_windows_7_64bit.exe",
            _ => throw new ArgumentException("Runtime cleanup accepts only primary or legacy.")
        };
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        string root = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        if (!Path.IsPathFullyQualified(root)) throw new IOException("Protected runtime root is unavailable.");
        string runtimePath = Path.Combine(root, "EgoistShield", "Runtime", "TelegramProxy", "runtime", name);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        try
        {
            var stopped = await Task.Run(() => WindowsServiceListenerSnapshot.StopProcessesUsingExecutable(runtimePath, deadline.Token))
                .WaitAsync(deadline.Token);
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = 1, operation = "telegram-runtime-cleanup", target, runtimePath,
                cleanupComplete = true, quiescent = true, stopped = stopped.Select(row => new {
                    processId = row.ProcessId, createdAt = row.CreatedAt, executablePath = row.ExecutablePath }) }));
            return 0;
        }
        catch (Exception error) when (error is IOException or InvalidDataException or System.ComponentModel.Win32Exception or OperationCanceledException or
            ArgumentException or OverflowException or NotSupportedException)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = 1, operation = "telegram-runtime-cleanup", target, runtimePath,
                cleanupComplete = false, quiescent = false, error = error.GetType().Name }));
            return 1;
        }
    }
}
