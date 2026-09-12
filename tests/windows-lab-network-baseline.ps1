$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable guest required'}
$adapter=@(Get-NetAdapter -Physical | Where-Object Status -eq 'Up')
if($adapter.Count -ne 1){throw 'Expected exactly one physical disposable guest adapter'}
$path='C:\ShieldLab\original-lab-dns.json'
if(-not (Test-Path $path)){Get-DnsClientServerAddress -InterfaceIndex $adapter[0].ifIndex | Select-Object InterfaceIndex,AddressFamily,ServerAddresses | ConvertTo-Json -Depth 4 | Set-Content $path -Encoding UTF8}
Get-DnsClientServerAddress -InterfaceIndex $adapter[0].ifIndex | Select-Object InterfaceIndex,AddressFamily,ServerAddresses | ConvertTo-Json -Depth 4 -Compress
Set-DnsClientServerAddress -InterfaceIndex $adapter[0].ifIndex -ServerAddresses @('1.1.1.1','8.8.8.8')
Clear-DnsClientCache
$result=Resolve-DnsName example.com -Type A -DnsOnly -ErrorAction Stop
Write-Output ('LAB_NETWORK_BASELINE: DNS resolves count='+@($result | Where-Object Type -eq A).Count)
