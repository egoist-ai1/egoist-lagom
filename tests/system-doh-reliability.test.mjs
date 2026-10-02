import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createSocket } from 'node:dgram';

function load(name, bindings, exports) {
  const source = process.env.LAGOM_DNS_BASELINE === '1'
    ? execFileSync('git', ['show', `b8662d3:src/recovered/${name}.js`], { encoding: 'utf8', windowsHide: true })
    : fs.readFileSync(`src/recovered/${name}.js`, 'utf8');
  const context = vm.createContext({ URL, Buffer, setTimeout, clearTimeout, console, structuredClone, ...bindings });
  vm.runInContext(`${source}\n;globalThis.exports = {${exports.join(',')}}`, context);
  return context.exports;
}

const { isValidIpLiteral } = load('shared/system-dns', {}, ['isValidIpLiteral']);
const secure = load('shared/secure-dns', { isValidIpLiteral }, ['parseCustomDnsUrl', 'normalizeCustomDnsUrl']);
const shared = load('shared/system-doh', secure, ['parseSystemDohUrl', 'normalizeSystemDohUrl', 'normalizeSystemDohLocalAddress', 'buildXrayLocalDohServerUrl']);
shared.SYSTEM_DOH_HEALTH_DOMAIN = 'health.egoist.invalid';
const config = load('electron/ipc/system-doh-manager', shared, ['buildSystemDohXrayConfig', 'resolveSystemDohBootstrapHosts', 'resolveSystemDohNativeServers']);
const { SystemDohManager, queryDnsServer, createDnsQuery, hasSuccessfulDnsAnswer, buildSystemDohServiceXml } = load('electron/ipc/system-doh-service-manager', {
  ...shared, path, process, createSocket,
  promisify: value => value, execFile: async () => { throw new Error('SCM unavailable'); },
  resolveWindowsExecutable: value => value,
  resolveSystemDohNativeServers: async () => ['192.0.2.53'],
  SYSTEM_DOH_VERIFICATION_DOMAINS: ['example.com'],
}, ['SystemDohManager', 'queryDnsServer', 'createDnsQuery', 'hasSuccessfulDnsAnswer', 'buildSystemDohServiceXml']);

function nativeFixture() {
  const calls = [];
  let state = { enabled: true, verified: true, encrypted: true, url: 'https://old.example/dns-query', servers: ['192.0.2.1'], fallbackToUdp: false };
  const manager = Object.create(SystemDohManager.prototype);
  Object.assign(manager, {
    lastError: null,
    coreService: {
      nativeDohStatus: async () => state,
      applyNativeDoh: async (url, servers) => { calls.push('apply'); state = { ...state, url, servers }; return state; },
      restoreOwnedDns: async () => { calls.push('restore'); return { pendingAdapters: 0 }; },
      removeNativeDoh: async () => { calls.push('remove'); return { ...state, enabled: false }; },
    },
    readManagedState: async () => null,
    removeServiceInternal: async () => calls.push('remove-service'),
    stopLegacyStandaloneRuntime: async () => calls.push('kill'),
    clearManagedState: async () => calls.push('clear'),
    status: async () => manager.mapNativeStatus(state),
  });
  return { manager, calls, getState: () => state, setState: value => { state = { ...state, ...value }; } };
}

test('native provider switch delegates one transaction without removing working DNS first', async () => {
  const { manager, calls } = nativeFixture();
  const result = await manager.apply('https://new.example/dns-query');
  assert.equal(result.currentUrl, 'https://new.example/dns-query');
  assert.deepEqual(calls, ['apply']);
});

test('failed native switch leaves restoration/removal untouched and retains previous provider', async () => {
  const { manager, calls, getState } = nativeFixture();
  manager.coreService.applyNativeDoh = async () => { calls.push('apply-failed'); throw new Error('target verification failed'); };
  await assert.rejects(manager.apply('https://new.example/dns-query'), /target verification failed/);
  assert.deepEqual(calls, ['apply-failed']);
  assert.equal(getState().url, 'https://old.example/dns-query');
});

test('same native URL is idempotent during failed health verification and cold recovery', async () => {
  const { manager, calls, setState } = nativeFixture();
  setState({ verified: false });
  assert.equal((await manager.apply('https://old.example/dns-query')).verified, false);
  assert.equal((await manager.recover({ enabled: true, url: 'https://old.example/dns-query' })).verified, false);
  assert.deepEqual(calls, []);
});

test('native-to-custom-port transition preserves working DNS until a safe transfer exists', async () => {
  const { manager, calls } = nativeFixture();
  await assert.rejects(manager.apply('https://new.example:8443/dns-query'), /безопасного переноса/);
  assert.deepEqual(calls, []);
});

