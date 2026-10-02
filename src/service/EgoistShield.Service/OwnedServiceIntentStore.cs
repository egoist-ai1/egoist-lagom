using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed record OwnedServiceIntent(bool Running, DateTimeOffset? LastRecoveryAt = null, int DnsRecoveryAttempts = 0);
internal sealed record OwnedServiceIntentState(int SchemaVersion, string Owner, Dictionary<string, OwnedServiceIntent> Services);

internal sealed class OwnedServiceIntentStore
{
    internal static readonly string[] ServiceNames = { "EgoistShieldSystemDoH", "EgoistShieldZapret", "EgoistShieldTelegramProxy", "EgoistShieldVpn" };
    private readonly string _path;
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    internal OwnedServiceIntentStore(string stateRoot) => _path = Path.Combine(stateRoot, "service-supervision.json");

    internal async Task<OwnedServiceIntentState> ReadAsync(CancellationToken cancellationToken)
    {
        var state = await AtomicJsonFile.ReadAsync<OwnedServiceIntentState>(_path, cancellationToken)
            ?? new OwnedServiceIntentState(1, "EgoistShield", new Dictionary<string, OwnedServiceIntent>(StringComparer.Ordinal));
        if (state.SchemaVersion != 1 || state.Owner != "EgoistShield" || state.Services == null || state.Services.Count > ServiceNames.Length)
            throw new InvalidOperationException("Owned-service supervision state is invalid.");
        foreach (var pair in state.Services)
            if (Array.IndexOf(ServiceNames, pair.Key) < 0 || pair.Value == null || pair.Value.DnsRecoveryAttempts is < 0 or > 32 ||
                pair.Value.DnsRecoveryAttempts > 0 && (pair.Key != "EgoistShieldSystemDoH" || pair.Value.LastRecoveryAt == null))
                throw new InvalidOperationException("Owned-service supervision contains an unknown service.");
        return state;
    }

    internal bool Supports(string serviceName) => Array.IndexOf(ServiceNames, serviceName) >= 0;

    internal Task SetRunningAsync(string serviceName, bool running, CancellationToken cancellationToken) =>
        UpdateAsync(serviceName, previous => new OwnedServiceIntent(running, previous?.LastRecoveryAt, previous?.DnsRecoveryAttempts ?? 0), cancellationToken);

    internal Task MarkRecoveryAsync(string serviceName, DateTimeOffset now, CancellationToken cancellationToken) =>
        UpdateAsync(serviceName, previous => new OwnedServiceIntent(previous?.Running == true, now, serviceName == "EgoistShieldSystemDoH" ? Math.Min((previous?.DnsRecoveryAttempts ?? 0) + 1, 32) : 0), cancellationToken);

    internal static TimeSpan SystemDohRecoveryDelay(int attempts) => attempts < 3
        ? TimeSpan.FromSeconds(60)
        : TimeSpan.FromMinutes(Math.Min(30, 5 * Math.Pow(2, Math.Min(attempts - 3, 3))));

    internal async Task<bool> TryMarkSystemDohRecoveryAsync(OwnedServiceIntent expected, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            var state = await ReadAsync(cancellationToken);
            if (!state.Services.TryGetValue("EgoistShieldSystemDoH", out var current) || !current.Running ||
                current.LastRecoveryAt != expected.LastRecoveryAt || current.DnsRecoveryAttempts != expected.DnsRecoveryAttempts) return false;
            if (current.LastRecoveryAt.HasValue && now - current.LastRecoveryAt.Value >= TimeSpan.Zero &&
                now - current.LastRecoveryAt.Value < SystemDohRecoveryDelay(current.DnsRecoveryAttempts)) return false;
            state.Services["EgoistShieldSystemDoH"] = current with { LastRecoveryAt = now, DnsRecoveryAttempts = Math.Min(current.DnsRecoveryAttempts + 1, 32) };
            await AtomicJsonFile.WriteAsync(_path, state, cancellationToken);
            return true;
        }
        finally { _writeLock.Release(); }
    }

    internal async Task<bool> ResetSystemDohRecoveryAttemptsAsync(OwnedServiceIntent expected, CancellationToken cancellationToken)
    {
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            var state = await ReadAsync(cancellationToken);
            if (!state.Services.TryGetValue("EgoistShieldSystemDoH", out var current) || !current.Running ||
                current.LastRecoveryAt != expected.LastRecoveryAt || current.DnsRecoveryAttempts != expected.DnsRecoveryAttempts) return false;
            if (current.DnsRecoveryAttempts == 0) return true;
            state.Services["EgoistShieldSystemDoH"] = current with { DnsRecoveryAttempts = 0 };
            await AtomicJsonFile.WriteAsync(_path, state, cancellationToken);
            return true;
        }
        finally { _writeLock.Release(); }
    }

    internal async Task RestoreRunningAsync(string serviceName, OwnedServiceIntent? previous, CancellationToken cancellationToken)
    {
        if (!Supports(serviceName)) throw new ArgumentException("Unknown owned-service intent.");
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            var state = await ReadAsync(cancellationToken);
            if (!state.Services.TryGetValue(serviceName, out var current) || !current.Running || current.LastRecoveryAt != previous?.LastRecoveryAt || current.DnsRecoveryAttempts != (previous?.DnsRecoveryAttempts ?? 0))
                throw new InvalidOperationException("Owned-service intent changed after the attempted start; its current value is preserved.");
            if (previous == null) state.Services.Remove(serviceName); else state.Services[serviceName] = previous;
            await AtomicJsonFile.WriteAsync(_path, state, cancellationToken);
        }
        finally { _writeLock.Release(); }
    }

    private async Task UpdateAsync(string serviceName, Func<OwnedServiceIntent?, OwnedServiceIntent> change, CancellationToken cancellationToken)
    {
        if (!Supports(serviceName)) return;
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            var state = await ReadAsync(cancellationToken);
            state.Services.TryGetValue(serviceName, out var previous);
            state.Services[serviceName] = change(previous);
            await AtomicJsonFile.WriteAsync(_path, state, cancellationToken);
        }
        finally { _writeLock.Release(); }
    }
}
