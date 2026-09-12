"""Build a private unattended lab ISO from the user's read-only Windows media."""
import io
import json
import secrets
import sys
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools' / 'python-libs'))
import pycdlib

source = Path(sys.argv[1])
lab = ROOT / 'recovery' / 'vm'
lab.mkdir(parents=True, exist_ok=True)
password = secrets.token_hex(16) + '!aA1'
config_path = lab / 'lab.json'
config = json.loads(config_path.read_text()) if config_path.exists() else {'token': secrets.token_hex(32), 'port': 18080}
config['password'] = password
config_path.write_text(json.dumps(config), encoding='utf-8')

bootstrap = r'''$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$headers = @{ 'X-Lab-Token' = '__TOKEN__' }
$base = 'http://10.0.2.2:18080'
$os = Get-CimInstance Win32_OperatingSystem
$identity = @{ caption=$os.Caption; version=$os.Version; build=$os.BuildNumber; admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } | ConvertTo-Json -Compress
Invoke-RestMethod "$base/ready" -Method Post -Headers $headers -Body $identity -ContentType 'application/json' | Out-Null
New-Item -ItemType Directory -Path C:\ShieldLab -Force | Out-Null
while ($true) {
  try {
    $job = Invoke-RestMethod "$base/job" -Headers $headers
    if ($job.id -match '^[a-zA-Z0-9_-]+$') {
      $scriptPath = "C:\ShieldLab\$($job.id).ps1"
      [IO.File]::WriteAllText($scriptPath, [string]$job.script, (New-Object Text.UTF8Encoding($true)))
      $logPath = "C:\ShieldLab\$($job.id).log"
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath *> $logPath
      $result = @{ id=[string]$job.id; exitCode=$LASTEXITCODE; output=[IO.File]::ReadAllText($logPath) } | ConvertTo-Json -Depth 3 -Compress
      Invoke-RestMethod "$base/result" -Method Post -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($result)) -ContentType 'application/json; charset=utf-8' | Out-Null
    }
  } catch { }
  Start-Sleep -Seconds 3
}
'''.replace('__TOKEN__', config['token'])
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command \"$d=(Get-Volume | Where-Object FileSystemLabel -eq 'EGOISTLAB' | Select-Object -First 1).DriveLetter; Copy-Item ($d+':\\lab-bootstrap.ps1') 'C:\\Windows\\Temp\\lab-bootstrap.ps1'; & 'C:\\Windows\\Temp\\lab-bootstrap.ps1'\""
image_index = sys.argv[2] if len(sys.argv) > 2 else '4'
locale = sys.argv[3] if len(sys.argv) > 3 else 'ru-RU'
unattend = f'''<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
<settings pass="windowsPE">
<component name="Microsoft-Windows-International-Core-WinPE" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><SetupUILanguage><UILanguage>en-US</UILanguage></SetupUILanguage><InputLocale>en-US</InputLocale><SystemLocale>en-US</SystemLocale><UILanguage>en-US</UILanguage><UserLocale>en-US</UserLocale></component>
<component name="Microsoft-Windows-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
<RunSynchronous><RunSynchronousCommand wcm:action="add"><Order>1</Order><Path>reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassTPMCheck /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand><RunSynchronousCommand wcm:action="add"><Order>2</Order><Path>reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassSecureBootCheck /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand></RunSynchronous>
<DiskConfiguration><Disk wcm:action="add"><DiskID>0</DiskID><WillWipeDisk>true</WillWipeDisk><CreatePartitions><CreatePartition wcm:action="add"><Order>1</Order><Type>Primary</Type><Size>550</Size></CreatePartition><CreatePartition wcm:action="add"><Order>2</Order><Type>Primary</Type><Extend>true</Extend></CreatePartition></CreatePartitions><ModifyPartitions><ModifyPartition wcm:action="add"><Order>1</Order><PartitionID>1</PartitionID><Active>true</Active><Format>NTFS</Format><Label>System</Label></ModifyPartition><ModifyPartition wcm:action="add"><Order>2</Order><PartitionID>2</PartitionID><Format>NTFS</Format><Label>Windows</Label><Letter>C</Letter></ModifyPartition></ModifyPartitions></Disk><WillShowUI>OnError</WillShowUI></DiskConfiguration>
<ImageInstall><OSImage><InstallFrom><MetaData wcm:action="add"><Key>/IMAGE/INDEX</Key><Value>{image_index}</Value></MetaData></InstallFrom><InstallTo><DiskID>0</DiskID><PartitionID>2</PartitionID></InstallTo><WillShowUI>OnError</WillShowUI></OSImage></ImageInstall><UserData><AcceptEula>true</AcceptEula><FullName>Shield Lab</FullName><Organization>Egoist</Organization></UserData></component></settings>
<settings pass="specialize"><component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><ComputerName>SHIELD-LAB</ComputerName><TimeZone>Russian Standard Time</TimeZone></component></settings>
<settings pass="oobeSystem"><component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><OOBE><HideEULAPage>true</HideEULAPage><HideOnlineAccountScreens>true</HideOnlineAccountScreens><HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE><ProtectYourPC>3</ProtectYourPC></OOBE><UserAccounts><LocalAccounts><LocalAccount wcm:action="add"><Name>ShieldLab</Name><Group>Administrators</Group><Password><Value>{password}</Value><PlainText>true</PlainText></Password></LocalAccount></LocalAccounts></UserAccounts><AutoLogon><Password><Value>{password}</Value><PlainText>true</PlainText></Password><Username>ShieldLab</Username><Enabled>true</Enabled><LogonCount>10</LogonCount></AutoLogon><FirstLogonCommands><SynchronousCommand wcm:action="add"><Order>1</Order><Description>Shield lab runner</Description><CommandLine>{escape(command)}</CommandLine></SynchronousCommand></FirstLogonCommands></component></settings></unattend>'''

iso = pycdlib.PyCdlib()
unattend = unattend.replace('en-US', locale).replace('<UserData>', '<UserData><ProductKey><Key></Key><WillShowUI>Never</WillShowUI></ProductKey>')
iso.new(interchange_level=4, udf='2.60', vol_ident='EGOISTLAB')
files = []
for name in ('boot', 'efi', 'sources', 'support'):
    files += [source / name] + sorted((source / name).rglob('*'))
files += [source / name for name in ('bootmgr','bootmgr.efi','setup.exe','autorun.inf') if (source/name).exists()]
for item in files:
    rel = '/' + item.relative_to(source).as_posix()
    if rel.lower() == '/boot/bootfix.bin':
        continue  # Unattended lab boots directly instead of asking for a key.
    if item.is_dir():
        iso.add_directory(iso_path=rel.upper(), udf_path=rel)
    elif item.is_file():
        iso.add_file(str(item), iso_path=rel.upper() + ';1', udf_path=rel)
for name, data in [('autounattend.xml', unattend.encode()), ('lab-bootstrap.ps1', b'\xef\xbb\xbf' + bootstrap.encode())]:
    iso.add_fp(io.BytesIO(data), len(data), iso_path='/' + name.upper() + ';1', udf_path='/' + name)
iso.add_eltorito('/BOOT/ETFSBOOT.COM;1', boot_load_size=8, platform_id=0, udf_bootcatfile='/boot.catalog')
destination = lab / ('windows-lab-' + image_index + '.iso')
iso.write(str(destination))
iso.close()
print(json.dumps({'iso': str(destination), 'bytes': destination.stat().st_size}))
