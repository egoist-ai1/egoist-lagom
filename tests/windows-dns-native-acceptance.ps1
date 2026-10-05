[CmdletBinding()]
param(
  [Alias('Mode')][ValidateSet('Run','GuardOnly','EmergencyGuardian','QueryProbe')][string]$DnsNativeMode='Run',
  [Alias('IntegrityManifestPath')][string]$DnsIntegrityManifestPath='',
  [Alias('ExpectedSourceCommit')][ValidatePattern('^$|^[a-f0-9]{40}$')][string]$DnsExpectedSourceCommit='',
  [Alias('EvidenceDirectory')][string]$DnsEvidenceDirectory='',
  [ValidateSet('Cloudflare','Quad9')][string]$Provider='Cloudflare',
  [string]$DnsGuardianPlanPath='',
  [ValidatePattern('^$|^[a-f0-9]{64}$')][string]$DnsGuardianPlanHash='',
  [ValidatePattern('^$|^[a-f0-9]{20}$')][string]$DnsProbeLabel='',
  [Alias('LibraryOnly')][switch]$DnsLibraryOnly
)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$script:DnsTestsRoot=$PSScriptRoot
. (Join-Path $script:DnsTestsRoot 'windows-production-acceptance.ps1') -LibraryOnly
. (Join-Path $script:DnsTestsRoot 'windows-ordinary-gui.ps1') -OrdinaryGuiLibraryOnly

