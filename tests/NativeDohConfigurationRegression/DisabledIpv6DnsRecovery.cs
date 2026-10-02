using EgoistShield.Service;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace NativeDohRegression;

internal static partial class Program
{
    private static async Task DisabledIpv6RecoveryAsync()
    {
        foreach (string mode in new[] { "owned", "canonical", "foreign", "original", "registry-unavailable", "bad-readback" })
        {
            string stateRoot = Path.Combine(_work, "disabled-ipv6-" + mode);
            Directory.CreateDirectory(stateRoot);
            var before = new DnsAdapterSnapshot(15, "Ethernet", "{941FE8BA-A292-4A5E-BA15-7C10CE6CC61F}", new[] { "127.0.0.1" }, Array.Empty<string>(), true, false);
            bool staticV6 = mode != "original";
            int writes = 0, executions = 0;
            string configured = mode == "foreign" ? "2001:db8::99" : mode == "canonical" ? "0:0:0:0:0:0:0:1" : mode == "original" ? "" : "::1";
            var dns = new WindowsDnsController(async (script, token) =>
            {
                if (!script.Contains("$operation = 'dns.apply'"))
                    return new ProcessResult(0, Json(new[] { before with { Ipv6Static = staticV6 } }), "");
                string mocks = """
                    $global:configuredV6 = '__CONFIGURED__'
                    $global:mockCalls = New-Object System.Collections.Generic.List[string]
                    $global:v6Reads = 0
                    function Get-NetAdapter { [CmdletBinding()] param([int]$InterfaceIndex) [pscustomobject]@{ ifIndex=15; Name='Ethernet'; InterfaceGuid='{941FE8BA-A292-4A5E-BA15-7C10CE6CC61F}' } }
                    function Get-DnsClientServerAddress {
                      [CmdletBinding()] param([int]$InterfaceIndex,[string]$AddressFamily)
                      [pscustomobject]@{ServerAddresses=$(if ($AddressFamily -eq 'IPv4') { @('127.0.0.1') } else { @() })}
                    }
                    function Get-ItemProperty {
                      [CmdletBinding()] param([string]$Path,[string]$LiteralPath,[string]$Name)
                      $key = if ($LiteralPath) { $LiteralPath } else { $Path }
                      if ($key.Contains('Tcpip6')) {
                        $global:v6Reads++
                        if ('__MODE__' -eq 'registry-unavailable' -and $global:v6Reads -gt 1) { throw 'Registry unavailable' }
                        return [pscustomobject]@{NameServer=$global:configuredV6}
                      }
                      [pscustomobject]@{NameServer='127.0.0.1'}
                    }
                    function netsh.exe {
                      $global:mockCalls.Add(($args -join ' '))
                      if (($args -join ' ') -ne 'interface ipv6 set dnsservers name=15 source=dhcp validate=no') { throw 'Unexpected mutation' }
                      if ('__MODE__' -ne 'bad-readback') { $global:configuredV6='' }
                      $global:LASTEXITCODE=0
                    }
                    function ipconfig.exe { $global:LASTEXITCODE=0 }
                    $failure=$null
                    try {
                    """.Replace("__CONFIGURED__", configured).Replace("__MODE__", mode);
                string fixture = Path.Combine(stateRoot, "restore.ps1");
                await File.WriteAllTextAsync(fixture, mocks + "\n" + script + "\n} catch { $failure=$_.Exception.Message }\n[pscustomobject]@{failure=$failure; calls=@($global:mockCalls); configured=$global:configuredV6} | ConvertTo-Json -Compress\n", new UTF8Encoding(true), token);
                var result = await ProcessRunner.RunAsync(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"), new[] { "-NoProfile", "-NonInteractive", "-File", fixture }, TimeSpan.FromSeconds(20), token);
                await File.WriteAllTextAsync(fixture + ".result.txt", result.StandardOutput + "\n" + result.StandardError, token);
                Assert(result.ExitCode == 0, "Generated rollback fixture failed: " + result.StandardError);
                var actual = JsonDocument.Parse(result.StandardOutput).RootElement;
                writes = actual.GetProperty("calls").GetArrayLength();
                staticV6 = actual.GetProperty("configured").GetString() != "";
                string? failure = actual.GetProperty("failure").GetString();
                return new ProcessResult(failure == null ? 0 : 1, "", failure ?? "");
            });
            var journal = new TransactionJournal(stateRoot);
            var now = DateTimeOffset.UtcNow;
            await journal.CreateActiveAsync(new ActiveTransaction(1, "EgoistShield", Guid.NewGuid().ToString("N"), "failed-dns-" + mode, "dns", "dns.apply", TransactionPhase.RecoveryRequired,
                JsonDefaults.ToElement(new DnsOwnedTransactionSnapshot(new[] { before }, null)), JsonDefaults.ToElement(new { servers = new[] { "127.0.0.1", "::1" } }), now, now, "IPv6 verification failed"));
            using var dispatcher = new OperationDispatcher(new ServiceOptions("unused-fixture", stateRoot, true, true, null), dns,
                new WindowsNativeDohController(stateRoot, (_, _) => throw new InvalidOperationException("No native DoH calls expected")), null, journal, new ServiceLog(stateRoot),
                (_, _, _) => { executions++; return Task.FromResult(JsonDefaults.ToElement(new { saved = true })); });
            var identity = new ClientIdentity(Environment.ProcessId, Environment.ProcessPath!, true, "fixture-user");
            var route = JsonDefaults.ToElement(new { component = "Zapret", method = "saveUserLists", args = new[] { new { generalDomains = new[] { "app.vidiq.com", "fut.gg" }, excludedDomains = Array.Empty<string>(), includedCidrs = Array.Empty<string>(), excludedCidrs = Array.Empty<string>() } } });
            var blocked = await dispatcher.DispatchAsync(new ServiceRequest(1, "blocked-" + mode, "component.execute", route), identity);
            Assert(!blocked.Ok && blocked.Error?.Code == "RECOVERY_REQUIRED" && executions == 0, "Unrecovered DNS must retain the mutation gate");
            var repair = await dispatcher.DispatchAsync(new ServiceRequest(1, "repair-" + mode, "network.repair-owned", JsonDefaults.ToElement(new { })), identity);
            bool expectedOk = mode is "owned" or "canonical" or "original";
            Assert(repair.Ok == expectedOk, mode + ": unexpected repair result: " + Json(repair));
            Assert(writes == (mode is "owned" or "canonical" or "bad-readback" ? 1 : 0), mode + ": incorrect write count");
            Assert((await journal.ReadActiveAsync() == null) == expectedOk, mode + ": recovery marker must follow verified outcome");
            if (expectedOk)
            {
                var saved = await dispatcher.DispatchAsync(new ServiceRequest(1, "routes-" + mode, "component.execute", route), identity);
                Assert(saved.Ok && executions == 1, mode + ": successful repair did not unblock route saving");
            }
            Console.WriteLine("PASS: disabled IPv6 recovery " + mode);
        }
    }
}