using System;

namespace EgoistShield.Service;

internal sealed record PersistedResponseEntry(string RequestId, string Fingerprint, ServiceResponse Response, DateTimeOffset CompletedAt);
