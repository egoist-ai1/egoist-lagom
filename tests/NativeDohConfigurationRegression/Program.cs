using EgoistShield.Service;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace NativeDohRegression;

internal static partial class Program
{
    private static string _work = "";
    private static int _passed;
    private const string OldUrl = "https://old.example/dns-query";
    private const string NewUrl = "https://new.example/dns-query";
    private static readonly DnsAdapterSnapshot Baseline = new(4, "Ethernet", "{11111111-1111-1111-1111-111111111111}", new[] { "192.0.2.53" }, Array.Empty<string>(), true, false, Ipv4BindingEnabled: true, Ipv6BindingEnabled: true);

    private static async Task<int> Main(string[] args)
    {
        if (args.Contains("--self-test")) { await SelfTest.RunAsync(); return 0; }
        int index = Array.IndexOf(args, "--work");
        if (index < 0 || index + 1 >= args.Length || !Path.IsPathFullyQualified(args[index + 1])) throw new ArgumentException("Use --work <absolute task work path>.");
        _work = Path.Combine(Path.GetFullPath(args[index + 1]), "native-doh-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_work);
        var elapsed = Stopwatch.StartNew();
        try
        {
            await PhysicalEnrollmentCallerRegressionAsync();
            if (args.Contains("--physical-enrollment-only")) {
                Console.WriteLine($"Physical enrollment/recorded caller mock regression passed: {_passed} groups; nativeActions=0; work={_work}");
                return 0;
            }
            await Check("startup persistence read retains one readiness epoch across recovery", StartupReadbackEpochAsync);
            if (args.Contains("--startup-readback-only")) return 0;
            await Check("disabled IPv6 DNS apply respects actual binding and preserves skipped family", DisabledIpv6ApplyAsync);
            if (args.Contains("--disabled-ipv6-apply-only")) return 0;
            await Check("disabled IPv6 configured DNS recovery preserves ownership and unblocks routes", DisabledIpv6RecoveryAsync);
            if (args.Contains("--disabled-ipv6-only")) return 0;
            await Check("missing native ownership skips an unnecessary DNS snapshot", NativeDohMissingOwnershipAsync);
            await Check("corrupt or unavailable native ownership fails before network inspection", NativeDohUnreadableOwnershipAsync);
            await Check("read-only native DoH budget cancels its actual held child before the coordinator deadline", NativeDohQueryCancellationAsync);
            await Check("failed or malformed IPv6 route queries remain unknown and are not cached", NativeDohRouteFailureAsync);
            await Check("ownership created during a Missing route query cannot be reported disabled", NativeDohOwnershipAppearedAsync);
            if (args.Contains("--native-doh-query-only")) { Console.WriteLine($"Native DoH read-only query regression passed: {_passed} groups; work={_work}"); return 0; }
            await Check("generated PowerShell adds and verifies a new registration", () => ConfigureScriptAsync("missing"));
            await Check("owned overlapping template changes in place", () => ConfigureScriptAsync("owned"));
            await Check("foreign and externally weakened templates are preserved", ForeignTemplatesAsync);
            await Check("same-template readback rejects wrong encryption flags", () => ConfigureScriptAsync("bad-readback"));
            await Check("provider switch preserves old registration until adapter readback", SwitchAsync);
            await Check("failed provider switch rolls back DNS, templates and saved ownership", RollbackAsync);
            await Check("native removal restores each owned family and preserves external peers", PartialRestoreAsync);
            await Check("boot bootstrap rotation uses a verified worker result and durable transaction", BootstrapRefreshAsync);
            await Check("bootstrap failure cooldown and external adapter state prevent blind changes", BootstrapDeferralAsync);
            await Check("central DNS mode guards reject cross-mode mutations", ModeGuardsAsync);
            await Check("probe scope is enforced before memory, durable and in-flight responses", IdentityProbeScopeAsync);
            await Check("unverified runtime root blocks SCM execution and automatic startup before metadata access", UnverifiedRuntimeRootAsync);
            await Check("optional log locking does not fail network operations", LogLockAsync);
            await Check("generated listener ownership snapshot is bounded and stable in PowerShell5.1", ListenerSnapshotScriptAsync);
            await Check("read-only CLI reports the actual foreign owner across mixed endpoint families", ListenerSnapshotContractAsync);
            await Check("read-only CLI rejects invalid or mixed service arguments before startup", ListenerSnapshotArgumentsAsync);
            await Check("read-only CLI emits a bounded native snapshot from the actual Windows host", ActualListenerSnapshotCommandAsync);
            Console.WriteLine($"Native DoH/Core regression passed: {_passed} groups; runtime={System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription}; elapsed={elapsed.Elapsed.TotalSeconds:0.00}s; work={_work}");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); Console.Error.WriteLine("Evidence preserved: " + _work); return 1; }
    }

