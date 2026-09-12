"""Prepare held guest acceptance jobs pinned to the exact packaged payload."""
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
revision = sys.argv[1]
if not re.fullmatch(r'v[0-9]+', revision):
    raise ValueError('Expected an internal candidate ID such as v10')
version = json.loads((ROOT / 'package.json').read_text())['version']
payload = ROOT / 'out' / f'EgoistShield-{version}-win-x64'
files = ['resources/app.asar', 'resources/component-worker.cjs',
         'resources/core-service/win-x64/EgoistShield.Service.exe']
guard = "$ErrorActionPreference='Stop'\n"
guard += "if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable Shield guest required'}\n"
for name in files:
    digest = hashlib.sha256((payload / name).read_bytes()).hexdigest()
    target = 'C:/Program Files/EgoistShield/' + name
    guard += f"if((Get-FileHash -LiteralPath '{target}' -Algorithm SHA256).Hash.ToLowerInvariant() -ne '{digest}'){{throw 'Installed payload differs from {revision}: {name}'}}\n"
guard += f"Write-Output 'PASS: installed payload matches {revision} acceptance hashes'\n"

for lab in ['vm', 'vm-win10']:
    held = ROOT / 'recovery' / lab / 'final-held'
    held.mkdir(exist_ok=True)
    fixture = r'''$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable Shield guest required'}
$bootstrap=[IO.File]::ReadAllText('C:\Windows\Temp\lab-bootstrap.ps1')
$base=[regex]::Match($bootstrap,'http://10\.0\.2\.2:[0-9]+').Value
$token=[regex]::Match($bootstrap,"X-Lab-Token' = '([a-f0-9]+)'").Groups[1].Value
# The controller sends an RFC HTTP Date even for its read-only 404 response.
$clockRequest=[Net.HttpWebRequest]::Create($base+'/clock')
$clockRequest.Proxy=$null
$clockRequest.Timeout=20000
$clockRequest.Headers.Add('X-Lab-Token',$token)
try {$clockResponse=$clockRequest.GetResponse()} catch [Net.WebException] {$clockResponse=$_.Exception.Response}
if(-not $clockResponse){throw 'Lab clock response unavailable'}
try {$hostUtc=[DateTimeOffset]::Parse($clockResponse.Headers['Date']).UtcDateTime} finally {$clockResponse.Dispose()}
Set-TimeZone -Id 'UTC'
Set-Date -Date $hostUtc | Out-Null
Write-Output 'PASS: disposable guest clock synchronized for signed release metadata checks'
$key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
Get-ItemProperty $key | Select-Object ProxyEnable,ProxyServer,ProxyOverride,AutoConfigURL | ConvertTo-Json | Set-Content C:\ShieldLab\proxy-before-final-fixture.json
[IO.File]::WriteAllText('C:\ShieldLab\test-direct.pac','function FindProxyForURL(url, host) { return "DIRECT"; }')
New-ItemProperty $key -Name ProxyEnable -PropertyType DWord -Value 0 -Force | Out-Null
New-ItemProperty $key -Name ProxyServer -PropertyType String -Value 'lab.invalid:3128' -Force | Out-Null
New-ItemProperty $key -Name ProxyOverride -PropertyType String -Value '<local>;lab.invalid' -Force | Out-Null
New-ItemProperty $key -Name AutoConfigURL -PropertyType String -Value 'file:///C:/ShieldLab/test-direct.pac' -Force | Out-Null
Write-Output 'PASS: disposable guest seeded with a disabled foreign proxy and local DIRECT PAC for restoration tests'
'''
    (held / f'39-fixture-{revision}.ps1').write_text(fixture, encoding='utf-8-sig')
    install = (ROOT / 'tests/windows-lab-install.ps1').read_text(encoding='utf-8-sig')
    # Verify bytes immediately after installation, before exercising Core.
    install = install.replace('$core = Get-Service EgoistShieldCore', guard + '\n$core = Get-Service EgoistShieldCore')
    (held / f'40-install-{revision}.ps1').write_text(install, encoding='utf-8-sig')
    verify_fixture = r'''$key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$values=Get-ItemProperty $key
if($values.ProxyEnable -ne 0 -or $values.ProxyServer -ne 'lab.invalid:3128' -or $values.ProxyOverride -ne '<local>;lab.invalid' -or $values.AutoConfigURL -ne 'file:///C:/ShieldLab/test-direct.pac'){throw 'Installation changed the foreign proxy or local PAC fixture'}
Write-Output 'PASS: installed candidate preserved the disabled foreign proxy and local PAC'
'''
    (held / f'40a-proxy-fixture-{revision}.ps1').write_text(guard + verify_fixture, encoding='utf-8-sig')
    ui = (ROOT / 'tests/windows-lab-startup.ps1').read_text(encoding='utf-8-sig')
    (held / f'41-ui-{revision}.ps1').write_text(guard + ui, encoding='utf-8-sig')
    components = (ROOT / 'tests/windows-lab-components.ps1').read_text(encoding='utf-8-sig')
    components = components.replace('param([switch]$DnsOnly,[switch]$TelegramOnly)', "$DnsOnly=$true\n$TelegramOnly=$false")
    (held / f'41b-doh-{revision}.ps1').write_text(guard + components, encoding='utf-8-sig')
    for number, kind in [(45, 'tcp'), (46, 'xhttp')]:
        job = held / f'{number}-controlled-{kind}-{revision}.ps1'
        script = job.read_text(encoding='utf-8-sig')
        job.write_text(guard + script, encoding='utf-8-sig')
print(json.dumps({'heldJobs': 14, 'candidate': revision, 'version': version, 'pinnedFiles': files}))
