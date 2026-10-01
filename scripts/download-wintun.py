"""Fetch the official signed Wintun distribution with its published checksum."""
import argparse
import importlib.util
import json
import os
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
import urllib.request
from pathlib import Path

sys.dont_write_bytecode = True
PROJECT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('component_input_verifier', PROJECT / 'scripts/verify-component-inputs.py')
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir', type=Path, default=os.environ.get('SHIELD_EVIDENCE_DIR'))
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--ranges', action='store_true')
    args = parser.parse_args()
    if args.work_dir is None or not args.work_dir.is_absolute() or not args.work_dir.is_dir():
        parser.error('--work-dir must be the existing absolute task work directory')
    descriptor = json.loads((PROJECT / 'scripts/component-inputs.json').read_text(encoding='utf-8'))
    if descriptor.get('schemaVersion') != 1:
        raise ValueError('Invalid component input descriptor')
    pin = next(item for item in descriptor['components'] if item['name'] == 'wintun')
    root = PROJECT / 'recovery/component-candidates'
    root.mkdir(parents=True, exist_ok=True)
    target = root / pin['archive']
    if not target.exists() or args.ranges:
        if args.offline:
            raise ValueError('Wintun archive is absent or a network range download was requested in offline mode')
        with tempfile.TemporaryDirectory(prefix='wintun-download-', dir=args.work_dir) as temporary:
            candidate = Path(temporary) / pin['archive']
            if args.ranges:
                with urllib.request.urlopen(urllib.request.Request(pin['url'], method='HEAD'), timeout=15) as response:
                    length = int(response.headers['Content-Length'])
                if not 0 < length < 10 * 1024 * 1024:
                    raise ValueError('Unexpected archive length')
                def fetch_range(start):
                    end = min(start + 8191, length - 1)
                    request = urllib.request.Request(pin['url'], headers={'Range': f'bytes={start}-{end}'})
                    with urllib.request.urlopen(request, timeout=15) as response:
                        if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{length}':
                            raise ValueError('Invalid ranged response')
                        data = response.read(end - start + 2)
                    if len(data) != end - start + 1:
                        raise ValueError('Truncated ranged response')
                    return data
                with ThreadPoolExecutor(max_workers=4) as pool:
                    candidate.write_bytes(b''.join(pool.map(fetch_range, range(0, length, 8192))))
            else:
                with urllib.request.urlopen(pin['url'], timeout=30) as response:
                    data = response.read(10 * 1024 * 1024 + 1)
                if len(data) > 10 * 1024 * 1024:
                    raise ValueError('Wintun archive exceeds byte limit')
                candidate.write_bytes(data)
            with verifier.open_pinned_zip(candidate, pin['sha256']) as archive:
                verifier.zip_entries(archive)
            candidate.replace(target)
    inventory = verifier.extract_verified(target, pin['sha256'], root / target.stem, args.work_dir)
    (root / (target.stem + '.provenance.json')).write_text(json.dumps({'url': pin['url'], 'sha256': pin['sha256'], 'version': pin['version'], 'authenticatedFileCount': len(inventory['files'])}), encoding='utf-8')
    print('Official Wintun ' + pin['version'] + ' archive and extracted files SHA256 verified')


if __name__ == '__main__':
    main()
