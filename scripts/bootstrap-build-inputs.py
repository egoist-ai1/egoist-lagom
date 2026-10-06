"""Recover immutable build inputs without executing the old installer."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
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

def run_input_child(arguments, stage, timeout_seconds=1200, discard_stdout=False):
    # CREATE_NO_WINDOW without explicit handles can hide the child failure on Windows.
    # These fixed build actors never receive credentials or private product data.
    evidence = args.work_dir / 'evidence'
    evidence.mkdir(exist_ok=True)
    record_dir = Path(tempfile.mkdtemp(prefix='bootstrap-child-', dir=evidence))
    started = time.monotonic()
    result = None
    failure = None
    try:
        result = subprocess.run(arguments, check=False,
                                stdout=subprocess.DEVNULL if discard_stdout else subprocess.PIPE,
                                stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, creationflags=flags, timeout=timeout_seconds)
        output, error = result.stdout or b'', result.stderr or b''
    except subprocess.TimeoutExpired as exc:
        failure = exc
        output, error = exc.stdout or b'', exc.stderr or b''
    except OSError as exc:
        failure = exc
        output, error = b'', b''
    limit = 65536
    (record_dir / 'stdout.log').write_bytes(output[-limit:])
    (record_dir / 'stderr.log').write_bytes(error[-limit:])
    record = {'schemaVersion': 1, 'stage': stage,
              'result': ('timeout' if isinstance(failure, subprocess.TimeoutExpired) else 'launch-failed') if failure else ('passed' if result.returncode == 0 else 'failed'),
              'errorClass': type(failure).__name__ if failure else None,
              'exitCode': None if failure else result.returncode,
              'elapsedMilliseconds': round((time.monotonic() - started) * 1000, 3),
              'stdoutCaptured': not discard_stdout, 'stderrCaptured': True,
              'stdoutBytes': len(output), 'stderrBytes': len(error),
              'stdoutTruncated': len(output) > limit, 'stderrTruncated': len(error) > limit,
              'timeoutSeconds': timeout_seconds, 'environmentDumped': False}
    (record_dir / 'result.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    if failure or result.returncode != 0:
        print(f'Build input stage {stage} failed; diagnostics: {record_dir}', file=sys.stderr, flush=True)
        for stream, value in ((sys.stdout, output), (sys.stderr, error)):
            if value:
                stream.write(value[-8192:].decode('utf-8', errors='replace'))
                stream.flush()
        if failure:
            raise failure
        raise subprocess.CalledProcessError(result.returncode, arguments)
    if output:
        sys.stdout.write(output[-limit:].decode('utf-8', errors='replace'))
        sys.stdout.flush()
    return result

def extract(source, target):
    target.mkdir(parents=True, exist_ok=True)
    run_input_child([str(seven), 'x', str(source), '-o' + str(target), '-y'], 'extract-' + target.name, discard_stdout=True)

official = recovery / 'official-app'
code = recovery / 'official-code'
if not (official / 'resources/app.asar').exists():
    stage = args.work_dir / 'build-bootstrap'
    extract(setup, stage / 'outer')
    extract(stage / 'outer/$PLUGINSDIR/app-64.7z', stage / 'branded')
    extract(stage / 'branded/resources/engine/engine-setup.exe', stage / 'engine')
    extract(stage / 'engine/$PLUGINSDIR/app-64.7z', official)
if not (code / '.vite/renderer/main_window/index.html').exists():
    run_input_child(['node', str(ROOT / 'node_modules/@electron/asar/bin/asar.js'), 'extract', str(official / 'resources/app.asar'), str(code)], 'extract-asar')
(recovery / 'evidence').mkdir(exist_ok=True)
run_input_child([os.sys.executable, str(ROOT / 'scripts/download-component-candidates.py'), '--work-dir', str(args.work_dir)], 'components')
run_input_child([os.sys.executable, str(ROOT / 'scripts/download-wintun.py'), '--work-dir', str(args.work_dir)], 'wintun')
run_input_child([os.sys.executable, str(ROOT / 'scripts/fetch-electron-runtime.py'), '--work-dir', str(args.work_dir)], 'electron')
print('Verified official 3.5.4 inputs and pinned component archives are ready.')
