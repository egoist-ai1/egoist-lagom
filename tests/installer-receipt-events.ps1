param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$root=[IO.Path]::GetFullPath($TestDirectory)
if (-not $root.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Use task-owned temporary files.' }
$source=Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\invoke-final-silent-reinstall.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Production source does not parse in WinPS5.1.' }
$prefix='Local\LagomReceiptFixture.'+[Guid]::NewGuid().ToString('N')+'.'
$functions=@{}
foreach ($name in @('Add-ReceiptEvent','Enter-InstallerReceiptLease','New-InstallerReceiptMutexSecurity','New-InstallerProtectedFileSecurity','Write-JsonAtomic')) {
  $fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if (-not $fn) { throw "Missing production function $name." }
  $functions[$name]=$fn.Extent.Text.Replace('Global\EgoistShield.InstallerReceipt.',$prefix)
  . ([scriptblock]::Create($functions[$name]))
}
function Require([bool]$Value,[string]$Message) { if (-not $Value) { throw $Message } }
$security=New-InstallerReceiptMutexSecurity
$identities=@($security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object {$_.IdentityReference.Value})
Require ($security.AreAccessRulesProtected -and $security.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq 'S-1-5-32-544' -and $identities.Count -eq 2 -and $identities -contains 'S-1-5-18' -and $identities -contains 'S-1-5-32-544') 'Production receipt mutex ACL object is untrusted.'
# The host token cannot assign BA ownership. Only ACL factories are replaced;
# actual WinPS FileStream, flush/replace, mutex and receipt functions run below.
$fixtureSecurity=@'
function New-InstallerReceiptMutexSecurity {
  $security=New-Object Security.AccessControl.MutexSecurity
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $security.SetOwner($identity);$security.SetAccessRuleProtection($true,$false)
  $security.AddAccessRule((New-Object Security.AccessControl.MutexAccessRule($identity,'FullControl','Allow')))
  return $security
}
function New-InstallerProtectedFileSecurity {
  $security=New-Object Security.AccessControl.FileSecurity
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $security.SetOwner($identity);$security.SetAccessRuleProtection($true,$false)
  $security.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')))
  return $security
}
function Write-BrandedInstallerStatus {param($Stage,$Status,$Message,$Data)}
'@
. ([scriptblock]::Create($fixtureSecurity))
$before=Join-Path (Split-Path -Parent $PSScriptRoot) 'docs\product-review-2026-09-30\installer\receipt-event-before.ps1'
$beforeAst=[Management.Automation.Language.Parser]::ParseFile($before,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Immutable pre-fix excerpt does not parse.' }
$beforeFn=$beforeAst.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Add-ReceiptEvent'},$true)
if (-not $beforeFn) { throw 'Missing pre-fix receipt function.' }
function Get-FixtureMutexName([string]$StageDirectory) {
  $hasher=[Security.Cryptography.SHA256]::Create()
  try { return $prefix+[BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($StageDirectory).TrimEnd('\').ToLowerInvariant()))).Replace('-','') }
  finally { $hasher.Dispose() }
}
function Invoke-WriterInterleave([string]$Name,[bool]$Corrected) {
  $stagePath=Join-Path $root $Name
  New-Item -ItemType Directory -Path $stagePath -Force | Out-Null
  $ready=New-Object Threading.ManualResetEventSlim($false)
  $release=New-Object Threading.ManualResetEventSlim($false)
  $secondStarted=New-Object Threading.ManualResetEventSlim($false)
  $secondRead=New-Object Threading.ManualResetEventSlim($false)
  $writerBody=@'
param($Definitions,$Security,$StagePath,$Writer,$Ready,$Release,$SecondStarted,$SecondRead)
$ErrorActionPreference='Stop';Set-StrictMode -Version 2.0
. ([scriptblock]::Create($Definitions));. ([scriptblock]::Create($Security))
$script:StageDirectory=$StagePath
$script:atomicWriter=(Get-Command Write-JsonAtomic -CommandType Function).ScriptBlock
function Write-JsonAtomic {
  param($Path,$Value)
  if ($Writer -eq 'A') {
    $Ready.Set()
    if (-not $Release.Wait(5000)) { throw 'First writer fixture was not released.' }
  } else { $SecondRead.Set() }
  & $script:atomicWriter -Path $Path -Value $Value
}
if ($Writer -eq 'B') { $SecondStarted.Set() }
Add-ReceiptEvent -Stage 'fixture' -Status $Writer -Message ('event-'+$Writer)
'@
  $receiptDefinition=if($Corrected){$functions['Add-ReceiptEvent']}else{$beforeFn.Extent.Text}
  $definitions=($functions['Enter-InstallerReceiptLease'],$functions['New-InstallerReceiptMutexSecurity'],$functions['New-InstallerProtectedFileSecurity'],$functions['Write-JsonAtomic'],$receiptDefinition) -join "`r`n"
  $writers=@();$async=@()
  try {
    foreach($writer in @('A','B')) {
      $pipe=[PowerShell]::Create()
      [void]$pipe.AddScript($writerBody).AddArgument($definitions).AddArgument($fixtureSecurity).AddArgument($stagePath).AddArgument($writer).AddArgument($ready).AddArgument($release).AddArgument($secondStarted).AddArgument($secondRead)
      $writers+=,$pipe
    }
    $async+=,$writers[0].BeginInvoke()
    Require ($ready.Wait(5000)) 'First actual receipt writer did not reach its final-write gate.'
    $async+=,$writers[1].BeginInvoke()
    Require ($secondStarted.Wait(5000)) 'Second actual receipt writer did not start.'
    if ($Corrected) {
      $probe=New-Object Threading.Mutex($false,(Get-FixtureMutexName $stagePath))
      try {
        $available=$probe.WaitOne(0)
        if ($available) { $probe.ReleaseMutex() }
        Require (-not $available) 'Production receipt writer did not retain its mutex across the complete read/update/write.'
      } finally { $probe.Dispose() }
      Require (-not $secondRead.Wait(100)) 'Concurrent receipt writer entered before the first commit.'
    } else {
      Require ($secondRead.Wait(5000)) 'Baseline interleave did not reach the competing final-write gate.'
      Require ($async[1].AsyncWaitHandle.WaitOne(5000)) 'Baseline second writer did not commit before the first.'
    }
    $release.Set()
    for($i=0;$i -lt 2;$i++) {
      Require ($async[$i].AsyncWaitHandle.WaitOne(5000)) 'Actual receipt writer exceeded the bounded fixture wait.'
      [void]$writers[$i].EndInvoke($async[$i])
      Require ($writers[$i].Streams.Error.Count -eq 0) ('Actual receipt writer failed: '+($writers[$i].Streams.Error -join '|'))
    }
    $receipt=Get-Content -LiteralPath (Join-Path $stagePath 'receipt.json') -Raw | ConvertFrom-Json
    if($Corrected) { Require (($receipt.events.status -join ',') -eq 'A,B' -and $receipt.status -eq 'B') 'Serialized receipt lost or reordered a committed event.' }
    else { Require ($receipt.events.Count -eq 1 -and $receipt.events[0].status -eq 'A') 'The exact pre-fix receipt lost-event defect was not reproduced.' }
  } finally {
    $release.Set()
    foreach($pipe in $writers){$pipe.Dispose()}
    foreach($gate in @($ready,$release,$secondStarted,$secondRead)){$gate.Dispose()}
  }
}
Invoke-WriterInterleave 'before' $false
Write-Output 'PASS: exact pre-fix production receipt AST loses the competing committed event'
Invoke-WriterInterleave 'corrected' $true
Write-Output 'PASS: concurrent actual production writers serialize and preserve both committed events'

$script:StageDirectory=Join-Path $root 'failure'
New-Item -ItemType Directory -Path $script:StageDirectory -Force | Out-Null
$receiptPath=Join-Path $StageDirectory 'receipt.json'
[IO.File]::WriteAllText($receiptPath,'{broken')
$refused=$false;try { Add-ReceiptEvent -Stage 'fixture' -Status 'bad-json' } catch { $refused=$true }
Require $refused 'Invalid existing receipt was silently overwritten.'
Remove-Item -LiteralPath $receiptPath -Force
$actualWriter=(Get-Command Write-JsonAtomic -CommandType Function).ScriptBlock
function Write-JsonAtomic {param($Path,$Value) throw 'Fixture commit failure'}
$refused=$false;try { Add-ReceiptEvent -Stage 'fixture' -Status 'failed-write' } catch { $refused=$_.Exception.Message -like '*commit failure*' }
Require $refused 'Fixture did not exercise a receipt commit failure.'
Set-Item -LiteralPath 'Function:\Write-JsonAtomic' -Value $actualWriter
Add-ReceiptEvent -Stage 'fixture' -Status 'retry'
$receipt=Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
Require ($receipt.events.Count -eq 1 -and $receipt.status -eq 'retry') 'Exception path retained a receipt lease or produced an uncommitted event.'
Write-Output 'PASS: parse and commit failures release the lease and retain retry eligibility'

Add-Type -TypeDefinition @'
using System.Threading;
public static class LagomReceiptAbandonFixture {
  public static Mutex Held;
  public static void OwnAndExit(string name) {
    var owner = new Thread(() => { Held = new Mutex(false, name); Held.WaitOne(); });
    owner.Start(); owner.Join();
  }
}
'@
$script:StageDirectory=Join-Path $root 'abandoned'
New-Item -ItemType Directory -Path $StageDirectory -Force | Out-Null
[LagomReceiptAbandonFixture]::OwnAndExit((Get-FixtureMutexName $StageDirectory))
try { Add-ReceiptEvent -Stage 'fixture' -Status 'after-abandon' }
finally { [LagomReceiptAbandonFixture]::Held.Dispose() }
$receipt=Get-Content -LiteralPath (Join-Path $StageDirectory 'receipt.json') -Raw | ConvertFrom-Json
Require ($receipt.status -eq 'after-abandon' -and $receipt.events.Count -eq 1) 'An abandoned actual receipt mutex prevented the subsequent writer.'
Write-Output 'PASS: abandoned actual named mutex is recovered without dropping its next event'
Write-Output 'Installer receipt serialization: 4 groups passed; native SCM/registry/DNS/tasks 0; actual isolated mutex/runspaces/file writes.'
