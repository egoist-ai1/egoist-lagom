import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const project = process.argv[2], work = process.argv[3];
let captured;
const context = vm.createContext({ path, promises: fs, Buffer, promisify, execFile });
const source = await fs.readFile(path.join(project, 'src/recovered/electron/ipc/vpn-service-manager.js'), 'utf8');
vm.runInContext(source, context);
const component = path.join(work, 'private-acl-parser', 'product', 'Runtime', 'Vpn');
const manager = new context.VpnServiceManager(work, work, work, component, {
  verifyRuntime: () => {}, checkPrivilege: () => false, clock: () => 0, sleep: () => {}, readNativeStatus: () => {},
  command: async (_, args) => { captured = Buffer.from(args.at(-1), 'base64').toString('utf16le'); return { stdout: 'VPN_PRIVATE_ACL_VERIFIED' }; }
});
await manager.protectDirectory(component, 'C:/Windows/System32');
const scriptPath = path.join(work, 'vpn-private-acl-source.ps1');
await fs.writeFile(scriptPath, captured, 'utf8');
const runner = path.join(work, 'vpn-private-acl-parser.ps1');
const command = promisify(execFile);
const result = await command('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', runner, '-SourcePath', scriptPath], { windowsHide: true, timeout: 10000, maxBuffer: 32768 });
console.log(result.stdout.trim());
