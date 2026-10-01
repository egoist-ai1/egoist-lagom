import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
const shell=process.env.LAGOM_TEST_POWERSHELL || path.join(process.env.SystemRoot||'','System32/WindowsPowerShell/v1.0/powershell.exe');
const quote=value=>value.replaceAll("'","''");
const library=quote(path.resolve('tests/windows-production-acceptance.ps1'));
const fixture=`
$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);. '${library}' -LibraryOnly;
$script:ActualTcp=(Get-Command Test-NativeTelegramTcp).ScriptBlock;
$script:ActualReadSnapshot=(Get-Command Read-NativeTelegramEndpointSnapshot).ScriptBlock;
$script:ActualGuiError=if(Get-Command Get-NativeTelegramGuiVisibleError -ErrorAction SilentlyContinue){(Get-Command Get-NativeTelegramGuiVisibleError).ScriptBlock}else{$null};
function Get-NativeTelegramGuiVisibleError {return $null};
$script:DataRoot='C:\\ProgramData\\EgoistShield';$script:Receipt=[ordered]@{};
$script:birth='2026-10-01T00:00:00.0000000Z';$script:ownerBirth='2026-10-01T00:00:01.0000000Z';
function Assert-NativeService {param($Name,$Executable,[switch]$Running)
 [ordered]@{scm=[pscustomobject]@{Name='EgoistShieldTelegramProxy';ProcessId=100;StartMode='Auto';StartName='LocalSystem'};process=[ordered]@{processId=100;createdUtc=$script:birth;executable=(Join-Path $script:DataRoot 'Runtime\\TelegramProxy\\service-wrapper\\egoistshield-telegram-proxy-service.exe')}};
}
function Get-NetTCPConnection {return @()};function Get-NativeCimSnapshot {throw 'Live CIM unexpectedly queried by inert readiness fixture'};
function Save-NativeReceipt {};
function New-ReadinessProof {param([int]$Port,[switch]$Missing)
 $root=(Join-Path $script:DataRoot 'Runtime\\TelegramProxy\\service-wrapper\\egoistshield-telegram-proxy-service.exe');
 $owned=[pscustomobject]@{state='owned';ownerPid=102;ownerName='proxy.exe';ownerCreatedAt=$script:ownerBirth;rootPid=100;rootCreatedAt=$script:birth};
 $missingFamily=[pscustomobject]@{state='missing';ownerPid=$null;ownerName=$null;ownerCreatedAt=$null;rootPid=$null;rootCreatedAt=$null};
 $listeners=@();if(-not $Missing){$listeners=@([pscustomobject]@{localAddress='127.0.0.1';localPort=$Port;owningProcess=102})};
 [pscustomobject]@{schemaVersion=2;operation='telegram-listener-snapshot';serviceName='EgoistShieldTelegramProxy';port=$Port;snapshotAvailable=$true;stable=$true;serviceState='Running';serviceProcessId=100;rootProcessPathVerified=$true;rootProcessCreatedAt=$script:birth;managedProcessId=$null;managedIdentityVerified=$false;managedRootCreatedAt=$null;ownership=$(if($Missing){'missing'}else{'owned'});ipv6Ownership='missing';ipv4=$(if($Missing){$missingFamily}else{$owned});ipv6=$missingFamily;snapshot=[pscustomobject]@{serviceProcessId=100;serviceState='Running';stable=$true;processes=@([pscustomobject]@{processId=100;parentProcessId=1;createdAt=$script:birth;executablePath=$root},[pscustomobject]@{processId=102;parentProcessId=100;createdAt=$script:ownerBirth;executablePath='C:\\ProgramData\\EgoistShield\\Runtime\\TelegramProxy\\runtime\\proxy.exe'});listeners=$listeners};remoteConnectivityVerified=$false};
}
$script:reads=0;$script:tcp=0;
function Read-NativeTelegramEndpointSnapshot {param([int]$Port,[int]$TimeoutMilliseconds)
 $script:reads++;New-ReadinessProof -Port $Port;
}
function Test-NativeTelegramTcp {param([int]$Port,[int]$TimeoutMilliseconds);$script:tcp++;return $true}
`;
function run(command){const r=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-Command',fixture+command],{encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return JSON.parse(r.stdout);}
test('SCM running with a proven missing listener waits for owned TCP readiness then fresh birth proof', {skip:process.platform!=='win32'},()=>{
 const r=run(`function Read-NativeTelegramEndpointSnapshot {param([int]$Port,[int]$TimeoutMilliseconds);$script:reads++;New-ReadinessProof -Port $Port -Missing:($script:reads -lt 3)};
 $value=Assert-NativeTelegramEndpoint -Port 1443 -TimeoutSeconds 2;
 if($script:reads -ne 4 -or $script:tcp -ne 1 -or -not $value.tcpConnected){throw 'Missing -> owned -> TCP -> fresh snapshot contract failed'};
 @{kind='inert-native-readiness-contract';reads=$script:reads;tcpCalls=$script:tcp;ready=$true}|ConvertTo-Json -Compress;`);
 assert.equal(r.reads,4);assert.equal(r.ready,true);
});
test('proven absence expires within a fixed readiness budget and preserves actual last addresses', {skip:process.platform!=='win32'},()=>{
 const r=run(`function Read-NativeTelegramEndpointSnapshot {param([int]$Port,[int]$TimeoutMilliseconds);$script:reads++;New-ReadinessProof -Port $Port -Missing};
 $watch=[Diagnostics.Stopwatch]::StartNew();$refused=$false;try{[void](Assert-NativeTelegramEndpoint -Port 1443 -TimeoutSeconds 1)}catch{if($_.Exception.Message -notmatch 'deadline|timed out'){throw};$refused=$true};
 if(-not $refused -or $script:tcp -ne 0 -or $watch.Elapsed.TotalMilliseconds -gt 1800){throw 'Absence was accepted or extended deadline'};
 $last=$script:Receipt.telegramEndpointObservations[-1];if($last.result -ne 'failed' -or $last.endpointBudgetSeconds -ne 1 -or $last.lastSnapshot.listeners.Count -ne 0){throw 'Actual absence diagnosis was lost'};
 @{kind='inert-native-readiness-contract';refused=$refused;elapsedMs=$watch.Elapsed.TotalMilliseconds;lastListeners=$last.lastSnapshot.listeners.Count}|ConvertTo-Json -Compress;`);
 assert.equal(r.refused,true);assert.equal(r.lastListeners,0);
});
for(const [name,change] of Object.entries({unknown:"$p.snapshotAvailable=$false;$p.snapshot=$null",unstable:"$p.stable=$false",foreign:"$p.ipv4.state='foreign';$p.ownership='foreign'",nonloopback:"$p.snapshot.listeners[0].localAddress='0.0.0.0'",wrongRoot:"$p.snapshot.processes[0].executablePath='C:\\foreign\\wrapper.exe'",missingBirth:"$p.snapshot.processes[1].createdAt=$null",reusedParent:"$p.snapshot.processes[0].createdAt='2026-10-01T00:00:02Z'",wrongSchema:"$p.schemaVersion=1"})){
 test(`terminal native endpoint ${name} is refused immediately rather than retried`, {skip:process.platform!=='win32'},()=>{
  const r=run(`function Read-NativeTelegramEndpointSnapshot {param([int]$Port,[int]$TimeoutMilliseconds);$script:reads++;$p=New-ReadinessProof -Port $Port;${change};return $p};
   $refused=$false;try{[void](Assert-NativeTelegramEndpoint -Port 1443 -TimeoutSeconds 2)}catch{$refused=$true};
   if(-not $refused -or $script:reads -ne 1 -or $script:tcp -ne 0){throw 'Terminal snapshot was retried or accepted'};
   $last=$script:Receipt.telegramEndpointObservations[-1];if($last.result -ne 'failed'){throw 'Failure evidence lost'};
   @{kind='inert-native-readiness-contract';refused=$refused;reads=$script:reads;tcpCalls=$script:tcp}|ConvertTo-Json -Compress;`);
  assert.equal(r.refused,true);assert.equal(r.reads,1);
 });
}
test('a successful TCP accept cannot hide a changed service birth in the second native snapshot', {skip:process.platform!=='win32'},()=>{
 const r=run(`function Read-NativeTelegramEndpointSnapshot {param([int]$Port,[int]$TimeoutMilliseconds);$script:reads++;$p=New-ReadinessProof -Port $Port;if($script:reads -gt 1){$p.rootProcessCreatedAt='2026-10-01T00:00:00.001Z';$p.snapshot.processes[0].createdAt=$p.rootProcessCreatedAt};return $p};
 $refused=$false;try{[void](Assert-NativeTelegramEndpoint -Port 1443 -TimeoutSeconds 2)}catch{$refused=$true};if(-not $refused -or $script:tcp -ne 1 -or $script:reads -ne 2){throw 'Birth replacement falsely passed'};
 @{kind='inert-native-readiness-contract';refused=$refused;reads=$script:reads}|ConvertTo-Json -Compress;`);assert.equal(r.refused,true);
});
test('genuine GUI completion requires the enabled visible actual running Stop control', {skip:process.platform!=='win32'},()=>{
 const r=run(`$own=Get-Process -Id $PID;$script:controls=0;$root=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=$PID}};
 $find={param($Name);$script:controls++;[pscustomobject]@{Current=[pscustomobject]@{Name=$(if($script:controls -eq 1){'Устанавливается…'}else{'Остановить'});IsEnabled=($script:controls -ne 2);IsOffscreen=$false}}};
 $result=Wait-NativeTelegramGuiCompletion -FindButton $find -Process $own -Root $root -Label 'inert-control-contract' -TimeoutSeconds 2;
 if($script:controls -ne 3 -or -not $result.enabled -or $result.name -cne 'Остановить'){throw 'GUI operation completion falsely inferred from SCM'};
 @{kind='inert-gui-control-contract';enabled=$result.enabled;name=$result.name}|ConvertTo-Json -Compress;`);assert.equal(r.enabled,true);
});
test('actual own loopback TCP is accepted between inert identity-contract snapshots', {skip:process.platform!=='win32'},async t=>{
 const sockets=new Set();const server=net.createServer(socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.resume();socket.once('end',()=>socket.end());});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
 const command=fixture+`Set-Item Function:Test-NativeTelegramTcp -Value $script:ActualTcp;
 $result=Assert-NativeTelegramEndpoint -Port ${server.address().port} -TimeoutSeconds 2;@{kind='actual-own-loopback-tcp-with-inert-scm-identity';tcpConnected=$result.tcpConnected;reads=$script:reads;scmVerified=$false}|ConvertTo-Json -Compress;`;
 const r=await new Promise((resolve,reject)=>{import('node:child_process').then(({execFile})=>execFile(shell,['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:20000},(error,stdout,stderr)=>error?reject(new Error(stdout+stderr)):resolve(JSON.parse(stdout))));});
 assert.equal(r.tcpConnected,true);assert.equal(r.scmVerified,false);assert.equal(r.reads,2);
});

// Accepted run36900894787 JSON bytes, replayed with inert SCM/transport; no product CLI is executed.
const recordedNativeJsonBase64='eyJzY2hlbWFWZXJzaW9uIjoyLCJvcGVyYXRpb24iOiJ0ZWxlZ3JhbS1saXN0ZW5lci1zbmFwc2hvdCIsInNlcnZpY2VOYW1lIjoiRWdvaXN0U2hpZWxkVGVsZWdyYW1Qcm94eSIsInBvcnQiOjE0NDMsInNuYXBzaG90QXZhaWxhYmxlIjp0cnVlLCJzdGFibGUiOnRydWUsInNlcnZpY2VTdGF0ZSI6IlJ1bm5pbmciLCJzZXJ2aWNlUHJvY2Vzc0lkIjo4NzgwLCJyb290UHJvY2Vzc1BhdGhWZXJpZmllZCI6dHJ1ZSwicm9vdFByb2Nlc3NDcmVhdGVkQXQiOiIyMDI2LTEwLTAxVDE3OjQ5OjQyLjQ3NDQ2KzAwOjAwIiwibWFuYWdlZFByb2Nlc3NJZCI6bnVsbCwibWFuYWdlZElkZW50aXR5VmVyaWZpZWQiOmZhbHNlLCJtYW5hZ2VkUm9vdENyZWF0ZWRBdCI6bnVsbCwib3duZXJzaGlwIjoib3duZWQiLCJpcHY2T3duZXJzaGlwIjoibWlzc2luZyIsImlwdjQiOnsic3RhdGUiOiJvd25lZCIsIm93bmVyUGlkIjoxMzg0LCJvd25lck5hbWUiOiJlZ29pc3RzaGllbGQtdGctd3MtcHJveHkuZXhlIiwib3duZXJDcmVhdGVkQXQiOiIyMDI2LTEwLTAxVDE3OjQ5OjQyLjc1NTIxNCswMDowMCIsInJvb3RQaWQiOjg3ODAsInJvb3RDcmVhdGVkQXQiOiIyMDI2LTEwLTAxVDE3OjQ5OjQyLjQ3NDQ2KzAwOjAwIn0sImlwdjYiOnsic3RhdGUiOiJtaXNzaW5nIiwib3duZXJQaWQiOm51bGwsIm93bmVyTmFtZSI6bnVsbCwib3duZXJDcmVhdGVkQXQiOm51bGwsInJvb3RQaWQiOm51bGwsInJvb3RDcmVhdGVkQXQiOm51bGx9LCJzbmFwc2hvdCI6eyJzZXJ2aWNlUHJvY2Vzc0lkIjo4NzgwLCJzZXJ2aWNlU3RhdGUiOiJSdW5uaW5nIiwicHJvY2Vzc2VzIjpbeyJwcm9jZXNzSWQiOjg3ODAsInBhcmVudFByb2Nlc3NJZCI6OTYwLCJjcmVhdGVkQXQiOiIyMDI2LTEwLTAxVDE3OjQ5OjQyLjQ3NDQ2KzAwOjAwIiwiZXhlY3V0YWJsZVBhdGgiOiJDOlxcUHJvZ3JhbURhdGFcXEVnb2lzdFNoaWVsZFxcUnVudGltZVxcVGVsZWdyYW1Qcm94eVxcc2VydmljZS13cmFwcGVyXFxlZ29pc3RzaGllbGQtdGVsZWdyYW0tcHJveHktc2VydmljZS5leGUifSx7InByb2Nlc3NJZCI6MTM4NCwicGFyZW50UHJvY2Vzc0lkIjo0MzI4LCJjcmVhdGVkQXQiOiIyMDI2LTEwLTAxVDE3OjQ5OjQyLjc1NTIxNCswMDowMCIsImV4ZWN1dGFibGVQYXRoIjoiQzpcXFByb2dyYW1EYXRhXFxFZ29pc3RTaGllbGRcXFJ1bnRpbWVcXFRlbGVncmFtUHJveHlcXHJ1bnRpbWVcXGVnb2lzdHNoaWVsZC10Zy13cy1wcm94eS5leGUifSx7InByb2Nlc3NJZCI6NDMyOCwicGFyZW50UHJvY2Vzc0lkIjo4NzgwLCJjcmVhdGVkQXQiOiIyMDI2LTEwLTAxVDE3OjQ5OjQyLjU3NjA5OTMrMDA6MDAiLCJleGVjdXRhYmxlUGF0aCI6IkM6XFxQcm9ncmFtRGF0YVxcRWdvaXN0U2hpZWxkXFxSdW50aW1lXFxUZWxlZ3JhbVByb3h5XFxydW50aW1lXFxlZ29pc3RzaGllbGQtdGctd3MtcHJveHkuZXhlIn1dLCJsaXN0ZW5lcnMiOlt7ImxvY2FsQWRkcmVzcyI6IjEyNy4wLjAuMSIsImxvY2FsUG9ydCI6MTQ0Mywib3duaW5nUHJvY2VzcyI6MTM4NH1dLCJzdGFibGUiOnRydWV9LCJyZW1vdGVDb25uZWN0aXZpdHlWZXJpZmllZCI6ZmFsc2V9';
const parsedSnapshotFixture=`
Set-Item Function:Read-NativeTelegramEndpointSnapshot -Value $script:ActualReadSnapshot;
$script:Core='C:\\inert-native-json-fixture\\EgoistShield.Service.exe';
$script:nativeJson=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${recordedNativeJsonBase64}'));
$script:birth='2026-10-01T17:49:42.4744600+00:00';
function Assert-NativeService {param($Name,$Executable,[switch]$Running)
 [ordered]@{scm=[pscustomobject]@{Name='EgoistShieldTelegramProxy';ProcessId=8780;StartMode='Auto';StartName='LocalSystem'};process=[ordered]@{processId=8780;createdUtc=$script:birth;executable=(Join-Path $script:DataRoot 'Runtime\\TelegramProxy\\service-wrapper\\egoistshield-telegram-proxy-service.exe')}};
}
function Invoke-NativeBounded {param($Executable,$Arguments,$Label,$TimeoutSeconds)
 $script:reads++;if($Executable -cne $script:Core -or ($Arguments -join '|') -cne '--telegram-listener-snapshot|--port|1443' -or $TimeoutSeconds -ne 4){throw 'Actual snapshot reader changed its fixed command/budget contract'};
 [pscustomobject]@{stdout=$script:nativeJson;stderr='';exitCode=0};
}
`;
test('recorded native JSON fractional birth survives the actual snapshot parser losslessly', {skip:process.platform!=='win32'},()=>{
 const r=run(parsedSnapshotFixture+`
 $result=Assert-NativeTelegramEndpoint -Port 1443;
 $expected=[DateTimeOffset]::Parse($script:birth,[Globalization.CultureInfo]::InvariantCulture);
 foreach($value in @($script:birth,$result.nativeSnapshot.rootProcessCreatedAt,$expected,$expected.UtcDateTime)){
  $instant=ConvertTo-NativeTelegramUtcInstant $value;if($instant -ne $expected){throw 'DateTime/DateTimeOffset/string birth normalization lost a tick'};
 }
 if($script:reads -ne 2 -or $script:tcp -ne 1){throw 'Recorded JSON bypassed TCP/fresh snapshot gates'};
 @{kind='accepted-json-replay-with-inert-scm-transport';rootType=$result.nativeSnapshot.rootProcessCreatedAt.GetType().Name;psMajor=$PSVersionTable.PSVersion.Major;reads=$script:reads;utcBirth=$expected.ToString('o')}|ConvertTo-Json -Compress;`);
 assert.equal(r.reads,2);assert.equal(r.utcBirth,'2026-10-01T17:49:42.4744600+00:00');
 assert.equal(r.rootType,r.psMajor>=7?'DateTime':'String');
});
for(const [name,change,error,reads,tcp] of [
 ['parent','$p.snapshot.processes[2].createdAt="2026-10-01T17:49:42.7552141+00:00"','SCM descendant',1,0],
 ['owner','$p.ipv4.ownerCreatedAt="2026-10-01T17:49:42.7552141+00:00"','family owner identity',1,0],
 ['fresh root','if($script:reads -eq 2){$p.rootProcessCreatedAt="2026-10-01T17:49:42.4744601+00:00";$p.snapshot.processes[0].createdAt=$p.rootProcessCreatedAt;$p.ipv4.rootCreatedAt=$p.rootProcessCreatedAt}','changed during TCP proof',2,1]
]){
 test(`100ns ${name} mismatch remains an exact native identity refusal after real JSON parsing`, {skip:process.platform!=='win32'},()=>{
  const r=run(parsedSnapshotFixture+`
   function Invoke-NativeBounded {param($Executable,$Arguments,$Label,$TimeoutSeconds);$script:reads++;$p=$script:nativeJson|ConvertFrom-Json;${change};[pscustomobject]@{stdout=($p|ConvertTo-Json -Depth 12 -Compress);stderr='';exitCode=0}};
   $refused=$false;try{[void](Assert-NativeTelegramEndpoint -Port 1443)}catch{if($_.Exception.Message -notmatch '${error}'){throw};$refused=$true};
   if(-not $refused -or $script:reads -ne ${reads} -or $script:tcp -ne ${tcp}){throw '100ns ${name} mismatch was accepted or used the wrong rejection gate'};
   @{kind='inert-native-identity-boundary';refused=$refused;reads=$script:reads;tcpCalls=$script:tcp}|ConvertTo-Json -Compress;`);
  assert.equal(r.refused,true);assert.equal(r.reads,reads);assert.equal(r.tcpCalls,tcp);
 });
}
test('an enabled Stop with a visible error toast refuses GUI completion while offscreen history does not', {skip:process.platform!=='win32'},()=>{
 const r=run(`
 Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes;
 $own=Get-Process -Id $PID;$root=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=$PID}};
 $script:toast=[pscustomobject]@{Current=[pscustomobject]@{Name='Действие не выполнено';ControlType=[Windows.Automation.ControlType]::Text;IsOffscreen=$true}};
 $root|Add-Member -MemberType ScriptMethod -Name FindAll -Value {param($Scope,$Condition);return @($script:toast)};
 if($script:ActualGuiError){Set-Item Function:Get-NativeTelegramGuiVisibleError -Value $script:ActualGuiError}else{function Get-NativeTelegramGuiVisibleError {param($Root);if(-not $script:toast.Current.IsOffscreen){return $script:toast}}};
 $find={param($Name);[pscustomobject]@{Current=[pscustomobject]@{Name='Остановить';IsEnabled=$true;IsOffscreen=$false}}};
 $past=Wait-NativeTelegramGuiCompletion -FindButton $find -Process $own -Root $root -Label 'inert-offscreen-toast' -TimeoutSeconds 1;
 if(-not $past.enabled){throw 'Offscreen historical text was treated as current failure'};
 $script:toast.Current.IsOffscreen=$false;$refused=$false;
 try{[void](Wait-NativeTelegramGuiCompletion -FindButton $find -Process $own -Root $root -Label 'inert-visible-toast' -TimeoutSeconds 1)}catch{if($_.Exception.Message -notmatch 'reports failed Telegram operation'){throw};$refused=$true};
 if(-not $refused){throw 'Visible actual error toast was hidden by enabled Stop control'};
 @{kind='inert-uia-error-title-contract';refused=$refused;offscreenAccepted=$past.enabled}|ConvertTo-Json -Compress;`);
 assert.equal(r.refused,true);assert.equal(r.offscreenAccepted,true);
});
