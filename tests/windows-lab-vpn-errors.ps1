$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable guest required'}
$files=@(Get-ChildItem 'C:\ShieldLab\vpn-data' -Recurse -File | Where-Object Extension -In '.log','.txt')
$files+=@(Get-Item 'C:\ShieldLab\vpn-stderr.txt' -ErrorAction SilentlyContinue)
foreach($file in $files){
  $lines=@([IO.File]::ReadAllLines($file.FullName) | Where-Object {$_ -match 'error|fail|timeout|timed out|unreachable|refused|DNS|egress|probe|listen|route|tun' } | Select-Object -Last 45)
  $body=$lines -join "`n"
  $body=[regex]::Replace($body,'(?i)\b[a-z][a-z0-9+.-]*://[^\s"<>]+','[URI]')
  $body=[regex]::Replace($body,'(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b','[UUID]')
  $body=[regex]::Replace($body,'\b(?:\d{1,3}\.){3}\d{1,3}\b','[IP]')
  $body=[regex]::Replace($body,'(?i)\b[a-z0-9_=-]{32,}\b','[TOKEN]')
  $body=[regex]::Replace($body,'(?i)\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b','[HOST]')
  if($body.Length -gt 18000){$body=$body.Substring($body.Length-18000)}
  [pscustomobject]@{file=$file.Name;errors=$body} | ConvertTo-Json -Compress
}
