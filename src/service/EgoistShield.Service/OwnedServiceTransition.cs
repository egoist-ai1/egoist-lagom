using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal static class OwnedServiceTransition
{
    internal static async Task<OwnedServiceStatus> ChangeAsync(string serviceName, bool running,
        Func<CancellationToken, Task<OwnedServiceStatus>> readStatus,
        Func<string, CancellationToken, Task<ProcessResult>> sendControl,
        TimeSpan timeout, CancellationToken cancellationToken, TimeSpan? pollInterval = null)
    {
        var elapsed = Stopwatch.StartNew();
        using var deadline = new CancellationTokenSource(timeout);
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, deadline.Token);
        var token = lifetime.Token;
        string expected = running ? "running" : "stopped";
        string? acceptedState = null;
        try
        {
            while (elapsed.Elapsed < timeout)
            {
                token.ThrowIfCancellationRequested();
                var current = await readStatus(token).WaitAsync(token);
                if (!current.Installed)
                {
                    if (!running) return current;
                    throw new InvalidOperationException("Owned service " + serviceName + " is not installed.");
                }
                if (current.State == expected) return current;
    
                string? control = current.State switch
                {
                    "stopped" when running => "start",
                    "paused" when running => "continue",
                    "running" or "paused" when !running => "stop",
                    // Pending transitions belong to SCM. Sending a second control here
                    // produces ERROR_SERVICE_CANNOT_ACCEPT_CTRL and a false failure.
                    "start_pending" or "stop_pending" or "continue_pending" or "pause_pending" => null,
                    _ => throw new InvalidOperationException("Unsupported state " + current.State + " for " + serviceName + ".")
                };
                if (acceptedState != current.State) acceptedState = null;
                if (control != null && acceptedState == null)
                {
                    var result = await sendControl(control, token).WaitAsync(token);
                    // SCM can change state between observation and the control call.
                    // These race results require readback, never an assumed success.
                    bool stateChanged = result.ExitCode is 1056 or 1061 or 1062;
                    if (result.ExitCode != 0 && !stateChanged)
                        throw new InvalidOperationException("SC " + control + " failed for " + serviceName + ": " +
                            (string.IsNullOrWhiteSpace(result.StandardError) ? result.StandardOutput : result.StandardError).ReplaceLineEndings(" ").Trim());
                    if (result.ExitCode == 0) acceptedState = current.State;
                }
                var remaining = timeout - elapsed.Elapsed;
                if (remaining <= TimeSpan.Zero) break;
                var delay = pollInterval ?? TimeSpan.FromMilliseconds(250);
                await Task.Delay(delay < remaining ? delay : remaining, token);
            }
        }
        catch (OperationCanceledException) when (deadline.IsCancellationRequested && !cancellationToken.IsCancellationRequested) { }
        throw new TimeoutException($"Service {serviceName} did not reach {expected} within {timeout.TotalSeconds:0} seconds.");
    }
}