test('parallel forced status reads share one probe, and an older generation cannot poison the cache', async () => {
  const manager = Object.create(SystemDohManager.prototype);
  const pending = [];
  manager.readStatus = () => new Promise(resolve => pending.push(resolve));
  const first = manager.status({ force: true });
  const repeated = manager.status({ force: true });
  assert.equal(pending.length, 1);
  manager.invalidateStatusCache();
  const newest = manager.status({ force: true });
  assert.equal(pending.length, 2);
  pending[1]({ value: 'new' });
  await newest;
  pending[0]({ value: 'old' });
  await Promise.all([first, repeated]);
  assert.equal((await manager.status()).value, 'new');
});

test('mutations on one DNS manager are serialized despite simultaneous UI requests', async () => {
  const { manager, calls } = nativeFixture();
  let active = 0, maxActive = 0;
  manager.coreService.applyNativeDoh = async (url, servers) => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--; calls.push(url);
    return { enabled: true, verified: true, encrypted: true, url, servers, fallbackToUdp: false };
  };
  await Promise.all(['one', 'two', 'three'].map(name => manager.apply(`https://${name}.example/dns-query`)));
  assert.equal(maxActive, 1);
  assert.deepEqual(calls, ['https://one.example/dns-query', 'https://two.example/dns-query', 'https://three.example/dns-query']);
});

test('failed SCM and CIM reads are unknown rather than proof that a DNS service is absent', async () => {
  const manager = new SystemDohManager('C:/resources', 'C:/app', 'C:/profile');
  assert.equal((await manager.queryServiceStatus()).state, 'unknown');
  manager.status = async () => ({ serviceState: 'unknown' });
  await assert.rejects(manager.apply('https://example.com/dns-query'), /проверить текущее состояние/);
});

test('custom resolver config does not silently send queries to other DNS operators', () => {
  const value = JSON.parse(config.buildSystemDohXrayConfig({ url: 'https://private.example/profile?token=sample', localAddress: '127.0.0.1', bootstrapHosts: { 'private.example': ['192.0.2.1'] } }));
  assert.deepEqual(value.dns.servers.map(item => item.address), ['https://private.example/profile?token=sample']);
  assert.notEqual(value.dns.enableParallelQuery, true);
  assert.equal(value.dns.serveStale, true);
  assert.equal(value.dns.serveExpiredTTL, 120);
  assert.equal(value.log.error, undefined, 'runtime logs must be rotated by the service wrapper');
});

test('explicit HTTPS fallback preserves order, pins its host and rejects plaintext', () => {
  const value = JSON.parse(config.buildSystemDohXrayConfig({ url: 'https://192.0.2.1/dns-query', localAddress: '127.0.0.1', fallbackUrls: ['https://dns.google/dns-query', 'https://dns.google/dns-query'] }));
  assert.deepEqual(value.dns.servers.map(item => item.address), ['https://192.0.2.1/dns-query', 'https://dns.google/dns-query']);
  assert.deepEqual(value.dns.hosts['dns.google'], ['8.8.8.8', '8.8.4.4']);
  assert.throws(() => config.buildSystemDohXrayConfig({ url: 'https://192.0.2.1/dns-query', localAddress: '127.0.0.1', fallbackUrls: ['udp://1.1.1.1'] }));
});

test('known provider bootstrap works without an external lookup or the system resolver', async () => {
  const hosts = await config.resolveSystemDohBootstrapHosts('https://dns.quad9.net/dns-query');
  assert.deepEqual(Array.from(hosts['dns.quad9.net']), ['9.9.9.9', '149.112.112.112']);
  for (const value of ['127.0.0.1oops', '127.00.0.1', '127.0.0.256', '0.0.0.0']) assert.equal(shared.normalizeSystemDohLocalAddress(value), '');
});

test('native provider IPv6 addresses require an explicit route flag and keep the selected operator', async () => {
  assert.deepEqual(Array.from(await config.resolveSystemDohNativeServers('https://dns.google/dns-query')), ['8.8.8.8', '8.8.4.4']);
  assert.deepEqual(Array.from(await config.resolveSystemDohNativeServers('https://dns.google/dns-query', { allowIpv6: true })), ['8.8.8.8', '8.8.4.4', '2001:4860:4860::8888', '2001:4860:4860::8844']);
});

test('failed encrypted bootstrap never falls through to plaintext or system DNS', async () => {
  let plaintextCalls = 0;
  const helpers = load('electron/ipc/system-doh-manager', {
    ...shared, AbortController,
    fetch: async () => { throw new Error('HTTPS unavailable'); },
    Resolver: class { setServers() { plaintextCalls++; } async resolve4() { return ['192.0.2.53']; } },
    lookup: async () => { plaintextCalls++; return [{ address: '192.0.2.53' }]; },
  }, ['resolveSystemDohBootstrapHosts']);
  await assert.rejects(helpers.resolveSystemDohBootstrapHosts('https://private.example/dns-query'), /HTTPS/);
  assert.equal(plaintextCalls, 0);
});

