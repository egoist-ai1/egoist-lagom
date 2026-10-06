param(
  [Parameter(Mandatory=$true)][string]$DpiLibraryPath,
  [Parameter(Mandatory=$true)][string]$SharedLibraryPath,
  [Parameter(Mandatory=$true)][string]$Work
)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$phase='input'
$rows=@()
function Require([bool]$Value,[string]$Reason) { if(-not $Value){throw $Reason} }
function FileSha([string]$Path) {
  $digest=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($digest.ComputeHash([IO.File]::ReadAllBytes($Path)))).Replace('-','').ToLowerInvariant()}
  finally{$digest.Dispose()}
}
function Parse-Library([string]$Path) {
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tokens,[ref]$errors)
  Require (@($errors).Count -eq 0) 'library-parse-error'
  return $ast
}
function Load-InertLibrary([string]$Path,[bool]$Trace,$Ast) {
  $savedError=[Console]::Error;$savedOutput=[Console]::Out
  $errorCapture=[IO.StringWriter]::new();$outputCapture=[IO.StringWriter]::new()
  $gateProbeArguments=@{LibraryOnly=$true}
  if($Trace){$gateProbeArguments.TraceReadonlyBootstrap=$true}
  $gateProbeDeclared=@($Ast.ParamBlock.Parameters | ForEach-Object{$_.Name.VariablePath.UserPath})
  $gateProbeSentinels=@{Mode='Run';IntegrityManifestPath='own-inert-integrity';CandidateAssetsDirectory='own-inert-assets';ExpectedSourceCommit=('a'*40);EvidenceDirectory='own-inert-evidence';SoakMinutes=0;UpgradeBaselineInstaller='own-inert-baseline'}
  foreach($gateProbeProperty in $gateProbeSentinels.Keys){
    if($gateProbeDeclared -contains $gateProbeProperty){$gateProbeArguments[$gateProbeProperty]=$gateProbeSentinels[$gateProbeProperty]}
  }
  try{
    [Console]::SetError($errorCapture);[Console]::SetOut($outputCapture)
    $pipelineOutput=@(. $Path @gateProbeArguments)
    Require ($pipelineOutput.Count -eq 0 -and $outputCapture.ToString() -ceq '') 'library-stdout-changed'
    foreach($gateProbeProperty in $gateProbeSentinels.Keys){
      if($gateProbeDeclared -contains $gateProbeProperty){
        Require ((Get-Variable -Name $gateProbeProperty -ValueOnly) -ceq $gateProbeSentinels[$gateProbeProperty]) ('library-parameter-not-preserved-'+$gateProbeProperty)
      }
    }
    Require ([bool]$LibraryOnly -and [bool]$TraceReadonlyBootstrap -eq $Trace) 'library-switch-parameters-not-preserved'
    return $errorCapture.ToString()
  }finally{
    [Console]::SetError($savedError);[Console]::SetOut($savedOutput)
    $errorCapture.Dispose();$outputCapture.Dispose()
  }
}
try{
  $Work=[IO.Path]::GetFullPath($Work)
  Require ($Work -ceq [IO.Path]::GetFullPath($env:TEMP) -and $Work -ceq [IO.Path]::GetFullPath($env:TMP)) 'unique-private-test-work-required'
  $ownDirectory=Get-Item -LiteralPath $Work -Force
  Require ($ownDirectory.PSIsContainer -and ($ownDirectory.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'ordinary-own-work-required'
  $DpiLibraryPath=[IO.Path]::GetFullPath($DpiLibraryPath);$SharedLibraryPath=[IO.Path]::GetFullPath($SharedLibraryPath)
  Require ([IO.Path]::GetFileName($DpiLibraryPath) -ceq 'windows-dpi-native-acceptance.ps1' -and [IO.Path]::GetFileName($SharedLibraryPath) -ceq 'windows-production-acceptance.ps1' -and [IO.Path]::GetDirectoryName($DpiLibraryPath) -ceq [IO.Path]::GetDirectoryName($SharedLibraryPath)) 'actual-paired-libraries-required'
  $beforeHashes=@{}
  $parentModulePath=$env:PSModulePath
  $userModulePath=[Environment]::GetEnvironmentVariable('PSModulePath','User')
  $machineModulePath=[Environment]::GetEnvironmentVariable('PSModulePath','Machine')
  foreach($library in @(@{path=$DpiLibraryPath;kind='dpi'},@{path=$SharedLibraryPath;kind='shared'})){
    $phase=$library.kind+'-library-contract'
    $item=Get-Item -LiteralPath $library.path -Force
    Require (-not $item.PSIsContainer -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'ordinary-library-file-required'
    $beforeHashes[$library.kind]=FileSha $library.path
    $bytes=[IO.File]::ReadAllBytes($library.path)
    if(@($bytes | Where-Object{$_ -ge 128}).Count -gt 0){
      Require ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) 'nonascii-library-needs-PS5-BOM'
    }
    $ast=Parse-Library $library.path
    $declared=@($ast.ParamBlock.Parameters | ForEach-Object{$_.Name.VariablePath.UserPath})
    Require ($declared -contains 'LibraryOnly' -and $declared -contains 'TraceReadonlyBootstrap') 'explicit-library-trace-switch-required'
    $rows+=@{name=$library.kind+'-actual-params-parser-BOM';passed=$true}
    Require ((Load-InertLibrary $library.path $false $ast) -ceq '') 'default-library-emits-diagnostics'
    $rows+=@{name=$library.kind+'-default-silent-and-caller-params-preserved';passed=$true}
    $text=Load-InertLibrary $library.path $true $ast
    $actual=@($text -split '\r?\n' | Where-Object{$_})
    $expected=if($library.kind -ceq 'shared'){
      @('readonly-library|shared|bootstrap-start','readonly-library|shared|definitions-ready')
    }else{
      @('readonly-library|dpi|bootstrap-start','readonly-library|dpi|parameters-captured','readonly-library|shared|bootstrap-start','readonly-library|shared|definitions-ready','readonly-library|dpi|shared-library-ready','readonly-library|dpi|parameters-restored','readonly-library|dpi|definitions-ready')
    }
    Require ($actual.Count -eq $expected.Count) 'fixed-stage-cardinality'
    for($index=0;$index -lt $actual.Count;$index++){
      Require ($actual[$index] -cmatch ('^'+[regex]::Escape($expected[$index])+'\|[0-9]+$')) 'fixed-stage-order-or-content'
    }
    $rows+=@{name=$library.kind+'-explicit-fixed-ordered-stderr-stages';passed=$true}
    $gates=@($ast.EndBlock.Statements | Where-Object{$_ -is [Management.Automation.Language.IfStatementAst] -and $_.Extent.Text.Contains('readonly-library|')})
    Require ($gates.Count -ge 2) 'actual-boundary-gates-required'
    foreach($gate in $gates){
      Require ($gate.Clauses.Count -eq 1 -and $gate.Clauses[0].Item1.Extent.Text -ceq '$LibraryOnly -and $TraceReadonlyBootstrap') 'trace-not-restricted-to-explicit-LibraryOnly'
    }
    $rows+=@{name=$library.kind+'-trace-gated-by-both-switches';passed=$true}
  }
  $phase='actual-inert-query'
  . $DpiLibraryPath -LibraryOnly
  $script:Work=$Work
  $script:InertCimCalls=0;$script:InertCimDenied=$false
  function Get-CimInstance {
    param([string]$ClassName,[string]$Filter,[int]$OperationTimeoutSec,[string]$ErrorAction)
    Require ($ClassName -ceq 'Win32_Service' -and $Filter -match 'EgoistShield') 'nonfixture-CIM-refused'
    $script:InertCimCalls++
    if($script:InertCimDenied){throw 'own-inert-services-refusal'}
    return @()
  }
  # Only this inert leaf is replaced. No actual SCM/tasks/network query runs.
  $value=@(Get-NativeProductServices)
  Require ($value.Count -eq 0 -and $script:InertCimCalls -eq 1) 'inert-services-query-changed'
  $rows+=@{name='actual-services-controller-inert-empty-result';passed=$true}
  $script:InertCimDenied=$true;$script:InertCimCalls=0;$refusal=$null
  try{Get-NativeProductServices | Out-Null}catch{$refusal=$_}
  Require ($null -ne $refusal -and $refusal.Exception.Message -ceq 'own-inert-services-refusal' -and $script:InertCimCalls -eq 2) 'services-refusal-swallowed-or-retry-changed'
  $rows+=@{name='actual-services-controller-two-attempt-refusal';passed=$true}
  $phase='readonly-bootstrap-dispatch'
  $script:BootstrapRequests=@()
  function Invoke-DpiTool {
    param([string]$Executable,[string[]]$Arguments,[string]$Label,[int]$Seconds,[string]$InputText='')
    $index=[Array]::IndexOf($Arguments,'-EncodedCommand')
    Require ($index -ge 0) 'encoded-command-not-dispatched'
    $body=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Arguments[$index+1]))
    $tokens=$null;$errors=$null;$bodyAst=[Management.Automation.Language.Parser]::ParseInput($body,[ref]$tokens,[ref]$errors)
    Require (@($errors).Count -eq 0) 'encoded-command-parse-error'
    $imports=@($bodyAst.FindAll({param($node)$node -is [Management.Automation.Language.CommandAst] -and $node.InvocationOperator -eq [Management.Automation.Language.TokenKind]::Dot},$true))
    Require ($imports.Count -eq 1) 'library-import-dispatch-cardinality'
    $parameters=@($imports[0].CommandElements | Where-Object{$_ -is [Management.Automation.Language.CommandParameterAst]} | ForEach-Object{$_.ParameterName})
    Require ($parameters -contains 'LibraryOnly' -and $parameters -contains 'TraceReadonlyBootstrap') 'snapshot-must-explicitly-opt-in-to-trace'
    $name=$Label -replace '^final-readonly-',''
    Require ($Seconds -eq 9 -and $name -cin @('services','tasks','drivers','winws','network')) 'bounded-inert-bootstrap-request'
    $script:BootstrapRequests+=@{name=$name;seconds=$Seconds;traceOptIn=$true}
    return ([ordered]@{schemaVersion=1;kind='readonly-final-state';name=$name;value=@()} | ConvertTo-Json -Compress)
  }
  foreach($name in @('services','tasks','drivers','winws','network')){
    $snapshot=Invoke-DpiReadonlySnapshot $name 9
    Require ($null -ne $snapshot -and @($snapshot).Count -eq 0) 'readonly-snapshot-schema-changed'
  }
  Require ($script:BootstrapRequests.Count -eq 5) 'readonly-request-count'
  $rows+=@{name='actual-five-bootstrap-dispatches-explicit-trace-no-process-launch';passed=$true}
  $phase='actual-diagnostic-serializer'
  $stderr="readonly-stage|services|process-start|1"+[char]10+"readonly-library|dpi|bootstrap-start|0"+[char]10+"readonly-library|shared|definitions-ready|7"+[char]10+"readonly-library|dpi|unknown-stage|5"+[char]10+"readonly-library|dpi|bootstrap-start|secret"+[char]10+"own-unrelated-text"+[char]10
  $stderrSource=[Threading.Tasks.TaskCompletionSource[string]]::new();$stderrSource.SetResult($stderr)
  $stdoutSource=[Threading.Tasks.TaskCompletionSource[string]]::new();$stdoutSource.SetResult('{}')
  # Serializer-only fake owner: no process/SCM identity or retirement claim.
  $owner=@{processId=123;executable='own-inert-serializer';birthTicks=123;stderr=$stderrSource.Task}
  $first=[Management.Automation.ErrorRecord]::new([InvalidOperationException]::new('own-primary-refusal'),'own-primary-refusal',[Management.Automation.ErrorCategory]::InvalidOperation,$null)
  $retirement=[Management.Automation.ErrorRecord]::new([InvalidOperationException]::new('own-retirement-unconfirmed'),'own-retirement-unconfirmed',[Management.Automation.ErrorCategory]::InvalidOperation,$null)
  Save-DpiReadonlyToolDiagnostics $owner $stdoutSource.Task 'own-stage-grammar' 15 ([Diagnostics.Stopwatch]::StartNew()) $first $retirement
  $observation=Get-Content -LiteralPath (Join-Path $Work 'own-stage-grammar.observation.json') -Raw | ConvertFrom-Json
  Require ($observation.stages.Count -eq 3 -and $observation.stages[0] -ceq 'readonly-stage|services|process-start|1' -and $observation.stages[1] -ceq 'readonly-library|dpi|bootstrap-start|0' -and $observation.stages[2] -ceq 'readonly-library|shared|definitions-ready|7') 'serializer-stage-whitelist'
  Require (-not $observation.retirementConfirmed -and $observation.primaryError -ceq 'own-primary-refusal' -and $observation.retirementError -ceq 'own-retirement-unconfirmed') 'primary-error-or-unknown-retirement-changed'
  $rows+=@{name='actual-serializer-fixed-stage-whitelist';passed=$true}
  $rows+=@{name='actual-serializer-primary-refusal-unconfirmed-retirement-preserved';passed=$true}
  $phase='child-module-policy'
  $startInfo=[Diagnostics.ProcessStartInfo]::new()
  $startInfo.EnvironmentVariables['PSModulePath']='own-inert-modern-module-path'
  Set-NativeWindowsPowerShellChildEnvironment -StartInfo $startInfo
  $nativeModules=[IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows),'System32\WindowsPowerShell\v1.0\Modules')
  Require ($startInfo.EnvironmentVariables['PSModulePath'] -ceq $nativeModules) 'actual-child-native-module-pin'
  Require ($env:PSModulePath -ceq $parentModulePath -and [Environment]::GetEnvironmentVariable('PSModulePath','User') -ceq $userModulePath -and [Environment]::GetEnvironmentVariable('PSModulePath','Machine') -ceq $machineModulePath) 'process-user-machine-module-path-changed'
  $rows+=@{name='actual-child-module-setter-parent-user-machine-preserved';passed=$true}
  Require ((FileSha $DpiLibraryPath) -ceq $beforeHashes.dpi -and (FileSha $SharedLibraryPath) -ceq $beforeHashes.shared) 'library-readonly-hash-drift'
  $rows+=@{name='actual-libraries-not-written';passed=$true}
  $proof=[ordered]@{kind='portable-DPI-readonly-library-trace-guard';schemaVersion=1;major=$PSVersionTable.PSVersion.Major;powershell=$PSVersionTable.PSVersion.ToString();cases=$rows.Count;passed=$rows.Count;rows=$rows;sourceSha256=$beforeHashes;actualHostScmNetworkQueries=0;processesLaunchedByFixture=0;driverLoadsOrOpens=0;nativeMutations=0;installedPrivateReads=0;sourceWrites=0;parentUserMachineModulePathPreserved=$true;nativeCleanupClaimed=$false}
  [IO.File]::WriteAllText((Join-Path $Work 'trace-guard-proof.json'),($proof | ConvertTo-Json -Depth 8)+[char]10,[Text.UTF8Encoding]::new($false))
  $proof | ConvertTo-Json -Depth 8 -Compress
}catch{
  [Console]::Error.WriteLine('trace-guard-error|'+$phase+'|'+$_.FullyQualifiedErrorId)
  exit 1
}
