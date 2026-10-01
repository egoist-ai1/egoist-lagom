using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal static class TelegramServiceRecoveryCommand
{
    internal static async Task<int> RunAsync()
    {
        const string serviceName = WindowsServiceRecoverySnapshot.TelegramServiceName;
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        try
        {
            var observation = await Task.Run(() =>
            {
                var value = WindowsServiceRecoverySnapshot.Read(serviceName, deadline.Token);
                if (value.Installed) WindowsServiceRecoverySnapshot.VerifyTelegramIdentity(value, deadline.Token);
                return value;
            }).WaitAsync(deadline.Token);
            object payload = observation.Installed ? new {
                schemaVersion = 1, operation = "telegram-service-recovery", serviceName,
                snapshotAvailable = true, stable = true, installed = true, identityVerified = true,
                startType = observation.StartType, delayedAutoStart = observation.DelayedAutoStart,
                resetPeriodSeconds = observation.ResetPeriodSeconds,
                actions = observation.Actions.Select(action => new { type = action.Type switch {
                    0 => "none", 1 => "restart", 2 => "reboot", 3 => "command", _ => "unknown" }, delayMs = action.DelayMs }),
                failureActionsOnNonCrashFailures = observation.FailureActionsOnNonCrashFailures
            } : new { schemaVersion = 1, operation = "telegram-service-recovery", serviceName,
                snapshotAvailable = true, stable = true, installed = false, identityVerified = false };
            Console.WriteLine(JsonSerializer.Serialize(payload));
            return 0;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or OperationCanceledException or
            ArgumentException or OverflowException or NotSupportedException or System.ComponentModel.Win32Exception)
        {
            var readError = error as ServiceRecoveryReadException;
            Console.WriteLine(JsonSerializer.Serialize(new {
                schemaVersion = 1, operation = "telegram-service-recovery", serviceName,
                snapshotAvailable = false, stable = false, installed = (bool?)null, identityVerified = false,
                error = new { kind = error.GetType().Name, stage = readError?.Stage ??
                    (error is OperationCanceledException ? "deadline" : "recovery-read"), win32 = readError?.NativeError }
            }));
            return 1;
        }
    }
}
