param([Parameter(Mandatory=$true)][string]$CoreSource,[Parameter(Mandatory=$true)][string]$DtoSource,[Parameter(Mandatory=$true)][string]$JsonSource,[Parameter(Mandatory=$true)][string]$ChildShell,[Parameter(Mandatory=$true)][string]$WorkRoot,[switch]$OldControl)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSEdition -ne 'Core'){throw 'PS7 compiler required.'}
foreach($p in @($CoreSource,$DtoSource,$JsonSource,$ChildShell,$WorkRoot)){if(-not [IO.Path]::IsPathFullyQualified($p) -or -not ([IO.File]::Exists($p) -or [IO.Directory]::Exists($p))){throw 'Existing absolute owned input paths required.'}}
$utf8=[Text.UTF8Encoding]::new($false)
$source=[IO.File]::ReadAllText($CoreSource)
function Extract([string]$Start,[string]$End){
 if([regex]::Matches($source,[regex]::Escape($Start)).Count -ne 1 -or [regex]::Matches($source,[regex]::Escape($End)).Count -ne 1){throw 'Actual method bounds differ.'}
 $a=$source.IndexOf($Start,[StringComparison]::Ordinal);$b=$source.IndexOf($End,[StringComparison]::Ordinal);if($b -le $a){throw 'Actual method order differs.'};return $source.Substring($a,$b-$a)
}
$methods=(Extract ([char]9+'private static string CreateSnapshotScript(') ([char]9+'private static string CreateApplyScript('))+
 (Extract ([char]9+'private static string SerializeForPowerShell<') ([char]9+'private static string ToPowerShellArray('))+
 (Extract ([char]9+'private async Task<DnsAdapterSnapshot[]> ReadSnapshotCoreAsync(') ([char]9+'private Task<ProcessResult> RunPowerShellAsync('))+
 (Extract ([char]9+'private static void EnsureSuccess(') ([char]9+'private static void EnsureStableTargetIdentity('))
