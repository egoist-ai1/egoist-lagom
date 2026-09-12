using System;
using System.Security.Principal;
using System.Text.Json.Serialization;

namespace EgoistShield.Service;

internal sealed record AdminStatusResult(
	bool Ok,
	bool IsAdmin,
	[property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Code = null,
	[property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Message = null);

/// <summary>Reads the access token of the invoking process without starting the service or changing system state.</summary>
internal static class AdminStatusChecker
{
	public static AdminStatusResult Check()
	{
		if (!OperatingSystem.IsWindows())
		{
			return new AdminStatusResult(false, false, "PLATFORM_UNSUPPORTED", "Windows token inspection requires Windows.");
		}

		try
		{
			using WindowsIdentity identity = WindowsIdentity.GetCurrent();
			WindowsPrincipal principal = new WindowsPrincipal(identity);
			return new AdminStatusResult(true, principal.IsInRole(WindowsBuiltInRole.Administrator));
		}
		catch (Exception error)
		{
			return new AdminStatusResult(false, false, "CHECK_FAILED", error.Message);
		}
	}
}
