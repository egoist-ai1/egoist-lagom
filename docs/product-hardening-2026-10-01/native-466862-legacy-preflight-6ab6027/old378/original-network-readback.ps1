$ErrorActionPreference='Stop'
$rows=@()
$adapters=@(Get-NetAdapter -ErrorAction Stop | Where-Object {
  $identity=([string]$_.Name+' '+[string]$_.InterfaceDescription)
  $_.Status -eq 'Up' -and $identity -notmatch 'WireGuard|Wintun|Cloudflare\s+WARP|VPN|Loopback|isatap|Teredo|Pseudo|Npcap|Bluetooth|(^|[\s_-])(TAP|TUN)([\s_-]|$)|egoist-tun'
} | Sort-Object ifIndex -Unique)
if($adapters.Count -gt 16){throw 'Original DNS diagnostic adapter count exceeded its bound.'}
foreach($adapter in $adapters){
  foreach($family in @('IPv4','IPv6')){
    $watch=[Diagnostics.Stopwatch]::StartNew()
    $row=[ordered]@{index=$adapter.ifIndex;guid=[string]$adapter.InterfaceGuid;name=[string]$adapter.Name;status=[string]$adapter.Status;family=$family;result='running'}
    try{
      $values=@(Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -AddressFamily $family -ErrorAction Stop)
      $row.result='complete';$row.records=$values.Count;$row.addresses=@($values|Select-Object -ExpandProperty ServerAddresses)
    }catch{$row.result='failed';$row.error=$_.Exception.Message;$row.errorId=$_.FullyQualifiedErrorId;$row.hresult=$_.Exception.HResult}
    $row.elapsedMilliseconds=$watch.Elapsed.TotalMilliseconds;$rows+=$row
  }
}
@{kind='read-only-legacy-dns-query-diagnostic';powerShell=$PSVersionTable.PSVersion.ToString();queries=$rows;networkMutations=0}|ConvertTo-Json -Depth 8