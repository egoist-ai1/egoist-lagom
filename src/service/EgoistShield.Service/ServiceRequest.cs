using System.Text.Json;
using System.Text.Json.Serialization;

namespace EgoistShield.Service;

internal sealed record ServiceRequest([property: JsonPropertyName("protocolVersion")] int ProtocolVersion, [property: JsonPropertyName("requestId")] string RequestId, [property: JsonPropertyName("operation")] string Operation, [property: JsonPropertyName("payload")] JsonElement Payload);
