using EgoistShield.Service;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace NativeDohRegression;

internal static partial class Program
{
    private static async Task DisabledIpv6ApplyAsync()
    {
        var failures = new List<string>();
        foreach (string mode in new[] { "disabled", "disabled-static", "enabled", "binding-unknown", "ipv6-only", "ipv4-disabled", "binding-before", "binding-after", "enabled-binding-after", "bad-v4-readback", "bad-v6-readback", "skipped-static-changed", "skipped-config-changed", "binding-readback-change", "legacy-enabled", "legacy-disabled" })
        {
            try { await DisabledIpv6ApplyCaseAsync(mode); Console.WriteLine("PASS: binding-aware DNS apply " + mode); }
            catch (Exception error) { failures.Add(mode + ": " + error.Message); Console.WriteLine("FAIL: binding-aware DNS apply " + mode + ": " + error.Message); }
        }
        Assert(failures.Count == 0, string.Join(" | ", failures));
    }

    private static async Task DisabledIpv6ApplyCaseAsync(string mode)
    {
        string root = Path.Combine(_work, "ipv6-apply-" + mode);
        Directory.CreateDirectory(root);
        string statePath = Path.Combine(root, "mock-state.json");
        var state = new JsonObject {
            ["v4Binding"] = mode != "ipv4-disabled", ["v6Binding"] = mode is "enabled" or "enabled-binding-after" or "bad-v6-readback" or "legacy-enabled",
            ["v4"] = new JsonArray("192.0.2.53"), ["v6"] = new JsonArray(), ["v4Static"] = true, ["v6Static"] = mode is "disabled-static" or "skipped-config-changed",
            ["configuredV6"] = mode is "disabled-static" or "skipped-config-changed" ? "2001:db8::99" : "", ["calls"] = new JsonArray()
        };
        if (mode == "binding-unknown") state["v6Binding"] = null;
        await File.WriteAllTextAsync(statePath, state.ToJsonString(), new UTF8Encoding(true));
        int sequence = 0;
        var dns = new WindowsDnsController(async (script, token) =>
        {
            string fixture = Path.Combine(root, "generated-" + (++sequence) + ".ps1");
            string mocks = """
                $global:mockState = Get-Content -LiteralPath '__STATE__' -Raw | ConvertFrom-Json
                function Get-NetAdapter {
                  [CmdletBinding()] param([int]$InterfaceIndex)
                  [pscustomobject]@{ifIndex=15; Name='Ethernet'; InterfaceGuid='{941FE8BA-A292-4A5E-BA15-7C10CE6CC61F}'; InterfaceDescription='Fixture Ethernet'}
                }
                function Get-NetIPInterface {
                  [CmdletBinding()] param()
                  [pscustomobject]@{InterfaceIndex=15;InterfaceAlias='Ethernet';ConnectionState='Connected';InterfaceMetric=10}
                }
                function Get-NetAdapterBinding {
                  [CmdletBinding()] param([string]$Name,[string]$ComponentID)
                  if ('__MODE__' -eq 'binding-readback-change' -and @($global:mockState.calls).Count -gt 0 -and $ComponentID -eq 'ms_tcpip6') {
                    if ($script:readbackV6Seen) { $global:mockState.v6Binding=$true }; $script:readbackV6Seen=$true
                  }
                  $enabled = if ($ComponentID -eq 'ms_tcpip') { $global:mockState.v4Binding } else { $global:mockState.v6Binding }
                  if ($null -eq $enabled) { throw 'Binding inspection unavailable' }
                  [pscustomobject]@{Name='Ethernet';ComponentID=$ComponentID;Enabled=[bool]$enabled}
                }
                function Get-DnsClientServerAddress {
                  [CmdletBinding()] param([int]$InterfaceIndex,[string]$AddressFamily)
                  $addresses = if ($AddressFamily -eq 'IPv4') { @($global:mockState.v4) } elseif ($global:mockState.v6Binding) { @($global:mockState.v6) } else { @() }
                  if ('__MODE__' -eq 'bad-v6-readback' -and @($global:mockState.calls).Count -gt 0 -and $AddressFamily -eq 'IPv6') { $addresses=@() }
                  [pscustomobject]@{ServerAddresses=@($addresses)}
                }
                function Get-ItemProperty {
                  [CmdletBinding()] param([string]$Path,[string]$LiteralPath,[string]$Name)
                  $key=if ($LiteralPath) { $LiteralPath } else { $Path }
                  $configured=if ($key.Contains('Tcpip6')) { [string]$global:mockState.configuredV6 } elseif ($global:mockState.v4Static) { @($global:mockState.v4) -join ',' } else { '' }
                  [pscustomobject]@{NameServer=$configured}
                }
                function Set-DnsClientServerAddress {
                  [CmdletBinding()] param([int]$InterfaceIndex,[string[]]$ServerAddresses,[bool]$Validate)
                  $global:mockState.calls=@($global:mockState.calls)+@('IPv4')
                  $global:mockState.v4=@($ServerAddresses);$global:mockState.v4Static=$true
                  if ('__MODE__' -eq 'bad-v4-readback') { $global:mockState.v4=@('192.0.2.99') }
                  if ('__MODE__' -eq 'binding-after') { $global:mockState.v6Binding=$true }
                  if ('__MODE__' -eq 'enabled-binding-after') { $global:mockState.v6Binding=$false }
                  if ('__MODE__' -eq 'skipped-config-changed') { $global:mockState.configuredV6='2001:db8::77' }
                  if ('__MODE__' -eq 'skipped-static-changed') { $global:mockState.v6Static=$true; $global:mockState.configuredV6='2001:db8::77' }
                }
                function netsh.exe {
                  if (($args -join ' ') -notmatch '^interface ipv6 (set|add) dnsservers ') { throw 'Unexpected netsh mutation' }
                  $global:mockState.calls=@($global:mockState.calls)+@('IPv6')
                  $address=(@($args) | Where-Object { $_ -like 'address=*' } | Select-Object -First 1).Substring(8)
                  $global:mockState.v6=@($address); $global:mockState.v6Static=$true; $global:mockState.configuredV6=$address
                  $global:LASTEXITCODE=0
                }
                function Enable-NetAdapterBinding { throw 'Binding must never be enabled by DNS apply' }
                function Set-NetAdapterBinding { throw 'Binding must never be changed by DNS apply' }
                function ipconfig.exe { $global:LASTEXITCODE=0 }
                $failure=$null
                try {
                """.Replace("__STATE__", statePath.Replace("'", "''")).Replace("__MODE__", mode);
            string suffix = "\n} catch { $failure=$_.Exception.Message }\n$global:mockState | ConvertTo-Json -Compress -Depth 8 | Set-Content -LiteralPath '" + statePath.Replace("'", "''") + "' -Encoding UTF8\n'HARNESS=' + ([pscustomobject]@{failure=$failure} | ConvertTo-Json -Compress)\n";
            await File.WriteAllTextAsync(fixture, mocks + "\n" + script + suffix, new UTF8Encoding(true), token);
            var result = await ProcessRunner.RunAsync(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"), new[] { "-NoProfile", "-NonInteractive", "-File", fixture }, TimeSpan.FromSeconds(20), token);
            await File.WriteAllTextAsync(fixture + ".result.txt", result.StandardOutput + "\n" + result.StandardError, token);
            Assert(result.ExitCode == 0, "Generated PowerShell fixture failed: " + result.StandardError);
            string[] lines=result.StandardOutput.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            string report=lines.Single(x=>x.StartsWith("HARNESS=",StringComparison.Ordinal));
            string? failure=JsonDocument.Parse(report.Substring(8)).RootElement.GetProperty("failure").GetString();
            return new ProcessResult(failure==null?0:1,string.Join("\n",lines.Where(x=>!x.StartsWith("HARNESS=",StringComparison.Ordinal))),failure??"");
        });
        Exception? rejected=null;
        try
        {
            DnsAdapterSnapshot[] original = await dns.ReadSnapshotAsync();
            if (mode == "binding-before")
            {
                var current=JsonNode.Parse(await File.ReadAllTextAsync(statePath))!.AsObject(); current["v6Binding"]=true;
                await File.WriteAllTextAsync(statePath,current.ToJsonString(),new UTF8Encoding(true));
            }
            if (mode.StartsWith("legacy-",StringComparison.Ordinal))
            {
                var legacy=JsonNode.Parse(Json(original))!.AsArray();
                foreach(var adapter in legacy) { adapter!.AsObject().Remove("ipv4BindingEnabled"); adapter.AsObject().Remove("ipv6BindingEnabled"); }
                original=JsonSerializer.Deserialize<DnsAdapterSnapshot[]>(legacy.ToJsonString(),JsonDefaults.Options)!;
            }
            await dns.ApplyAsync(original, mode=="ipv6-only"?new[]{"::1"}:new[]{"127.0.0.1","::1"});
        }
        catch(Exception error) { rejected=error; }
        var final=JsonDocument.Parse(await File.ReadAllTextAsync(statePath)).RootElement;
        string[] calls=final.GetProperty("calls").EnumerateArray().Select(x=>x.GetString()!).ToArray();
        bool success=mode is "disabled" or "disabled-static" or "enabled" or "legacy-enabled";
        Assert((rejected==null)==success, mode+": unexpected apply outcome: "+rejected?.Message);
        if(mode is "binding-unknown" or "ipv6-only" or "ipv4-disabled" or "binding-before" or "legacy-disabled") Assert(calls.Length==0,mode+": rejected preflight must not write any family");
        if(mode is "disabled" or "disabled-static" or "binding-after" or "enabled-binding-after" or "skipped-static-changed" or "skipped-config-changed" or "binding-readback-change") Assert(!calls.Contains("IPv6"),mode+": disabled or changed binding received an IPv6 write");
        if(mode is "disabled" or "disabled-static")
        {
            Assert(calls.SequenceEqual(new[]{"IPv4"}),mode+": usable IPv4 was not applied exactly once");
            Assert(!final.GetProperty("v6Binding").GetBoolean(),mode+": DNS apply enabled IPv6");
            Assert(final.GetProperty("v6Static").GetBoolean()==(mode=="disabled-static"),mode+": skipped IPv6 static state changed");
            Assert(final.GetProperty("configuredV6").GetString()==(mode=="disabled-static"?"2001:db8::99":""),mode+": skipped IPv6 registry configuration changed");
        }
        await File.WriteAllTextAsync(Path.Combine(root,"summary.json"),Json(new{mode,success=rejected==null,error=rejected?.Message,calls}),new UTF8Encoding(true));
    }
}
