using System;
using System.CodeDom.Compiler;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.Marshalling;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace EgoistShield.Service;

internal sealed class ClientAuthorizer
{
	private readonly ServiceOptions _options;

	private readonly string? _configuredInstallRoot;

	private const uint TokenQuery = 8u;

	public ClientAuthorizer(ServiceOptions options, ServiceConfig? config)
	{
		_options = options;
		_configuredInstallRoot = config?.InstallRoot ?? options.InstallRoot;
	}

	public ClientIdentity Authorize(NamedPipeServerStream pipe)
	{
		if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out var clientProcessId))
		{
			throw new UnauthorizedAccessException($"Cannot resolve named-pipe client PID (Win32 {Marshal.GetLastWin32Error()}).");
		}
		checked
		{
			string text = ResolveProcessPath((int)clientProcessId);
			string userSid = ResolveProcessUserSid((int)clientProcessId);
			if (_options.ConsoleMode && _options.AllowDevClient)
			{
				return new ClientIdentity((int)clientProcessId, text, DevelopmentOverride: true, userSid);
			}
			if (string.IsNullOrWhiteSpace(_configuredInstallRoot))
			{
				throw new UnauthorizedAccessException("Service install root is not configured.");
			}
			string fullPath = Path.GetFullPath(_configuredInstallRoot);
			EnsureProgramFilesRoot(fullPath);
			string fullPath2 = Path.GetFullPath(Path.Combine(fullPath, "EgoistShield.exe"));
			if (string.Equals(text, fullPath2, StringComparison.OrdinalIgnoreCase))
			{
				return new ClientIdentity((int)clientProcessId, text, DevelopmentOverride: false, userSid);
			}
			InlineArray5<string> buffer = default(InlineArray5<string>);
			buffer[0] = fullPath;
			buffer[1] = "resources";
			buffer[2] = "core-service";
			buffer[3] = "win-x64";
			buffer[4] = "EgoistShield.Service.exe";
			string fullPath3 = Path.GetFullPath(Path.Combine(buffer));
			if (string.Equals(text, fullPath3, StringComparison.OrdinalIgnoreCase))
			{
				return new ClientIdentity((int)clientProcessId, text, DevelopmentOverride: false, userSid, IdentityProbe: true);
			}
			if (!string.Equals(text, fullPath2, StringComparison.OrdinalIgnoreCase))
			{
				throw new UnauthorizedAccessException("Named-pipe client is not the installed Egoist Lagom executable.");
			}
			throw new UnauthorizedAccessException("Named-pipe client identity could not be classified.");
		}
	}

	public static void EnsureProgramFilesRoot(string installRoot)
	{
		string fullRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(installRoot));
		if (!(from root in new string[2]
			{
				Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
				Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86)
			}
			where !string.IsNullOrWhiteSpace(root)
			select Path.TrimEndingDirectorySeparator(Path.GetFullPath(root))).Any((string root) => fullRoot.Equals(root, StringComparison.OrdinalIgnoreCase) || fullRoot.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)))
		{
			throw new InvalidOperationException("Install root must be located under Program Files.");
		}
	}

	private static string ResolveProcessPath(int processId)
	{
		using Process process = Process.GetProcessById(processId);
		DateTime startTime = process.StartTime;
		string obj = process.MainModule?.FileName;
		if (string.IsNullOrWhiteSpace(obj))
		{
			throw new UnauthorizedAccessException("Cannot resolve named-pipe client executable.");
		}
		process.Refresh();
		if (process.HasExited || process.StartTime != startTime)
		{
			throw new UnauthorizedAccessException("Named-pipe client process changed while it was being authorized.");
		}
		return Path.GetFullPath(obj);
	}

	private static string ResolveProcessUserSid(int processId)
	{
		if (!OperatingSystem.IsWindows())
		{
			using (WindowsIdentity windowsIdentity = WindowsIdentity.GetCurrent())
			{
				return windowsIdentity.User?.Value ?? "S-1-0-0";
			}
		}
		using Process process = Process.GetProcessById(processId);
		if (!OpenProcessToken(process.Handle, 8u, out var tokenHandle))
		{
			throw new UnauthorizedAccessException($"Cannot resolve named-pipe client token (Win32 {Marshal.GetLastWin32Error()}).");
		}
		try
		{
			using WindowsIdentity windowsIdentity2 = new WindowsIdentity(tokenHandle);
			return windowsIdentity2.User?.Value ?? throw new UnauthorizedAccessException("Named-pipe client token has no user SID.");
		}
		finally
		{
			CloseHandle(tokenHandle);
		}
	}
	[GeneratedCode("Microsoft.Interop.LibraryImportGenerator", "10.0.14.27113")]
	[SkipLocalsInit]
	[return: MarshalAs(UnmanagedType.Bool)]
	private unsafe static bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint clientProcessId)
	{
		clientProcessId = 0u;
		bool result = false;
		int num = 0;
		SafeHandleMarshaller<SafePipeHandle>.ManagedToUnmanagedIn managedToUnmanagedIn = default(SafeHandleMarshaller<SafePipeHandle>.ManagedToUnmanagedIn);
		int lastSystemError;
		try
		{
			managedToUnmanagedIn.FromManaged(pipe);
			fixed (uint* _clientProcessId_native = &clientProcessId)
			{
				nint _pipe_native = managedToUnmanagedIn.ToUnmanaged();
				Marshal.SetLastSystemError(0);
				num = __PInvoke(_pipe_native, _clientProcessId_native);
				lastSystemError = Marshal.GetLastSystemError();
			}
			result = num != 0;
		}
		finally
		{
			managedToUnmanagedIn.Free();
		}
		Marshal.SetLastPInvokeError(lastSystemError);
		return result;
		[DllImport("kernel32.dll", EntryPoint = "GetNamedPipeClientProcessId", ExactSpelling = true)]
		unsafe static extern int __PInvoke(nint __pipe_native, uint* __clientProcessId_native);
	}
	[GeneratedCode("Microsoft.Interop.LibraryImportGenerator", "10.0.14.27113")]
	[SkipLocalsInit]
	[return: MarshalAs(UnmanagedType.Bool)]
	private unsafe static bool OpenProcessToken(nint processHandle, uint desiredAccess, out nint tokenHandle)
	{
		tokenHandle = 0;
		int num;
		int lastSystemError;
		fixed (nint* _tokenHandle_native = &tokenHandle)
		{
			Marshal.SetLastSystemError(0);
			num = __PInvoke(processHandle, desiredAccess, _tokenHandle_native);
			lastSystemError = Marshal.GetLastSystemError();
		}
		bool result = num != 0;
		Marshal.SetLastPInvokeError(lastSystemError);
		return result;
		[DllImport("advapi32.dll", EntryPoint = "OpenProcessToken", ExactSpelling = true)]
		unsafe static extern int __PInvoke(nint __processHandle_native, uint __desiredAccess_native, nint* __tokenHandle_native);
	}
	[GeneratedCode("Microsoft.Interop.LibraryImportGenerator", "10.0.14.27113")]
	[SkipLocalsInit]
	[return: MarshalAs(UnmanagedType.Bool)]
	private static bool CloseHandle(nint handle)
	{
		Marshal.SetLastSystemError(0);
		int num = __PInvoke(handle);
		int lastSystemError = Marshal.GetLastSystemError();
		bool result = num != 0;
		Marshal.SetLastPInvokeError(lastSystemError);
		return result;
		[DllImport("kernel32.dll", EntryPoint = "CloseHandle", ExactSpelling = true)]
		static extern int __PInvoke(nint __handle_native);
	}
}
