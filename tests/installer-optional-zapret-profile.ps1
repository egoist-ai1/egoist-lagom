[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$SourcePath)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($SourcePath,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Actual production source does not parse.'}
$fn=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-PreservedZapretProfile'},$true)
if(-not $fn){throw 'Missing actual optional-profile reader.'}
. ([scriptblock]::Create($fn.Extent.Text))
$script:path='Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\EgoistShieldZapret'
$script:validKey='HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\EgoistShieldZapret'
$script:cases=New-Object 'Collections.Generic.List[object]'
function Require([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function New-Case {
  $script:keyCalls=0;$script:closeCalls=0;$script:kindCalls=0
  $script:keyError=$null;$script:keyName=$script:validKey;$script:names=@('EgoistShieldProfile')
  $script:kind=[Microsoft.Win32.RegistryValueKind]::String;$script:afterKind=$script:kind;$script:value='GENERAL (ALT)'
  $script:readError=$false;$script:namesError=$false;$script:kindError=$false;$script:zeroKey=$false
}
function Get-Item {
  param([string]$LiteralPath,[string]$ErrorAction)
  Require ($LiteralPath -ceq $script:path -and $ErrorAction -ceq 'Stop') 'Registry adapter received an unbounded target or nonterminating policy.'
  $script:keyCalls++
  if($script:keyError){throw $script:keyError}
  if($script:zeroKey){return $null}
  $key=[pscustomobject]@{Name=$script:keyName}
  $key | Add-Member ScriptMethod GetValueNames {if($script:namesError){throw [IO.IOException]::new('Fixture names read failure')};return $script:names}
  $key | Add-Member ScriptMethod GetValueKind {
    param($Name)
    Require ($Name -ceq 'EgoistShieldProfile') 'Unexpected registry value name.'
    if($script:kindError){throw [IO.IOException]::new('Fixture value disappeared')}
    $script:kindCalls++
    if($script:kindCalls -eq 1){return $script:kind};return $script:afterKind
  }
  $key | Add-Member ScriptMethod GetValue {
    param($Name,$Default,$Options)
    Require ($Name -ceq 'EgoistShieldProfile' -and $null -eq $Default -and $Options -eq [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) 'Profile read must preserve exact unexpanded data.'
    if($script:readError){throw [IO.IOException]::new('Fixture value read failure')}
    return ,$script:value
  }
  $key | Add-Member ScriptMethod Close {$script:closeCalls++}
  return $key
}
function Pass-Value([string]$Case,[object[]]$Records,[AllowEmptyString()][string]$Expected,[int]$ExpectedReads,[int]$ExpectedCloses){
  $actual=Get-PreservedZapretProfile -Records $Records
  Require ($actual -is [string] -and $actual -ceq $Expected) ($Case+': exact data not preserved')
  Require ($script:keyCalls -eq $ExpectedReads -and $script:closeCalls -eq $ExpectedCloses) ($Case+': registry scope or disposal differs')
  $script:cases.Add([ordered]@{name=$Case;result='passed';registryAdapterCalls=$script:keyCalls;closed=$script:closeCalls})
}
function Refuse([string]$Case,[object[]]$Records,[string]$Pattern,[int]$ExpectedReads,[int]$ExpectedCloses){
  $message=$null;try{[void](Get-PreservedZapretProfile -Records $Records)}catch{$message=$_.Exception.Message}
  Require ($message -and $message -like $Pattern) ($Case+': expected refusal; got '+$message)
  Require ($script:keyCalls -eq $ExpectedReads -and $script:closeCalls -eq $ExpectedCloses) ($Case+': refused read leaked its handle or crossed its boundary')
  $script:cases.Add([ordered]@{name=$Case;result='refused-as-required';registryAdapterCalls=$script:keyCalls;closed=$script:closeCalls})
}
$dpi=[pscustomobject]@{name='EgoistShieldZapret'}
New-Case;Pass-Value 'no installed DPI' @() '' 0 0
New-Case;Pass-Value 'Core-only installed snapshot' @([pscustomobject]@{name='EgoistShieldCore'}) '' 0 0
New-Case;Pass-Value 'exact existing profile' @($dpi) 'GENERAL (ALT)' 1 1
New-Case;Pass-Value 'SCM name is case-insensitive' @([pscustomobject]@{name='egoistshieldzapret'}) 'GENERAL (ALT)' 1 1
New-Case;$script:names=@();Pass-Value 'installed DPI without optional value' @($dpi) '' 1 1
New-Case;$script:value='';Pass-Value 'explicit empty REG_SZ' @($dpi) '' 1 1
New-Case;$script:value='A'*80;Pass-Value 'maximum exact profile length' @($dpi) ('A'*80) 1 1
New-Case;Refuse 'duplicate SCM identities' @($dpi,[pscustomobject]@{name='egoistshieldzapret'}) '*ambiguous*' 0 0
New-Case;$script:keyError=[Management.Automation.ItemNotFoundException]::new('Fixture owned registry key disappeared');Refuse 'owned key disappeared' @($dpi) '*disappeared*' 1 0
New-Case;$script:keyError=[UnauthorizedAccessException]::new('Fixture registry access denied');Refuse 'temporary registry access failure' @($dpi) '*access denied*' 1 0
New-Case;$script:zeroKey=$true;Refuse 'provider returns zero objects' @($dpi) '*identity is unverified*' 1 0
New-Case;$script:keyName='HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\Foreign';Refuse 'foreign registry key identity' @($dpi) '*identity differs*' 1 1
New-Case;$script:namesError=$true;Refuse 'names read failure' @($dpi) '*names read failure*' 1 1
New-Case;$script:kindError=$true;Refuse 'value disappears after enumeration' @($dpi) '*value disappeared*' 1 1
New-Case;$script:readError=$true;Refuse 'value read failure' @($dpi) '*value read failure*' 1 1
New-Case;$script:kind=[Microsoft.Win32.RegistryValueKind]::DWord;$script:afterKind=$script:kind;$script:value=1;Refuse 'REG_DWORD cannot coerce to a profile' @($dpi) '*metadata is invalid*' 1 1
New-Case;$script:afterKind=[Microsoft.Win32.RegistryValueKind]::ExpandString;Refuse 'kind changes during reading' @($dpi) '*metadata is invalid*' 1 1
New-Case;$script:value=$null;Refuse 'present value becomes null' @($dpi) '*metadata is invalid*' 1 1
New-Case;$script:value=@('GENERAL','ALT');Refuse 'non-string profile cannot coerce' @($dpi) '*metadata is invalid*' 1 1
foreach($bad in @('   ',('../GENERAL'),('A'*81),"GENERAL`n",('A'*80+"`n"),"GENERAL`r",("GENERAL`r`n"),"GENERAL`nALT")){
  New-Case;$script:value=$bad;Refuse ('malformed exact string '+$script:cases.Count) @($dpi) '*name is invalid*' 1 1
}
[ordered]@{schemaVersion=1;kind='actual-production-optional-zapret-profile-reader';powerShell=$PSVersionTable.PSVersion.ToString();edition=$PSVersionTable.PSEdition;cases=$script:cases.Count;pass=$script:cases.Count;fail=0;sourceSha256=([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes($SourcePath))).Replace('-','').ToLowerInvariant());results=$script:cases.ToArray();actualRegistryReads=0;nativeServiceActions=0;privateDataReads=0;fullWorkerRun=$false;limits='Actual reader AST with fixed registry leaf adapter; no installed registry, service, Task, UAC or Setup actions.'}|ConvertTo-Json -Depth 6
