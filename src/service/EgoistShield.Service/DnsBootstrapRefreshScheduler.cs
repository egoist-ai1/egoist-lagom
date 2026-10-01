using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed class DnsBootstrapRefreshScheduler
{
    private sealed record Attempt(string Url, DateTimeOffset At, bool Completed);
    private sealed record Schedule(int SchemaVersion, string Owner, Dictionary<string, Attempt> Modes);
    private readonly string _path;
    private readonly Func<DateTimeOffset> _utcNow;
    private readonly SemaphoreSlim _gate = new(1, 1);

    internal DnsBootstrapRefreshScheduler(string stateRoot, Func<DateTimeOffset>? utcNow = null)
    {
        _path = Path.Combine(stateRoot, "dns-bootstrap-maintenance.json");
        _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
    }

    internal async Task<bool> RunIfDueAsync(string mode, string url,
        Func<CancellationToken, Task> refresh, CancellationToken cancellationToken)
    {
        if (mode is not ("native" or "local") || !Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(uri.UserInfo))
            throw new ArgumentException("DNS refresh requires an owned mode and HTTPS URL.");
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var schedule = await AtomicJsonFile.ReadAsync<Schedule>(_path, cancellationToken) ??
                new Schedule(1, "EgoistShield", new Dictionary<string, Attempt>(StringComparer.Ordinal));
            if (schedule.SchemaVersion != 1 || schedule.Owner != "EgoistShield" || schedule.Modes == null || schedule.Modes.Count > 2)
                throw new InvalidOperationException("DNS bootstrap maintenance state is invalid.");
            foreach (var pair in schedule.Modes)
                if (pair.Key is not ("native" or "local") || pair.Value == null || !Uri.TryCreate(pair.Value.Url, UriKind.Absolute, out var savedUri) || savedUri.Scheme != Uri.UriSchemeHttps)
                    throw new InvalidOperationException("DNS bootstrap maintenance state contains an invalid mode or URL.");
            DateTimeOffset now = _utcNow();
            if (schedule.Modes.TryGetValue(mode, out var previous) && previous.Url == url)
            {
                TimeSpan age = now - previous.At;
                if (age >= TimeSpan.Zero && age < (previous.Completed ? TimeSpan.FromHours(1) : TimeSpan.FromMinutes(15))) return false;
            }
            // Persist before invoking the worker/transaction: a killed Core must
            // not forget the minimum retry interval or replay a partial refresh.
            schedule.Modes[mode] = new Attempt(url, now, false);
            await AtomicJsonFile.WriteAsync(_path, schedule, cancellationToken);
            await refresh(cancellationToken);
            schedule.Modes[mode] = new Attempt(url, now, true);
            await AtomicJsonFile.WriteAsync(_path, schedule, cancellationToken);
            return true;
        }
        finally { _gate.Release(); }
    }
}
