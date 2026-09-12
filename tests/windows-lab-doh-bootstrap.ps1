$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable guest required'}
$cfg=Get-Content 'C:\ProgramData\EgoistShield\Runtime\SystemDoH\config.json' -Raw | ConvertFrom-Json
$cfg.log.error='C:\ShieldLab\doh-fixed.log'
$cfg.inbounds[0].port=15353
$cfg.dns | Add-Member -NotePropertyName tag -NotePropertyValue 'doh-upstream' -Force
$cfg.dns.servers[-1]=$cfg.dns.servers[-1].Replace('https+local://','https://')
$cfg.outbounds[1] | Add-Member -NotePropertyName settings -NotePropertyValue @{domainStrategy='ForceIPv4'} -Force
$cfg.routing.rules=@(@{type='field';inboundTag=@('doh-upstream');outboundTag='direct'})+$cfg.routing.rules
[IO.File]::WriteAllText('C:\ShieldLab\doh-fixed.json',($cfg | ConvertTo-Json -Depth 30))
$runtime='C:\ProgramData\EgoistShield\Runtime\SystemDoH\runtime\xray-system-doh.exe'
$process=Start-Process $runtime -ArgumentList 'run -c C:\ShieldLab\doh-fixed.json' -PassThru -WindowStyle Hidden -RedirectStandardOutput 'C:\ShieldLab\doh-fixed-out.txt' -RedirectStandardError 'C:\ShieldLab\doh-fixed-err.txt'
try{
  Start-Sleep -Seconds 12
  $js=@'
const {Resolver}=require('node:dns').promises;
const r=new Resolver({timeout:15000,tries:2});r.setServers(['127.0.0.1:15353']);
Promise.all(['example.com','api.openai.com'].map(async name=>({name,count:(await r.resolve4(name)).length}))).then(rows=>{console.log(JSON.stringify(rows));process.exit(rows.every(row=>row.count>0)?0:1)}).catch(error=>{console.log(error.code);process.exit(1)});
'@
  [IO.File]::WriteAllText('C:\ShieldLab\doh-query.cjs',$js)
  $env:ELECTRON_RUN_AS_NODE='1'
  $query=Start-Process 'C:\Program Files\EgoistShield\EgoistShield.exe' -ArgumentList 'C:\ShieldLab\doh-query.cjs' -Wait -PassThru -RedirectStandardOutput 'C:\ShieldLab\doh-query-out.txt' -RedirectStandardError 'C:\ShieldLab\doh-query-err.txt'
  [IO.File]::ReadAllText('C:\ShieldLab\doh-query-out.txt')
  if($query.ExitCode -ne 0){Get-Content 'C:\ShieldLab\doh-fixed.log' -Tail 25;throw 'DoH bootstrap runtime probe failed'}
  Write-Output 'PASS actual Xray resolves through bootstrap addresses with TLS verification'
}finally{
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  if(-not $process.HasExited){$process.Kill();$process.WaitForExit()}
}
