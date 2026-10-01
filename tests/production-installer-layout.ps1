param([Parameter(Mandatory=$true)][string]$TempRoot,[string]$BeforeSource='')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$project = Split-Path -Parent $PSScriptRoot
function Import-ProductionFunction([string]$SourcePath,[string]$Name,[string]$Alias='') {
  $tokens=$null; $parseErrors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($SourcePath,[ref]$tokens,[ref]$parseErrors)
  if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
  $node=$ast.Find({param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq $Name},$true)
  if (-not $node) { throw "Missing production function $Name" }
  if (-not $Alias) { $Alias=$node.Name }
  Invoke-Expression ('function script:' + $Alias + ' ' + $node.Body.Extent.Text)
}
function Assert([bool]$Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
$worker=Join-Path $project 'scripts\invoke-final-silent-reinstall.ps1'
foreach ($name in @('Resolve-FullPath','Get-FileSha256','Resolve-ManifestInstallerPath','Get-ValidatedRelease','Get-InstallerWatchdogWaitMilliseconds')) {
  Import-ProductionFunction $worker $name
}
Import-ProductionFunction (Join-Path $project 'src\installer\owned-cleanup.ps1') 'Remove-GuiElevationLayerToken'
if ($BeforeSource) { Import-ProductionFunction $BeforeSource 'Get-ValidatedRelease' 'Get-BeforeValidatedRelease' }
$caseRoot=Join-Path ([IO.Path]::GetFullPath($TempRoot)) ('l'+[Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $caseRoot -Force | Out-Null
$expected='EgoistShield-Setup-3.8.0.exe'
$passes=0
$beforeNestedRefusal=$false
foreach ($relativeDirectory in @('dist','dist\hardening-a123','dist\nightly\build-a123','updates')) {
  $directory=Join-Path $caseRoot $relativeDirectory
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $installer=Join-Path $directory $expected
  [IO.File]::WriteAllBytes($installer,[Text.Encoding]::UTF8.GetBytes('Own harmless byte fixture; this test does not execute an installer.'))
  $hash=Get-FileSha256 $installer
  $manifest=Join-Path $directory 'package-integrity.json'
  $relative=($relativeDirectory+'\'+$expected).Replace('\','/')
  $record=@{product='Egoist Lagom';version='3.8.0';installer=@{path=$relative;sha256=$hash;bytes=(Get-Item -LiteralPath $installer).Length}}
  [IO.File]::WriteAllText($manifest,($record|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
  $result=Get-ValidatedRelease -Installer $installer -Manifest $manifest -Version '3.8.0' -Sha256 $hash
  Assert ($result.installer -eq $installer) 'Generation output installer must retain exact manifest identity.'
  $passes++
  if ($BeforeSource -and $relativeDirectory -eq 'dist\hardening-a123') {
    try { [void](Get-BeforeValidatedRelease -Installer $installer -Manifest $manifest -Version '3.8.0' -Sha256 $hash) }
    catch { $beforeNestedRefusal=$_.Exception.Message -eq 'Installer path is not the installer named by the integrity manifest.' }
    Assert $beforeNestedRefusal 'The old production validator must reproduce the nested-generation refusal.'
  }
  [IO.File]::AppendAllText($installer,'changed')
  $refused=$false
  try { [void](Get-ValidatedRelease -Installer $installer -Manifest $manifest -Version '3.8.0' -Sha256 $hash) } catch { $refused=$true }
  Assert $refused 'Changed candidate bytes must be refused before dispatch.'
  $passes++
}
foreach ($relative in @(('../'+$expected),('dist/../'+$expected),('dist//'+$expected),('dist/./'+$expected),('dist/evil:ads/'+$expected),('dist\'+$expected+':ads'),('C:\dist\'+$expected),('other/'+$expected))) {
  $refused=$false
  try { [void](Resolve-ManifestInstallerPath (Join-Path $caseRoot 'dist\package-integrity.json') $relative $expected) } catch { $refused=$true }
  Assert $refused ('Unsafe manifest path was accepted: '+$relative)
  $passes++
}
foreach ($case in @(
  @('RUNASADMIN',$null), @('~ RUNASADMIN',$null), @('~ HIGHDPIAWARE RUNASADMIN','~ HIGHDPIAWARE'),
  @('RUNASADMIN WIN8RTM  HIGHDPIAWARE','WIN8RTM HIGHDPIAWARE'), @('~ runasadmin WIN7RTM','~ WIN7RTM'),
  @('~ RUNASADMINLIKE HIGHDPIAWARE','~ RUNASADMINLIKE HIGHDPIAWARE'), @('~ HIGHDPIAWARE','~ HIGHDPIAWARE')
)) {
  $actual=Remove-GuiElevationLayerToken $case[0]
  Assert ($actual -ceq $case[1]) 'Only the exact owned GUI elevation token may be removed.'
  $passes++
}
Assert ((Get-InstallerWatchdogWaitMilliseconds -Deadline ([DateTime]::UtcNow.AddDays(1)) -MaximumSeconds 120) -eq 120000) 'A future wall-clock deadline must not extend the configured worker budget.'
$passes++
Assert ((Get-InstallerWatchdogWaitMilliseconds -Deadline ([DateTime]::UtcNow.AddDays(-1)) -MaximumSeconds 120) -eq 0) 'An expired persisted deadline must not gain a new waiting period.'
$passes++
$shortBudget=Get-InstallerWatchdogWaitMilliseconds -Deadline ([DateTime]::UtcNow.AddSeconds(15)) -MaximumSeconds 120
Assert ($shortBudget -gt 10000 -and $shortBudget -le 15000) 'A valid short persisted deadline must preserve its remaining budget.'
$passes++
[pscustomobject]@{passes=$passes;beforeNestedRefusal=$beforeNestedRefusal;actualProductionFunctions=$true;nativeFiles=$true;executedInstallers=0;registryMutations=0;serviceMutations=0;scope='Distribution path, candidate byte identity, and compatibility token preservation only'}|ConvertTo-Json -Compress
