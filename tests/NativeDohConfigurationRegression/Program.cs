using EgoistShield.Service;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace NativeDohRegression;

internal static class Program
{
    private static string _work = "";
    private static int _passed;
    private const string OldUrl = "https://old.example/dns-query";
    private const string NewUrl = "https://new.example/dns-query";
    private static readonly DnsAdapterSnapshot Baseline = new(4, "Ethernet", "{11111111-1111-1111-1111-111111111111}", new[] { "192.0.2.53" }, Array.Empty<string>(), true, false);

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
            await Check("optional log locking does not fail network operations", LogLockAsync);
            await Check("generated listener ownership snapshot is bounded and stable in PowerShell5.1", ListenerSnapshotScriptAsync);
            Console.WriteLine($"Native DoH/Core regression passed: {_passed} groups; runtime={System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription}; elapsed={elapsed.Elapsed.TotalSeconds:0.00}s; work={_work}");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); Console.Error.WriteLine("Evidence preserved: " + _work); return 1; }
    }

    private static async Task Check(string name, Func<Task> run) { await run(); _passed++; Console.WriteLine("PASS: " + name); }
    private static void Assert(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    private static string Json<T>(T value) => JsonSerializer.Serialize(value, JsonDefaults.StateOptions);

    private static NativeDohOwnedState Owned(string[]? servers = null, DnsAdapterSnapshot[]? baseline = null) => new(1, "EgoistShield", OldUrl, servers ?? new[] { "1.1.1.1" }, DateTimeOffset.UtcNow,
        (servers ?? new[] { "1.1.1.1" }).Select(server => new NativeDohEntrySnapshot(server, false, null, false, false)).ToArray(), baseline ?? new[] { Baseline });

    private static async Task ConfigureScriptAsync(string mode)
    {
        var initial = mode == "missing" ? Array.Empty<NativeDohEntrySnapshot>() : new[] {
            new NativeDohEntrySnapshot("1.1.1.1", true, mode == "foreign" ? "https://foreign.example/dns-query" : mode == "bad-readback" ? NewUrl : OldUrl, mode == "weakened", true) };
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
        if (mode == "bad-readback") mocks += "\nfunction Set-DnsClientDohServerAddress { [CmdletBinding()] param([string]$ServerAddress, [string]$DohTemplate, [bool]$AllowFallbackToUdp, [bool]$AutoUpgrade) $global:mockEntries[$ServerAddress].allowFallbackToUdp = $true }\n";
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
        internal readonly TransactionJournal Journal;
        internal readonly OperationDispatcher Dispatcher;
        internal bool FailApply;
        internal bool EnforceSwitchOrder;
        internal int BootstrapCalls;
        internal bool FailBootstrap;
        internal Model(DnsAdapterSnapshot[]? current = null)
        {
            Adapters = current ?? new[] { Baseline with { Ipv4 = new[] { "1.1.1.1" }, Ipv4Static = true } };
            Native = new WindowsNativeDohController(Root, NativeScript);
            Journal = new TransactionJournal(Root);
            Dispatcher = new OperationDispatcher(new ServiceOptions("test-no-pipe", Root, true, true, null), new WindowsDnsController(DnsScript), Native, null, Journal, new ServiceLog(Root), (payload, query, token) =>
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
            if (script.Contains("$operation = '"))
            {
                var targets = Targets(script); Events.Add("dns.restore");
                Adapters = Adapters.Select(current => targets.SingleOrDefault(x => x.InterfaceGuid == current.InterfaceGuid) ?? current).ToArray();
                return Task.FromResult(new ProcessResult(0, "", ""));
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
                var actual = inputs.Length > 0 ? Adapters.Where(x => Parse<DnsAdapterSnapshot[]>(inputs[0]).Any(t => t.InterfaceGuid == x.InterfaceGuid)).ToArray() : Adapters;
                return Task.FromResult(Result(actual));
            }
            if (script.Contains("flushdns")) { Events.Add("dns.flush"); return Task.FromResult(new ProcessResult(0, "", "")); }
            throw new InvalidOperationException("Unexpected DNS model script; no OS command was executed.");
        }

        private Task<ProcessResult> NativeScript(string script, CancellationToken token)
        {
            token.ThrowIfCancellationRequested(); var inputs = JsonInputs(script);
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

    private static async Task LogLockAsync()
    {
        string root = Path.Combine(_work, "locked-log"); var log = new ServiceLog(root); string file = Path.Combine(root, "service.log");
        await File.WriteAllTextAsync(file, "before\n");
        await using (var lockFile = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) await log.InfoAsync("completed mutation while diagnostic file locked");
        await log.InfoAsync("diagnostic logging resumed");
        Assert((await File.ReadAllTextAsync(file)).Contains("diagnostic logging resumed"), "Log writer failed to resume after file lock release.");
    }
}
