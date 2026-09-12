"""Recover a .NET single-file bundle without executing its entry point.

Layout: dotnet/runtime Microsoft.NET.HostModel/Bundle/{Manifest,FileEntry}.cs.
Only extraction into an empty project-owned directory is permitted.
"""
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import zlib

source, destination = map(Path, sys.argv[1:3])
destination = destination.resolve()
destination.mkdir(parents=True, exist_ok=False)
data = source.read_bytes()
signature = bytes.fromhex('8b1202b96a612038727b930214d7a03213f5b9e6efae3318ee3b2dce24b36aae')
marker = data.find(signature)
if marker < 8:
    raise ValueError('No .NET bundle marker')
offset = struct.unpack_from('<q', data, marker - 8)[0]
if not 0 < offset < len(data):
    raise ValueError('Invalid manifest offset')
stream = io.BytesIO(data)
stream.seek(offset)

def read_number(fmt):
    return struct.unpack(fmt, stream.read(struct.calcsize(fmt)))

def read_string():
    size = 0
    for shift in range(0, 35, 7):
        byte, = read_number('<B')
        size |= (byte & 127) << shift
        if not byte & 128:
            return stream.read(size).decode('utf-8')
    raise ValueError('Invalid string length')

major, minor, count = read_number('<IIi')
if major not in (2, 6) or not 0 < count < 10000:
    raise ValueError(f'Unsupported bundle: {major}.{minor}, {count}')
bundle_id = read_string()
read_number('<qqqqQ')
entries = []
for _ in range(count):
    file_offset, size = read_number('<qq')
    compressed, = read_number('<q') if major >= 6 else (0,)
    kind, = read_number('<B')
    name = read_string()
    output = (destination / name).resolve()
    if not output.is_relative_to(destination) or output == destination:
        raise ValueError('Path escapes extraction directory')
    stored_size = compressed or size
    if min(file_offset, size, stored_size) < 0 or file_offset + stored_size > offset:
        raise ValueError('Invalid file bounds')
    content = data[file_offset:file_offset + stored_size]
    if compressed:
        content = zlib.decompress(content, -zlib.MAX_WBITS)
    if len(content) != size:
        raise ValueError('Extracted size mismatch')
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('xb') as handle:
        handle.write(content)
    entries.append({'path': name, 'size': size, 'type': kind,
                    'sha256': hashlib.sha256(content).hexdigest()})
receipt = {'sourceSha256': hashlib.sha256(data).hexdigest(),
           'bundleVersion': f'{major}.{minor}', 'bundleId': bundle_id,
           'files': entries}
(destination / 'extraction.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps({'bundle': bundle_id, 'files': len(entries)}))