    private static async Task Check(string name, Func<Task> run) { await run(); _passed++; Console.WriteLine("PASS: " + name); }
    private static void Assert(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    private static string Json<T>(T value) => JsonSerializer.Serialize(value, JsonDefaults.StateOptions);

    private static async Task NativeDohMissingOwnershipAsync()
    {
        Assert(WindowsNativeDohController.IsSupported, "This Windows harness requires native DoH support.");
        string root = Path.Combine(_work, "missing-ownership");
        int snapshots = 0, routes = 0;
        var dns = new WindowsDnsController((script, token) => { snapshots++; return Task.FromResult(new ProcessResult(0, Json(new[] { Baseline }), "")); });
        var native = new WindowsNativeDohController(root, (script, token) => {
            Assert(script.Contains("Get-NetRoute"), "Missing ownership queried DoH registrations."); routes++;
            return Task.FromResult(new ProcessResult(0, "true", ""));
        });
        using var dispatcher = new OperationDispatcher(new ServiceOptions("test-no-pipe", root, true, true, null), dns, native, null, new TransactionJournal(root), new ServiceLog(root));
        var response = await dispatcher.DispatchAsync(new ServiceRequest(1, "missing:status", "dns.doh.status", JsonDefaults.ToElement(new { })), new ClientIdentity(Environment.ProcessId, Environment.ProcessPath!, true, "test"));
        JsonElement actual = JsonDefaults.ToElement(response.Result);
        Assert(response.Ok && actual.GetProperty("enabled").GetBoolean() == false && actual.GetProperty("hasIpv6DefaultRoute").GetBoolean(), "Missing ownership or genuine route capability was misreported.");
        Assert(snapshots == 0 && routes == 1 && actual.GetProperty("adapters").GetArrayLength() == 0, "Missing ownership launched an unnecessary DNS snapshot.");
    }

    private static async Task NativeDohUnreadableOwnershipAsync()
    {
        foreach (string mode in new[] { "corrupt", "null", "unavailable", "unsupported-owner" })
        {
            string root = Path.Combine(_work, "ownership-" + mode); Directory.CreateDirectory(root);
            string file = Path.Combine(root, "native-doh-state.json");
            await File.WriteAllTextAsync(file, mode == "null" ? "null" : mode == "unsupported-owner" ? Json(Owned() with { Owner = "Foreign" }) : "{");
            using FileStream? held = mode == "unavailable" ? new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None) : null;
            int queries = 0;
            Task<ProcessResult> FailUnexpectedQuery(string script, CancellationToken token) { queries++; throw new InvalidOperationException("Unknown ownership reached network inspection."); }
            using var dispatcher = new OperationDispatcher(new ServiceOptions("test-no-pipe", root, true, true, null),
                new WindowsDnsController(FailUnexpectedQuery), new WindowsNativeDohController(root, FailUnexpectedQuery), null, new TransactionJournal(root), new ServiceLog(root));
            ServiceResponse response;
            try { response = await dispatcher.DispatchAsync(new ServiceRequest(1, "invalid:" + mode, "dns.doh.status", JsonDefaults.ToElement(new { })), new ClientIdentity(Environment.ProcessId, Environment.ProcessPath!, true, "test")); }
            catch (InvalidOperationException error) when (mode == "unsupported-owner" && error.Message.Contains("unsupported schema or owner")) { Assert(queries == 0, "Unsupported ownership reached network inspection."); continue; }
            Assert(!response.Ok && response.Result == null && queries == 0, "Corrupt, unavailable or unsupported ownership became a safe status or launched a network query.");
            if (mode is "corrupt" or "null") Assert(response.Error?.Code == "STATE_CORRUPT", "Corrupt ownership lost its explicit error identity.");
            if (mode == "unavailable") Assert(response.Error?.Code == "STATE_UNAVAILABLE", "Unavailable ownership lost its explicit error identity.");
        }
    }

