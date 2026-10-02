using System;
using System.Collections;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace EgoistShield.Service;

// This is a diagnostic copy only. Never pass its output back into network configuration.
internal static class ServiceDiagnosticRedaction
{
	private static readonly TimeSpan MatchBudget = TimeSpan.FromMilliseconds(100);
	private static Regex Pattern(string value) => new(value, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, MatchBudget);
	private static readonly Regex PrivateKey = Pattern(@"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|\z)");
	private static readonly Regex OrphanPrivateKey = Pattern(@"\A[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----");
	private static readonly Regex Url = Pattern(@"\b[a-z][a-z0-9+.-]{0,31}://[^\s\""'<>]+");
	private static readonly Regex Secret = Pattern(@"\b(secret|token|password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|pre[_-]?shared[_-]?key|authorization|proxy[_-]?authorization)([\""']?\s*[:=]\s*)(\""(?:\\.|[^\""\\])*\""?|'(?:\\.|[^'\\])*'?|[^\s,;\""']+)");
	private static readonly Regex Authorization = Pattern(@"\b(authorization|proxy-authorization)(\s*[:=]\s*)(bearer\s+|basic\s+)?([^\s,\""']+)");
	private static readonly Regex Cookie = Pattern(@"\b(set-cookie|cookie)(\s*[:=]\s*)([^\r\n]+)");
	private static readonly Regex UserPath = Pattern(@"\b([A-Za-z]:\\Users\\)([^\\\s]+)(?=\\)");
	private static readonly Regex SecretKey = Pattern(@"authorization|cookie|secret|token|password|passwd|hwid|api[_-]?key|private[_-]?key|pre[_-]?shared[_-]?key|commandline|rawpayload");

	internal static string Text(string? value, int maxChars = 8192)
	{
		try
		{
			string text = PrivateKey.Replace(value ?? "", "<private-key>");
			text = OrphanPrivateKey.Replace(text, "<private-key>");
			text = Url.Replace(text.Replace(@"\/", "/"), match => SafeUrl(match.Value));
			text = Authorization.Replace(text, "$1$2$3<redacted>");
			text = Cookie.Replace(text, "$1$2<redacted>");
			text = Secret.Replace(text, "$1$2<redacted>");
			text = UserPath.Replace(text, "$1<user>");
			return text.Length <= maxChars ? text : text[..maxChars] + "<truncated>";
		}
		catch (RegexMatchTimeoutException) { return "<diagnostic-redaction-budget-exceeded>"; }
	}

	private static string SafeUrl(string value)
	{
		if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return "<invalid-url>";
		if (uri.Scheme is not ("http" or "https" or "tls" or "quic" or "tcp" or "udp" or "socks4" or "socks5")) return "<connection-uri>";
		string host = uri.HostNameType == UriHostNameType.IPv6 ? "[" + uri.Host + "]" : uri.Host;
		string port = uri.IsDefaultPort ? "" : ":" + uri.Port;
		string path = uri.AbsolutePath is "" or "/" or "/dns-query" ? uri.AbsolutePath : "/<redacted-path>";
		return uri.Scheme + "://" + (uri.UserInfo.Length == 0 ? "" : "<credentials>@") + host + port + path + (uri.Query.Length == 0 ? "" : "?<redacted>") + (uri.Fragment.Length == 0 ? "" : "#<redacted>");
	}

	internal static string Correlation(string? value) => string.IsNullOrWhiteSpace(value) ? "none" : "id-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant()[..24];

	internal static object? Value(object? value, int depth = 0)
	{
		if (value is double number && !double.IsFinite(number)) return "<non-finite>";
		if (value == null || value is bool || value is byte || value is int || value is long || value is double || value is decimal) return value;
		if (depth >= 6) return "<depth-limit>";
		if (value is string text) return Text(text);
		if (value is Exception error)
			return new { type = error.GetType().Name, message = Text(error.Message), hresult = error.HResult, stack = Text(error.StackTrace, 4096), cause = Value(error.InnerException, depth + 1) };
		JsonElement element;
		try { element = value is JsonElement json ? json : JsonSerializer.SerializeToElement(value); }
		catch { return "<unserializable>"; }
		if (element.ValueKind == JsonValueKind.Object)
		{
			var result = new Dictionary<string, object?>();
			foreach (var property in element.EnumerateObject())
			{
				if (result.Count >= 48) { result["_truncated"] = true; break; }
				result[Text(property.Name, 128)] = SecretKey.IsMatch(property.Name) ? "<redacted>" : Value(property.Value, depth + 1);
			}
			return result;
		}
		if (element.ValueKind == JsonValueKind.Array)
		{
			var result = new List<object?>();
			foreach (var item in element.EnumerateArray()) { if (result.Count >= 32) { result.Add("<truncated>"); break; } result.Add(Value(item, depth + 1)); }
			return result;
		}
		return element.ValueKind switch { JsonValueKind.String => Text(element.GetString()), JsonValueKind.True => true, JsonValueKind.False => false, JsonValueKind.Number => element.Clone(), _ => null };
	}
}
