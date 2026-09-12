using System;
using System.CodeDom.Compiler;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.Marshalling;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace EgoistShield.Service;

internal static class PipeServerIdentityVerifier
{
	private sealed record ServiceIdentity(ServiceStatusProcess Status, string BinaryPath);

	private struct ServiceStatusProcess
	{
		public uint ServiceType;

		public uint CurrentState;

		public uint ControlsAccepted;

		public uint Win32ExitCode;

		public uint ServiceSpecificExitCode;

		public uint CheckPoint;

		public uint WaitHint;

		public uint ProcessId;

		public uint ServiceFlags;
	}

	private struct ServiceConfigNative
	{
		public uint ServiceType;

		public uint StartType;

		public uint ErrorControl;

		public nint BinaryPathName;

		public nint LoadOrderGroup;

		public uint TagId;

		public nint Dependencies;

		public nint ServiceStartName;

		public nint DisplayName;
	}

	private const uint ScManagerConnect = 1u;

	private const uint ServiceQueryConfig = 1u;

	private const uint ServiceQueryStatus = 4u;

	private const int ScStatusProcessInfo = 0;

	private const uint ServiceRunning = 4u;

	private const int ErrorInsufficientBuffer = 122;

	public static async Task<PipeServerIdentityResult> VerifyAsync(string pipeName, string serviceName, CancellationToken cancellationToken)
	{
		if (!OperatingSystem.IsWindows())
		{
			return new PipeServerIdentityResult(Ok: false, "WINDOWS_REQUIRED", null, null, "Named-pipe identity verification requires Windows.");
		}
		checked
		{
			int? knownServerPid = null;
			int? knownServicePid = null;
			Stopwatch elapsed = Stopwatch.StartNew();
			string stage = "serialize-request";
			long stageStartedAt = 0;
			List<(string Name, long ElapsedMs)> completedStages = new(8);
			void EnterStage(string name)
			{
				long now = elapsed.ElapsedMilliseconds;
				completedStages.Add((stage, now - stageStartedAt));
				stage = name;
				stageStartedAt = now;
			}
			string DescribeStage()
			{
				long now = elapsed.ElapsedMilliseconds;
				StringBuilder detail = new($"stage={stage}, elapsedMs={now}, stageElapsedMs={now - stageStartedAt}, completedStageMs=[");
				for (int index = 0; index < completedStages.Count; index++)
				{
					if (index > 0) detail.Append(',');
					var completed = completedStages[index];
					detail.Append(completed.Name).Append('=').Append(completed.ElapsedMs);
				}
				return detail.Append(']').ToString();
			}
			try
			{
				using CancellationTokenSource deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
				deadline.CancelAfter(TimeSpan.FromSeconds(15L));
				// Prepare cold serialization before the server starts its input deadline.
				string requestId = $"identity-probe:{Environment.ProcessId}:{Guid.NewGuid():N}";
				byte[] bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(
					new IdentityHelloRequest(1, requestId, "hello", new IdentityHelloPayload()),
					IdentityJsonContext.Default.IdentityHelloRequest) + "\n");
				PipeServerIdentityResult result;
				await using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.WriteThrough | PipeOptions.Asynchronous))
				{
					EnterStage("connect");
					await pipe.ConnectAsync(deadline.Token);
					EnterStage("server-pid");
					if (!GetNamedPipeServerProcessId(pipe.SafePipeHandle, out var serverProcessId))
					{
						string message = $"GetNamedPipeServerProcessId failed with Win32 {Marshal.GetLastWin32Error()}.";
						result = new PipeServerIdentityResult(Ok: false, "PIPE_SERVER_PID_UNAVAILABLE", null, null, message);
					}
					else
					{
						int serverPid = (int)serverProcessId;
						knownServerPid = serverPid;
						EnterStage("scm-identity");
						ServiceIdentity serviceIdentity = QueryServiceIdentity(serviceName);
						knownServicePid = (int)serviceIdentity.Status.ProcessId;
						if (serviceIdentity.Status.CurrentState != 4 || serviceIdentity.Status.ProcessId == 0)
						{
							result = new PipeServerIdentityResult(Ok: false, "CORE_SERVICE_NOT_RUNNING", serverPid, (int)serviceIdentity.Status.ProcessId, "The SCM service is not running.");
						}
						else
						{
							int servicePid = (int)serviceIdentity.Status.ProcessId;
							if (serverPid != servicePid)
							{
								result = new PipeServerIdentityResult(Ok: false, "PIPE_SERVER_PID_MISMATCH", serverPid, servicePid, "The named-pipe server process does not match the SCM service process.");
							}
							else
							{
								EnterStage("executable");
								string fullPath = Path.GetFullPath(Environment.ProcessPath ?? throw new InvalidOperationException("Cannot resolve the Core verifier executable path."));
								string b = NormalizeServiceExecutable(serviceIdentity.BinaryPath);
								if (!string.Equals(fullPath, b, StringComparison.OrdinalIgnoreCase))
								{
									result = new PipeServerIdentityResult(Ok: false, "PIPE_SERVER_IMAGE_MISMATCH", serverPid, servicePid, "The SCM service image is not the installed Core executable.");
								}
								else
								{
									EnterStage("hello-write");
									await pipe.WriteAsync(bytes, deadline.Token);
									EnterStage("hello-flush");
									await pipe.FlushAsync(deadline.Token);
									using StreamReader reader = new StreamReader(pipe, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, 4096, leaveOpen: true);
									EnterStage("hello-read");
									string text = await reader.ReadLineAsync(deadline.Token);
									if (string.IsNullOrWhiteSpace(text))
									{
										result = new PipeServerIdentityResult(Ok: false, "HELLO_RESPONSE_MISSING", serverPid, servicePid, "Core did not answer the identity hello.");
									}
									else
									{
										EnterStage("hello-validate");
										using JsonDocument jsonDocument = JsonDocument.Parse(text);
										JsonElement rootElement = jsonDocument.RootElement;
										result = ((rootElement.TryGetProperty("ok", out var value) && value.GetBoolean() && rootElement.TryGetProperty("requestId", out var value2) && !(value2.GetString() != requestId)) ? new PipeServerIdentityResult(Ok: true, "VERIFIED", serverPid, servicePid) : new PipeServerIdentityResult(Ok: false, "HELLO_RESPONSE_INVALID", serverPid, servicePid, "Core returned an invalid identity hello."));
									}
								}
							}
						}
					}
				}
				return result;
			}
			catch (OperationCanceledException)
			{
				return new PipeServerIdentityResult(Ok: false, "PIPE_IDENTITY_TIMEOUT", knownServerPid, knownServicePid, $"Core identity verification timed out. {DescribeStage()}");
			}
			catch (Exception ex2)
			{
				string message = ex2.Message;
				return new PipeServerIdentityResult(Ok: false, "PIPE_IDENTITY_FAILED", knownServerPid, knownServicePid, $"{message} {DescribeStage()}");
			}
		}
	}

	private static ServiceIdentity QueryServiceIdentity(string serviceName)
	{
		nint num = OpenSCManager(null, null, 1u);
		if (num == IntPtr.Zero)
		{
			throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenSCManager failed.");
		}
		try
		{
			nint num2 = OpenService(num, serviceName, 5u);
			if (num2 == IntPtr.Zero)
			{
				throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenService failed.");
			}
			try
			{
				int num3 = Marshal.SizeOf<ServiceStatusProcess>();
				nint num4 = Marshal.AllocHGlobal(num3);
				try
				{
					if (!QueryServiceStatusEx(num2, 0, num4, num3, out var bytesNeeded))
					{
						throw new Win32Exception(Marshal.GetLastWin32Error(), "QueryServiceStatusEx failed.");
					}
					ServiceStatusProcess status = Marshal.PtrToStructure<ServiceStatusProcess>(num4);
					QueryServiceConfig(num2, IntPtr.Zero, 0, out var bytesNeeded2);
					int lastWin32Error = Marshal.GetLastWin32Error();
					if (bytesNeeded2 <= 0 || lastWin32Error != 122)
					{
						throw new Win32Exception(lastWin32Error, "QueryServiceConfig size probe failed.");
					}
					nint num5 = Marshal.AllocHGlobal(bytesNeeded2);
					try
					{
						if (!QueryServiceConfig(num2, num5, bytesNeeded2, out bytesNeeded))
						{
							throw new Win32Exception(Marshal.GetLastWin32Error(), "QueryServiceConfig failed.");
						}
						string text = Marshal.PtrToStringUni(Marshal.PtrToStructure<ServiceConfigNative>(num5).BinaryPathName) ?? string.Empty;
						if (string.IsNullOrWhiteSpace(text))
						{
							throw new InvalidOperationException("The SCM Core service image path is empty.");
						}
						return new ServiceIdentity(status, text);
					}
					finally
					{
						Marshal.FreeHGlobal(num5);
					}
				}
				finally
				{
					Marshal.FreeHGlobal(num4);
				}
			}
			finally
			{
				CloseServiceHandle(num2);
			}
		}
		finally
		{
			CloseServiceHandle(num);
		}
	}

	internal static string NormalizeServiceExecutable(string rawBinaryPath)
	{
		string text = Environment.ExpandEnvironmentVariables(rawBinaryPath).Trim();
		if (text.Length == 0)
		{
			throw new InvalidOperationException("The SCM Core service image path is empty.");
		}
		if (text[0] == '"')
		{
			int num = text.IndexOf('"', 1);
			if (num <= 1 || text.Substring(num + 1).Trim().Length != 0)
			{
				throw new InvalidOperationException("The SCM Core service image path contains unexpected arguments.");
			}
			text = text.Substring(1, num - 1);
		}
		return Path.GetFullPath(text);
	}
	[GeneratedCode("Microsoft.Interop.LibraryImportGenerator", "10.0.14.27113")]
	[SkipLocalsInit]
	[return: MarshalAs(UnmanagedType.Bool)]
	private unsafe static bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint serverProcessId)
	{
		serverProcessId = 0u;
		bool result = false;
		int num = 0;
		SafeHandleMarshaller<SafePipeHandle>.ManagedToUnmanagedIn managedToUnmanagedIn = default(SafeHandleMarshaller<SafePipeHandle>.ManagedToUnmanagedIn);
		int lastSystemError;
		try
		{
			managedToUnmanagedIn.FromManaged(pipe);
			fixed (uint* _serverProcessId_native = &serverProcessId)
			{
				nint _pipe_native = managedToUnmanagedIn.ToUnmanaged();
				Marshal.SetLastSystemError(0);
				num = __PInvoke(_pipe_native, _serverProcessId_native);
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
		[DllImport("kernel32.dll", EntryPoint = "GetNamedPipeServerProcessId", ExactSpelling = true)]
		unsafe static extern int __PInvoke(nint __pipe_native, uint* __serverProcessId_native);
	}
	[GeneratedCode("Microsoft.Interop.LibraryImportGenerator", "10.0.14.27113")]
	[SkipLocalsInit]
	private unsafe static nint OpenSCManager(string? machineName, string? databaseName, uint desiredAccess)
	{
		nint result;
		int lastSystemError;
		fixed (char* ptr = &Utf16StringMarshaller.GetPinnableReference(databaseName))
		{
			void* _databaseName_native = ptr;
			fixed (char* ptr2 = &Utf16StringMarshaller.GetPinnableReference(machineName))
			{
				void* _machineName_native = ptr2;
				Marshal.SetLastSystemError(0);
				result = __PInvoke((ushort*)_machineName_native, (ushort*)_databaseName_native, desiredAccess);
				lastSystemError = Marshal.GetLastSystemError();
			}
		}
		Marshal.SetLastPInvokeError(lastSystemError);
		return result;
		[DllImport("advapi32.dll", EntryPoint = "OpenSCManagerW", ExactSpelling = true)]
		unsafe static extern nint __PInvoke(ushort* __machineName_native, ushort* __databaseName_native, uint __desiredAccess_native);
	}
	[GeneratedCode("Microsoft.Interop.LibraryImportGenerator", "10.0.14.27113")]
	[SkipLocalsInit]
	private unsafe static nint OpenService(nint manager, string serviceName, uint desiredAccess)
	{
		nint result;
		int lastSystemError;
		fixed (char* ptr = &Utf16StringMarshaller.GetPinnableReference(serviceName))
		{
			void* _serviceName_native = ptr;
			Marshal.SetLastSystemError(0);
			result = __PInvoke(manager, (ushort*)_serviceName_native, desiredAccess);
			lastSystemError = Marshal.GetLastSystemError();
		}
		Marshal.SetLastPInvokeError(lastSystemError);
		return result;
		[DllImport("advapi32.dll", EntryPoint = "OpenServiceW", ExactSpelling = true)]
		unsafe static extern nint __PInvoke(nint __manager_native, ushort* __serviceName_native, uint __desiredAccess_native);
	}
	[GeneratedCode("Microsoft.Interop.LibraryImportGenerator", "10.0.14.27113")]
	[SkipLocalsInit]
	[return: MarshalAs(UnmanagedType.Bool)]
	private unsafe static bool QueryServiceStatusEx(nint service, int infoLevel, nint buffer, int bufferSize, out int bytesNeeded)
	{
		bytesNeeded = 0;
		int num;
		int lastSystemError;
		fixed (int* _bytesNeeded_native = &bytesNeeded)
		{
			Marshal.SetLastSystemError(0);
			num = __PInvoke(service, infoLevel, buffer, bufferSize, _bytesNeeded_native);
			lastSystemError = Marshal.GetLastSystemError();
		}
		bool result = num != 0;
		Marshal.SetLastPInvokeError(lastSystemError);
		return result;
		[DllImport("advapi32.dll", EntryPoint = "QueryServiceStatusEx", ExactSpelling = true)]
		unsafe static extern int __PInvoke(nint __service_native, int __infoLevel_native, nint __buffer_native, int __bufferSize_native, int* __bytesNeeded_native);
	}
	[GeneratedCode("Microsoft.Interop.LibraryImportGenerator", "10.0.14.27113")]
	[SkipLocalsInit]
	[return: MarshalAs(UnmanagedType.Bool)]
	private unsafe static bool QueryServiceConfig(nint service, nint serviceConfig, int bufferSize, out int bytesNeeded)
	{
		bytesNeeded = 0;
		int num;
		int lastSystemError;
		fixed (int* _bytesNeeded_native = &bytesNeeded)
		{
			Marshal.SetLastSystemError(0);
			num = __PInvoke(service, serviceConfig, bufferSize, _bytesNeeded_native);
			lastSystemError = Marshal.GetLastSystemError();
		}
		bool result = num != 0;
		Marshal.SetLastPInvokeError(lastSystemError);
		return result;
		[DllImport("advapi32.dll", EntryPoint = "QueryServiceConfigW", ExactSpelling = true)]
		unsafe static extern int __PInvoke(nint __service_native, nint __serviceConfig_native, int __bufferSize_native, int* __bytesNeeded_native);
	}
	[GeneratedCode("Microsoft.Interop.LibraryImportGenerator", "10.0.14.27113")]
	[SkipLocalsInit]
	[return: MarshalAs(UnmanagedType.Bool)]
	private static bool CloseServiceHandle(nint handle)
	{
		return __PInvoke(handle) != 0;
		[DllImport("advapi32.dll", EntryPoint = "CloseServiceHandle", ExactSpelling = true)]
		static extern int __PInvoke(nint __handle_native);
	}
}
