param(
  [Parameter(Mandatory=$true)][string]$FixturePath,
  [Parameter(Mandatory=$true)][string]$InheritedModulePath,
  [Parameter(Mandatory=$true)][string]$OwnModuleDirectory,
  [ValidateSet('control','production')][string]$Scenario='control',
  [string]$SourcePath=''
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) {
  throw 'This regression requires actual Windows PowerShell 5.'
}
if (-not [IO.File]::Exists($FixturePath)) { throw 'Ordinary caller-owned fixture is required.' }
$fixture=[IO.FileInfo]::new($FixturePath)
if (($fixture.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse fixture refused.' }
$moduleRoot=[IO.Path]::GetFullPath($OwnModuleDirectory)
$fixtureRoot=[IO.Path]::GetFullPath([IO.Path]::GetDirectoryName($FixturePath)).TrimEnd('\')+'\'
if (-not $moduleRoot.StartsWith($fixtureRoot,[StringComparison]::OrdinalIgnoreCase) -or
    -not [IO.Directory]::Exists($moduleRoot)) {
  throw 'Module isolation requires a directory inside the caller-owned fixture.'
}
$modulePathMatchesRequested=[string]::Equals($env:PSModulePath,$InheritedModulePath,[StringComparison]::Ordinal)
$modulePathContainsOwnDirectory=$false
$modulePathOwnDirectoryFirst=[string]::Equals(($env:PSModulePath -split ';')[0],$OwnModuleDirectory,[StringComparison]::OrdinalIgnoreCase)
foreach($entry in @($env:PSModulePath -split ';')) {
  if([string]::Equals($entry,$OwnModuleDirectory,[StringComparison]::OrdinalIgnoreCase)){$modulePathContainsOwnDirectory=$true}
}
$hasher=[Security.Cryptography.SHA256]::Create()
try{$modulePathSha256=[BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($env:PSModulePath))).Replace('-','').ToLowerInvariant()}finally{$hasher.Dispose()}
$sourceStatementsExecuted=0
if ($Scenario -eq 'production') {
  if (-not [IO.File]::Exists($SourcePath)) { throw 'Production entrypoint source is required.' }
  $tokens=$null;$parseErrors=$null
  $ast=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($SourcePath),[ref]$tokens,[ref]$parseErrors)
  if ($parseErrors.Count -ne 0 -or -not $ast.EndBlock -or $ast.EndBlock.Statements.Count -eq 0) { throw 'Entrypoint source cannot be parsed.' }
  $first=$ast.EndBlock.Statements[0]
  if ($first -isnot [Management.Automation.Language.IfStatementAst] -or $first.Extent.Text -notmatch 'PSEdition' -or $first.Extent.Text -notmatch 'Desktop') {
    throw 'The actual first entrypoint statement must be the Desktop module bootstrap.'
  }
  $commands=$first.FindAll({param($node) $node -is [Management.Automation.Language.CommandAst]},$true)
  $assignments=$first.FindAll({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst]},$true)
  if ($commands.Count -ne 0 -or $assignments.Count -ne 1 -or $assignments[0].Left -isnot [Management.Automation.Language.VariableExpressionAst] -or $assignments[0].Left.VariablePath.UserPath -ine 'env:PSModulePath') {
    throw 'Bootstrap isolation refuses commands or writes other than child PSModulePath.'
  }
  $calls=$first.FindAll({param($node) $node -is [Management.Automation.Language.InvokeMemberExpressionAst]},$true)
  foreach($call in $calls) {
    if ($call.Expression -isnot [Management.Automation.Language.TypeExpressionAst] -or
        (($call.Expression.TypeName.FullName -notin @('IO.Path','System.IO.Path') -or $call.Member.Extent.Text -ine 'Combine') -and
         ($call.Expression.TypeName.FullName -notin @('Environment','System.Environment') -or $call.Member.Extent.Text -ine 'GetFolderPath'))) {
      throw 'Bootstrap isolation refuses non-path native method calls.'
    }
  }
  . ([scriptblock]::Create($first.Extent.Text))
  $sourceStatementsExecuted=1
}
function Quote-BoundaryJson([string]$Text) {
  return '"' + $Text.Replace('\','\\').Replace('"','\"').Replace([string][char]13,'\r').Replace([string][char]10,'\n').Replace([string][char]9,'\t') + '"'
}
function Error-BoundaryJson($Failure) {
  return '{"ok":false,"errorClass":' + (Quote-BoundaryJson $Failure.Exception.GetType().FullName) +
    ',"errorId":' + (Quote-BoundaryJson $Failure.FullyQualifiedErrorId) + '}'
}
$failures=0
try {
  $acl=Get-Acl -LiteralPath $FixturePath -ErrorAction Stop
  $ownerPresent=-not [string]::IsNullOrEmpty($acl.Owner)
  $aclJson='{"ok":true,"ownerPresent":' + $ownerPresent.ToString().ToLowerInvariant() + '}'
} catch { $failures++;$aclJson=Error-BoundaryJson $_ }
try {
  $hash=Get-FileHash -LiteralPath $FixturePath -Algorithm SHA256 -ErrorAction Stop
  $hashJson='{"ok":true,"sha256":' + (Quote-BoundaryJson $hash.Hash.ToLowerInvariant()) + '}'
} catch { $failures++;$hashJson=Error-BoundaryJson $_ }
$json='{"schemaVersion":1,"kind":"installer-native-module-boundary","scenario":' + (Quote-BoundaryJson $Scenario) +
  ',"psEdition":' + (Quote-BoundaryJson $PSVersionTable.PSEdition) +
  ',"psVersion":' + (Quote-BoundaryJson $PSVersionTable.PSVersion.ToString()) +
  ',"modulePathMatchesRequested":' + $modulePathMatchesRequested.ToString().ToLowerInvariant() +
  ',"modulePathContainsOwnDirectory":' + $modulePathContainsOwnDirectory.ToString().ToLowerInvariant() +
  ',"modulePathOwnDirectoryFirst":' + $modulePathOwnDirectoryFirst.ToString().ToLowerInvariant() +
  ',"modulePathSha256":' + (Quote-BoundaryJson $modulePathSha256) +
  ',"sourceStatementsExecuted":' + $sourceStatementsExecuted +
  ',"commandsChecked":2,"failureCount":' + $failures + ',"acl":' + $aclJson + ',"hash":' + $hashJson + '}'
[Console]::Out.WriteLine($json)
if ($failures -ne 0) { exit 1 }
exit 0
