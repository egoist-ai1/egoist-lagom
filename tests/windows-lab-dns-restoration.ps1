$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable guest required'}
foreach($name in 'dns-roundtrip.json','component-progress.json'){
  $file=Join-Path 'C:\ShieldLab' $name
  if(Test-Path $file){Write-Output ($name+'='+[IO.File]::ReadAllText($file))}
}
Get-DnsClientServerAddress | Select-Object InterfaceIndex,AddressFamily,ServerAddresses | ConvertTo-Json -Depth 5
