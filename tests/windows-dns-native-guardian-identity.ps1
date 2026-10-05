[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$SourcePath,
  [Parameter(Mandatory=$true)][string]$WorkRoot
)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
foreach($value in @($SourcePath,$WorkRoot)){
  if(-not [IO.Path]::IsPathRooted($value) -or -not [IO.Path]::GetFullPath($value).Equals($value,[StringComparison]::OrdinalIgnoreCase)){throw 'Absolute controlled source/work paths required.'}
}
if(-not [IO.Directory]::Exists($WorkRoot) -or ([IO.File]::GetAttributes($WorkRoot) -band [IO.FileAttributes]::ReparsePoint)){throw 'Owned ordinary work directory required.'}
$tokens=$null;$errors=$null
$source=[IO.File]::ReadAllText($SourcePath)
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Controlled source AST errors.'}
$guardian=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Invoke-DnsGuardian'},$false))
if($guardian.Count -ne 1){throw 'Actual guardian definition ambiguous.'}
$assignments=@($guardian[0].FindAll({param($n)$n -is [Management.Automation.Language.AssignmentStatementAst]},$true))
$reader=@($assignments | Where-Object {$_.Left.Extent.Text -ceq '$plan' -and $_.Right.Extent.Text.Contains('ConvertFrom-Json')})
$comparison=@($assignments | Where-Object {$_.Left.Extent.Text -ceq '$alive' -and $_.Right.Extent.Text.Contains('$parent.StartTime')})
if($reader.Count -ne 1 -or $comparison.Count -ne 1){throw 'Actual reader/identity expression ambiguous.'}
$actualReader=[ScriptBlock]::Create($reader[0].Extent.Text)
$actualPredicate=[ScriptBlock]::Create($comparison[0].Right.Extent.Text)
$actualDelta=@($comparison[0].Right.FindAll({param($n)$n -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $n.Extent.Text.StartsWith('[Math]::Abs(')},$true))
if($actualDelta.Count -ne 1){throw 'Actual identity delta expression ambiguous.'}
$actualDelta=[ScriptBlock]::Create($actualDelta[0].Extent.Text)
# The old predicate is the same actual source expression with only the reviewed cast reversed.
$fixedCast='([DateTimeOffset]$plan.parentCreatedUtc).UtcDateTime'
$oldParse='[DateTimeOffset]::Parse($plan.parentCreatedUtc).UtcDateTime'
if(-not $comparison[0].Right.Extent.Text.Contains($fixedCast)){throw 'Production identity cast absent.'}
$oldPredicate=[ScriptBlock]::Create($comparison[0].Right.Extent.Text.Replace($fixedCast,$oldParse))
$oldDelta=[ScriptBlock]::Create($actualDelta.ToString().Replace($fixedCast,$oldParse))
if(-not $guardian[0].Extent.Text.Contains('GetProcessById([int]$plan.parentPid)') -or
   -not $guardian[0].Extent.Text.Contains('-lt 20') -or
   -not $guardian[0].Extent.Text.Contains('$plan.timeoutSeconds -ne 180') -or
   -not $guardian[0].Extent.Text.Contains('$plan.maximumSeconds -ne 1200') -or
   -not $guardian[0].Extent.Text.Contains("if(-not "+'$alive'+")") -or
   -not $guardian[0].Extent.Text.Contains('$parent.Dispose()')){throw 'Existing guardian guards changed.'}
