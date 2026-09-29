"""Download the same immutable component inputs consumed by production packaging."""
import argparse
import importlib.util
import json
import os
import sys
import tempfile
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
    args = parser.parse_args()
    if args.work_dir is None or not args.work_dir.is_absolute() or not args.work_dir.is_dir():
        parser.error('--work-dir must be the existing absolute task work directory')
    descriptor = json.loads((PROJECT / 'scripts/component-inputs.json').read_text(encoding='utf-8'))
    if descriptor.get('schemaVersion') != 1:
        raise ValueError('Invalid component input descriptor')
    root = PROJECT / 'recovery/component-candidates'
    root.mkdir(parents=True, exist_ok=True)
    for pin in descriptor['components'] + descriptor.get('binaries', []):
        if 'repository' not in pin:
            continue
        filename = pin.get('archive') or pin['file']
        binary = 'file' in pin
        target = root / filename
        if not args.offline:
            req = urllib.request.Request('https://api.github.com/repos/' + pin['repository'] + '/releases/tags/' + pin['tag'], headers={'User-Agent': 'EgoistLagom-build'})
            with urllib.request.urlopen(req, timeout=30) as response:
                metadata = response.read(2 * 1024 * 1024 + 1)
            if len(metadata) > 2 * 1024 * 1024:
                raise ValueError('Official release metadata exceeds byte limit')
            release = json.loads(metadata)
            assets = [asset for asset in release.get('assets', []) if asset.get('name') == filename]
            if release.get('tag_name') != pin['tag'] or release.get('draft') or release.get('prerelease') or len(assets) != 1 or assets[0].get('browser_download_url') != pin['url']:
                raise ValueError('Official release differs from the pinned component descriptor')
            asset = assets[0]
            if binary:
                if asset.get('id') != pin['assetId'] or asset.get('size') != pin['bytes'] or asset.get('digest') not in (pin['githubDigest'], 'sha256:' + pin['sha256']):
                    raise ValueError('Official binary metadata differs from the pinned descriptor')
            elif asset.get('digest') != 'sha256:' + pin['sha256']:
                raise ValueError('Official archive digest differs from the pinned descriptor')
        if not target.exists():
            if args.offline:
                raise ValueError('Pinned component input is absent in offline mode: ' + filename)
            with tempfile.TemporaryDirectory(prefix='component-download-', dir=args.work_dir) as temporary:
                candidate = Path(temporary) / filename
                with urllib.request.urlopen(pin['url'], timeout=30) as response, candidate.open('xb') as output:
                    total = 0
                    for chunk in iter(lambda: response.read(1024 * 1024), b''):
                        total += len(chunk)
                        if total > (pin['bytes'] if binary else verifier.MAX_ARCHIVE):
                            raise ValueError('Component archive exceeds byte limit')
                        output.write(chunk)
                if binary:
                    verify_binary(candidate, pin)
                else:
                    with verifier.open_pinned_zip(candidate, pin['sha256']) as archive:
                        verifier.zip_entries(archive)
                candidate.replace(target)
        if binary:
            verify_binary(target, pin)
            evidence = {'bytes': pin['bytes'], 'assetId': pin['assetId'], 'githubDigest': pin['githubDigest'], 'integritySource': pin['integritySource']}
        else:
            inventory = verifier.extract_verified(target, pin['sha256'], root / target.stem, args.work_dir)
            evidence = {'authenticatedFileCount': len(inventory['files'])}
        (root / (target.stem + '.provenance.json')).write_text(json.dumps({'repository': pin['repository'], 'release': pin['tag'], 'url': pin['url'], 'sha256': pin['sha256'], **evidence}, indent=2), encoding='utf-8')
        print(json.dumps({'component': pin['name'], 'verified': True, 'version': pin['version']}), flush=True)


def verify_binary(file, pin):
    verifier.ordinary_parents(file)
    if verifier.ordinary(file).st_size != pin['bytes']:
        raise ValueError('Pinned binary size mismatch')
    with file.open('rb') as stream:
        if verifier.digest_stream(stream) != pin['sha256']:
            raise ValueError('Pinned binary SHA-256 mismatch')


if __name__ == '__main__':
    main()
