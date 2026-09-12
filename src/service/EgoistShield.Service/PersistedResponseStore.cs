using System.Collections.Generic;

namespace EgoistShield.Service;

internal sealed record PersistedResponseStore(int SchemaVersion, string Owner, List<PersistedResponseEntry> Entries);
