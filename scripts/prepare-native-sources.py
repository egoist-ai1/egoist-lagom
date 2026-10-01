"""Build a pinned, bounded native-source companion without executing native binaries."""
import argparse
import base64
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import posixpath
import re
import stat
import sys
import tempfile
import threading
import urllib.request
import zipfile

sys.dont_write_bytecode = True
PROJECT = Path(__file__).resolve().parents[1]
MAX_ARCHIVE = 128 * 1024 * 1024
MAX_EXTRACTED = 512 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
budget_lock = threading.Lock()
downloaded_bytes = 0


def ordinary(file):
    for parent in reversed(file.parents):
        value = parent.lstat()
        if not stat.S_ISDIR(value.st_mode) or stat.S_ISLNK(value.st_mode) or getattr(value, 'st_file_attributes', 0) & 0x400:
            raise ValueError('Linked native-source directory')
    value = file.lstat()
    if not stat.S_ISREG(value.st_mode) or stat.S_ISLNK(value.st_mode) or value.st_nlink != 1 or getattr(value, 'st_file_attributes', 0) & 0x400:
        raise ValueError('Native-source input must be an ordinary file')
    if not 0 < value.st_size <= MAX_ARCHIVE:
        raise ValueError('Native-source input exceeds archive byte limit')
    return value


def stream_hash(stream):
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(chunk)
    return digest.hexdigest()


def source_entries(archive, preserve_source_links=False):
    entries = archive.infolist()
    if not 0 < len(entries) <= 50000:
        raise ValueError('Unexpected native-source archive entry count')
    seen = set()
    total = 0
    for entry in entries:
        name = entry.filename
        parts = name.rstrip('/').split('/')
        if not name or name.startswith('/') or '\\' in name or any(part in ('', '.', '..') or ':' in part or any(ord(c) < 32 for c in part) for part in parts):
            raise ValueError('Unsafe native-source archive entry')
        kind = stat.S_IFMT(entry.external_attr >> 16)
        if name.casefold() in seen or kind not in (0, stat.S_IFREG, stat.S_IFDIR, stat.S_IFLNK) or entry.flag_bits & 1:
            raise ValueError('Linked or duplicate native-source archive entry')
        if kind == stat.S_IFLNK:
            if not preserve_source_links or entry.file_size > 4096:
                raise ValueError('Unexpected linked native-source entry')
            target = archive.read(entry).decode('utf-8')
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
            if target.startswith('/') or '\\' in target or ':' in target or any(ord(c) < 32 for c in target) or not resolved.startswith(parts[0] + '/'):
                raise ValueError('Native-source link escapes its upstream source root')
        seen.add(name.casefold())
        total += entry.file_size
        if total > MAX_EXTRACTED or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise ValueError('Native-source archive exceeds extracted byte limit')
    return entries


def module_h1(file, module, version):
    ordinary(file)
    digest = hashlib.sha256()
    prefix = module + '@' + version + '/'
    with zipfile.ZipFile(file) as archive:
        entries = source_entries(archive)
        for entry in sorted(entries, key=lambda value: value.filename):
            if not entry.filename.startswith(prefix) or entry.is_dir():
                raise ValueError('Go module archive has an unexpected path prefix')
            with archive.open(entry) as stream:
                file_hash = stream_hash(stream)
            digest.update((file_hash + '  ' + entry.filename + '\n').encode())
    return 'h1:' + base64.b64encode(digest.digest()).decode()


def verify(file, pin):
    ordinary(file)
    if pin.get('h1'):
        if module_h1(file, pin['module'], pin['version']) != pin['h1']:
            raise ValueError('Native Go module h1 checksum mismatch: ' + pin['module'])
    else:
        with file.open('rb') as stream:
            if stream_hash(stream) != pin['sha256']:
                raise ValueError('Native primary source SHA-256 mismatch: ' + pin['name'])
        with zipfile.ZipFile(file) as archive:
            source_entries(archive, preserve_source_links=True)
    with file.open('rb') as stream:
        return {'bytes': file.stat().st_size, 'sha256': stream_hash(stream)}


def fetch(pin, cache, work, offline):
    global downloaded_bytes
    target = cache / pin['file']
    if not target.exists():
        if offline:
            raise ValueError('Pinned native source is absent in offline mode: ' + pin['file'])
        with tempfile.TemporaryDirectory(prefix='native-source-download-', dir=work) as temporary:
            candidate = Path(temporary) / pin['file']
            req = urllib.request.Request(pin['url'], headers={'User-Agent': 'EgoistLagom-native-source'})
            with urllib.request.urlopen(req, timeout=40) as response, candidate.open('xb') as output:
                total = 0
                for chunk in iter(lambda: response.read(1024 * 1024), b''):
                    total += len(chunk)
                    if total > MAX_ARCHIVE:
                        raise ValueError('Native-source download exceeds byte limit')
                    with budget_lock:
                        downloaded_bytes += len(chunk)
                        if downloaded_bytes > MAX_TOTAL:
                            raise ValueError('Native-source downloads exceed total byte limit')
                    output.write(chunk)
            verify(candidate, pin)
            candidate.replace(target)
    return {**pin, **verify(target, pin)}