    private static async Task NativeDohQueryCancellationAsync()
    {
        Assert(OperationDispatcher.NativeDohQueryTimeout < TimeSpan.FromSeconds(30) && ServiceContract.PowerShellTimeout == TimeSpan.FromMinutes(2), "Read-only deadline changed global mutation budgets.");
        string root = Path.Combine(_work, "query-cancellation"); Directory.CreateDirectory(root);
        await File.WriteAllTextAsync(Path.Combine(root, "native-doh-state.json"), Json(Owned()));
        string pidFile = Path.Combine(root, "held-child-pid.txt");
        bool cancellationObserved = false;
        var dns = new WindowsDnsController(async (script, token) => {
            Assert(script.Contains("$result = @()") && !script.Contains("Set-DnsClient"), "Status attempted a mutating DNS script.");
            try
            {
                return await ProcessRunner.RunAsync(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
                    new[] { "-NoProfile", "-NonInteractive", "-Command", "$PID | Out-File -LiteralPath '" + pidFile.Replace("'", "''") + "' -Encoding ascii; Start-Sleep -Seconds 60" }, ServiceContract.PowerShellTimeout, token);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { cancellationObserved = true; throw; }
        });
        var native = new WindowsNativeDohController(root, (script, token) => throw new InvalidOperationException("Timed-out DNS snapshot must not continue to route or registration inspection."));
        using var dispatcher = new OperationDispatcher(new ServiceOptions("test-no-pipe", root, true, true, null), dns, native, null, new TransactionJournal(root), new ServiceLog(root), nativeDohQueryTimeout: TimeSpan.FromSeconds(2));
        var elapsed = Stopwatch.StartNew();
        var response = await dispatcher.DispatchAsync(new ServiceRequest(1, "cancel:status", "dns.doh.status", JsonDefaults.ToElement(new { })), new ClientIdentity(Environment.ProcessId, Environment.ProcessPath!, true, "test"));
        Assert(!response.Ok && response.Result == null && response.Error?.Code == "DNS_DOH_QUERY_TIMEOUT" && response.Error.Retryable == false && cancellationObserved && elapsed.Elapsed < TimeSpan.FromSeconds(5), "Query was not cancelled before the outer deadline or was offered for unbounded retries.");
        Assert(File.Exists(pidFile) && int.TryParse((await File.ReadAllTextAsync(pidFile)).Trim(), out _), "Actual owned child did not start; cancellation proof is incomplete.");
        int pid = int.Parse((await File.ReadAllTextAsync(pidFile)).Trim());
        bool exited = false;
        try { using var child = Process.GetProcessById(pid); exited = child.HasExited || await Task.Run(() => child.WaitForExit(2000)); }
        catch (ArgumentException) { exited = true; }
        Assert(exited, "Query deadline returned while its actual held child remained alive.");
        await File.WriteAllTextAsync(Path.Combine(root, "actual-query-cancellation.json"), Json(new { kind = "actual-owned-read-only-child-cancellation", pid, exited, cancellationObserved, elapsedMs = elapsed.ElapsedMilliseconds, code = response.Error?.Code, productServiceExecuted = false, dnsMutationCommandsExecuted = 0 }));
    }

    private static async Task NativeDohRouteFailureAsync()
    {
        string root = Path.Combine(_work, "route-failure"); int calls = 0;
        var controller = new WindowsNativeDohController(root, (script, token) => { calls++; return Task.FromResult(calls == 1 ? new ProcessResult(1, "", "controlled query failure") : calls == 2 ? new ProcessResult(0, "not-a-boolean", "") : new ProcessResult(0, "true", "")); });
        for (int i = 0; i < 2; i++)
        {
            bool failed = false;
            try { await controller.HasIpv6DefaultRouteAsync(default); }
            catch (Exception error) when (error is InvalidOperationException or ServiceOperationException) { failed = true; }
            Assert(failed, "Failed route query became a cached false capability.");
        }
        Assert(await controller.HasIpv6DefaultRouteAsync(default) && await controller.HasIpv6DefaultRouteAsync(default) && calls == 3, "Failed route result was cached or a verified result was not cached.");
    }

    private static async Task NativeDohOwnershipAppearedAsync()
    {
        string root = Path.Combine(_work, "ownership-appeared"); Directory.CreateDirectory(root); int snapshots = 0;
        var native = new WindowsNativeDohController(root, async (script, token) => {
            Assert(script.Contains("Get-NetRoute"), "Unexpected native status query.");
            await File.WriteAllTextAsync(Path.Combine(root, "native-doh-state.json"), Json(Owned()), token);
            return new ProcessResult(0, "true", "");
        });
        using var dispatcher = new OperationDispatcher(new ServiceOptions("test-no-pipe", root, true, true, null),
            new WindowsDnsController((script, token) => { snapshots++; throw new InvalidOperationException("Missing path should not query adapters."); }), native, null, new TransactionJournal(root), new ServiceLog(root));
        var response = await dispatcher.DispatchAsync(new ServiceRequest(1, "appeared:status", "dns.doh.status", JsonDefaults.ToElement(new { })), new ClientIdentity(Environment.ProcessId, Environment.ProcessPath!, true, "test"));
        Assert(!response.Ok && response.Result == null && response.Error?.Code == "DNS_DOH_OWNERSHIP_CHANGED" && snapshots == 0, "A concurrent ownership creation was returned as disabled or caused an unbounded retry.");
    }

    private static NativeDohOwnedState Owned(string[]? servers = null, DnsAdapterSnapshot[]? baseline = null) => new(1, "EgoistShield", OldUrl, servers ?? new[] { "1.1.1.1" }, DateTimeOffset.UtcNow,
        (servers ?? new[] { "1.1.1.1" }).Select(server => new NativeDohEntrySnapshot(server, false, null, false, false)).ToArray(), baseline ?? new[] { Baseline });

    private static async Task ConfigureScriptAsync(string mode)
    {
        var initial = mode == "missing" ? Array.Empty<NativeDohEntrySnapshot>() : new[] {
            new NativeDohEntrySnapshot("1.1.1.1", true, mode == "foreign" ? "https://foreign.example/dns-query" : OldUrl, mode == "weakened", true) };
        var json = Json(initial).Replace("'", "''");
        string mocks = """
            $global:mockEntries = @{}
            $global:mockCalls = New-Object System.Collections.Generic.List[string]
            function Get-DnsClientDohServerAddress {
              [CmdletBinding()] param([string]$ServerAddress)
              if ($global:mockEntries.ContainsKey($ServerAddress)) { return $global:mockEntries[$ServerAddress] }
            }
            function Set-DnsClientDohServerAddress {
              [CmdletBinding()] param([string]$ServerAddress, [string]$DohTemplate, [bool]$AllowFallbackToUdp, [bool]$AutoUpgrade)
              $global:mockCalls.Add('set:' + $ServerAddress)
              $global:mockEntries[$ServerAddress] = [pscustomobject]@{serverAddress=$ServerAddress; existed=$true; dohTemplate=$DohTemplate; allowFallbackToUdp=$AllowFallbackToUdp; autoUpgrade=$AutoUpgrade}
            }
            function Add-DnsClientDohServerAddress {
              [CmdletBinding()] param([string]$ServerAddress, [string]$DohTemplate, [bool]$AllowFallbackToUdp, [bool]$AutoUpgrade)
              $global:mockCalls.Add('add:' + $ServerAddress)
              $global:mockEntries[$ServerAddress] = [pscustomobject]@{serverAddress=$ServerAddress; existed=$true; dohTemplate=$DohTemplate; allowFallbackToUdp=$AllowFallbackToUdp; autoUpgrade=$AutoUpgrade}
            }
            function Remove-DnsClientDohServerAddress { throw 'Configuration must never delete a registration before replacing it.' }
            """;
        if (mode == "bad-readback") mocks += "\nfunction Set-DnsClientDohServerAddress { [CmdletBinding()] param([string]$ServerAddress, [string]$DohTemplate, [bool]$AllowFallbackToUdp, [bool]$AutoUpgrade) $global:mockEntries[$ServerAddress].dohTemplate = $DohTemplate; $global:mockEntries[$ServerAddress].allowFallbackToUdp = $true }\n";
        string script = mocks + "\nforeach ($item in (ConvertFrom-Json -InputObject '" + json + "')) { $global:mockEntries[[string]$item.serverAddress] = $item }\n$failure = $null\ntry {\n" +
            WindowsNativeDohController.CreateConfigureScript(NewUrl, new[] { "1.1.1.1" }, Owned()) +
            "\n} catch { $failure = $_.Exception.Message }\n[pscustomobject]@{ failure=$failure; calls=@($global:mockCalls); entries=@($global:mockEntries.Values) } | ConvertTo-Json -Compress -Depth 6\n";
        string fixture = Path.Combine(_work, "configure-" + mode + ".ps1");
        await File.WriteAllTextAsync(fixture, script, new UTF8Encoding(true));
        var result = await ProcessRunner.RunAsync(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
            new[] { "-NoProfile", "-NonInteractive", "-File", fixture }, TimeSpan.FromSeconds(15));
        await File.WriteAllTextAsync(fixture + ".result.txt", result.StandardOutput + "\n" + result.StandardError);
        Assert(result.ExitCode == 0, "Mock-only PowerShell fixture failed: " + result.StandardError);
        var actual = JsonDocument.Parse(result.StandardOutput).RootElement;
        bool failed = actual.GetProperty("failure").ValueKind != JsonValueKind.Null;
        Assert(failed == (mode is "foreign" or "weakened" or "bad-readback"), "Generated PowerShell accepted foreign ownership or failed to configure the expected own entry.");
        var calls = actual.GetProperty("calls").EnumerateArray().Select(x => x.GetString()).ToArray();
        if (mode is "foreign" or "weakened") Assert(calls.Length == 0, "Foreign registrations were modified.");
        else if (mode != "bad-readback") Assert(calls.SequenceEqual(new[] { (mode == "missing" ? "add:" : "set:") + "1.1.1.1" }), "Owned template switch must use one in-place add/set.");
    }

    private static async Task ForeignTemplatesAsync() { await ConfigureScriptAsync("foreign"); await ConfigureScriptAsync("weakened"); }

    private sealed class Model : IDisposable
    {
        internal readonly string Root = Path.Combine(_work, "model-" + Guid.NewGuid().ToString("N"));
        internal DnsAdapterSnapshot[] Adapters;
        internal readonly Dictionary<string, NativeDohEntrySnapshot> Entries = new(StringComparer.OrdinalIgnoreCase);
        internal readonly List<string> Events = new();
        internal readonly WindowsNativeDohController Native;
        internal readonly WindowsDnsController Dns;
        internal HashSet<string>? PhysicalGuids;
        internal readonly HashSet<string> DisconnectedGuids = new(StringComparer.OrdinalIgnoreCase);
        internal readonly TransactionJournal Journal;
        internal readonly OperationDispatcher Dispatcher;
        internal bool FailApply;
        internal bool ForbidDnsWrites;
        internal bool ForbidNativeWrites;
        internal bool EnforceSwitchOrder;
        internal int BootstrapCalls;
        internal bool FailBootstrap;
        internal Model(DnsAdapterSnapshot[]? current = null)
        {
            Adapters = current ?? new[] { Baseline with { Ipv4 = new[] { "1.1.1.1" }, Ipv4Static = true } };
            Native = new WindowsNativeDohController(Root, NativeScript);
            Journal = new TransactionJournal(Root);
            Dns = new WindowsDnsController(DnsScript);
            Dispatcher = new OperationDispatcher(new ServiceOptions("test-no-pipe", Root, true, true, null), Dns, Native, null, Journal, new ServiceLog(Root), (payload, query, token) =>
            {
                Assert(query && payload.GetProperty("method").GetString() == "bootstrapServers", "Unexpected or mutating bootstrap worker call.");
                BootstrapCalls++; Events.Add("bootstrap.query");
                if (FailBootstrap) throw new IOException("controlled candidate HTTPS verification failure");
                return Task.FromResult(JsonDefaults.ToElement(new { url = OldUrl, servers = new[] { "9.9.9.9" }, knownProvider = false }));
            });
            Entries["1.1.1.1"] = new("1.1.1.1", true, OldUrl, false, true);
        }
        private static string[] JsonInputs(string script) => Regex.Matches(script, "ConvertFrom-Json -InputObject '((?:''|[^'])*)'").Select(x => x.Groups[1].Value.Replace("''", "'")).ToArray();
        private static T Parse<T>(string json) => JsonSerializer.Deserialize<T>(json, JsonDefaults.Options)!;
        private static ProcessResult Result<T>(T value) => new(0, Json(value), "");
        private static DnsAdapterSnapshot[] Targets(string script) => Parse<DnsAdapterSnapshot[]>(JsonInputs(script)[0]);
        private static string[] Ips(string script, string variable) => Regex.Matches(Regex.Match(script, "\\$" + variable + " = @\\((.*?)\\)").Groups[1].Value, "'([^']+)'").Select(x => x.Groups[1].Value).ToArray();

        private Task<ProcessResult> DnsScript(string script, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            if (ForbidDnsWrites && (script.Contains("$operation = '") || script.Contains("$ipv4 = @(") || script.Contains("-ResetServerAddresses")))
                throw new InvalidOperationException("INERT_DNS_WRITE_GUARD");
            if (script.Contains("$operation = '"))
            {
                var targets = Targets(script); Events.Add("dns.restore");
                Adapters = Adapters.Select(current => targets.SingleOrDefault(x => x.InterfaceGuid == current.InterfaceGuid) ?? current).ToArray();
                return Task.FromResult(new ProcessResult(0, "", ""));
            }
            if (script.Contains("Set-DnsClientServerAddress") && script.Contains("-ResetServerAddresses"))
            {
                var targets = Targets(script); Events.Add("dns.reset");
                Adapters = Adapters.Select(current => targets.Any(x => x.InterfaceGuid == current.InterfaceGuid)
                    ? current with { Ipv4Static=false, Ipv6Static=false } : current).ToArray();
                return Task.FromResult(new ProcessResult(0,"",""));
            }
            if (script.Contains("$ipv4 = @("))
            {
                var targets = Targets(script); var v4 = Ips(script, "ipv4"); var v6 = Ips(script, "ipv6"); Events.Add("dns.apply");
                // Simulate a partially applied adapter followed by a command failure.
                Adapters = Adapters.Select(current => targets.Any(x => x.InterfaceGuid == current.InterfaceGuid) ? current with {
                    Ipv4 = v4.Length > 0 ? v4 : current.Ipv4, Ipv4Static = v4.Length > 0 || current.Ipv4Static,
                    Ipv6 = v6.Length > 0 ? v6 : current.Ipv6, Ipv6Static = v6.Length > 0 || current.Ipv6Static } : current).ToArray();
                return Task.FromResult(FailApply ? new ProcessResult(1, "", "controlled adapter apply failure") : new ProcessResult(0, "", ""));
            }
            if (script.Contains("$result = @()"))
            {
                Events.Add("dns.readback"); var inputs = JsonInputs(script);
                bool physical = script.Contains("Get-NetAdapter -Physical -ErrorAction Stop");
                Events.Add(inputs.Length > 0 ? "dns.explicit" : physical ? "dns.physical" : "dns.general");
                var actual = inputs.Length > 0 ? Adapters.Where(x => Parse<DnsAdapterSnapshot[]>(inputs[0]).Any(t => t.InterfaceGuid == x.InterfaceGuid)).ToArray() :
                    Adapters.Where(x => !DisconnectedGuids.Contains(x.InterfaceGuid) && (!physical || PhysicalGuids == null || PhysicalGuids.Contains(x.InterfaceGuid))).ToArray();
                return Task.FromResult(Result(actual));
            }
            if (script.Contains("flushdns")) { Events.Add("dns.flush"); return Task.FromResult(new ProcessResult(0, "", "")); }
            throw new InvalidOperationException("Unexpected DNS model script; no OS command was executed.");
        }

        private Task<ProcessResult> NativeScript(string script, CancellationToken token)
        {
            token.ThrowIfCancellationRequested(); var inputs = JsonInputs(script);
            if (ForbidNativeWrites && !script.Contains("$rows = @()") && !script.Contains("Get-NetRoute -AddressFamily IPv6"))
                throw new InvalidOperationException("INERT_NATIVE_WRITE_GUARD");
            if (script.Contains("Get-NetRoute -AddressFamily IPv6")) { Events.Add("native.route-read"); return Task.FromResult(new ProcessResult(0,"false","")); }
            if (script.Contains("$rows = @()"))
            {
                var rows = Parse<string[]>(inputs[0]).Select(server => Entries.GetValueOrDefault(server) ?? new(server, false, null, false, false)).ToArray();
                Events.Add("native.readback"); return Task.FromResult(Result(rows));
            }
            if (script.Contains("$previousUrl ="))
            {
                string url = Parse<string>(inputs[0]); var servers = Parse<string[]>(inputs[^1]);
                foreach (string server in servers) Entries[server] = new(server, true, url, false, true);
                Events.Add("native.configure"); return Task.FromResult(new ProcessResult(0, "", ""));
            }
            if (script.Contains("$snapshots = @()"))
            {
                var snapshots = Parse<NativeDohEntrySnapshot[]>(inputs[0]);
                if (EnforceSwitchOrder && snapshots.Any(x => x.ServerAddress == "1.1.1.1") && Parse<string>(inputs[1]) == OldUrl)
                {
                    Assert(Events.Contains("dns.apply") && Events.LastIndexOf("dns.readback") > Events.LastIndexOf("dns.apply"), "Old provider registration was removed before new adapter DNS readback.");
                    Assert(Adapters.All(x => x.Ipv4.SequenceEqual(new[] { "9.9.9.9" })), "Old provider registration was removed while an adapter still used it.");
                }
                foreach (var snapshot in snapshots) { if (snapshot.Existed) Entries[snapshot.ServerAddress] = snapshot; else Entries.Remove(snapshot.ServerAddress); }
                Events.Add("native.restore-or-remove"); return Task.FromResult(new ProcessResult(0, "", ""));
            }
            if (script.Contains("$configured = @()"))
            {
                foreach (var snapshot in Parse<NativeDohEntrySnapshot[]>(inputs[0])) if (snapshot.Existed) Entries[snapshot.ServerAddress] = snapshot;
                Events.Add("native.restore-removed"); return Task.FromResult(new ProcessResult(0, "", ""));
            }
            throw new InvalidOperationException("Unexpected native DNS model script; no OS command was executed.");
        }
        internal Task<ServiceResponse> Dispatch(string operation, object payload) => Dispatcher.DispatchAsync(new ServiceRequest(1, "test:" + Guid.NewGuid().ToString("N"), operation, JsonDefaults.ToElement(payload)), new ClientIdentity(Environment.ProcessId, Environment.ProcessPath!, true, "test"));
        public void Dispose() => Dispatcher.Dispose();
    }

    private static async Task SwitchAsync()
    {
        var newlyConnected = Baseline with { InterfaceGuid = "{22222222-2222-2222-2222-222222222222}", InterfaceIndex = 9, InterfaceAlias = "Wi-Fi", Ipv4Static = false, Ipv4 = new[] { "198.51.100.53" } };
        using var model = new Model(new[] { Baseline with { Ipv4 = new[] { "1.1.1.1" } }, newlyConnected }) { EnforceSwitchOrder = true };
        await model.Native.WriteOwnedStateAsync(Owned());
        var response = await model.Dispatch("dns.doh.apply", new { url = NewUrl, servers = new[] { "9.9.9.9" } });
        Assert(response.Ok, "Native provider switch failed: " + response.Error?.Message);
        var saved = (await model.Native.ReadOwnedStateAsync())!;
        Assert(saved.OriginalDnsAdapters!.Length == 2 && saved.OriginalDnsAdapters[0].Ipv4.SequenceEqual(Baseline.Ipv4) && saved.OriginalDnsAdapters[1].Ipv4.SequenceEqual(newlyConnected.Ipv4), "Switch discarded either original or newly connected adapter rollback baseline.");
        Assert(!model.Entries.ContainsKey("1.1.1.1") && model.Entries["9.9.9.9"].DohTemplate == NewUrl, "Obsolete/new native registrations were not reconciled.");
        Assert(await model.Journal.ReadActiveAsync() == null, "Successful mutation left an active crash marker.");
    }

    private static async Task RollbackAsync()
    {
        using var model = new Model { FailApply = true };
        await model.Native.WriteOwnedStateAsync(Owned());
        var response = await model.Dispatch("dns.doh.apply", new { url = NewUrl, servers = new[] { "9.9.9.9" } });
        Assert(!response.Ok && response.Error!.Message.Contains("controlled adapter apply failure"), "Injected partial DNS apply failure was not reported.");
        Assert(model.Adapters[0].Ipv4.SequenceEqual(new[] { "1.1.1.1" }) && model.Entries["1.1.1.1"].DohTemplate == OldUrl && !model.Entries.ContainsKey("9.9.9.9"), "Failed switch did not restore DNS/template state.");
        Assert((await model.Native.ReadOwnedStateAsync())!.Url == OldUrl && await model.Journal.ReadActiveAsync() == null, "Failed switch did not restore ownership or archive rollback.");
        string history = await File.ReadAllTextAsync(Path.Combine(model.Root, "transactions.jsonl"));
        Assert(JsonDocument.Parse(history.Trim()).RootElement.GetProperty("phase").GetString() == "rolledBack", "Durable transaction history omitted rollback outcome.");
    }

    private static async Task PartialRestoreAsync()
    {
        var peer = Baseline with { InterfaceIndex = 8, InterfaceGuid = "{33333333-3333-3333-3333-333333333333}" };
        var baseline = Baseline with { Ipv6 = new[] { "2001:db8::53" }, Ipv6Static = true };
        var ownedV4ExternalV6 = baseline with { Ipv4 = new[] { "1.1.1.1" }, Ipv6 = new[] { "2001:db8::99" } };
        var externalV4 = peer with { Ipv4 = new[] { "203.0.113.53" } };
        using var model = new Model(new[] { ownedV4ExternalV6, externalV4 });
        await model.Native.WriteOwnedStateAsync(Owned(baseline: new[] { baseline, peer }));
        var response = await model.Dispatch("dns.doh.remove", new { });
        Assert(response.Ok, "Native remove with an external peer failed: " + response.Error?.Message);
        Assert(model.Adapters[0].Ipv4.SequenceEqual(baseline.Ipv4) && model.Adapters[0].Ipv6.SequenceEqual(ownedV4ExternalV6.Ipv6) && model.Adapters[1].Ipv4.SequenceEqual(externalV4.Ipv4), "Owned DNS was left behind or external family/adapter was overwritten.");
    }

    private static async Task BootstrapRefreshAsync()
    {
        using var model = new Model(); await model.Native.WriteOwnedStateAsync(Owned());
        await model.Dispatcher.RefreshOwnedDnsBootstrapAsync(default);
        Assert(model.BootstrapCalls == 1 && model.Adapters[0].Ipv4.SequenceEqual(new[] { "9.9.9.9" }) && (await model.Native.ReadOwnedStateAsync())!.Servers.SequenceEqual(new[] { "9.9.9.9" }), "Core boot refresh did not transact changed native addresses.");
        Assert(model.Events.IndexOf("bootstrap.query") < model.Events.IndexOf("native.configure"), "Native entries changed before verified bootstrap query returned.");
        await model.Dispatcher.RefreshOwnedDnsBootstrapAsync(default);
        Assert(model.BootstrapCalls == 1 && await model.Journal.ReadActiveAsync() == null, "Repeated boot ticks replayed refresh or left a crash marker.");
        using var failedApply = new Model { FailApply = true }; await failedApply.Native.WriteOwnedStateAsync(Owned());
        try { await failedApply.Dispatcher.RefreshOwnedDnsBootstrapAsync(default); throw new InvalidOperationException("Expected failed automatic native transaction."); }
        catch (InvalidOperationException error) when (error.Message.Contains("controlled adapter apply failure")) { }
        Assert(failedApply.Adapters[0].Ipv4.SequenceEqual(new[] { "1.1.1.1" }) && (await failedApply.Native.ReadOwnedStateAsync())!.Url == OldUrl, "Failed automatic rotation was not rolled back.");
    }

    private static async Task BootstrapDeferralAsync()
    {
        using var candidate = new Model { FailBootstrap = true }; await candidate.Native.WriteOwnedStateAsync(Owned());
        try { await candidate.Dispatcher.RefreshOwnedDnsBootstrapAsync(default); throw new InvalidOperationException("Expected candidate preflight failure."); }
        catch (IOException) { }
        await candidate.Dispatcher.RefreshOwnedDnsBootstrapAsync(default);
        Assert(candidate.BootstrapCalls == 1 && !candidate.Events.Contains("native.configure"), "Candidate failure was immediately retried or mutated native DNS.");
        var ipv6Baseline = Baseline with { Ipv6 = new[] { "2001:db8::53" }, Ipv6Static = true };
        using var external = new Model(new[] { ipv6Baseline with { Ipv4 = new[] { "1.1.1.1" }, Ipv6 = new[] { "2001:db8::99" } } });
        await external.Native.WriteOwnedStateAsync(Owned(new[] { "1.1.1.1", "2606:4700:4700::1111" }, new[] { ipv6Baseline }));
        external.Entries["2606:4700:4700::1111"] = new("2606:4700:4700::1111", true, OldUrl, false, true);
        try { await external.Dispatcher.RefreshOwnedDnsBootstrapAsync(default); throw new InvalidOperationException("Expected mixed external family deferral."); }
        catch (InvalidOperationException error) when (error.Message.Contains("externally changed")) { }
        Assert(external.BootstrapCalls == 0 && !external.Events.Contains("dns.apply"), "Automatic refresh overwrote a mixed owned/external family.");
        using var missing = new Model(); await missing.Native.WriteOwnedStateAsync(Owned(baseline: new[] { Baseline, Baseline with { InterfaceGuid = "{44444444-4444-4444-4444-444444444444}" } }));
        var rejected = await missing.Dispatch("dns.doh.apply", new { url = NewUrl, servers = new[] { "9.9.9.9" } });
        Assert(!rejected.Ok && rejected.Error?.Code == "DNS_ADAPTER_UNAVAILABLE" && !missing.Events.Contains("native.configure"), "Provider switch deleted registration for an absent recorded adapter.");
        using var family = new Model(); await family.Native.WriteOwnedStateAsync(Owned(new[] { "1.1.1.1", "2606:4700:4700::1111" }));
        var unavailable = await family.Dispatch("dns.doh.apply", new { url = NewUrl, servers = new[] { "9.9.9.9" } });
        Assert(!unavailable.Ok && unavailable.Error?.Code == "DNS_FAMILY_UNAVAILABLE" && !family.Events.Contains("native.configure"), "A replacement without a managed family removed its still-used encrypted DNS registration.");
    }

    private static async Task ModeGuardsAsync()
    {
        using var native = new Model(); await native.Native.WriteOwnedStateAsync(Owned());
        foreach (string method in new[] { "apply", "restart", "recover" })
        {
            var blocked = await native.Dispatch("component.execute", new { component = "SystemDoH", method, args = new object[] { new { enabled = true } } });
            Assert(!blocked.Ok && blocked.Error?.Code == "DNS_MODE_CONFLICT", "A worker mutation bypassed native ownership mode guard: " + method + ": " + blocked.Error?.Message);
        }
        using var local = new Model(); string localFile = Path.Combine(local.Root, "Runtime", "SystemDoH", "state.json");
        Directory.CreateDirectory(Path.GetDirectoryName(localFile)!); await File.WriteAllTextAsync(localFile, "{}");
        var response = await local.Dispatch("dns.doh.apply", new { url = NewUrl, servers = new[] { "9.9.9.9" } });
        Assert(!response.Ok && response.Error?.Code == "DNS_MODE_CONFLICT" && !local.Events.Any(x => x is "dns.apply" or "native.configure"), "A native mutation bypassed local saved mode guard.");
    }

    private static async Task ListenerSnapshotScriptAsync()
    {
        string executable = Path.Combine(_work, "owned-tg-wrapper.exe");
        var born = DateTimeOffset.Parse("2026-09-29T00:00:00Z");
        foreach (string mode in new[] { "owned", "foreign", "missing", "unstable" })
        {
            var processes = new[] { new { processId = 10, parentProcessId = 0, creationDate = born, executablePath = executable },
                new { processId = 20, parentProcessId = 10, creationDate = born.AddSeconds(1), executablePath = "child.exe" },
                new { processId = 99, parentProcessId = 0, creationDate = born.AddSeconds(-1), executablePath = "relay.exe" } };
            var listeners = mode == "missing" ? Array.Empty<object>() : new object[] { new { localAddress = "127.0.0.1", localPort = 1443, owningProcess = mode == "foreign" ? 99 : 20 } };
            string mocks = "\n$global:fixtureProcesses = @(foreach ($item in (ConvertFrom-Json -InputObject '" + Json(processes).Replace("'", "''") + "')) { $item })\n" +
                "$global:fixtureListeners = @(foreach ($item in (ConvertFrom-Json -InputObject '" + Json(listeners).Replace("'", "''") + "')) { $item })\n" +
                "$global:serviceReads = 0\nfunction Get-CimInstance { [CmdletBinding()] param([string]$ClassName, [string]$Filter) if ($ClassName -eq 'Win32_Process') { return $global:fixtureProcesses }; $global:serviceReads++; [pscustomobject]@{ ProcessId=" +
                (mode == "unstable" ? "$(if ($global:serviceReads -gt 1) { 11 } else { 10 })" : "10") + "; State='Running' } }\n" +
                "function Get-NetTCPConnection { [CmdletBinding()] param([string]$State) return $global:fixtureListeners }\n";
            string fixture = Path.Combine(_work, "listener-snapshot-" + mode + ".ps1");
            await File.WriteAllTextAsync(fixture, mocks + OwnedTcpListenerProbe.CreateSnapshotScript("EgoistShieldTelegramProxy", 1443), new UTF8Encoding(true));
            var result = await ProcessRunner.RunAsync(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
                new[] { "-NoProfile", "-NonInteractive", "-File", fixture }, TimeSpan.FromSeconds(10));
            Assert(result.ExitCode == 0, "Read-only mocked listener snapshot failed: " + result.StandardError);
            await File.WriteAllTextAsync(fixture + ".result.txt", result.StandardOutput + "\n" + result.StandardError);
            var snapshot = JsonSerializer.Deserialize<ServiceListenerSnapshot>(result.StandardOutput, JsonDefaults.Options)!;
            var ownership = OwnedTcpListenerProbe.Classify(snapshot, IPAddress.Loopback, 1443, executable);
            var expected = mode switch { "owned" => TcpListenerOwnership.Owned, "foreign" => TcpListenerOwnership.Foreign, "missing" => TcpListenerOwnership.Missing, _ => TcpListenerOwnership.Unknown };
            Assert(ownership == expected && snapshot.Processes.Length <= 3, "PowerShell snapshot lost stable SCM identity, process ancestry or listener address: " + mode + ": " + ownership);
        }
    }

    private static async Task IdentityProbeScopeAsync()
    {
        using var model = new Model();
        var normal = new ClientIdentity(Environment.ProcessId, Environment.ProcessPath!, true, "test");
        var probe = normal with { IdentityProbe = true };
        var request = new ServiceRequest(1, "scope:cached-status", "service.status", JsonDefaults.ToElement(new { }));
        Assert((await model.Dispatcher.DispatchAsync(request, normal)).Ok, "Normal status request failed.");
        Assert((await model.Dispatcher.DispatchAsync(request, probe)).Error?.Code == "IDENTITY_PROBE_SCOPE", "Probe received a cached forbidden response.");
        Assert((await model.Dispatcher.DispatchAsync(request with { RequestId = "scope:fresh-status" }, probe)).Error?.Code == "IDENTITY_PROBE_SCOPE", "Probe scope permits fresh non-hello execution.");
        var mutation = new ServiceRequest(1, "scope:durable", "test.delay-mutation", JsonDefaults.ToElement(new { delayMs = 1 }));
        Assert((await model.Dispatcher.DispatchAsync(mutation, normal)).Ok, "Test-only durable mutation failed.");
        using var restarted = new OperationDispatcher(new ServiceOptions("test-no-pipe", model.Root, true, true, null), new WindowsDnsController((_, _) => throw new InvalidOperationException("Unexpected OS DNS call")), model.Native, null, model.Journal, new ServiceLog(model.Root));
        Assert((await restarted.DispatchAsync(mutation, probe)).Error?.Code == "IDENTITY_PROBE_SCOPE", "Probe received a forbidden durable response after restart.");
        var pending = mutation with { RequestId = "scope:in-flight", Payload = JsonDefaults.ToElement(new { delayMs = 300 }) };
        var running = model.Dispatcher.DispatchAsync(pending, normal);
        Assert((await model.Dispatcher.DispatchAsync(pending, probe)).Error?.Code == "IDENTITY_PROBE_SCOPE", "In-flight request lookup bypassed scope validation.");
        Assert((await running).Ok, "Scoped rejection interrupted the authorized request.");
        var rejectedFirst = request with { RequestId = "scope:rejected-first" };
        Assert((await model.Dispatcher.DispatchAsync(rejectedFirst, probe)).Error?.Code == "IDENTITY_PROBE_SCOPE" && (await model.Dispatcher.DispatchAsync(rejectedFirst, normal)).Ok, "Scope denial contaminated the authorized caller cache.");
        Assert((await model.Dispatcher.DispatchAsync(new ServiceRequest(1, "scope:hello", "hello", JsonDefaults.ToElement(new { })), probe)).Ok, "Probe lost its permitted hello operation.");
    }

    private static async Task UnverifiedRuntimeRootAsync()
    {
        string root = Path.Combine(_work, "unverified-runtime"); Directory.CreateDirectory(root);
        var controller = new OwnedServiceController(root, root, false);
        foreach (string name in OwnedServiceIntentStore.ServiceNames)
        {
            var calls = new Func<Task>[] {
                async () => { await controller.StartAsync(name); },
                async () => { await controller.InstallAsync(name); },
                () => controller.RepairRecoveryAsync(name, default),
                () => controller.RestoreStartTypeAsync(name, "auto")
            };
            foreach (var call in calls)
            {
                try { await call(); throw new InvalidOperationException("Unverified runtime execution was permitted."); }
                catch (ServiceOperationException error) when (error.Code == "PROTECTED_ROOT_UNVERIFIED") { }
            }
        }
        Assert(!Directory.EnumerateFileSystemEntries(root).Any(), "The blocked calls wrote runtime files before validation.");
        // A no-op rollback must remain available even while execution is blocked.
        await controller.RestoreStartTypeAsync(OwnedServiceIntentStore.ServiceNames[0], null);
    }

    private static Task ListenerSnapshotContractAsync()
    {
        string executable = Path.Combine(_work, "owned-tg-wrapper.exe");
        var birth = DateTimeOffset.Parse("2026-09-29T00:00:00Z");
        var rows = new[] { new ListenerProcess(10, 0, birth, executable),
            new ListenerProcess(20, 10, birth.AddSeconds(1), Path.Combine(_work, "owned-child.exe")),
            new ListenerProcess(99, 0, birth.AddSeconds(-1), Path.Combine(_work, "actual-foreign-relay.exe")) };
        var mixed = new ServiceListenerSnapshot(10, "Running", rows, new[] {
            new ListenerEndpoint("127.0.0.1", 1445, 20), new ListenerEndpoint("0.0.0.0", 1445, 99),
            new ListenerEndpoint("::1", 1445, 20) }, true);
        var ipv4 = TelegramListenerSnapshotCommand.DescribeFamily(mixed, IPAddress.Loopback, 1445, executable);
        Assert(ipv4.State == "foreign" && ipv4.OwnerPid == 99 && ipv4.OwnerName == "actual-foreign-relay.exe" && ipv4.OwnerCreatedAt == rows[2].CreatedAt,
            "Mixed owned+foreign listeners reported the first owned process as the conflicting owner.");
        var ipv6 = TelegramListenerSnapshotCommand.DescribeFamily(mixed, IPAddress.IPv6Loopback, 1445, executable);
        Assert(ipv6.State == "owned" && ipv6.OwnerPid == 20 && ipv6.OwnerCreatedAt == rows[1].CreatedAt, "IPv4 wildcard conflict incorrectly changed IPv6 proof.");
        var missing = TelegramListenerSnapshotCommand.DescribeFamily(mixed, IPAddress.Loopback, 49123, executable);
        Assert(missing.State == "missing" && missing.OwnerPid == null && missing.OwnerName == null && missing.OwnerCreatedAt == null, "Missing listener invented an owner.");
        var unknown = TelegramListenerSnapshotCommand.DescribeFamily(null, IPAddress.Loopback, 1445, executable);
        Assert(unknown.State == "unknown" && unknown.OwnerPid == null, "Unavailable native metadata was treated as a missing or owned listener.");
        using var response = JsonDocument.Parse(TelegramListenerSnapshotCommand.SerializeSnapshot(mixed, 1445, executable));
        Assert(response.RootElement.GetProperty("rootProcessPathVerified").GetBoolean() && response.RootElement.GetProperty("ipv4").GetProperty("ownerPid").GetInt32() == 99,
            "Serialized contract lost fixed wrapper path proof or actual conflicting owner.");
        var large = mixed with { Processes = rows.Concat(Enumerable.Range(200, 64).Select(id => new ListenerProcess(id, 0, birth, new string('x', 3000)))).ToArray() };
        string bounded = TelegramListenerSnapshotCommand.SerializeSnapshot(large, 1445, executable);
        using var oversized = JsonDocument.Parse(bounded);
        Assert(Encoding.UTF8.GetByteCount(bounded) <= 60 * 1024 && !oversized.RootElement.GetProperty("snapshotAvailable").GetBoolean() &&
            oversized.RootElement.GetProperty("ownership").GetString() == "unknown" && oversized.RootElement.GetProperty("snapshot").ValueKind == JsonValueKind.Null,
            "Oversized metadata exceeded the GUI limit or dropped proof while reporting health.");
        return Task.CompletedTask;
    }

    private static async Task ListenerSnapshotArgumentsAsync()
    {
        string[][] invalid = {
            new[] { "--telegram-listener-snapshot" }, new[] { "--port", "1445" },
            new[] { "--telegram-listener-snapshot", "--port", "0" }, new[] { "--telegram-listener-snapshot", "--port", "65536" },
            new[] { "--telegram-listener-snapshot", "--port", "+1445" }, new[] { "--telegram-listener-snapshot", "--port", "-1" },
            new[] { "--telegram-listener-snapshot", "--port", "1.5" }, new[] { "--telegram-listener-snapshot", "--port", "1445", "--console" },
            new[] { "--telegram-listener-snapshot", "--port", "1445", "--recover-active" },
            new[] { "--telegram-listener-snapshot", "--port", "1445", "--remove-native-doh" },
            new[] { "--telegram-listener-snapshot", "--port", "1445", "configure", "--install-root", _work },
            new[] { "--telegram-listener-snapshot", "--port", "1445", "--state-root", Path.Combine(_work, "must-not-exist") }
        };
        var beforeOut = Console.Out; var beforeError = Console.Error;
        try
        {
            foreach (var args in invalid)
            {
                using var output = new StringWriter(); using var error = new StringWriter();
                Console.SetOut(output); Console.SetError(error);
                Assert(await EgoistShield.Service.Program.Main(args) == 1 && output.ToString().Length == 0 && error.ToString().Contains("ArgumentException"),
                    "Invalid read-only CLI arguments reached another service mode: " + string.Join(' ', args));
            }
        }
        finally { Console.SetOut(beforeOut); Console.SetError(beforeError); }
        Assert(!Directory.Exists(Path.Combine(_work, "must-not-exist")), "Rejected CLI created a service state directory.");
    }

    private static async Task ActualListenerSnapshotCommandAsync()
    {
        var beforeOut = Console.Out; var beforeError = Console.Error;
        using var output = new StringWriter(); using var error = new StringWriter(); var elapsed = Stopwatch.StartNew();
        try
        {
            Console.SetOut(output); Console.SetError(error);
            Assert(await EgoistShield.Service.Program.Main(new[] { "--telegram-listener-snapshot", "--port", "49123" }) == 0, "Actual native inspection CLI failed.");
        }
        finally { Console.SetOut(beforeOut); Console.SetError(beforeError); }
        string json = output.ToString().Trim(); using var doc = JsonDocument.Parse(json); var value = doc.RootElement;
        Assert(value.GetProperty("schemaVersion").GetInt32() == 2 && value.GetProperty("operation").GetString() == "telegram-listener-snapshot" &&
            value.GetProperty("serviceName").GetString() == "EgoistShieldTelegramProxy" && value.GetProperty("port").GetInt32() == 49123 &&
            !value.GetProperty("remoteConnectivityVerified").GetBoolean() && error.ToString().Length == 0 && Encoding.UTF8.GetByteCount(json) <= 60 * 1024 && elapsed.Elapsed < TimeSpan.FromSeconds(4),
            "Actual inspection emitted another mode, unbounded output or a false remote-connectivity claim.");
        foreach (string family in new[] { "ipv4", "ipv6" })
        {
            string? state = value.GetProperty(family).GetProperty("state").GetString();
            Assert(state is "owned" or "foreign" or "missing" or "unknown", "Actual native metadata has an unsupported family state.");
        }
        await File.WriteAllTextAsync(Path.Combine(_work, "actual-read-only-cli.json"), json);
    }

    private static async Task LogLockAsync()
    {
        string root = Path.Combine(_work, "locked-log"); var log = new ServiceLog(root); string file = Path.Combine(root, "service.log");
        await File.WriteAllTextAsync(file, "before\n");
        await using (var lockFile = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) await log.InfoAsync("completed mutation while diagnostic file locked");
        await log.InfoAsync("diagnostic logging resumed");
        Assert((await File.ReadAllTextAsync(file)).Contains("diagnostic logging resumed"), "Log writer failed to resume after file lock release.");
    }
}
