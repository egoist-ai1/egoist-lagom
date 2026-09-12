using System.Text.Json.Serialization;

namespace EgoistShield.Service;

internal sealed record OwnedServicePayload([property: JsonPropertyName("serviceName")] string ServiceName);
