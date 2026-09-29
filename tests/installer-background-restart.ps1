$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$source=[IO.File]::ReadAllText((Join-Path $projectRoot 'scripts\invoke-final-silent-reinstall.ps1'),[Text.Encoding]::UTF8)
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Installer source did not parse.'}
$fn=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Start-InstalledDesktop'},$true)
if(-not $fn){throw 'Production desktop restart function missing.'}
. ([scriptblock]::Create($fn.Extent.Text))
$script:OwnedInstallRoot='C:\fixture\EgoistShield'
function Test-Path {param($LiteralPath,$PathType) return $LiteralPath -eq 'C:\fixture\EgoistShield\EgoistShield.exe'}
function Start-Process {param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle) $script:launch=[pscustomobject]@{file=$FilePath;arguments=$ArgumentList;directory=$WorkingDirectory;style=$WindowStyle}}
function Start-Sleep {param($Milliseconds)}
function Get-CimInstance {
  param($ClassName,$Filter,$ErrorAction)
  $script:reads++
  $command=if($script:reads -eq 1){'component-worker.cjs'}elseif($script:reads -eq 2){'--type=renderer'}else{'"C:\fixture\EgoistShield\EgoistShield.exe" --minimized'}
  [pscustomobject]@{ExecutablePath='C:\fixture\EgoistShield\EgoistShield.exe';CommandLine=$command}
}
foreach($hidden in @($true,$false)){
  $script:reads=0;$script:launch=$null
  Start-InstalledDesktop -State ([pscustomobject]@{minimizedAfter=$hidden})
  if($script:reads -ne 3){throw 'Core workers or renderer children were accepted as a running application.'}
  if($hidden -and ($script:launch.arguments -ne '--minimized' -or $script:launch.style -ne 'Hidden')){throw 'Background update restart would expose the window.'}
  if(-not $hidden -and ($script:launch.arguments -or $script:launch.style)){throw 'Explicit visible restart was changed.'}
}
Write-Output 'PASS: background restart stays hidden and application readiness excludes Core workers and renderer children'
