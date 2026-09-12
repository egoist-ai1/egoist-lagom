"""Stage and verify this project's explicit release asset allowlist on GitHub."""
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('shield_github_api',ROOT/'scripts/github-api.py')
api=importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
REPO='/repos/egoist-ai1/egoist-lagom'
DIST=Path(os.environ.get('EGOIST_RELEASE_DIST', str(ROOT/'dist')))
if not DIST.is_absolute():
    raise ValueError('EGOIST_RELEASE_DIST must be absolute')
version=json.loads((ROOT/'package.json').read_text(encoding='utf-8-sig'))['version']
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    raise ValueError('Expected a stable semantic version')
tag='v'+version
names=['Egoist-Lagom-Setup.exe','Egoist-Lagom-Setup.exe.sha256','package-integrity.json',
       'LICENSE.txt','THIRD-PARTY-NOTICES.txt','Egoist-Lagom-validation.md',
       'release-manifest.json','release-manifest.json.sig','stable-channel.json','stable-channel.json.sig',
       'root-public-key.pem','release-key-registry.json','release-key-registry.json.sig',
       'Egoist-Lagom-'+version+'.cdx.json']
receipt_argument=os.environ.get('SHIELD_RELEASE_RECEIPT')
receipt_path=Path(receipt_argument) if receipt_argument else None

def known_release():
    try:
        return api.request(REPO+'/releases/tags/'+urllib.parse.quote(tag,safe=''))
    except RuntimeError as error:
        if str(error)=='GitHub API returned HTTP 404':
            drafts=api.request(REPO+'/releases?per_page=100')
            return next((r for r in drafts if r['tag_name']==tag),None)
        raise

def summary(release):
    return {'id':release['id'],'tag':release['tag_name'],'draft':release['draft'],'prerelease':release['prerelease'],'url':release['html_url'],
            'assets':[{'id':a['id'],'name':a['name'],'size':a['size'],'digest':a.get('digest')} for a in release.get('assets',[])]}

def verify_local():
    # Verify signatures against bundled trust, not the copies destined for upload.
    subprocess.run([os.environ.get('EGOIST_NODE', 'node'), str(ROOT/'scripts/prepare-release-assets.mjs'),
                    '--dist', str(DIST), '--verify-only', 'true'], cwd=ROOT, check=True)
    digests={}
    for name in names:
        file=(DIST/name).resolve()
        if file.parent!=DIST.resolve() or not file.is_file():
            raise ValueError('Invalid or missing release asset: '+name)
        data=file.read_bytes()
        if not data:
            raise ValueError('Empty release asset: '+name)
        digests[name]={'digest':'sha256:'+hashlib.sha256(data).hexdigest(),'size':len(data)}
    return digests

mode=sys.argv[1] if len(sys.argv)>1 else 'status'
if mode not in ('status','verify','stage','upload','publish'):
    raise ValueError('Expected status, verify, stage, upload, or publish')
if mode=='verify':
    print(json.dumps({'tag':tag,'assets':verify_local()}))
    sys.exit(0)
if mode!='status':
    verified_assets=verify_local()
    if receipt_path is None or not receipt_path.is_absolute():
        raise ValueError('Set SHIELD_RELEASE_RECEIPT to an absolute task-scoped receipt path')
    receipt_path.parent.mkdir(parents=True,exist_ok=True)
release=known_release()
if mode=='status':
    print(json.dumps({'exists':release is not None,'release':summary(release) if release else None}))
elif mode=='stage':
    if release:
        raise RuntimeError('Release already exists; inspect it before any modification')
    if len(sys.argv)!=4:
        raise ValueError('stage requires an exact metadata commit SHA and a release-notes file')
    commit=sys.argv[2]
    if len(commit)!=40 or any(c not in '0123456789abcdef' for c in commit):
        raise ValueError('Expected an exact lowercase Git commit SHA')
    body=Path(sys.argv[3]).read_text(encoding='utf-8-sig')
    release=api.request(REPO+'/releases','POST',{'tag_name':tag,'target_commitish':commit,'name':'Egoist Lagom','body':body,'draft':True,'prerelease':False})
    receipt_path.write_text(json.dumps({'releaseId':release['id'],'tag':tag,'candidate':verified_assets,'assets':[]},indent=2))
    print(json.dumps(summary(release)))
