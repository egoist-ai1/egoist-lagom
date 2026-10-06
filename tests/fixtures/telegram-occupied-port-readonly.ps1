# Source-bound guard checks and own ephemeral loopback sockets only. The harness entrypoint is never invoked.
param([Parameter(Mandatory=$true)][string]$HarnessPath)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if(-not [IO.Path]::IsPathRooted($HarnessPath) -or -not [IO.File]::Exists($HarnessPath)){throw 'Explicit absolute public HarnessPath is required'}
$HarnessPath=[IO.Path]::GetFullPath($HarnessPath)
$harnessSha256=(Get-FileHash -LiteralPath $HarnessPath -Algorithm SHA256).Hash.ToLowerInvariant()
$script:Checks=[Collections.Generic.List[object]]::new()
function Assert-Probe([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Invoke-ProbeCase([string]$Name,[scriptblock]$Run){& $Run;$script:Checks.Add([ordered]@{name=$Name;passed=$true})}
function Assert-ProbeRefusal([scriptblock]$Run,[string]$Reason=''){
 $refused=$false
 try{& $Run | Out-Null}catch{if($Reason -and $_.Exception.Message -notmatch $Reason){throw};$refused=$true}
 Assert-Probe $refused 'Expected refusal did not occur'
}
function Copy-Probe($Value){return $Value | ConvertTo-Json -Depth 18 -Compress | ConvertFrom-Json}
$tokens=$null;$errors=$null;$harnessAst=[Management.Automation.Language.Parser]::ParseFile($HarnessPath,[ref]$tokens,[ref]$errors)
Assert-Probe (@($errors).Count -eq 0) 'Actual production harness parser failed'
$names=@('Get-NativeTelegramPortFixtureHash','ConvertTo-NativeTelegramPortFixtureState','New-NativeTelegramOccupiedPortActor','Get-NativeTelegramOccupiedPortActorIdentity','Stop-NativeTelegramOccupiedPortActor','Assert-NativeTelegramOccupiedPortSnapshot','ConvertTo-NativeTelegramConflictGuiObservation','ConvertTo-NativeTelegramUtcInstant','Get-NativeTelegramSnapshotState')
$functions=@($harnessAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$true))
$imported=@()
foreach($name in $names){
 $matches=@($functions | Where-Object {$_.Name -ceq $name});Assert-Probe ($matches.Count -eq 1) 'Whitelisted function missing/duplicated'
 $fn=$matches[0]
 $body=$fn.Body.Extent.Text.Substring(1,$fn.Body.Extent.Text.Length-2);$prefix=''
 if($null -ne $fn.Parameters -and $fn.Parameters.Count -gt 0){$prefix='param('+[string]::Join(',',@($fn.Parameters | ForEach-Object {$_.Extent.Text}))+')'+[Environment]::NewLine}
 Set-Item -Path ('Function:script:'+$name) -Value ([ScriptBlock]::Create($prefix+$body))
 $imported += [ordered]@{name=$name;sourceLine=$fn.Extent.StartLineNumber;sourceExtentSha256=(Get-NativeTelegramPortFixtureHash ([Text.Encoding]::UTF8.GetBytes($fn.Extent.Text)))}
}
$script:DataRoot='C:\FictionalNativeTGFixture\EgoistShield'
$actor=[pscustomobject]@{processId=731;createdUtc='2026-10-06T00:00:01.0000000Z';executable='C:\FictionalNativeTGFixture\own-powershell.exe';processHandleHeld=$true;port=49123;host='127.0.0.1';listenerHeld=$true}
function New-ProbeSnapshot([string]$HostAddress='127.0.0.1',[string]$State='foreign'){
 $missing=[ordered]@{state='missing';ownerPid=$null;ownerName=$null;ownerCreatedAt=$null;rootPid=$null;rootCreatedAt=$null}
 $foreign=[ordered]@{state='foreign';ownerPid=$actor.processId;ownerName=[IO.Path]::GetFileName($actor.executable);ownerCreatedAt=$actor.createdUtc;rootPid=$null;rootCreatedAt=$null}
 $v4=if($State -ceq 'foreign' -and $HostAddress -ceq '127.0.0.1'){$foreign}else{$missing}
 $v6=if($State -ceq 'foreign' -and $HostAddress -ceq '::1'){$foreign}else{$missing}
 return Copy-Probe ([ordered]@{schemaVersion=2;operation='telegram-listener-snapshot';serviceName='EgoistShieldTelegramProxy';port=49123;snapshotAvailable=$true;stable=$true;serviceState='Stopped';serviceProcessId=0;rootProcessPathVerified=$false;rootProcessCreatedAt=$null;managedProcessId=$null;managedIdentityVerified=$false;managedRootCreatedAt=$null;ownership=$v4.state;ipv6Ownership=$v6.state;ipv4=$v4;ipv6=$v6;remoteConnectivityVerified=$false;snapshot=[ordered]@{serviceProcessId=0;serviceState='Stopped';stable=$true;processes=@([ordered]@{processId=$actor.processId;parentProcessId=0;createdAt=$actor.createdUtc;executablePath=$actor.executable});listeners=@(if($State -ceq 'foreign'){[ordered]@{localAddress=$HostAddress;localPort=49123;owningProcess=$actor.processId}})}})
}
$valid=New-ProbeSnapshot
Invoke-ProbeCase 'OFF missing phase refuses a foreign listener before own actor bind' { Assert-ProbeRefusal {Assert-NativeTelegramOccupiedPortSnapshot -Value $valid -Port 49123 -HostAddress '127.0.0.1' -Expected missing} 'TG OFF did not release the actual port' }
Invoke-ProbeCase 'schema2 stopped foreign sole actor accepted as conflict, never ready' { $result=Assert-NativeTelegramOccupiedPortSnapshot -Value $valid -Port 49123 -HostAddress '127.0.0.1' -Expected foreign -ActorIdentity $actor;Assert-Probe ($result.state -ceq 'foreign' -and -not $result.ready) 'Conflict became ready' }
Invoke-ProbeCase 'schema2 stopped missing port accepted before own actor binds' { $result=Assert-NativeTelegramOccupiedPortSnapshot -Value (New-ProbeSnapshot -State missing) -Port 49123 -HostAddress '127.0.0.1' -Expected missing;Assert-Probe ($result.state -ceq 'missing' -and -not $result.ready) 'Missing became ready' }
Invoke-ProbeCase 'IPv6 configured loopback family is validated independently' { $a=Copy-Probe $actor;$a.host='::1';$result=Assert-NativeTelegramOccupiedPortSnapshot -Value (New-ProbeSnapshot -HostAddress '::1') -Port 49123 -HostAddress '::1' -Expected foreign -ActorIdentity $a;Assert-Probe ($result.host -ceq '::1' -and -not $result.ready) 'IPv6 conflict changed' }
Invoke-ProbeCase 'retained actor birth 9 ticks accepted at native precision boundary' { $a=Copy-Probe $actor;$a.createdUtc=([DateTimeOffset]::Parse($actor.createdUtc).AddTicks(9)).ToString('o');[void](Assert-NativeTelegramOccupiedPortSnapshot -Value $valid -Port 49123 -HostAddress '127.0.0.1' -Expected foreign -ActorIdentity $a) }
Invoke-ProbeCase 'retained actor birth 10 ticks refused' { $a=Copy-Probe $actor;$a.createdUtc=([DateTimeOffset]::Parse($actor.createdUtc).AddTicks(10)).ToString('o');Assert-ProbeRefusal {Assert-NativeTelegramOccupiedPortSnapshot -Value $valid -Port 49123 -HostAddress '127.0.0.1' -Expected foreign -ActorIdentity $a} 'birth changed' }
foreach($case in @(
 @{name='unavailable native snapshot';edit={param($v) $v.snapshotAvailable=$false}},
 @{name='unstable native snapshot';edit={param($v) $v.stable=$false}},
 @{name='SCM Running contradicts refused start';edit={param($v) $v.serviceState='Running';$v.serviceProcessId=100}},
 @{name='managed-pid alias bypass refused';edit={param($v) $v.managedProcessId=731}},
 @{name='remote connectivity promise refused';edit={param($v) $v.remoteConnectivityVerified=$true}},
 @{name='wrong endpoint owner PID';edit={param($v) $v.snapshot.listeners[0].owningProcess=732}},
 @{name='wrong endpoint port';edit={param($v) $v.snapshot.listeners[0].localPort=49124}},
 @{name='wildcard endpoint is outside exact loopback actor';edit={param($v) $v.snapshot.listeners[0].localAddress='0.0.0.0'}},
 @{name='owner executable path drift';edit={param($v) $v.snapshot.processes[0].executablePath='C:\FictionalNativeTGFixture\different.exe'}},
 @{name='missing owner birth';edit={param($v) $v.snapshot.processes[0].createdAt=$null}},
 @{name='family ownership contradiction';edit={param($v) $v.ownership='owned'}},
 @{name='duplicate process rows';edit={param($v) $v.snapshot.processes += (Copy-Probe $v.snapshot.processes[0])}},
 @{name='second listener is not captured as sole own actor';edit={param($v) $v.snapshot.listeners += (Copy-Probe $v.snapshot.listeners[0])}}
)){
 $currentCase=$case
 Invoke-ProbeCase ('refuse '+$currentCase.name) { $v=Copy-Probe $valid;& $currentCase.edit $v;Assert-ProbeRefusal {Assert-NativeTelegramOccupiedPortSnapshot -Value $v -Port 49123 -HostAddress '127.0.0.1' -Expected foreign -ActorIdentity $actor} }
}
Invoke-ProbeCase 'unheld own process cannot authorize conflict' { $a=Copy-Probe $actor;$a.processHandleHeld=$false;Assert-ProbeRefusal {Assert-NativeTelegramOccupiedPortSnapshot -Value $valid -Port 49123 -HostAddress '127.0.0.1' -Expected foreign -ActorIdentity $a} 'retained own actor' }
Invoke-ProbeCase 'actual production readiness guard rejects foreign ancestry' {
 $v=Copy-Probe $valid;$v.serviceState='Running';$v.serviceProcessId=100;$v.rootProcessPathVerified=$true;$v.rootProcessCreatedAt='2026-10-06T00:00:00.0000000Z';$v.snapshot.serviceState='Running';$v.snapshot.serviceProcessId=100
 $v.snapshot.processes += [pscustomobject]@{processId=100;parentProcessId=1;createdAt=$v.rootProcessCreatedAt;executablePath=(Join-Path $script:DataRoot 'Runtime\TelegramProxy\service-wrapper\egoistshield-telegram-proxy-service.exe')}
 $service=[pscustomobject]@{process=[pscustomobject]@{processId=100;createdUtc=$v.rootProcessCreatedAt}}
 Assert-ProbeRefusal {Get-NativeTelegramSnapshotState -Value $v -Port 49123 -Service $service} 'not a verified SCM descendant'
}
$uiRows=@([pscustomobject]@{name='Действие не выполнено';offscreen=$false},[pscustomobject]@{name='Порт Telegram Proxy 127.0.0.1:49123 занят pwsh.exe (PID 731). Выберите свободный порт в настройках и обновите подключение Telegram.';offscreen=$false},[pscustomobject]@{name='Прокси';offscreen=$false},[pscustomobject]@{name='не запущен';offscreen=$false})
Invoke-ProbeCase 'actual renderer text contract accepts visible configured port conflict plus unready label' { $result=ConvertTo-NativeTelegramConflictGuiObservation -TextRows $uiRows -Port 49123 -HostAddress '127.0.0.1' -GuiProcessId 942 -ExpectedOwnerProcessId 731;Assert-Probe ($null -ne $result -and -not $result.ready -and -not $result.privateTextIncluded) 'UI conflict evidence invalid' }
Invoke-ProbeCase 'GUI ready claim is rejected during actual occupied port phase' { $rows=@($uiRows)+@([pscustomobject]@{name='работает';offscreen=$false});Assert-ProbeRefusal {ConvertTo-NativeTelegramConflictGuiObservation -TextRows $rows -Port 49123 -HostAddress '127.0.0.1' -GuiProcessId 942 -ExpectedOwnerProcessId 731} 'claims ready' }
Invoke-ProbeCase 'hidden stale error is not confirmation' { $rows=Copy-Probe $uiRows;$rows[0].offscreen=$true;Assert-Probe ($null -eq (ConvertTo-NativeTelegramConflictGuiObservation -TextRows $rows -Port 49123 -HostAddress '127.0.0.1' -GuiProcessId 942 -ExpectedOwnerProcessId 731)) 'Hidden error admitted' }
Invoke-ProbeCase 'another port error is not confirmation' { Assert-Probe ($null -eq (ConvertTo-NativeTelegramConflictGuiObservation -TextRows $uiRows -Port 49124 -HostAddress '127.0.0.1' -GuiProcessId 942 -ExpectedOwnerProcessId 731)) 'Wrong port error admitted' }
$ipcPrefix="Error invoking remote method 'telegram-proxy:start': CoreServiceRequestError: "
Invoke-ProbeCase 'actual Electron start CoreServiceRequestError envelope is accepted with exact actor PID' {
 $rows=Copy-Probe $uiRows;$rows[1].name=$ipcPrefix+$rows[1].name
 $result=ConvertTo-NativeTelegramConflictGuiObservation -TextRows $rows -Port 49123 -HostAddress '127.0.0.1' -GuiProcessId 942 -ExpectedOwnerProcessId 731
 Assert-Probe ($null -ne $result -and -not $result.ready) 'Actual Electron envelope not observed'
}
Invoke-ProbeCase 'renderer-truncated Electron conflict advice keeps exact endpoint and PID' {
 $rows=Copy-Probe $uiRows;$rows[1].name=$ipcPrefix+$rows[1].name;$rows[1].name=$rows[1].name.Substring(0,177)+'...'
 Assert-Probe ($null -ne (ConvertTo-NativeTelegramConflictGuiObservation -TextRows $rows -Port 49123 -HostAddress '127.0.0.1' -GuiProcessId 942 -ExpectedOwnerProcessId 731)) 'Actual renderer truncation not observed'
}
foreach($case in @(
 @{name='another actor PID is not confirmation';edit={param($rows) $rows[1].name=$rows[1].name.Replace('(PID 731)','(PID 732)')}},
 @{name='actor PID prefix is not the exact actor';edit={param($rows) $rows[1].name=$rows[1].name.Replace('(PID 731)','(PID 7310)')}},
 @{name='another IPC operation is not confirmation';edit={param($rows) $rows[1].name=$ipcPrefix.Replace('telegram-proxy:start','telegram-proxy:stop')+$rows[1].name}},
 @{name='another IPC error class is not confirmation';edit={param($rows) $rows[1].name=$ipcPrefix.Replace('CoreServiceRequestError','TypeError')+$rows[1].name}},
 @{name='unrelated APP-ACTION prefix is not confirmation';edit={param($rows) $rows[1].name='[activity] APP-ACTION: '+$ipcPrefix+$rows[1].name}},
 @{name='embedded IPC envelope is not confirmation';edit={param($rows) $rows[1].name='Earlier error: '+$ipcPrefix+$rows[1].name}},
 @{name='multiline error is not confirmation';edit={param($rows) $rows[1].name=$ipcPrefix+$rows[1].name+[Environment]::NewLine+'APP-ACTION unrelated'}},
 @{name='another host conflict is not confirmation';edit={param($rows) $rows[1].name=$rows[1].name.Replace('127.0.0.1','127.0.0.2')}},
 @{name='conflict without actor PID is not confirmation';edit={param($rows) $rows[1].name=$rows[1].name.Replace(' (PID 731)','')}},
 @{name='unrelated suffix is not confirmation';edit={param($rows) $rows[1].name=$rows[1].name.Replace('Выберите свободный порт в настройках и обновите подключение Telegram.','APP-ACTION unrelated')}},
 @{name='hidden conflict reason is not confirmation';edit={param($rows) $rows[1].offscreen=$true}}
)){
 $currentCase=$case
 Invoke-ProbeCase $currentCase.name { $rows=Copy-Probe $uiRows;& $currentCase.edit $rows;Assert-Probe ($null -eq (ConvertTo-NativeTelegramConflictGuiObservation -TextRows $rows -Port 49123 -HostAddress '127.0.0.1' -GuiProcessId 942 -ExpectedOwnerProcessId 731)) 'Unrelated/stale conflict text admitted' }
}
$encoding=[Text.UTF8Encoding]::new($false)
$config=$encoding.GetBytes('{"host":"127.0.0.1","port":49123,"secret":"fictional-test-only"}')
$profile=$encoding.GetBytes('{"settings":{"autoConnect":false,"allowTelemetry":false,"theme":"mono"},"stateRevision":17}')
Invoke-ProbeCase 'retained state fingerprints include configuration bytes and semantic settings without plaintext' {
 $first=ConvertTo-NativeTelegramPortFixtureState -ConfigurationBytes $config -ProfileBytes $profile
 $revisionOnly=$encoding.GetBytes('{"stateRevision":18,"settings":{"theme":"mono","allowTelemetry":false,"autoConnect":false}}')
 $second=ConvertTo-NativeTelegramPortFixtureState -ConfigurationBytes $config -ProfileBytes $revisionOnly
 Assert-Probe ($first.settingsSha256 -ceq $second.settingsSha256 -and $first.configurationSha256 -ceq $second.configurationSha256 -and -not $first.privateContentIncluded) 'Harmless revision/property order changed intent fingerprint'
 Assert-Probe (($first | ConvertTo-Json -Compress) -notmatch 'fictional-test-only|autoConnect|mono') 'Private fixture fields emitted'
}
Invoke-ProbeCase 'changed settings intent changes retained fingerprint' { $a=ConvertTo-NativeTelegramPortFixtureState -ConfigurationBytes $config -ProfileBytes $profile;$changed=$encoding.GetBytes('{"settings":{"autoConnect":true,"allowTelemetry":false,"theme":"mono"}}');$b=ConvertTo-NativeTelegramPortFixtureState -ConfigurationBytes $config -ProfileBytes $changed;Assert-Probe ($a.settingsSha256 -cne $b.settingsSha256) 'Changed intent ignored' }
Invoke-ProbeCase 'string port rejects unconfirmed configuration' { $invalid=$encoding.GetBytes('{"host":"127.0.0.1","port":"49123"}');Assert-ProbeRefusal {ConvertTo-NativeTelegramPortFixtureState -ConfigurationBytes $invalid -ProfileBytes $profile} 'confirmed loopback' }
$script:OwnActorObservations=@()
foreach($hostAddress in @('127.0.0.1','::1')){
 $family=$hostAddress
 Invoke-ProbeCase ('actual own '+$family+' socket occupies port, rejects duplicate bind, exchanges own byte, releases and rebinds') {
  $reservation=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse($family),0);$reservation.ExclusiveAddressUse=$true;if($family -ceq '::1'){$reservation.Server.DualMode=$false}
  try{$reservation.Start(1);$ownPort=$reservation.LocalEndpoint.Port}finally{$reservation.Stop()}
  $realActor=$null;$client=$null;$accepted=$null;$rebind=$null
  try{
   $realActor=New-NativeTelegramOccupiedPortActor -Port $ownPort -HostAddress $family
   $identity=Get-NativeTelegramOccupiedPortActorIdentity -Actor $realActor
   $duplicateRejected=$false;$socketError=$null
   try{$duplicate=New-NativeTelegramOccupiedPortActor -Port $ownPort -HostAddress $family;Stop-NativeTelegramOccupiedPortActor -Actor $duplicate}catch{
    $cause=$_.Exception;while($cause.InnerException){$cause=$cause.InnerException}
    if($cause -isnot [Net.Sockets.SocketException]){throw}
    $socketError=$cause.SocketErrorCode.ToString();$duplicateRejected=$socketError -cin @('AddressAlreadyInUse','AccessDenied')
   }
   Assert-Probe $duplicateRejected 'Exclusive own socket did not reject duplicate bind'
   $client=[Net.Sockets.TcpClient]::new([Net.IPAddress]::Parse($family).AddressFamily)
   Assert-Probe ($client.ConnectAsync($family,$ownPort).Wait(3000) -and $client.Connected) 'Own loopback client failed'
   $watch=[Diagnostics.Stopwatch]::StartNew();while(-not $realActor.listener.Pending() -and $watch.ElapsedMilliseconds -lt 3000){Start-Sleep -Milliseconds 5}
   Assert-Probe $realActor.listener.Pending() 'Own listener did not accept its own client'
   $accepted=$realActor.listener.AcceptTcpClient();$accepted.GetStream().ReadTimeout=3000
   $client.GetStream().WriteByte(173)
   Assert-Probe ($accepted.GetStream().ReadByte() -eq 173) 'Retained own listener byte proof failed'
   [void](Get-NativeTelegramOccupiedPortActorIdentity -Actor $realActor)
   $accepted.Dispose();$accepted=$null;$client.Dispose();$client=$null
   Stop-NativeTelegramOccupiedPortActor -Actor $realActor
   Assert-Probe $realActor.released 'Own listener cleanup did not mark release'
   $rebind=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse($family),$ownPort);$rebind.ExclusiveAddressUse=$true;if($family -ceq '::1'){$rebind.Server.DualMode=$false};$rebind.Start(1)
   $script:OwnActorObservations += [ordered]@{host=$family;port=$ownPort;processId=$identity.processId;processHandleHeld=$identity.processHandleHeld;birthUtc=$identity.createdUtc;executable=$identity.executable;duplicateBindRejected=$true;duplicateBindSocketError=$socketError;ownByteExchanged=$true;released=$true;postReleaseRebind=$true;productionPortUsed=$false;productionCoreSnapshotExecuted=$false}
  }finally{if($accepted){$accepted.Dispose()};if($client){$client.Dispose()};if($rebind){$rebind.Stop()};if($realActor -and -not $realActor.released){Stop-NativeTelegramOccupiedPortActor -Actor $realActor}}
 }
}
Assert-Probe ($script:OwnActorObservations.Count -eq 2) 'Own socket observations were not retained'
Assert-Probe ($script:Checks.Count -eq 43 -and $imported.Count -eq 9) 'Expected 43 source-bound cases and 9 imported functions'
Assert-Probe ((Get-FileHash -LiteralPath $HarnessPath -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $harnessSha256) 'Production harness changed during local fixture checks'
[ordered]@{schemaVersion=1;powershellVersion=$PSVersionTable.PSVersion.ToString();edition=$PSVersionTable.PSEdition;harnessSha256=$harnessSha256;parserErrors=0;caseCount=43;passedAll=$true;passed=$script:Checks.Count;checks=$script:Checks;importedFunctions=$imported;ownActorObservations=$script:OwnActorObservations;harnessEntrypointExecuted=$false;nativeAcceptanceExecuted=$false;productionCoreSnapshotExecuted=$false;nativeServiceActions=0;privateDataRead=0;scm=0;registry=0;taskScheduler=0;uac=0;setup=0;gui=0;foreground=0;globalKeys=0;clipboard=0;sourceWrites=0;limitations=@('Snapshot and UI contract records are in-memory inert fixtures, not actual Core/UIA observations.','Actual socket probes use only fresh ephemeral loopback ports and the current retained test process; they do not inspect or control installed components.','Full production harness entrypoint and its Core/UIA/private-read functions were never invoked.')} | ConvertTo-Json -Depth 14
