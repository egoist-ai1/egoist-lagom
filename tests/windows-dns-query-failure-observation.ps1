[CmdletBinding()]
param([Parameter(Mandatory)][string]$DnsSource,[Parameter(Mandatory)][string]$Output)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$tokens=$null;$errors=$null;$source=[IO.File]::ReadAllText($DnsSource,[Text.Encoding]::UTF8)
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Actual query helper has parse errors.'}
$functions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-DnsWindowsProbe'},$true))
if($functions.Count -ne 1){throw 'Actual query helper cardinality changed.'}
$statements=@($functions[0].Body.EndBlock.Statements)
# Exclude only the original native type definition. Its actual API/type/options are
# checked structurally, and its P/Invoke code is never compiled or executed.
$definition=$statements[0].Extent.Text
if($definition -notmatch "if\(-not \('LagomNativeDnsQuery' -as \[type\]\)\)" -or $definition -notmatch 'Add-Type -TypeDefinition' -or $definition -notmatch 'DnsQuery_W\(name,1,0x848,' -or $definition -notmatch 'DnsRecordListFree\(records,1\)') {throw 'Native definition boundary changed.'}
$body=($statements | Select-Object -Skip 1 | ForEach-Object {$_.Extent.Text}) -join "`n"
$nativeCall='[LagomNativeDnsQuery]::Query('
if(($body.Split(@($nativeCall),[StringSplitOptions]::None)).Count -ne 3){throw 'Actual helper does not query exactly two scopes.'}
# These are the only two native adapters; all predicate/serialization/throw/return
# statements execute from the actual parsed source, without whole-script startup.
$body=$body.Replace($nativeCall,'Invoke-FixtureQuery -Name (')
$body=$body.Replace('[Console]::Error.WriteLine(','Write-FixtureDiagnostic -Line (')
if($body -match 'LagomNativeDnsQuery|DllImport|Add-Type|\[Console\]') {throw 'Native code reached the inert body.'}
Invoke-Expression ('function Invoke-FixtureProbe {'+"`n"+$body+"`n"+'}')
function Invoke-FixtureQuery {
  param([string]$Name)
  $script:QueryNames.Add($Name)
  $index=$script:QueryNames.Count
  if($index -gt 2){throw 'Unexpected query retry.'}
  if($script:Config.queryThrowAt -eq $index){throw 'fixture-query-failure'}
  $kind=if($index -eq 1){'positive'}else{'negative'}
  $addresses=[Collections.Generic.List[string]]::new()
  for($i=0;$i -lt [int]$script:Config[$kind+'Count'];$i++){$addresses.Add('192.0.2.'+($i+1))}
  return [pscustomobject]@{name=$Name;status=[int]$script:Config[$kind+'Status'];addresses=$addresses;elapsedMs=$script:Config[$kind+'Elapsed'];api='DnsQuery_W';options=0x848;cacheBypassed=$true;hostsBypassed=$true;multicastDisabled=$true;privateExtra='fixture-private-value'}
}
function Write-FixtureDiagnostic {
  param([string]$Line)
  $script:WriteAttempts++
  if($script:Config.writeThrow){throw 'fixture-diagnostic-write-failure'}
  $script:Lines.Add($Line)
}
$cases=[Collections.Generic.List[object]]::new()
function Run-Control([string]$Name,$Control,[bool]$ExpectedSuccess,[string]$ErrorMarker='',[switch]$RequireDiagnostic,[int]$ExpectedQueryCount=2){
  $script:Config=@{positiveStatus=0;positiveCount=1;positiveElapsed=1.25;negativeStatus=9003;negativeCount=0;negativeElapsed=2.5;writeThrow=$false;queryThrowAt=0;label=('a'*20)}
  foreach($key in $Control.Keys){$script:Config[$key]=$Control[$key]}
  $script:DnsProbeLabel=$script:Config.label;$script:QueryNames=[Collections.Generic.List[string]]::new();$script:Lines=[Collections.Generic.List[string]]::new();$script:WriteAttempts=0
  $errorRecord=$null;$returned=@()
  try{$returned=@(Invoke-FixtureProbe)}catch{$errorRecord=$_}
  $accepted=$null -eq $errorRecord;$passed=$accepted -eq $ExpectedSuccess
  $passed=$passed -and $script:QueryNames.Count -eq $ExpectedQueryCount
  if($ExpectedQueryCount -gt 0){$passed=$passed -and $script:QueryNames[0] -ceq 'example.com.'}
  if($ExpectedQueryCount -gt 1){$passed=$passed -and $script:QueryNames[1] -ceq ('lagom-'+$script:DnsProbeLabel+'.example.com.')}
  if($ErrorMarker){$passed=$passed -and $errorRecord -and $errorRecord.Exception.ToString().Contains($ErrorMarker)}
  if($ExpectedSuccess){
    $passed=$passed -and $returned.Count -eq 1 -and $script:Lines.Count -eq 0 -and $script:WriteAttempts -eq 0
    if($returned.Count -eq 1){
      $result=$returned[0];$passed=$passed -and $result.ok -and -not $result.encryptedWireClaim -and $result.records.Count -eq 2 -and $result.names.Count -eq 2
      $passed=$passed -and $result.records[0].status -eq 0 -and $result.records[0].addresses.Count -ge 1 -and $result.records[1].status -eq 9003
      # The existing successful QueryProbe JSON remains one complete object.
      $json=($result | ConvertTo-Json -Depth 8) | ConvertFrom-Json
      $passed=$passed -and $json.ok -and $json.records.Count -eq 2 -and -not $json.encryptedWireClaim
    }
  }else{$passed=$passed -and $returned.Count -eq 0}
  if($RequireDiagnostic){
    $passed=$passed -and $script:Lines.Count -eq 1 -and $script:WriteAttempts -eq 1
    if($script:Lines.Count -eq 1){
      $line=$script:Lines[0];$prefix='[lagom-dns-query] '
      $passed=$passed -and $line.StartsWith($prefix,[StringComparison]::Ordinal) -and $line.Length -le 4096 -and -not $line.Contains('192.0.2.') -and -not $line.Contains('fixture-private-value')
      $d=$line.Substring($prefix.Length) | ConvertFrom-Json
      $passed=$passed -and $d.schemaVersion -eq 1 -and $d.kind -ceq 'windows-dns-query-failure' -and $d.scope -ceq 'windows-system-dns-query-probe' -and $d.recordType -eq 1 -and $d.options -eq 0x848 -and -not $d.encryptedWireClaim
      $passed=$passed -and [DateTimeOffset]::Parse($d.startedAtUtc) -le [DateTimeOffset]::Parse($d.finishedAtUtc)
      $passed=$passed -and $d.names.Count -eq 2 -and $d.names[0] -ceq $script:QueryNames[0] -and $d.names[1] -ceq $script:QueryNames[1] -and $d.records.Count -eq 2
      for($i=0;$i -lt 2;$i++){
        $kind=if($i -eq 0){'positive'}else{'negative'};$record=$d.records[$i]
        $passed=$passed -and $record.role -ceq $kind -and $record.status -eq [int]$script:Config[$kind+'Status'] -and $record.addressCount -eq [int]$script:Config[$kind+'Count'] -and $record.elapsedMs -eq [double]$script:Config[$kind+'Elapsed']
        $passed=$passed -and $record.api -ceq 'DnsQuery_W' -and $record.options -eq 0x848 -and $record.cacheBypassed -and $record.hostsBypassed -and $record.multicastDisabled
        $passed=$passed -and -not $record.PSObject.Properties['addresses'] -and -not $record.PSObject.Properties['privateExtra']
      }
    }
  }elseif(-not $ExpectedSuccess){$passed=$passed -and $script:Lines.Count -eq 0}
  $cases.Add([ordered]@{name=$Name;passed=[bool]$passed;accepted=$accepted;expectedAccepted=$ExpectedSuccess;queryCount=$script:QueryNames.Count;diagnosticCount=$script:Lines.Count;writeAttempts=$script:WriteAttempts;errorClass=$(if($errorRecord){$errorRecord.Exception.GetType().Name}else{$null})})
}
$gate='Real cache-bypassing Windows DNS positive/NXDOMAIN query failed.'
Run-Control 'normal-positive-one-and-nxdomain' @{} $true
Run-Control 'normal-positive-multiple-and-nxdomain' @{positiveCount=2} $true
Run-Control 'existing-negative-status-only-criterion' @{negativeCount=1} $true
Run-Control 'positive-nxdomain-status' @{positiveStatus=9003} $false $gate -RequireDiagnostic
Run-Control 'positive-other-status' @{positiveStatus=1460} $false $gate -RequireDiagnostic
Run-Control 'positive-no-addresses' @{positiveCount=0} $false $gate -RequireDiagnostic
Run-Control 'negative-success-no-addresses' @{negativeStatus=0} $false $gate -RequireDiagnostic
Run-Control 'negative-success-with-address' @{negativeStatus=0;negativeCount=1} $false $gate -RequireDiagnostic
Run-Control 'negative-other-status' @{negativeStatus=9002} $false $gate -RequireDiagnostic
Run-Control 'both-statuses-failed' @{positiveStatus=1460;negativeStatus=9002} $false $gate -RequireDiagnostic
Run-Control 'diagnostic-writer-failure-original-gate-retained' @{positiveStatus=1460;writeThrow=$true} $false $gate
Run-Control 'diagnostic-serialization-failure-original-gate-retained' @{positiveStatus=1460;positiveElapsed='not-a-number'} $false $gate
Run-Control 'oversized-diagnostic-suppressed-original-gate-retained' @{positiveStatus=1460;label=('a'*5000)} $false $gate
Run-Control 'empty-label-refuses-before-query' @{label=''} $false 'Owned random probe identity is required.' -ExpectedQueryCount 0
Run-Control 'positive-adapter-exception-no-retry' @{queryThrowAt=1} $false 'fixture-query-failure' -ExpectedQueryCount 1
Run-Control 'negative-adapter-exception-no-retry' @{queryThrowAt=2} $false 'fixture-query-failure'
Run-Control 'successful-query-never-writes-failure-diagnostic' @{writeThrow=$true} $true
$failed=@($cases | Where-Object {-not $_.passed})
$result=[ordered]@{schemaVersion=1;kind='actual-windows-dns-query-failure-inert-regression';powershellVersion=$PSVersionTable.PSVersion.ToString();caseCount=$cases.Count;passedCaseCount=$cases.Count-$failed.Count;allPassed=($failed.Count -eq 0);cases=$cases;nativeDefinitionCompiled=$false;actualPInvokeCalls=0;actualDnsQueries=0;networkCalls=0;serviceMutations=0;registryWrites=0;sourceWrites=0;limitations=@('The two query adapters are controlled returned native-query records; no original R18 query statuses are inferred.','Only the native type definition and query/writer adapters are replaced; actual parsed predicate, diagnostics and return/throw execute unchanged.')}
[IO.File]::WriteAllText($Output,($result | ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
Write-Output ('inert-dns-query '+$result.passedCaseCount+'/'+$result.caseCount)
if($failed.Count){exit 1}