def write_source(archive, file, name, expected=None):
    ordinary(file)
    entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    entry.compress_type = zipfile.ZIP_STORED
    entry.external_attr = (stat.S_IFREG | 0o644) << 16
    digest = hashlib.sha256()
    size = 0
    with file.open('rb') as source, archive.open(entry, 'w', force_zip64=True) as target:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
            size += len(chunk)
            target.write(chunk)
    if expected is not None and (size != expected['bytes'] or digest.hexdigest() != expected['sha256']):
        raise ValueError('Native-source input changed during companion creation')


def notice_inventory(directory):
    manifest = json.loads((directory / 'sources.json').read_text(encoding='utf-8'))
    if manifest.get('schemaVersion') != 1 or not isinstance(manifest.get('files'), list) or not manifest['files']:
        raise ValueError('Native-source notice inventory is absent')
    inventory = {}
    for entry in manifest['files']:
        name = entry.get('file', '')
        if not re.fullmatch(r'(?:(?:go-modules|native-upstream)/)?[a-zA-Z0-9._-]+', name) or name.casefold() in inventory or not re.fullmatch(r'[a-f0-9]{64}', entry.get('sha256', '')):
            raise ValueError('Unexpected native-source notice path or hash')
        file = directory.joinpath(*name.split('/'))
        value = ordinary(file)
        if not 0 < value.st_size <= 2 * 1024 * 1024 or value.st_size != entry.get('bytes'):
            raise ValueError('Native-source notice size differs from inventory')
        with file.open('rb') as stream:
            if stream_hash(stream) != entry['sha256']:
                raise ValueError('Native-source notice bytes differ from inventory')
        inventory[name.casefold()] = entry
    return inventory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir', type=Path, default=os.environ.get('SHIELD_EVIDENCE_DIR'))
    parser.add_argument('--output', type=Path)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    if args.work_dir is None or not args.work_dir.is_absolute() or not args.work_dir.is_dir():
        parser.error('--work-dir must be an existing absolute task work directory')
    version = json.loads((PROJECT / 'package.json').read_text(encoding='utf-8-sig'))['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('A stable package version is required')
    output = args.output or PROJECT / 'dist' / ('Egoist-Lagom-' + version + '-native-sources.zip')
    if not output.is_absolute():
        parser.error('--output must be absolute')
    descriptor = json.loads((PROJECT / 'resources/licenses/source-inputs.json').read_text())
    if descriptor.get('schemaVersion') != 1:
        raise ValueError('Invalid native-source descriptor')
    notices = notice_inventory(PROJECT / 'resources/licenses')
    pins = descriptor['primarySources'] + descriptor['singBoxModules']
    if len({pin['file'].casefold() for pin in pins}) != len(pins):
        raise ValueError('Native-source file-name collision')
    for pin in pins:
        if Path(pin['file']).name != pin['file'] or not re.fullmatch(r'[a-zA-Z0-9._-]+\.zip', pin['file']) or not pin['url'].startswith(('https://codeload.github.com/', 'https://proxy.golang.org/')):
            raise ValueError('Unexpected native-source pin route')
    cache = PROJECT / 'recovery/native-sources'
    cache.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        inventory = list(executor.map(lambda pin: fetch(pin, cache, args.work_dir, args.offline), pins))
    if sum(pin['bytes'] for pin in inventory) > MAX_TOTAL:
        raise ValueError('Native-source companion exceeds total byte limit')
    output.parent.mkdir(parents=True, exist_ok=True)
    receipt = {'schemaVersion': 1, 'productVersion': version, 'coverage': descriptor['coverage'], 'inputs': inventory}
    with tempfile.TemporaryDirectory(prefix='native-source-bundle-', dir=args.work_dir) as temporary:
        candidate = Path(temporary) / output.name
        with zipfile.ZipFile(candidate, 'w', zipfile.ZIP_STORED) as archive:
            for pin in inventory:
                write_source(archive, cache / pin['file'], 'sources/' + pin['file'], pin)
            for file in sorted((PROJECT / 'resources/licenses').rglob('*')):
                if file.is_file():
                    relative = file.relative_to(PROJECT / 'resources/licenses').as_posix()
                    write_source(archive, file, 'notices/' + relative, notices.get(relative.casefold()))
            write_source(archive, Path(__file__), 'tools/prepare-native-sources.py')
            entry = zipfile.ZipInfo('native-source-inventory.json', date_time=(1980, 1, 1, 0, 0, 0))
            entry.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(entry, json.dumps(receipt, indent=2) + '\n')
        candidate.replace(output)
    with output.open('rb') as stream:
        result = {'path': str(output), 'bytes': output.stat().st_size, 'sha256': stream_hash(stream), 'sourceArchives': len(inventory), 'coverage': descriptor['coverage']}
    output.with_name(output.name + '.sha256').write_text(result['sha256'] + '  ' + output.name + '\n', encoding='utf-8')
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
