"""Recover immutable build inputs without executing the old installer."""
import argparse
import hashlib
import os
import shutil
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--seven-zip', default=shutil.which('7z'))
parser.add_argument('--work-dir', required=True, type=Path)
args = parser.parse_args()
if not args.seven_zip:
    parser.error('Install full 7-Zip and pass --seven-zip path/to/7z.exe')
seven = Path(args.seven_zip).resolve()
if not args.work_dir.is_absolute() or not args.work_dir.is_dir():
    parser.error('--work-dir must be the existing absolute task work directory')
recovery = ROOT / 'recovery'
setup = recovery / 'release-3.5.4' / 'EgoistShield-Setup-3.5.4.exe'
setup.parent.mkdir(parents=True, exist_ok=True)
expected = '97c2f6207176f68e1b63f5052b530a055ee60c15407448052ef4af5dbd478ce8'
if not setup.exists():
    candidate = args.work_dir / 'EgoistShield-Setup-3.5.4.download'
    urllib.request.urlretrieve('https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.5.4/' + setup.name, candidate)
    if hashlib.file_digest(candidate.open('rb'), 'sha256').hexdigest() != expected:
        raise RuntimeError('Official installer checksum mismatch')
    candidate.replace(setup)
if hashlib.file_digest(setup.open('rb'), 'sha256').hexdigest() != expected:
    raise RuntimeError('Official installer checksum mismatch')
flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
def extract(source, target):
    target.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(seven), 'x', str(source), '-o' + str(target), '-y'], check=True, stdout=subprocess.DEVNULL, creationflags=flags)

official = recovery / 'official-app'
code = recovery / 'official-code'
if not (official / 'resources/app.asar').exists():
    stage = args.work_dir / 'build-bootstrap'
    extract(setup, stage / 'outer')
    extract(stage / 'outer/$PLUGINSDIR/app-64.7z', stage / 'branded')
    extract(stage / 'branded/resources/engine/engine-setup.exe', stage / 'engine')
    extract(stage / 'engine/$PLUGINSDIR/app-64.7z', official)
if not (code / '.vite/renderer/main_window/index.html').exists():
    subprocess.run(['node', str(ROOT / 'node_modules/@electron/asar/bin/asar.js'), 'extract', str(official / 'resources/app.asar'), str(code)], check=True, creationflags=flags)
(recovery / 'evidence').mkdir(exist_ok=True)
subprocess.run([os.sys.executable, str(ROOT / 'scripts/download-component-candidates.py'), '--work-dir', str(args.work_dir)], check=True, creationflags=flags)
subprocess.run([os.sys.executable, str(ROOT / 'scripts/download-wintun.py'), '--work-dir', str(args.work_dir)], check=True, creationflags=flags)
subprocess.run([os.sys.executable, str(ROOT / 'scripts/fetch-electron-runtime.py'), '--work-dir', str(args.work_dir)], check=True, creationflags=flags)
print('Verified official 3.5.4 inputs and pinned component archives are ready.')
