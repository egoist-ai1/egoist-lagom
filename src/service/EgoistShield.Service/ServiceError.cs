using System.Text.Json.Serialization;

namespace EgoistShield.Service;

internal sealed record ServiceError([property: JsonPropertyName("code")] string Code, [property: JsonPropertyName("message")] string Message, [property: JsonPropertyName("retryable")] bool Retryable = false);