function Assert-DnsNativeHost {
  $environment=@{}
  foreach($name in @('GITHUB_ACTIONS','CI','RUNNER_ENVIRONMENT','RUNNER_OS','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA')){$environment[$name]=[Environment]::GetEnvironmentVariable($name)}
  $windows=[Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
  $administrator=$windows -and ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $errors=@(Get-NativeAcceptanceEnvironmentErrors -Environment $environment -Administrator $administrator -Windows $windows)
  if($errors.Count){throw ('DNS native hosted guard refused before any write: '+($errors -join ', '))}
  if($PSVersionTable.PSVersion.Major -lt 7 -or -not [Environment]::Is64BitProcess){throw 'DNS native acceptance requires PowerShell 7 x64.'}
  if($DnsExpectedSourceCommit -cne $environment.GITHUB_SHA){throw 'DNS expected source must equal actual GITHUB_SHA.'}
  Assert-NativeOrdinaryPath $env:RUNNER_TEMP;Assert-NativeOrdinaryPath $env:GITHUB_WORKSPACE
  $script:DnsBaseWork=Join-Path ([IO.Path]::GetFullPath($env:RUNNER_TEMP)) ('lagom-native-'+$environment.GITHUB_RUN_ID+'-'+$environment.GITHUB_RUN_ATTEMPT)
  $script:DnsWork=Join-Path $script:DnsBaseWork 'dns-native'
  return $environment
}
function ConvertTo-DnsIpSequence {
  param($Addresses)
  return ,@($Addresses | ForEach-Object {[Net.IPAddress]::Parse([string]$_).ToString().ToLowerInvariant()})
}
function Test-DnsSameSequence {
  param($Left,$Right)
  return ((ConvertTo-DnsIpSequence $Left) -join ',') -ceq ((ConvertTo-DnsIpSequence $Right) -join ',')
}
function Get-DnsNativeProvider {
  param([string]$Name,[bool]$Ipv6)
  $profiles=@{
    Cloudflare=@{url='https://cloudflare-dns.com/dns-query';ipv4=@('1.1.1.1','1.0.0.1');ipv6=@('2606:4700:4700::1111','2606:4700:4700::1001')}
    Quad9=@{url='https://dns.quad9.net/dns-query';ipv4=@('9.9.9.9','149.112.112.112');ipv6=@('2620:fe::fe','2620:fe::9')}
  }
  if(-not $profiles.ContainsKey($Name)){throw 'Unapproved DNS provider.'}
  $dnsProfile=$profiles[$Name]
  $ipv6Servers=@();if($Ipv6){$ipv6Servers=@($dnsProfile.ipv6)}
  return [ordered]@{name=$Name;url=$dnsProfile.url;ipv4=@($dnsProfile.ipv4);ipv6=$ipv6Servers;servers=@($dnsProfile.ipv4)+$ipv6Servers}
}
function Get-DnsNativeRegistryTree {
  param([string]$Subkey)
  $rows=[Collections.Generic.List[object]]::new()
  function Read-DnsNativeRegistryKey {
    param([string]$Name,[int]$Depth)
    if($Depth -gt 12 -or $rows.Count -gt 3000){throw 'DNS registry inventory bound exceeded.'}
    $key=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($Name,$false)
    if(-not $key){$rows.Add([ordered]@{key=$Name;exists=$false;values=@{}});return}
    try{
      $values=[ordered]@{}
      foreach($valueName in @($key.GetValueNames() | Sort-Object)){
        $value=$key.GetValue($valueName,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $values[$valueName]=[ordered]@{kind=[string]$key.GetValueKind($valueName);value=$(if($value -is [byte[]]){[Convert]::ToBase64String($value)}else{$value})}
      }
      $rows.Add([ordered]@{key=$Name;exists=$true;values=$values})
      foreach($child in @($key.GetSubKeyNames() | Sort-Object)){Read-DnsNativeRegistryKey ($Name+'\'+$child) ($Depth+1)}
    }finally{$key.Dispose()}
  }
  Read-DnsNativeRegistryKey $Subkey 0
  return $rows.ToArray()
}
function Get-DnsNativeServerAddressMap {
  $map=@{}
  # One unfiltered terminating query distinguishes an absent family from a CIM failure.
  foreach($row in @(Get-DnsClientServerAddress -ErrorAction Stop)){
    $index=[int]$row.InterfaceIndex;$addressFamily=[int]$row.AddressFamily
    if($index -lt 1 -or $addressFamily -notin @(2,23)){throw 'DNS API returned an invalid interface/family identity.'}
    $key=([string]$index+'/'+[string]$addressFamily)
    if($map.ContainsKey($key)){throw 'DNS API returned duplicate interface/family rows.'}
    $servers=@();if($null -ne $row.ServerAddresses){$servers=@($row.ServerAddresses)}
    foreach($server in $servers){
      if([int]([Net.IPAddress]::Parse([string]$server).AddressFamily) -ne $addressFamily){throw 'DNS API server address differs from its declared family.'}
    }
    $map[$key]=[ordered]@{apiPresent=$true;servers=$servers}
  }
  return $map
}
function Get-DnsNativeApiFamily {
  param($Map,[int]$Index,[int]$AddressFamily)
  if($Index -lt 1 -or $AddressFamily -notin @(2,23)){throw 'DNS API family lookup identity is invalid.'}
  $key=([string]$Index+'/'+[string]$AddressFamily)
  if($Map.ContainsKey($key)){return $Map[$key]}
  return [ordered]@{apiPresent=$false;servers=@()}
}
function Assert-DnsNativeApiPresence {
  param($Original,$Actual,[bool]$Managed)
  if($Original.apiPresent -isnot [bool] -or $Actual.apiPresent -isnot [bool] -or
     $Original.apiPresent -ne $Actual.apiPresent -or ($Managed -and -not $Actual.apiPresent)){
    throw 'DNS API family presence differs from the original or managed family.'
  }
}
function Get-DnsNativeInventory {
  $dnsServerAddresses=Get-DnsNativeServerAddressMap
  $adapters=@(Get-NetAdapter -IncludeHidden | Sort-Object ifIndex | ForEach-Object {
    $adapter=$_;$families=[ordered]@{}
    foreach($family in @('ipv4','ipv6')){
      $protocol=if($family -eq 'ipv4'){'Tcpip'}else{'Tcpip6'}
      $key=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Services\'+$protocol+'\Parameters\Interfaces\'+[string]$adapter.InterfaceGuid,$false)
      try{$nameServer=if($key){$key.GetValue('NameServer',$null)}else{$null};$dhcp=if($key){$key.GetValue('DhcpNameServer',$null)}else{$null}}finally{if($key){$key.Dispose()}}
      $api=Get-DnsNativeApiFamily $dnsServerAddresses ([int]$adapter.ifIndex) $(if($family -eq 'ipv4'){2}else{23})
      $families[$family]=[ordered]@{apiPresent=[bool]$api.apiPresent;servers=@($api.servers);static=(-not [string]::IsNullOrWhiteSpace([string]$nameServer));nameServer=$nameServer;dhcpNameServer=$dhcp}
    }
    [ordered]@{index=[int]$adapter.ifIndex;guid=[string]$adapter.InterfaceGuid;alias=[string]$adapter.Name;description=[string]$adapter.InterfaceDescription;status=[string]$adapter.Status;families=$families}
  })
  $doh=@(Get-DnsClientDohServerAddress -ErrorAction Stop | Sort-Object ServerAddress | ForEach-Object {[ordered]@{serverAddress=[string]$_.ServerAddress;dohTemplate=[string]$_.DohTemplate;allowFallbackToUdp=[bool]$_.AllowFallbackToUdp;autoUpgrade=[bool]$_.AutoUpgrade}})
  $registry=[ordered]@{}
  foreach($subkey in @('SYSTEM\CurrentControlSet\Services\Dnscache\Parameters\DohWellKnownServers','SYSTEM\CurrentControlSet\Services\Dnscache\Parameters\DohInterfaceSettings','SYSTEM\CurrentControlSet\Services\Dnscache\Parameters\DnsPolicyConfig','SOFTWARE\Policies\Microsoft\Windows NT\DNSClient')){$registry[$subkey]=@(Get-DnsNativeRegistryTree $subkey)}
  $tasks=@(Get-ScheduledTask | Sort-Object TaskPath,TaskName | ForEach-Object {
    $xml=Export-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath
    $hash=[Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($xml))
    [ordered]@{path=$_.TaskPath;name=$_.TaskName;definitionSha256=[Convert]::ToHexString($hash).ToLowerInvariant()}
  })
  $services=@(Get-NativeProductServices | Select-Object Name,StartMode,StartName,PathName)
  return [ordered]@{adapters=$adapters;doh=$doh;registry=$registry;network=(Get-NativeNetworkFingerprint);tasks=$tasks;productServices=$services}
}
function Assert-DnsNoForeignState {
  foreach($command in @('Get-DnsClientDohServerAddress','Set-DnsClientDohServerAddress','Add-DnsClientDohServerAddress','Remove-DnsClientDohServerAddress','Get-NetIPInterface','Get-NetRoute')){if(-not (Get-Command $command -ErrorAction SilentlyContinue)){throw ('Native Windows DNS prerequisite unavailable: '+$command)}}
  if([Environment]::OSVersion.Version.Build -lt 20348){throw 'This gate requires supported native Windows DoH, not the legacy local resolver mode.'}
  Assert-NativeNoGui
  if(@(Get-NativeProductTasks).Count){throw 'Product recovery Tasks are present; isolated DNS acceptance cannot start.'}
  $services=@(Get-NativeProductServices)
  if(@($services | Where-Object {$_.Name -notin @('EgoistShieldCore','EgoistShieldTelegramProxy')}).Count){throw 'Legacy DNS/TUN/filter/product service is present; DNS mutation refused.'}
  [void](Assert-NativeService 'EgoistShieldCore' $script:Core -Running)
  foreach($service in @($services | Where-Object {$_.Name -eq 'EgoistShieldTelegramProxy'})){
    $wrapper=Join-Path $script:DataRoot 'Runtime\TelegramProxy\service-wrapper\egoistshield-telegram-proxy-service.exe'
    [void](Assert-NativeAdministratorOwned $wrapper);[void](Assert-NativeService $service.Name $wrapper -Running)
  }
  foreach($relative in @('Service\native-doh-state.json','Service\dns-owned-state.json','Runtime\SystemDoH\state.json','Runtime\Vpn\state.json','Service\Vpn')){if(Test-Path -LiteralPath (Join-Path $script:DataRoot $relative)){throw ('Pre-existing protected DNS/VPN intent refused: '+$relative)}}
  if(@(Get-DnsClientNrptRule -ErrorAction Stop).Count -or @(Get-DnsClientNrptPolicy -Effective -ErrorAction Stop).Count){throw 'NRPT policy requires a separate DNS test topology.'}
}
function Get-DnsSafeAdapter {
  param($Inventory)
  $excluded='WireGuard|Wintun|Cloudflare\s+WARP|VPN|Loopback|isatap|Teredo|Pseudo|Npcap|Bluetooth|(^|[\s_-])(TAP|TUN)([\s_-]|$)'
  $eligible=[Collections.Generic.List[int]]::new()
  $physicalAdapters=@(Get-NetAdapter -Physical -ErrorAction Stop)
  foreach($interface in @(Get-NetIPInterface -ErrorAction Stop)){
    if($interface.ConnectionState -ne 'Connected' -or [string]$interface.InterfaceAlias -match $excluded){continue}
    $adapters=@($Inventory.adapters | Where-Object {$_.index -eq [int]$interface.InterfaceIndex})
    if($adapters.Count -ne 1){throw 'Eligible IP interface does not identify exactly one inventoried adapter.'}
    $identity=([string]$interface.InterfaceAlias+' '+[string]$adapters[0].description)
    if($identity -match $excluded){continue}
    $guid=[Guid]::Empty
    if(-not [Guid]::TryParse([string]$adapters[0].guid,[ref]$guid) -or $guid -eq [Guid]::Empty){throw 'Connected DNS adapter GUID is invalid.'}
    $physical=@($physicalAdapters | Where-Object {[int]$_.ifIndex -eq [int]$interface.InterfaceIndex -or [string]$_.InterfaceGuid -ieq [string]$adapters[0].guid})
    if($physical.Count -eq 0){continue}
    if($physical.Count -ne 1 -or [int]$physical[0].ifIndex -ne [int]$interface.InterfaceIndex -or [string]$physical[0].InterfaceGuid -ine [string]$adapters[0].guid -or
       [string]$physical[0].Name -ine [string]$adapters[0].alias -or [string]$physical[0].Name -ine [string]$interface.InterfaceAlias -or
       [string]$physical[0].InterfaceDescription -cne [string]$adapters[0].description){throw 'Physical DNS adapter identity changed or is ambiguous.'}
    $eligible.Add([int]$interface.InterfaceIndex)
  }
  $targets=@($eligible | Sort-Object -Unique)
  $routes=@(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -PolicyStore ActiveStore -ErrorAction Stop)
  if($targets.Count -ne 1 -or $routes.Count -ne 1 -or [int]$routes[0].InterfaceIndex -ne $targets[0]){
    $preflight=[ordered]@{schemaVersion=1;stage='dns-safe-adapter-preflight';eligibleCount=$targets.Count;eligibleIndices=@($targets | Select-Object -First 32);eligibleAdapters=@($Inventory.adapters | Where-Object {$_.index -in $targets} | Sort-Object index | Select-Object -First 8 | ForEach-Object {$alias=[string]$_.alias;$description=[string]$_.description;[ordered]@{index=[int]$_.index;alias=$alias.Substring(0,[Math]::Min(96,$alias.Length));description=$description.Substring(0,[Math]::Min(128,$description.Length))}});defaultRouteCount=$routes.Count;defaultRouteIndices=@($routes | Select-Object -First 32 | ForEach-Object {[int]$_.InterfaceIndex});matched=$false;truncated=($targets.Count -gt 8 -or $routes.Count -gt 32)}
    throw ('Ambiguous/default adapter topology refused before DNS mutation. Preflight='+($preflight | ConvertTo-Json -Depth 3 -Compress))
  }
  $rows=@($Inventory.adapters | Where-Object {$_.index -eq $targets[0]})
  if($rows.Count -ne 1 -or [string]$rows[0].guid -notmatch '^\{?[a-fA-F0-9-]{36}\}?$' -or $rows[0].families.ipv4.apiPresent -ne $true -or $rows[0].families.ipv4.servers.Count -lt 1){throw 'Stable GUID/original DNS is unavailable.'}
  foreach($family in @('ipv4','ipv6')){foreach($server in $rows[0].families[$family].servers){if([Net.IPAddress]::IsLoopback([Net.IPAddress]::Parse([string]$server))){throw 'Original loopback DNS requires a separate owned resolver gate.'}}}
  return $rows[0]
}
function Assert-DnsControlProbe {
  param([string]$Phase)
  $runnerProcesses=@(Get-CimInstance Win32_Process -Filter "Name = 'Runner.Listener.exe' OR Name = 'Runner.Worker.exe'" -OperationTimeoutSec 5)
  $runnerIds=@($runnerProcesses | ForEach-Object {[int]$_.ProcessId})
  $runnerConnections=@(Get-NetTCPConnection -State Established -ErrorAction Stop | Where-Object {$_.OwningProcess -in $runnerIds -and $_.RemotePort -eq 443} | Select-Object OwningProcess,RemoteAddress,RemotePort)
  if(-not $runnerConnections.Count){throw 'Actual hosted runner has no observable established HTTPS control connection; DNS mutation refused.'}
  $records=@()
  foreach($hostName in @('api.github.com','github.com')){
    $watch=[Diagnostics.Stopwatch]::StartNew();$addresses=[Net.Dns]::GetHostAddresses($hostName) | Where-Object {$_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork}
    if(-not $addresses){throw ('DNS control has no IPv4 address: '+$hostName)}
    $client=[Net.Sockets.TcpClient]::new()
    try{if(-not $client.ConnectAsync($addresses[0],443).Wait(5000) -or -not $client.Connected){throw ('Pinned-IP control TCP failed: '+$hostName)}}finally{$client.Dispose()}
    $response=Invoke-WebRequest -Uri ('https://'+$hostName+'/') -Method Head -MaximumRedirection 0 -TimeoutSec 10 -SkipHttpErrorCheck
    if([int]$response.StatusCode -lt 200 -or [int]$response.StatusCode -ge 500){throw ('Control HTTPS failed: '+$hostName)}
    $records+=[ordered]@{host=$hostName;ipv4=[string]$addresses[0];tcp443=$true;httpsStatus=[int]$response.StatusCode;elapsedMs=[Math]::Round($watch.Elapsed.TotalMilliseconds,2)}
  }
  return [ordered]@{phase=$Phase;records=$records;actualHostedControlConnections=$runnerConnections;runnerProcesses=@($runnerProcesses | Select-Object Name,ProcessId,CreationDate);tokensOrHeadersRecorded=$false}
}
function Get-DnsGuardianHeartbeatMutex {
  param([string]$Path)
  $canonical=[IO.Path]::GetFullPath($Path).ToUpperInvariant()
  $sha=[Security.Cryptography.SHA256]::Create()
  try{$digest=$sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))}finally{$sha.Dispose()}
  $name='Local\LagomDnsHeartbeat-'+[BitConverter]::ToString($digest).Replace('-','')
  return [Threading.Mutex]::new($false,$name)
}
function Invoke-DnsGuardianHeartbeat {
  if(-not $script:DnsHeartbeat){return}
  $mutex=Get-DnsGuardianHeartbeatMutex $script:DnsHeartbeat
  $acquired=$false;$temporary=$null;$owned=$false;$stream=$null
  try{
    try{$acquired=$mutex.WaitOne(500)}catch [Threading.AbandonedMutexException]{$acquired=$true;throw}
    if(-not $acquired){throw 'DNS heartbeat lock was unavailable.'}
    $temporary=$script:DnsHeartbeat+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes([DateTimeOffset]::UtcNow.ToString('o'))
    $stream=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);$owned=$true
    $stream.Write($bytes,0,$bytes.Length);$stream.Dispose();$stream=$null
    if([IO.File]::Exists($script:DnsHeartbeat)){
      if(([IO.File]::GetAttributes($script:DnsHeartbeat) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'DNS heartbeat must be an ordinary owned file.'}
      [IO.File]::Replace($temporary,$script:DnsHeartbeat,[NullString]::Value)
    }else{[IO.File]::Move($temporary,$script:DnsHeartbeat)}
  }finally{
    try{if($stream){$stream.Dispose()};if($owned -and [IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)}}
    finally{try{if($acquired){$mutex.ReleaseMutex()}}finally{$mutex.Dispose()}}
  }
}
function Read-DnsGuardianHeartbeatObservation {
  param([string]$Path,[Nullable[DateTimeOffset]]$Now,[double]$TimeoutSeconds)
  $stream=$null;$mutex=$null;$acquired=$false;$status='unavailable';$failureClass='none';$ageSeconds=$null;$failureHResult=$null
  try{
    $mutex=Get-DnsGuardianHeartbeatMutex $Path
    try{$acquired=$mutex.WaitOne(500)}catch [Threading.AbandonedMutexException]{$acquired=$true;$failureClass='lock-abandoned'}
    if(-not $acquired){$failureClass='lock-timeout'}
    elseif($failureClass -cne 'lock-abandoned'){
      $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::Read -bor [IO.FileShare]::Delete))
      $buffer=[byte[]]::new(129);$count=0
      while($count -lt $buffer.Length){$read=$stream.Read($buffer,$count,$buffer.Length-$count);if($read -eq 0){break};$count+=$read}
      if($count -eq 0 -or $count -gt 128){$failureClass='invalid'}
      else{
        $text=[Text.UTF8Encoding]::new($false,$true).GetString($buffer,0,$count)
        $heartbeat=[DateTimeOffset]::Parse($text,[Globalization.CultureInfo]::InvariantCulture)
        $observedNow=if($null -eq $Now){[DateTimeOffset]::UtcNow}else{$Now}
        $age=($observedNow-$heartbeat).TotalSeconds;$ageSeconds=[Math]::Round($age,3)
        $status=if($age -gt $TimeoutSeconds){'expired'}else{'fresh'}
      }
    }
  }catch{
    $base=$_.Exception.GetBaseException();$failureHResult=$base.HResult
    $failureClass=if($base -is [IO.IOException]){'io'}elseif($base -is [UnauthorizedAccessException]){'access'}elseif($base -is [FormatException] -or $base -is [Text.DecoderFallbackException]){'invalid'}else{'other'}
  }finally{
    try{if($stream){$stream.Dispose()}}finally{try{if($acquired){$mutex.ReleaseMutex()}}finally{if($mutex){$mutex.Dispose()}}}
  }
  return [pscustomobject]@{status=$status;failureClass=$failureClass;ageSeconds=$ageSeconds;failureHResult=$failureHResult}
}
function Assert-DnsPrivateOwnedState {
  param([string]$Phase)
  $directory=Join-Path $script:DataRoot 'Service';$path=Join-Path $directory 'native-doh-state.json'
  foreach($target in @($directory,$path)){
    [void](Assert-NativeAdministratorOwned $target);$acl=Get-Acl -LiteralPath $target
    if($target -eq $directory -and -not $acl.AreAccessRulesProtected){throw 'Protected DNS intent directory inherits unrelated access.'}
    foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
      if(($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0){continue}
      if($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rule.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544') -and ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadData) -ne 0){throw 'Native DNS intent is readable by an unrelated principal.'}
    }
  }
  if((Get-Item -LiteralPath $path).Length -gt 1048576){throw 'Native DNS intent size exceeded.'}
  $state=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  if($state.schemaVersion -ne 1 -or $state.owner -cne 'EgoistShield' -or $state.url -cne $script:DnsProfile.url -or -not (Test-DnsSameSequence $state.servers $script:DnsProfile.servers)){throw 'Core protected DNS intent differs from selected GUI provider.'}
  $baselines=@($state.originalDnsAdapters)
  if($baselines.Count -ne 1 -or $baselines[0].interfaceGuid -ine $script:DnsAdapter.guid){throw 'Core native DNS baseline changed adapter identity.'}
  foreach($family in @('ipv4','ipv6')){
    $staticName=$family+'Static'
    try{
    if([bool]$baselines[0].$staticName -ne [bool]$script:DnsAdapter.families[$family].static -or -not (Test-DnsSameSequence $baselines[0].$family $script:DnsAdapter.families[$family].servers)){throw 'Protected Core baseline differs from independent original DNS inventory.'}
    }catch{throw [InvalidOperationException]::new(('DNS sequence observation failed for baseline/'+$family),$_.Exception)}
  }
  $records=@(Get-DnsClientDohServerAddress)
  foreach($server in $script:DnsProfile.servers){
    $entry=@($records | Where-Object {(ConvertTo-DnsIpSequence @($_.ServerAddress))[0] -ceq (ConvertTo-DnsIpSequence @($server))[0]})
    if($entry.Count -ne 1 -or [string]$entry[0].DohTemplate -cne $script:DnsProfile.url -or [bool]$entry[0].AllowFallbackToUdp -or -not [bool]$entry[0].AutoUpgrade){throw 'Windows native DoH API/fallback policy differs from protected intent.'}
  }
  $current=Get-DnsNativeInventory
  foreach($original in $script:DnsBefore.adapters){
    $actual=@($current.adapters | Where-Object {$_.guid -ieq $original.guid});if($actual.Count -ne 1){throw 'DNS adapter set changed.'}
    foreach($family in @('ipv4','ipv6')){
      $managed=$original.guid -ieq $script:DnsAdapter.guid -and @($script:DnsProfile[$family]).Count -gt 0
      Assert-DnsNativeApiPresence $original.families[$family] $actual[0].families[$family] $managed
      $expected=$original.families[$family].servers;if($managed){$expected=$script:DnsProfile[$family]}
      try{
      if(-not (Test-DnsSameSequence $actual[0].families[$family].servers $expected) -or ($managed -and -not $actual[0].families[$family].static) -or (-not $managed -and $actual[0].families[$family].nameServer -cne $original.families[$family].nameServer)){throw 'Per-adapter DNS actual state does not match owned/preserved families.'}
      }catch{throw [InvalidOperationException]::new(('DNS sequence observation failed for actual/'+$family),$_.Exception)}
    }
  }
  Assert-DnsUnrelatedPreserved $current
  $proof=[ordered]@{phase=$Phase;stateSha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash;owner=(Get-Acl -LiteralPath $path).GetOwner([Security.Principal.SecurityIdentifier]).Value;intentPrivate=$true;nativeApiPolicyVerified=$true;adapterDnsVerified=$true;fallbackToUdp=$false;windowsClient=$true;separateSystemDohService=$false}
  $script:Receipt.privateStateReadbacks+=$proof;Save-NativeReceipt
  return $proof
}
function Assert-DnsUnrelatedPreserved {
  param($Current)
  foreach($field in @('defaultRoutes','ipv6Bindings','userProxy','winHttp')){if(($Current.network[$field] | ConvertTo-Json -Depth 15 -Compress) -cne ($script:DnsBefore.network[$field] | ConvertTo-Json -Depth 15 -Compress)){throw ('DNS operation changed unrelated network setting: '+$field)}}
  foreach($field in @('tasks','productServices')){if(($Current[$field] | ConvertTo-Json -Depth 15 -Compress) -cne ($script:DnsBefore[$field] | ConvertTo-Json -Depth 15 -Compress)){throw ('DNS operation changed unrelated registration: '+$field)}}
  $allowed=ConvertTo-DnsIpSequence $script:DnsProfile.servers
  $original=@($script:DnsBefore.doh | Where-Object {(ConvertTo-DnsIpSequence @($_.serverAddress))[0] -notin $allowed})
  $actual=@($Current.doh | Where-Object {(ConvertTo-DnsIpSequence @($_.serverAddress))[0] -notin $allowed})
  if(($original | ConvertTo-Json -Depth 8 -Compress) -cne ($actual | ConvertTo-Json -Depth 8 -Compress)){throw 'DNS operation changed unrelated Windows DoH registrations.'}
}
function Save-DnsFailedBaselineInventory {
  param($Observation)
  # Inert/library imports and guardian/query modes must never create observations.
  if($DnsLibraryOnly -or $DnsNativeMode -cne 'Run'){return}
  $captured=Get-Variable -Name DnsFailedBaselineCaptured -Scope Script -ErrorAction SilentlyContinue
  if($captured -and $captured.Value){return}
  $script:DnsFailedBaselineCaptured=$true
  [void](Assert-DnsNativeHost)
  if($script:SourceCommit -cne $DnsExpectedSourceCommit -or $script:Receipt.sourceCommit -cne $DnsExpectedSourceCommit){throw 'Failed baseline observation source identity differs.'}
  $directory=Assert-NativePathWithin ([string]$script:Evidence) ([string]$script:DnsWork)
  Assert-NativeOrdinaryPath $directory
  if(-not [IO.Directory]::Exists($directory)){throw 'Failed baseline observation evidence directory is absent.'}
  $path=Assert-NativePathWithin (Join-Path $directory 'failed-baseline-current-inventory.json') ([string]$script:DnsWork)
  $observation=[ordered]@{schemaVersion=1;kind='failed-dns-baseline-current-inventory';sourceCommit=$DnsExpectedSourceCommit;observedAtUtc=$Observation.observedAtUtc;capturedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');baselineUnmodified=$true;current=$Observation.current}
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($observation | ConvertTo-Json -Depth 28 -Compress))
  if($bytes.Length -gt 1048576){throw 'Failed baseline observation exceeds one MiB.'}
  $stream=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
  $sha=[Security.Cryptography.SHA256]::Create()
  try{$hash=[BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
  $workPrefix=([IO.Path]::GetFullPath([string]$script:DnsWork).TrimEnd([char[]]'\/')+[IO.Path]::DirectorySeparatorChar)
  $script:Receipt.baselineFailureInventory=[ordered]@{relativePath=$path.Substring($workPrefix.Length);bytes=$bytes.Length;sha256=$hash;currentInventoryCaptured=$true;baselineUnmodified=$true}
}
function Assert-DnsBaselineRestored {
  $current=Get-DnsNativeInventory
  if(($current | ConvertTo-Json -Depth 25 -Compress) -cne ($script:DnsBefore | ConvertTo-Json -Depth 25 -Compress)){
    if(-not $DnsLibraryOnly -and $DnsNativeMode -ceq 'Run'){$script:DnsLastFailedBaselineObservation=[ordered]@{observedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');current=$current}}
    throw 'Original DNS/DoH registry, API, adapters, proxy, routes, IPv6 bindings or Task definitions were not restored exactly.'
  }
  foreach($relative in @('Service\native-doh-state.json','Service\dns-owned-state.json')){if(Test-Path -LiteralPath (Join-Path $script:DataRoot $relative)){throw 'Protected DNS ownership intent remains after GUI disable.'}}
  [void](Assert-NativeService 'EgoistShieldCore' $script:Core -Running)
  return [ordered]@{originalDnsAndDohRestored=$true;originalStaticDhcpChoiceRestored=$true;unrelatedPreserved=$true;coreRunning=$true}
}
function Assert-DnsElevatedGuiProof {
  param($Proof)
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent();$current=[Diagnostics.Process]::GetCurrentProcess()
  try{
    if($Proof.launchPolicy -cne 'elevated' -or $Proof.elevatedGui -isnot [bool] -or -not $Proof.elevatedGui -or $Proof.guiRequestedExecutionLevel -cne 'asInvoker' -or @($Proof.arguments).Count -ne 0 -or $Proof.executable -ine (Join-Path $script:InstallRoot 'EgoistShield.exe') -or $Proof.source.commit -cne $DnsExpectedSourceCommit){throw 'Dns GUI launch is not the actual source-bound elevated empty-argv process.'}
    foreach($token in @($Proof.token,$Proof.runnerToken)){
      if($token.elevated -isnot [bool] -or -not $token.elevated -or $token.administratorsEnabled -isnot [bool] -or -not $token.administratorsEnabled -or ($token.integrityRid -isnot [int] -and $token.integrityRid -isnot [long]) -or $token.integrityRid -lt 12288 -or $token.uiAccess -isnot [bool] -or $token.uiAccess -or $token.tokenType -ne 1){throw 'Dns GUI requires a measured elevated administrator primary high token.'}
      if($token.userSid -in @('S-1-5-18','S-1-5-19','S-1-5-20') -or $token.userSid -cne $identity.User.Value -or $token.sessionId -ne $current.SessionId){throw 'Dns GUI token does not belong to the actual current Windows user/session.'}
    }
    if($Proof.token.userSid -cne $Proof.runnerToken.userSid -or $Proof.token.sessionId -ne $Proof.runnerToken.sessionId){throw 'Dns GUI token differs from its measured launcher user/session.'}
  }finally{$current.Dispose();$identity.Dispose()}
}
function Invoke-DnsElevatedGui {
  param([ValidateSet('Apply','Reset')][string]$Operation)
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
  $lease=$null;$child=$null;$closed=$false;$operationError=$null;$cleanup=$null;$resetWaitFailed=$false
  if($Operation -eq 'Reset'){$script:DnsLastFailedBaselineObservation=$null}
  try{
    Invoke-DnsGuardianHeartbeat
    $lease=Start-ElevatedGuiLease -CanonicalInstalledGuiPath (Join-Path $script:InstallRoot 'EgoistShield.exe') -IntegrityManifestPath $script:ManifestPath -ExpectedSourceCommit $DnsExpectedSourceCommit -WorkRoot $script:DnsWork -EvidenceDirectory $script:Evidence -LeaseSeconds 420
    $proof=$lease.Receipt
    Assert-DnsElevatedGuiProof $proof
    $child=[Diagnostics.Process]::GetProcessById([int]$proof.processId);$identity=Get-NativeProcessIdentity $child.Id
    if($identity.executable -ine $proof.executable -or [Math]::Abs(($child.StartTime.ToUniversalTime()-[DateTimeOffset]::Parse($proof.startTimeUtc).UtcDateTime).TotalMilliseconds) -gt 20){throw 'DNS elevated GUI process birth identity changed.'}
    $root=[Windows.Automation.AutomationElement]::FromHandle([IntPtr]([long]$proof.mainWindowHandle))
    if(-not $root -or $root.Current.ProcessId -ne $child.Id){throw 'DNS UIA is not bound to the exact elevated GUI HWND.'}
    $find={param([string]$Name,[Windows.Automation.ControlType]$Type)
      Invoke-DnsGuardianHeartbeat
      $condition=[Windows.Automation.AndCondition]::new([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,$Name),[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,$Type))
      $controls=$root.FindAll([Windows.Automation.TreeScope]::Descendants,$condition)
      if($controls.Count -eq 1 -and $controls[0].Current.IsEnabled){return $controls[0]}
    }
    $navigation=Wait-NativeCondition -Condition {
      $nav=& $find 'DNS' ([Windows.Automation.ControlType]::Button)
      if($nav){return [pscustomobject]@{nav=$nav;expand=$null}}
      $settings=& $find 'Настройки' ([Windows.Automation.ControlType]::Button)
      if($settings){return [pscustomobject]@{nav=$null;expand=$settings}}
    } -Label 'Actual DNS dashboard or initial widget Settings' -TimeoutSeconds 90
    if($navigation.expand){([Windows.Automation.InvokePattern]$navigation.expand.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke();$nav=Wait-NativeCondition {& $find 'DNS' ([Windows.Automation.ControlType]::Button)} 'Actual DNS navigation after widget Settings' 60}else{$nav=$navigation.nav}
    ([Windows.Automation.InvokePattern]$nav.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
    if($Operation -eq 'Apply'){
      $field=Wait-NativeCondition {& $find 'Одна DNS-строка' ([Windows.Automation.ControlType]::Edit)} 'Actual native DNS HTTPS field' 60
      ([Windows.Automation.ValuePattern]$field.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)).SetValue([string]$script:DnsProfile.url)
      $button=Wait-NativeCondition {& $find 'Подключить ссылку' ([Windows.Automation.ControlType]::Button)} 'Actual native DNS apply control' 60
      Add-NativeMutation 'elevated-gui-native-doh-apply' $script:DnsProfile.url 'Actual elevated UI forwards a whitelisted operation through protected Core; no production override.'
      ([Windows.Automation.InvokePattern]$button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
      [void](Wait-NativeCondition {Invoke-DnsGuardianHeartbeat;Assert-DnsPrivateOwnedState 'after-real-gui-apply'} 'Actual Windows DNS/DoH policy and private Core intent' 90)
    }else{
      $button=Wait-NativeCondition {& $find 'Отключить DoH' ([Windows.Automation.ControlType]::Button)} 'Actual native DNS disable control' 60
      ([Windows.Automation.InvokePattern]$button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
      $confirm=Wait-NativeCondition {& $find 'Отключить' ([Windows.Automation.ControlType]::Button)} 'Actual DNS disable confirmation' 30
      Add-NativeMutation 'elevated-gui-native-doh-reset' $script:DnsProfile.url 'Actual reopened elevated GUI restores original owned DNS/DoH through Core.'
      ([Windows.Automation.InvokePattern]$confirm.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
      try{[void](Wait-NativeCondition {Invoke-DnsGuardianHeartbeat;Assert-DnsBaselineRestored} 'Actual GUI restored independent original DNS/DoH inventory' 90)}catch{$resetWaitFailed=$true;throw}
    }
    $pattern=$null;if(-not $root.TryGetCurrentPattern([Windows.Automation.WindowPattern]::Pattern,[ref]$pattern)){throw 'DNS GUI native close control is unavailable.'}
    ([Windows.Automation.WindowPattern]$pattern).Close()
    if(-not $child.WaitForExit(30000) -or $child.ExitCode -ne 0){throw 'DNS elevated GUI did not exit normally.'};$closed=$true
    $script:Receipt.gui+=[ordered]@{operation=$Operation;launch=$proof;process=$identity;normalExit=$true;exitCode=$child.ExitCode;automation='actual HWND native UIA ValuePattern/InvokePattern/WindowPattern';productionOverride=$false}
  }catch{
    $operationError=$_
    if($Operation -eq 'Reset' -and $resetWaitFailed -and $script:DnsLastFailedBaselineObservation){
      try{Save-DnsFailedBaselineInventory $script:DnsLastFailedBaselineObservation}catch{$script:Receipt.baselineFailureInventoryError=[ordered]@{class=$_.Exception.GetBaseException().GetType().FullName;hresult=$_.Exception.GetBaseException().HResult}}
    }
  }finally{
    if($lease){try{$cleanup=Stop-ElevatedGuiLease $lease;if(-not $closed -or -not $cleanup.exitedNormally -or $cleanup.exitCode -ne 0){throw 'DNS elevated GUI did not have a normal verified zero-orphan exit.'}}catch{if(-not $operationError){$operationError=$_}}}
    if($child){$child.Dispose()};if($cleanup){$script:Receipt.gui+=[ordered]@{operation=$Operation;cleanup=$cleanup}};Save-NativeReceipt
  }
  if($operationError){throw $operationError}
  Assert-NativeNoGui
}
function Invoke-DnsWindowsProbe {
  if(-not ('LagomNativeDnsQuery' -as [type])){Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Runtime.InteropServices;
public static class LagomNativeDnsQuery {
  [DllImport("dnsapi.dll",EntryPoint="DnsQuery_W",CharSet=CharSet.Unicode,ExactSpelling=true)] private static extern int DnsQuery_W(string name,ushort type,uint options,IntPtr extra,out IntPtr results,IntPtr reserved);
  [DllImport("dnsapi.dll",ExactSpelling=true)] private static extern void DnsRecordListFree(IntPtr records,int freeType);
  public static object Query(string name) {
    IntPtr records=IntPtr.Zero; var watch=Stopwatch.StartNew(); var addresses=new List<string>();
    // BYPASS_CACHE | NO_HOSTS_FILE | NO_MULTICAST: force the real Windows DNS Client.
    int status=DnsQuery_W(name,1,0x848,IntPtr.Zero,out records,IntPtr.Zero);
    try { for(IntPtr p=records;p!=IntPtr.Zero;p=Marshal.ReadIntPtr(p)) {
      if(addresses.Count>64) throw new InvalidOperationException("DNS answer bound");
      if(Marshal.ReadInt16(p,IntPtr.Size*2)==1) { var bytes=new byte[4]; Marshal.Copy(IntPtr.Add(p,IntPtr.Size*2+16),bytes,0,4);addresses.Add(new IPAddress(bytes).ToString()); }
    }} finally { if(records!=IntPtr.Zero) DnsRecordListFree(records,1); }
    return new {name,status,addresses,elapsedMs=watch.Elapsed.TotalMilliseconds,api="DnsQuery_W",options=0x848,cacheBypassed=true,hostsBypassed=true,multicastDisabled=true};
  }
}
'@}
  if(-not $DnsProbeLabel){throw 'Owned random probe identity is required.'}
  $started=[DateTimeOffset]::UtcNow.ToString('o');$names=@('example.com.',('lagom-'+$DnsProbeLabel+'.example.com.'))
  $positive=[LagomNativeDnsQuery]::Query($names[0]);$negative=[LagomNativeDnsQuery]::Query($names[1])
  if($positive.status -ne 0 -or $positive.addresses.Count -lt 1 -or $negative.status -ne 9003){throw 'Real cache-bypassing Windows DNS positive/NXDOMAIN query failed.'}
  return [ordered]@{ok=$true;startedAtUtc=$started;finishedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');names=$names;records=@($positive,$negative);encryptedWireClaim=$false}
}
function Invoke-DnsTransportProbe {
  param([string]$Phase)
  [void](Assert-DnsNativeHost)
  Invoke-DnsGuardianHeartbeat
  $capture=Join-Path $script:DnsWork ($Phase+'.etl');$pcap=Join-Path $script:DnsWork ($Phase+'.pcapng');$started=$false
  try{
    Add-NativeMutation 'owned-bounded-provider-packet-capture' $capture 'Only the approved provider IPs on TCP/UDP53 and443, 256 bytes per packet, one MiB ETL; no runner control/token traffic.'
    [void](Invoke-NativeBounded $script:DnsPktmon @('start','--capture','--comp','nics','--pkt-size','256','--file-size','1','--log-mode','circular','--file-name',$capture) ('pktmon-'+$Phase+'-start') 15);$started=$true
    $label=[Guid]::NewGuid().ToString('N').Substring(0,20)
    $result=Invoke-NativeBounded $script:DnsPowerShell @('-NoLogo','-NoProfile','-NonInteractive','-File',(Join-Path $script:DnsTestsRoot 'windows-dns-native-acceptance.ps1'),'-Mode','QueryProbe','-ExpectedSourceCommit',$DnsExpectedSourceCommit,'-DnsProbeLabel',$label) ('windows-dns-'+$Phase) 25
    $query=$result.stdout | ConvertFrom-Json;Start-Sleep -Milliseconds 500
    [void](Invoke-NativeBounded $script:DnsPktmon @('stop') ('pktmon-'+$Phase+'-stop') 15);$started=$false
    [void](Invoke-NativeBounded $script:DnsPktmon @('etl2pcap',$capture,'--out',$pcap) ('pktmon-'+$Phase+'-convert') 20)
    $output=Join-Path $script:DnsWork ($Phase+'-transport.json');$options=Join-Path $script:DnsWork ($Phase+'-transport-options.json')
    [IO.File]::WriteAllText($options,([ordered]@{sourceCommit=$DnsExpectedSourceCommit;capture=$pcap;output=$output;servers=$script:DnsProfile.servers;names=$query.names;startedAtUtc=$query.startedAtUtc;finishedAtUtc=$query.finishedAtUtc} | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    [void](Invoke-NativeBounded $script:Node @((Join-Path $script:DnsTestsRoot 'windows-dns-native-acceptance.mjs'),'capture',$options) ('transport-'+$Phase) 15)
    $transport=Get-Content -LiteralPath $output -Raw | ConvertFrom-Json
    $script:Receipt.probes+=[ordered]@{phase=$Phase;windowsDnsApi=$query;providerTlsCapture=$transport;packetCaptureSha256=(Get-FileHash -LiteralPath $pcap -Algorithm SHA256).Hash;policyProofSeparate=$true};Save-NativeReceipt
  }finally{if($started){[void](Invoke-NativeBounded $script:DnsPktmon @('stop') ('pktmon-'+$Phase+'-failure-stop') 15)};Invoke-DnsGuardianHeartbeat}
}
function Invoke-DnsGuardianLaunch {
  $script:DnsHeartbeat=Join-Path $script:DnsWork 'guardian-heartbeat.txt';Invoke-DnsGuardianHeartbeat
  $plan=Join-Path $script:DnsWork 'guardian-plan.json';$parent=[Diagnostics.Process]::GetCurrentProcess()
  $options=[ordered]@{schemaVersion=1;sourceCommit=$DnsExpectedSourceCommit;work=$script:DnsWork;parentPid=$PID;parentCreatedUtc=$parent.StartTime.ToUniversalTime().ToString('o');core=$script:Core;coreSha256=$script:CoreHash;before=$script:DnsBefore;adapter=$script:DnsAdapter;profile=$script:DnsProfile;heartbeat=$script:DnsHeartbeat;disarm=(Join-Path $script:DnsWork 'guardian-disarm.txt');force=(Join-Path $script:DnsWork 'guardian-force.txt');receipt=(Join-Path $script:DnsWork 'guardian-receipt.json');timeoutSeconds=180;maximumSeconds=1200}
  [IO.File]::WriteAllText($plan,($options | ConvertTo-Json -Depth 28),[Text.UTF8Encoding]::new($false))
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$script:DnsPowerShell;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  foreach($argument in @('-NoLogo','-NoProfile','-NonInteractive','-File',(Join-Path $script:DnsTestsRoot 'windows-dns-native-acceptance.ps1'),'-Mode','EmergencyGuardian','-ExpectedSourceCommit',$DnsExpectedSourceCommit,'-DnsGuardianPlanPath',$plan,'-DnsGuardianPlanHash',(Get-FileHash -LiteralPath $plan -Algorithm SHA256).Hash.ToLowerInvariant())){$info.ArgumentList.Add($argument)}
  $process=[Diagnostics.Process]::new();$process.StartInfo=$info
  if(-not $process.Start()){throw 'CI DNS emergency guardian did not start.'}
  $guardian=[pscustomobject]@{Process=$process;Output=$process.StandardOutput.ReadToEndAsync();Errors=$process.StandardError.ReadToEndAsync();Plan=$options}
  [void](Wait-NativeCondition {if($process.HasExited){throw 'DNS guardian exited before arming.'};if(Test-Path -LiteralPath $options.receipt){$receipt=Get-Content -LiteralPath $options.receipt -Raw | ConvertFrom-Json;if($receipt.stage -eq 'armed'){return $receipt}}} 'Independent emergency DNS guardian armed before apply' 15)
  return $guardian
}
function Invoke-DnsEmergencyRestore {
  param($Plan)
  [void](Assert-DnsNativeHost)
  $mutations=@();$preserved=@()
  $row=Assert-NativeService 'EgoistShieldCore' ([string]$Plan.core)
  if((Get-FileHash -LiteralPath $Plan.core -Algorithm SHA256).Hash -ine $Plan.coreSha256){throw 'Emergency candidate Core bytes changed.'}
  if([int]$row.scm.ProcessId -gt 0){
    $identity=Get-NativeProcessIdentity ([int]$row.scm.ProcessId);$held=[Diagnostics.Process]::GetProcessById([int]$identity.processId)
    try{
      if($held.Handle -eq [IntPtr]::Zero -or $held.MainModule.FileName -ine $Plan.core -or $identity.executable -ine $Plan.core -or [Math]::Abs(($held.StartTime.ToUniversalTime()-[DateTimeOffset]::Parse($identity.createdUtc).UtcDateTime).TotalMilliseconds) -gt 1){throw 'Emergency Core ownership/birth changed; foreign process preserved.'}
      Stop-Service -Name 'EgoistShieldCore' -ErrorAction Stop
      $mutations+=[ordered]@{kind='normal-owned-core-scm-stop';path=$Plan.core;processId=$held.Id}
    }finally{$held.Dispose()}
  }else{
    # CI failure only. Normal success never stops Core or uses this path.
    Stop-Service -Name 'EgoistShieldCore' -ErrorAction Stop
    $mutations+=[ordered]@{kind='normal-owned-core-scm-stop-already-not-running';path=$Plan.core;processId=0}
  }
  $current=@(Get-NetAdapter -IncludeHidden | Where-Object {[string]$_.InterfaceGuid -ieq [string]$Plan.adapter.guid})
  if($current.Count -ne 1){throw 'Emergency DNS adapter GUID changed; index fallback is forbidden.'}
  $index=[int]$current[0].ifIndex
  foreach($family in @('ipv4','ipv6')){
    $desired=@($Plan.profile.$family);if(-not $desired.Count){continue}
    $actual=@((Get-DnsClientServerAddress -InterfaceIndex $index -AddressFamily $(if($family -eq 'ipv4'){'IPv4'}else{'IPv6'})).ServerAddresses)
    $protocol=if($family -eq 'ipv4'){'Tcpip'}else{'Tcpip6'};$key=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Services\'+$protocol+'\Parameters\Interfaces\'+[string]$Plan.adapter.guid,$false)
    try{$static=$key -and -not [string]::IsNullOrWhiteSpace([string]$key.GetValue('NameServer',''))}finally{if($key){$key.Dispose()}}
    if(-not $static -or -not (Test-DnsSameSequence $actual $desired)){$preserved+=[ordered]@{kind='foreign-or-already-original-adapter';guid=$Plan.adapter.guid;family=$family};continue}
    $baseline=$Plan.adapter.families.$family;$native=Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\netsh.exe'
    $arguments=@('interface',$family,'set','dnsservers',('name='+$index))
    if($baseline.static -and @($baseline.servers).Count){$arguments+=@('source=static',('address='+[string]$baseline.servers[0]),'validate=no')}else{$arguments+=@('source=dhcp','validate=no')}
    & $native @arguments | Out-Null;if($LASTEXITCODE -ne 0){throw 'Emergency owned DNS family restore failed.'}
    if($baseline.static){for($i=1;$i -lt @($baseline.servers).Count;$i++){& $native interface $family add dnsservers ('name='+$index) ('address='+[string]$baseline.servers[$i]) ('index='+($i+1)) validate=no | Out-Null;if($LASTEXITCODE -ne 0){throw 'Emergency owned DNS secondary restore failed.'}}}
    $mutations+=[ordered]@{kind='compare-and-restore-adapter-dns';guid=$Plan.adapter.guid;family=$family;originalStatic=[bool]$baseline.static}
  }
  foreach($server in @($Plan.profile.servers)){
    $entry=@(Get-DnsClientDohServerAddress -ServerAddress $server -ErrorAction SilentlyContinue)
    if($entry.Count -ne 1 -or [string]$entry[0].DohTemplate -cne $Plan.profile.url -or [bool]$entry[0].AllowFallbackToUdp -or -not [bool]$entry[0].AutoUpgrade){$preserved+=[ordered]@{kind='foreign-or-already-original-doh';server=$server};continue}
    $baseline=@($Plan.before.doh | Where-Object {(ConvertTo-DnsIpSequence @($_.serverAddress))[0] -ceq (ConvertTo-DnsIpSequence @($server))[0]})
    if($baseline.Count -gt 1){throw 'Ambiguous original DoH entry.'}
    if($baseline.Count){Set-DnsClientDohServerAddress -ServerAddress $server -DohTemplate $baseline[0].dohTemplate -AllowFallbackToUdp ([bool]$baseline[0].allowFallbackToUdp) -AutoUpgrade ([bool]$baseline[0].autoUpgrade) -ErrorAction Stop | Out-Null}else{Remove-DnsClientDohServerAddress -ServerAddress $server -Confirm:$false -ErrorAction Stop | Out-Null}
    $mutations+=[ordered]@{kind='compare-and-restore-provider-doh';server=$server;originalExisted=($baseline.Count -eq 1)}
  }
  $after=Get-DnsNativeInventory
  $restored=($after | ConvertTo-Json -Depth 25 -Compress) -ceq ($Plan.before | ConvertTo-Json -Depth 25 -Compress)
  return [ordered]@{mutations=$mutations;foreignUpdatesPreserved=$preserved;originalNetworkInventoryRestored=$restored;productionIntentEdited=$false;coreStoppedOnFailure=$true;nativeGatePassed=$false}
}
function Invoke-DnsGuardian {
  [void](Assert-DnsNativeHost)
  $planPath=Assert-NativePathWithin $DnsGuardianPlanPath $script:DnsWork;Assert-NativeOrdinaryPath $planPath -Leaf
  if((Get-Item -LiteralPath $planPath).Length -gt 2097152 -or (Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash -ine $DnsGuardianPlanHash){throw 'DNS guardian plan bytes/size changed.'}
  $plan=Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
  if($plan.schemaVersion -ne 1 -or $plan.sourceCommit -cne $DnsExpectedSourceCommit -or $plan.work -ine $script:DnsWork -or $plan.timeoutSeconds -ne 180 -or $plan.maximumSeconds -ne 1200){throw 'DNS guardian plan identity invalid.'}
  foreach($name in @('heartbeat','disarm','force','receipt')){[void](Assert-NativePathWithin ([string]$plan.$name) $script:DnsWork)}
  $dnsProfile=Get-DnsNativeProvider ([string]$plan.profile.name) (@($plan.profile.ipv6).Count -gt 0)
  if($plan.profile.url -cne $dnsProfile.url -or -not (Test-DnsSameSequence $plan.profile.servers $dnsProfile.servers)){throw 'DNS guardian provider is not the pinned approved profile.'}
  if([string]$plan.adapter.guid -notmatch '^\{?[a-fA-F0-9-]{36}\}?$' -or @($plan.before.adapters | Where-Object {$_.guid -ieq $plan.adapter.guid}).Count -ne 1){throw 'DNS guardian adapter baseline identity is invalid.'}
  foreach($family in @('ipv4','ipv6')){
    $baseline=$plan.adapter.families.$family
    if($baseline.static -isnot [bool] -or @($baseline.servers).Count -gt 8){throw 'DNS guardian family baseline is invalid.'}
    foreach($server in @($baseline.servers)){[void][Net.IPAddress]::Parse([string]$server)}
  }
  $canonical=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'EgoistShield\resources\core-service\win-x64\EgoistShield.Service.exe'
  if($plan.core -ine $canonical -or [string]$plan.coreSha256 -notmatch '^[a-fA-F0-9]{64}$'){throw 'DNS guardian requires exact candidate Core.'}
  [void](Assert-NativeAdministratorOwned $canonical -InstallationPath)
  $record=[ordered]@{schemaVersion=1;kind='ci-emergency-dns-guardian';stage='armed';nativeGatePassed=$false;startedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');mutations=@()}
  [IO.File]::WriteAllText([string]$plan.receipt,($record | ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
  $watch=[Diagnostics.Stopwatch]::StartNew()
  do{
    if(Test-Path -LiteralPath ([string]$plan.disarm)){Assert-NativeOrdinaryPath ([string]$plan.disarm) -Leaf;$record.stage='disarmed';break}
    $alive=$false;try{$parent=[Diagnostics.Process]::GetProcessById([int]$plan.parentPid);$alive=-not $parent.HasExited -and [Math]::Abs(($parent.StartTime.ToUniversalTime()-([DateTimeOffset]$plan.parentCreatedUtc).UtcDateTime).TotalMilliseconds) -lt 20;$parent.Dispose()}catch{$alive=$false}
    $heartbeatObservation=Read-DnsGuardianHeartbeatObservation ([string]$plan.heartbeat) $null ([double]$plan.timeoutSeconds)
    $stale=$heartbeatObservation.status -cne 'fresh'
    if(-not $alive -or $stale -or $watch.Elapsed.TotalSeconds -gt $plan.maximumSeconds -or (Test-Path -LiteralPath ([string]$plan.force))){
      $record.stage='emergency-failed-gate';$record.reason=if(-not $alive){'parent exited/identity changed'}elseif($stale){if($heartbeatObservation.status -ceq 'expired'){'heartbeat expired'}else{'heartbeat unavailable'}}elseif($watch.Elapsed.TotalSeconds -gt $plan.maximumSeconds){'maximum lease expired'}else{'caller failure'}
      $record.heartbeatObservation=$heartbeatObservation
      try{$record.restore=Invoke-DnsEmergencyRestore $plan}catch{$record.restoreError=$_.Exception.Message};break
    }
    Start-Sleep -Milliseconds 500
  }while($true)
  $record.finishedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
  [IO.File]::WriteAllText([string]$plan.receipt,($record | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
  if($record.stage -ne 'disarmed'){throw 'Emergency DNS guardian was invoked; native acceptance failed.'}
}
function Invoke-DnsNativeAcceptance {
  [void](Assert-DnsNativeHost)
  if(-not $DnsIntegrityManifestPath){throw 'Source-bound candidate integrity manifest is required.'}
  $script:ManifestPath=Assert-NativePathWithin $DnsIntegrityManifestPath $env:GITHUB_WORKSPACE;Assert-NativeOrdinaryPath $script:ManifestPath -Leaf
  if((Get-Item -LiteralPath $script:ManifestPath).Length -gt 16777216){throw 'Candidate integrity manifest bound exceeded.'}
  $manifest=Get-Content -LiteralPath $script:ManifestPath -Raw | ConvertFrom-Json
  if($manifest.product -cne 'Egoist Lagom' -or $manifest.source.commit -cne $DnsExpectedSourceCommit -or [string]$manifest.version -notmatch '^3\.[8-9]\.[0-9]+$'){throw 'DNS candidate identity/version differs from current source.'}
  $script:InstallRoot=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'EgoistShield';$script:DataRoot=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'EgoistShield'
  $script:Core=Join-Path $script:InstallRoot 'resources\core-service\win-x64\EgoistShield.Service.exe'
  $coreEntries=@($manifest.payload | Where-Object {$_.path -ceq 'resources/core-service/win-x64/EgoistShield.Service.exe'})
  if($coreEntries.Count -ne 1){throw 'Candidate manifest does not identify exactly one Core.'};$script:CoreHash=[string]$coreEntries[0].sha256
  foreach($target in @($script:InstallRoot,$script:Core,(Join-Path $script:InstallRoot 'EgoistShield.exe'),(Join-Path $script:InstallRoot 'EgoistShield.Worker.exe'))){[void](Assert-NativeAdministratorOwned $target -InstallationPath)}
  Assert-DnsNoForeignState
  if(Test-Path -LiteralPath $script:DnsWork){throw 'DNS acceptance work already exists; prior evidence must be inspected.'}
  if(Test-Path -LiteralPath $script:DnsBaseWork){Assert-NativeOrdinaryPath $script:DnsBaseWork}
  $script:Evidence=if($DnsEvidenceDirectory){Assert-NativePathWithin $DnsEvidenceDirectory $script:DnsWork}else{Join-Path $script:DnsWork 'evidence'}
  $script:DnsBefore=Get-DnsNativeInventory;$script:DnsAdapter=Get-DnsSafeAdapter $script:DnsBefore
  $ipv6=@(Get-NetRoute -DestinationPrefix '::/0' -PolicyStore ActiveStore -ErrorAction SilentlyContinue | Where-Object {$_.InterfaceIndex -eq $script:DnsAdapter.index}).Count -gt 0
  if($ipv6){Assert-DnsNativeApiPresence $script:DnsAdapter.families.ipv6 $script:DnsAdapter.families.ipv6 $true}
  $script:DnsProfile=Get-DnsNativeProvider $Provider $ipv6
  $allowed=ConvertTo-DnsIpSequence $script:DnsProfile.servers
  foreach($entry in @($script:DnsBefore.doh | Where-Object {(ConvertTo-DnsIpSequence @($_.serverAddress))[0] -in $allowed})){if($entry.dohTemplate -cne $script:DnsProfile.url){throw 'Selected provider address already has a foreign DoH template.'}}
  $beforeControl=Assert-DnsControlProbe 'before-any-network-mutation'
  [void][IO.Directory]::CreateDirectory($script:DnsWork);[void][IO.Directory]::CreateDirectory($script:Evidence)
  $script:Work=$script:DnsWork;$script:SourceCommit=$DnsExpectedSourceCommit;$script:ReceiptPath=Join-Path $script:Evidence 'windows-dns-native-acceptance.json'
  $script:DnsHeartbeat=$null;$script:Node=Resolve-NativeApplication 'node';$script:DnsPowerShell=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName;$script:DnsPktmon=Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\pktmon.exe'
  $script:Receipt=[ordered]@{schemaVersion=1;kind='actual-native-elevated-gui-windows-doh';gate='System DNS from elevated GUI, persistence and restoration';sourceCommit=$DnsExpectedSourceCommit;candidateVersion=$manifest.version;integritySha256=(Get-FileHash -LiteralPath $script:ManifestPath -Algorithm SHA256).Hash;result='running';releaseReady=$false;startedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');provider=$script:DnsProfile;before=$script:DnsBefore;controlProbes=@($beforeControl);mutations=@();gui=@();probes=@();privateStateReadbacks=@();checks=@();guardian=$null;sourceHashes=@();releaseGates=@('Actual reboot/network-adapter detach or DHCP renewal','Custom-hostname bootstrap rotation','Windows10 local SystemDoH service/driver mode','Long-duration 72-hour/7-day/month pilot')}
  foreach($name in @('windows-dns-native-acceptance.ps1','windows-dns-native-acceptance.mjs','windows-production-acceptance.ps1','windows-production-acceptance.mjs','windows-ordinary-gui.ps1','windows-ordinary-gui.cs')){$script:Receipt.sourceHashes+=[ordered]@{file=('tests/'+$name);sha256=(Get-FileHash -LiteralPath (Join-Path $script:DnsTestsRoot $name) -Algorithm SHA256).Hash}}
  Save-NativeReceipt;$guardian=$null;$filters=@();$failure=$null;$restored=$false
  try{
    $payloadOptions=Join-Path $script:DnsWork 'installed-payload-options.json'
    [IO.File]::WriteAllText($payloadOptions,([ordered]@{installRoot=$script:InstallRoot;integrity=$script:ManifestPath;sourceCommit=$DnsExpectedSourceCommit;version=$manifest.version;output=(Join-Path $script:DnsWork 'installed-payload.json')} | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    [void](Invoke-NativeBounded $script:Node @((Join-Path $script:DnsTestsRoot 'windows-production-acceptance.mjs'),'verify-payload',$payloadOptions) 'verify-entire-installed-candidate' 120)
    $script:Receipt.elevation=Assert-NativeGuiElevation
    $preflightOptions=Join-Path $script:DnsWork 'provider-preflight-options.json'
    [IO.File]::WriteAllText($preflightOptions,([ordered]@{sourceCommit=$DnsExpectedSourceCommit;provider=$Provider;ipv6=$ipv6;output=(Join-Path $script:DnsWork 'provider-preflight.json')} | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    [void](Invoke-NativeBounded $script:Node @((Join-Path $script:DnsTestsRoot 'windows-dns-native-acceptance.mjs'),'preflight',$preflightOptions) 'provider-independent-tls-dns-preflight' 40)
    $script:Receipt.preflight=Get-Content -LiteralPath (Join-Path $script:DnsWork 'provider-preflight.json') -Raw | ConvertFrom-Json
    $status=Invoke-NativeBounded $script:DnsPktmon @('status') 'pktmon-original-status' 15
    $list=Invoke-NativeBounded $script:DnsPktmon @('filter','list') 'pktmon-original-filters' 15
    if($status.stdout -notmatch '(?i)not running|not started|stopped' -or $list.stdout -notmatch '(?i)no filters|none'){throw 'Packet Monitor is in use or its English empty-state contract is unknown; no capture or DNS change is allowed.'}
    foreach($server in $script:DnsProfile.servers){foreach($port in @(53,443)){
      $name='LagomDns-'+[Guid]::NewGuid().ToString('N').Substring(0,10)
      [void](Invoke-NativeBounded $script:DnsPktmon @('filter','add',$name,'-i',$server,'-p',[string]$port) ('pktmon-filter-add-'+$name) 15);$filters+=$name
      Add-NativeMutation 'owned-provider-packet-filter' $name ($server+':'+$port+'; exact named filter only')
    }}
    $guardian=Invoke-DnsGuardianLaunch
    Invoke-DnsElevatedGui 'Apply'
    [void](Assert-DnsPrivateOwnedState 'actual-gui-closed');Invoke-DnsTransportProbe 'without-gui'
    $script:Receipt.controlProbes+=Assert-DnsControlProbe 'with-doh-without-gui';Invoke-DnsGuardianHeartbeat
    Stop-NativeVerifiedCoreForRecovery
    [void](Assert-DnsPrivateOwnedState 'after-exact-owned-core-crash-new-pid');Invoke-DnsTransportProbe 'after-core-recovery'
    $script:Receipt.controlProbes+=Assert-DnsControlProbe 'after-core-recovery-without-gui'
    Invoke-DnsElevatedGui 'Reset';$script:Receipt.restoration=Assert-DnsBaselineRestored;$restored=$true
    $script:Receipt.controlProbes+=Assert-DnsControlProbe 'after-real-gui-baseline-restore'
    $script:Receipt.checks+=@('source-bound-full-installed-payload','actual-elevated-high-gui-empty-argv','native-api-per-adapter-no-udp-fallback','private-core-intent-baseline','actual-forced-windows-dns-plus-provider-tls','dns-survives-normal-gui-close','new-core-pid-dns-policy-and-query-preserved','real-reopened-gui-restores-original-dns-doh-and-unrelated-state')
    $script:Receipt.result='passed'
  }catch{$failure=$_;$script:Receipt.result='failed';$script:Receipt.failure=$_.Exception.Message}
  finally{
    if($guardian){
      if(-not $restored){try{[void](Assert-DnsBaselineRestored);$restored=$true;$script:Receipt.failureCleanup='independent baseline was already unchanged'}catch{
        try{Invoke-DnsElevatedGui 'Reset';[void](Assert-DnsBaselineRestored);$restored=$true}catch{$script:Receipt.guiFailureCleanupError=$_.Exception.Message}
      }}
      if($restored){[IO.File]::WriteAllText([string]$guardian.Plan.disarm,'restored through actual elevated GUI and independent readback',[Text.UTF8Encoding]::new($false))}else{[IO.File]::WriteAllText([string]$guardian.Plan.force,'acceptance failed; compare-and-restore only',[Text.UTF8Encoding]::new($false))}
      if(-not $guardian.Process.WaitForExit(45000)){$script:Receipt.guardianTimeout=$true;$script:Receipt.result='failed';if(-not $failure){$failure=[Exception]::new('Emergency guardian cleanup timed out; runner must be retired.')}}
      if($guardian.Process.HasExited){[IO.File]::WriteAllText((Join-Path $script:DnsWork 'guardian.stdout.txt'),$guardian.Output.GetAwaiter().GetResult(),[Text.UTF8Encoding]::new($false));[IO.File]::WriteAllText((Join-Path $script:DnsWork 'guardian.stderr.txt'),$guardian.Errors.GetAwaiter().GetResult(),[Text.UTF8Encoding]::new($false))}
      if(Test-Path -LiteralPath ([string]$guardian.Plan.receipt)){$script:Receipt.guardian=Get-Content -LiteralPath ([string]$guardian.Plan.receipt) -Raw | ConvertFrom-Json}
      if(-not $guardian.Process.HasExited -or $guardian.Process.ExitCode -ne 0 -or -not $script:Receipt.guardian -or $script:Receipt.guardian.stage -ne 'disarmed'){$script:Receipt.result='failed';if(-not $failure){$failure=[Exception]::new('CI emergency guardian was used or cleanup is unknown; no native PASS.')}}
      $guardian.Process.Dispose()
    }
    foreach($name in $filters){try{[void](Invoke-NativeBounded $script:DnsPktmon @('filter','remove',$name) ('pktmon-filter-remove-'+$name) 15)}catch{$script:Receipt.result='failed';$script:Receipt.captureCleanupError=$_.Exception.Message;if(-not $failure){$failure=$_}}}
    $script:Receipt.finishedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');Save-NativeReceipt
  }
  if($failure){throw $failure}
  if($script:Receipt.result -ne 'passed'){throw 'Native DNS acceptance did not pass.'}
  Write-Output ('Native DNS acceptance passed; remaining release gates are explicit. Evidence: '+$script:ReceiptPath)
}

if($DnsLibraryOnly){return}
[void](Assert-DnsNativeHost)
switch($DnsNativeMode){
  'GuardOnly' {Write-Output 'DNS native host guard passed; no write or network mutation performed.';return}
  'QueryProbe' {Invoke-DnsWindowsProbe | ConvertTo-Json -Depth 8;return}
  'EmergencyGuardian' {Invoke-DnsGuardian;return}
  default {Invoke-DnsNativeAcceptance}
}
