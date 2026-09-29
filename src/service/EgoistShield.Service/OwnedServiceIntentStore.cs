using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed record OwnedServiceIntent(bool Running, DateTimeOffset? LastRecoveryAt = null);
internal sealed record OwnedServiceIntentState(int SchemaVersion, string Owner, Dictionary<string, OwnedServiceIntent> Services);

internal sealed class OwnedServiceIntentStore
{
    internal static readonly string[] ServiceNames = { "EgoistShieldSystemDoH", "EgoistShieldZapret", "EgoistShieldTelegramProxy" };
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
            if (Array.IndexOf(ServiceNames, pair.Key) < 0 || pair.Value == null)
                throw new InvalidOperationException("Owned-service supervision contains an unknown service.");
        return state;
    }

    internal bool Supports(string serviceName) => Array.IndexOf(ServiceNames, serviceName) >= 0;

    internal Task SetRunningAsync(string serviceName, bool running, CancellationToken cancellationToken) =>
        UpdateAsync(serviceName, previous => new OwnedServiceIntent(running, previous?.LastRecoveryAt), cancellationToken);

    internal Task MarkRecoveryAsync(string serviceName, DateTimeOffset now, CancellationToken cancellationToken) =>
        UpdateAsync(serviceName, previous => new OwnedServiceIntent(previous?.Running == true, now), cancellationToken);

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
