using System.Text.Json.Serialization;

namespace EgoistShield.Service;

internal sealed record ZapretProfilePayload([property: JsonPropertyName("profile")] string? Profile);
