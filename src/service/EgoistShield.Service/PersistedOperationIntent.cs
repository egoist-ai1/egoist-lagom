using System;
using System.Collections.Generic;

namespace EgoistShield.Service;

internal sealed record PersistedOperationIntent(string RequestId, string Fingerprint, string Component,
    string Method, DateTimeOffset StartedAt, ServiceResponse? TerminalResponse = null);

internal sealed record PersistedOperationIntentStore(int SchemaVersion, string Owner, List<PersistedOperationIntent> Entries);
