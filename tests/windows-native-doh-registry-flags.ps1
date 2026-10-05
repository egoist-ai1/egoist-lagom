param([Parameter(Mandatory=$true)][string]$CoreSource,[Parameter(Mandatory=$true)][string]$DtoSource,[Parameter(Mandatory=$true)][string]$JsonSource,[Parameter(Mandatory=$true)][string]$ChildShell,[Parameter(Mandatory=$true)][string]$WorkRoot,[switch]$OldControl)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSEdition -ne 'Core'){throw 'PS7 compiler required.'}
foreach($p in @($CoreSource,$DtoSource,$JsonSource,$ChildShell,$WorkRoot)){if(-not [IO.Path]::IsPathFullyQualified($p) -or -not ([IO.File]::Exists($p) -or [IO.Directory]::Exists($p))){throw 'Absolute existing selected input/own work required.'}}
$utf8=[Text.UTF8Encoding]::new($false);$source=[IO.File]::ReadAllText($CoreSource)
function Extract([string]$Start,[string]$End){if([regex]::Matches($source,[regex]::Escape($Start)).Count -ne 1 -or [regex]::Matches($source,[regex]::Escape($End)).Count -ne 1){throw 'Actual generator bounds changed.'};$a=$source.IndexOf($Start,[StringComparison]::Ordinal);$b=$source.IndexOf($End,[StringComparison]::Ordinal);if($b -le $a){throw 'Bounds reversed.'};return $source.Substring($a,$b-$a)}
$methods=(Extract ([char]9+'private static string CreateReadEntriesScript(') ([char]9+'private Task<ProcessResult> RunPowerShellAsync('))+(Extract ([char]9+'public static string ValidateUrl(') ([char]9+'public async Task<NativeDohEntrySnapshot[]> ReadEntriesAsync('))
$dto=[IO.File]::ReadAllText($DtoSource).Replace('namespace EgoistShield.Service;','')
$json=[IO.File]::ReadAllText($JsonSource).Replace('namespace EgoistShield.Service;','').Replace('using System.Text.Json;','').Replace('using System.Text.Json.Serialization;','')
$entry=@'
public static string Read()=>CreateReadEntriesScript(new[]{"1.1.1.1"});
public static string Configure()=>CreateConfigureScript("https://example.invalid/dns-query",new[]{"1.1.1.1"});
public static string RoundTrip(string json)=>JsonSerializer.Serialize(JsonSerializer.Deserialize<NativeDohEntrySnapshot[]>(json,JsonDefaults.Options),JsonDefaults.StateOptions);
public static string Restore(string json)=>CreateRestoreEntriesScript(JsonSerializer.Deserialize<NativeDohEntrySnapshot[]>(json,JsonDefaults.Options)!,"https://example.invalid/dns-query");
public static string Removed(string configured,string baseline)=>CreateRestoreRemovedEntriesScript(JsonSerializer.Deserialize<NativeDohEntrySnapshot[]>(configured,JsonDefaults.Options)!,JsonSerializer.Deserialize<NativeDohEntrySnapshot[]>(baseline,JsonDefaults.Options)!);
public static string Clone(string json){var rows=JsonSerializer.Deserialize<NativeDohEntrySnapshot[]>(json,JsonDefaults.StateOptions)!;return JsonSerializer.Serialize(rows.Select(x=>x with{}),JsonDefaults.StateOptions);}
}
internal sealed record NativeDohOwnedState(string Url,string[] Servers);
internal static class WindowsDnsController{public static string[] ValidateServers(IReadOnlyCollection<string> value)=>value.ToArray();}
}
'@
$code='using System;using System.Linq;using System.Collections.Generic;using System.Text.Json;using System.Text.Json.Serialization;namespace EgoistShield.Service{'+$dto+$json+'public static class ActualDohContract{'+$methods+$entry
[IO.File]::WriteAllText((Join-Path $WorkRoot 'actual-generators-dto.cs'),$code,$utf8);Add-Type -TypeDefinition $code -CompilerOptions '/nullable:enable','/warn:0' -ErrorAction Stop
[IO.File]::WriteAllText((Join-Path $WorkRoot 'read.ps1'),[EgoistShield.Service.ActualDohContract]::Read(),$utf8);[IO.File]::WriteAllText((Join-Path $WorkRoot 'configure.ps1'),[EgoistShield.Service.ActualDohContract]::Configure(),$utf8)
$child=@'
param([string]$WorkRoot,[string]$Phase)
$ErrorActionPreference='Stop'
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
$script:Entries=@{};$script:Writes=0;$script:RawWrites=0;$script:MissingKey=$false;$script:ReadbackWrong=$false;$script:FailRaw=$false
function Get-DnsClientDohServerAddress{[CmdletBinding()]param([string]$ServerAddress);return $script:Entries[$ServerAddress]}
function Set-DnsClientDohServerAddress{[CmdletBinding()]param([string]$ServerAddress,[string]$DohTemplate,[bool]$AllowFallbackToUdp,[bool]$AutoUpgrade);$script:Writes++;$script:Entries[$ServerAddress]=[pscustomobject]@{ServerAddress=$ServerAddress;DohTemplate=$DohTemplate;AllowFallbackToUdp=$AllowFallbackToUdp;AutoUpgrade=$AutoUpgrade;Flags=[pscustomobject]@{present=$true;kind='QWord';value=([long][int]$AutoUpgrade).ToString()};untouched='sentinel'}}
function Add-DnsClientDohServerAddress{[CmdletBinding()]param([string]$ServerAddress,[string]$DohTemplate,[bool]$AllowFallbackToUdp,[bool]$AutoUpgrade);Set-DnsClientDohServerAddress @PSBoundParameters}
function Remove-DnsClientDohServerAddress{[CmdletBinding(SupportsShouldProcess=$true)]param([string]$ServerAddress);$script:Writes++;$script:Entries.Remove($ServerAddress)}
function Open-InertDohKey([string]$Server,[bool]$Writable){
 if($script:MissingKey -or -not $script:Entries.ContainsKey($Server)){return $null};$key=[pscustomobject]@{Server=$Server;Writable=$Writable}
 $key|Add-Member ScriptMethod GetValueNames {if($script:Entries[$this.Server].Flags.present){return @('Template','Flags','Untouched')};return @('Template','Untouched')}
 $key|Add-Member ScriptMethod GetValueKind {param($Name)if($Name -cne 'Flags'){throw 'FIXTURE_OTHER_VALUE'};return [Microsoft.Win32.RegistryValueKind][Enum]::Parse([Microsoft.Win32.RegistryValueKind],$script:Entries[$this.Server].Flags.kind)}
 $key|Add-Member ScriptMethod GetValue {param($Name,$Default,$Options)if($Name -cne 'Flags'){throw 'FIXTURE_OTHER_VALUE'};$f=$script:Entries[$this.Server].Flags;if($f.kind -eq 'DWord'){return [int]::Parse($f.value,[Globalization.CultureInfo]::InvariantCulture)};return [long]::Parse($f.value,[Globalization.CultureInfo]::InvariantCulture)}
 $key|Add-Member ScriptMethod DeleteValue {param($Name,$Throw)if(-not $this.Writable -or $Name -cne 'Flags'){throw 'FIXTURE_OTHER_WRITE'};if($script:FailRaw){throw 'FIXTURE_INTERRUPTED_RAW'};$script:RawWrites++;$script:Entries[$this.Server].Flags=[pscustomobject]@{present=$false;kind=$null;value=$null}}
 $key|Add-Member ScriptMethod SetValue {param($Name,$Value,$Kind)if(-not $this.Writable -or $Name -cne 'Flags'){throw 'FIXTURE_OTHER_WRITE'};if($script:FailRaw){throw 'FIXTURE_INTERRUPTED_RAW'};$script:RawWrites++;$v=$Value.ToString([Globalization.CultureInfo]::InvariantCulture);if($script:ReadbackWrong){$v='9'};$script:Entries[$this.Server].Flags=[pscustomobject]@{present=$true;kind=[string]$Kind;value=$v}}
 $key|Add-Member ScriptMethod Dispose {};return $key
}
function Script([string]$Name){
 $text=[IO.File]::ReadAllText((Join-Path $WorkRoot $Name));$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors);if($errors.Count){throw 'Generated script parse failed.'}
 $nodes=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Open-EgoistDohRegistryKey'},$true));if($nodes.Count -gt 1){throw 'Registry I/O seam ambiguous.'}
 if($nodes.Count -eq 1){$n=$nodes[0];$text=$text.Substring(0,$n.Extent.StartOffset)+'function Open-EgoistDohRegistryKey {param([string]$Server,[bool]$Writable) Open-InertDohKey $Server $Writable}'+$text.Substring($n.Extent.EndOffset)}
 if($text.Contains('::OpenBaseKey')){throw 'Live registry I/O escaped inert seam.'};return [ScriptBlock]::Create($text)
}
function Outside{$script:Entries['9.9.9.9']=[pscustomobject]@{DohTemplate='https://foreign.invalid/dns-query';AutoUpgrade=$false;Flags=[pscustomobject]@{present=$true;kind='DWord';value='42'}}}
function Untouched{return $script:Entries['9.9.9.9'].DohTemplate -ceq 'https://foreign.invalid/dns-query' -and -not $script:Entries['9.9.9.9'].AutoUpgrade -and $script:Entries['9.9.9.9'].Flags.kind -ceq 'DWord' -and $script:Entries['9.9.9.9'].Flags.value -ceq '42'}
function Reset([string]$Kind,[string]$Value,[bool]$Present){$script:Writes=0;$script:RawWrites=0;$script:MissingKey=$false;$script:ReadbackWrong=$false;$script:Entries=@{'1.1.1.1'=[pscustomobject]@{ServerAddress='1.1.1.1';DohTemplate='https://example.invalid/dns-query';AllowFallbackToUdp=$false;AutoUpgrade=$false;Flags=[pscustomobject]@{present=$Present;kind=$Kind;value=$Value};untouched='sentinel'}};if(-not $Present){$script:Entries['1.1.1.1'].Flags.kind=$null;$script:Entries['1.1.1.1'].Flags.value=$null};Outside}
$rows=@()
if($Phase -eq 'capture'){
 foreach($case in @(@{name='absent';kind='';value='';present=$false},@{name='qword-zero';kind='QWord';value='0';present=$true},@{name='dword-zero';kind='DWord';value='0';present=$true},@{name='dword-negative';kind='DWord';value='-1';present=$true},@{name='qword-max';kind='QWord';value='9223372036854775807';present=$true},@{name='qword-min';kind='QWord';value='-9223372036854775808';present=$true},@{name='api-fallback';kind='QWord';value='0';present=$true},@{name='missing';kind='';value='';present=$false},@{name='already-desired-dword';kind='DWord';value='-1';present=$true},@{name='already-desired-qword';kind='QWord';value='9223372036854775807';present=$true})){
 Reset $case.kind $case.value $case.present;if($case.name -eq 'api-fallback'){$script:Entries['1.1.1.1'].AllowFallbackToUdp=$true};if($case.name -like 'already-desired-*'){$script:Entries['1.1.1.1'].AutoUpgrade=$true};if($case.name -eq 'missing'){$script:Entries.Remove('1.1.1.1')};$original=& (Script 'read.ps1');$raw=$script:Entries['1.1.1.1'].Flags;& (Script 'configure.ps1')|Out-Null;$configured=& (Script 'read.ps1');$rows+=@{name=$case.name;original=$original;configured=$configured;expectedRaw=$raw;configurationWrites=$script:Writes;model=$script:Entries['1.1.1.1']}
 }
 [IO.File]::WriteAllText((Join-Path $WorkRoot 'captures.json'),(Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject $rows -Depth 10 -Compress),[Text.UTF8Encoding]::new($false));[Console]::Out.WriteLine('capture-complete');exit 0
}
$captures=Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject ([IO.File]::ReadAllText((Join-Path $WorkRoot 'captures.json')))
foreach($c in $captures){
 $script:Entries=@{'1.1.1.1'=$c.model};$script:Writes=0;$script:RawWrites=0;$script:MissingKey=$false;$script:ReadbackWrong=$false;Outside
 & (Script ($c.name+'.restore.ps1'))|Out-Null;$actual=$script:Entries['1.1.1.1'];$originalApi=@(Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject $c.original)[0];$same=$actual.Flags.present -eq $c.expectedRaw.present -and $actual.Flags.kind -ceq $c.expectedRaw.kind -and $actual.Flags.value -ceq $c.expectedRaw.value;if(-not $originalApi.existed){$same=-not $script:Entries.ContainsKey('1.1.1.1')}
 $writesRight=if($c.name -like 'already-desired-*'){$c.configurationWrites -eq 0}else{$c.configurationWrites -eq 1};$rows+=@{case=($c.name+'-restore');passed=([bool]$same -and $writesRight);untouchedPreserved=((Untouched) -and (-not $originalApi.existed -or $actual.untouched -ceq 'sentinel'));apiContractPreserved=(-not $originalApi.existed -or ($actual.AllowFallbackToUdp -eq $originalApi.allowFallbackToUdp -and $actual.AutoUpgrade -eq $originalApi.autoUpgrade));rawWrites=$script:RawWrites}
 & (Script ($c.name+'.removed.ps1'))|Out-Null;$actual=$script:Entries['1.1.1.1'];$configured=@(Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject $c.configured)[0];$same=$actual.AutoUpgrade -and $actual.Flags.kind -ceq $configured.registryFlags.kind -and $actual.Flags.value -ceq $configured.registryFlags.value;if($null -eq $configured.registryFlags){$same=$actual.AutoUpgrade -and $actual.Flags.kind -ceq 'QWord' -and $actual.Flags.value -ceq '1'}
 $rows+=@{case=($c.name+'-restore-removed');passed=[bool]$same;untouchedPreserved=((Untouched) -and $actual.untouched -ceq 'sentinel');apiContractPreserved=$true;rawWrites=$script:RawWrites}
}
foreach($case in 'foreign-template','foreign-original-raw','same-api-original-desired-raw','unsupported-capture','unsupported-current-restore','binary-current-restore','unsupported-current-removed-legacy','missing-key','malformed-snapshot','overflow-snapshot','write-readback-mismatch'){
 Reset 'QWord' '0' $true;$errorObserved=$false;$beforeWrites=0
 switch($case){
 'foreign-template'{$script:Entries['1.1.1.1'].DohTemplate='https://foreign.invalid/dns-query';$name='absent.restore.ps1'}
 'foreign-original-raw'{$name='absent.restore.ps1'}
 'same-api-original-desired-raw'{& (Script 'configure.ps1')|Out-Null;$beforeWrites=$script:Writes;$name='same-api.restore.ps1'}
 'unsupported-capture'{$script:Entries['1.1.1.1'].Flags.kind='String';$name='read.ps1'}
 'unsupported-current-restore'{& (Script 'configure.ps1')|Out-Null;$beforeWrites=$script:Writes;$script:Entries['1.1.1.1'].Flags.kind='String';$name='absent.restore.ps1'}
 'binary-current-restore'{& (Script 'configure.ps1')|Out-Null;$beforeWrites=$script:Writes;$script:Entries['1.1.1.1'].Flags.kind='Binary';$script:Entries['1.1.1.1'].Flags.value=[byte[]]@(1,2,255);$name='absent.restore.ps1'}
 'unsupported-current-removed-legacy'{$script:Entries['1.1.1.1'].Flags.kind='String';$name='removed-legacy.ps1'}
 'missing-key'{$script:MissingKey=$true;$name='read.ps1'}
 'malformed-snapshot'{& (Script 'configure.ps1')|Out-Null;$beforeWrites=$script:Writes;$name='malformed.restore.ps1'}
 'overflow-snapshot'{& (Script 'configure.ps1')|Out-Null;$beforeWrites=$script:Writes;$name='overflow.restore.ps1'}
 'write-readback-mismatch'{& (Script 'configure.ps1')|Out-Null;$beforeWrites=$script:Writes;$script:ReadbackWrong=$true;$name='dword-zero.restore.ps1'}
 }
 $beforeModel=Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject $script:Entries['1.1.1.1'] -Depth 6 -Compress
 try{& (Script $name)|Out-Null}catch{$errorObserved=$true};$noWrite=($script:Writes -eq $beforeWrites -and $script:RawWrites -eq 0);if($case -eq 'write-readback-mismatch'){$noWrite=$true}
 $rows+=@{case=$case;passed=($errorObserved -and $noWrite -and ($case -eq 'write-readback-mismatch' -or $beforeModel -ceq (Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject $script:Entries['1.1.1.1'] -Depth 6 -Compress)));untouchedPreserved=((Untouched) -and $script:Entries['1.1.1.1'].untouched -ceq 'sentinel');apiContractPreserved=$true;rawWrites=$script:RawWrites}
}
Reset 'QWord' '0' $true;& (Script 'configure.ps1')|Out-Null;$script:FailRaw=$true;$first=$false;$second=$false;try{& (Script 'absent.restore.ps1')|Out-Null}catch{$first=$true};$script:FailRaw=$false;$before=$script:Writes;try{& (Script 'absent.restore.ps1')|Out-Null}catch{$second=$true};$rows+=@{case='interrupted-api-raw-interval-retry-refuses';passed=($first -and $second -and $script:Writes -eq $before -and $script:RawWrites -eq 0 -and -not $script:Entries['1.1.1.1'].AutoUpgrade -and $script:Entries['1.1.1.1'].Flags.present);untouchedPreserved=(Untouched);apiContractPreserved=$true;rawWrites=$script:RawWrites}
Reset 'QWord' '0' $true;& (Script 'configure.ps1')|Out-Null;& (Script 'legacy.restore.ps1')|Out-Null
$rows+=@{case='legacy-unknown-raw';passed=($script:RawWrites -eq 0 -and -not $script:Entries['1.1.1.1'].AutoUpgrade);untouchedPreserved=$true;apiContractPreserved=$true;rawWrites=$script:RawWrites}
[Console]::Out.WriteLine((Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject @{rows=$rows;childVersion=[string]$PSVersionTable.PSVersion;childEdition=[string]$PSVersionTable.PSEdition;liveRegistryDnsServiceActions=0} -Depth 10 -Compress))
'@
[IO.File]::WriteAllText((Join-Path $WorkRoot 'child.ps1'),$child,$utf8)
function RunChild([string]$Phase){
 $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$ChildShell;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.StandardOutputEncoding=$utf8;$info.StandardErrorEncoding=$utf8;$info.WorkingDirectory=$WorkRoot;$info.Environment['TEMP']=$WorkRoot;$info.Environment['TMP']=$WorkRoot
 foreach($a in @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Join-Path $WorkRoot 'child.ps1'),'-WorkRoot',$WorkRoot,'-Phase',$Phase)){$info.ArgumentList.Add($a)}
 $process=[Diagnostics.Process]::new();$process.StartInfo=$info;$clock=[Diagnostics.Stopwatch]::StartNew()
 try{[void]$process.Start();$handle=$process.Handle;$id=$process.Id;$birth=$process.StartTime.ToUniversalTime().ToString('o');$out=$process.StandardOutput.ReadToEndAsync();$err=$process.StandardError.ReadToEndAsync();$timeout=-not $process.WaitForExit(15000)
 if($timeout){if($process.StartTime.ToUniversalTime().ToString('o') -cne $birth){throw 'Own child identity changed.'};$process.Kill($true);if(-not $process.WaitForExit(5000)){throw 'Own child cleanup failed.'}}
 $clock.Stop();$stdout=$out.GetAwaiter().GetResult();$stderr=$err.GetAwaiter().GetResult();[IO.File]::WriteAllText((Join-Path $WorkRoot ($Phase+'.stdout.txt')),$stdout,$utf8);[IO.File]::WriteAllText((Join-Path $WorkRoot ($Phase+'.stderr.txt')),$stderr,$utf8)
 [IO.File]::WriteAllText((Join-Path $WorkRoot ($Phase+'.process.json')),(@{pid=$id;birthUtc=$birth;heldProcessHandle=$true;exitCode=$process.ExitCode;timedOut=$timeout;elapsedMs=$clock.ElapsedMilliseconds;childDeadlineMs=15000;image=$ChildShell;liveRegistryDnsServiceActions=0}|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress),$utf8)
 if($timeout -or $process.ExitCode -ne 0 -or $stderr -or [Text.Encoding]::UTF8.GetByteCount($stdout) -gt 262144){throw 'Inert child failed or exceeded stream bound.'};return $stdout
 }finally{$process.Dispose()}
}
RunChild 'capture'|Out-Null
$captures=Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject ([IO.File]::ReadAllText((Join-Path $WorkRoot 'captures.json')))
foreach($row in $captures){
 $original=[EgoistShield.Service.ActualDohContract]::RoundTrip($row.original);$configured=[EgoistShield.Service.ActualDohContract]::RoundTrip($row.configured);if([EgoistShield.Service.ActualDohContract]::Clone($original) -cne $original){throw 'Actual DTO clone changed baseline.'}
 [IO.File]::WriteAllText((Join-Path $WorkRoot ($row.name+'.dto.json')),$original,$utf8);[IO.File]::WriteAllText((Join-Path $WorkRoot ($row.name+'.restore.ps1')),[EgoistShield.Service.ActualDohContract]::Restore($original),$utf8);[IO.File]::WriteAllText((Join-Path $WorkRoot ($row.name+'.removed.ps1')),[EgoistShield.Service.ActualDohContract]::Removed($configured,$original),$utf8)
}
$legacy='[{"serverAddress":"1.1.1.1","existed":true,"dohTemplate":"https://example.invalid/dns-query","allowFallbackToUdp":false,"autoUpgrade":false}]'
[IO.File]::WriteAllText((Join-Path $WorkRoot 'legacy.restore.ps1'),[EgoistShield.Service.ActualDohContract]::Restore($legacy),$utf8)
[IO.File]::WriteAllText((Join-Path $WorkRoot 'removed-legacy.ps1'),[EgoistShield.Service.ActualDohContract]::Removed($captures[0].configured,$legacy),$utf8)
$sameApi=$legacy.Replace('"autoUpgrade":false','"autoUpgrade":true');if(-not $OldControl){$sameApi=$sameApi.Replace('"autoUpgrade":true','"autoUpgrade":true,"registryFlags":{"present":false,"kind":null,"value":null}')};[IO.File]::WriteAllText((Join-Path $WorkRoot 'same-api.restore.ps1'),[EgoistShield.Service.ActualDohContract]::Restore($sameApi),$utf8)
if(-not $OldControl){foreach($v in @(@{name='malformed';kind='String';value='0'},@{name='overflow';kind='DWord';value='2147483648'})){$bad=$legacy.Replace('1.1.1.1','1.0.0.1').Replace('"autoUpgrade":false',('"autoUpgrade":false,"registryFlags":{"present":true,"kind":"'+$v.kind+'","value":"'+$v.value+'"}'));$raw=$legacy.TrimEnd(']')+','+$bad.TrimStart('[');[IO.File]::WriteAllText((Join-Path $WorkRoot ($v.name+'.restore.ps1')),[EgoistShield.Service.ActualDohContract]::Restore($raw),$utf8)}}else{foreach($name in 'malformed','overflow'){[IO.File]::WriteAllText((Join-Path $WorkRoot ($name+'.restore.ps1')),[EgoistShield.Service.ActualDohContract]::Restore($legacy),$utf8)}}
$dtoRefusals=@();if(-not $OldControl){foreach($v in @(@{name='nested-empty';value='{}'},@{name='nested-null-presence';value='{"present":null,"kind":null,"value":null}'},@{name='nested-missing-kind';value='{"present":false,"value":null}'},@{name='nested-missing-value';value='{"present":false,"kind":null}'})){$bad=$legacy.Replace('"autoUpgrade":false',('"autoUpgrade":false,"registryFlags":'+$v.value));$refused=$false;try{[EgoistShield.Service.ActualDohContract]::RoundTrip($bad)|Out-Null}catch{$refused=$true};$dtoRefusals+=@{case=$v.name;passed=$refused;untouchedPreserved=$true;apiContractPreserved=$true;rawWrites=0}}}
$result=Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject (RunChild 'restore');$result.rows=@($result.rows)+@($dtoRefusals);$all=@($result.rows|Where-Object {-not $_.passed -or -not $_.untouchedPreserved -or -not $_.apiContractPreserved})
$proof=@{passed=($all.Count -eq 0);oldControl=[bool]$OldControl;caseCount=@($result.rows).Count;results=@($result.rows);childEdition=$result.childEdition;childVersion=$result.childVersion;actualGeneratorDtoJsonDefaults=$true;registryIoOnlySeamReplaced=$true;liveRegistryDnsServiceActions=0;actualApiRegistryBitMappingClaimed=$false;actualHostedApplyCloseCauseProven=$false;historicalMissingRawBaselineGuessed=$false;fullCoreBuild=$false}
[IO.File]::WriteAllText((Join-Path $WorkRoot 'receipt.json'),($proof|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 12),$utf8)
if($all.Count){throw ('Inert actual DoH Flags contract failed: '+($all.case -join ','))}
[Console]::Out.WriteLine((@{passed=$true;caseCount=$proof.caseCount;childEdition=$proof.childEdition;liveRegistryDnsServiceActions=0}|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress))
