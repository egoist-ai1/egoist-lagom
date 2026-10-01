[CmdletBinding()]
param(
  [ValidateSet('Run','GuardOnly')][string]$Mode='Run',
  [ValidateSet('3.7.8','3.7.9')][string]$ExpectedOldVersion='3.7.9',
  [string]$OldReleaseAssetsDirectory='',
  [string]$CandidateReleaseAssetsDirectory='',
  [string]$IntegrityManifestPath='',
  [string]$EvidenceDirectory='',
  [ValidatePattern('^$|^[a-f0-9]{40}$')][string]$ExpectedSourceCommit='',
  [switch]$LibraryOnly
)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$legacyParameters=@{Mode=$Mode;ExpectedOldVersion=$ExpectedOldVersion;OldReleaseAssetsDirectory=$OldReleaseAssetsDirectory;CandidateReleaseAssetsDirectory=$CandidateReleaseAssetsDirectory;IntegrityManifestPath=$IntegrityManifestPath;EvidenceDirectory=$EvidenceDirectory;ExpectedSourceCommit=$ExpectedSourceCommit;LibraryOnly=$LibraryOnly}
. (Join-Path $PSScriptRoot 'windows-production-acceptance.ps1') -LibraryOnly
# Dot sourcing the read-only library binds its parameters in the caller scope.
foreach($parameterName in $legacyParameters.Keys){Set-Variable -Name $parameterName -Value $legacyParameters[$parameterName]}