$dto=[IO.File]::ReadAllText($DtoSource).Replace('namespace EgoistShield.Service;','')
$options=[IO.File]::ReadAllText($JsonSource).Replace('namespace EgoistShield.Service;','').Replace('using System.Text.Json;','').Replace('using System.Text.Json.Serialization;','')
$head='using System;using System.IO;using System.Linq;using System.Collections.Generic;using System.Text.Json;using System.Text.Json.Serialization;using System.Threading;using System.Threading.Tasks;namespace EgoistShield.Service{'+$dto+$options+'internal sealed record ProcessResult(int ExitCode,string StandardOutput,string StandardError);public sealed class ActualSnapshotContract{private readonly string json;private ActualSnapshotContract(string input){json=input;}'
$entry=@'
 private Task<ProcessResult> RunPowerShellAsync(string script,CancellationToken token)=>Task.FromResult(new ProcessResult(0,json,""));
 public static string Script(string mode)=>CreateSnapshotScript(mode=="explicit"?new[]{new DnsAdapterSnapshot(20,"vEthernet (nat)","00000000-0000-0000-0000-000000000020",Array.Empty<string>(),Array.Empty<string>(),false,false)}:null,mode=="physical");
 public static string Consume(string input){
  var rows=new ActualSnapshotContract(input).ReadSnapshotCoreAsync(null,CancellationToken.None).GetAwaiter().GetResult();
  return JsonSerializer.Serialize(rows.Select(a=>new{a.InterfaceIndex,a.InterfaceGuid,v4=a.Ipv4.Length,v6=a.Ipv6.Length,values4=a.Ipv4,values6=a.Ipv6,null4=a.Ipv4.Count(s=>s is null),null6=a.Ipv6.Count(s=>s is null),bad4=a.Ipv4.Count(s=>!System.Net.IPAddress.TryParse(s,out var ip)||ip.AddressFamily!=System.Net.Sockets.AddressFamily.InterNetwork),bad6=a.Ipv6.Count(s=>!System.Net.IPAddress.TryParse(s,out var ip)||ip.AddressFamily!=System.Net.Sockets.AddressFamily.InterNetworkV6),a.Ipv6BindingEnabled}),JsonDefaults.Options);
 }
}}
'@
$code=$head+$methods+$entry
[IO.File]::WriteAllText((Join-Path $WorkRoot 'actual-generator-consumer.cs'),$code,$utf8)
Add-Type -TypeDefinition $code -CompilerOptions '/nullable:enable','/warn:0' -ErrorAction Stop
foreach($mode in 'physical','general','explicit'){[IO.File]::WriteAllText((Join-Path $WorkRoot ($mode+'.generated.ps1')),[EgoistShield.Service.ActualSnapshotContract]::Script($mode),$utf8)}
$child=@'
param([string]$WorkRoot)
$ErrorActionPreference='Stop'
$script:Mode='';$script:Call=0;$script:V4=[string[]]@();$script:V6=[string[]]@()
$script:Adapters=@([pscustomobject]@{ifIndex=10;Name='Ethernet';InterfaceGuid='00000000-0000-0000-0000-000000000010';InterfaceDescription='Hardware Ethernet'},[pscustomobject]@{ifIndex=20;Name='vEthernet (nat)';InterfaceGuid='00000000-0000-0000-0000-000000000020';InterfaceDescription='Hyper-V Virtual Ethernet'})
function Get-NetAdapter{[CmdletBinding()]param([int]$InterfaceIndex,[switch]$Physical,[switch]$IncludeHidden);if($Physical){return $script:Adapters[0]};if($PSBoundParameters.ContainsKey('InterfaceIndex')){return @($script:Adapters|Where-Object {$_.ifIndex -eq $InterfaceIndex})};return $script:Adapters}
function Get-NetIPInterface{[CmdletBinding()]param();foreach($a in $script:Adapters){[pscustomobject]@{InterfaceIndex=$a.ifIndex;InterfaceAlias=$a.Name;ConnectionState='Connected';InterfaceMetric=10}}}
function Get-NetAdapterBinding{[CmdletBinding()]param([string]$Name,[string]$ComponentID);$script:Call++;$v=$ComponentID -eq 'ms_tcpip';if($script:Mode -eq 'binding-unknown'){$v=$null};if($script:Mode -eq 'binding-change' -and $script:Call -gt 2){$v=-not $v};[pscustomobject]@{Enabled=$v}}
function Get-DnsClientServerAddress{[CmdletBinding()]param([int]$InterfaceIndex,[string]$AddressFamily);if($AddressFamily -eq 'IPv6' -and $script:Mode -eq 'query-throw'){Write-Error 'FIXTURE_CIM_ERROR';return};if($AddressFamily -eq 'IPv6' -and $script:Mode -eq 'missing-api'){return};$row=[pscustomobject]@{ServerAddresses=$script:V4};if($AddressFamily -eq 'IPv6'){$row=[pscustomobject]@{ServerAddresses=$script:V6}};if($AddressFamily -eq 'IPv6' -and $script:Mode -eq 'multiple-api'){return @($row,$row)};return $row}
function Get-ItemProperty{[CmdletBinding()]param([string]$Path,[string]$LiteralPath,[string]$Name);[pscustomobject]@{NameServer=''}}
function Set-DnsClientServerAddress{throw 'UNEXPECTED_NATIVE_WRITE'}
function Get-CimInstance{throw 'UNEXPECTED_NATIVE_QUERY'}
function Stop-Service{throw 'UNEXPECTED_NATIVE_WRITE'}
$rows=@()
foreach($branch in 'physical','general','explicit'){
 $scriptBlock=[ScriptBlock]::Create([IO.File]::ReadAllText((Join-Path $WorkRoot ($branch+'.generated.ps1'))))
 foreach($case in 'null-v4','null-v6','both-null','empty','single','multi','null-member','bad-string','empty-string','wrong-family','missing-api','multiple-api','query-throw','binding-unknown','binding-change'){
  $script:Mode=$case;$script:Call=0;$script:V4=[string[]]@();$script:V6=[string[]]@()
  switch($case){
   'null-v4'{$script:V4=$null;$script:V6=[string[]]@('2001:db8::53')}
   'null-v6'{$script:V4=[string[]]@('192.0.2.53');$script:V6=$null}
   'both-null'{$script:V4=$null;$script:V6=$null}
   'single'{$script:V4=[string[]]@('192.0.2.53');$script:V6=[string[]]@('2001:0DB8:0000:0000:0000:0000:0000:0053')}
   'multi'{$script:V4=[string[]]@('192.0.2.53','198.51.100.53');$script:V6=[string[]]@('2001:db8::53','2001:db8::54')}
   'null-member'{$script:V6=@('2001:db8::53',$null)}
   'bad-string'{$script:V6=@('invalid-address')}
   'empty-string'{$script:V6=@('')}
   'wrong-family'{$script:V6=@('192.0.2.53')}
  }
  $json=$null;$errorType=$null;$errorId=$null
  try{$json=(& $scriptBlock)}catch{$errorType=$_.Exception.GetType().Name;$errorId=$_.FullyQualifiedErrorId}
  $rows+=@{branch=$branch;case=$case;json=$json;errorType=$errorType;errorId=$errorId}
 }
}
[Console]::Out.WriteLine((Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject @{rows=$rows;psVersion=[string]$PSVersionTable.PSVersion;psEdition=[string]$PSVersionTable.PSEdition;nativeQueriesWrites=0} -Depth 8 -Compress))
'@
$childFile=Join-Path $WorkRoot 'inert-generated-control.ps1';[IO.File]::WriteAllText($childFile,$child,$utf8)
$info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$ChildShell;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
foreach($a in @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$childFile,'-WorkRoot',$WorkRoot)){$info.ArgumentList.Add($a)}
$info.Environment['TEMP']=$WorkRoot;$info.Environment['TMP']=$WorkRoot
$p=[Diagnostics.Process]::new();$p.StartInfo=$info
try{[void]$p.Start();$handle=$p.Handle;$childPid=$p.Id;$birth=$p.StartTime.ToUniversalTime().ToString('o');$ot=$p.StandardOutput.ReadToEndAsync();$et=$p.StandardError.ReadToEndAsync();if(-not $p.WaitForExit(15000)){$p.Kill($true);if(-not $p.WaitForExit(5000)){throw 'Owned fixture child did not exit.'};throw 'Owned fixture child timed out.'};$stdout=$ot.GetAwaiter().GetResult();$stderr=$et.GetAwaiter().GetResult();if($p.ExitCode -ne 0 -or $stderr){throw 'Inert generated control process failed.'}}finally{$p.Dispose()}
[IO.File]::WriteAllText((Join-Path $WorkRoot 'child.stdout.json'),$stdout,$utf8)
$data=Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject $stdout
$results=@()
foreach($row in $data.rows){
 $bad=$row.case -notin @('null-v4','null-v6','both-null','empty','single','multi')
 $accepted=$null -eq $row.errorType;$stats=$null;$passed=$false
 if($accepted){$stats=Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject ([EgoistShield.Service.ActualSnapshotContract]::Consume([string]$row.json))}
 if($OldControl){$passed=$true}else{
  if($bad){$passed=-not $accepted}else{
   $v4=if($row.case -in @('null-v4','both-null','empty')){0}elseif($row.case -eq 'multi'){2}else{1}
   $v6=if($row.case -in @('null-v6','both-null','empty')){0}elseif($row.case -eq 'multi'){2}else{1}
   $expectedCount=if($row.branch -eq 'general'){2}else{1}
   $passed=$accepted -and @($stats).Count -eq $expectedCount -and @($stats|Where-Object {$_.v4 -ne $v4 -or $_.v6 -ne $v6 -or $_.null4 -ne 0 -or $_.null6 -ne 0 -or $_.bad4 -ne 0 -or $_.bad6 -ne 0}).Count -eq 0
   $expected4=@();$expected6=@()
   if($row.case -in @('null-v6','single')){$expected4=@('192.0.2.53')}
   if($row.case -eq 'null-v4'){$expected6=@('2001:db8::53')}
   if($row.case -eq 'single'){$expected6=@('2001:0DB8:0000:0000:0000:0000:0000:0053')}
   if($row.case -eq 'multi'){$expected4=@('192.0.2.53','198.51.100.53');$expected6=@('2001:db8::53','2001:db8::54')}
   foreach($stat in @($stats)){
    $passed=$passed -and [string]::Join('|',@($stat.values4)) -ceq [string]::Join('|',$expected4) -and [string]::Join('|',@($stat.values6)) -ceq [string]::Join('|',$expected6)
   }
   if($row.branch -eq 'explicit'){$passed=$passed -and $stats[0].interfaceGuid -ceq '00000000-0000-0000-0000-000000000020'}
  }
 }
 $results+=@{branch=$row.branch;case=$row.case;passed=$passed;accepted=$accepted;errorType=$row.errorType;stats=$stats}
}
if($OldControl){if(@($results|Where-Object {$_.case -eq 'null-v6' -and $_.accepted -and @($_.stats|Where-Object {$_.null6 -eq 1}).Count -gt 0}).Count -ne 3){throw 'Frozen original nullable corruption did not reproduce.'}}
$r=@{schemaVersion=1;oldControl=[bool]$OldControl;coreSha256=(Get-FileHash -LiteralPath $CoreSource).Hash;dtoSha256=(Get-FileHash -LiteralPath $DtoSource).Hash;jsonOptionsSha256=(Get-FileHash -LiteralPath $JsonSource).Hash;childPid=$childPid;birthUtc=$birth;heldChildHandle=$true;childEdition=$data.psEdition;childVersion=$data.psVersion;results=$results;liveNativeQueriesWrites=0;fullCoreBuild=$false;actualGeneratorDtoJsonDefaultsReadSnapshotCore=$true;actualHostedCauseProven=$false}
[IO.File]::WriteAllText((Join-Path $WorkRoot 'receipt.json'),($r|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 12),$utf8)
if(@($results|Where-Object {-not $_.passed}).Count){throw 'Actual snapshot/DTO regression failed.'}
[Console]::Out.WriteLine((Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject @{passed=$true;caseCount=$results.Count;oldControl=[bool]$OldControl;receipt=(Join-Path $WorkRoot 'receipt.json')} -Compress))