$readerText=$reader[0].Extent.Text
$script:ControlledRaw=''
# Substitute only file reading. Never invoke a guardian, service, native API or foreign PID.
function Get-Content {
  [CmdletBinding()]param([string]$LiteralPath,[switch]$Raw)
  if($LiteralPath -cne 'controlled-plan.json' -or -not $Raw){throw 'Unexpected file query.'}
  return $script:ControlledRaw
}
function Stop-Service {throw 'Unexpected live SCM mutation.'}
function Get-CimInstance {throw 'Unexpected native query.'}
function Set-DnsClientServerAddress {throw 'Unexpected live DNS mutation.'}
function Get-ScheduledTask {throw 'Unexpected live Task query.'}
function Read-ControlledPlan([string]$Json) {
  $script:ControlledRaw=$Json;$planPath='controlled-plan.json';$plan=$null
  . $actualReader
  return $plan
}
function Compare-Controlled($Plan,[DateTime]$Birth,[bool]$Exited,[bool]$Old) {
  $plan=$Plan;$parent=[pscustomobject]@{StartTime=$Birth;HasExited=$Exited}
  $alive=$false;$delta=$null;$errorType=$null
  try{
    if($Old){$alive=& $oldPredicate;$delta=& $oldDelta}
    else{$alive=& $actualPredicate;$delta=& $actualDelta}
  }catch{$alive=$false;$errorType=$_.Exception.GetType().Name}
  return [ordered]@{alive=[bool]$alive;differenceMilliseconds=$delta;errorType=$errorType}
}
function Check([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
$sample='2026-10-05T01:41:55.1106698Z'
$sampleBirth=[DateTimeOffset]::Parse($sample,[Globalization.CultureInfo]::InvariantCulture).UtcDateTime
$originalCulture=[Threading.Thread]::CurrentThread.CurrentCulture
$originalUICulture=[Threading.Thread]::CurrentThread.CurrentUICulture
$rows=[Collections.Generic.List[object]]::new()
try{
  foreach($cultureName in @('en-US','ru-RU')){
    $culture=[Globalization.CultureInfo]::GetCultureInfo($cultureName)
    [Threading.Thread]::CurrentThread.CurrentCulture=$culture
    [Threading.Thread]::CurrentThread.CurrentUICulture=$culture
    $json='{"parentPid":3892,"parentCreatedUtc":"'+$sample+'"}'
    $plan=Read-ControlledPlan $json
    $old=Compare-Controlled $plan $sampleBirth $false $true
    $fixed=Compare-Controlled $plan $sampleBirth $false $false
    Check ($fixed.alive -and $fixed.differenceMilliseconds -eq 0) 'Exact default-JSON birth failed.'
    $inputFraction=$null;$oldParsedFraction=$null
    if($plan.parentCreatedUtc -is [DateTime]){
      Check (-not $old.alive) 'Typed DateTime old parse unexpectedly preserved identity.'
      $inputFraction=[double]($plan.parentCreatedUtc.Ticks % [TimeSpan]::TicksPerSecond)/[TimeSpan]::TicksPerMillisecond
      $oldParsedFraction=[double]([DateTimeOffset]::Parse($plan.parentCreatedUtc).UtcDateTime.Ticks % [TimeSpan]::TicksPerSecond)/[TimeSpan]::TicksPerMillisecond
      if($cultureName -ceq 'en-US'){Check ([Math]::Abs($inputFraction-110.6698) -lt 0.0001 -and $oldParsedFraction -eq 0) 'en-US fractional precision discriminator differs.'}
    }else{Check ($plan.parentCreatedUtc -is [string] -and $old.alive) 'Legacy JSON string compatibility changed.'}
    $rows.Add([ordered]@{culture=$cultureName;case='default-json';valueType=$plan.parentCreatedUtc.GetType().FullName;rendered=[string]$plan.parentCreatedUtc;localUtcOffsetMinutes=[TimeZoneInfo]::Local.GetUtcOffset($sampleBirth).TotalMinutes;inputFractionMilliseconds=$inputFraction;oldParsedFractionMilliseconds=$oldParsedFraction;old=$old;fixed=$fixed})
    foreach($value in @(
      $sample,
      '2026-10-05T03:41:55.1106698+02:00',
      $sampleBirth,
      [DateTimeOffset]::Parse('2026-10-05T03:41:55.1106698+02:00',[Globalization.CultureInfo]::InvariantCulture)
    )){
      $result=Compare-Controlled @{parentCreatedUtc=$value} $sampleBirth $false $false
      Check ($result.alive -and $result.differenceMilliseconds -eq 0) 'String/typed/offset precision changed.'
      $rows.Add([ordered]@{culture=$cultureName;case='string-typed-offset';valueType=$value.GetType().FullName;result=$result})
    }
    foreach($milliseconds in @(20,50)){
      $result=Compare-Controlled $plan $sampleBirth.AddMilliseconds($milliseconds) $false $false
      Check (-not $result.alive) 'Wrong birth crossed original 20ms guard.'
      $rows.Add([ordered]@{culture=$cultureName;case='wrong-birth';milliseconds=$milliseconds;result=$result})
    }
    $result=Compare-Controlled $plan $sampleBirth.AddMilliseconds(19) $false $false
    Check $result.alive 'Existing strict-less-than tolerance changed.'
    foreach($bad in @($null,'fixture-invalid-timestamp',42)){
      $result=Compare-Controlled @{parentCreatedUtc=$bad} $sampleBirth $false $false
      Check (-not $result.alive) 'Malformed/null identity accepted.'
      $rows.Add([ordered]@{culture=$cultureName;case='malformed-or-null-refused';result=$result})
    }
    $result=Compare-Controlled $plan $sampleBirth $true $false
    Check (-not $result.alive) 'Exited-parent guard changed.'
    $rows.Add([ordered]@{culture=$cultureName;case='exited-parent-refused';result=$result})
    $malformedRefused=$false;try{[void](Read-ControlledPlan '{')}catch{$malformedRefused=$true}
    Check $malformedRefused 'Malformed JSON was swallowed.'
  }
}finally{
  [Threading.Thread]::CurrentThread.CurrentCulture=$originalCulture
  [Threading.Thread]::CurrentThread.CurrentUICulture=$originalUICulture
}
$own=[Diagnostics.Process]::GetCurrentProcess()
try{
  $ownBirth=$own.StartTime.ToUniversalTime()
  $ownPlan=Read-ControlledPlan ('{"parentPid":'+$own.Id+',"parentCreatedUtc":"'+$ownBirth.ToString('o')+'"}')
  $ownResult=Compare-Controlled $ownPlan $ownBirth $false $false
  Check ($ownResult.alive -and $ownResult.differenceMilliseconds -eq 0) 'Own process birth comparison failed.'
}finally{$own.Dispose()}
$receipt=[ordered]@{
  schemaVersion=1;kind='inert-actual-guardian-identity-expression';accepted=$true
  powershell=$PSVersionTable.PSVersion.ToString();edition=$PSVersionTable.PSEdition
  exactSample=$sample;retainedToleranceMilliseconds=20;retainedHeartbeatSeconds=180;retainedMaximumSeconds=1200
  sourceSha256=(Get-FileHash -LiteralPath $SourcePath -Algorithm SHA256).Hash
  fixtureSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash
  readerExtractedFromActualSource=$true;predicateExtractedFromActualSource=$true;readerUnchanged=$true
  cases=$rows.ToArray();ownProcessBirthMatch=$ownResult
  actualNativeAcceptance=$false;guardianInvocations=0;serviceNetworkTaskRegistryMutations=0;foreignPidQueries=0
}
$json=$receipt|ConvertTo-Json -Depth 7
$out=Join-Path $WorkRoot ('guardian-identity-'+$PSVersionTable.PSEdition+'-'+$PSVersionTable.PSVersion.Major+'-r2.json')
if([IO.File]::Exists($out)){throw 'Inert receipt already exists.'}
[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false))
Write-Output ('RECEIPT='+$out)