test('encrypted bootstrap bounds a stalled body and cancels it before retrying', { timeout: 4500 }, async () => {
  let calls = 0, firstSignal;
  const helpers = load('electron/ipc/system-doh-manager', {
    ...shared, AbortController,
    fetch: async (_url, { signal, redirect }) => {
      assert.equal(redirect, 'error', 'bootstrap must not follow a redirect to plaintext DNS');
      calls++;
      if (calls === 1) { firstSignal = signal; return { ok: true, json: () => new Promise(() => {}) }; }
      return { ok: true, json: async () => ({ Status: 0, Answer: [{ type: 1, data: '192.0.2.53' }] }) };
    },
  }, ['resolveSystemDohBootstrapHosts']);
  const started = Date.now();
  const hosts = await helpers.resolveSystemDohBootstrapHosts('https://private.example/dns-query');
  assert.deepEqual(Array.from(hosts['private.example']), ['192.0.2.53']);
  assert.equal(firstSignal.aborted, true);
  assert.equal(calls, 2);
  assert.ok(Date.now() - started < 4000);
});

test('local DNS advertises both loopbacks only when every listener was verified', async () => {
  const manager = Object.create(SystemDohManager.prototype);
  let verified = true;
  Object.assign(manager, {
    readManagedState: async () => ({ localAddress: '127.0.0.1', localPort: 53, url: 'https://resolver.example/dns-query' }),
    queryServiceStatus: async () => ({ installed: true, running: true, state: 'running', pid: 123 }),
    verifyDns: async () => verified, migrateLegacyStateIfNeeded: async () => {},
    getManagedRuntimeInfo: async () => ({ runtimePath: 'C:/xray.exe' }), getSourceRuntimeInfo: async () => null,
  });
  assert.deepEqual(Array.from((await manager.readStatus()).serverAddresses), ['127.0.0.1', '::1']);
  verified = false;
  assert.deepEqual(Array.from((await manager.readStatus()).serverAddresses), []);
});

test('service wrapper bounds logs to 10 MiB per file and retries prolonged failures', () => {
  const xml = buildSystemDohServiceXml({ runtimePath: 'C:/xray.exe', configPath: 'C:/config.json', workingDirectory: 'C:/runtime', serviceLogDirectory: 'C:/logs' });
  assert.match(xml, /<sizeThreshold>10240<\/sizeThreshold>/);
  assert.match(xml, /delay="60 sec"/);
  assert.match(xml, /<resetfailure>1 hour<\/resetfailure>/);
});

function dnsAnswer(query) {
  const answer = Buffer.from(query);
  answer.writeUInt16BE(0x8180, 2); answer.writeUInt16BE(1, 6);
  return Buffer.concat([answer, Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 10, 0, 4, 192, 0, 2, 10])]);
}

test('readiness rejects wrong questions, truncation, incomplete records and header-only success', () => {
  const query = createDnsQuery('example.com');
  assert.equal(hasSuccessfulDnsAnswer(dnsAnswer(query), query), true);
  const wrongQuestion = dnsAnswer(createDnsQuery('another.com'));
  const truncated = dnsAnswer(query); truncated.writeUInt16BE(0x8380, 2);
  const short = dnsAnswer(query).subarray(0, query.length + 12);
  const wrongId = dnsAnswer(query); wrongId.writeUInt16BE(0xffff, 0);
  for (const value of [wrongQuestion, truncated, short, wrongId, dnsAnswer(query).subarray(0, 12)]) assert.equal(hasSuccessfulDnsAnswer(value, query), false);
});

test('localhost DNS probe load recovers after malformed, truncated and dropped responses', { timeout: 15000 }, async t => {
  const server = createSocket('udp4');
  let mode = 'healthy', received = 0;
  server.on('message', (query, remote) => {
    received++;
    if (mode === 'drop') return;
    const answer = dnsAnswer(query);
    if (mode === 'wrong-question') answer[13] ^= 1;
    if (mode === 'truncated') answer.writeUInt16BE(0x8380, 2);
    server.send(mode === 'short' ? answer.subarray(0, 12) : answer, remote.port, remote.address);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.bind(0, '127.0.0.1', resolve); });
  t.after(() => server.close());
  const { port } = server.address();
  assert.ok(port > 1024);
  for (const failure of ['wrong-question', 'truncated', 'short', 'drop']) {
    mode = failure;
    await assert.rejects(queryDnsServer('127.0.0.1', port, 'example.com'));
    mode = 'healthy';
    assert.equal(await queryDnsServer('127.0.0.1', port, 'example.com'), true);
  }
  for (let batch = 0; batch < 8; batch++) {
    const results = await Promise.all(Array.from({ length: 32 }, () => queryDnsServer('127.0.0.1', port, 'example.com')));
    assert.equal(results.filter(Boolean).length, 32);
  }
  assert.equal(received, 264);
});

