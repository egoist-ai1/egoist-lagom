import json
import os
import socket
import sys
import time
from pathlib import Path

with socket.create_connection(('127.0.0.1', int(os.environ.get('SHIELD_QMP_PORT', '4444'))), timeout=10) as connection:
    stream = connection.makefile('rwb')
    stream.readline()
    def command(name, args=None):
        stream.write((json.dumps({'execute': name, 'arguments': args or {}}) + '\r\n').encode())
        stream.flush()
        while True:
            result = json.loads(stream.readline())
            if 'event' not in result:
                return result
    command('qmp_capabilities')
    name = sys.argv[1]
    args = {'filename': str(Path(sys.argv[2]).resolve()), 'format': 'png'} if name == 'screendump' else (json.loads(sys.argv[2]) if len(sys.argv) > 2 else {})
    print(json.dumps(command(name, args)))
    if name == 'human-monitor-command' and args.get('command-line', '').startswith('sendkey '):
        time.sleep(0.35)
