using System.Text.Json.Serialization;

namespace EgoistShield.Service;

internal sealed record IdentityHelloRequest(int ProtocolVersion, string RequestId, string Operation, IdentityHelloPayload Payload);

internal sealed record IdentityHelloPayload;

[JsonSourceGenerationOptions(
	PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
	GenerationMode = JsonSourceGenerationMode.Serialization,
	DefaultIgnoreCondition = JsonIgnoreCondition.Never)]
[JsonSerializable(typeof(IdentityHelloRequest))]
[JsonSerializable(typeof(PipeServerIdentityResult))]
internal partial class IdentityJsonContext : JsonSerializerContext
{
}
