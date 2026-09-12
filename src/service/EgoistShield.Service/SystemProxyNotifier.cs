using System;
using System.Runtime.InteropServices;

namespace EgoistShield.Service;

internal sealed record SystemProxyNotificationResult(bool Ok, string Code, bool SettingsChanged, bool Refreshed, int? Win32Error, string? Message);

/// <summary>
/// Per-user WinINet notification used by the desktop process after it updates
/// HKCU proxy values. This command does not use the service pipe or elevation.
/// </summary>
internal static class SystemProxyNotifier
{
	private const int InternetOptionRefresh = 37;
	private const int InternetOptionSettingsChanged = 39;

	public static SystemProxyNotificationResult Notify()
	{
		if (!OperatingSystem.IsWindows())
		{
			return new SystemProxyNotificationResult(false, "PLATFORM_UNSUPPORTED", false, false, null, "WinINet system-proxy notifications require Windows.");
		}

		try
		{
			bool settingsChanged = InternetSetOption(IntPtr.Zero, InternetOptionSettingsChanged, IntPtr.Zero, 0);
			int settingsChangedError = settingsChanged ? 0 : Marshal.GetLastWin32Error();
			bool refreshed = InternetSetOption(IntPtr.Zero, InternetOptionRefresh, IntPtr.Zero, 0);
			int refreshError = refreshed ? 0 : Marshal.GetLastWin32Error();
			if (settingsChanged && refreshed)
			{
				return new SystemProxyNotificationResult(true, "OK", true, true, null, null);
			}

			int error = settingsChanged ? refreshError : settingsChangedError;
			string code = settingsChanged ? "REFRESH_FAILED" : "SETTINGS_CHANGED_FAILED";
			string option = settingsChanged ? "INTERNET_OPTION_REFRESH" : "INTERNET_OPTION_SETTINGS_CHANGED";
			return new SystemProxyNotificationResult(false, code, settingsChanged, refreshed, error, $"InternetSetOption({option}) failed with Win32 error {error}.");
		}
		catch (Exception error)
		{
			return new SystemProxyNotificationResult(false, "NOTIFICATION_FAILED", false, false, null, error.Message);
		}
	}

	[DllImport("wininet.dll", SetLastError = true)]
	private static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
}
