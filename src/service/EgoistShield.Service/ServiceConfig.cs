using System;

namespace EgoistShield.Service;

internal sealed record ServiceConfig(int SchemaVersion, string Owner, string InstallRoot, DateTimeOffset UpdatedAt);
