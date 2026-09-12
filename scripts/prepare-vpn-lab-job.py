"""Queue a real VPN test using only the selected saved node, without printing credentials."""
import base64
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
saved=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
node=next(n for n in saved['nodes'] if n['id']==saved['activeNodeId'])
node={**node,'name':'Lab upstream'}
fixture=base64.b64encode(json.dumps(node).encode()).decode()
diagnostic='--diagnostic' in sys.argv
bundle=base64.b64encode((ROOT/('recovery/vpn-lab/vpn-lab-diagnostic.cjs' if diagnostic else 'recovery/vpn-lab/vpn-lab.cjs')).read_bytes()).decode()
script=r'''$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable Shield guest required'}
$key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$before=Get-ItemProperty $key | Select-Object ProxyEnable,ProxyServer,ProxyOverride,AutoConfigURL
[IO.File]::WriteAllBytes('C:\ShieldLab\vpn-lab.cjs',[Convert]::FromBase64String('__BUNDLE__'))
[IO.File]::WriteAllBytes('C:\ShieldLab\vpn-node.json',[Convert]::FromBase64String('__FIXTURE__'))
$env:ELECTRON_RUN_AS_NODE='1'
$env:NODE_ENV='production'
try {
  $process=Start-Process 'C:\Program Files\EgoistShield\EgoistShield.exe' -ArgumentList 'C:\ShieldLab\vpn-lab.cjs' -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput 'C:\ShieldLab\vpn-stdout.txt' -RedirectStandardError 'C:\ShieldLab\vpn-stderr.txt'
  Get-Content 'C:\ShieldLab\vpn-stdout.txt' -Encoding UTF8
  $after=Get-ItemProperty $key | Select-Object ProxyEnable,ProxyServer,ProxyOverride,AutoConfigURL
  if(($before|ConvertTo-Json -Compress) -ne ($after|ConvertTo-Json -Compress)){throw 'VPN disconnect did not restore the original system proxy'}
  if($process.ExitCode -ne 0){throw 'Real VPN integration failed; private guest stderr contains diagnostic details'}
  Write-Output 'PASS: real VPN handler connection, external route, diagnosis, disconnect and proxy restoration'
} finally {Remove-Item Env:\ELECTRON_RUN_AS_NODE}
'''.replace('__BUNDLE__',bundle).replace('__FIXTURE__',fixture)
job_name=sys.argv[2] if len(sys.argv)>2 else '06-vpn-live'
if not job_name.replace('-','').isalnum():raise ValueError('Invalid lab job name')
for lab in ['vm','vm-win10']:
    output=ROOT/'recovery'/lab/('final-held' if '--hold' in sys.argv else 'jobs')
    output.mkdir(exist_ok=True)
    (output/(job_name+'.ps1')).write_text(script,encoding='utf-8-sig')
print(json.dumps({'held' if '--hold' in sys.argv else 'queued':2,'selectedProtocol':node['protocol'],'diagnostic':diagnostic,'bundleBytes':len(bundle)*3//4}))
