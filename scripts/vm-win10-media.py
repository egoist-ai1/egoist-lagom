"""Add private unattended lab files to the original Microsoft evaluation ISO."""
import io
import json
import secrets
import re
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python-libs'))
import pycdlib

original_lab = ROOT / 'recovery/vm'
lab = ROOT / 'recovery/vm-win10'
lab.mkdir(parents=True, exist_ok=True)
config = json.loads((original_lab / 'lab.json').read_text())
old_token = config['token']
config.update(token=secrets.token_hex(32), port=18081, qmp_port=4445, memory_mb=4096)
(lab / 'lab.json').write_text(json.dumps(config))
source = pycdlib.PyCdlib()
source.open(str(original_lab / 'windows-lab-4.iso'))
files = {}
for filename in ['AUTOUNATTEND.XML', 'LAB-BOOTSTRAP.PS1']:
    data = io.BytesIO()
    source.get_file_from_iso_fp(data, iso_path='/' + filename + ';1')
    files[filename] = data.getvalue().replace(old_token.encode(), config['token'].encode()).replace(b'18080', b'18081').replace(b'ru-RU', b'en-US').replace(b'<Value>4</Value>', b'<Value>1</Value>').replace(b"FileSystemLabel -eq 'EGOISTLAB'", b"DriveType -eq 'CD-ROM'")
source.close()
files['AUTOUNATTEND.XML'] = re.sub(rb'<ProductKey>.*?</ProductKey>', b'', files['AUTOUNATTEND.XML'], flags=re.S)
iso = pycdlib.PyCdlib()
iso.open(str(original_lab / 'windows10-ltsc-eval.iso'))
for filename, data in files.items():
    iso.add_fp(io.BytesIO(data), len(data), iso_path='/' + filename.replace('-', '_') + ';1', udf_path='/' + filename.lower())
# Skip the optical-media key prompt in this disposable image.
try:
    iso.rm_file(iso_path='/BOOT/BOOTFIX.BIN;1')
    iso.rm_file(udf_path='/boot/bootfix.bin')
except pycdlib.pycdlibexception.PyCdlibException:
    pass
destination = lab / 'windows10-lab.iso'
iso.write(str(destination))
iso.close()
print(json.dumps({'iso': str(destination), 'bytes': destination.stat().st_size}))
