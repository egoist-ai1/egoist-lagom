"""Local-only test controller. Guest scripts are taken from the explicit lab queue."""
import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / 'recovery' / (sys.argv[3] if len(sys.argv) > 3 else 'vm')
CONFIG = json.loads((LAB / 'lab.json').read_text())
for name in ('jobs', 'results', 'dispatched'):
    (LAB / name).mkdir(exist_ok=True)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def authenticated(self):
        if self.headers.get('X-Lab-Token') != CONFIG['token']:
            self.send_error(403)
            return False
        return True

    def send_json(self, value):
        data = json.dumps(value).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.authenticated():
            return
        if self.path == '/job':
            jobs = sorted((LAB / 'jobs').glob('*.ps1'))
            if not jobs:
                self.send_json({})
                return
            job = jobs[0]
            script = job.read_text(encoding='utf-8-sig')
            job.replace(LAB / 'dispatched' / job.name)
            self.send_json({'id': job.stem, 'script': script})
        elif self.path == '/setup':
            candidates = sorted((ROOT / 'dist').glob('EgoistShield-Setup-*.exe'))
            if not candidates:
                self.send_error(404)
                return
            file = candidates[-1]
            self.send_response(200)
            self.send_header('Content-Length', str(file.stat().st_size))
            self.end_headers()
            with file.open('rb') as handle:
                while chunk := handle.read(1024 * 1024):
                    self.wfile.write(chunk)
        else:
            self.send_error(404)

    def do_POST(self):
        if not self.authenticated():
            return
        size = int(self.headers.get('Content-Length', '0'))
        if size > 8 * 1024 * 1024:
            self.send_error(413)
            return
        data = json.loads(self.rfile.read(size))
        if self.path == '/ready':
            target = LAB / 'ready.json'
        elif self.path == '/result' and str(data.get('id', '')).replace('-', '').replace('_', '').isalnum():
            target = LAB / 'results' / (data['id'] + '.json')
        else:
            self.send_error(400)
            return
        target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        self.send_json({'ok': True})

if __name__ == '__main__':
    image = LAB / sys.argv[1]
    disk = LAB / (image.stem + '.qcow2')
    qemu = ROOT / '.tools' / 'qemu'
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    fresh = not disk.exists()
    if not disk.exists():
        subprocess.run([str(qemu / 'qemu-img.exe'), 'create', '-f', 'qcow2', str(disk), '80G'], check=True, creationflags=flags)
    accelerator = sys.argv[2] if len(sys.argv) > 2 else 'whpx,kernel-irqchip=off'
    args = [str(qemu / 'qemu-system-x86_64.exe'), '-name', 'EgoistShieldLab', '-machine', 'q35', '-accel', accelerator, '-m', str(CONFIG.get('memory_mb', 8192)), '-smp', '2', '-display', 'none', '-drive', f'file={disk},format=qcow2,if=ide', '-cdrom', str(image), '-boot', 'order=c,once=d', '-nic', 'user,model=e1000', '-qmp', f'tcp:127.0.0.1:{CONFIG.get("qmp_port", 4444)},server=on,wait=off', '-serial', f'file:{LAB / "serial.log"}']
    if accelerator.startswith('tcg'):
        args += ['-cpu', 'max']
    args[args.index('-boot') + 1] = 'order=c,once=d' if fresh else 'order=c'
    args += ['-device', 'qemu-xhci,id=shield-usb', '-device', 'usb-kbd,bus=shield-usb.0', '-device', 'usb-tablet,bus=shield-usb.0']
    payload_name = sys.argv[4] if len(sys.argv) > 4 else 'shield-payload-report.iso'
    if Path(payload_name).name != payload_name or not payload_name.endswith('.iso'):
        raise ValueError('Expected a payload ISO filename within the selected lab')
    payload = LAB / payload_name
    if not fresh and payload.exists():
        args[args.index('-cdrom') + 1] = str(payload)
    with (LAB / 'qemu.log').open('w') as log:
        process = subprocess.Popen(args, stdout=log, stderr=log, creationflags=flags)
        (LAB / 'qemu-process.json').write_text(json.dumps({'pid': process.pid, 'args': args}))
        print('Lab running on localhost; QEMU PID', process.pid, flush=True)
        try:
            ThreadingHTTPServer(('127.0.0.1', CONFIG['port']), Handler).serve_forever()
        finally:
            process.terminate()
