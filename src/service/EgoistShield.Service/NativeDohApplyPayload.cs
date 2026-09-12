using System.Text.Json.Serialization;

namespace EgoistShield.Service;

internal sealed record NativeDohApplyPayload([property: JsonPropertyName("url")] string? Url, [property: JsonPropertyName("servers")] string[] Servers, [property: JsonPropertyName("probeHosts")] string[]? ProbeHosts = null);
