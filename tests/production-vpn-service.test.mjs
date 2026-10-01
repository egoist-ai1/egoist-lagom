import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

const source = file => fs.readFile(file, 'utf8');
const context = vm.createContext({ z, URL, Buffer, path, promises: fs, execFile, promisify, createHash, randomUUID, performance, process, Date, setTimeout, clearTimeout,
  isIP: value => /^\d+\.\d+\.\d+\.\d+$/.test(value) ? 4 : 0,
  runtimeExecutionEnvironment: () => ({ ...process.env }),
  checkNativeExecutionPrivilege: async () => { throw new Error('Production privilege must not be invoked in a controlled lifecycle fixture'); },
  verifyNativeRuntimeForExecution: async () => { throw new Error('Production execution must not be invoked in a controlled lifecycle fixture'); } });
for (const file of ['src/recovered/electron/ipc/ipc-schemas.js', 'src/recovered/electron/ipc/config-builder.js', 'src/component-protocol.js', 'src/recovered/electron/ipc/vpn-service-manager.js']) vm.runInContext(await source(file), context);
const { VpnServiceManager, validateBackgroundVpnSnapshot, validateComponentRequest } = context;
const settings = context.AppSettingsSchema.parse({ autoStart: false, startMinimized: false, autoUpdate: true, useTunMode: false, killSwitch: false,
  autoConnect: false, notifications: true, allowTelemetry: false, dnsMode: 'auto', subscriptionUserAgent: 'egoistshield', runtimePath: '', routeMode: 'global' });
const snapshot = (id = 'old', protocol = 'socks') => ({ node: { id, name: id, protocol, server: '127.0.0.1', port: 19876, uri: '', metadata: {} }, settings: { ...settings }, domainRules: [], processRules: [] });
const plain = value => JSON.parse(JSON.stringify(value));

