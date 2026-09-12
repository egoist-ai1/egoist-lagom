"""Download exact official release assets and verify GitHub's SHA-256 digest."""
import hashlib
import json
import urllib.request
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'recovery' / 'component-candidates'
root.mkdir(parents=True, exist_ok=True)
for repo, tag, filename in [('SagerNet/sing-box', 'v1.14.0', 'sing-box-1.14.0-windows-amd64.zip'), ('Flowseal/zapret-discord-youtube', '1.10.2', 'zapret-discord-youtube-1.10.2.zip')]:
    req = urllib.request.Request('https://api.github.com/repos/' + repo + '/releases/tags/' + tag, headers={'User-Agent': 'EgoistShield'})
    with urllib.request.urlopen(req, timeout=30) as response:
        release = json.load(response)
    asset = next(a for a in release['assets'] if a['name'] == filename)
    digest = asset.get('digest', '')
    if not digest.startswith('sha256:'):
        raise ValueError('Official asset is missing SHA-256')
    target = root / filename
    if not target.exists():
        urllib.request.urlretrieve(asset['browser_download_url'], target)
    actual = hashlib.sha256(target.read_bytes()).hexdigest()
    if actual != digest[7:]:
        raise ValueError('Downloaded asset failed integrity verification')
    destination = root / target.stem
    with zipfile.ZipFile(target) as archive:
        for member in archive.infolist():
            if not (destination / member.filename).resolve().is_relative_to(destination.resolve()):
                raise ValueError('Archive path escape')
        archive.extractall(destination)
    (root / (target.stem + '.provenance.json')).write_text(json.dumps({'repository':repo,'release':release['tag_name'],'url':asset['browser_download_url'],'sha256':actual},indent=2))
    print(json.dumps({'component':repo,'verified':True,'version':release['tag_name']}),flush=True)
