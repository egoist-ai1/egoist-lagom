import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { z } from 'zod';
import { sourceFor } from './load-recovered.mjs';

// Production code is exercised against an owned pipe/OS fixture. This is not
// evidence that an installed medium-token GUI passed native authorization.
const channels = [
  ['system-doh:apply', 'https://cloudflare-dns.com/dns-query'],
  ['system-doh:reset'],
  ['system-doh:restart'],
  ['system:set-dns-servers', '1.1.1.1, 1.0.0.1'],
  ['system:reset-dns-servers'],
];
const plain = value => JSON.parse(JSON.stringify(value));

async function fixture(t, options = {}) {
  const base = path.resolve(process.env.LAGOM_TEST_TEMP || process.env.RUNNER_TEMP || os.tmpdir());
  const directory = await fs.mkdtemp(path.join(base, 'lagom-ordinary-core-'));
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\lagom-ordinary-fixture-${randomUUID()}` : path.join(directory, 'fixture.sock');
  const requests = [], effects = [], handlers = new Map(), sockets = new Set();
  const control = { packaged: true, admin: false, verifierAvailable: true, rejectHello: false, unknownHello: false, rejectMutation: false, localUnknown: false, ...options };
  let native = { supported: true, enabled: control.nativeEnabled !== false, verified: control.nativeEnabled !== false, encrypted: true, fallbackToUdp: false, servers: ['1.1.1.1'], url: channels[0][1] };
  let local = { serviceState: 'not-installed', serviceInstalled: false, serviceRunning: false, currentUrl: null };
  let context;
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let raw = '';
    socket.setEncoding('utf8');
    socket.on('data', data => {
      raw += data;
      if (!raw.includes('\n')) return;
      const request = JSON.parse(raw.slice(0, raw.indexOf('\n')));
      requests.push(request);
      let result, error;
      try {
        assert.equal(request.protocolVersion, 1);
        assert.match(request.requestId, /^electron:/);
        if (request.operation === 'hello') {
          assert.deepEqual(request.payload, {});
          if (control.rejectHello) throw Object.assign(new Error('Fixture client not authorized'), { code: 'CLIENT_NOT_AUTHORIZED' });
          result = control.unknownHello ? { protocolVersion: 1 } : {
            protocolVersion: 1, clientPid: process.pid, identityProbe: false, developmentOverride: false,
            ...control.helloPatch,
          };
        } else if (request.operation === 'component.query' || request.operation === 'component.execute') {
          const checked = context.validateComponentRequest({ id: request.requestId, ...request.payload, query: request.operation === 'component.query' });
          assert.equal(checked.component, 'SystemDoH');
          if (checked.method === 'status') result = control.localUnknown ? { ...local, serviceState: 'unknown' } : local;
          else {
            if (control.rejectMutation) throw Object.assign(new Error('Fixture Core mutation denied'), { code: 'OPERATION_FAILED' });
            effects.push(`worker:${checked.method}`);
            if (checked.method === 'apply') local = { serviceState: 'running', serviceInstalled: true, serviceRunning: true, running: true, verified: true, localAddress: '127.0.0.2', localPort: 53, currentUrl: checked.args[0], serverAddresses: ['127.0.0.2'] };
            if (checked.method === 'stopAndRemove') local = { ...local, serviceState: 'not-installed', serviceInstalled: false, serviceRunning: false, running: false };
            result = local;
          }
        } else if (request.operation === 'dns.doh.status') result = native;
        else if (request.operation === 'dns.doh.apply') {
          assert.deepEqual(Object.keys(request.payload).sort(), ['probeHosts', 'servers', 'url']);
          assert.equal(new URL(request.payload.url).protocol, 'https:');
          assert.ok(request.payload.servers.every(server => net.isIP(server)));
          if (control.rejectMutation) throw Object.assign(new Error('Fixture native DoH denied'), { code: 'OPERATION_FAILED' });
          effects.push('dns.doh.apply');
          native = { ...native, enabled: true, verified: true, url: request.payload.url, servers: request.payload.servers };
          result = native;
        } else if (request.operation === 'dns.doh.remove') {
          assert.deepEqual(request.payload, {}); effects.push('dns.doh.remove');
          native = { ...native, enabled: false, verified: false }; result = native;
        } else if (request.operation === 'dns.apply') {
          assert.deepEqual(Object.keys(request.payload).sort(), ['probeHosts', 'servers']);
          assert.ok(request.payload.servers.every(server => net.isIP(server)));
          if (control.rejectMutation) throw Object.assign(new Error('Fixture manual DNS denied'), { code: 'OPERATION_FAILED' });
          effects.push('dns.apply'); result = { servers: request.payload.servers };
        } else if (request.operation === 'dns.reset' || request.operation === 'dns.restore-owned') {
          assert.deepEqual(request.payload, {}); effects.push(request.operation); result = { pendingAdapters: 0 };
        } else throw new Error(`Unexpected fixture operation ${request.operation}`);
      } catch (cause) { error = { code: cause.code || 'FIXTURE_INVALID_REQUEST', message: cause.message, retryable: false }; }
      socket.end(JSON.stringify({ protocolVersion: 1, requestId: request.requestId, ok: !error, ...(error ? { error } : { result }) }) + '\n');
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    assert.ok(path.resolve(directory).startsWith(base + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  context = vm.createContext({
    z, URL, Buffer, console, structuredClone, randomUUID, path, promises: fs,
    setTimeout, clearTimeout, setInterval, clearInterval, logger, isIP: net.isIP,
    process: { platform: 'win32', pid: process.pid, env: { NODE_ENV: 'production' }, resourcesPath: directory, kill: (...args) => process.kill(...args) },
    fs: { existsSync: () => control.verifierAvailable },
    net: { createConnection: value => { assert.equal(value, '\\\\.\\pipe\\EgoistShield.Service.v1'); return net.createConnection(pipe); } },
    promisify: value => value,
    execFile: async (executable, args) => {
      if (args[0] === '--verify-pipe-server') {
        effects.push('identity-verifier');
        assert.equal(path.resolve(executable), path.join(directory, 'core-service', 'win-x64', 'EgoistShield.Service.exe'));
        assert.deepEqual(plain(args), ['--verify-pipe-server', '--pipe-name', 'EgoistShield.Service.v1', '--service-name', 'EgoistShieldCore']);
        return { stdout: JSON.stringify({ ok: true, serverProcessId: process.pid, serviceProcessId: process.pid }) };
      }
      effects.push('readonly-snapshot');
      assert.match(args.at(-1), /Get-DnsClientServerAddress/);
      return { stdout: '[{"InterfaceAlias":"Fixture","InterfaceIndex":7,"AddressFamily":2,"ServerAddresses":["192.0.2.53"]}]' };
    },
    app: { get isPackaged() { return control.packaged; }, getPath: () => directory },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    ShieldConnectionController: class {},
    syncWindowsLoginItemSettings() {}, applyLoggerSettings() {},
    normalizePersistedDisplayText: value => value,
    resolveWindowsExecutable: value => value,
    resolveSystemDohNativeServers: async () => ['1.1.1.1'],
    isGravitylessLoopbackDnsRequest: value => String(value).includes('127.0.0.1'),
    createAdapterDnsRollbackSnapshot: async (_records, reason) => ({ reason, fixture: true }),
    setSystemDnsServers: async value => { effects.push('direct:dns.apply'); return { ok: true, servers: value.split(/[,\s]+/).filter(Boolean) }; },
    resetSystemDnsServers: async () => { effects.push('direct:dns.reset'); return { ok: true, servers: [] }; },
  });
  for (const name of ['shared/system-dns', 'shared/secure-dns', 'shared/system-doh', 'electron/ipc/state-store', 'electron/ipc/ipc-schemas', 'electron/ipc/port-utils', 'electron/ipc/system-doh-service-manager']) vm.runInContext(sourceFor(name), context);
  vm.runInContext(syncFs.readFileSync('src/component-protocol.js', 'utf8'), context);
  vm.runInContext(syncFs.readFileSync('src/component-facade.js', 'utf8'), context);
  vm.runInContext(sourceFor('electron/ipc/handlers-system'), context);
  vm.runInContext('globalThis.store = new StateStore(app.getPath("userData")); globalThis.client = new CoreServiceClient(); globalThis.rawManager = new SystemDohManager(process.resourcesPath,process.resourcesPath,app.getPath("userData"),app.getPath("userData"),client);', context);
  await context.store.load();
  context.manager = control.unwrapped ? context.rawManager : context.useComponentService(context.rawManager, 'SystemDoH', context.client);
  context.runtime = { on() {}, isAdmin: async () => control.admin };
  vm.runInContext('registerSystemHandlers({window:{},stateStore:store,runtimeManager:runtime,systemDohManager:manager});', context);
  return { control, context, requests, effects, store: context.store,
    invoke: (channel, input) => handlers.get(channel)({}, input),
  };
}

for (const [channel, input] of channels) test(`production ${channel} accepts isAdmin=false through the confirmed Core contract`, async t => {
  const f = await fixture(t, { nativeEnabled: channel !== 'system-doh:apply' });
  assert.equal(await f.invoke('app:is-admin'), false);
  const result = await f.invoke(channel, input);
  assert.equal(result.ok, true, result.message);
  assert.equal(f.requests[0].operation, 'hello');
  assert.ok(f.requests.some(request => request.operation !== 'hello'));
  assert.equal(f.effects.some(effect => effect.startsWith('direct:')), false);
});

for (const condition of ['verifierAvailable', 'rejectHello', 'unknownHello']) test(`production DNS refuses ${condition} before snapshots or teardown`, async t => {
  for (const [channel, input] of channels) {
    const f = await fixture(t, { [condition]: condition === 'verifierAvailable' ? false : true });
    const before = plain(f.store.get());
    const result = await f.invoke(channel, input);
    assert.equal(result.ok, false);
    assert.match(result.message, /Core/);
    if (channel.startsWith('system-doh')) assert.equal(result.status, null);
    assert.equal(f.effects.some(effect => effect === 'readonly-snapshot' || effect.startsWith('direct:') || effect.startsWith('dns.') || effect.startsWith('worker:')), false);
    assert.deepEqual(plain(f.store.get()), before);
  }
});

test('a coreService property on an unwrapped DNS manager does not confer broker capability', async t => {
  for (const [channel, input] of channels.slice(0, 3)) {
    const f = await fixture(t, { unwrapped: true });
    assert.equal(f.context.rawManager.coreService, f.context.client);
    const result = await f.invoke(channel, input);
    assert.equal(result.ok, false);
    assert.equal(result.status, null);
    assert.equal(f.requests.length, 0);
    assert.equal(f.effects.length, 0);
  }
});

test('Core identity-probe, development-override, foreign PID and inner protocol replies cannot authorize DNS', async t => {
  for (const helloPatch of [{ identityProbe: true }, { developmentOverride: true }, { clientPid: process.pid + 1 }, { protocolVersion: 2 }]) {
    const f = await fixture(t, { helloPatch });
    const result = await f.invoke('system-doh:apply', channels[0][1]);
    assert.equal(result.ok, false);
    assert.equal(result.status, null);
    assert.deepEqual(f.requests.map(request => request.operation), ['hello']);
    assert.equal(f.effects.some(effect => effect === 'readonly-snapshot' || effect.startsWith('direct:') || effect.startsWith('dns.') || effect.startsWith('worker:')), false);
  }
});

test('wrapped custom-port DNS uses only the fixed SystemDoH worker and typed DNS operation', async t => {
  const f = await fixture(t, { nativeEnabled: false });
  const result = await f.invoke('system-doh:apply', 'https://cloudflare-dns.com:8443/dns-query');
  assert.equal(result.ok, true, result.message);
  const execute = f.requests.filter(request => request.operation === 'component.execute');
  assert.deepEqual(execute.map(request => request.payload.method), ['apply']);
  assert.equal(execute[0].payload.component, 'SystemDoH');
  assert.deepEqual(execute[0].payload.args, ['https://cloudflare-dns.com:8443/dns-query', '']);
  assert.equal(f.requests.some(request => request.operation === 'dns.doh.apply'), false);
  assert.equal(f.effects.some(effect => effect.startsWith('direct:')), false);
});

test('Core mutation failure preserves settings and never enables packaged direct fallback', async t => {
  const f = await fixture(t, { rejectMutation: true, nativeEnabled: false });
  const before = plain(f.store.get());
  for (const [channel, input] of [channels[0], channels[3]]) {
    const result = await f.invoke(channel, input);
    assert.equal(result.ok, false);
  }
  assert.deepEqual(plain(f.store.get()), before);
  assert.equal(f.effects.some(effect => effect.startsWith('direct:')), false);
});

test('an unknown local DNS state fails without a worker or native mutation', async t => {
  const f = await fixture(t, { localUnknown: true });
  const result = await f.invoke('system-doh:apply', channels[0][1]);
  assert.equal(result.ok, false);
  assert.equal(f.requests.some(request => request.operation === 'component.execute' || request.operation === 'dns.doh.apply'), false);
  assert.equal(f.effects.some(effect => effect.startsWith('direct:')), false);
});

test('development direct DNS retains the administrative gate even with a wrapped Core client', async t => {
  for (const [channel, input] of channels) {
    const f = await fixture(t, { packaged: false });
    const result = await f.invoke(channel, input);
    assert.equal(result.ok, false);
    assert.match(result.message, /администратор/);
    assert.equal(f.effects.some(effect => effect === 'readonly-snapshot' || effect.startsWith('direct:')), false);
  }
});

test('a replaced wrapped mutation is no longer recognized as a SystemDoH broker', async t => {
  const f = await fixture(t);
  f.context.manager.apply = async () => { throw new Error('A replaced direct method must never be invoked'); };
  const result = await f.invoke('system-doh:apply', channels[0][1]);
  assert.equal(result.ok, false);
  assert.equal(f.requests.length, 0);
  assert.equal(f.effects.length, 0);
});

test('packaged administrative GUI also refuses missing Core without using a direct DNS path', async t => {
  for (const [channel, input] of channels) {
    const f = await fixture(t, { admin: true, verifierAvailable: false });
    const result = await f.invoke(channel, input);
    assert.equal(result.ok, false);
    assert.equal(f.effects.length, 0);
  }
});

test('only the existing administrative development path may use direct DNS fallback', async t => {
  for (const [channel, input] of channels.slice(3)) {
    const f = await fixture(t, { packaged: false, admin: true, verifierAvailable: false });
    const result = await f.invoke(channel, input);
    assert.equal(result.ok, true, result.message);
    assert.equal(f.effects.filter(effect => effect.startsWith('direct:')).length, 1);
    assert.equal(f.requests.length, 0, 'the absent identity verifier prevents any pipe exchange');
  }
});