elif mode=='upload':
    receipt=json.loads(receipt_path.read_text())
    if receipt.get('candidate')!=verified_assets:
        raise RuntimeError('Local assets changed since draft creation; inspect before continuing')
    if not release or not release['draft'] or release['id']!=receipt['releaseId'] or release['tag_name']!=receipt['tag']:
        raise RuntimeError('Only the task-owned unpublished draft may receive assets')
    assets={a['name']:a for a in release.get('assets',[])}
    for name in names:
        file=(DIST/name).resolve()
        if file.parent!=DIST.resolve() or not file.is_file():
            raise ValueError('Invalid release asset path')
        data=file.read_bytes()
        digest='sha256:'+hashlib.sha256(data).hexdigest()
        if verified_assets[name]!={'digest':digest,'size':len(data)}:
            raise RuntimeError('Local asset changed during upload: '+name)
        if name in assets:
            asset=assets[name]
            if asset.get('digest')!=digest or asset['size']!=len(data):
                raise RuntimeError('Existing draft asset differs; inspect before replacing: '+name)
        else:
            url='https://uploads.github.com'+REPO+'/releases/'+str(release['id'])+'/assets?name='+urllib.parse.quote(name,safe='')
            req=urllib.request.Request(url,data=data,method='POST',headers={'Authorization':'Bearer '+api.credential_token(),'Accept':'application/vnd.github+json','User-Agent':'EgoistLagom-release','Content-Type':'application/octet-stream','Content-Length':str(len(data))})
            with urllib.request.urlopen(req,timeout=300) as response:
                asset=json.load(response)
            if asset.get('digest')!=digest or asset['size']!=len(data):
                raise RuntimeError('Uploaded asset digest/size mismatch: '+name)
        if not any(a['id']==asset['id'] for a in receipt['assets']):
            receipt['assets'].append({'id':asset['id'],'name':name,'digest':digest,'size':len(data)})
            receipt_path.write_text(json.dumps(receipt,indent=2))
        print(json.dumps({'name':name,'verified':True,'size':len(data)}),flush=True)
    fresh=api.request(REPO+'/releases/'+str(release['id']))
    print(json.dumps(summary(fresh)))
elif mode=='publish':
    receipt=json.loads(receipt_path.read_text())
    if receipt.get('candidate')!=verified_assets:
        raise RuntimeError('Local assets changed since draft creation; inspect before publishing')
    if not release or release['id']!=receipt['releaseId'] or release['tag_name']!=receipt['tag']:
        raise RuntimeError('Only the task-owned release may be published')
    assets={a['name']:a for a in release.get('assets',[])}
    if set(assets)!=set(names):
        raise RuntimeError('Release assets differ from the exact expected allowlist')
    for name in names:
        data=(DIST/name).read_bytes()
        if verified_assets[name]!={'digest':'sha256:'+hashlib.sha256(data).hexdigest(),'size':len(data)}:
            raise RuntimeError('Local asset changed during publication verification: '+name)
        if assets[name].get('digest')!='sha256:'+hashlib.sha256(data).hexdigest() or assets[name]['size']!=len(data):
            raise RuntimeError('Release asset differs from the verified local candidate: '+name)
    if release['draft']:
        api.request(REPO+'/releases/'+str(release['id']),'PATCH',{'draft':False,'prerelease':False,'make_latest':'true'})
    fresh=api.request(REPO+'/releases/'+str(release['id']))
    latest=api.request(REPO+'/releases/latest')
    if fresh['draft'] or fresh['prerelease'] or latest['id']!=fresh['id']:
        raise RuntimeError('Published release/latest readback did not match the task-owned candidate')
    receipt['published']=True
    receipt_path.write_text(json.dumps(receipt,indent=2))
    print(json.dumps(summary(fresh)))
else:
    raise ValueError('Expected status, stage, upload, or publish')
