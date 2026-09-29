using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

// Called only while the dispatcher owns the mutation slot. The supervisor never
// calls its own pipe or the Node worker, whose mutations can call Core in turn.
internal sealed class OwnedServiceSupervisor
{
    private sealed record Observation(int Failures = 0, TimeSpan? FailureSince = null,
        int Attempts = 0, TimeSpan NextAttempt = default, TimeSpan? HealthySince = null,
        TimeSpan? LastWarning = null, string Result = "waiting", bool IntendedRunning = false,
        bool RecoveryPolicyVerified = false, TimeSpan NextPolicyAttempt = default);

    private readonly OwnedServiceIntentStore _intents;
    private readonly Func<string, CancellationToken, Task<OwnedServiceStatus>> _status;
    private readonly Func<string, CancellationToken, Task> _assertOwned;
    private readonly Func<string, CancellationToken, Task<LocalServiceHealth>> _probe;
    private readonly Func<string, bool, CancellationToken, Task> _recover;
    private readonly Func<string, Task> _warn;
    private readonly Func<TimeSpan> _elapsed;
    private readonly Func<DateTimeOffset> _utcNow;
    private readonly Func<bool> _networkAvailable;
    private readonly TimeSpan _bootGrace;
    private readonly Func<string, CancellationToken, Task>? _repairRecovery;
    private readonly ConcurrentDictionary<string, Observation> _observations = new(StringComparer.Ordinal);

    internal OwnedServiceSupervisor(OwnedServiceIntentStore intents,
        Func<string, CancellationToken, Task<OwnedServiceStatus>> status,
        Func<string, CancellationToken, Task> assertOwned,
        Func<string, CancellationToken, Task<LocalServiceHealth>> probe,
        Func<string, bool, CancellationToken, Task> recover,
        Func<string, Task> warn, Func<bool> networkAvailable,
        Func<TimeSpan>? elapsed = null, Func<DateTimeOffset>? utcNow = null, TimeSpan? bootGrace = null,
        Func<string, CancellationToken, Task>? repairRecovery = null)
    {
        _intents = intents; _status = status; _assertOwned = assertOwned;
        _probe = probe; _recover = recover; _warn = warn;
        var clock = Stopwatch.StartNew();
        _elapsed = elapsed ?? (() => clock.Elapsed);
        _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
        _networkAvailable = networkAvailable;
        _bootGrace = bootGrace ?? TimeSpan.FromSeconds(60);
        _repairRecovery = repairRecovery;
    }

    internal object Describe() => new
    {
        scope = "owned-auto-services-and-local-listeners",
        remoteConnectivityVerified = false,
        services = OwnedServiceIntentStore.ServiceNames.Select(name =>
        {
            var value = _observations.GetValueOrDefault(name) ?? new Observation();
            return new { serviceName = name, intendedRunning = value.IntendedRunning,
                localHealth = value.Result, consecutiveFailures = value.Failures, recoveryAttempts = value.Attempts };
        }).ToArray()
    };

