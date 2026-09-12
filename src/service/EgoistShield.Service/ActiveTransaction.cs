using System;
using System.Text.Json;

namespace EgoistShield.Service;

internal sealed record ActiveTransaction(int SchemaVersion, string Owner, string TransactionId, string RequestId, string Resource, string Operation, TransactionPhase Phase, JsonElement Original, JsonElement Desired, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, string? LastError, JsonElement? Verified = null, string? RequestFingerprint = null, long? ResponseSequence = null, ServiceResponse? TerminalResponse = null);
