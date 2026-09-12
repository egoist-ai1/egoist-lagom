"""Read-only payload media avoids slow emulated-network downloads in the guest."""
import hashlib
import io
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/python-libs'))
import pycdlib
version=json.loads((ROOT/'package.json').read_text(encoding='utf-8-sig'))['version']
setup=ROOT/f'dist/EgoistShield-Setup-{version}.exe'
if not setup.is_file():
    raise FileNotFoundError(f'Build the exact package version first: {setup}')
digest=hashlib.sha256(setup.read_bytes()).hexdigest()
for labname,source in [('vm','windows-lab-4.iso'),('vm-win10','windows10-lab.iso')]:
    lab=ROOT/'recovery'/labname
    original=pycdlib.PyCdlib();original.open(str(lab/source))
    bootstrap=io.BytesIO()
    original.get_file_from_iso_fp(bootstrap,udf_path='/lab-bootstrap.ps1')
    original.close()
    iso=pycdlib.PyCdlib();iso.new(interchange_level=4,udf='2.60',vol_ident='SHIELDTEST')
    iso.add_file(str(setup),iso_path='/SHIELDSETUP.EXE;1',udf_path='/ShieldSetup.exe')
    iso.add_file(str(ROOT/'tests/windows-lab-monitor.ps1'),iso_path='/LABMONITOR.PS1;1',udf_path='/lab-monitor.ps1')
    iso.add_file(str(ROOT/'tests/windows-lab-install-probe.ps1'),iso_path='/PROBE.PS1;1',udf_path='/probe.ps1')
    runner=bootstrap.getvalue().decode('utf-8-sig')
    runner=runner.replace('output=(Get-Content $logPath -Raw)', 'output=[IO.File]::ReadAllText($logPath)').replace('ConvertTo-Json -Depth 8 -Compress','ConvertTo-Json -Depth 3 -Compress')
    runner=runner.replace("$ErrorActionPreference = 'Continue'", "$ErrorActionPreference = 'Continue'\n$ProgressPreference = 'SilentlyContinue'")
    runner=runner.replace('  } catch { }', '  } catch { Write-Host $_.Exception.Message }')
    runner=runner.replace('      & powershell.exe', '      Write-Host ("Running " + $job.id)\n      & powershell.exe')
    runner=runner.replace('      $result =', '      Write-Host ("Finished " + $job.id + " code=" + $LASTEXITCODE)\n      $result =')
    runner=runner.replace('while ($true) {', '''foreach($old in Get-ChildItem C:\\ShieldLab -Filter *.log -File){
  try {
    $recovered=@{id=('recovered-'+$old.BaseName);exitCode=$null;output=[IO.File]::ReadAllText($old.FullName);recovered=$true} | ConvertTo-Json -Depth 3 -Compress
    Invoke-RestMethod "$base/result" -Method Post -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($recovered)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 30 | Out-Null
  } catch { Write-Host $_.Exception.Message }
}
while ($true) {''')
    for name,data in [('lab-bootstrap.ps1',b'\xef\xbb\xbf'+runner.encode()),('SHA256.txt',digest.encode()),('VERSION.txt',version.encode())]:
        iso.add_fp(io.BytesIO(data),len(data),iso_path='/'+name.upper()+';1',udf_path='/'+name)
    iso.write(str(lab/(sys.argv[1] if len(sys.argv)>1 else 'shield-payload.iso')));iso.close()
print(json.dumps({'sha256':digest,'bytes':setup.stat().st_size}))
