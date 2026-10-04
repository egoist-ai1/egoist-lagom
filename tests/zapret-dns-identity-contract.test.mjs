import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadRecovered } from './load-recovered.mjs';

// Exercise the production execPowerShell adapter. Only its OS boundary is fake;
// no service, process, DNS, registry or real file is read or changed by this suite.
const root = 'C:\\Identity Fixture\\Runtime\\Zapret';
const wrapper = path.win32.join(root, 'service-wrapper', 'egoistshield-zapret-service.exe');
const image = path.win32.join(root, 'core', 'bin', 'winws.exe');
const birth = '2026-10-04T00:00:00.000Z';
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(output, options = {}) {
  const calls = [], reads = [];
  const stateText = JSON.stringify(options.savedState ?? { pid: 42, profile: 'Selected', startedAt: birth });
  const stateBytes = Buffer.from(stateText);
  const statePath = path.win32.join(root, '.egoistshield-standalone.json');
  const stat = { size: stateBytes.length, ino: 1, dev: 1, mtimeMs: 1, isFile: () => true, isSymbolicLink: () => false };
  const requireStatePath = file => { assert.equal(file, statePath); reads.push(file); };
  const promises = {
    lstat: async file => { requireStatePath(file); return stat; },
    realpath: async file => { requireStatePath(file); return file; },
    open: async (file, mode) => {
      requireStatePath(file); assert.equal(mode, 'r');
      return { stat: async () => stat, read: async buffer => ({ bytesRead: stateBytes.copy(buffer) }), close: async () => {} };
    },
  };
  const { ZapretManager } = loadRecovered('electron/ipc/zapret-manager', {
    path: path.win32, promises, createHash,
    package_default: { version: '3.8.0' }, logger: { warn() {} },
    promisify: fn => fn,
    resolveWindowsExecutable: name => path.win32.join('C:\\Windows\\System32', name),
    execFile: async (exe, args, executionOptions) => {
      calls.push({ exe, args: Array.from(args), options: executionOptions });
      if (options.error) throw options.error;
      return { stdout: typeof output === 'string' ? output : JSON.stringify(output), stderr: '' };
    },
  }, ['ZapretManager']);
  const manager = new ZapretManager('resources', 'app', 'user', root);
  assert.equal(manager.getServiceWrapperPaths().wrapperPath, wrapper);
  return { manager, calls, reads, stateText };
}
function assertReadOnlyPowerShell(call, expectedClass) {
  assert.equal(call.exe, 'C:\\Windows\\System32\\powershell.exe');
  assert.deepEqual(call.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
  assert.match(call.args[3], new RegExp('Get-CimInstance ' + expectedClass));
  assert.doesNotMatch(call.args[3], /Stop-Process|Start-Process|Set-DnsClient|netsh|Remove-|Set-Item|Start-Service|Stop-Service/);
  assert.equal(call.options.windowsHide, true);
  assert.equal(call.options.timeout, 8000);
}
const stopped = { state: 'Stopped', pid: 0, birth: null, image: wrapper };
const running = { state: 'Running', pid: 42, birth, image: wrapper };
const standalone = { pid: 42, birth, image, commandLine: '"' + image + '" --wf-tcp=443 "--hostlist-exclude=C:\\My Lists\\keep.txt" --dpi-desync=fake' };

test('execPowerShell returns stdout as a string through the actual adapter', async () => {
  const f = fixture('  output\r\n');
  assert.equal(await f.manager.execPowerShell('Get-CimInstance Win32_Service', 8000), '  output\r\n');
  assertReadOnlyPowerShell(f.calls[0], 'Win32_Service');
});
for (const [name, proof] of [['stopped', stopped], ['running', running]]) {
  test(name + ' owned service identity consumes actual execPowerShell string result', async () => {
    const f = fixture(' \r\n' + JSON.stringify(proof) + '\r\n ');
    assert.deepEqual(plain(await f.manager.readDnsProtectionServiceIdentity()), proof);
    assert.equal(f.calls.length, 1);
    assertReadOnlyPowerShell(f.calls[0], 'Win32_Service');
    assert.equal(f.reads.length, 0);
  });
}
for (const [name, proof] of [
  ['malformed JSON', '{broken'],
  ['foreign executable', { ...stopped, image: 'C:\\Foreign\\wrapper.exe' }],
  ['transitional service state', { ...running, state: 'Start Pending' }],
  ['running without PID', { ...running, pid: 0 }],
  ['running without birth', { ...running, birth: null }],
  ['invalid PID', { ...stopped, pid: -1 }],
]) {
  test('service identity refuses ' + name, async () => {
    const f = fixture(proof);
    await assert.rejects(f.manager.readDnsProtectionServiceIdentity(), /личность|Личность/);
    assert.equal(f.calls.length, 1);
    assertReadOnlyPowerShell(f.calls[0], 'Win32_Service');
  });
}
test('standalone identity consumes actual execPowerShell result and preserves saved profile and args', async () => {
  const f = fixture(standalone), value = plain(await f.manager.readDnsProtectionStandaloneIdentity());
  assert.equal(value.pid, 42);
  assert.equal(value.birth, birth);
  assert.equal(value.image, image);
  assert.equal(value.profile, 'Selected');
  assert.equal(value.arguments, '--wf-tcp=443 "--hostlist-exclude=C:\\My Lists\\keep.txt" --dpi-desync=fake');
  assert.equal(value.stateFingerprint, createHash('sha256').update(f.stateText).digest('hex'));
  assert.equal(f.calls.length, 1);
  assertReadOnlyPowerShell(f.calls[0], 'Win32_Process');
  assert.equal(f.reads.length, 3);
});
for (const [name, proof] of [
  ['malformed JSON', '{broken'],
  ['changed PID', { ...standalone, pid: 43 }],
  ['foreign executable', { ...standalone, image: 'C:\\Foreign\\winws.exe' }],
  ['recycled PID birth', { ...standalone, birth: '2026-10-04T00:01:00.000Z' }],
  ['foreign command executable', { ...standalone, commandLine: '"C:\\Foreign\\winws.exe" --wf-tcp=443' }],
  ['missing command', { ...standalone, commandLine: '' }],
]) {
  test('standalone identity refuses ' + name, async () => {
    const f = fixture(proof);
    await assert.rejects(f.manager.readDnsProtectionStandaloneIdentity(), /standalone Zapret; DNS сохранён/);
    assert.equal(f.calls.length, 1);
    assertReadOnlyPowerShell(f.calls[0], 'Win32_Process');
  });
}
for (const [name, method] of [['service', 'readDnsProtectionServiceIdentity'], ['standalone', 'readDnsProtectionStandaloneIdentity']]) {
  test(name + ' native query rejection is fail-closed and masks native output', async () => {
    const error = Object.assign(new Error('private-secret'), { code: 1, stdout: 'private-secret', stderr: 'private-secret' });
    const f = fixture({}, { error });
    await assert.rejects(f.manager[method](), value => /Не удалось подтвердить/.test(value.message) && !/private-secret/.test(value.message));
    assert.equal(f.calls.length, 1);
  });
}