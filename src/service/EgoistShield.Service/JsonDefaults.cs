using System.Text.Json;
using System.Text.Json.Serialization;

namespace EgoistShield.Service;

internal static class JsonDefaults
{
	public static readonly JsonSerializerOptions Options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
	{
		PropertyNameCaseInsensitive = false,
		UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
		WriteIndented = false,
		Converters = { (JsonConverter)new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
	};

	public static readonly JsonSerializerOptions StateOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web)
	{
		PropertyNameCaseInsensitive = false,
		UnmappedMemberHandling = JsonUnmappedMemberHandling.Skip,
		WriteIndented = false,
		Converters = { (JsonConverter)new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
	};

	public static JsonElement ToElement<T>(T value)
	{
		return JsonSerializer.SerializeToElement(value, Options);
	}
}
