using System.Text.Json.Serialization;

namespace EgoistShield.Service;

internal sealed record DnsApplyPayload([property: JsonPropertyName("servers")] string[] Servers, [property: JsonPropertyName("probeHosts")] string[]? ProbeHosts = null);
