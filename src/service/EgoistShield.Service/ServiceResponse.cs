using System.Text.Json.Serialization;

namespace EgoistShield.Service;

internal sealed record ServiceResponse([property: JsonPropertyName("protocolVersion")] int ProtocolVersion, [property: JsonPropertyName("requestId")] string RequestId, [property: JsonPropertyName("ok")] bool Ok, [property: JsonPropertyName("serviceVersion")] string ServiceVersion, [property: JsonPropertyName("sequence")] long Sequence, [property: JsonPropertyName("result")] object? Result, [property: JsonPropertyName("error")] ServiceError? Error)
{
	public static ServiceResponse Success(string requestId, long sequence, object? result)
	{
		return new ServiceResponse(1, requestId, Ok: true, BuildInfo.Version, sequence, result, null);
	}

	public static ServiceResponse Failure(string requestId, long sequence, string code, string message, bool retryable = false)
	{
		return new ServiceResponse(1, requestId, Ok: false, BuildInfo.Version, sequence, null, new ServiceError(code, message, retryable));
	}
}
