using System;
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
