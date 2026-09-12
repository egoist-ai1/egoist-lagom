$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable guest required'}
Get-NetAdapter -IncludeHidden | Select-Object Name,InterfaceDescription,InterfaceGuid,ifIndex,Status | ConvertTo-Json -Depth 3 -Compress
Get-PnpDevice -Class Net | Select-Object FriendlyName,InstanceId,Status,Problem | ConvertTo-Json -Depth 3 -Compress
$setup='C:\Windows\INF\setupapi.dev.log'
if(Test-Path -LiteralPath $setup){
  $matches=Select-String -LiteralPath $setup -Pattern 'wintun|egoist-tun|Xray' -Context 3,8 | Select-Object -Last 8
  foreach($match in $matches){Write-Output (($match.Context.PreContext + $match.Line + $match.Context.PostContext) -join "`n")}
}
