param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$CandidateRoot
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$Source = [System.IO.Path]::GetFullPath($Source)
$CandidateRoot = [System.IO.Path]::GetFullPath($CandidateRoot).TrimEnd('\')
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Installer source parse failed' }
foreach ($name in @('installIdentityRequiredFiles', 'installHealthRequiredFiles')) {
  $matches = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and $node.Left.VariablePath.UserPath -eq $name }, $true))
  if ($matches.Count -ne 1) { throw "Ambiguous health input $name" }
  Invoke-Expression $matches[0].Extent.Text
}
foreach ($name in @('Get-FileSha256', 'Test-InstallRootIdentified', 'Test-InstallRootHealthy')) {
  $matches = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true))
  if ($matches.Count -ne 1) { throw "Ambiguous health function $name" }
  Invoke-Expression $matches[0].Extent.Text
}
$result = Test-InstallRootHealthy $CandidateRoot
$healthy = $result -is [bool] -and $result -eq $true
[pscustomobject]@{
  schemaVersion = 1
  healthy = $healthy
  root = [System.IO.Path]::GetFullPath($CandidateRoot).TrimEnd('\')
  sourceSha256 = Get-FileSha256 $Source
} | ConvertTo-Json -Compress
if (-not $healthy) { exit 1 }
