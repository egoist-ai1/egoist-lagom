using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal static class SelfTest
{
	public static async Task RunAsync()
	{
		string root = Path.Combine(Path.GetTempPath(), "EgoistShield.Service.SelfTest", Guid.NewGuid().ToString("N"));
		Directory.CreateDirectory(root);
		bool testFailed = false;
		try
		{
			VerifyOwnedDnsBaselines();
			Assert(WindowsDnsController.ValidateServers(new global::_003C_003Ez__ReadOnlyArray<string>(new string[2] { "1.1.1.1", "2606:4700:4700::1111" })).Length == 2, "DNS validation");
			Expect<ArgumentException>(delegate
			{
				WindowsDnsController.ValidateServers(new _003C_003Ez__ReadOnlySingleElementList<string>("not-an-ip"));
			}, "invalid DNS rejected");
			Assert(WindowsDnsController.ValidateProbeHosts(new global::_003C_003Ez__ReadOnlyArray<string>(new string[2] { "api.openai.com", "API.OPENAI.COM." })).Length == 1, "DNS probe hosts normalized and deduplicated");
			Expect<ArgumentException>(delegate
			{
				WindowsDnsController.ValidateProbeHosts(new _003C_003Ez__ReadOnlySingleElementList<string>("not a host"));
			}, "invalid DNS probe host rejected");
			string text = WindowsNativeDohController.ValidateUrl("https://cloudflare-dns.com/dns-query");
			Assert(text == "https://cloudflare-dns.com/dns-query", "native DoH URL validation");
			Expect<ArgumentException>(delegate
			{
				WindowsNativeDohController.ValidateUrl("http://cloudflare-dns.com/dns-query");
			}, "plaintext native DoH URL rejected");
			Assert(OwnedServiceController.NormalizeZapretProfileName("general (ALT12)") == "general (ALT12)", "official Flowseal profile name with parentheses accepted");
			Expect<ArgumentException>(delegate
			{
				OwnedServiceController.NormalizeZapretProfileName("general & whoami");
			}, "unsafe Zapret profile metacharacters rejected");
			NativeDohOwnedState state = new NativeDohOwnedState(1, "EgoistShield", text, new string[1] { "1.1.1.1" }, DateTimeOffset.UtcNow, new NativeDohEntrySnapshot[1]
			{
				new NativeDohEntrySnapshot("1.1.1.1", Existed: false, null, AllowFallbackToUdp: false, AutoUpgrade: false)
			}, new DnsAdapterSnapshot[1]
			{
				new DnsAdapterSnapshot(7, "Ethernet", "self-test-guid", new string[1] { "192.0.2.1" }, Array.Empty<string>(), Ipv4Static: false, Ipv6Static: false)
			});
			Assert(WindowsNativeDohController.EntriesMatch(new _003C_003Ez__ReadOnlySingleElementList<NativeDohEntrySnapshot>(new NativeDohEntrySnapshot("1.1.1.1", Existed: true, text, AllowFallbackToUdp: false, AutoUpgrade: true)), state), "native DoH entry requires encrypted no-fallback readback");
			Assert(!WindowsNativeDohController.EntriesMatch(new _003C_003Ez__ReadOnlySingleElementList<NativeDohEntrySnapshot>(new NativeDohEntrySnapshot("1.1.1.1", Existed: true, text, AllowFallbackToUdp: true, AutoUpgrade: true)), state), "native DoH rejects plaintext UDP fallback");
			DnsAdapterSnapshot dnsAdapterSnapshot = new DnsAdapterSnapshot(17, "Ethernet", "{11111111-1111-1111-1111-111111111111}", new string[1] { "192.0.2.53" }, Array.Empty<string>(), Ipv4Static: false, Ipv6Static: false);
			DnsAdapterSnapshot dnsAdapterSnapshot2 = new DnsAdapterSnapshot(52, "vEthernet (Default Switch)", "{22222222-2222-2222-2222-222222222222}", Array.Empty<string>(), Array.Empty<string>(), Ipv4Static: false, Ipv6Static: false);
			DnsAdapterSnapshot dnsAdapterSnapshot3 = dnsAdapterSnapshot2 with
			{
				InterfaceGuid = "{33333333-3333-3333-3333-333333333333}"
			};
			DnsAdapterSnapshot[] array = WindowsDnsController.IntersectByStableIdentity(new global::_003C_003Ez__ReadOnlyArray<DnsAdapterSnapshot>(new DnsAdapterSnapshot[2] { dnsAdapterSnapshot, dnsAdapterSnapshot2 }), new global::_003C_003Ez__ReadOnlyArray<DnsAdapterSnapshot>(new DnsAdapterSnapshot[2] { dnsAdapterSnapshot, dnsAdapterSnapshot3 }));
			Assert(array.Length == 1 && array[0].InterfaceGuid == dnsAdapterSnapshot.InterfaceGuid, "disappeared DNS adapter is skipped without index fallback");
			if (WindowsNativeDohController.IsSupported)
			{
				NativeDohEntrySnapshot[] source = await new WindowsNativeDohController(root).ReadEntriesAsync(new global::_003C_003Ez__ReadOnlyArray<string>(new string[2] { "1.1.1.1", "1.0.0.1" }));
				Assert(source.Select((NativeDohEntrySnapshot entry) => entry.ServerAddress).Order<string>(StringComparer.OrdinalIgnoreCase).SequenceEqual<string>(new string[2] { "1.0.0.1", "1.1.1.1" }, StringComparer.OrdinalIgnoreCase), "native DoH readback returns every requested resolver address (" + string.Join(",", source.Select((NativeDohEntrySnapshot entry) => entry.ServerAddress)) + ")");
			}
			else
			{
				Console.WriteLine("SKIP: native Windows DoH readback is unavailable on this OS; System DoH component integration is tested separately.");
			}
			Expect<InvalidOperationException>(delegate
			{
				ClientAuthorizer.EnsureProgramFilesRoot(root);
			}, "non-ProgramFiles install root rejected");
			string identityPath = Path.GetFullPath(Path.Combine(root, "Core Service.exe"));
			Assert(PipeServerIdentityVerifier.NormalizeServiceExecutable("\"" + identityPath + "\"") == identityPath, "quoted SCM identity path normalized");
			Assert(PipeServerIdentityVerifier.NormalizeServiceExecutable(identityPath) == identityPath, "unquoted SCM identity path normalized");
			Expect<InvalidOperationException>(delegate
			{
				PipeServerIdentityVerifier.NormalizeServiceExecutable("\"" + identityPath + "\" --unexpected");
			}, "SCM identity path arguments rejected");
			Assert(PipeServer.ParseAndValidateRequest(Encoding.UTF8.GetBytes("{\"protocolVersion\":1,\"requestId\":\"self-test:1\",\"operation\":\"hello\",\"payload\":{}}")).Operation == "hello", "protocol parser");
			Expect<ArgumentException>(delegate
			{
				PipeServer.ParseAndValidateRequest(Encoding.UTF8.GetBytes("{\"protocolVersion\":1,\"requestId\":\"bad id\",\"operation\":\"hello\",\"payload\":{}}"));
			}, "unsafe requestId rejected");
			await VerifyPipeAcceptDuringAuthorizationAsync(root);
			await VerifyComponentWorkerResponsesAsync(root);
			await VerifyInstallerMaintenanceAsync(root);
			await VerifyRecoveryStartupPolicyAsync(root);
			await VerifyTypedPersistenceAsync(root);
			TransactionJournal journal = new TransactionJournal(root);
			DateTimeOffset utcNow = DateTimeOffset.UtcNow;
			ActiveTransaction transaction = new ActiveTransaction(1, "EgoistShield", "self-test-transaction", "self-test:2", "dns", "dns.apply", TransactionPhase.Prepared, JsonDefaults.ToElement(Array.Empty<DnsAdapterSnapshot>()), JsonDefaults.ToElement(new
			{
				servers = new string[1] { "1.1.1.1" }
			}), utcNow, utcNow, null);
			await journal.CreateActiveAsync(transaction);
			Assert((await journal.ReadActiveAsync())?.TransactionId == transaction.TransactionId, "atomic journal read/write");
			await ExpectAsync<InvalidOperationException>(() => journal.CreateActiveAsync(transaction with
			{
				TransactionId = "must-not-overwrite-active"
			}), "active marker is create-new and cannot be overwritten");
			Assert((await journal.ReadActiveAsync())?.TransactionId == transaction.TransactionId, "failed create-new preserves the recovery snapshot");
			await journal.CompleteAsync(transaction, TransactionPhase.RolledBack, "self-test");
			ActiveTransaction activeTransaction = (await journal.ReadActiveAsync()) ?? throw new InvalidOperationException("Self-test terminal marker disappeared.");
			Assert(activeTransaction.Phase == TransactionPhase.RolledBack, "terminal marker remains durable before response/archive");
			await journal.ArchiveTerminalAsync(activeTransaction);
			Assert((object)(await journal.ReadActiveAsync()) == null, "terminal marker archives explicitly");
			ServiceOptions options = new ServiceOptions("EgoistShield.Service.SelfTest", root, ConsoleMode: true, AllowDevClient: true, null);
			ServiceLog log = new ServiceLog(root);
			ClientIdentity identity = new ClientIdentity(Environment.ProcessId, Environment.ProcessPath ?? "self-test", DevelopmentOverride: true, "S-1-5-21-1-2-3-1001");
			OperationDispatcher dispatcher = new OperationDispatcher(options, new WindowsDnsController(), new WindowsNativeDohController(root), null, journal, log);
			string[] retiredSystemOperations = new string[5]
			{
				"system-control.status",
				"system-control.preview",
				"system-control.get-job",
				"system-control.start",
				"system-control.cancel"
			};
			foreach (string operation in retiredSystemOperations)
			{
				ServiceResponse retiredResponse = await dispatcher.DispatchAsync(new ServiceRequest(1, "self-test:retired:" + operation, operation, JsonDefaults.ToElement(new { })), identity);
				Assert(!retiredResponse.Ok && retiredResponse.Error?.Code == "UNKNOWN_OPERATION", "retired System Control operation rejected: " + operation);
			}
			ServiceRequest mutationRequest = new ServiceRequest(1, "self-test:persisted-idempotency", "test.delay-mutation", JsonDefaults.ToElement(new
			{
				delayMs = 1
			}));
			ServiceResponse firstResponse = await dispatcher.DispatchAsync(mutationRequest, identity);
			Assert(firstResponse.Ok, "test mutation response");
			OperationDispatcher restartedDispatcher = new OperationDispatcher(options, new WindowsDnsController(), new WindowsNativeDohController(root), null, journal, log);
			ServiceResponse value2 = await restartedDispatcher.DispatchAsync(mutationRequest, identity);
			string text2 = JsonSerializer.Serialize(firstResponse, JsonDefaults.Options);
			string text3 = JsonSerializer.Serialize(value2, JsonDefaults.Options);
			using JsonDocument firstDocument = JsonDocument.Parse(text2);
			using JsonDocument replayedDocument = JsonDocument.Parse(text3);
			Assert(JsonElement.DeepEquals(firstDocument.RootElement, replayedDocument.RootElement), $"persisted idempotency response survives dispatcher restart ({text2} != {text3})");
			ActiveTransaction recoveryRequired = transaction with
			{
				TransactionId = "self-test-recovery-required",
				RequestId = "self-test:interrupted-original",
				Phase = TransactionPhase.RecoveryRequired,
				Original = JsonDefaults.ToElement(Array.Empty<DnsAdapterSnapshot>()),
				Desired = JsonDefaults.ToElement(new
				{
					servers = new string[1] { "1.1.1.1" }
				}),
				RequestFingerprint = "SELFTEST-INTERRUPTED",
				ResponseSequence = 100L,
				UpdatedAt = DateTimeOffset.UtcNow
			};
			await journal.CreateActiveAsync(recoveryRequired);
			Assert((await restartedDispatcher.DispatchAsync(mutationRequest with
			{
				RequestId = "self-test:blocked-by-recovery"
			}, identity)).Error?.Code == "RECOVERY_REQUIRED", "unfinished recovery blocks every new mutation");
			Assert((await journal.ReadActiveAsync())?.TransactionId == recoveryRequired.TransactionId, "blocked mutation cannot overwrite recovery snapshot");
			Assert((await restartedDispatcher.DispatchAsync(new ServiceRequest(1, "self-test:repair-owned", "network.repair-owned", JsonDefaults.ToElement(new { })), identity)).Ok, "owned repair is allowed while recovery is required");
			Assert((object)(await journal.ReadActiveAsync()) == null, "owned repair archives recovered marker");
			ServiceResponse serviceResponse = ServiceResponse.Success("self-test:verified-marker", 101L, new
			{
				completed = true
			});
			ActiveTransaction verifiedMarker = transaction with
			{
				TransactionId = "self-test-verified-marker",
				RequestId = serviceResponse.RequestId,
				Resource = "test",
				Operation = "test.delay-mutation",
				Phase = TransactionPhase.Verified,
				Verified = JsonDefaults.ToElement(new
				{
					completed = true
				}),
				RequestFingerprint = "SELFTEST-VERIFIED",
				ResponseSequence = serviceResponse.Sequence,
				TerminalResponse = serviceResponse,
				UpdatedAt = DateTimeOffset.UtcNow
			};
			await journal.CreateActiveAsync(verifiedMarker);
			await restartedDispatcher.RecoverOnStartupAsync();
			Assert((object)(await journal.ReadActiveAsync()) == null, "verified response is committed and archived without replay");
			Assert((await journal.ReadResponseAsync(verifiedMarker.RequestId))?.Response.Ok ?? false, "verified crash marker restores durable idempotency response");
			ActiveTransaction transaction2 = transaction with
			{
				TransactionId = "self-test-committed-marker",
				RequestId = "self-test:committed-marker",
				Phase = TransactionPhase.Committed,
				UpdatedAt = DateTimeOffset.UtcNow
			};
			await journal.WriteActiveAsync(transaction2);
			await restartedDispatcher.RecoverOnStartupAsync();
			Assert((object)(await journal.ReadActiveAsync()) == null, "committed crash marker is archived without rollback");
			string text4 = await File.ReadAllTextAsync(Path.Combine(root, "transactions.jsonl"));
			Assert(text4.Contains("\"transactionId\":\"self-test-committed-marker\"", StringComparison.Ordinal) && text4.Contains("\"phase\":\"committed\"", StringComparison.Ordinal), "terminal crash marker keeps committed outcome");
			Console.WriteLine($"EgoistShield.Service self-test passed; protocol={1}; version={BuildInfo.Version}");
		}
		catch
		{
			testFailed = true;
			throw;
		}
		finally
		{
			if (testFailed)
				Console.Error.WriteLine("Self-test artifacts preserved: " + root);
			else
				Directory.Delete(root, recursive: true);
		}
	}

	private static async Task VerifyTypedPersistenceAsync(string root)
	{
		string stateRoot = Path.Combine(root, "typed-persistence");
		Directory.CreateDirectory(stateRoot);
		string path = Path.Combine(stateRoot, "probe.json");
		Assert((await AtomicJsonFile.ReadResultAsync<JsonElement>(path)).Kind == AtomicJsonReadKind.Missing, "stable absent file is typed missing");
		await File.WriteAllTextAsync(path, "{\"unfinished\":");
		var corrupt = await AtomicJsonFile.ReadResultAsync<JsonElement>(path);
		Assert(corrupt.Kind == AtomicJsonReadKind.Corrupt && corrupt.Sha256 != null, "corrupt file is preserved with a diagnostic hash");
		using (var held = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None))
			Assert((await AtomicJsonFile.ReadResultAsync<JsonElement>(path)).Kind == AtomicJsonReadKind.Unavailable, "sharing denial cannot become missing");
		await AtomicJsonFile.WriteAsync(path, new { verified = true });
		Assert((await AtomicJsonFile.ReadResultAsync<JsonElement>(path)).Kind == AtomicJsonReadKind.Valid, "valid file is typed valid");
		var journal = new TransactionJournal(stateRoot);
		await journal.RecordResponseAsync("self-test:seed", "seed", ServiceResponse.Success("self-test:seed", 1, new { }));
		var options = new ServiceOptions("unused-persistence-self-test", stateRoot, true, true, null);
		var identity = new ClientIdentity(Environment.ProcessId, Environment.ProcessPath ?? "self-test", true, "self-test");
		int executions = 0;
		FileStream? denyResponse = null;
		Task<JsonElement> Execute(JsonElement payload, bool query, CancellationToken token)
		{
			if (!query)
			{
				executions++;
				Assert(File.Exists(Path.Combine(stateRoot, "operation-intents.json")), "durable intent exists before component execution");
				Assert(payload.GetProperty("requestId").GetString() == "self-test:component-persistence", "Core request identity reaches the executor");
				denyResponse = new FileStream(Path.Combine(stateRoot, "idempotency-responses.json"), FileMode.Open, FileAccess.Read, FileShare.None);
			}
			return Task.FromResult(JsonDefaults.ToElement(new { running = true }));
		}
		using var dispatcher = new OperationDispatcher(options, new WindowsDnsController(), new WindowsNativeDohController(stateRoot), null,
			journal, new ServiceLog(stateRoot), Execute);
		var request = new ServiceRequest(1, "self-test:component-persistence", "component.execute",
			JsonDefaults.ToElement(new { component = "Zapret", method = "startService", args = Array.Empty<object>() }));
		try
		{
			var first = await dispatcher.DispatchAsync(request, identity);
			Assert(first.Error?.Code == "OPERATION_OUTCOME_UNKNOWN" && executions == 1, "response persistence failure retains intent instead of replay permission");
		}
		finally { denyResponse?.Dispose(); }
		using var restarted = new OperationDispatcher(options, new WindowsDnsController(), new WindowsNativeDohController(stateRoot), null,
			new TransactionJournal(stateRoot), new ServiceLog(stateRoot), Execute);
		var second = await restarted.DispatchAsync(request, identity);
		Assert(second.Ok && executions == 1, "recorded terminal intent commits after restart without re-execution");
		var mismatch = await restarted.DispatchAsync(request with { Payload = JsonDefaults.ToElement(new { component = "Zapret", method = "stopService", args = Array.Empty<object>() }) }, identity);
		Assert(mismatch.Error?.Code == "REQUEST_ID_REUSED" && executions == 1, "durable request fingerprint refuses changed payload");
		await File.WriteAllTextAsync(Path.Combine(stateRoot, "active-transaction.json"), "{\"schemaVersion\":1,\"owner\":\"EgoistShield\",\"truncated\":");
		await restarted.RecoverOnStartupAsync();
		var health = await restarted.DispatchAsync(new ServiceRequest(1, "self-test:corrupt-health", "service.status", JsonDefaults.ToElement(new { })), identity);
		Assert(health.Ok && !JsonDefaults.ToElement(health.Result).GetProperty("persistence").GetProperty("mutationReady").GetBoolean(), "degraded diagnostic health stays available");
		var mutation = await restarted.DispatchAsync(request with { RequestId = "self-test:corrupt-block" }, identity);
		Assert(mutation.Error?.Code == "STATE_CORRUPT" && executions == 1, "corrupt journal blocks component mutation");
		TimeSpan elapsed = TimeSpan.Zero;
		int routeReads = 0;
		bool routeAvailable = true;
		var routes = new WindowsNativeDohController(stateRoot, (script, token) =>
		{
			routeReads++;
			return Task.FromResult(new ProcessResult(0, routeAvailable ? "true" : "false", ""));
		}, () => elapsed);
		Assert(await routes.HasIpv6DefaultRouteAsync(default), "initial monotonic route observation");
		routeAvailable = false;
		elapsed = TimeSpan.FromSeconds(30);
		Assert(!await routes.HasIpv6DefaultRouteAsync(default) && routeReads == 2, "native route evidence expires by elapsed time");
		routeAvailable = true;
		elapsed = TimeSpan.FromSeconds(5);
		Assert(await routes.HasIpv6DefaultRouteAsync(default) && routeReads == 3, "future elapsed cache timestamp is invalidated");
		Console.WriteLine("Core typed persistence and durable component-intent self-test passed.");
	}

	private static void Assert(bool condition, string name)
	{
		if (!condition)
		{
			throw new InvalidOperationException("Self-test failed: " + name + ".");
		}
	}

	private static void Expect<TException>(Action action, string name) where TException : Exception
	{
		try
		{
			action();
		}
		catch (TException)
		{
			return;
		}
		throw new InvalidOperationException("Self-test failed: " + name + ".");
	}

	private static async Task ExpectAsync<TException>(Func<Task> action, string name) where TException : Exception
	{
		try
		{
			await action();
		}
		catch (TException)
		{
			return;
		}
		throw new InvalidOperationException("Self-test failed: " + name + ".");
	}

	private static async Task VerifyPipeAcceptDuringAuthorizationAsync(string root)
	{
		string pipeName = "EgoistShield.Service.SelfTest." + Guid.NewGuid().ToString("N");
		string fixtureRoot = Path.Combine(root, "pipe-accept");
		ServiceOptions options = new ServiceOptions(pipeName, fixtureRoot, ConsoleMode: true, AllowDevClient: true, null);
		ServiceLog log = new ServiceLog(fixtureRoot);
		TransactionJournal journal = new TransactionJournal(fixtureRoot);
		OperationDispatcher dispatcher = new OperationDispatcher(options, new WindowsDnsController(), new WindowsNativeDohController(fixtureRoot), null, journal, log);
		ClientIdentity identity = new ClientIdentity(Environment.ProcessId, Environment.ProcessPath ?? "self-test", DevelopmentOverride: true, "S-1-5-21-1-2-3-1001");
		TaskCompletionSource<bool> firstAuthorizationStarted = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
		using ManualResetEventSlim releaseFirstAuthorization = new ManualResetEventSlim(initialState: false);
		int authorizationCount = 0;
		ClientIdentity Authorize(NamedPipeServerStream _)
		{
			if (Interlocked.Increment(ref authorizationCount) == 1)
			{
				firstAuthorizationStarted.TrySetResult(true);
				releaseFirstAuthorization.Wait();
			}
			return identity;
		}

		using CancellationTokenSource serviceCancellation = new CancellationTokenSource();
		Task serverTask = new PipeServer(options, Authorize, dispatcher, log).RunAsync(serviceCancellation.Token);
		try
		{
			await using NamedPipeClientStream firstClient = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.WriteThrough | PipeOptions.Asynchronous);
			using CancellationTokenSource deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
			await firstClient.ConnectAsync(deadline.Token);
			await firstAuthorizationStarted.Task.WaitAsync(deadline.Token);

			await using NamedPipeClientStream secondClient = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.WriteThrough | PipeOptions.Asynchronous);
			await secondClient.ConnectAsync(deadline.Token);
			string requestId = "self-test:pipe-accept";
			byte[] request = Encoding.UTF8.GetBytes("{\"protocolVersion\":1,\"requestId\":\"" + requestId + "\",\"operation\":\"hello\",\"payload\":{}}\n");
			await secondClient.WriteAsync(request, deadline.Token);
			await secondClient.FlushAsync(deadline.Token);
			using StreamReader reader = new StreamReader(secondClient, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
			string responseText = await reader.ReadLineAsync(deadline.Token) ?? throw new InvalidOperationException("Self-test failed: second pipe client received no hello response.");
			ServiceResponse response = JsonSerializer.Deserialize<ServiceResponse>(responseText, JsonDefaults.Options) ?? throw new InvalidOperationException("Self-test failed: second pipe client received an empty hello response.");
			Assert(response.Ok && response.RequestId == requestId, "pipe accept loop continues while first authorization is blocked");
		}
		catch (OperationCanceledException ex) when (!serviceCancellation.IsCancellationRequested)
		{
			throw new InvalidOperationException("Self-test failed: pipe accept loop continues while first authorization is blocked.", ex);
		}
		finally
		{
			releaseFirstAuthorization.Set();
			serviceCancellation.Cancel();
			try
			{
				await serverTask.WaitAsync(TimeSpan.FromSeconds(30));
			}
			catch (OperationCanceledException)
			{
			}
		}
	}

	private static async Task VerifyComponentWorkerResponsesAsync(string root)
	{
		foreach (string mode in new[] { "malformed-json", "missing-result", "healthy" })
		{
			string requestsPath = Path.Combine(root, "component-worker-" + mode + ".jsonl");
			var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"))
			{
				UseShellExecute = false, CreateNoWindow = true,
				RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
				StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
			};
			start.Environment["SHIELD_TEST_REQUESTS"] = requestsPath;
			start.Environment["SHIELD_TEST_MODE"] = mode;
			start.ArgumentList.Add("-NoProfile");
			start.ArgumentList.Add("-NonInteractive");
			start.ArgumentList.Add("-EncodedCommand");
			start.ArgumentList.Add(Convert.ToBase64String(Encoding.Unicode.GetBytes("""
				[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
				$ErrorActionPreference = 'Stop'
				$ProgressPreference = 'SilentlyContinue'
				$null = ConvertFrom-Json -InputObject '{"id":"warmup"}'
				$null = @{id='warmup';ok=$true} | ConvertTo-Json -Compress
				[Console]::Error.WriteLine('component-fixture-ready')
				[Console]::Error.Flush()
				$count = 0
				while ($null -ne ($line = [Console]::ReadLine())) {
				    [IO.File]::AppendAllText($env:SHIELD_TEST_REQUESTS, $line + [Environment]::NewLine)
				    $request = ConvertFrom-Json -InputObject $line
				    $count++
				    if ($count -eq 1 -and $env:SHIELD_TEST_MODE -eq 'malformed-json') {
				        [Console]::WriteLine('not-json')
				    } elseif ($count -eq 1 -and $env:SHIELD_TEST_MODE -eq 'missing-result') {
				        [Console]::WriteLine((@{id=$request.id;ok=$true} | ConvertTo-Json -Compress))
				    } elseif ($count -eq 1 -and $env:SHIELD_TEST_MODE -eq 'healthy') {
				        $heldRequest = $request
				    } else {
				        if ($request.method -eq 'stop') { $reply = @{id=$request.id;ok=$false;error='fixture rejected mutation'} }
				        else { $reply = @{id=$request.id;ok=$true;result=$request.method} }
				        [Console]::WriteLine(($reply | ConvertTo-Json -Compress))
				        if ($null -ne $heldRequest) {
				            [Console]::WriteLine((@{id=$heldRequest.id;ok=$true;result=$heldRequest.method} | ConvertTo-Json -Compress))
				            $heldRequest = $null
				        }
				    }
				}
				""")));
			using Process process = Process.Start(start) ?? throw new InvalidOperationException("Component worker fixture did not start.");
			var worker = new ComponentWorker(() => process);
			try
			{
				string? ready = await process.StandardError.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(120));
				Assert(ready == "component-fixture-ready", "component worker fixture is ready before measuring responses: " + mode + "; stderr=" + ready);
				using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
				Task<JsonElement> Request(string method, bool query) => worker.ExecuteAsync(JsonDefaults.ToElement(new { component = "SystemDoH", method, args = Array.Empty<object>() }), query, deadline.Token);
				if (mode == "healthy")
				{
					Task<JsonElement> first = Request("status", query: true);
					await ExpectAsync<InvalidOperationException>(() => Request("stop", query: false), "worker operation error returned");
					Assert((await first).GetString() == "status", "worker correlates responses arriving out of order");
					Assert((await Request("autoSelectProgress", query: true)).GetString() == "autoSelectProgress", "operation error leaves response reader available");
					Assert(File.ReadAllLines(requestsPath).Length == 3, "worker requests are each sent once");
				}
				else
				{
					try
					{
						await Request("stop", query: false).WaitAsync(TimeSpan.FromSeconds(30));
						throw new InvalidOperationException("Self-test failed: invalid worker response succeeded.");
					}
					catch (Exception error) when (error is IOException or JsonException) { }
					await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
					Assert(process.HasExited, "broken worker protocol terminates its owned process: " + mode);
					Assert(File.ReadAllLines(requestsPath).Length == 1, "failed reader receives no later request or mutation replay: " + mode);
				}
				Console.WriteLine("Component worker response self-test passed: " + mode);
				if (mode == "healthy")
				{
					using Process observer = Process.GetProcessById(process.Id);
					worker.Dispose();
					await observer.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
					Assert(observer.HasExited, "disposing a healthy worker ends its owned process");
				}
			}
			finally
			{
				// Only the controlled fixture process is terminated, including on a failing baseline.
				try { if (!process.HasExited) process.Kill(); } catch (InvalidOperationException) { }
				worker.Dispose();
			}
		}
	}

	private static async Task VerifyInstallerMaintenanceAsync(string root)
	{
		string[] mutations =
		{
			"dns.apply", "dns.reset", "dns.restore-owned", "dns.doh.apply", "dns.doh.remove",
			"owned-service.install", "owned-service.remove", "owned-service.start", "owned-service.stop",
			"zapret.profile.set", "network.repair-owned", "test.delay-mutation", "component.execute"
		};
		string[] markerNames = { "service-maintenance.json", Path.Combine("service-backup", "manifest.json") };
		string[] markerModes = { "present", "malformed", "locked" };
		ClientIdentity identity = new ClientIdentity(Environment.ProcessId, Environment.ProcessPath ?? "self-test", DevelopmentOverride: true, "S-1-5-21-1-2-3-1001");
		JsonElement componentPayload = JsonDefaults.ToElement(new { component = "SystemDoH", method = "status", args = Array.Empty<object>() });
		int fixtureCount = 0;
		foreach (string markerName in markerNames)
		foreach (string mode in markerModes)
		{
			string fixtureId = "self-test:installer:" + fixtureCount++;
			string productRoot = Path.Combine(root, "installer-maintenance", fixtureCount.ToString());
			string stateRoot = Path.Combine(productRoot, "Service");
			Directory.CreateDirectory(stateRoot);
			var maintenance = new InstallerServiceMaintenance(stateRoot);
			var maintenanceWithTrailingSeparator = new InstallerServiceMaintenance(stateRoot + Path.DirectorySeparatorChar);
			Assert(!maintenance.IsActive(), "missing installer directory permits operations: " + fixtureId);
			Assert(!maintenanceWithTrailingSeparator.IsActive(), "trailing state separator permits absent sibling installer directory: " + fixtureId);
			string marker = Path.Combine(productRoot, "installer", markerName);
			Directory.CreateDirectory(Path.GetDirectoryName(marker)!);
			Assert(!maintenance.IsActive(), "empty installer directories permit operations: " + fixtureId);
			Assert(!maintenanceWithTrailingSeparator.IsActive(), "trailing state separator permits empty sibling installer directories: " + fixtureId);
			File.WriteAllText(marker, mode == "malformed" ? "{" : "{\"owner\":\"EgoistShield\",\"schemaVersion\":1}");
			int executorCalls = 0;
			Task<JsonElement> ExecuteComponent(JsonElement payload, bool query, CancellationToken token)
			{
				token.ThrowIfCancellationRequested();
				Interlocked.Increment(ref executorCalls);
				return Task.FromResult(JsonDefaults.ToElement(new { completed = true, query }));
			}
			var options = new ServiceOptions(fixtureId, stateRoot, ConsoleMode: true, AllowDevClient: true, null);
			var journal = new TransactionJournal(stateRoot);
			using var dispatcher = new OperationDispatcher(options, new WindowsDnsController(), new WindowsNativeDohController(stateRoot), null, journal, new ServiceLog(stateRoot), ExecuteComponent);
			using (FileStream? lease = mode == "locked" ? File.Open(marker, FileMode.Open, FileAccess.ReadWrite, FileShare.None) : null)
			{
				Assert(maintenance.IsActive(), "installer marker blocks even malformed or exclusively locked content: " + fixtureId);
				Assert(maintenanceWithTrailingSeparator.IsActive(), "trailing state separator finds the same sibling installer marker: " + fixtureId);
				// Cancellation also prevents any system mutation if a gate regression lets a request fall through.
				using var cancelled = new CancellationTokenSource();
				cancelled.Cancel();
				foreach (string operation in mutations)
				{
					JsonElement payload = operation == "component.execute" ? componentPayload : operation == "test.delay-mutation" ? JsonDefaults.ToElement(new { delayMs = 1 }) : JsonDefaults.ToElement(new { });
					var request = new ServiceRequest(1, fixtureId + ":" + operation, operation, payload);
					AssertInstallerMaintenance(await dispatcher.DispatchAsync(request, identity, cancelled.Token), request.RequestId);
					Assert(await journal.ReadResponseAsync(request.RequestId) == null, "maintenance rejection is not persisted: " + request.RequestId);
				}
				var queryRequest = new ServiceRequest(1, fixtureId + ":component.query", "component.query", componentPayload);
				AssertInstallerMaintenance(await dispatcher.DispatchAsync(queryRequest, identity), queryRequest.RequestId);
				Assert(executorCalls == 0, "maintenance starts no component executor: " + fixtureId);
				foreach (string operation in new[] { "hello", "service.status", "recovery.status" })
				{
					var request = new ServiceRequest(1, fixtureId + ":" + operation, operation, JsonDefaults.ToElement(new { }));
					Assert((await dispatcher.DispatchAsync(request, identity)).Ok, "maintenance retains health and recovery readback: " + operation);
				}
				Assert(await journal.ReadActiveAsync() == null, "maintenance creates no transaction marker: " + fixtureId);
				ServiceResponse offlineRestore = await dispatcher.RestoreOwnedDnsOfflineAsync(identity);
				JsonElement offlineResult = JsonDefaults.ToElement(offlineRestore.Result);
				Assert(offlineRestore.Ok && offlineResult.GetProperty("pendingAdapters").GetInt32() == 0 && offlineResult.GetProperty("restored").GetArrayLength() == 0,
					"offline installer DNS restore with no owned state remains available without system writes: " + fixtureId);
				var ipcRestore = new ServiceRequest(1, fixtureId + ":dns.restore-owned", "dns.restore-owned", JsonDefaults.ToElement(new { }));
				AssertInstallerMaintenance(await dispatcher.DispatchAsync(ipcRestore, identity), ipcRestore.RequestId);
				AssertInstallerMaintenance(await dispatcher.DispatchAsync(queryRequest, identity), queryRequest.RequestId);
				Assert(maintenance.IsActive() && executorCalls == 0, "offline restore leaves the maintenance barrier active: " + fixtureId);
			}
			File.Delete(marker);
			Assert(!maintenance.IsActive(), "removing installer marker releases maintenance: " + fixtureId);
			Assert(!maintenanceWithTrailingSeparator.IsActive(), "trailing state separator releases maintenance after sibling marker removal: " + fixtureId);
			var mutation = new ServiceRequest(1, fixtureId + ":component.execute", "component.execute", componentPayload);
			ServiceResponse executed = await dispatcher.DispatchAsync(mutation, identity);
			Assert(executed.Ok && executorCalls == 1, "same mutation requestId succeeds after maintenance: " + fixtureId);
			Assert((await journal.ReadResponseAsync(mutation.RequestId))?.Response.Ok == true, "only successful retry is persisted: " + fixtureId);
			var query = new ServiceRequest(1, fixtureId + ":component.query", "component.query", componentPayload);
			Assert((await dispatcher.DispatchAsync(query, identity)).Ok && executorCalls == 2, "same component query requestId succeeds after maintenance: " + fixtureId);
			var delay = new ServiceRequest(1, fixtureId + ":test.delay-mutation", "test.delay-mutation", JsonDefaults.ToElement(new { delayMs = 1 }));
			Assert((await dispatcher.DispatchAsync(delay, identity)).Ok, "same non-component mutation requestId succeeds after maintenance: " + fixtureId);
			using var restarted = new OperationDispatcher(options, new WindowsDnsController(), new WindowsNativeDohController(stateRoot), null, journal, new ServiceLog(stateRoot), ExecuteComponent);
			ServiceResponse replayed = await restarted.DispatchAsync(mutation, identity);
			Assert(replayed.Ok && replayed.Sequence == executed.Sequence && executorCalls == 2, "successful retry remains idempotent after dispatcher restart: " + fixtureId);
		}
		await VerifyInstallerMaintenanceLockRaceAsync(root, identity, componentPayload);
		await VerifyInstallerMaintenanceStartupAsync(root);
		Console.WriteLine($"Installer maintenance self-tests passed: marker fixtures={fixtureCount}; blocked mutations={fixtureCount * (mutations.Length + 1)}; blocked component queries={fixtureCount * 2}; offline empty DNS restores={fixtureCount}; trailing separator checks={fixtureCount * 4}; queued mutation race=1; cancellable startup wait=1; hosted recovery/pipe gate=1");
	}

	private static void AssertInstallerMaintenance(ServiceResponse response, string requestId)
	{
		Assert(!response.Ok && response.RequestId == requestId && response.Error?.Code == "INSTALLER_MAINTENANCE" && response.Error.Retryable,
			"installer maintenance returns retryable rejection: " + requestId);
	}

	private static async Task VerifyInstallerMaintenanceLockRaceAsync(string root, ClientIdentity identity, JsonElement componentPayload)
	{
		string productRoot = Path.Combine(root, "installer-maintenance", "queued-race");
		string stateRoot = Path.Combine(productRoot, "Service");
		Directory.CreateDirectory(stateRoot);
		var options = new ServiceOptions("self-test:installer:queued-race", stateRoot, ConsoleMode: true, AllowDevClient: true, null);
		var journal = new TransactionJournal(stateRoot);
		var entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
		var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
		int executorCalls = 0;
		async Task<JsonElement> ExecuteComponent(JsonElement payload, bool query, CancellationToken token)
		{
			if (Interlocked.Increment(ref executorCalls) == 1)
			{
				entered.TrySetResult(true);
				await release.Task.WaitAsync(token);
			}
			return JsonDefaults.ToElement(new { completed = true });
		}
		using var dispatcher = new OperationDispatcher(options, new WindowsDnsController(), new WindowsNativeDohController(stateRoot), null, journal, new ServiceLog(stateRoot), ExecuteComponent);
		using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
		var holdingRequest = new ServiceRequest(1, "self-test:installer:holding", "component.execute", componentPayload);
		Task<ServiceResponse> holding = dispatcher.DispatchAsync(holdingRequest, identity, deadline.Token);
		Task<ServiceResponse>? waiting = null;
		try
		{
			await entered.Task.WaitAsync(deadline.Token);
			Assert(!File.Exists(Path.Combine(stateRoot, "idempotency-responses.json")), "fresh queue fixture has no asynchronous response-store read before its lock wait");
			var waitingRequest = new ServiceRequest(1, "self-test:installer:queued", "component.execute", componentPayload);
			// With no response store, DispatchAsync reaches the held mutation lock before returning this pending task.
			waiting = dispatcher.DispatchAsync(waitingRequest, identity, deadline.Token);
			Assert(!waiting.IsCompleted, "second mutation waits behind the controlled executor");
			string marker = Path.Combine(productRoot, "installer", "service-maintenance.json");
			Directory.CreateDirectory(Path.GetDirectoryName(marker)!);
			File.WriteAllText(marker, "{");
			release.TrySetResult(true);
			Assert((await holding.WaitAsync(deadline.Token)).Ok, "already executing controlled mutation finishes before the queued maintenance check");
			AssertInstallerMaintenance(await waiting.WaitAsync(deadline.Token), waitingRequest.RequestId);
			Assert(executorCalls == 1, "marker created during lock wait prevents the second executor from starting");
			Assert(await journal.ReadResponseAsync(waitingRequest.RequestId) == null, "queued maintenance rejection is not persisted");
			File.Delete(marker);
			Assert((await dispatcher.DispatchAsync(waitingRequest, identity, deadline.Token)).Ok && executorCalls == 2, "same queued requestId retries successfully after marker removal");
		}
		finally
		{
			release.TrySetResult(true);
			deadline.Cancel();
			try { await holding; } catch (OperationCanceledException) { }
			if (waiting != null)
				try { await waiting; } catch (OperationCanceledException) { }
		}
	}

	private static async Task VerifyInstallerMaintenanceStartupAsync(string root)
	{
		string productRoot = Path.Combine(root, "installer-maintenance", "hosted-startup");
		string stateRoot = Path.Combine(productRoot, "Service");
		Directory.CreateDirectory(stateRoot);
		string marker = Path.Combine(productRoot, "installer", "service-maintenance.json");
		Directory.CreateDirectory(Path.GetDirectoryName(marker)!);
		File.WriteAllText(marker, "{");
		var options = new ServiceOptions("EgoistShield.Service.SelfTest.Installer." + Guid.NewGuid().ToString("N"), stateRoot, ConsoleMode: true, AllowDevClient: true, null);
		var journal = new TransactionJournal(stateRoot);
		var now = DateTimeOffset.UtcNow;
		var terminal = new ActiveTransaction(1, "EgoistShield", "self-test-installer-startup-terminal", "self-test:installer:startup-terminal",
			"test", "test.delay-mutation", TransactionPhase.Committed, JsonDefaults.ToElement(new { }), JsonDefaults.ToElement(new { }), now, now, null);
		await journal.CreateActiveAsync(terminal);
		string activePath = Path.Combine(stateRoot, "active-transaction.json");
		byte[] unchangedMarker = await File.ReadAllBytesAsync(activePath);
		using var dispatcher = new OperationDispatcher(options, new WindowsDnsController(), new WindowsNativeDohController(stateRoot), null, journal, new ServiceLog(stateRoot));
		using (var cancelledWait = new CancellationTokenSource())
		{
			Task wait = dispatcher.WaitForInstallerMaintenanceAsync(cancelledWait.Token);
			Assert(!wait.IsCompleted, "active installer marker defers startup readiness");
			cancelledWait.Cancel();
			await ExpectAsync<OperationCanceledException>(() => wait, "installer startup wait remains cancellable");
			Assert((await File.ReadAllBytesAsync(activePath)).SequenceEqual(unchangedMarker), "cancelled maintenance wait preserves terminal journal bytes");
		}
		using var lifetime = new CancellationTokenSource(TimeSpan.FromSeconds(30));
		Task ready = dispatcher.WaitForInstallerMaintenanceAsync(lifetime.Token);
		ServiceEngine engine = await ServiceEngine.CreateAsync(options, lifetime.Token);
		Task hosted = engine.RunAsync(lifetime.Token);
		try
		{
			string logPath = Path.Combine(stateRoot, "service.log");
			while (!File.Exists(logPath) || !(await File.ReadAllTextAsync(logPath, lifetime.Token)).Contains("Starting EgoistShieldCore", StringComparison.Ordinal))
				await Task.Delay(10, lifetime.Token);
			await using (var blockedClient = new NamedPipeClientStream(".", options.PipeName, PipeDirection.InOut, PipeOptions.Asynchronous))
				await ExpectAsync<TimeoutException>(() => blockedClient.ConnectAsync(250, lifetime.Token), "hosted Core opens no IPC pipe during installer maintenance");
			Assert(!ready.IsCompleted && !hosted.IsCompleted, "hosted Core waits for installer completion");
			Assert((await File.ReadAllBytesAsync(activePath, lifetime.Token)).SequenceEqual(unchangedMarker), "hosted startup leaves terminal recovery journal untouched during maintenance");
			Assert(!File.Exists(Path.Combine(stateRoot, "transactions.jsonl")), "hosted startup performs no journal archival during maintenance");
			File.Delete(marker);
			await ready.WaitAsync(lifetime.Token);
			await using var client = new NamedPipeClientStream(".", options.PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
			await client.ConnectAsync(lifetime.Token);
			byte[] hello = Encoding.UTF8.GetBytes("{\"protocolVersion\":1,\"requestId\":\"self-test:installer:hosted-hello\",\"operation\":\"hello\",\"payload\":{}}\n");
			await client.WriteAsync(hello, lifetime.Token);
			await client.FlushAsync(lifetime.Token);
			using var reader = new StreamReader(client, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
			string responseText = await reader.ReadLineAsync(lifetime.Token) ?? throw new InvalidOperationException("Hosted maintenance fixture received no hello response.");
			var response = JsonSerializer.Deserialize<ServiceResponse>(responseText, JsonDefaults.Options);
			Assert(response?.Ok == true, "hosted IPC becomes ready after maintenance marker removal");
			Assert(await journal.ReadActiveAsync(lifetime.Token) == null, "hosted startup recovers terminal journal after maintenance marker removal");
			Assert((await File.ReadAllTextAsync(Path.Combine(stateRoot, "transactions.jsonl"), lifetime.Token)).Contains(terminal.TransactionId, StringComparison.Ordinal), "deferred terminal recovery is archived after maintenance");
		}
		finally
		{
			lifetime.Cancel();
			try { await ready; } catch (OperationCanceledException) { }
			try { await hosted.WaitAsync(TimeSpan.FromSeconds(30)); } catch (OperationCanceledException) { }
		}
	}

	private sealed class RecoveryServiceFixture(string startType, int delayedAutoStart)
	{
		internal string StartType = startType;
		internal int DelayedAutoStart = delayedAutoStart;
		internal string? Dependencies;
		internal string? FailureActions;
		internal string? Description;
		internal int FailureReset;
		internal bool FailureFlag;
		internal int Calls;
		internal int Applied;
		internal int StartupWrites;
		internal int FailAt;
		internal Action<int>? BeforeCommand;
		internal Action<int>? AfterCommand;

		internal Task<ProcessResult> RunScAsync(IEnumerable<string> arguments, CancellationToken token)
		{
			token.ThrowIfCancellationRequested();
			string[] args = arguments.ToArray();
			Calls++;
			BeforeCommand?.Invoke(Calls);
			Assert(args.Length >= 2 && args[1] == "EgoistShieldSystemDoH", "recovery targets the owned service");
			if (Calls == FailAt) return Task.FromResult(new ProcessResult(5, "", "controlled access denied"));
			switch (args[0])
			{
				case "config" when args.Length == 4 && args[2] == "start=":
					StartupWrites++;
					StartType = args[3] == "delayed-auto" ? "auto" : args[3];
					DelayedAutoStart = args[3] == "delayed-auto" ? 1 : 0;
					break;
				case "config" when args.Length == 4 && args[2] == "depend=":
					Dependencies = args[3];
					break;
				case "failure" when args.Length == 6 && args[2] == "reset=" && args[4] == "actions=":
					FailureReset = int.Parse(args[3]);
					FailureActions = args[5];
					break;
				case "failureflag" when args.Length == 3:
					FailureFlag = args[2] == "1";
					break;
				case "description" when args.Length == 3:
					Description = args[2];
					break;
				default:
					throw new InvalidOperationException("Unexpected recovery SCM command in controlled fixture.");
			}
			Applied++;
			AfterCommand?.Invoke(Calls);
			return Task.FromResult(new ProcessResult(0, "", ""));
		}
	}

	private static async Task VerifyRecoveryStartupPolicyAsync(string root)
	{
		const string name = "EgoistShieldSystemDoH";
		const string description = "Controlled recovery description";
		var policies = new[] { ("auto", 0), ("auto", 1), ("demand", 1), ("disabled", 1) };
		foreach (var (mode, delayed) in policies)
		{
			var fixture = new RecoveryServiceFixture(mode, delayed);
			for (int pass = 0; pass < 2; pass++)
			{
				await OwnedServiceController.ConfigureRecoveryAsync(name, description, fixture.RunScAsync, CancellationToken.None);
				Assert(fixture.StartType == mode && fixture.DelayedAutoStart == delayed && fixture.StartupWrites == 0,
					"recovery and repeated repair preserve startup policy: " + mode + "/" + delayed);
				Assert(fixture.Dependencies == "Tcpip/Afd" && fixture.FailureReset == 3600 &&
					fixture.FailureActions == "restart/5000/restart/10000/restart/60000" && fixture.FailureFlag && fixture.Description == description,
					"recovery repair still configures dependencies, bounded restart policy and description");
			}
		}
		var raced = new RecoveryServiceFixture("auto", 1);
		raced.BeforeCommand = step => { if (step == 2) raced.StartType = "disabled"; };
		await OwnedServiceController.ConfigureRecoveryAsync(name, description, raced.RunScAsync, CancellationToken.None);
		Assert(raced.StartType == "disabled" && raced.DelayedAutoStart == 1 && raced.StartupWrites == 0,
			"external Disabled change made during repair wins over supervisor startup observation");
		for (int step = 1; step <= 4; step++)
		{
			var failed = new RecoveryServiceFixture("disabled", 1) { FailAt = step };
			await ExpectAsync<InvalidOperationException>(() => OwnedServiceController.ConfigureRecoveryAsync(name, description, failed.RunScAsync, CancellationToken.None),
				"recovery reports SCM failure at step " + step);
			Assert(failed.Calls == step && failed.Applied == step - 1 && failed.StartType == "disabled" && failed.DelayedAutoStart == 1,
				"failed repair stops before later commands and preserves disabled startup policy");
		}
		foreach (Exception error in new Exception[] { new IOException("controlled runner I/O failure"), new TimeoutException("controlled runner deadline") })
		{
			var failed = new RecoveryServiceFixture("demand", 1) { BeforeCommand = _ => throw error };
			try
			{
				await OwnedServiceController.ConfigureRecoveryAsync(name, description, failed.RunScAsync, CancellationToken.None);
				throw new InvalidOperationException("Self-test expected runner failure to propagate.");
			}
			catch (Exception actual) when (ReferenceEquals(actual, error)) { }
			Assert(failed.Calls == 1 && failed.Applied == 0 && failed.StartType == "demand" && failed.DelayedAutoStart == 1,
				"runner failure propagates without later recovery commands");
		}
		for (int applied = 0; applied < 4; applied++)
		{
			using var cancelled = new CancellationTokenSource();
			var fixture = new RecoveryServiceFixture("disabled", 1);
			if (applied == 0) cancelled.Cancel();
			else fixture.AfterCommand = step => { if (step == applied) cancelled.Cancel(); };
			await ExpectAsync<OperationCanceledException>(() => OwnedServiceController.ConfigureRecoveryAsync(name, description, fixture.RunScAsync, cancelled.Token),
				"recovery observes cancellation before command " + (applied + 1));
			Assert(fixture.Calls == applied && fixture.Applied == applied && fixture.StartType == "disabled" && fixture.DelayedAutoStart == 1,
				"cancelled recovery starts no later command and preserves startup policy");
		}
		using (var cancelled = new CancellationTokenSource())
		using (var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30)))
		{
			var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
			int commands = 0;
			async Task<ProcessResult> BlockedRunner(IEnumerable<string> arguments, CancellationToken token)
			{
				commands++;
				entered.SetResult();
				await Task.Delay(Timeout.InfiniteTimeSpan, token);
				return new ProcessResult(0, "", "");
			}
			Task repair = OwnedServiceController.ConfigureRecoveryAsync(name, description, BlockedRunner, cancelled.Token);
			await entered.Task.WaitAsync(deadline.Token);
			cancelled.Cancel();
			await ExpectAsync<OperationCanceledException>(() => repair.WaitAsync(deadline.Token), "in-flight recovery command remains cancellable");
			Assert(commands == 1, "in-flight cancellation prevents later SCM commands");
		}
		var foreign = new RecoveryServiceFixture("disabled", 1);
		await ExpectAsync<ArgumentException>(() => OwnedServiceController.ConfigureRecoveryAsync("ForeignService", description, foreign.RunScAsync, CancellationToken.None),
			"recovery rejects a service outside the allowlist before the SCM boundary");
		Assert(foreign.Calls == 0, "unknown service performs no SCM commands");
		int supervisorFixtures = 0;
		foreach (var (mode, delayed) in policies.Concat(new[] { ("race", 1) }))
		{
			supervisorFixtures++;
			var fixture = new RecoveryServiceFixture(mode == "race" ? "auto" : mode, delayed);
			if (mode == "race") fixture.BeforeCommand = step => { if (step == 2) fixture.StartType = "disabled"; };
			string stateRoot = Path.Combine(root, "recovery-policy", supervisorFixtures.ToString());
			Directory.CreateDirectory(stateRoot);
			var intents = new OwnedServiceIntentStore(stateRoot);
			await intents.SetRunningAsync(name, true, CancellationToken.None);
			int repairs = 0, restarts = 0;
			TimeSpan elapsed = TimeSpan.FromMinutes(2);
			var supervisor = new OwnedServiceSupervisor(intents,
				(service, token) => Task.FromResult(new OwnedServiceStatus(service, "running", service == name ? fixture.StartType : "not-installed", service == name)),
				(service, token) => Task.CompletedTask,
				(service, token) => Task.FromResult(LocalServiceHealth.Responsive),
				(service, running, token) => { restarts++; return Task.CompletedTask; },
				message => Task.CompletedTask, () => true, () => elapsed,
				bootGrace: TimeSpan.Zero,
				repairRecovery: async (service, token) =>
				{
					repairs++;
					await OwnedServiceController.ConfigureRecoveryAsync(service, description, fixture.RunScAsync, token);
				});
			await supervisor.CheckAsync(CancellationToken.None);
			elapsed += TimeSpan.FromSeconds(15);
			await supervisor.CheckAsync(CancellationToken.None);
			Assert(repairs == (mode is "auto" or "race" ? 1 : 0) && restarts == 0,
				"supervisor repairs automatic recovery once and skips manual/disabled startup policies");
			Assert(fixture.StartType == (mode == "race" ? "disabled" : mode) && fixture.DelayedAutoStart == delayed && fixture.StartupWrites == 0,
				"actual supervisor recovery callback preserves restored or externally changed startup policy");
		}
		Console.WriteLine($"Recovery startup policy self-tests passed: policies={policies.Length}; repeated repairs={policies.Length}; supervisor fixtures={supervisorFixtures}; Disabled races=2; SCM failure steps=4; runner exceptions=2; cancellation boundaries=5; unknown service refusal=1");
	}

	private static void VerifyOwnedDnsBaselines()
	{
		var a = new DnsAdapterSnapshot(7, "Ethernet", "adapter-a", new[] { "192.0.2.53" }, new[] { "2001:db8::53" }, false, true);
		var b = a with { InterfaceIndex = 8, InterfaceGuid = "adapter-b" };
		var servers = new[] { "127.0.0.1", "::1" };
		var owned = DnsOwnedState.Capture(null, new[] { a, b }, servers);
		var active = a with { InterfaceIndex = 70, Ipv4 = new[] { "127.0.0.1" }, Ipv6 = new[] { "::1" }, Ipv4Static = true, Ipv6Static = true };
		var reapplied = DnsOwnedState.Capture(owned, new[] { active }, servers);
		var restored = reapplied.RestoreTargets(new[] { active }).Single();
		Assert(restored.InterfaceIndex == 70 && restored.Ipv4.SequenceEqual(a.Ipv4) && !restored.Ipv4Static, "reapply preserves original DHCP baseline across changed interface index");
		Assert(reapplied.OriginalAdapters.Length == 2, "missing adapter baseline retained");
		var externalV6 = active with { Ipv6 = new[] { "2001:db8::99" } };
		var partial = reapplied.RestoreTargets(new[] { externalV6 }).Single();
		Assert(partial.Ipv6.SequenceEqual(externalV6.Ipv6) && partial.Ipv4.SequenceEqual(a.Ipv4), "restore preserves external family change");
		Assert(owned.RestoreTargets(new[] { active with { InterfaceGuid = "recycled-index" } }).Length == 0, "recycled index does not establish DNS ownership");
		var replacement = DnsOwnedState.Capture(owned, new[] { b with { Ipv4 = new[] { "127.0.0.1" }, Ipv6 = new[] { "::1" }, Ipv4Static = true, Ipv6Static = true } }, new[] { "1.1.1.1", "2606:4700:4700::1111" });
		Assert(replacement.RestoreTargets(new[] { active }).Single().Ipv4.SequenceEqual(a.Ipv4), "missing adapter retains prior applied provider after another adapter changes provider");
		var serialized = JsonSerializer.Serialize(replacement, JsonDefaults.StateOptions);
		var decoded = JsonSerializer.Deserialize<DnsOwnedState>(serialized, JsonDefaults.StateOptions)!;
		decoded.Validate();
		Assert(decoded.RestoreTargets(new[] { active }).Single().Ipv4.SequenceEqual(a.Ipv4), "per-adapter ownership survives serialization");
		var legacy = new DnsOwnedState(1, "EgoistShield", servers, new[] { a });
		Assert(legacy.RestoreTargets(new[] { active }).Length == 1, "legacy global ownership remains readable");
		var loopback = active with { Ipv4 = new[] { "127.0.0.1" }, Ipv4Static = true, Ipv6 = Array.Empty<string>(), Ipv6Static = false };
		var loopbackState = new DnsOwnedState(1, "EgoistShield", new[] { "127.0.0.1" }, new[] { loopback });
		Assert(OperationDispatcher.IsLoopbackOwnedBaseline(loopbackState, new[] { loopback }), "loopback-only owned baseline is detected for DHCP fallback");
		Assert(!OperationDispatcher.IsLoopbackOwnedBaseline(loopbackState, new[] { a }), "normal static/DHCP baseline is not misclassified as loopback fallback");
		var dualLoopback = loopback with { Ipv6 = new[] { "::1" }, Ipv6Static = true };
		var dualLoopbackState = new DnsOwnedState(1, "EgoistShield", new[] { "127.0.0.1", "::1" }, new[] { dualLoopback });
		Assert(!OperationDispatcher.IsLoopbackOwnedBaseline(dualLoopbackState, new[] { dualLoopback with { Ipv6 = new[] { "2001:db8::99" } } }), "external IPv6 change blocks broad DHCP fallback");
		Console.WriteLine("Owned DNS baseline self-tests passed: 10");
	}

}
