using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal sealed class PipeServer
{
	private sealed class RequestTooLargeException : Exception
	{
		public RequestTooLargeException(string message)
			: base(message)
		{
		}
	}

	private readonly ServiceOptions _options;

	private readonly Func<NamedPipeServerStream, ClientIdentity> _authorizeClient;

	private readonly OperationDispatcher _dispatcher;

	private readonly ServiceLog _log;

	public PipeServer(ServiceOptions options, ClientAuthorizer authorizer, OperationDispatcher dispatcher, ServiceLog log)
		: this(options, authorizer.Authorize, dispatcher, log)
	{
	}

	internal PipeServer(ServiceOptions options, Func<NamedPipeServerStream, ClientIdentity> authorizeClient, OperationDispatcher dispatcher, ServiceLog log)
	{
		_options = options;
		_authorizeClient = authorizeClient;
		_dispatcher = dispatcher;
		_log = log;
	}

	public async Task RunAsync(CancellationToken cancellationToken)
	{
		List<Task> clients = new List<Task>();
		using SemaphoreSlim clientSlots = new SemaphoreSlim(8, 8);
		while (!cancellationToken.IsCancellationRequested)
		{
			try
			{
				await clientSlots.WaitAsync(cancellationToken);
			}
			catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
			{
				break;
			}
			NamedPipeServerStream pipe = null;
			try
			{
				pipe = CreatePipe();
				await pipe.WaitForConnectionAsync(cancellationToken);
				clients.RemoveAll((Task task) => task.IsCompleted);
				NamedPipeServerStream connectedPipe = pipe;
				clients.Add(Task.Run(() => HandleClientAsync(connectedPipe, clientSlots, cancellationToken), CancellationToken.None));
			}
			catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
			{
				if (pipe != null)
				{
					await pipe.DisposeAsync();
				}
				clientSlots.Release();
				break;
			}
			catch (Exception ex2)
			{
				if (pipe != null)
				{
					await pipe.DisposeAsync();
				}
				clientSlots.Release();
				await _log.WarnAsync("Pipe accept loop recovered from " + ex2.GetType().Name + ": " + ex2.Message, CancellationToken.None);
				try
				{
					await Task.Delay(TimeSpan.FromMilliseconds(250L), cancellationToken);
				}
				catch (OperationCanceledException)
				{
					break;
				}
			}
		}
		try
		{
			await Task.WhenAll(clients);
		}
		catch (Exception ex4)
		{
			await _log.WarnAsync("Pipe client tasks completed with errors: " + ex4.Message, CancellationToken.None);
		}
	}

	private async Task HandleClientAsync(NamedPipeServerStream pipe, SemaphoreSlim clientSlots, CancellationToken serviceCancellationToken)
	{
		_ = 11;
		try
		{
			await using (pipe)
			{
				string requestId = "invalid";
				try
				{
					ClientIdentity identity = _authorizeClient(pipe);
					byte[] bytes;
					using (CancellationTokenSource inputDeadline = CancellationTokenSource.CreateLinkedTokenSource(serviceCancellationToken))
					{
						inputDeadline.CancelAfter(ServiceContract.ClientIoTimeout);
						try
						{
							bytes = await ReadRequestAsync(pipe, inputDeadline.Token);
						}
						catch (OperationCanceledException) when (!serviceCancellationToken.IsCancellationRequested)
						{
							await TryWriteFailureAsync(pipe, requestId, "REQUEST_TIMEOUT", "The client did not send a complete request before the deadline.", serviceCancellationToken);
							goto end_IL_0097;
						}
					}
					ServiceRequest serviceRequest = ParseAndValidateRequest(bytes);
					requestId = serviceRequest.RequestId;
					ServiceResponse serviceResponse = ((serviceRequest.ProtocolVersion != 1) ? ServiceResponse.Failure(serviceRequest.RequestId, 0L, "PROTOCOL_MISMATCH", $"Service supports protocol {1}; client sent {serviceRequest.ProtocolVersion}.") : (await _dispatcher.DispatchAsync(serviceRequest, identity, serviceCancellationToken)));
					ServiceResponse response = serviceResponse;
					await WriteResponseWithDeadlineAsync(pipe, response, serviceCancellationToken);
					goto end_IL_006e;
					end_IL_0097:;
				}
				catch (UnauthorizedAccessException ex2)
				{
					await _log.WarnAsync("Rejected pipe client: " + ex2.Message, serviceCancellationToken);
					await TryWriteFailureAsync(pipe, requestId, "CLIENT_NOT_AUTHORIZED", ex2.Message, serviceCancellationToken);
					goto end_IL_006e;
				}
				catch (RequestTooLargeException ex3)
				{
					await TryWriteFailureAsync(pipe, requestId, "REQUEST_TOO_LARGE", ex3.Message, serviceCancellationToken);
					goto end_IL_006e;
				}
				catch (JsonException ex4)
				{
					await TryWriteFailureAsync(pipe, requestId, "INVALID_JSON", ex4.Message, serviceCancellationToken);
					goto end_IL_006e;
				}
				catch (ArgumentException ex5)
				{
					await TryWriteFailureAsync(pipe, requestId, "INVALID_REQUEST", ex5.Message, serviceCancellationToken);
					goto end_IL_006e;
				}
				catch (OperationCanceledException) when (serviceCancellationToken.IsCancellationRequested)
				{
					goto end_IL_006e;
				}
				catch (OperationCanceledException)
				{
					goto end_IL_006e;
				}
				catch (IOException)
				{
					goto end_IL_006e;
				}
				catch (Exception ex9)
				{
					await _log.ErrorAsync("Pipe request failed: " + ex9.GetType().Name + ": " + ex9.Message, serviceCancellationToken);
					await TryWriteFailureAsync(pipe, requestId, "INTERNAL_ERROR", "The service could not process this request.", serviceCancellationToken);
					goto end_IL_006e;
				}
				return;
				end_IL_006e:;
			}
		}
		finally
		{
			clientSlots.Release();
		}
	}

	internal static ServiceRequest ParseAndValidateRequest(ReadOnlySpan<byte> bytes)
	{
		ServiceRequest serviceRequest = JsonSerializer.Deserialize<ServiceRequest>(bytes, JsonDefaults.Options) ?? throw new JsonException("Request body is empty.");
		if (string.IsNullOrWhiteSpace(serviceRequest.RequestId) || serviceRequest.RequestId.Length > 128)
		{
			throw new ArgumentException("requestId is missing or too long.");
		}
		if (serviceRequest.RequestId.Any(delegate(char value)
		{
			bool flag = char.IsAsciiLetterOrDigit(value);
			if (!flag)
			{
				bool flag2;
				switch (value)
				{
				case '-':
				case '.':
				case ':':
				case '_':
					flag2 = true;
					break;
				default:
					flag2 = false;
					break;
				}
				flag = flag2;
			}
			return !flag;
		}))
		{
			throw new ArgumentException("requestId contains unsupported characters.");
		}
		if (string.IsNullOrWhiteSpace(serviceRequest.Operation) || serviceRequest.Operation.Length > 80)
		{
			throw new ArgumentException("operation is missing or too long.");
		}
		if (serviceRequest.Payload.ValueKind != JsonValueKind.Object)
		{
			throw new ArgumentException("payload must be a JSON object.");
		}
		return serviceRequest;
	}

	private NamedPipeServerStream CreatePipe()
	{
		PipeSecurity pipeSecurity = new PipeSecurity();
		pipeSecurity.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
		pipeSecurity.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
		pipeSecurity.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
		pipeSecurity.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));
		using WindowsIdentity windowsIdentity = WindowsIdentity.GetCurrent();
		SecurityIdentifier user = windowsIdentity.User;
		if ((object)user != null)
		{
			pipeSecurity.AddAccessRule(new PipeAccessRule(user, PipeAccessRights.FullControl, AccessControlType.Allow));
		}
		return NamedPipeServerStreamAcl.Create(_options.PipeName, PipeDirection.InOut, 8, PipeTransmissionMode.Byte, PipeOptions.WriteThrough | PipeOptions.Asynchronous, 16384, 16384, pipeSecurity);
	}

	private static async Task<byte[]> ReadRequestAsync(PipeStream pipe, CancellationToken cancellationToken)
	{
		using MemoryStream buffer = new MemoryStream();
		byte[] chunk = new byte[4096];
		int num2;
		do
		{
			int num = await pipe.ReadAsync(chunk, cancellationToken);
			if (num == 0)
			{
				break;
			}
			num2 = Array.IndexOf(chunk, (byte)10, 0, num);
			int num3 = ((num2 >= 0) ? num2 : num);
			if (buffer.Length + num3 > 65536)
			{
				throw new RequestTooLargeException($"Request exceeds {65536} bytes.");
			}
			buffer.Write(chunk, 0, num3);
		}
		while (num2 < 0);
		if (buffer.Length == 0L)
		{
			throw new JsonException("Request body is empty.");
		}
		return buffer.ToArray();
	}

	private static async Task WriteResponseAsync(PipeStream pipe, ServiceResponse response, CancellationToken cancellationToken)
	{
		byte[] bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(response, JsonDefaults.Options) + "\n");
		await pipe.WriteAsync(bytes, cancellationToken);
		await pipe.FlushAsync(cancellationToken);
	}

	private static async Task WriteResponseWithDeadlineAsync(PipeStream pipe, ServiceResponse response, CancellationToken serviceCancellationToken)
	{
		using CancellationTokenSource outputDeadline = CancellationTokenSource.CreateLinkedTokenSource(serviceCancellationToken);
		outputDeadline.CancelAfter(ServiceContract.ClientIoTimeout);
		await WriteResponseAsync(pipe, response, outputDeadline.Token);
	}

	private static async Task TryWriteFailureAsync(PipeStream pipe, string requestId, string code, string message, CancellationToken cancellationToken)
	{
		if (!pipe.IsConnected)
		{
			return;
		}
		try
		{
			await WriteResponseWithDeadlineAsync(pipe, ServiceResponse.Failure(requestId, 0L, code, message), cancellationToken);
		}
		catch
		{
		}
	}
}