async function fixture(t, { installed = false, running = false, startType = 'auto' } = {}) {
  const root = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP || os.tmpdir(), 'vpn-service-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const resources = path.join(root, 'resources'), component = path.join(root, 'product', 'Runtime', 'Vpn');
  const wrapperSource = path.join(resources, 'runtime', 'zapret', 'service-wrapper', 'egoistshield-zapret-service.exe');
  await fs.mkdir(path.dirname(wrapperSource), { recursive: true });
  const wrapper = Buffer.from('controlled fixture: not executable'); await fs.writeFile(wrapperSource, wrapper);
  await fs.writeFile(path.join(resources, 'runtime', 'manifest.json'), JSON.stringify({ components: [{ name: 'zapret', files: [{ path: 'zapret/service-wrapper/egoistshield-zapret-service.exe', size: wrapper.length, sha256: createHash('sha256').update(wrapper).digest('hex') }] }] }));
  const state = { installed, running, startType: installed ? startType : 'not-installed', unknown: false, failStart: 0, failStop: false, failCheck: false, releases: 0, clock: 0 };
  const calls = [];
  const manager = new VpnServiceManager(resources, resources, root, component, {
    checkPrivilege: async () => true,
    verifyRuntime: async request => ({ runtimePath: request.runtimePath, systemDirectory: path.join(root, 'system32'), release() { state.releases++; } }),
    privateDirectory: async directory => { calls.push({ kind: 'private', directory }); await fs.mkdir(directory, { recursive: true }); },
    clock: () => state.clock,
    sleep: async time => { state.clock += time; },
    readNativeStatus: async () => {
      if (state.unknown) throw new Error('Controlled native metadata read failure');
      let connection = null; try { connection = JSON.parse(await fs.readFile(manager.connectionPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return { serviceName: 'EgoistShieldVpn', serviceInstalled: state.installed, serviceState: state.installed ? state.running ? 'running' : 'stopped' : 'not-installed',
        startType: state.startType, backgroundEnabled: state.installed && state.startType === 'auto', running: state.running,
        activeNodeId: connection?.nodeId ?? null, localHealth: state.running ? 'responsive' : 'unresponsive', observation: { state: 'observed' } };
    },
    command: async (executable, args) => {
      calls.push({ kind: path.basename(executable), args: [...args] });
      if (path.basename(executable) === 'sing-box.exe') { if (state.failCheck) throw new Error('Controlled invalid config'); return { stdout: '' }; }
      if (path.basename(executable) === 'sc.exe') {
        if (args[0] === 'config') state.startType = args[args.indexOf('start=') + 1];
        if (args[0] === 'stop') { if (state.failStop) { state.unknown = true; throw new Error('Controlled unconfirmed stop'); } state.running = false; }
      }
      if (path.basename(executable) === 'egoistshield-vpn-service.exe') {
        if (args[0] === 'install') { state.installed = true; state.running = false; }
        if (args[0] === 'start') { if (state.failStart-- > 0) throw new Error('Controlled failed start'); state.running = true; }
        if (args[0] === 'uninstall') { state.installed = false; state.running = false; state.startType = 'not-installed'; }
      }
      return { stdout: '' };
    }
  });
  if (installed) { await fs.mkdir(manager.stateRoot, { recursive: true }); await fs.mkdir(manager.componentRoot, { recursive: true }); const old = validateBackgroundVpnSnapshot(snapshot()); await manager.writeAtomic(manager.connectionPath, JSON.stringify(old)); await manager.writeAtomic(manager.configPath, old.config); }
  return { root, manager, state, calls };
}

test('R25: component accepts only the fixed background methods and mutations require serialization', () => {
  const request = method => ({ id: 'fixture', component: 'Vpn', method, args: [], query: true });
  assert.equal(validateComponentRequest(request('status')).method, 'status');
  for (const method of ['installService', 'startService', 'stopService', 'removeService', 'exec', 'constructor']) assert.throws(() => validateComponentRequest(request(method)));
});
test('R25: protected snapshot uses TUN, fixed local port, unique interface and digest, without mutating GUI settings', () => {
  const input = snapshot('chosen'); const record = plain(validateBackgroundVpnSnapshot(input)); const config = JSON.parse(record.config);
  assert.equal(input.settings.useTunMode, false); assert.equal(config.inbounds[0].listen, '127.0.0.1'); assert.equal(config.inbounds[0].listen_port, 10838);
  assert.equal(config.inbounds[1].interface_name, 'egoist-vpn'); assert.equal(config.inbounds[1].strict_route, true);
  assert.equal(createHash('sha256').update(record.config).digest('hex'), record.configSha256); assert.equal(config.log.level, 'error');
});
test('R25: custom runtime, GUI-only firewall, arbitrary config and oversized pipe input are rejected', () => {
  for (const patch of [{ runtimePath: 'C:\\user\\untrusted.exe' }, { killSwitch: true }]) { const value = snapshot(); Object.assign(value.settings, patch); assert.throws(() => validateBackgroundVpnSnapshot(value)); }
  assert.throws(() => validateBackgroundVpnSnapshot({ ...snapshot(), executable: 'calc.exe' }));
  const oversized = snapshot(); oversized.domainRules = Array.from({ length: 300 }, (_, index) => ({ id: String(index), domain: 'a'.repeat(400), mode: 'vpn' }));
  assert.throws(() => validateBackgroundVpnSnapshot(oversized), /лимит/);
});
test('R25: unknown native observation stays unknown and changes no files or SCM commands', async t => {
  const { manager, state, calls } = await fixture(t); state.unknown = true;
  const status = await manager.status(); assert.equal(status.running, null); assert.equal(status.serviceInstalled, null); assert.equal(status.backgroundEnabled, null);
  await assert.rejects(() => manager.installService(snapshot()), error => error.code === 'VPN_SERVICE_VALIDATION_FAILED');
  assert.equal(calls.some(call => call.kind === 'sc.exe'), false); await assert.rejects(fs.access(manager.connectionPath));
});
test('R25: install persists the chosen snapshot, config and fixed wrapper before starting, then stop disables automatic startup', async t => {
  const { manager, state, calls } = await fixture(t);
  const ready = await manager.installService(snapshot('chosen')); assert.equal(ready.running, true); assert.equal(ready.activeNodeId, 'chosen');
  const xml = await fs.readFile(manager.wrapperPath.replace(/\.exe$/, '.xml'), 'utf8'); assert.match(xml, /<arguments>--run-vpn-runtime<\/arguments>/); assert.match(xml, /keepFiles>3/);
  const saved = JSON.parse(await fs.readFile(manager.connectionPath)); assert.equal(saved.nodeId, 'chosen');
  assert.deepEqual(await fs.readFile(manager.configPath, 'utf8'), saved.config);
  const stopped = await manager.stopService(); assert.equal(stopped.running, false); assert.equal(state.startType, 'disabled');
  assert.equal(calls.filter(call => call.kind === 'egoistshield-vpn-service.exe' && call.args[0] === 'install').length, 1);
  assert.equal(state.releases, 2);
});
test('R25: native config rejection preserves an already running old service and bytes', async t => {
  const { manager, state, calls } = await fixture(t, { installed: true, running: true }); const before = await fs.readFile(manager.connectionPath); state.failCheck = true;
  await assert.rejects(() => manager.installService(snapshot('new')), error => error.code === 'VPN_SERVICE_VALIDATION_FAILED');
  assert.deepEqual(await fs.readFile(manager.connectionPath), before); assert.equal(state.running, true); assert.equal(calls.some(call => call.kind === 'sc.exe'), false);
});
test('R25: failed new start restores known old config, automatic policy and local readiness', async t => {
  const { manager, state } = await fixture(t, { installed: true, running: true }); const before = await fs.readFile(manager.connectionPath); state.failStart = 1;
  await assert.rejects(() => manager.installService(snapshot('new')), error => error.code === 'VPN_SERVICE_ROLLBACK_VERIFIED');
  assert.deepEqual(await fs.readFile(manager.connectionPath), before); assert.equal(state.running, true); assert.equal(state.startType, 'auto'); assert.equal((await manager.status()).activeNodeId, 'old');
});
test('R25: failed first start removes only the partially created service and does not retain a new intent snapshot', async t => {
  const { manager, state } = await fixture(t); state.failStart = 1;
  await assert.rejects(() => manager.installService(snapshot('new')), error => error.code === 'VPN_SERVICE_ROLLBACK_VERIFIED');
  assert.equal(state.installed, false); assert.equal(state.running, false); await assert.rejects(fs.access(manager.connectionPath));
});
test('R25: unconfirmed old stop never replaces old config and carries an unknown-outcome code', async t => {
  const { manager, state } = await fixture(t, { installed: true, running: true }); const before = await fs.readFile(manager.connectionPath); state.failStop = true;
  await assert.rejects(() => manager.installService(snapshot('new')), error => error.code === 'VPN_SERVICE_ROLLBACK_UNKNOWN');
  assert.deepEqual(await fs.readFile(manager.connectionPath), before);
});
test('R25: removal keeps configuration if actual service removal is not confirmed', async t => {
  const { manager, state } = await fixture(t, { installed: true }); const original = manager.command;
  manager.command = async (file, args, options) => args[0] === 'uninstall' ? { stdout: '' } : original(file, args, options);
  await assert.rejects(() => manager.removeService(), /не подтверждено/); assert.equal(state.installed, true); await fs.access(manager.connectionPath);
});
test('R25: worker method queue prevents overlapping settings and service lifecycle effects', async t => {
  const { manager, calls } = await fixture(t);
  await Promise.all([manager.installService(snapshot('first')), manager.installService(snapshot('second')), manager.stopService()]);
  assert.equal((await manager.status()).activeNodeId, 'second'); assert.equal((await manager.status()).running, false);
  assert.equal(calls.filter(call => call.kind === 'egoistshield-vpn-service.exe' && call.args[0] === 'install').length, 1);
});

test('R25: actual pinned sing-box validates all nine generated protocol configurations without starting TUN', async t => {
  const resources = process.env.SHIELD_VPN_PINNED_RESOURCES || path.resolve('recovery/official-app/resources');
  const executable = path.join(resources, 'runtime', 'sing-box', 'sing-box.exe');
  try { await fs.access(executable); } catch { t.skip('Native packaged sing-box is absent here; native candidate acceptance is required.'); return; }
  const manifest = JSON.parse(await fs.readFile(path.join(resources, 'runtime', 'manifest.json'), 'utf8'));
  const pin = manifest.components.find(item => item.name === 'sing-box').files.find(item => item.path === 'sing-box/sing-box.exe');
  const bytes = await fs.readFile(executable); assert.equal(bytes.length, pin.size); assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
  const root = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP || os.tmpdir(), 'vpn-native-check-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cases = ['vless', 'vmess', 'trojan', 'shadowsocks', 'socks', 'http', 'hysteria2', 'tuic', 'wireguard'];
  for (const protocol of cases) {
    const value = snapshot(protocol, protocol);
    value.node.metadata = { id: 'fdd68098-080e-4bba-a0c6-e3063d2ec1d7', uuid: 'fdd68098-080e-4bba-a0c6-e3063d2ec1d7', password: 'fixture-not-a-secret', method: 'aes-128-gcm', private_key: Buffer.alloc(32, 1).toString('base64'), public_key: Buffer.alloc(32, 2).toString('base64') };
    const record = validateBackgroundVpnSnapshot(value); const file = path.join(root, protocol + '.json'); await fs.writeFile(file, record.config);
    await promisify(execFile)(executable, ['check', '-c', file], { windowsHide: true, timeout: 15000, maxBuffer: 65536, cwd: path.dirname(executable) });
  }
});
