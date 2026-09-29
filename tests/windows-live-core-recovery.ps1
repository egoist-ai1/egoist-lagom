param(
    [ValidateSet('Inspect','InjectAndObserve')][string]$Mode='Inspect',
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedCoreHash,
    [int]$TargetProcessId=0,
    [string]$TargetCreatedUtc=''
)
$ErrorActionPreference='Stop'
$outputFull=[IO.Path]::GetFullPath($OutputPath)
if(-not [IO.Path]::IsPathRooted($OutputPath) -or -not [IO.Directory]::Exists([IO.Path]::GetDirectoryName($outputFull))){throw 'Choose an absolute evidence file in the executing task work directory.'}
if(-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run through the root-owned elevated helper.'}
# The executing controller must also impose a hard 180-second post-fault deadline.
# Only the exact held Core handle below is used for the service fault.
$names=@('EgoistShieldCore','EgoistShieldSystemDoH','EgoistShieldZapret','EgoistShieldTelegramProxy')
$dnsWrapper='C:\ProgramData\EgoistShield\Runtime\SystemDoH\service-wrapper\egoistshield-system-doh-service.exe'
$dnsExe='C:\ProgramData\EgoistShield\Runtime\SystemDoH\runtime\xray-system-doh.exe'
$tgWrapper='C:\ProgramData\EgoistShield\Runtime\TelegramProxy\service-wrapper\egoistshield-telegram-proxy-service.exe'
$tgExe='C:\ProgramData\EgoistShield\Runtime\TelegramProxy\runtime\egoistshield-tg-ws-proxy.exe'
$relayExe='C:\Users\Egoist\AppData\Local\Egoist Relay\runtime\egoist-tg-proxy.exe'
$coreExe='C:\Program Files\EgoistShield\resources\core-service\win-x64\EgoistShield.Service.exe'
$zapretWrapper='C:\ProgramData\EgoistShield\Runtime\Zapret\service-wrapper\egoistshield-zapret-service.exe'
$oldWorkerRows=@{}
$coreFaultWatch=$null
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
function Export-Snapshot($Snapshot){
    $ids=@($Snapshot.services |ForEach-Object {[int]$_.ProcessId})+@($Snapshot.tcp+$Snapshot.udp |ForEach-Object {[int]$_.OwningProcess})
    [pscustomobject]@{atUtc=[DateTimeOffset]::UtcNow.ToString('o');services=@($Snapshot.services |Select-Object Name,State,StartMode,ProcessId);processes=@($ids |Select-Object -Unique |ForEach-Object {$Snapshot.byId[$_]} |Where-Object {$_} |Select-Object ProcessId,ParentProcessId,Name,@{n='createdUtc';e={([DateTimeOffset]$_.CreationDate).ToUniversalTime().ToString('o')}},ExecutablePath);tcp=$Snapshot.tcp;udp=$Snapshot.udp;dnsOwned=$Snapshot.dnsOwned;uiProcessIds=$Snapshot.uiProcessIds}
}

function Read-CoreSnapshot{
    $snapshot=Read-Snapshot
    $ui=@()
    foreach($processId in $snapshot.uiProcessIds){
        $row=$snapshot.byId[[int]$processId]
        $known=$oldWorkerRows[[int]$processId]
        if(-not $known -or -not $row -or $known.CreationDate -ne $row.CreationDate -or $known.ExecutablePath -ne $row.ExecutablePath){$ui+=[int]$processId}
    }
    $snapshot.uiProcessIds=$ui
    return $snapshot
}
function Read-CoreRecovery{
    $value=Get-ItemProperty -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\EgoistShieldCore'
    [byte[]]$bytes=$value.FailureActions
    if($bytes.Length -lt 44){throw 'Core recovery configuration is missing or truncated.'}
    $count=[BitConverter]::ToUInt32($bytes,12);$offset=[BitConverter]::ToUInt32($bytes,16)
    if($count -lt 3 -or $count -gt 8 -or $offset -lt 20 -or $offset+$count*8 -gt $bytes.Length){throw 'Core recovery action layout is invalid.'}
    $actions=@()
    for($i=0;$i -lt $count;$i++){
        $actions+=[pscustomobject]@{type=[BitConverter]::ToUInt32($bytes,[int]($offset+$i*8));delayMs=[BitConverter]::ToUInt32($bytes,[int]($offset+$i*8+4))}
    }
    $restartOnly=@($actions |Where-Object {$_.type -ne 1 -or $_.delayMs -le 0 -or $_.delayMs -gt 60000}).Count -eq 0
    [pscustomobject]@{automatic=$value.Start -eq 2;resetSeconds=[BitConverter]::ToUInt32($bytes,0);nonCrashFlag=$value.FailureActionsOnNonCrashFailures -eq 1;actions=$actions;restartOnly=$restartOnly}
}
function Read-CoreIntent{
    $value=Get-Content -LiteralPath 'C:\ProgramData\EgoistShield\Service\service-supervision.json' -Raw |ConvertFrom-Json
    if($value.schemaVersion -ne 1 -or $value.owner -ne 'EgoistShield'){throw 'Core supervision ownership is not proven.'}
    $result=[ordered]@{}
    foreach($name in @('EgoistShieldSystemDoH','EgoistShieldZapret','EgoistShieldTelegramProxy')){
        $entry=$value.services.PSObject.Properties[$name]
        if(-not $entry -or $entry.Value.running -ne $true){throw 'A peer service is intentionally disabled or not enrolled.'}
        $result[$name]=[bool]$entry.Value.running
    }
    return [pscustomobject]$result
}
function Read-CoreHello([int]$ExpectedProcessId,[int]$BudgetMs=5000){
    if($BudgetMs -le 0){return [pscustomobject]@{verified=$false;code='TEST_BUDGET_EXPIRED'}}
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=$coreExe;$info.Arguments='--verify-pipe-server'
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $client=New-Object Diagnostics.Process
    $client.StartInfo=$info
    try{
        if(-not $client.Start()){throw 'Could not start the installed read-only Core verifier.'}
        $stdout=$client.StandardOutput.ReadToEndAsync();$stderr=$client.StandardError.ReadToEndAsync()
        $finished=$client.WaitForExit([Math]::Min(5000,$BudgetMs))
        if(-not $finished){
            # This cancels only this helper's read-only verifier, never an SCM process.
            $client.Kill();[void]$client.WaitForExit(500)
            return [pscustomobject]@{verified=$false;code='TEST_VERIFIER_TIMEOUT'}
        }
        $text=$stdout.GetAwaiter().GetResult();$errorText=$stderr.GetAwaiter().GetResult()
        if([Text.Encoding]::UTF8.GetByteCount($text) -gt 65536 -or $errorText.Length -gt 65536){return [pscustomobject]@{verified=$false;code='TEST_VERIFIER_OUTPUT_LIMIT'}}
        try{$reply=$text |ConvertFrom-Json}catch{return [pscustomobject]@{verified=$false;code='TEST_VERIFIER_INVALID_JSON'}}
        $verified=$client.ExitCode -eq 0 -and $reply.ok -eq $true -and $reply.code -eq 'VERIFIED' -and $reply.serverProcessId -eq $ExpectedProcessId -and $reply.serviceProcessId -eq $ExpectedProcessId
        [pscustomobject]@{verified=[bool]$verified;code=[string]$reply.code;serverProcessId=$reply.serverProcessId;serviceProcessId=$reply.serviceProcessId}
    }finally{$client.Dispose()}
}
function Read-CoreProbe([bool]$IncludeExternal){
    $results=@()
    foreach($address in @('127.0.0.1','::1')){
        foreach($transport in @('UDP','TCP')){
            if($coreFaultWatch -and $coreFaultWatch.Elapsed.TotalSeconds -gt 176){throw 'The 180-second fault budget is exhausted.'}
            $results+=Invoke-DnsQuery $address 'health.egoist.invalid' $transport
            if($IncludeExternal){
                if($coreFaultWatch -and $coreFaultWatch.Elapsed.TotalSeconds -gt 176){throw 'The 180-second fault budget is exhausted.'}
                $results+=Invoke-DnsQuery $address 'example.com' $transport
            }
        }
    }
    return $results
}
function Read-ThirdPartyRelay($Snapshot){
    $listeners=@($Snapshot.tcp |Where-Object {$_.LocalPort -eq 1443})
    $processes=@($Snapshot.byId.Values |Where-Object {$_.ExecutablePath -eq $relayExe} |Sort-Object ProcessId)
    $unreadable=@($Snapshot.byId.Values |Where-Object {$_.Name -eq [IO.Path]::GetFileName($relayExe) -and [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath)})
    if($unreadable.Count -ne 0){throw 'Relay process metadata is unreadable; absence is not proven.'}
    if($listeners.Count -eq 0 -and $processes.Count -eq 0){
        return [pscustomobject]@{state='absent';present=$false;executablePath=$relayExe;processes=@();listeners=@();ownerProcessId=$null;ownerCreatedUtc=$null}
    }
    if($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1'){throw 'Relay1443 listener is missing, foreign or ambiguous.'}
    $owner=$Snapshot.byId[[int]$listeners[0].OwningProcess]
    if(-not $owner -or $owner.ExecutablePath -ne $relayExe -or -not $owner.CreationDate -or $processes.Count -eq 0){throw 'Relay1443 owner path or birth is not proven.'}
    $identities=@()
    foreach($row in $processes){
        if([int]$row.ProcessId -le 0 -or -not $row.CreationDate){throw 'Relay process identity is incomplete.'}
        $identities+=[pscustomobject]@{processId=[int]$row.ProcessId;createdUtc=([DateTimeOffset]$row.CreationDate).ToUniversalTime().ToString('o');executablePath=[string]$row.ExecutablePath}
    }
    [pscustomobject]@{state='present';present=$true;executablePath=$relayExe;processes=$identities;listeners=$listeners;ownerProcessId=[int]$owner.ProcessId;ownerCreatedUtc=([DateTimeOffset]$owner.CreationDate).ToUniversalTime().ToString('o')}
}
function Test-ThirdPartyRelayPreservation($Snapshot,$Baseline){
    try{
        $current=Read-ThirdPartyRelay $Snapshot
        if(($current |ConvertTo-Json -Depth 5 -Compress) -ne ($Baseline |ConvertTo-Json -Depth 5 -Compress)){return $false}
        return -not $current.present -or (Test-Tcp '127.0.0.1' 1443)
    }catch{return $false}
}
function Test-CorePeerPreservation($Current,$Baseline){
    $preserved=$Current.uiProcessIds.Count -eq 0 -and $Current.dnsOwned
    foreach($name in @('EgoistShieldSystemDoH','EgoistShieldZapret','EgoistShieldTelegramProxy')){
        $old=@($Baseline.services |Where-Object {$_.Name -eq $name})[0];$now=@($Current.services |Where-Object {$_.Name -eq $name})[0]
        $oldRoot=$Baseline.byId[[int]$old.ProcessId];$nowRoot=$Current.byId[[int]$old.ProcessId]
        $preserved=$preserved -and $now -and $now.State -eq 'Running' -and $now.StartMode -eq 'Auto' -and $now.ProcessId -eq $old.ProcessId -and $nowRoot -and $nowRoot.CreationDate -eq $oldRoot.CreationDate -and $nowRoot.ExecutablePath -eq $oldRoot.ExecutablePath
    }
    foreach($endpoint in @($Baseline.tcp+$Baseline.udp |Where-Object {$_.LocalPort -in 53,1443,1445})){
        $old=$Baseline.byId[[int]$endpoint.OwningProcess];$now=$Current.byId[[int]$endpoint.OwningProcess]
        $preserved=$preserved -and $now -and $now.CreationDate -eq $old.CreationDate -and $now.ExecutablePath -eq $old.ExecutablePath
    }
    $beforeTcp=$Baseline.tcp |Sort-Object LocalAddress,LocalPort,OwningProcess |ConvertTo-Json -Compress
    $nowTcp=$Current.tcp |Sort-Object LocalAddress,LocalPort,OwningProcess |ConvertTo-Json -Compress
    $beforeUdp=$Baseline.udp |Sort-Object LocalAddress,LocalPort,OwningProcess |ConvertTo-Json -Compress
    $nowUdp=$Current.udp |Sort-Object LocalAddress,LocalPort,OwningProcess |ConvertTo-Json -Compress
    return $preserved -and $beforeTcp -eq $nowTcp -and $beforeUdp -eq $nowUdp -and (Test-Tcp '127.0.0.1' 1445) -and (Test-ThirdPartyRelayPreservation $Current $relayBaseline)
}
function Test-CoreSettingPreservation{
    return (Read-NetworkFingerprint |ConvertTo-Json -Depth 6 -Compress) -eq ($network |ConvertTo-Json -Depth 6 -Compress) -and (Read-ConfigurationHash |ConvertTo-Json -Compress) -eq ($hashes |ConvertTo-Json -Compress) -and (Read-CoreIntent |ConvertTo-Json -Compress) -eq ($intent |ConvertTo-Json -Compress) -and (Read-CoreRecovery |ConvertTo-Json -Depth 4 -Compress) -eq ($recovery |ConvertTo-Json -Depth 4 -Compress) -and (Get-FileHash -LiteralPath $coreExe -Algorithm SHA256).Hash -eq $ExpectedCoreHash
}
$before=Read-CoreSnapshot
$relayBaseline=Read-ThirdPartyRelay $before
$network=Read-NetworkFingerprint;$hashes=Read-ConfigurationHash;$intent=Read-CoreIntent;$recovery=Read-CoreRecovery
$beforeQueries=Read-CoreProbe $true
$coreVersion=[Diagnostics.FileVersionInfo]::GetVersionInfo($coreExe).FileVersion
$receipt=[ordered]@{schemaVersion=1;installedVersion=$coreVersion;mode=$Mode;mutationCount=0;mutationAttemptCount=0;actualRebootPerformed=$false;capturedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');totalFaultPhaseGuardSeconds=180;observationWindowSeconds=120;coreHash=(Get-FileHash -LiteralPath $coreExe -Algorithm SHA256).Hash;before=Export-Snapshot $before;beforeNetwork=$network;beforeConfigurationHashes=$hashes;beforeIntent=$intent;beforeCoreRecovery=$recovery;beforeQueries=$beforeQueries;thirdPartyRelayPresent=$relayBaseline.present;beforeThirdPartyRelay=$relayBaseline;serviceStatusAvailable=$false;serviceStatusUnavailableReason='Installed identity-probe client is authorized for hello only.';observations=@();result='inspection'}
function Save-Receipt{$receipt |ConvertTo-Json -Depth 12 |Set-Content -LiteralPath $outputFull -Encoding UTF8}
$receipt.beforeHello=Read-CoreHello ([int]$before.core.ProcessId)
Save-Receipt
if($Mode -eq 'Inspect'){$receipt |ConvertTo-Json -Depth 12;exit 0}
if($receipt.coreHash -ne $ExpectedCoreHash -or $coreVersion -ne '3.7.9.0'){throw 'Final3.7.9 Core version/hash is not proven.'}
if($TargetProcessId -le 0 -or [string]::IsNullOrWhiteSpace($TargetCreatedUtc) -or $before.core.ProcessId -ne $TargetProcessId){throw 'Provide the exact current SCM Core PID and six-fractional-digit UTC birth.'}
if($before.services.Count -ne 4 -or @($before.services |Where-Object {$_.State -ne 'Running' -or $_.StartMode -ne 'Auto' -or $_.StartName -ne 'LocalSystem'}).Count -ne 0){throw 'All four automatic LocalSystem services must be running.'}
$expectedImages=@{EgoistShieldCore=$coreExe;EgoistShieldSystemDoH=$dnsWrapper;EgoistShieldTelegramProxy=$tgWrapper;EgoistShieldZapret=$zapretWrapper}
foreach($service in $before.services){
    $expected=$expectedImages[$service.Name];$row=$before.byId[[int]$service.ProcessId]
    if(-not $row -or -not $row.CreationDate -or $row.ExecutablePath -ne $expected -or $service.PathName.Trim().Trim('"') -ne $expected){throw 'An SCM executable path or live root birth is not proven.'}
}
if(-not $recovery.automatic -or -not $recovery.nonCrashFlag -or -not $recovery.restartOnly -or $recovery.resetSeconds -lt 3600){throw 'Core restart-only recovery policy is not configured.'}
if($before.uiProcessIds.Count -ne 0 -or -not $before.dnsOwned -or @($beforeQueries |Where-Object {-not $_.verified}).Count -ne 0 -or -not $receipt.beforeHello.verified){throw 'No-UI, owned DNS, actual wire queries and authenticated Core hello must be verified before the fault.'}
$tg=@($before.tcp |Where-Object {$_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq 1445})
if($tg.Count -ne 1){throw 'Telegram endpoint identity is ambiguous.'}
$tgRow=$before.byId[[int]$tg[0].OwningProcess]
if($tgRow.ExecutablePath -ne $tgExe -or -not (Test-Descendant $before ([int]$tgRow.ProcessId) ([int]$before.tg.ProcessId)) -or -not (Test-Tcp '127.0.0.1' 1445) -or -not (Test-ThirdPartyRelayPreservation $before $relayBaseline)){throw 'Peer Telegram/Relay listener baseline is not ready.'}
$target=$before.byId[$TargetProcessId]
if($target.ExecutablePath -ne $coreExe -or ([DateTimeOffset]$target.CreationDate).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.ffffffZ') -ne $TargetCreatedUtc){throw 'Core target path or exact birth changed.'}
$process=[Diagnostics.Process]::GetProcessById($TargetProcessId)
try{
    $heldHandle=$process.Handle
    if($heldHandle -eq [IntPtr]::Zero -or $process.MainModule.FileName -ne $coreExe -or [Math]::Abs(($process.StartTime.ToUniversalTime()-[DateTime]::Parse($TargetCreatedUtc).ToUniversalTime()).TotalMilliseconds) -gt 1){throw 'Held Core handle does not match the reviewed process identity.'}
    $fresh=Read-CoreSnapshot
    if($fresh.core.ProcessId -ne $TargetProcessId -or $fresh.core.State -ne 'Running' -or -not $fresh.byId[$TargetProcessId] -or $fresh.byId[$TargetProcessId].CreationDate -ne $target.CreationDate -or -not (Test-CorePeerPreservation $fresh $before) -or -not (Test-CoreSettingPreservation)){throw 'Fresh pre-fault Core/peer/settings readback failed.'}
    foreach($row in $fresh.byId.Values){
        if($row.Name -eq 'EgoistShield.exe' -and (Test-Descendant $fresh ([int]$row.ProcessId) $TargetProcessId)){$oldWorkerRows[[int]$row.ProcessId]=$row}
    }
    $receipt.preverifiedOldWorkerIds=@($oldWorkerRows.Keys)
    $receipt.target=[ordered]@{processId=$TargetProcessId;createdUtc=$TargetCreatedUtc;executable=$coreExe;heldHandle=$true}
    $receipt.mutationAttemptCount=1;$receipt.injectedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');Save-Receipt
    $coreFaultWatch=[Diagnostics.Stopwatch]::StartNew()
    $process.Kill();$receipt.mutationCount=1;Save-Receipt
}finally{$process.Dispose()}
$streak=0;$priorNewIdentity=$null
try{
    while($coreFaultWatch.Elapsed.TotalSeconds -lt 120){
        Start-Sleep -Milliseconds 2000
        $current=Read-CoreSnapshot
        $queries=Read-CoreProbe $false
        $preserved=(Test-CorePeerPreservation $current $before) -and (Test-CoreSettingPreservation) -and @($queries |Where-Object {-not $_.verified}).Count -eq 0
        $root=$current.byId[[int]$current.core.ProcessId]
        $newCore=$current.core.State -eq 'Running' -and $current.core.StartMode -eq 'Auto' -and $current.core.ProcessId -gt 0 -and $current.core.ProcessId -ne $TargetProcessId -and $root -and $root.CreationDate -gt $target.CreationDate -and $root.ExecutablePath -eq $coreExe
        $hello=if($newCore){Read-CoreHello ([int]$current.core.ProcessId)}else{[pscustomobject]@{verified=$false;code='CORE_NOT_YET_REPLACED'}}
        $currentRelay=try{Read-ThirdPartyRelay $current}catch{[pscustomobject]@{state='unknown';present=$null}}
        $receipt.observations+=[pscustomobject]@{snapshot=Export-Snapshot $current;healthQueries=$queries;coreHello=$hello;thirdPartyRelay=$currentRelay;peerAndSettingsPreserved=[bool]$preserved;elapsedSeconds=[Math]::Round($coreFaultWatch.Elapsed.TotalSeconds,2)}
        if(-not $preserved){$receipt.result='preservation-check-failed';break}
        $identity=if($newCore){[string]$root.ProcessId+':'+([DateTimeOffset]$root.CreationDate).ToUniversalTime().ToString('o')}else{$null}
        if($newCore -and $hello.verified){if($identity -eq $priorNewIdentity){$streak++}else{$streak=1};$priorNewIdentity=$identity}else{$streak=0;$priorNewIdentity=$null}
        if($streak -ge 3){$receipt.coreRecoveryConfirmedAfterSeconds=[Math]::Round($coreFaultWatch.Elapsed.TotalSeconds,2);$receipt.result='core-recovered';break}
        Save-Receipt
    }
    if($receipt.result -eq 'inspection'){$receipt.result='recovery-not-confirmed-within-observation-window'}
    if($coreFaultWatch.Elapsed.TotalSeconds -ge 150){throw 'Insufficient final-readback time within the180-second fault budget.'}
    $final=Read-CoreSnapshot
    $receipt.finalThirdPartyRelay=try{Read-ThirdPartyRelay $final}catch{[pscustomobject]@{state='unknown';present=$null}}
    $receipt.final=Export-Snapshot $final;$receipt.finalNetwork=Read-NetworkFingerprint;$receipt.finalConfigurationHashes=Read-ConfigurationHash
    $receipt.finalIntent=Read-CoreIntent;$receipt.finalCoreRecovery=Read-CoreRecovery;$receipt.finalQueries=Read-CoreProbe $true
    $receipt.finalHello=Read-CoreHello ([int]$final.core.ProcessId) ([int][Math]::Max(0,[Math]::Min(5000,(180-$coreFaultWatch.Elapsed.TotalSeconds)*1000)))
    $receipt.remainingOldWorkerIds=@($oldWorkerRows.Keys |Where-Object {$row=$final.byId[[int]$_];$row -and $row.CreationDate -eq $oldWorkerRows[[int]$_].CreationDate -and $row.ExecutablePath -eq $oldWorkerRows[[int]$_].ExecutablePath})
    $receipt.adapterDnsModesAndBindingsPreserved=(($receipt.finalNetwork |ConvertTo-Json -Depth 6 -Compress) -eq ($network |ConvertTo-Json -Depth 6 -Compress))
    $receipt.configurationHashesPreserved=(($receipt.finalConfigurationHashes |ConvertTo-Json -Compress) -eq ($hashes |ConvertTo-Json -Compress))
    $finalRoot=$final.byId[[int]$final.core.ProcessId]
    $finalIdentity=if($finalRoot){[string]$finalRoot.ProcessId+':'+([DateTimeOffset]$finalRoot.CreationDate).ToUniversalTime().ToString('o')}else{$null}
    if(-not (Test-CorePeerPreservation $final $before) -or -not (Test-CoreSettingPreservation) -or -not $receipt.finalHello.verified -or $finalIdentity -ne $priorNewIdentity){$receipt.result='final-preservation-or-core-proof-failed'}
    elseif($receipt.result -eq 'core-recovered'){$receipt.result=if(@($receipt.finalQueries |Where-Object {-not $_.verified}).Count -eq 0){'recovered'}else{'core-recovered-upstream-unverified'}}
    $receipt.elapsedSeconds=[Math]::Round($coreFaultWatch.Elapsed.TotalSeconds,2);Save-Receipt
    $receipt |ConvertTo-Json -Depth 12
    if($receipt.result -ne 'recovered'){exit 2}
}catch{$receipt.result='observation-failed';$receipt.errorType=$_.Exception.GetType().Name;Save-Receipt;throw}

