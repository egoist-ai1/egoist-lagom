param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop';Set-StrictMode -Version 2.0
$root=[IO.Path]::GetFullPath($TestDirectory);$temp=[IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\'
if(-not $root.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase)){throw 'Use own task TEMP.'}
[void][IO.Directory]::CreateDirectory($root)
$module=Join-Path (Split-Path -Parent $PSScriptRoot) 'src\installer\installer-file-locks.ps1'
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($module,[ref]$tokens,[ref]$errors)
if($errors.Count -or @($ast.EndBlock.Statements|Where-Object {$_ -isnot [Management.Automation.Language.FunctionDefinitionAst]}).Count){throw 'Only valid function definitions may be imported.'}
. $module
Initialize-InstallerFileLockApi
$native=(Get-Command Invoke-InstallerFileLockNative).ScriptBlock
$actualPolicy=(Get-Command Get-InstallerFileLockProcessPolicy).ScriptBlock
$script:install=Join-Path $root 'install';$script:runtime=Join-Path $root 'runtime'
[void][IO.Directory]::CreateDirectory($script:install);[void][IO.Directory]::CreateDirectory($script:runtime)
$file=Join-Path $script:install 'payload [x].dll';[IO.File]::WriteAllText($file,'Harmless payload fixture.')
$script:groups=[Collections.Generic.List[string]]::new();$script:assertions=0;$script:nativeShutdowns=0
function Require([bool]$Value,[string]$Message){$script:assertions++;if(-not $Value){throw $Message}}
function Refused([scriptblock]$Action,[string]$Pattern){$reason='';try{&$Action}catch{$reason=$_.Exception.Message};Require ($reason -like $Pattern) ('Expected '+$Pattern+', received '+$reason)}
function Case([string]$Name,[scriptblock]$Body){&$Body;$script:groups.Add($Name)}
Case 'actual ABI and own child file discovery PID birth proof' {
 Require ([Runtime.InteropServices.Marshal]::SizeOf([type][LagomInstallerFileLocks.Info]) -eq 668) 'RM_PROCESS_INFO ABI mismatch.'
 Require ([Runtime.InteropServices.Marshal]::SizeOf([type][LagomInstallerFileLocks.Unique]) -eq 12) 'RM_UNIQUE_PROCESS ABI mismatch.'
 $childExe=Join-Path $root 'lock-child.exe';$ready=Join-Path $root 'ready.txt'
 $code=@"
using System;using System.IO;using System.Threading;
public static class OwnLockChild {public static int Main(string[] args){using(var file=File.Open(args[0],FileMode.Open,FileAccess.Read,FileShare.None)){File.WriteAllText(args[1],"ready");Thread.Sleep(15000);}return 0;}}
"@
 Add-Type -TypeDefinition $code -OutputAssembly $childExe -OutputType ConsoleApplication
 $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$childExe;$start.Arguments='"'+$file+'" "'+$ready+'"';$start.UseShellExecute=$false;$start.CreateNoWindow=$true
 $child=[Diagnostics.Process]::Start($start);$birth=$child.StartTime.ToFileTimeUtc()
 try{
  for($i=0;$i -lt 40 -and -not [IO.File]::Exists($ready);$i++){[Threading.Thread]::Sleep(50)}
  Require ([IO.File]::Exists($ready)) 'Own harmless child did not acquire its fixture file.'
  $report=&$native -Operation Query -Files @($file);$own=@($report.Processes|Where-Object {$_.Pid -eq $child.Id})
  Require ($own.Count -eq 1 -and $own[0].Birth -eq [uint64]$birth) 'Actual RM file discovery did not bind own child PID/birth.'
  $verified=&$native -Operation Verify -Process $own[0]
  Require ($verified.Executable -ieq $childExe -and $verified.Protection -eq [uint32]4294967294 -and -not $verified.Critical) 'Actual native process image/critical/PPL proof failed.'
  $reused=[LagomInstallerFileLocks.Locker]::new();$reused.Pid=$own[0].Pid;$reused.Birth=$own[0].Birth+1
  Refused {&$native -Operation Verify -Process $reused} '*FILE_LOCK_PID_REUSED*'
  $self=[LagomInstallerFileLocks.Locker]::new();$self.Pid=$PID;$self.Birth=1
  Refused {&$native -Operation Verify -Process $self} '*FILE_LOCK_SYSTEM_OR_SELF*'
 }finally{if(-not $child.HasExited){Require ($child.StartTime.ToFileTimeUtc() -eq $birth) 'Own child birth changed.';$child.Kill();[void]$child.WaitForExit(3000)};$child.Dispose()}
 Require (&$native -Operation SingleLink -Files @($file)) 'Actual single-link proof failed.'
}
function Get-InstallerFileLockRoots {return @($script:install,$script:runtime)}
function New-Locker([uint32]$Id=100,[string]$Image='C:\ThirdParty\app.exe') {
 return [pscustomobject]@{Pid=$Id;Birth=[uint64](1000+$Id);AppType=1;ServiceName='';Executable=$Image;Session=1;Restartable=$false;Protection=[uint32]4294967294;Critical=$false;Verification='pid-birth-critical-protection-image'}
}
function Reset-Fixture {$script:reports=[Collections.Generic.Queue[object]]::new();$script:shutdowns=[Collections.Generic.List[object]]::new();$script:queries=0;$script:singleLink=$true;$script:verifyFault='';$script:services=@();$script:signature=[pscustomobject]@{Status='NotSigned';SignerCertificate=$null};$script:serviceType=16;$script:registryCommand='';$script:probeReleased=$true;$script:shutdownCode=0}
function Queue-Report([object[]]$Processes=@(),[uint32]$Reboot=0){$script:reports.Enqueue([pscustomobject]@{Processes=$Processes;RebootReasons=$Reboot})}
function Invoke-InstallerFileLockNative {
 param($Operation,$Files,$Process,$Processes,$Force,$OwnGui)
 switch($Operation){
  'SingleLink'{return $script:singleLink}
  'Query'{$script:queries++;foreach($path in $Files){Require ($path -ceq $file) 'Discovery registered a nonvalidated payload.'};if($script:reports.Count){return $script:reports.Dequeue()};return [pscustomobject]@{Processes=@();RebootReasons=0}}
  'Verify'{if($script:verifyFault){throw $script:verifyFault};return $Process}
  'Shutdown'{Require ($OwnGui -ceq (Join-Path $script:install 'EgoistShield.exe')) 'Wrong GUI no-restart filter.';$script:shutdowns.Add([pscustomobject]@{force=[bool]$Force;processes=@($Processes)});return $script:shutdownCode}
 }
}
function Get-AuthenticodeSignature {param($LiteralPath,$ErrorAction) return $script:signature}
function Get-CimInstance {param($ClassName,$Filter,$ErrorAction,$OperationTimeoutSec)Require ($ClassName -ceq 'Win32_Service' -and $Filter -match '^ProcessId=\d+$') 'Unbounded service query.';return $script:services}
function Get-Item {
 param($LiteralPath,[switch]$Force,$ErrorAction)
 if($LiteralPath.StartsWith('Registry::')){$key=[pscustomobject]@{};$key|Add-Member ScriptMethod GetValue {param($Name,$Default,$Options)if($Name -eq 'Type'){return $script:serviceType};if($Name -eq 'ImagePath'){return $script:registryCommand};throw 'Unexpected registry field.'};return $key}
 return Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop
}
function Test-InstallerPayloadFilesReleased {param($Files)return $script:probeReleased}
Case 'literal bounded own file list dedupes' {Reset-Fixture;$paths=@(Get-ValidatedInstallerFileLockPaths @($file,$file));Require ($paths.Count -eq 1 -and $paths[0] -ceq $file) 'Literal own list changed.'}
Case 'foreign file directory ADS and file-count boundaries refuse before shutdown' {
 Reset-Fixture;Refused {Get-ValidatedInstallerFileLockPaths @('C:\Users\someone\document.docx')} '*FILE_LOCK_FOREIGN_PATH*';Refused {Get-ValidatedInstallerFileLockPaths @($script:install)} '*FILE_LOCK_FOREIGN_PATH*';Refused {Get-ValidatedInstallerFileLockPaths @($file+':stream')} '*FILE_LOCK_FOREIGN_PATH*';Refused {Get-ValidatedInstallerFileLockPaths @((1..2049)|ForEach-Object {$file})} '*FILE_LOCK_FILE_BOUND*';Require ($script:shutdowns.Count -eq 0) 'Rejected paths caused shutdown.'
}
Case 'hardlink alias refuses before discovery' {Reset-Fixture;$script:singleLink=$false;Refused {Resolve-InstallerPayloadFileLocks @($file) -Force} '*FILE_LOCK_HARDLINK_ALIAS*';Require ($script:queries -eq 0) 'Hardlink alias reached RM discovery.'}
Case 'empty discovery performs no process action' {Reset-Fixture;$result=Resolve-InstallerPayloadFileLocks @($file) -Force;Require ($result.resolved -and $script:shutdowns.Count -eq 0) 'No-lock session mutated processes.'}
Case 'actual foreign locker is selected by PID birth not executable ownership' {Reset-Fixture;$locker=New-Locker;Queue-Report @($locker);$result=Resolve-InstallerPayloadFileLocks @($file) -Force;Require ($result.resolved -and $script:shutdowns.Count -eq 1 -and -not $script:shutdowns[0].force -and $script:shutdowns[0].processes[0].Birth -eq $locker.Birth) 'Proven foreign locker did not use polite exact target.'}
Case 'polite then authorized force uses fresh locker proof' {Reset-Fixture;$old=New-Locker 101;$new=New-Locker 102;Queue-Report @($old);Queue-Report @($new);$result=Resolve-InstallerPayloadFileLocks @($file) -Force;Require ($result.resolved -and $script:shutdowns.Count -eq 2 -and $script:shutdowns[1].force -and $script:shutdowns[1].processes[0].Pid -eq 102) 'Force reused a stale target list.'}
Case 'force is never implied' {Reset-Fixture;$locker=New-Locker;Queue-Report @($locker);Queue-Report @($locker);Queue-Report @($locker);$result=Resolve-InstallerPayloadFileLocks @($file);Require (-not $result.resolved -and $script:shutdowns.Count -eq 1 -and -not $script:shutdowns[0].force) 'Non-force invocation forcibly stopped a process.'}
foreach($fault in @('FILE_LOCK_PID_REUSED','FILE_LOCK_PROTECTED_PROCESS','FILE_LOCK_PROCESS_UNVERIFIABLE')){
 Case ('native refusal '+$fault) {Reset-Fixture;$script:verifyFault=$fault;Queue-Report @((New-Locker));$result=Resolve-InstallerPayloadFileLocks @($file) -Force;Require (-not $result.resolved -and $result.blockers[0].reason -match $fault -and $script:shutdowns.Count -eq 0) 'Native refusal reached shutdown.'}
}
Case 'Windows process path is never closed' {Reset-Fixture;Queue-Report @((New-Locker 100 (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)) 'System32\explorer.exe')));$result=Resolve-InstallerPayloadFileLocks @($file) -Force;Require (-not $result.resolved -and $result.blockers[0].reason -match 'FILE_LOCK_WINDOWS_IMAGE' -and $script:shutdowns.Count -eq 0) 'Windows image was closed.'}
Case 'Microsoft-Windows signer protects copied OS executable outside Windows' {Reset-Fixture;$script:signature=[pscustomobject]@{Status='Valid';SignerCertificate=[pscustomobject]@{Subject='CN=Microsoft Windows, O=Microsoft Corporation'}};Queue-Report @((New-Locker));$result=Resolve-InstallerPayloadFileLocks @($file) -Force;Require (-not $result.resolved -and $result.blockers[0].reason -match 'WINDOWS_SIGNER' -and $script:shutdowns.Count -eq 0) 'Copied signed OS image was closed.'}
function Set-ServiceFixture([object]$Locker,[int]$Count=1){$Locker.AppType=3;$Locker.ServiceName='VendorService';$script:registryCommand='"'+$Locker.Executable+'"';$script:services=@([pscustomobject]@{Name='VendorService';ProcessId=$Locker.Pid;PathName=$script:registryCommand});if($Count -gt 1){$script:services+=[pscustomobject]@{Name='OtherService';ProcessId=$Locker.Pid;PathName=$script:registryCommand}}}
Case 'shared service-host PID is never closed' {Reset-Fixture;$locker=New-Locker;Set-ServiceFixture $locker 2;Queue-Report @($locker);$result=Resolve-InstallerPayloadFileLocks @($file) -Force;Require (-not $result.resolved -and $result.blockers[0].reason -match 'SHARED_SERVICE_HOST' -and $script:shutdowns.Count -eq 0) 'Shared service host was closed.'}
Case 'shared SCM Type32 is never closed' {Reset-Fixture;$locker=New-Locker;Set-ServiceFixture $locker;$script:serviceType=32;Queue-Report @($locker);$result=Resolve-InstallerPayloadFileLocks @($file) -Force;Require (-not $result.resolved -and $result.blockers[0].reason -match 'SHARED_SERVICE_TYPE' -and $script:shutdowns.Count -eq 0) 'Type32 service was closed.'}
Case 'exact dedicated third-party SCM PID image type permits shutdown' {Reset-Fixture;$locker=New-Locker;Set-ServiceFixture $locker;Queue-Report @($locker);$result=Resolve-InstallerPayloadFileLocks @($file) -Force;Require ($result.resolved -and $script:shutdowns.Count -eq 1) 'Dedicated foreign service proof was not accepted.'}
Case 'SCM image mismatch refuses shutdown' {Reset-Fixture;$locker=New-Locker;Set-ServiceFixture $locker;$script:services[0].PathName='"C:\Foreign\wrong.exe"';$script:registryCommand=$script:services[0].PathName;Queue-Report @($locker);$result=Resolve-InstallerPayloadFileLocks @($file) -Force;Require (-not $result.resolved -and $script:shutdowns.Count -eq 0) 'SCM mismatch was closed.'}
Case 'Windows-path vendor service needs exact SCM and valid non-Microsoft publisher' {Reset-Fixture;$locker=New-Locker 100 (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)) 'System32\vendor-wrapper.exe');Set-ServiceFixture $locker;$script:signature=[pscustomobject]@{Status='Valid';SignerCertificate=[pscustomobject]@{Subject='CN=Vendor Example, O=Vendor'}};Queue-Report @($locker);$result=Resolve-InstallerPayloadFileLocks @($file) -Force;Require ($result.resolved -and $script:shutdowns.Count -eq 1) 'Exact valid-vendor dedicated service was rejected.'}
Case 'RM reboot and force errors remain clear refusals' {Reset-Fixture;Queue-Report @((New-Locker)) 1;$result=Resolve-InstallerPayloadFileLocks @($file) -Force;Require (-not $result.resolved -and $script:shutdowns.Count -eq 0 -and $result.blockers[0].reason -match 'REBOOT_REQUIRED') 'Reboot reason was bypassed.';Reset-Fixture;$script:shutdownCode=350;Queue-Report @((New-Locker));Refused {Resolve-InstallerPayloadFileLocks @($file) -Force} '*FILE_LOCK_SHUTDOWN_FAILED: 350*'}
Case 'remaining unmanaged file sharing lock is not reported as released' {Reset-Fixture;$script:probeReleased=$false;$result=Resolve-InstallerPayloadFileLocks @($file) -Force;Require (-not $result.resolved) 'Unobserved file lock was reported released.'}
$receipt=[ordered]@{schemaVersion=1;passed=$true;groupCount=$script:groups.Count;assertionCount=$script:assertions;groups=$script:groups.ToArray();nativeRmQueries=1;nativeProcessBirthChecks=1;nativeRmShutdowns=0;nativeScmMutations=0;ownFixtureChildCount=1;ownFixtureChildStopped=$true;powerShellVersion=$PSVersionTable.PSVersion.ToString();sourceSha256=(Get-FileHash -LiteralPath $module -Algorithm SHA256).Hash.ToLowerInvariant();limitations=@('Polite/force behavior uses controlled RM boundaries; no foreign/native RM shutdown performed','Actual native RM discovers own harmless child lock and verifies PID/birth/image/critical/PPL','Windows-path/signature/SCM policy cases use controlled providers','No installer integration or real update executed by this fixture')}
[IO.File]::WriteAllText((Join-Path $root 'file-locks-receipt.json'),($receipt|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false));Write-Output ($receipt|ConvertTo-Json -Depth 6)