    internal async Task CheckAsync(CancellationToken cancellationToken)
    {
        TimeSpan now = _elapsed();
        if (now < _bootGrace) return;
        var intents = await _intents.ReadAsync(cancellationToken);
        foreach (string name in OwnedServiceIntentStore.ServiceNames)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var observation = _observations.GetValueOrDefault(name) ?? new Observation();
            try
            {
                var status = await _status(name, cancellationToken);
                intents.Services.TryGetValue(name, out var intent);
                if (!status.Installed || status.StartType != "auto" || status.State is not ("running" or "stopped"))
                {
                    _observations[name] = observation with { Failures = 0, FailureSince = null,
                        Result = status.State, IntendedRunning = intent?.Running == true };
                    continue;
                }
                await _assertOwned(name, cancellationToken);
                if (intent == null && status.State == "running")
                {
                    // Migrate only a verified already-running automatic service.
                    // Legacy stopped services carry no recoverable user intent.
                    await _intents.SetRunningAsync(name, true, cancellationToken);
                    intent = new OwnedServiceIntent(true);
                }
                if (intent?.Running != true)
                {
                    _observations[name] = observation with { Failures = 0, FailureSince = null,
                        Result = "intentionally-off", IntendedRunning = false };
                    continue;
                }
                if (!observation.RecoveryPolicyVerified && _repairRecovery != null)
                {
                    observation = observation with { IntendedRunning = true };
                    if (now >= observation.NextPolicyAttempt)
                    {
                        try
                        {
                            await _repairRecovery(name, cancellationToken);
                            observation = observation with { RecoveryPolicyVerified = true };
                        }
                        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
                        catch (Exception error)
                        {
                            if (observation.LastWarning == null || now - observation.LastWarning >= TimeSpan.FromMinutes(5))
                            {
                                await _warn("Owned SCM recovery policy of " + name + " deferred: " + error.Message);
                                observation = observation with { LastWarning = now };
                            }
                            observation = observation with { NextPolicyAttempt = now + TimeSpan.FromMinutes(5) };
                        }
                        _observations[name] = observation;
                    }
                }
                bool ownsTcpEndpoint = name == "EgoistShieldTelegramProxy";
                var health = status.State == "stopped" && !ownsTcpEndpoint ? LocalServiceHealth.Unresponsive : await _probe(name, cancellationToken);
                if (health is LocalServiceHealth.Responsive or LocalServiceHealth.ScmOnly)
                {
                    TimeSpan healthySince = observation.HealthySince ?? now;
                    bool stable = now - healthySince >= TimeSpan.FromMinutes(10);
                    _observations[name] = observation with { Failures = 0, FailureSince = null,
                        Attempts = stable ? 0 : observation.Attempts, HealthySince = healthySince,
                        Result = health == LocalServiceHealth.ScmOnly ? "scm-running" : "local-responsive", IntendedRunning = true };
                    continue;
                }
                if (health is LocalServiceHealth.Unknown or LocalServiceHealth.Conflict || !_networkAvailable())
                {
                    _observations[name] = observation with { Failures = 0, FailureSince = null, HealthySince = null,
                        Result = health == LocalServiceHealth.Unknown ? "probe-unavailable" : health == LocalServiceHealth.Conflict ? "listener-conflict" : "network-offline", IntendedRunning = true };
                    continue;
                }
                observation = observation with { Failures = Math.Min(observation.Failures + 1, 1000),
                    FailureSince = observation.FailureSince ?? now, HealthySince = null,
                    Result = status.State == "stopped" ? "unexpectedly-stopped" : "local-unresponsive", IntendedRunning = true };
                _observations[name] = observation;
                // Three observations spanning at least 30 seconds distinguish a
                // transient startup/network event from a persistent local failure.
                TimeSpan? recoveryAge = intent.LastRecoveryAt.HasValue ? _utcNow() - intent.LastRecoveryAt.Value : null;
                bool recentlyRecovered = recoveryAge >= TimeSpan.Zero && recoveryAge < TimeSpan.FromMinutes(5);
                if (observation.Failures < 3 || now - observation.FailureSince < TimeSpan.FromSeconds(30) ||
                    now < observation.NextAttempt || recentlyRecovered) continue;

                // Read intent/state again after probing. An external Disabled
                // change or explicit Stop racing with a probe wins over recovery.
                var latest = await _intents.ReadAsync(cancellationToken);
                status = await _status(name, cancellationToken);
                if (!latest.Services.TryGetValue(name, out var stillWanted) || !stillWanted.Running ||
                    !status.Installed || status.StartType != "auto" || status.State is not ("running" or "stopped")) continue;
                await _assertOwned(name, cancellationToken);
                var latestHealth = ownsTcpEndpoint ? await _probe(name, cancellationToken) : LocalServiceHealth.Unresponsive;
                if (latestHealth != LocalServiceHealth.Unresponsive)
                {
                    _observations[name] = observation with { Failures = 0, FailureSince = null,
                        HealthySince = latestHealth == LocalServiceHealth.Responsive ? now : null,
                        Result = latestHealth == LocalServiceHealth.Conflict ? "listener-conflict" :
                            latestHealth == LocalServiceHealth.Responsive ? "local-responsive" : "probe-unavailable" };
                    continue;
                }
                int attempts = Math.Min(observation.Attempts + 1, 16);
                TimeSpan backoff = TimeSpan.FromMinutes(Math.Min(30, 5 * Math.Pow(2, Math.Min(attempts - 1, 3))));
                observation = observation with { Attempts = attempts, NextAttempt = now + backoff,
                    Failures = 0, FailureSince = null, Result = "recovering" };
                _observations[name] = observation;
                // Commit the attempt before starting it; a Core process crash
                // cannot reset the minimum five-minute restart interval.
                await _intents.MarkRecoveryAsync(name, _utcNow(), cancellationToken);
                await _warn("Owned service " + name + " has a persistent " + (status.State == "running" ? "local-listener failure" : "stopped state") + "; attempting recovery.");
                await _recover(name, status.State == "running", cancellationToken);
                _observations[name] = observation with { Result = "recovery-started" };
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception error)
            {
                observation = _observations.GetValueOrDefault(name) ?? observation;
                if (observation.LastWarning == null || now - observation.LastWarning >= TimeSpan.FromMinutes(5))
                {
                    await _warn("Owned service supervision of " + name + " deferred: " + error.Message);
                    observation = observation with { LastWarning = now };
                }
                _observations[name] = observation with { Result = "supervision-deferred",
                    NextPolicyAttempt = observation.RecoveryPolicyVerified ? observation.NextPolicyAttempt : now + TimeSpan.FromMinutes(5) };
            }
        }
    }
}
