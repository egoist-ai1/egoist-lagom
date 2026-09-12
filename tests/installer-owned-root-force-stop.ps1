$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot '..\src\installer\owned-cleanup.ps1'
$source = [IO.File]::ReadAllText([IO.Path]::GetFullPath($sourcePath))
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$names = @('Stop-AllProcessesFromOwnedRoots', 'Stop-AllServicesFromOwnedRoots')
$definitions = foreach ($name in $names) {
  $fn = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if (-not $fn) { throw "Function not found: $name" }
  $fn.Extent.Text
}

$script:ownedServices = @('EgoistShieldCore')
$script:legacyOwnedServices = @()
$script:sharedNameServices = @()
$script:stoppedProcesses = @()
$script:stoppedServices = @()
function Test-OwnedPath { param($Path) return [string]$Path -like 'C:\Owned\*' }
function Get-ExecutableFromCommandLine { param($Value) return [string]$Value }
function Stop-OwnedProcessByPath { param($Name, [switch]$QuietForeign) $script:stoppedProcesses += [string]$Name }
function Stop-OwnedService { param($Name, $Delete) $script:stoppedServices += [string]$Name }
function Write-Journal { param($Stage, $Extra) }
function Get-CimInstance {
  param([string]$ClassName)
  if ($ClassName -eq 'Win32_Process') {
    return @(
      [pscustomobject]@{ ProcessId = 9911; Name = 'old-helper.exe'; ExecutablePath = 'C:\Owned\Old\old-helper.exe' },
      [pscustomobject]@{ ProcessId = 9912; Name = 'old-helper.exe'; ExecutablePath = 'C:\Other\old-helper.exe' },
      [pscustomobject]@{ ProcessId = 9913; Name = 'foreign.exe'; ExecutablePath = 'C:\Other\foreign.exe' }
    )
  }
  if ($ClassName -eq 'Win32_Service') {
    return @(
      [pscustomobject]@{ Name = 'EgoistShieldCore'; PathName = 'C:\Owned\Core.exe' },
      [pscustomobject]@{ Name = 'LegacyShieldService'; PathName = 'C:\Owned\Old\service.exe' },
      [pscustomobject]@{ Name = 'ForeignService'; PathName = 'C:\Other\service.exe' }
    )
  }
  return @()
}
. ([ScriptBlock]::Create($definitions -join [Environment]::NewLine))

Stop-AllProcessesFromOwnedRoots
Stop-AllServicesFromOwnedRoots
if (@($script:stoppedProcesses).Count -ne 1 -or $script:stoppedProcesses[0] -ne 'old-helper.exe') {
  throw "Unexpected process force-stop set: $($script:stoppedProcesses -join ',')"
}
if (@($script:stoppedServices).Count -ne 1 -or $script:stoppedServices[0] -ne 'LegacyShieldService') {
  throw "Unexpected service force-stop set: $($script:stoppedServices -join ',')"
}
Write-Output 'Owned-root force-stop discovery: PASS'