function Test-LegacyHarnessStageProcess {
  param([object]$Process,[string]$Stage,[string]$PowerShellPath)
  if([string]$Process.ExecutablePath -ine $PowerShellPath){return $false}
  $file=[regex]::Escape((Join-Path $Stage 'invoke-final-silent-reinstall.ps1'));$directory=[regex]::Escape($Stage)
  return [string]$Process.CommandLine -match ('(?i)(?:^|\s)-File\s+(?:"'+$file+'"|'+$file+')(?=\s|$)') -and
    [string]$Process.CommandLine -match '(?i)(?:^|\s)-(?:Worker|Watchdog)(?=\s|$)' -and
    [string]$Process.CommandLine -match ('(?i)(?:^|\s)-StageDirectory\s+(?:"'+$directory+'"|'+$directory+')(?=\s|$)')
}
function Get-LegacyHarnessStageObserver {
  param([string]$Stage)
  $full=Assert-NativePathWithin $Stage $script:DeferredRoot
  if([IO.Path]::GetDirectoryName($full) -ine $script:DeferredRoot -or [IO.Path]::GetFileName($full) -cnotmatch '^[a-f0-9]{32}$'){throw 'Noncanonical legacy observer stage.'}
  return @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -OperationTimeoutSec 5 | Where-Object {Test-LegacyHarnessStageProcess -Process $_ -Stage $full -PowerShellPath $script:NativePowerShell})
}
function Read-LegacyHarnessJson {
  param([string]$Path,[int]$MaximumBytes=4194304)
  Assert-NativeOrdinaryPath $Path -Leaf
  if((Get-Item -LiteralPath $Path).Length -gt $MaximumBytes){throw "Native JSON exceeded its bound: $Path"}
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}
function Get-LegacyForeignRegistrationSnapshot {
  return [ordered]@{
    services=@(Get-CimInstance Win32_Service -OperationTimeoutSec 5 | Where-Object {$_.Name -notmatch '^Egoist(?:Shield|Lagom)'} | Sort-Object Name | Select-Object Name,StartMode,StartName,PathName)
    taskNames=@(Get-ScheduledTask | Where-Object {$_.TaskName -notmatch '(?i)Egoist(?:Shield|Lagom)'} | Sort-Object TaskPath,TaskName | Select-Object TaskPath,TaskName)
  }
}
function Assert-LegacyForeignRegistrationsPreserved {
  param([string]$Label)
  $actual=Get-LegacyForeignRegistrationSnapshot
  if(($actual | ConvertTo-Json -Depth 8 -Compress) -cne ($script:Receipt.beforeForeignRegistrations | ConvertTo-Json -Depth 8 -Compress)){throw "Unrelated service/task registrations changed at $Label; retained evidence requires review."}
  $script:Receipt.checks+=[ordered]@{name='unrelated-service-task-registrations-preserved';label=$Label;ok=$true};Save-NativeReceipt
}
function Invoke-LegacyArtifactVerification {
  param([string]$Label,[switch]$Installed)
  $options=[ordered]@{oldVersion=$ExpectedOldVersion;oldAssets=$script:OldAssets;candidateAssets=$script:CandidateAssets;integrityPath=$script:ManifestPath;sourceCommit=$script:SourceCommit;output=(Join-Path $script:Work ($Label+'.json'))}
  if($Installed){$options.installedRoot=$script:InstallRoot}
  $file=Join-Path $script:Work ($Label+'.options.json');$options | ConvertTo-Json | Set-Content -LiteralPath $file -Encoding utf8
  [void](Invoke-NativeBounded -Executable $script:Node -Arguments @($script:LegacyNodeHelper,'verify-assets',$file) -Label $Label -TimeoutSeconds 300)
  return Read-LegacyHarnessJson $options.output
}
function Test-LegacyHarnessProductVersion {
  param([string]$ActualVersion,[ValidateSet('3.7.8','3.7.9')][string]$ExpectedVersion)
  return $ActualVersion -ceq $ExpectedVersion -or $ActualVersion -ceq ($ExpectedVersion+'.0')
}
function Invoke-LegacyGui {
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
  $gui=Join-Path $script:InstallRoot 'EgoistShield.exe'
  [void](Assert-NativeAdministratorOwned $gui)
  if(-not (Test-LegacyHarnessProductVersion ([string](Get-Item -LiteralPath $gui).VersionInfo.ProductVersion) $ExpectedOldVersion)){throw "Actual GUI is not the authenticated old $ExpectedOldVersion."}
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$gui;$info.WorkingDirectory=$script:InstallRoot;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
  foreach($name in @($info.Environment.Keys)){if($name -match '^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH|LAGOM_TEST_USER_DATA_DIR|SHIELD_.*|EGOIST_.*)$'){[void]$info.Environment.Remove($name)}}
  $info.Environment['NODE_ENV']='production'
  $child=[Diagnostics.Process]::new();$child.StartInfo=$info;$started=$false;$closed=$false
  Add-NativeMutation -Kind 'old-canonical-gui-native-uia' -Target $gui -Purpose "Provision actual Telegram background service through shipped $ExpectedOldVersion controls, then normally close GUI."
  try{
    $started=$child.Start();if(-not $started){throw 'Actual old GUI did not start.'}
    $hwnd=Wait-NativeCondition -Condition {$child.Refresh();if($child.HasExited){throw 'Old GUI exited before its native window was ready.'};if($child.MainWindowHandle -ne [IntPtr]::Zero){return $child.MainWindowHandle}} -Label 'Old canonical GUI native window' -TimeoutSeconds 90
    if($child.MainModule.FileName -ine $gui){throw 'Old GUI process path changed.'}
    $root=[Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if(-not $root -or $root.Current.ProcessId -ne $child.Id){throw 'Old UIAutomation root does not belong to the launched GUI.'}
    $button=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button)
    $findButton={param([string]$Name)
      $named=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,$Name)
      $items=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.AndCondition]::new($button,$named))
      if($items.Count -eq 1 -and $items[0].Current.IsEnabled){return $items[0]}
    }
    $navigation=Get-NativeTelegramNavigation -FindButton $findButton -Label 'Actual old Telegram navigation control'
    ([Windows.Automation.InvokePattern]$navigation.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
    $install=Wait-NativeCondition -Condition {& $findButton 'Установить фоновую службу'} -Label 'Actual old Telegram background install control' -TimeoutSeconds 90
    ([Windows.Automation.InvokePattern]$install.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
    $wrapper=Join-Path $script:DataRoot 'Runtime\TelegramProxy\service-wrapper\egoistshield-telegram-proxy-service.exe'
    [void](Wait-NativeCondition -Condition {Assert-NativeService -Name 'EgoistShieldTelegramProxy' -Executable $wrapper -Running} -Label 'Actual old GUI provisioned Telegram SCM service' -TimeoutSeconds 240)
    $config=Read-LegacyHarnessJson (Join-Path $script:DataRoot 'Runtime\TelegramProxy\config.json')
    $port=[int]$config.port
    $endpoint=Assert-NativeTelegramEndpoint $port
    $pattern=$null
    if(-not $root.TryGetCurrentPattern([Windows.Automation.WindowPattern]::Pattern,[ref]$pattern)){throw 'Old native window close pattern is unavailable.'}
    ([Windows.Automation.WindowPattern]$pattern).Close()
    if(-not $child.WaitForExit(30000) -or $child.ExitCode -ne 0){throw 'Old GUI did not exit normally through its actual native close control.'};$closed=$true
    Assert-NativeNoGui
    $result=[ordered]@{version=$ExpectedOldVersion;processId=$child.Id;arguments=@();automation='native UIAutomation InvokePattern/WindowPattern';productionOverride=$false;exitCode=$child.ExitCode;port=$port;host=[string]$config.host;endpoint=$endpoint}
    $script:Receipt.gui+=$result;Save-NativeReceipt;return $result
  }finally{if($started -and -not $closed -and -not $child.HasExited){$child.Kill();[void]$child.WaitForExit(5000)};$child.Dispose()}
}
function Assert-LegacyNativeBootTask {
  param([string]$Stage)
  $name='EgoistShield-InstallerBootRecovery-'+[IO.Path]::GetFileName($Stage)
  $task=Get-ScheduledTask -TaskName $name -TaskPath '\' -ErrorAction Stop
  [xml]$xml=Export-ScheduledTask -TaskName $name -TaskPath '\'
  $ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
  $principal=$xml.SelectSingleNode('/t:Task/t:Principals/t:Principal',$ns);$action=$xml.SelectSingleNode('/t:Task/t:Actions/t:Exec',$ns)
  if(-not $principal -or -not $action -or $principal.UserId -notin @('S-1-5-18','SYSTEM') -or [string]$task.Principal.LogonType -ne 'ServiceAccount' -or $principal.RunLevel -ne 'HighestAvailable' -or @($xml.SelectNodes('/t:Task/t:Triggers/t:BootTrigger',$ns)).Count -ne 1 -or [string]$action.Command -ine $script:NativePowerShell -or -not ([string]$action.Arguments).Contains((Join-Path $Stage 'invoke-final-silent-reinstall.ps1')) -or -not ([string]$action.Arguments).Contains('"-Recover"') -or -not ([string]$action.Arguments).Contains($Stage)){throw 'Actual new bridge recovery Task principal/action/boot-trigger contract failed.'}
  $xml.Save((Join-Path $script:Work ($name+'.xml')))
  return [ordered]@{taskName=$name;taskPath=$task.TaskPath;principal=[string]$principal.UserId;logonType=[string]$task.Principal.LogonType;arguments=[string]$action.Arguments;actualBootExecuted=$false}
}
function Assert-LegacyRunAfterSuppression {
  $rows=@(Get-CimInstance Win32_Process -Filter "Name = 'EgoistShield.exe'" -OperationTimeoutSec 5)
  $script:Receipt.bridgeLaunchPreference=[ordered]@{oldRequestedRunAfter=$false;newGuiObserved=($rows.Count -ne 0);normalCloseRequired=$false;preferencePreserved=($rows.Count -eq 0)}
  Save-NativeReceipt
  if($rows.Count -ne 0){throw 'Actual legacy bridge launched a GUI despite the old helper NoRunAfter preference.'}
  Assert-NativeNoGui
}
function Copy-LegacyBoundedStageEvidence {
  param([string]$Stage,[string]$Label)
  if(-not (Test-Path -LiteralPath $Stage -PathType Container)){return}
  [void](Assert-NativePathWithin $Stage $script:DeferredRoot);Assert-NativeOrdinaryPath $Stage
  # Service snapshots, raw runtime backups and configuration contain secrets.
  # Retain original receipts/logs only; summaries omit private state contents.
  foreach($name in @('receipt.json','heartbeat.json','boot-recovery.json','boot-recovery-registration.json','complete.flag','worker.stdout.log','worker.stderr.log')){
    $source=Join-Path $Stage $name
    if(Test-Path -LiteralPath $source -PathType Leaf){Assert-NativeOrdinaryPath $source -Leaf;if((Get-Item -LiteralPath $source).Length -le 4194304){Copy-Item -LiteralPath $source -Destination (Join-Path $script:Work ($Label+'-'+$name))}}
  }
}
function Invoke-ActualLegacyBridge {
  $handoff=Join-Path $script:Work 'handoff';$updates=Join-Path $handoff 'updates'
  New-Item -ItemType Directory -Path $updates | Out-Null
  $installer=Join-Path $updates 'EgoistShield-Setup-3.8.0.exe'
  Copy-Item -LiteralPath $script:Installer -Destination $installer
  if((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ine $script:InstallerHash){throw 'Authenticated installer copy changed.'}
  # This is the same minimal SHA/size/path handoff schema generated by the
  # official old updater. It is derived from authenticated original assets;
  # the signed release metadata and signed integrity file remain unchanged.
  $handoffManifest=Join-Path $updates 'desktop-update-integrity.json'
  [ordered]@{schemaVersion=1;product='Egoist Lagom';version='3.8.0';installer=[ordered]@{path='updates/EgoistShield-Setup-3.8.0.exe';bytes=$script:AuthenticatedAssets.candidate.size;sha256=$script:InstallerHash.ToUpperInvariant()}} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $handoffManifest -Encoding utf8
  $helper=Join-Path $script:InstallRoot 'resources\installer\invoke-final-silent-reinstall.ps1'
  $oldHelperSha256=[string]$script:Receipt.oldInstalledTrust.installed.helperSha256
  if($oldHelperSha256 -cnotmatch '^[a-f0-9]{64}$' -or [string]$script:Receipt.oldInstalledTrust.installed.version -cne $ExpectedOldVersion -or (Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash -ine $oldHelperSha256){throw 'Old installed helper changed after genuine trust verification.'}
  Add-NativeMutation -Kind 'actual-old-helper-upgrade' -Target $helper -Purpose "Execute authenticated official installed $ExpectedOldVersion helper with signed 3.8.0 installer; do not substitute a new helper or alter recovery policy."
  $dispatch=Invoke-NativeBounded -Executable $script:NativePowerShell -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$helper,'-InstallerPath',$installer,'-IntegrityManifestPath',$handoffManifest,'-ExpectedVersion','3.8.0','-ExpectedSha256',$script:InstallerHash,'-FromVersion',$ExpectedOldVersion,'-NoRunAfter','-DelaySeconds','8') -Label 'old-helper-dispatch' -TimeoutSeconds 90
  $result=$dispatch.stdout | ConvertFrom-Json
  if($result.dispatched -ne $true -or [string]$result.runId -cnotmatch '^[a-f0-9]{32}$'){throw 'Old genuine dispatch did not return a canonical stage identity.'}
  $oldStage=Join-Path $script:DeferredRoot ([string]$result.runId)
  if([string]$result.state -ine (Join-Path $oldStage 'state.json') -or [string]$result.receipt -ine (Join-Path $oldStage 'receipt.json')){throw 'Old helper returned a foreign stage.'}
  [void](Assert-NativeAdministratorOwned $oldStage)
  $script:Receipt.legacyBridge=[ordered]@{oldVersion=$ExpectedOldVersion;oldStage=$oldStage;newStage=$null;oldHelperSha256=$oldHelperSha256;oldWorker=$null;oldWatchdog=$null;oldComplete=$null;newComplete=$null;bootTask=$null;quiescenceAtNewTask=$false;elapsedSeconds=$null};Save-NativeReceipt
  $observed=@{};$watch=[Diagnostics.Stopwatch]::StartNew();$newStage=$null
  try{
    while($watch.Elapsed.TotalSeconds -lt 1200){
      foreach($row in @(Get-LegacyHarnessStageObserver $oldStage)){
        $identity=Get-NativeProcessIdentity ([int]$row.ProcessId);$key=[string]$row.ProcessId+':'+$identity.createdUtc
        if(-not $observed.ContainsKey($key)){$observed[$key]=$identity}
        if([string]$row.CommandLine -match '(?i)(?:^|\s)-Watchdog(?=\s|$)'){$script:Receipt.legacyBridge.oldWatchdog=$identity}else{$script:Receipt.legacyBridge.oldWorker=$identity}
      }
      if(-not $newStage){
        $candidateStages=@()
        foreach($item in @(Get-ChildItem -LiteralPath $script:DeferredRoot -Directory -Force)){
          if($item.Name -ceq [string]$result.runId -or $item.Name -cnotmatch '^[a-f0-9]{32}$'){continue}
          Assert-NativeOrdinaryPath $item.FullName
          $statePath=Join-Path $item.FullName 'state.json'
          if(Test-Path -LiteralPath $statePath -PathType Leaf){
            $state=Read-LegacyHarnessJson $statePath
            if($state.PSObject.Properties['previousReinstallStage'] -and [string]$state.previousReinstallStage -ieq $oldStage){
              if($state.owner -ne 'EgoistShield' -or $state.version -ne '3.8.0' -or [string]$state.sha256 -ine $script:InstallerHash -or [int]$state.previousReinstallWaitMilliseconds -le 0){throw 'New actual bridge state identity is invalid.'}
              if(-not $state.PSObject.Properties['runAfter'] -or $state.runAfter -isnot [bool] -or $state.runAfter -ne $false -or -not $state.PSObject.Properties['minimizedAfter'] -or $state.minimizedAfter -isnot [bool] -or $state.minimizedAfter -ne $false){throw 'Actual new bridge state did not preserve old NoRunAfter/default minimized preference.'}
              $candidateStages+=$item.FullName
            }
          }
        }
        if($candidateStages.Count -gt 1){throw 'More than one actual new bridge claimed the old stage.'}
        if($candidateStages.Count -eq 1){$newStage=$candidateStages[0];$script:Receipt.legacyBridge.newStage=$newStage;[void](Assert-NativeAdministratorOwned $newStage);Save-NativeReceipt}
      }
      if($newStage){
        $taskName='EgoistShield-InstallerBootRecovery-'+[IO.Path]::GetFileName($newStage)
        if(-not $script:Receipt.legacyBridge.bootTask -and (Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue)){
          $script:Receipt.legacyBridge.bootTask=Assert-LegacyNativeBootTask $newStage
          if(@(Get-LegacyHarnessStageObserver $oldStage).Count -ne 0){throw 'New protected Task appeared before old worker/watchdog quiescence.'}
          $script:Receipt.legacyBridge.quiescenceAtNewTask=$true
          foreach($file in @('state.json','invoke-final-silent-reinstall.ps1','boot-recovery.json')){[void](Assert-NativeAdministratorOwned (Join-Path $newStage $file))};Save-NativeReceipt
        }
        if(Test-Path -LiteralPath (Join-Path $newStage 'complete.flag') -PathType Leaf){break}
      }elseif(Test-Path -LiteralPath (Join-Path $oldStage 'complete.flag') -PathType Leaf){
        $oldComplete=([IO.File]::ReadAllText((Join-Path $oldStage 'complete.flag'))).Trim()
        if($oldComplete -eq 'success'){throw 'Old helper unexpectedly installed directly; legacy bridge was not exercised.'}
      }
      Start-Sleep -Milliseconds 250
    }
    if(-not $newStage -or -not (Test-Path -LiteralPath (Join-Path $newStage 'complete.flag') -PathType Leaf)){throw 'Actual old-helper/new-bridge handoff exceeded 20 minutes.'}
    if(-not $script:Receipt.legacyBridge.oldWorker -or -not $script:Receipt.legacyBridge.oldWatchdog -or -not $script:Receipt.legacyBridge.bootTask -or -not $script:Receipt.legacyBridge.quiescenceAtNewTask){throw 'Actual worker/watchdog/Task transition was not fully observed.'}
    $oldReceipt=Read-LegacyHarnessJson (Join-Path $oldStage 'receipt.json');$newReceipt=Read-LegacyHarnessJson (Join-Path $newStage 'receipt.json')
    $oldExit=@($oldReceipt.events | Where-Object {$_.stage -eq 'installer' -and $_.status -eq 'installer-exited'})
    if($oldExit.Count -ne 1 -or [int]$oldExit[0].data.exitCode -ne 62){throw 'Actual old installer did not report the intentional bridge exit 62.'}
    if(@($newReceipt.events | Where-Object {$_.stage -eq 'verify' -and $_.status -eq 'succeeded'}).Count -ne 1){throw 'New actual bridge did not record successful native verification.'}
    $script:Receipt.legacyBridge.oldComplete=([IO.File]::ReadAllText((Join-Path $oldStage 'complete.flag'))).Trim()
    $script:Receipt.legacyBridge.newComplete=([IO.File]::ReadAllText((Join-Path $newStage 'complete.flag'))).Trim()
    if($script:Receipt.legacyBridge.oldComplete -ne 'failed-recovered' -or $script:Receipt.legacyBridge.newComplete -ne 'success'){throw 'Actual old/new completion flags do not prove restored old state followed by successful new installation.'}
    [void](Wait-NativeCondition -Condition {if(@(Get-LegacyHarnessStageObserver $oldStage).Count -eq 0 -and @(Get-LegacyHarnessStageObserver $newStage).Count -eq 0 -and @(Get-NativeProductTasks).Count -eq 0){return $true}} -Label 'Actual old/new worker/watchdog and recovery Task removal' -TimeoutSeconds 60)
    $script:Receipt.legacyBridge.elapsedSeconds=[Math]::Round($watch.Elapsed.TotalSeconds,2);$script:Receipt.legacyBridge.observedProcesses=@($observed.Values);Save-NativeReceipt
  }finally{Copy-LegacyBoundedStageEvidence $oldStage 'old-stage';if($newStage){Copy-LegacyBoundedStageEvidence $newStage 'new-stage'}}
}

function Invoke-NativeLegacyUpgrade {
  $environment=@{};foreach($name in @('GITHUB_ACTIONS','CI','RUNNER_ENVIRONMENT','RUNNER_OS','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA')){$environment[$name]=[Environment]::GetEnvironmentVariable($name)}
  $windows=[Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
  $administrator=$windows -and ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $errors=@(Get-NativeAcceptanceEnvironmentErrors $environment $administrator $windows)
  if($errors.Count -ne 0){throw ('Native legacy upgrade host guard refused before mutation: '+($errors -join ', '))}
  if($PSVersionTable.PSVersion.Major -lt 7 -or -not [Environment]::Is64BitProcess){throw 'PowerShell 7 x64 required.'}
  Assert-NativeOrdinaryPath $env:RUNNER_TEMP;Assert-NativeOrdinaryPath $env:GITHUB_WORKSPACE
  [void](Assert-NativePathWithin $PSCommandPath $env:GITHUB_WORKSPACE)
  if($Mode -eq 'GuardOnly'){Write-Output 'Native legacy guards passed; no mutation performed.';return}
  if($ExpectedSourceCommit -cnotmatch '^[a-f0-9]{40}$'){throw 'Explicit authenticated candidate build source commit is required.'}
  $script:Work=Join-Path ([IO.Path]::GetFullPath($env:RUNNER_TEMP)) ('lagom-legacy-native-'+$environment.GITHUB_RUN_ID+'-'+$environment.GITHUB_RUN_ATTEMPT)
  $script:OldAssets=Assert-NativePathWithin $OldReleaseAssetsDirectory $env:RUNNER_TEMP;$script:CandidateAssets=Assert-NativePathWithin $CandidateReleaseAssetsDirectory $env:RUNNER_TEMP
  Assert-NativeOrdinaryPath $script:OldAssets;Assert-NativeOrdinaryPath $script:CandidateAssets
  if($script:OldAssets -ieq $script:CandidateAssets -or $script:OldAssets.StartsWith($script:Work+'\',[StringComparison]::OrdinalIgnoreCase) -or $script:CandidateAssets.StartsWith($script:Work+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Input and newly owned work directories must be distinct.'}
  if(-not $IntegrityManifestPath){$IntegrityManifestPath=Join-Path $script:CandidateAssets 'package-integrity.json'}
  $script:ManifestPath=Assert-NativePathWithin $IntegrityManifestPath $script:CandidateAssets;Assert-NativeOrdinaryPath $script:ManifestPath -Leaf
  $script:SourceCommit=$ExpectedSourceCommit;$script:Version='3.8.0'
  $script:InstallRoot=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'EgoistShield';$script:DataRoot=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'EgoistShield'
  $script:InstallerDataRoot=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'EgoistShieldInstaller';$script:DeferredRoot=Join-Path $script:InstallerDataRoot 'DeferredRuns'
  $script:Core=Join-Path $script:InstallRoot 'resources\core-service\win-x64\EgoistShield.Service.exe'
  $script:NativePowerShell=Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $script:Node=(Get-Command node -CommandType Application -ErrorAction Stop).Source;$script:LegacyNodeHelper=Join-Path $PSScriptRoot 'windows-production-legacy-upgrade.mjs'
  Assert-NativeCleanStart
  foreach($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryHive]::CurrentUser)){
    foreach($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)){
      $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
      try{foreach($path in @('SOFTWARE\EgoistShield','SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\EgoistShield')){$key=$base.OpenSubKey($path);if($key){$key.Dispose();throw "Existing product registration refused in $hive/$view."}}}finally{$base.Dispose()}
    }
  }
  if(Test-Path -LiteralPath $script:Work){throw 'Owned legacy work already exists; inspect the prior attempt.'}
  if(-not $EvidenceDirectory){$EvidenceDirectory=Join-Path $script:Work 'evidence'}
  $script:Evidence=Assert-NativePathWithin $EvidenceDirectory $env:RUNNER_TEMP
  if(Test-Path -LiteralPath $script:Evidence){throw 'Legacy evidence destination must be fresh.'}
  $ancestor=[IO.Path]::GetDirectoryName($script:Evidence);while(-not (Test-Path -LiteralPath $ancestor)){$ancestor=[IO.Path]::GetDirectoryName($ancestor)};Assert-NativeOrdinaryPath $ancestor
  New-Item -ItemType Directory -Path $script:Work,$script:Evidence | Out-Null
  $script:ReceiptPath=Join-Path $script:Work 'windows-production-legacy-upgrade.json'
  $script:Receipt=[ordered]@{schemaVersion=1;kind=('actual-native-official-'+$ExpectedOldVersion+'-helper-upgrade');oldVersion=$ExpectedOldVersion;candidateVersion='3.8.0';candidateSourceCommit=$script:SourceCommit;harnessSourceCommit=$environment.GITHUB_SHA;startedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');host=[ordered]@{computerName=$env:COMPUTERNAME;administrator=$administrator;runnerEnvironment=$env:RUNNER_ENVIRONMENT;runId=$env:GITHUB_RUN_ID;runAttempt=$env:GITHUB_RUN_ATTEMPT};result='running';cleanStartVerified=$true;releaseReady=$false;mutations=@();checks=@();gui=@();privateStateReadbacks=@();networkReadbacks=@();beforeNetwork=(Get-NativeNetworkFingerprint);beforeForeignRegistrations=(Get-LegacyForeignRegistrationSnapshot);releaseGates=@('Public/latest feed discovery and old GUI auto-update initiation','Actual reboot/interrupted recovery','3.7.7 trust compatibility','System DNS/TUN/WinDivert endpoints','Actual standard-user GUI token','Long-duration 72-hour/7-day/month-scale pilot')}
  $script:Receipt.harnessFiles=@(foreach($file in @($PSCommandPath,$script:LegacyNodeHelper,(Join-Path $PSScriptRoot 'windows-production-acceptance.ps1'),(Join-Path $PSScriptRoot 'windows-production-acceptance.mjs'))){[ordered]@{path=$file;sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}});Save-NativeReceipt
  $primaryError=$null;$uninstalled=$false
  try{
    $script:AuthenticatedAssets=Invoke-LegacyArtifactVerification -Label 'authenticated-assets'
    $script:Receipt.authenticatedAssets=$script:AuthenticatedAssets;Save-NativeReceipt
    $script:Installer=Join-Path $script:CandidateAssets 'EgoistShield-Setup-3.8.0.exe';$script:InstallerHash=[string]$script:AuthenticatedAssets.candidate.sha256
    $oldInstaller=Join-Path $script:OldAssets ('EgoistShield-Setup-'+$ExpectedOldVersion+'.exe')
    Add-NativeMutation -Kind 'official-old-setup-clean-install' -Target $script:InstallRoot -Purpose "Actual original public $ExpectedOldVersion installer, authenticated before execution."
    [void](Invoke-NativeBounded -Executable $oldInstaller -Arguments @('/S') -Label 'official-old-clean-install' -TimeoutSeconds 600)
    [void](Assert-NativeService 'EgoistShieldCore' $script:Core -Running);$script:Receipt.oldCorePolicy=Get-NativeRecoveryPolicy 'EgoistShieldCore'
    Assert-NativeNoGui;Assert-NativeNetworkPreserved 'old-clean-install'
    $script:Receipt.oldInstalledTrust=Invoke-LegacyArtifactVerification -Label 'old-installed-authentication' -Installed
    $gui=Invoke-LegacyGui;$port=[int]$gui.port
    $script:Receipt.oldTelegramPolicy=Get-NativeRecoveryPolicy 'EgoistShieldTelegramProxy';$script:Receipt.oldTelegramWithoutGui=Assert-NativeTelegramEndpoint $port
    $configPath=Join-Path $script:DataRoot 'Runtime\TelegramProxy\config.json';$configHash=(Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
    Assert-NativeNoGui;Assert-NativeNetworkPreserved 'old-gui-close';Save-NativeReceipt
    Invoke-ActualLegacyBridge
    $options=[ordered]@{installedRoot=$script:InstallRoot;integrityPath=$script:ManifestPath;sourceCommit=$script:SourceCommit;integritySha256=$script:AuthenticatedAssets.integrityManifestSha256;installerSha256=$script:InstallerHash;output=(Join-Path $script:Work 'installed-payload.json')}
    $optionsPath=Join-Path $script:Work 'installed-payload.options.json';$options | ConvertTo-Json | Set-Content -LiteralPath $optionsPath -Encoding utf8
    [void](Invoke-NativeBounded -Executable $script:Node -Arguments @($script:LegacyNodeHelper,'verify-payload',$optionsPath) -Label 'candidate-actual-payload' -TimeoutSeconds 300)
    $script:Receipt.candidateElevation=Assert-NativeGuiElevation
    $script:Receipt.candidateAcls=@(foreach($relative in @('','EgoistShield.exe','EgoistShield.Worker.exe','resources','resources\app.asar','resources\component-worker.cjs','resources\worker-host-integrity.json','resources\core-service\win-x64\EgoistShield.Service.exe')){Assert-NativeAdministratorOwned (Join-Path $script:InstallRoot $relative)})
    if((Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash -cne $configHash){throw 'Actual Telegram private configuration changed across the genuine legacy upgrade.'}
    Assert-NativePrivateState 'actual-old-to-new-preserved-private-state'
    Assert-LegacyRunAfterSuppression
    $script:Receipt.newCore=Assert-NativeService 'EgoistShieldCore' $script:Core -Running;$script:Receipt.newCorePolicy=Get-NativeRecoveryPolicy 'EgoistShieldCore'
    $script:Receipt.newTelegramWithoutGui=Assert-NativeTelegramEndpoint $port;$script:Receipt.newTelegramPolicy=Get-NativeRecoveryPolicy 'EgoistShieldTelegramProxy'
    Assert-NativeNoGui;Assert-NativeNetworkPreserved 'old-helper-new-bridge-upgrade';Assert-LegacyForeignRegistrationsPreserved 'upgrade'
    [void](Invoke-NativeGui -Action 'check-telegram' -Label 'actual-new-gui-after-legacy-upgrade');Assert-NativeNoGui
    $script:Receipt.checks+=[ordered]@{name=('real-official-'+$ExpectedOldVersion+'-helper-to-signed-3.8.0-bridge');oldVersion=$ExpectedOldVersion;ok=$true;publicLatestFeedDiscovery=$false;actualBoot=$false};Save-NativeReceipt
    $uninstaller=Join-Path $script:InstallRoot 'Uninstall Egoist Shield.exe';[void](Assert-NativeAdministratorOwned $uninstaller)
    Add-NativeMutation -Kind 'actual-owned-candidate-uninstall' -Target $uninstaller -Purpose 'Remove the successfully upgraded product with its actual uninstaller; preserve unrelated services/tasks/network.'
    [void](Invoke-NativeBounded -Executable $uninstaller -Arguments @('/S') -Label 'actual-candidate-uninstall' -TimeoutSeconds 300)
    [void](Wait-NativeCondition -Condition {if(-not (Test-Path -LiteralPath $script:InstallRoot)){return $true}} -Label 'Actual upgraded candidate uninstall completion' -TimeoutSeconds 90)
    if(@(Get-NativeProductServices).Count -ne 0 -or @(Get-NativeProductTasks).Count -ne 0){throw 'Actual upgraded product retained SCM services/recovery Tasks after uninstall.'}
    foreach($relative in @('Runtime\TelegramProxy','Service\Vpn')){if(Test-Path -LiteralPath (Join-Path $script:DataRoot $relative)){throw 'Actual uninstall retained owned private component state.'}}
    Assert-NativeNoGui;Assert-NativeNetworkPreserved 'uninstall';Assert-LegacyForeignRegistrationsPreserved 'uninstall';$uninstalled=$true
    $script:Receipt.result='passed-bounded-genuine-legacy-helper-upgrade'
  }catch{$primaryError=$_;$script:Receipt.result='failed';$script:Receipt.error=$_.Exception.Message}
  finally{
    $script:Receipt.completedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');$script:Receipt.uninstalled=$uninstalled
    $script:Receipt.cleanupDisposition=if($uninstalled){'Actual product uninstaller completed.'}else{'Failure evidence retained. No force cleanup races active old/new workers or watchdogs; disposable runner is retired by Actions.'}
    Save-NativeReceipt
    # Only regular files directly in our fresh work are exported. Never copy
    # private Runtime backups, raw state snapshots or arbitrary stage trees.
    foreach($file in @(Get-ChildItem -LiteralPath $script:Work -File -Force)){Assert-NativeOrdinaryPath $file.FullName -Leaf;Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $script:Evidence $file.Name)}
  }
  if($primaryError){throw $primaryError}
  Write-Output ('Actual bounded old-helper upgrade passed. Receipt: '+$script:ReceiptPath+'; releaseReady=false.')
}
if($LibraryOnly){return}
Invoke-NativeLegacyUpgrade
