param(
    [ValidateSet('Inspect','InjectAndObserve')][string]$Mode='Inspect',
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [int]$TargetProcessId=39664,
    [string]$TargetCreatedUtc='2026-09-29T12:56:22.369653Z',
    [string]$ExpectedCoreHash='27A13930AD2D5B6C29942C5B46E71A35FE2746ED0F33B282BEA781880A775D4C'
)
$ErrorActionPreference='Stop'
$outputFull=[IO.Path]::GetFullPath($OutputPath)
if(-not [IO.Path]::IsPathRooted($OutputPath) -or -not [IO.Directory]::Exists([IO.Path]::GetDirectoryName($outputFull))){throw 'Choose an absolute evidence file in the executing task work directory.'}
if(-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run through the root-owned elevated helper.'}
$names=@('EgoistShieldCore','EgoistShieldSystemDoH','EgoistShieldZapret','EgoistShieldTelegramProxy')
$dnsWrapper='C:\ProgramData\EgoistShield\Runtime\SystemDoH\service-wrapper\egoistshield-system-doh-service.exe'
$dnsExe='C:\ProgramData\EgoistShield\Runtime\SystemDoH\runtime\xray-system-doh.exe'
$tgWrapper='C:\ProgramData\EgoistShield\Runtime\TelegramProxy\service-wrapper\egoistshield-telegram-proxy-service.exe'
$tgExe='C:\ProgramData\EgoistShield\Runtime\TelegramProxy\runtime\egoistshield-tg-ws-proxy.exe'
$relayExe='C:\Users\Egoist\AppData\Local\Egoist Relay\runtime\egoist-tg-proxy.exe'
$coreExe='C:\Program Files\EgoistShield\resources\core-service\win-x64\EgoistShield.Service.exe'
function Test-Descendant($Snapshot,[int]$Leaf,[int]$Root){
    $rootRow=$Snapshot.byId[$Root];if(-not $rootRow -or -not $rootRow.CreationDate){return $false}
    $seen=New-Object 'System.Collections.Generic.HashSet[int]'
    for($depth=0;$depth -lt 32 -and $Leaf -gt 0;$depth++){
        if(-not $seen.Add($Leaf)){return $false}
        $row=$Snapshot.byId[$Leaf]
        if(-not $row -or -not $row.CreationDate -or $row.CreationDate -lt $rootRow.CreationDate){return $false}
        if($Leaf -eq $Root){return $true}
        $parent=$Snapshot.byId[[int]$row.ParentProcessId]
        if(-not $parent -or -not $parent.CreationDate -or $parent.CreationDate -gt $row.CreationDate){return $false}
        $Leaf=[int]$row.ParentProcessId
    }
    return $false
}
function Test-Tcp([string]$Address,[int]$Port){
    $client=New-Object Net.Sockets.TcpClient
    try{$job=$client.ConnectAsync($Address,$Port);return $job.Wait(750) -and $client.Connected}catch{return $false}finally{$client.Dispose()}
}
function Read-Snapshot{
    $services=@(Get-CimInstance Win32_Service -Filter "Name LIKE 'EgoistShield%'" -OperationTimeoutSec 3 |Where-Object {$_.Name -in $names})
    $all=@(Get-CimInstance Win32_Process -OperationTimeoutSec 3 |Select-Object ProcessId,ParentProcessId,Name,CreationDate,ExecutablePath)
    $byId=@{};foreach($row in $all){$byId[[int]$row.ProcessId]=$row}
    $tcp=@(Get-NetTCPConnection -State Listen |Where-Object {$_.LocalPort -in 53,1443,1445} |Select-Object LocalAddress,LocalPort,OwningProcess)
    $udp=@(Get-NetUDPEndpoint |Where-Object {$_.LocalPort -eq 53} |Select-Object LocalAddress,LocalPort,OwningProcess)
    $dns=@($services |Where-Object {$_.Name -eq 'EgoistShieldSystemDoH'})[0]
    $core=@($services |Where-Object {$_.Name -eq 'EgoistShieldCore'})[0]
    $tg=@($services |Where-Object {$_.Name -eq 'EgoistShieldTelegramProxy'})[0]
    $snapshot=[pscustomobject]@{services=$services;byId=$byId;tcp=$tcp;udp=$udp;dns=$dns;core=$core;tg=$tg}
    $rows=@($tcp+$udp |Where-Object {$_.LocalPort -eq 53 -and $_.LocalAddress -in '127.0.0.1','::1','0.0.0.0','::'})
    $root=$byId[[int]$dns.ProcessId]
    $owned=$dns.State -eq 'Running' -and $root -and $root.ExecutablePath -eq $dnsWrapper -and $rows.Count -eq 4
    foreach($transport in @($tcp,$udp)){
        foreach($address in @('127.0.0.1','::1')){
            $endpointMatches=@($transport |Where-Object {$_.LocalPort -eq 53 -and $_.LocalAddress -eq $address})
            $owned=$owned -and $endpointMatches.Count -eq 1
        }
    }
    foreach($endpoint in $rows){
        $leaf=$byId[[int]$endpoint.OwningProcess]
        $owned=$owned -and $leaf -and $leaf.ExecutablePath -eq $dnsExe -and (Test-Descendant $snapshot ([int]$leaf.ProcessId) ([int]$dns.ProcessId))
    }
    $ui=@($all |Where-Object {$_.Name -eq 'EgoistShield.exe' -and -not (Test-Descendant $snapshot ([int]$_.ProcessId) ([int]$core.ProcessId))})
    $snapshot |Add-Member dnsOwned ([bool]$owned)
    $snapshot |Add-Member uiProcessIds @($ui |ForEach-Object {[int]$_.ProcessId})
    return $snapshot
}
function Read-RelayBaseline($Snapshot){
    $processes=@($Snapshot.byId.Values |Where-Object {$_.ExecutablePath -eq $relayExe})
    $listeners=@($Snapshot.tcp |Where-Object {$_.LocalPort -eq 1443})
    if($processes.Count -eq 0 -and $listeners.Count -eq 0){
        return [pscustomobject]@{present=$false;processId=$null;createdUtc=$null;executable=$relayExe;listener=$null}
    }
    if($processes.Count -ne 1 -or $listeners.Count -ne 1){throw 'Relay process/listener baseline is foreign or ambiguous.'}
    $row=$processes[0];$listener=$listeners[0]
    if(-not $row.CreationDate -or $listener.LocalAddress -ne '127.0.0.1' -or [int]$listener.OwningProcess -ne [int]$row.ProcessId){throw 'Relay listener ownership does not match its exact executable.'}
    return [pscustomobject]@{present=$true;processId=[int]$row.ProcessId;createdUtc=([DateTimeOffset]$row.CreationDate).ToUniversalTime().ToString('o');executable=$row.ExecutablePath;listener=[pscustomobject]@{address=$listener.LocalAddress;port=[int]$listener.LocalPort;owningProcess=[int]$listener.OwningProcess}}
}
function Test-RelayPreserved($Snapshot,$Baseline){
    try{$current=Read-RelayBaseline $Snapshot}catch{return $false}
    if($current.present -ne $Baseline.present){return $false}
    if(-not $Baseline.present){return $true}
    return $current.processId -eq $Baseline.processId -and $current.createdUtc -eq $Baseline.createdUtc -and $current.executable -eq $Baseline.executable -and $current.listener.address -eq $Baseline.listener.address -and $current.listener.port -eq $Baseline.listener.port -and $current.listener.owningProcess -eq $Baseline.listener.owningProcess
}
function Read-NetworkFingerprint{
    $dns=@(Get-DnsClientServerAddress |Sort-Object InterfaceIndex,AddressFamily |ForEach-Object {[ordered]@{interfaceIndex=$_.InterfaceIndex;family=[int]$_.AddressFamily;servers=@($_.ServerAddresses)}})
    $binding=@(Get-NetAdapterBinding -ComponentID ms_tcpip6 |Sort-Object Name |Select-Object Name,Enabled)
    $guid=@(Get-NetAdapter |Sort-Object ifIndex |Select-Object ifIndex,InterfaceGuid,Status)
    $staticModes=@($guid |ForEach-Object {
        $guidText=[string]$_.InterfaceGuid
        $v4=Get-ItemProperty -LiteralPath ('Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\'+$guidText) -ErrorAction SilentlyContinue
        $v6=Get-ItemProperty -LiteralPath ('Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters\Interfaces\'+$guidText) -ErrorAction SilentlyContinue
        [pscustomobject]@{interfaceIndex=$_.ifIndex;interfaceGuid=$guidText;ipv4Static= -not [string]::IsNullOrWhiteSpace([string]$v4.NameServer);ipv6Static= -not [string]::IsNullOrWhiteSpace([string]$v6.NameServer)}
    })
    [pscustomobject]@{dns=$dns;ipv6Bindings=$binding;adapters=$guid;staticModes=$staticModes}
}
function Read-ConfigurationHash{
    $paths=@(
        'C:\ProgramData\EgoistShield\Runtime\SystemDoH\config.json',
        'C:\ProgramData\EgoistShield\Runtime\SystemDoH\state.json',
        'C:\ProgramData\EgoistShield\Service\dns-owned-state.json'
    )
    @($paths |ForEach-Object {[pscustomobject]@{path=$_;sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash}})
}
function Skip-DnsName([byte[]]$Data,[int]$Offset){
    for($step=0;$step -lt 128 -and $Offset -lt $Data.Length;$step++){
        $length=[int]$Data[$Offset];$Offset++
        if($length -eq 0){return $Offset}
        if(($length -band 192) -eq 192){
            if($Offset -ge $Data.Length){throw 'Invalid DNS name pointer.'}
            $pointer=(($length -band 63) -shl 8)+$Data[$Offset]
            if($pointer -ge $Data.Length){throw 'Invalid DNS name pointer.'}
            return $Offset+1
        }
        if($length -gt 63 -or $Offset+$length -gt $Data.Length){throw 'Invalid DNS name.'}
        $Offset+=$length
    }
    throw 'Unbounded DNS name.'
}
function Read-Exactly($Stream,[int]$Count,$Watch){
    $bytes=New-Object byte[] $Count;$position=0
    while($position -lt $Count){
        $remaining=3000-[int]$Watch.Elapsed.TotalMilliseconds
        if($remaining -le 0){throw 'DNS TCP shared deadline.'}
        $readTask=$Stream.ReadAsync($bytes,$position,$Count-$position)
        if(-not $readTask.Wait($remaining)){throw 'DNS TCP shared deadline.'}
        $read=$readTask.GetAwaiter().GetResult()
        if($read -le 0){throw 'DNS TCP stream closed.'}
        $position+=$read
    }
    return ,$bytes
}
function Invoke-DnsQuery([string]$Address,[string]$Name,[ValidateSet('UDP','TCP')][string]$Transport){
    $wireList=New-Object 'System.Collections.Generic.List[byte]'
    $header=New-Object byte[] 12
    $random=New-Object byte[] 2
    $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try{$rng.GetBytes($random)}finally{$rng.Dispose()}
    $header[0]=$random[0];$header[1]=$random[1];$header[2]=1;$header[5]=1;$wireList.AddRange($header)
    foreach($label in $Name.Split('.')){$wireList.Add([byte]$label.Length);$wireList.AddRange([Text.Encoding]::ASCII.GetBytes($label))}
    $wireList.AddRange([byte[]]@(0,0,1,0,1));$wire=$wireList.ToArray()
    $addressValue=[Net.IPAddress]::Parse($Address);$watch=[Diagnostics.Stopwatch]::StartNew()
    $result=[ordered]@{address=$Address;name=$Name;transport=$Transport;verified=$false;addresses=@()}
    try{
        if($Transport -eq 'UDP'){
            $udp=[Net.Sockets.UdpClient]::new($addressValue.AddressFamily);$udp.Client.ReceiveTimeout=1500
            try{
                $udp.Connect($addressValue,53);[void]$udp.Send($wire,$wire.Length)
                $endpoint=[Net.IPEndPoint]::new($(if($addressValue.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6){[Net.IPAddress]::IPv6Any}else{[Net.IPAddress]::Any}),0)
                $reply=$udp.Receive([ref]$endpoint)
                if(-not $endpoint.Address.Equals($addressValue) -or $endpoint.Port -ne 53){throw 'Unexpected DNS reply source.'}
            }finally{$udp.Dispose()}
        }else{
            $tcp=[Net.Sockets.TcpClient]::new($addressValue.AddressFamily)
            try{
                if(-not $tcp.ConnectAsync($addressValue,53).Wait(1000)){throw 'DNS TCP connect deadline.'}
                $stream=$tcp.GetStream();$stream.ReadTimeout=1500;$stream.WriteTimeout=1500
                $prefix=[byte[]]@(($wire.Length -shr 8),($wire.Length -band 255))
                $stream.Write($prefix,0,2);$stream.Write($wire,0,$wire.Length)
                $sizeBytes=Read-Exactly $stream 2 $watch;$size=([int]$sizeBytes[0] -shl 8)+$sizeBytes[1]
                if($size -lt 12 -or $size -gt 4096){throw 'Invalid bounded DNS TCP length.'}
                $reply=Read-Exactly $stream $size $watch
            }finally{$tcp.Dispose()}
        }
        if($reply.Length -lt $wire.Length -or $reply[0] -ne $wire[0] -or $reply[1] -ne $wire[1] -or ($reply[2] -band 248) -ne 128 -or $reply[4] -ne 0 -or $reply[5] -ne 1){throw 'DNS identity/header mismatch.'}
        for($index=12;$index -lt $wire.Length;$index++){if($wire[$index] -ne $reply[$index]){throw 'DNS question mismatch.'}}
        $result.rcode=[int]$reply[3] -band 15
        $answers=([int]$reply[6] -shl 8)+$reply[7]
        if($answers -gt 32){throw 'DNS answer bound exceeded.'}
        $offset=$wire.Length;$addresses=@()
        for($answer=0;$answer -lt $answers;$answer++){
            $offset=Skip-DnsName $reply $offset
            if($offset+10 -gt $reply.Length){throw 'Truncated DNS answer.'}
            $type=([int]$reply[$offset] -shl 8)+$reply[$offset+1]
            $class=([int]$reply[$offset+2] -shl 8)+$reply[$offset+3]
            $length=([int]$reply[$offset+8] -shl 8)+$reply[$offset+9];$offset+=10
            if($offset+$length -gt $reply.Length){throw 'Truncated DNS data.'}
            if($type -eq 1 -and $class -eq 1 -and $length -eq 4){$addresses+=([Net.IPAddress]::new([byte[]]$reply[$offset..($offset+3)])).ToString()}
            $offset+=$length
        }
        $result.addresses=@($addresses)
        $result.verified=$result.rcode -eq 0 -and $addresses.Count -gt 0
        if($Name -eq 'health.egoist.invalid'){$result.verified=$result.verified -and @($addresses |Where-Object {$_ -ne '127.0.0.1'}).Count -eq 0}
    }catch{$result.errorType=$_.Exception.GetType().Name}
    $result.elapsedMs=[Math]::Round($watch.Elapsed.TotalMilliseconds,2)
    return [pscustomobject]$result
}
function Read-Probe([bool]$IncludeExternal){
    $results=@()
    foreach($address in @('127.0.0.1','::1')){
        foreach($transport in @('UDP','TCP')){
            $results+=Invoke-DnsQuery $address 'health.egoist.invalid' $transport
            if($IncludeExternal){$results+=Invoke-DnsQuery $address 'example.com' $transport}
        }
    }
    return $results
}
function Export-Snapshot($Snapshot){
    $relayProcessIds=@($Snapshot.byId.Values |Where-Object {$_.ExecutablePath -eq $relayExe} |ForEach-Object {[int]$_.ProcessId})
    $ids=@($Snapshot.services |ForEach-Object {[int]$_.ProcessId})+@($Snapshot.tcp+$Snapshot.udp |ForEach-Object {[int]$_.OwningProcess})+$relayProcessIds
    [pscustomobject]@{atUtc=[DateTimeOffset]::UtcNow.ToString('o');services=@($Snapshot.services |Select-Object Name,State,StartMode,ProcessId);processes=@($ids |Select-Object -Unique |ForEach-Object {$Snapshot.byId[$_]} |Where-Object {$_} |Select-Object ProcessId,ParentProcessId,Name,@{n='createdUtc';e={([DateTimeOffset]$_.CreationDate).ToUniversalTime().ToString('o')}},ExecutablePath);tcp=$Snapshot.tcp;udp=$Snapshot.udp;dnsOwned=$Snapshot.dnsOwned;uiProcessIds=$Snapshot.uiProcessIds;relayPresent=($relayProcessIds.Count -gt 0);relayProcessIds=$relayProcessIds;relayListenerCount=@($Snapshot.tcp |Where-Object {$_.LocalPort -eq 1443}).Count}
}
$before=Read-Snapshot
$relayBaseline=Read-RelayBaseline $before
$network=Read-NetworkFingerprint
$hashes=Read-ConfigurationHash
$beforeQueries=Read-Probe $true
$receipt=[ordered]@{schemaVersion=1;mode=$Mode;mutationCount=0;capturedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');actualRebootPerformed=$false;observationWindowSeconds=270;totalFaultPhaseGuardSeconds=300;relayPresent=$relayBaseline.present;relayBaseline=$relayBaseline;before=Export-Snapshot $before;beforeNetwork=$network;beforeConfigurationHashes=$hashes;beforeQueries=$beforeQueries;coreHash=(Get-FileHash -LiteralPath $coreExe -Algorithm SHA256).Hash;observations=@();result='inspection'}
function Save-Receipt{$receipt |ConvertTo-Json -Depth 12 |Set-Content -LiteralPath $outputFull -Encoding UTF8}
Save-Receipt
if($Mode -eq 'Inspect'){$receipt |ConvertTo-Json -Depth 12;exit 0}
if($receipt.coreHash -ne $ExpectedCoreHash -or $before.uiProcessIds.Count -ne 0){throw 'Installed Core identity changed or application UI remains running.'}
if($before.services.Count -ne 4 -or @($before.services |Where-Object {$_.State -ne 'Running' -or $_.StartMode -ne 'Auto'}).Count -ne 0){throw 'All four expected automatic services must be running.'}
if(-not $before.dnsOwned -or @($beforeQueries |Where-Object {-not $_.verified}).Count -ne 0){throw 'Both DNS transports/families and external A must be verified before the fault.'}
$intent=Get-Content -LiteralPath 'C:\ProgramData\EgoistShield\Service\service-supervision.json' -Raw |ConvertFrom-Json
if($intent.owner -ne 'EgoistShield' -or $intent.services.EgoistShieldSystemDoH.running -ne $true){throw 'DNS is not enrolled with intended-running state.'}
$tgListener=@($before.tcp |Where-Object {$_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq 1445})
$tgRoot=$before.byId[[int]$before.tg.ProcessId]
if($tgListener.Count -ne 1 -or $tgRoot.ExecutablePath -ne $tgWrapper){throw 'Telegram baseline is ambiguous.'}
$tgRow=$before.byId[[int]$tgListener[0].OwningProcess]
if($tgRow.ExecutablePath -ne $tgExe -or -not (Test-Descendant $before ([int]$tgRow.ProcessId) ([int]$before.tg.ProcessId)) -or -not (Test-Tcp '127.0.0.1' 1445)){throw 'Telegram own listener baseline is not ready.'}
$target=$before.byId[$TargetProcessId]
if(-not $target -or $target.ExecutablePath -ne $dnsExe -or ([DateTimeOffset]$target.CreationDate).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.ffffffZ') -ne $TargetCreatedUtc -or -not (Test-Descendant $before $TargetProcessId ([int]$before.dns.ProcessId)) -or @($before.tcp+$before.udp |Where-Object {$_.LocalPort -eq 53 -and $_.LocalAddress -in '127.0.0.1','::1' -and $_.OwningProcess -ne $TargetProcessId}).Count -ne 0){throw 'Target DNS path, birth, ancestry or endpoint owner changed.'}
$process=[Diagnostics.Process]::GetProcessById($TargetProcessId)
$timer=[Diagnostics.Stopwatch]::StartNew()
try{
    $heldHandle=$process.Handle
    if($heldHandle -eq [IntPtr]::Zero -or $process.MainModule.FileName -ne $dnsExe -or [Math]::Abs(($process.StartTime.ToUniversalTime()-[DateTime]::Parse($TargetCreatedUtc).ToUniversalTime()).TotalMilliseconds) -gt 1){throw 'Held DNS process identity mismatch.'}
    $fresh=Read-Snapshot
    if(-not $fresh.dnsOwned -or $fresh.uiProcessIds.Count -ne 0 -or -not $fresh.byId[$TargetProcessId] -or $fresh.byId[$TargetProcessId].CreationDate -ne $target.CreationDate -or -not (Test-RelayPreserved $fresh $relayBaseline)){throw 'Fresh pre-fault readback failed.'}
    if((Read-NetworkFingerprint |ConvertTo-Json -Depth 6 -Compress) -ne ($network |ConvertTo-Json -Depth 6 -Compress) -or (Read-ConfigurationHash |ConvertTo-Json -Compress) -ne ($hashes |ConvertTo-Json -Compress)){throw 'DNS adapter/configuration baseline changed before the fault.'}
    $receipt.target=[ordered]@{processId=$TargetProcessId;createdUtc=$TargetCreatedUtc;executable=$dnsExe;heldHandle=$true}
    $receipt.mutationAttemptCount=1;$receipt.injectedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');Save-Receipt
    $timer.Restart()
    $process.Kill();$receipt.mutationCount=1;Save-Receipt
}finally{$process.Dispose()}
$streak=0
try{
    while($timer.Elapsed.TotalSeconds -lt 270){
        Start-Sleep -Milliseconds 2000
        $current=Read-Snapshot
        $localQueries=Read-Probe $false
        $observed=Export-Snapshot $current
        $relayPreserved=Test-RelayPreserved $current $relayBaseline
        $receipt.observations+= [pscustomobject]@{snapshot=$observed;healthQueries=$localQueries;relayPreserved=$relayPreserved;elapsedSeconds=[Math]::Round($timer.Elapsed.TotalSeconds,2)}
        $preserved=$current.uiProcessIds.Count -eq 0 -and $relayPreserved
        foreach($name in @('EgoistShieldCore','EgoistShieldZapret','EgoistShieldTelegramProxy')){
            $old=@($before.services |Where-Object {$_.Name -eq $name})[0];$now=@($current.services |Where-Object {$_.Name -eq $name})[0]
            $preserved=$preserved -and $now.State -eq 'Running' -and $now.StartMode -eq 'Auto' -and $now.ProcessId -eq $old.ProcessId
        }
        foreach($peer in @($tgRow)){
            $now=$current.byId[[int]$peer.ProcessId]
            $preserved=$preserved -and $now -and $now.CreationDate -eq $peer.CreationDate -and $now.ExecutablePath -eq $peer.ExecutablePath
        }
        $preserved=$preserved -and @($current.tcp |Where-Object {$_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq 1445 -and $_.OwningProcess -eq $tgRow.ProcessId}).Count -eq 1
        $preserved=$preserved -and (Read-NetworkFingerprint |ConvertTo-Json -Depth 6 -Compress) -eq ($network |ConvertTo-Json -Depth 6 -Compress) -and (Read-ConfigurationHash |ConvertTo-Json -Compress) -eq ($hashes |ConvertTo-Json -Compress)
        if(-not $preserved){$receipt.result='preservation-check-failed';break}
        $newLeaf=@($current.tcp |Where-Object {$_.LocalPort -eq 53 -and $_.LocalAddress -eq '127.0.0.1' -and $_.OwningProcess -ne $TargetProcessId}).Count -eq 1
        if($current.dnsOwned -and $newLeaf -and @($localQueries |Where-Object {-not $_.verified}).Count -eq 0){$streak++}else{$streak=0}
        if($streak -ge 3 -and $timer.Elapsed.TotalSeconds -lt 270){$receipt.localRecoveryConfirmedAfterSeconds=[Math]::Round($timer.Elapsed.TotalSeconds,2);$receipt.finalQueries=Read-Probe $true;$receipt.result=if(@($receipt.finalQueries |Where-Object {-not $_.verified}).Count -eq 0){'recovered'}else{'local-recovered-upstream-unverified'};break}
        Save-Receipt
    }
    if($receipt.result -eq 'inspection'){$receipt.result='recovery-not-confirmed-within-observation-window'}
    $finalSnapshot=Read-Snapshot
    $receipt.final=Export-Snapshot $finalSnapshot;$receipt.finalNetwork=Read-NetworkFingerprint
    $receipt.finalRelayPreserved=Test-RelayPreserved $finalSnapshot $relayBaseline
    if(-not $receipt.finalRelayPreserved){$receipt.result='preservation-check-failed'}
    $receipt.finalConfigurationHashes=Read-ConfigurationHash
    $receipt.finalIntent=(Get-Content -LiteralPath 'C:\ProgramData\EgoistShield\Service\service-supervision.json' -Raw |ConvertFrom-Json).services
    $receipt.elapsedSeconds=[Math]::Round($timer.Elapsed.TotalSeconds,2);Save-Receipt
    $receipt |ConvertTo-Json -Depth 12
    if($receipt.result -ne 'recovered'){exit 2}
}catch{$receipt.result='observation-failed';$receipt.errorType=$_.Exception.GetType().Name;Save-Receipt;throw}

