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
    private readonly Func<CancellationToken, Task<bool>>? _dnsRecoveryPreflight;
    private readonly Func<CancellationToken, IDisposable>? _recoveryMutationScope;
    private readonly ConcurrentDictionary<string, Observation> _observations = new(StringComparer.Ordinal);

    internal OwnedServiceSupervisor(OwnedServiceIntentStore intents,
        Func<string, CancellationToken, Task<OwnedServiceStatus>> status,
        Func<string, CancellationToken, Task> assertOwned,
        Func<string, CancellationToken, Task<LocalServiceHealth>> probe,
        Func<string, bool, CancellationToken, Task> recover,
        Func<string, Task> warn, Func<bool> networkAvailable,
        Func<TimeSpan>? elapsed = null, Func<DateTimeOffset>? utcNow = null, TimeSpan? bootGrace = null,
        Func<string, CancellationToken, Task>? repairRecovery = null,
        Func<CancellationToken, Task<bool>>? dnsRecoveryPreflight = null,
        Func<CancellationToken, IDisposable>? recoveryMutationScope = null)
    {
        _intents = intents; _status = status; _assertOwned = assertOwned;
        _probe = probe; _recover = recover; _warn = warn;
        var clock = Stopwatch.StartNew();
        _elapsed = elapsed ?? (() => clock.Elapsed);
        _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
        _networkAvailable = networkAvailable;
        _bootGrace = bootGrace ?? TimeSpan.FromSeconds(60);
        _repairRecovery = repairRecovery;
        _dnsRecoveryPreflight = dnsRecoveryPreflight;
        _recoveryMutationScope = recoveryMutationScope;
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
            bool fastDns = name == "EgoistShieldSystemDoH";
            try
            {
                var status = await _status(name, cancellationToken);
                intents.Services.TryGetValue(name, out var intent);
                if (!status.Installed || status.StartType != "auto" || status.State is not ("running" or "stopped"))
                {
                    _observations[name] = observation with { Failures = 0, FailureSince = null,
                        Result = status.State, IntendedRunning = intent?.Running == true, HealthySince = fastDns ? null : observation.HealthySince };
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
                        Result = "intentionally-off", IntendedRunning = false, HealthySince = fastDns ? null : observation.HealthySince };
                    continue;
                }
                if (fastDns) observation = observation with { Attempts = intent.DnsRecoveryAttempts };
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
                bool ownsTcpEndpoint = name is "EgoistShieldTelegramProxy" or "EgoistShieldVpn";
                var health = status.State == "stopped" && !ownsTcpEndpoint ? LocalServiceHealth.Unresponsive : await _probe(name, cancellationToken);
                if (health is LocalServiceHealth.Responsive or LocalServiceHealth.ScmOnly)
                {
                    TimeSpan healthySince = observation.HealthySince ?? now;
                    bool stable = now - healthySince >= TimeSpan.FromMinutes(10);
                    if (stable && fastDns && intent.DnsRecoveryAttempts > 0)
                        stable = await _intents.ResetSystemDohRecoveryAttemptsAsync(intent, cancellationToken);
                    _observations[name] = observation with { Failures = 0, FailureSince = null,
                        Attempts = stable ? 0 : observation.Attempts, NextAttempt = stable ? default : observation.NextAttempt,
                        HealthySince = healthySince,
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
                // DNS gets two independent current local/provider comparisons.
                // Addons keep their original three-observation policy.
                TimeSpan? recoveryAge = intent.LastRecoveryAt.HasValue ? _utcNow() - intent.LastRecoveryAt.Value : null;
                TimeSpan recoveryDelay = fastDns ? OwnedServiceIntentStore.SystemDohRecoveryDelay(intent.DnsRecoveryAttempts) : TimeSpan.FromMinutes(5);
                bool recentlyRecovered = recoveryAge >= TimeSpan.Zero && recoveryAge < recoveryDelay;
                if (observation.Failures < (fastDns ? 2 : 3) || now - observation.FailureSince < TimeSpan.FromSeconds(fastDns ? 10 : 30) ||
                    now < observation.NextAttempt || recentlyRecovered) continue;

                // Read intent/state again after probing. An external Disabled
                // change or explicit Stop racing with a probe wins over recovery.
                var latest = await _intents.ReadAsync(cancellationToken);
                status = await _status(name, cancellationToken);
                if (!latest.Services.TryGetValue(name, out var stillWanted) || !stillWanted.Running ||
                    !status.Installed || status.StartType != "auto" || status.State is not ("running" or "stopped")) continue;
                await _assertOwned(name, cancellationToken);
                bool requiresFinalProbe = ownsTcpEndpoint || name == "EgoistShieldSystemDoH" && status.State == "running";
                var latestHealth = requiresFinalProbe ? await _probe(name, cancellationToken) : LocalServiceHealth.Unresponsive;
                if (latestHealth != LocalServiceHealth.Unresponsive)
                {
                    _observations[name] = observation with { Failures = 0, FailureSince = null,
                        HealthySince = latestHealth == LocalServiceHealth.Responsive ? now : null,
                        Result = latestHealth == LocalServiceHealth.Conflict ? "listener-conflict" :
                            latestHealth == LocalServiceHealth.Responsive ? "local-responsive" : "probe-unavailable" };
                    continue;
                }
                if (name == "EgoistShieldSystemDoH" && status.State == "running")
                {
                    // The real local/upstream comparison has a bounded network
                    // deadline. Stop/Disabled or a newer recovery during that
                    // final probe still wins over the impending mutation.
                    latest = await _intents.ReadAsync(cancellationToken);
                    status = await _status(name, cancellationToken);
                    if (!latest.Services.TryGetValue(name, out stillWanted) || !stillWanted.Running ||
                        !status.Installed || status.StartType != "auto" || status.State is not ("running" or "stopped")) continue;
                    recoveryAge = stillWanted.LastRecoveryAt.HasValue ? _utcNow() - stillWanted.LastRecoveryAt.Value : null;
                    if (recoveryAge >= TimeSpan.Zero && recoveryAge < OwnedServiceIntentStore.SystemDohRecoveryDelay(stillWanted.DnsRecoveryAttempts)) continue;
                    await _assertOwned(name, cancellationToken);
                }
                if (fastDns && status.State == "running" && _dnsRecoveryPreflight != null)
                {
                    // Preserve the live resolver and its same-operator cache if
                    // a fresh Xray cannot yet use this exact saved provider.
                    if (!await _dnsRecoveryPreflight(cancellationToken))
                    {
                        _observations[name] = observation with { NextAttempt = _elapsed() + TimeSpan.FromSeconds(60),
                            Result = "replacement-not-ready", HealthySince = null };
                        if (observation.LastWarning == null || now - observation.LastWarning >= TimeSpan.FromMinutes(5))
                        {
                            await _warn("System DoH replacement preflight is not ready; the current resolver and cache are retained.");
                            _observations[name] = _observations[name] with { LastWarning = now };
                        }
                        continue;
                    }
                    // Candidate readiness cannot override a Stop/Disabled, a
                    // changed intent or an old resolver which has now recovered.
                    var expected = stillWanted;
                    latest = await _intents.ReadAsync(cancellationToken);
                    status = await _status(name, cancellationToken);
                    if (!latest.Services.TryGetValue(name, out stillWanted) || stillWanted != expected || !stillWanted.Running ||
                        !status.Installed || status.StartType != "auto" || status.State != "running") continue;
                    await _assertOwned(name, cancellationToken);
                    latest = await _intents.ReadAsync(cancellationToken);
                    status = await _status(name, cancellationToken);
                    if (!latest.Services.TryGetValue(name, out stillWanted) || stillWanted != expected || !stillWanted.Running ||
                        !status.Installed || status.StartType != "auto" || status.State != "running") continue;
                    await _assertOwned(name, cancellationToken);
                }
                // A network transition during final probing/readback must not
                // restart a service or consume its durable recovery interval.
                if (!_networkAvailable())
                {
                    _observations[name] = observation with { Failures = 0, FailureSince = null, HealthySince = null,
                        Result = "network-offline", IntendedRunning = true };
                    continue;
                }
                int attempts = Math.Min((fastDns ? stillWanted.DnsRecoveryAttempts : observation.Attempts) + 1, fastDns ? 32 : 16);
                TimeSpan backoff = fastDns ? OwnedServiceIntentStore.SystemDohRecoveryDelay(attempts) :
                    TimeSpan.FromMinutes(Math.Min(30, 5 * Math.Pow(2, Math.Min(attempts - 1, 3))));
                // Commit the DNS count, timestamp and expected generation as one
                // durable CAS before recovery. A Core crash cannot reset storms.
                // Foreground can cancel probes, but must not interrupt a committed
                // native stop/start half-way and strand an otherwise wanted DNS.
                cancellationToken.ThrowIfCancellationRequested();
                using var recoveryMutation = _recoveryMutationScope?.Invoke(cancellationToken);
                if (fastDns)
                {
                    if (!await _intents.TryMarkSystemDohRecoveryAsync(stillWanted, _utcNow(), cancellationToken)) continue;
                }
                else await _intents.MarkRecoveryAsync(name, _utcNow(), cancellationToken);
                observation = observation with { Attempts = attempts, NextAttempt = now + backoff,
                    Failures = 0, FailureSince = null, Result = "recovering" };
                _observations[name] = observation;
                await _warn("Owned service " + name + " has a persistent " + (status.State == "running" ? "local-listener failure" : "stopped state") + "; attempting recovery.");
                await _recover(name, status.State == "running", cancellationToken);
                _observations[name] = observation with { Result = "recovery-started" };
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception error)
            {
                observation = _observations.GetValueOrDefault(name) ?? observation;
                if (fastDns) observation = observation with { Failures = 0, FailureSince = null, HealthySince = null };
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


