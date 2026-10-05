param([Parameter(Mandatory=$true)][string]$HarnessPath,[Parameter(Mandatory=$true)][string]$WorkDirectory)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSEdition -ne 'Core' -or $PSVersionTable.PSVersion.Major -lt 7){throw 'PS7 fixture compiler required.'}
if(-not [IO.Path]::IsPathFullyQualified($WorkDirectory) -or -not [IO.Directory]::Exists($WorkDirectory)){throw 'Existing absolute own fixture directory required.'}
$text=[IO.File]::ReadAllText($HarnessPath)
$startMarker='        string windows = Directory.GetParent(system.ToString())!.FullName;'
$endMarker='    private static IntPtr FindWindow(int pid)'
$start=$text.IndexOf($startMarker,[StringComparison]::Ordinal);$end=$text.IndexOf($endMarker,[StringComparison]::Ordinal)
if($start -lt 0 -or $end -le $start -or $text.IndexOf($startMarker,$start+1,[StringComparison]::Ordinal) -ge 0 -or $text.IndexOf($endMarker,$end+1,[StringComparison]::Ordinal) -ge 0){throw 'Exact environment-tail extraction bounds differ.'}
$tail=$text.Substring($start,$end-$start).TrimEnd()
if(-not $tail.EndsWith('}')){throw 'Environment-tail terminator differs.'}
$tail=$tail.Substring(0,$tail.Length-1)
if($tail -match '\bNative\.|\bMarshal\.|\bSafeAccessTokenHandle\b'){throw 'Native launch/token operations reached inert tail.'}
$code='using System;using System.IO;using System.Text;using System.Collections.Generic;using System.Linq;public static class GuiEnvironmentTailFixture { public static string Build(string systemDirectory,string work,bool managedFixture) { var system=new StringBuilder(systemDirectory);var values=new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);'+$tail+'} }'
Add-Type -TypeDefinition $code -ErrorAction Stop
function Decode([string]$Block){
 $result=[ordered]@{}
 foreach($pair in $Block.Split([char]0,[StringSplitOptions]::RemoveEmptyEntries)){
  $at=$pair.IndexOf('=');if($at -lt 1){throw 'Environment block entry differs.'};$key=$pair.Substring(0,$at);if($result.Contains($key)){throw 'Duplicate environment key.'};$result[$key]=$pair.Substring($at+1)
 }
 return $result
}
$system=[Environment]::SystemDirectory;$environment=Decode ([GuiEnvironmentTailFixture]::Build($system,$WorkDirectory,$false))
$windows=[IO.Directory]::GetParent($system).FullName;$expectedDrive=[IO.Path]::GetPathRoot($windows).TrimEnd('\')
$rows=@(@{name='actual-system-drive';passed=$environment['SystemDrive'] -ceq $expectedDrive})
$alternate=Decode ([GuiEnvironmentTailFixture]::Build('D:\OS\System32',$WorkDirectory,$false));$rows+=@{name='alternate-native-drive';passed=$alternate['SystemDrive'] -ceq 'D:'}
$prior=$env:SystemDrive
try{$env:SystemDrive='Z:';$poisoned=Decode ([GuiEnvironmentTailFixture]::Build($system,$WorkDirectory,$false));$rows+=@{name='caller-system-drive-not-copied';passed=$poisoned['SystemDrive'] -ceq $expectedDrive}}finally{$env:SystemDrive=$prior}
foreach($case in @(@{name='unc-root-refused';path='\\server\share\Windows\System32'},@{name='device-root-refused';path='\\?\C:\Windows\System32'})){
 $refused=$false;try{[void][GuiEnvironmentTailFixture]::Build($case.path,$WorkDirectory,$false)}catch{$refused=$true};$rows+=@{name=$case.name;passed=$refused}
}
$rows+=@{name='installed-fixture-has-no-dotnet-overrides';passed=-not $environment.Contains('DOTNET_ROOT') -and -not $environment.Contains('DOTNET_ROOT_X64')}
$r=@{schemaVersion=1;harnessSha256=(Get-FileHash -LiteralPath $HarnessPath -Algorithm SHA256).Hash;tailSha256=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($tail))).Replace('-','');psVersion=[string]$PSVersionTable.PSVersion;psEdition=[string]$PSVersionTable.PSEdition;rows=$rows;environment=$environment;expectedDrive=$expectedDrive;nativeEnvironmentTokenCalls=0;nativeLaunches=0;startupEntryExecuted=$false;settingsTaskScmRegistryWrites=0}
[Console]::Out.WriteLine((Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject $r -Depth 8 -Compress))
