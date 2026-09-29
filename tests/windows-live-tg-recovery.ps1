param(
    [ValidateSet('Inspect','InjectAndObserve')][string]$Mode = 'Inspect',
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [int]$TargetProcessId = 37948,
    [string]$TargetCreatedUtc = '2026-09-29T12:56:24.828405Z',
    [ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedCoreHash = '27A13930AD2D5B6C29942C5B46E71A35FE2746ED0F33B282BEA781880A775D4C'
)
$ErrorActionPreference = 'Stop'
$outputFull = [IO.Path]::GetFullPath($OutputPath)
if (-not [IO.Path]::IsPathRooted($OutputPath) -or -not [IO.Directory]::Exists([IO.Path]::GetDirectoryName($outputFull))) { throw 'Choose an absolute evidence file in the executing task work directory.' }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Run this field-only inspection/injection through the root-owned elevated helper.' }
$serviceNames = @('EgoistShieldCore','EgoistShieldSystemDoH','EgoistShieldZapret','EgoistShieldTelegramProxy')
$wrapperPath = 'C:\ProgramData\EgoistShield\Runtime\TelegramProxy\service-wrapper\egoistshield-telegram-proxy-service.exe'
$telegramPath = 'C:\ProgramData\EgoistShield\Runtime\TelegramProxy\runtime\egoistshield-tg-ws-proxy.exe'
$relayPath = 'C:\Users\Egoist\AppData\Local\Egoist Relay\runtime\egoist-tg-proxy.exe'
$corePath = 'C:\Program Files\EgoistShield\resources\core-service\win-x64\EgoistShield.Service.exe'
function Test-Tcp([string]$Address,[int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try { $job=$client.ConnectAsync($Address,$Port); if (-not $job.Wait(1000)) { return $false }; return $client.Connected }
    catch { return $false }
    finally { $client.Dispose() }
}
function Measure-CoreSnapshot {
    $snapshotFile=Join-Path $PSScriptRoot 'windows-live-tg-snapshot.ps1'
    if(-not [IO.File]::Exists($snapshotFile)){throw 'The emitted production listener snapshot script is missing.'}
    $snapshotScript=[IO.File]::ReadAllText($snapshotFile)
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($snapshotScript))
    $measurements=@()
    for($trial=0;$trial -lt 3;$trial++){
        $start=[Diagnostics.Stopwatch]::StartNew()
        $startInfo=New-Object Diagnostics.ProcessStartInfo
        $startInfo.FileName=Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\powershell.exe'
        $startInfo.Arguments='-NoProfile -NonInteractive -EncodedCommand ' + $encoded
        $startInfo.UseShellExecute=$false
        $startInfo.CreateNoWindow=$true
        $startInfo.RedirectStandardOutput=$true
        $startInfo.RedirectStandardError=$true
        $child=New-Object Diagnostics.Process
        $child.StartInfo=$startInfo
        try{
            if(-not $child.Start()){throw 'Could not start the owned read-only snapshot helper.'}
            $stdout=$child.StandardOutput.ReadToEndAsync()
            $stderr=$child.StandardError.ReadToEndAsync()
            $finished=$child.WaitForExit(4000)
            if(-not $finished){$child.Kill();[void]$child.WaitForExit(1000)}
            $measurement=[ordered]@{trial=$trial+1;withinFourSecondDeadline=$finished;elapsedMs=[Math]::Round($start.Elapsed.TotalMilliseconds,2)}
            if($finished){$measurement.stderrCharacters=$stderr.GetAwaiter().GetResult().Length}
            if($finished -and $child.ExitCode -eq 0){
                $parsed=$stdout.GetAwaiter().GetResult() | ConvertFrom-Json
                $measurement.stable=$parsed.stable
                $measurement.serviceState=$parsed.serviceState
                $measurement.serviceProcessId=$parsed.serviceProcessId
                $measurement.rootExecutablePath=@($parsed.processes | Where-Object {$_.processId -eq $parsed.serviceProcessId})[0].executablePath
                $measurement.listenerOwnerIds=@($parsed.listeners | ForEach-Object {$_.owningProcess})
            }else{
                $measurement.result=if($finished){'metadata-query-failed'}else{'deadline-expired'}
                if($finished){$measurement.exitCode=$child.ExitCode}
            }
            $measurements+= [pscustomobject]$measurement
        }finally{$child.Dispose()}
    }
    return $measurements
}
function Test-Descendant($Snapshot,[int]$Leaf,[int]$Root) {
    $rootRow=$Snapshot.byId[$Root]
    if (-not $rootRow -or -not $rootRow.CreationDate) { return $false }
    $seen=New-Object 'System.Collections.Generic.HashSet[int]'
    for($depth=0;$depth -lt 32 -and $Leaf -gt 0;$depth++) {
        if(-not $seen.Add($Leaf)){ return $false }
        $row=$Snapshot.byId[$Leaf]
        if(-not $row -or -not $row.CreationDate -or $row.CreationDate -lt $rootRow.CreationDate){return $false}
        if($Leaf -eq $Root){return $true}
        $parent=$Snapshot.byId[[int]$row.ParentProcessId]
        if(-not $parent -or -not $parent.CreationDate -or $parent.CreationDate -gt $row.CreationDate){return $false}
        $Leaf=[int]$row.ParentProcessId
    }
    return $false
}
function Read-Snapshot {
    $started=[Diagnostics.Stopwatch]::StartNew()
    $services=@(Get-CimInstance Win32_Service -Filter "Name LIKE 'EgoistShield%'" -OperationTimeoutSec 3 | Where-Object {$_.Name -in $serviceNames})
    $all=@(Get-CimInstance Win32_Process -OperationTimeoutSec 3 | Select-Object ProcessId,ParentProcessId,Name,CreationDate,ExecutablePath)
    $byId=@{}
    foreach($row in $all){$byId[[int]$row.ProcessId]=$row}
    $listeners=@(Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -in 53,1443,1445} | Select-Object LocalAddress,LocalPort,OwningProcess)
    $udp=@(Get-NetUDPEndpoint | Where-Object {$_.LocalPort -eq 53} | Select-Object LocalAddress,LocalPort,OwningProcess)
    $core=@($services | Where-Object {$_.Name -eq 'EgoistShieldCore'})[0]
    $tg=@($services | Where-Object {$_.Name -eq 'EgoistShieldTelegramProxy'})[0]
    $snapshot=[pscustomobject]@{services=$services;all=$all;byId=$byId;listeners=$listeners;udp=$udp;core=$core;tg=$tg}
    $root=$byId[[int]$tg.ProcessId]
    $tgListeners=@($listeners | Where-Object {$_.LocalPort -eq 1445 -and $_.LocalAddress -in '127.0.0.1','0.0.0.0','::'})
    $owned=$tg.State -eq 'Running' -and $root -and $root.ExecutablePath -eq $wrapperPath -and $tgListeners.Count -gt 0
    foreach($listener in $tgListeners){
        $leaf=$byId[[int]$listener.OwningProcess]
        $owned=$owned -and $leaf -and $leaf.ExecutablePath -eq $telegramPath -and (Test-Descendant $snapshot ([int]$listener.OwningProcess) ([int]$tg.ProcessId))
    }
    $ui=@($all | Where-Object {$_.Name -eq 'EgoistShield.exe' -and -not (Test-Descendant $snapshot ([int]$_.ProcessId) ([int]$core.ProcessId))})
    $snapshot | Add-Member tgOwned ([bool]$owned)
    $snapshot | Add-Member uiProcesses $ui
    $snapshot | Add-Member elapsedMs $started.Elapsed.TotalMilliseconds
    return $snapshot
}
function Export-RelayState($Snapshot) {
    $rows=@($Snapshot.all | Where-Object {$_.ExecutablePath -eq $relayPath})
    $unknownRows=@($Snapshot.all | Where-Object {$_.Name -eq [IO.Path]::GetFileName($relayPath) -and -not $_.ExecutablePath})
    $endpoints=@($Snapshot.listeners | Where-Object {$_.LocalPort -eq 1443})
    [pscustomobject]@{
        exactRelayProcessAbsent=($rows.Count -eq 0 -and $unknownRows.Count -eq 0)
        port1443ListenerAbsent=($endpoints.Count -eq 0)
        unknownRelayExecutableCount=$unknownRows.Count
        processes=@($rows | Select-Object ProcessId,@{n='createdUtc';e={if($_.CreationDate){([DateTimeOffset]$_.CreationDate).ToUniversalTime().ToString('o')}else{$null}}},ExecutablePath)
        listeners=$endpoints
    }
}
function Get-RelayBaseline($Snapshot) {
    $state=Export-RelayState $Snapshot
    if($state.unknownRelayExecutableCount -ne 0){throw 'Relay executable metadata is unavailable; absence cannot be proved.'}
    if($state.exactRelayProcessAbsent -and $state.port1443ListenerAbsent){
        return [pscustomobject]@{present=$false;state=$state;ownerProcessId=$null;ownerCreatedUtc=$null}
    }
    if($state.listeners.Count -ne 1 -or $state.listeners[0].LocalAddress -ne '127.0.0.1'){throw 'Relay endpoint identity is foreign or ambiguous.'}
    $owner=$Snapshot.byId[[int]$state.listeners[0].OwningProcess]
    if(-not $owner -or $owner.ExecutablePath -ne $relayPath -or -not $owner.CreationDate){throw 'Port 1443 does not have a verified Relay owner.'}
    if(@($state.processes | Where-Object {-not $_.createdUtc}).Count -ne 0){throw 'Relay process birth metadata is unavailable.'}
    return [pscustomobject]@{
        present=$true;state=$state;ownerProcessId=[int]$owner.ProcessId
        ownerCreatedUtc=([DateTimeOffset]$owner.CreationDate).ToUniversalTime().ToString('o')
    }
}
function Test-RelayPreserved($Snapshot,$Baseline) {
    $state=Export-RelayState $Snapshot
    if($state.unknownRelayExecutableCount -ne 0){return $false}
    if(-not $Baseline.present){return $state.exactRelayProcessAbsent -and $state.port1443ListenerAbsent}
    if($state.listeners.Count -ne 1 -or $state.listeners[0].LocalAddress -ne '127.0.0.1' -or [int]$state.listeners[0].OwningProcess -ne $Baseline.ownerProcessId){return $false}
    $owner=$Snapshot.byId[[int]$Baseline.ownerProcessId]
    if(-not $owner -or $owner.ExecutablePath -ne $relayPath -or -not $owner.CreationDate -or ([DateTimeOffset]$owner.CreationDate).ToUniversalTime().ToString('o') -ne $Baseline.ownerCreatedUtc){return $false}
    if($state.processes.Count -ne $Baseline.state.processes.Count){return $false}
    foreach($old in $Baseline.state.processes){
        if(@($state.processes | Where-Object {$_.ProcessId -eq $old.ProcessId -and $_.createdUtc -eq $old.createdUtc -and $_.ExecutablePath -eq $old.ExecutablePath}).Count -ne 1){return $false}
    }
    return $true
}
function Export-Snapshot($Snapshot) {
    $needed=New-Object 'System.Collections.Generic.HashSet[int]'
    foreach($row in $Snapshot.services){[void]$needed.Add([int]$row.ProcessId)}
    foreach($listener in $Snapshot.listeners){
        $cursor=[int]$listener.OwningProcess
        for($depth=0;$depth -lt 32 -and $cursor -gt 0;$depth++){
            if(-not $needed.Add($cursor)){break}
            $row=$Snapshot.byId[$cursor];if(-not $row){break};$cursor=[int]$row.ParentProcessId
        }
    }
    [pscustomobject]@{
        atUtc=[DateTimeOffset]::UtcNow.ToString('o')
        snapshotMs=[Math]::Round($Snapshot.elapsedMs,2)
        services=@($Snapshot.services | Select-Object Name,State,StartMode,ProcessId)
        processes=@($needed | ForEach-Object {$Snapshot.byId[$_]} | Where-Object {$_} | Select-Object ProcessId,ParentProcessId,Name,@{n='createdUtc';e={([DateTimeOffset]$_.CreationDate).ToUniversalTime().ToString('o')}},ExecutablePath)
        tcpListeners=$Snapshot.listeners
        udpDnsListeners=$Snapshot.udp
        telegramOwned=$Snapshot.tgOwned
        telegramTcp=(Test-Tcp '127.0.0.1' 1445)
        uiProcessIds=@($Snapshot.uiProcesses | ForEach-Object {[int]$_.ProcessId})
        relay=Export-RelayState $Snapshot
    }
}
$before=Read-Snapshot
$relayBaseline=Get-RelayBaseline $before
$receipt=[ordered]@{
    schemaVersion=1;mode=$Mode;capturedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    coreHash=(Get-FileHash -LiteralPath $corePath -Algorithm SHA256).Hash
    before=Export-Snapshot $before
    actualRebootPerformed=$false
    productionSnapshotTiming=Measure-CoreSnapshot
    relayPresent=$relayBaseline.present
    relayBaseline=$relayBaseline
    mutationCount=0
    observations=@()
    result='inspection'
}
function Save-Receipt { $receipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outputFull -Encoding UTF8 }
Save-Receipt
if($Mode -eq 'Inspect'){
    $relayAfter=Read-Snapshot
    $receipt.relayAfter=Export-RelayState $relayAfter
    $receipt.relayPreserved=Test-RelayPreserved $relayAfter $relayBaseline
    Save-Receipt
    $receipt | ConvertTo-Json -Depth 12
    if(-not $receipt.relayPreserved){exit 2}
    exit 0
}
if($receipt.coreHash -ne $expectedCoreHash){throw 'Installed Core changed; obtain a fresh release identity before any injection.'}
if($before.uiProcesses.Count -ne 0){throw 'Installed application UI is still running; close it through the root agent first.'}
if($before.services.Count -ne 4 -or @($before.services | Where-Object {$_.State -ne 'Running' -or $_.StartMode -ne 'Auto'}).Count -ne 0){throw 'All four expected services must be running and automatic.'}
if(-not $before.tgOwned -or -not (Test-Tcp '127.0.0.1' 1445)){throw 'Telegram must have its own working listener before injection.'}
$intent=Get-Content -LiteralPath 'C:\ProgramData\EgoistShield\Service\service-supervision.json' -Raw | ConvertFrom-Json
if($intent.owner -ne 'EgoistShield' -or $intent.services.EgoistShieldTelegramProxy.running -ne $true){throw 'Telegram intended-running state is not enrolled.'}
$dnsBefore=@($before.listeners | Where-Object {$_.LocalPort -eq 53 -and $_.LocalAddress -in '127.0.0.1','::1'})
if($dnsBefore.Count -ne 2 -or @($dnsBefore | Select-Object -ExpandProperty OwningProcess -Unique).Count -ne 1){throw 'Both owned DNS loopback TCP listeners are required.'}
$target=$before.byId[$TargetProcessId]
if(-not $target -or $target.ExecutablePath -ne $telegramPath -or ([DateTimeOffset]$target.CreationDate).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.ffffffZ') -ne $TargetCreatedUtc -or -not (Test-Descendant $before $TargetProcessId ([int]$before.tg.ProcessId))){throw 'Target path, birth time or service ancestry changed.'}
if(@($before.listeners | Where-Object {$_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq 1445 -and $_.OwningProcess -eq $TargetProcessId}).Count -ne 1){throw 'Target no longer owns the selected Telegram endpoint.'}
$process=[Diagnostics.Process]::GetProcessById($TargetProcessId)
try {
    $heldHandle=$process.Handle
    if($heldHandle -eq [IntPtr]::Zero -or $process.MainModule.FileName -ne $telegramPath -or [Math]::Abs(($process.StartTime.ToUniversalTime()-[DateTime]::Parse($TargetCreatedUtc).ToUniversalTime()).TotalMilliseconds) -gt 1){throw 'Held process identity does not match the target.'}
    $fresh=Read-Snapshot
    if($fresh.uiProcesses.Count -ne 0 -or -not $fresh.tgOwned -or -not $fresh.byId[$TargetProcessId] -or $fresh.byId[$TargetProcessId].CreationDate -ne $target.CreationDate -or -not (Test-RelayPreserved $fresh $relayBaseline)){throw 'Fresh pre-injection readback failed.'}
    $receipt.injectedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    $receipt.target=[ordered]@{processId=$TargetProcessId;createdUtc=$TargetCreatedUtc;executable=$telegramPath;heldHandle=$true}
    $receipt.mutationAttemptCount=1
    Save-Receipt
    $process.Kill()
    $receipt.mutationCount=1
    Save-Receipt
} finally {$process.Dispose()}
$timer=[Diagnostics.Stopwatch]::StartNew()
$streak=0
try {
    while($timer.Elapsed.TotalSeconds -lt 300){
        Start-Sleep -Milliseconds 2000
        $current=Read-Snapshot
        $exported=Export-Snapshot $current
        $receipt.observations+= $exported
        $preserved=$current.uiProcesses.Count -eq 0
        foreach($name in @('EgoistShieldCore','EgoistShieldSystemDoH','EgoistShieldZapret')){
            $old=@($before.services | Where-Object {$_.Name -eq $name})[0]
            $now=@($current.services | Where-Object {$_.Name -eq $name})[0]
            $preserved=$preserved -and $now.State -eq 'Running' -and $now.StartMode -eq 'Auto' -and $now.ProcessId -eq $old.ProcessId
        }
        $preserved=$preserved -and (Test-RelayPreserved $current $relayBaseline)
        foreach($endpoint in $dnsBefore){
            $preserved=$preserved -and @($current.listeners | Where-Object {$_.LocalAddress -eq $endpoint.LocalAddress -and $_.LocalPort -eq 53 -and $_.OwningProcess -eq $endpoint.OwningProcess}).Count -eq 1
        }
        if(-not $preserved){$receipt.result='preservation-check-failed';break}
        $newOwner=@($current.listeners | Where-Object {$_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq 1445 -and $_.OwningProcess -ne $TargetProcessId}).Count -eq 1
        if($current.tgOwned -and $exported.telegramTcp -and $newOwner -and $current.tg.State -eq 'Running' -and $current.tg.StartMode -eq 'Auto'){$streak++}else{$streak=0}
        if($streak -ge 3){$receipt.result='recovered';$receipt.recoveryConfirmedAfterSeconds=[Math]::Round($timer.Elapsed.TotalSeconds,2);break}
        Save-Receipt
    }
    if($receipt.result -eq 'inspection'){$receipt.result='recovery-not-confirmed-within-five-minutes'}
    $receipt.elapsedSeconds=[Math]::Round($timer.Elapsed.TotalSeconds,2)
    $finalSnapshot=Read-Snapshot
    $receipt.final=Export-Snapshot $finalSnapshot
    $receipt.relayPreserved=Test-RelayPreserved $finalSnapshot $relayBaseline
    if(-not $receipt.relayPreserved){$receipt.result='preservation-check-failed'}
    $receipt.finalIntent=(Get-Content -LiteralPath 'C:\ProgramData\EgoistShield\Service\service-supervision.json' -Raw | ConvertFrom-Json).services
    Save-Receipt
    $receipt | ConvertTo-Json -Depth 12
    if($receipt.result -ne 'recovered'){exit 2}
} catch {
    $receipt.result='observation-failed'
    $receipt.errorType=$_.Exception.GetType().Name
    Save-Receipt
    throw
}

