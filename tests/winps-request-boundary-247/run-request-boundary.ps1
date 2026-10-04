# Prepare-only artifact. Run only after root review, from an actual High caller.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Executable,
  [Parameter(Mandatory)][ValidateSet('clr','pipeline','parameter','pipeline-progress-silent','security','full-bootstrap')][string]$Case,
  [Parameter(Mandatory)][string]$Work
)
$ErrorActionPreference='Stop'
if(-not [IO.Path]::IsPathRooted($Executable) -or -not [IO.Path]::IsPathRooted($Work)){throw 'Absolute reviewed executable and fresh owned work required.'}
if(-not [IO.File]::Exists($Executable) -or -not [IO.Directory]::Exists($Work)){throw 'Reviewed executable and owned work must exist.'}
& $Executable --case $Case --work $Work
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$receipt=Join-Path $Work ('winps-boundary-'+$Case+'.json')
if(-not [IO.File]::Exists($receipt)){throw 'Fixed measurement receipt absent.'}
$result=[IO.File]::ReadAllText($receipt) | ConvertFrom-Json
if(-not $result.success -or -not $result.measurementComplete -or -not $result.cleanup.noOrphans){throw 'Bounded measurement transport did not complete.'}
