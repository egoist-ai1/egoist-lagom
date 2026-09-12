"""Fetch the official signed Wintun distribution with its published checksum."""
import hashlib
import json
import sys
from concurrent.futures import ThreadPoolExecutor
import urllib.request
import zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'recovery/component-candidates'
root.mkdir(parents=True,exist_ok=True)
url='https://www.wintun.net/builds/wintun-0.14.1.zip'
digest='07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51'
target=root/'wintun-0.14.1.zip'
if not target.exists() or '--ranges' in sys.argv:
    candidate=target.with_suffix('.download')
    if '--ranges' in sys.argv:
        with urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=15) as response:
            length=int(response.headers['Content-Length'])
        if not 0<length<10*1024*1024:raise ValueError('Unexpected archive length')
        def fetch_range(start):
            end=min(start+8191,length-1)
            request=urllib.request.Request(url,headers={'Range':f'bytes={start}-{end}'})
            with urllib.request.urlopen(request,timeout=15) as response:
                if response.status!=206 or response.headers.get('Content-Range')!=f'bytes {start}-{end}/{length}':raise ValueError('Invalid ranged response')
                data=response.read()
            if len(data)!=end-start+1:raise ValueError('Truncated ranged response')
            return data
        with ThreadPoolExecutor(max_workers=4) as pool:
            candidate.write_bytes(b''.join(pool.map(fetch_range,range(0,length,8192))))
    else:
        with urllib.request.urlopen(url,timeout=30) as response:
            candidate.write_bytes(response.read())
    if hashlib.sha256(candidate.read_bytes()).hexdigest()!=digest:raise ValueError('Wintun checksum mismatch')
    candidate.replace(target)
if hashlib.sha256(target.read_bytes()).hexdigest()!=digest:raise ValueError('Wintun checksum mismatch')
destination=root/'wintun-0.14.1'
with zipfile.ZipFile(target) as archive:
    for entry in archive.infolist():
        if not (destination/entry.filename).resolve().is_relative_to(destination.resolve()):raise ValueError('Archive path escape')
    archive.extractall(destination)
(root/'wintun-0.14.1.provenance.json').write_text(json.dumps({'url':url,'sha256':digest,'version':'0.14.1'}))
print('Official Wintun 0.14.1 archive SHA256 verified')
