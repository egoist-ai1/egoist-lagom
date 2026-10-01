import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { isIP, createConnection, createServer } from 'node:net';
import { execFileSync } from 'node:child_process';

// An explicit source root allows the identical protocol checks against the
// preserved pre-fix modules. All transports below bind only to loopback.
function load(name, bindings, names) {
  const root = process.env.LAGOM_NETWORK_BASELINE_ROOT || 'src/recovered/electron/ipc';
  const context = vm.createContext({ URL, Buffer, Date, performance, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval, console, ...bindings });
  vm.runInContext(fs.readFileSync(path.join(root, name + '.js'), 'utf8') +
    '\n;globalThis.result = {' + names.join(',') + '};', context);
  return context.result;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function recordNetworkEvidence(name, values) {
  const target = process.env.LAGOM_NETWORK_EVIDENCE_PATH;
  if (!target) return;
  const current = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
  current[name] = values; fs.writeFileSync(target, JSON.stringify(current, null, 2) + '\n');
}
const dnsApi = () => load('gravityless-dns-manager', { promisify: fn => fn, execFile() {}, dgram, createConnection },
  ['buildDnsAQuery', 'isValidGravitylessDnsAnswer', 'queryDnsARecord', 'queryDnsARecordTcp']);
function answer(query, changes = {}) {
  const header = Buffer.from(query.subarray(0, 12));
  header.writeUInt16BE(changes.flags ?? 0x8180, 2);
  header.writeUInt16BE(1, 6);
  const rr = Buffer.from([0xc0, 12, 0, changes.type ?? 1, 0, changes.class ?? 1,
    0, 0, 0, 60, 0, 4, 192, 0, 2, 123]);
  return Buffer.concat([header, query.subarray(12), rr]);
}
function compressedAliasAnswer(query, options = {}) {
  const header = Buffer.from(query.subarray(0, 12));
  header.writeUInt16BE(0x8180, 2); header.writeUInt16BE(2, 6);
  const rrHeader = (type, bytes) => { const buffer = Buffer.alloc(10); buffer.writeUInt16BE(type, 0);
    buffer.writeUInt16BE(1, 2); buffer.writeUInt32BE(60, 4); buffer.writeUInt16BE(bytes, 8); return buffer; };
  const pointer = offset => Buffer.from([0xc0 | offset >> 8, offset & 255]);
  const target = Buffer.concat([Buffer.from([5]), Buffer.from('alias'), pointer(12)]);
  const aliasOffset = query.length + 12;
  const first = Buffer.concat([pointer(12), rrHeader(5, target.length), target]);
  const second = options.loop
    ? Buffer.concat([pointer(aliasOffset), rrHeader(5, 2), pointer(12)])
    : Buffer.concat([pointer(options.unrelated ? 12 : aliasOffset), rrHeader(1, 4), Buffer.from([192, 0, 2, 8])]);
  return Buffer.concat([header, query.subarray(12), first, second]);
}
test('DNS requires complete matching question and usable A records', () => {
  const api = dnsApi(), query = api.buildDnsAQuery('fixture.example', 0x1234);
  const valid = answer(query);
  assert.equal(api.isValidGravitylessDnsAnswer(valid, 0x1234, 'fixture.example'), true);
  const badQuestion = answer(api.buildDnsAQuery('foreign.example', 0x1234));
  const loop = Buffer.from(valid); loop[query.length] = 0xc0;
  loop[query.length + 1] = query.length;
  const badCases = [valid.subarray(0, 12), valid.subarray(0, -1), badQuestion,
    answer(query, { flags: 0x8380 }), answer(query, { flags: 0x8980 }),
    answer(query, { type: 16 }), answer(query, { class: 3 }), loop,
    Buffer.concat([valid, Buffer.from([1])])];
  for (const message of badCases) assert.equal(api.isValidGravitylessDnsAnswer(message, 0x1234, 'fixture.example'), false);
  assert.equal(api.isValidGravitylessDnsAnswer(valid, 0x4321, 'fixture.example'), false);
});
test('DNS compressed CNAME answers resolve the question chain and reject cycles', () => {
  const api = dnsApi(), query = api.buildDnsAQuery('fixture.example', 0x3210);
  assert.equal(api.isValidGravitylessDnsAnswer(compressedAliasAnswer(query), 0x3210, 'fixture.example'), true);
  assert.equal(api.isValidGravitylessDnsAnswer(compressedAliasAnswer(query, { loop: true }), 0x3210, 'fixture.example'), false);
  const dangling = compressedAliasAnswer(query); dangling.writeUInt16BE(0xc00c, query.length + 20);
  assert.equal(api.isValidGravitylessDnsAnswer(dangling, 0x3210, 'fixture.example'), false);
});
test('actual UDP ignores foreign source and bad packets, then accepts only its resolver response', async t => {
  const own = dgram.createSocket('udp4'), foreign = dgram.createSocket('udp4');
  let validTimer;
  await Promise.all([new Promise(r => own.bind(0, '127.0.0.1', r)), new Promise(r => foreign.bind(0, '127.0.0.1', r))]);
  t.after(() => { clearTimeout(validTimer); own.close(); foreign.close(); });
  own.on('message', (query, remote) => {
    foreign.send(answer(query), remote.port, remote.address);
    own.send(answer(query).subarray(0, 12), remote.port, remote.address);
    validTimer = setTimeout(() => own.send(answer(query), remote.port, remote.address), 35);
  });
  const started = performance.now();
  assert.equal(await dnsApi().queryDnsARecord('fixture.example', '127.0.0.1', own.address().port, 500), true);
  assert.ok(performance.now() - started >= 25, 'foreign/header-only packet completed the probe');
});
test('actual UDP malformed-only response times out and releases the socket', async t => {
  const server = dgram.createSocket('udp4');
  await new Promise(r => server.bind(0, '127.0.0.1', r));
  t.after(() => server.close());
  server.on('message', (query, remote) => server.send(answer(query).subarray(0, 12), remote.port, remote.address));
  await assert.rejects(dnsApi().queryDnsARecord('fixture.example', '127.0.0.1', server.address().port, 70), /timeout/i);
});
test('actual fragmented DNS TCP accepts only a complete matching compressed answer and closes its connection', async t => {
  const sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
    socket.once('data', frame => {
      const message = compressedAliasAnswer(frame.subarray(2));
      const response = Buffer.alloc(message.length + 2); response.writeUInt16BE(message.length); message.copy(response, 2);
      socket.write(response.subarray(0, 1)); setTimeout(() => { if (!socket.destroyed) socket.write(response.subarray(1, 9)); }, 4);
      setTimeout(() => { if (!socket.destroyed) socket.end(response.subarray(9)); }, 12);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(r => server.close(r)); });
  assert.equal(await dnsApi().queryDnsARecordTcp('fixture.example', '127.0.0.1', server.address().port, 300), true);
  await wait(20); assert.equal(sockets.size, 0);
});
test('actual DNS TCP rejects mismatched/truncated/excess frames and stops drip at an absolute deadline', async t => {
  const sockets = new Set(), intervals = new Set(); let mode = 'mismatched';
  const server = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
    socket.once('data', frame => {
      const query = frame.subarray(2), message = answer(query);
      const response = Buffer.alloc(message.length + 2); response.writeUInt16BE(message.length); message.copy(response, 2);
      if (mode === 'mismatched') { response.writeUInt16BE((message.readUInt16BE(0) + 1) % 65536, 2); socket.end(response); }
      else if (mode === 'truncated') socket.end(response.subarray(0, -1));
      else if (mode === 'excess') socket.end(Buffer.concat([response, Buffer.from([1])]));
      else { socket.write(response.subarray(0, 2)); let offset = 2;
        const timer = setInterval(() => { if (!socket.destroyed) socket.write(response.subarray(offset, ++offset)); }, 10);
        intervals.add(timer); socket.once('close', () => { clearInterval(timer); intervals.delete(timer); }); }
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { for (const timer of intervals) clearInterval(timer); for (const socket of sockets) socket.destroy(); await new Promise(r => server.close(r)); });
  for (mode of ['mismatched', 'truncated', 'excess']) await assert.rejects(dnsApi().queryDnsARecordTcp('fixture.example', '127.0.0.1', server.address().port, 300));
  mode = 'drip'; const started = performance.now();
  await assert.rejects(dnsApi().queryDnsARecordTcp('fixture.example', '127.0.0.1', server.address().port, 70), /timeout/i);
  assert.ok(performance.now() - started < 250);
  await wait(20); assert.equal(sockets.size, 0); assert.equal(intervals.size, 0);
});
test('actual UDP and DNS TCP cancellation release every owned socket', async t => {
  const clientSockets = new Set(), tcpSockets = new Set();
  const countedDgram = { createSocket(...args) { const socket = dgram.createSocket(...args); clientSockets.add(socket);
    socket.once('close', () => clientSockets.delete(socket)); return socket; } };
  const udp = dgram.createSocket('udp4'), tcp = createServer(socket => { tcpSockets.add(socket); socket.resume();
    socket.on('error', () => {}); socket.once('close', () => tcpSockets.delete(socket)); });
  await Promise.all([new Promise(r => udp.bind(0, '127.0.0.1', r)), new Promise(r => tcp.listen(0, '127.0.0.1', r))]);
  t.after(async () => { for (const socket of tcpSockets) socket.destroy(); udp.close(); await new Promise(r => tcp.close(r)); });
  const api = load('gravityless-dns-manager', { promisify: fn => fn, execFile() {}, dgram: countedDgram, createConnection }, ['queryDnsARecord', 'queryDnsARecordTcp']);
  for (let batch = 0; batch < 8; batch++) {
    const controllers = Array.from({ length: 8 }, () => new AbortController());
    const requests = controllers.map((controller, index) => api[index % 2 ? 'queryDnsARecordTcp' : 'queryDnsARecord'](
      'fixture.example', '127.0.0.1', index % 2 ? tcp.address().port : udp.address().port, 300, controller.signal));
    await wait(5); controllers.forEach(controller => controller.abort(new Error('own fixture cancellation')));
    const results = await Promise.allSettled(requests); assert.ok(results.every(result => result.status === 'rejected'));
  }
  await wait(25); assert.equal(clientSockets.size, 0); assert.equal(tcpSockets.size, 0);
  recordNetworkEvidence('dnsCancellation', { requests: 64, cancelled: 64, clientUdpSocketsRemaining: clientSockets.size, serverTcpSocketsRemaining: tcpSockets.size });
  t.diagnostic('64 actual DNS UDP/TCP cancellations; owned client UDP/server TCP sockets=0');
});
test('actual UDP stress rejects foreign, mismatched and compressed-cycle packets before valid answers', async t => {
  const own = dgram.createSocket('udp4'), foreign = dgram.createSocket('udp4'), clients = new Set(), timers = new Set();
  const countedDgram = { createSocket(...args) { const socket = dgram.createSocket(...args); clients.add(socket);
    socket.once('close', () => clients.delete(socket)); return socket; } };
  await Promise.all([new Promise(r => own.bind(0, '127.0.0.1', r)), new Promise(r => foreign.bind(0, '127.0.0.1', r))]);
  t.after(() => { for (const timer of timers) clearTimeout(timer); own.close(); foreign.close(); });
  let packets = 0;
  own.on('message', (query, remote) => {
    const wrongId = answer(query); wrongId.writeUInt16BE((query.readUInt16BE(0) + 1) % 65536);
    const messages = [answer(query).subarray(0, 12), wrongId, compressedAliasAnswer(query, { loop: true }), answer(query).subarray(0, -1)];
    for (const message of messages) { own.send(message, remote.port, remote.address); packets++; }
    foreign.send(answer(query), remote.port, remote.address); packets++;
    const timer = setTimeout(() => { timers.delete(timer); own.send(compressedAliasAnswer(query), remote.port, remote.address); packets++; }, 5); timers.add(timer);
  });
  const api = load('gravityless-dns-manager', { promisify: fn => fn, execFile() {}, dgram: countedDgram }, ['queryDnsARecord']);
  const started = performance.now(); let successes = 0;
  for (let batch = 0; batch < 32; batch++) {
    const results = await Promise.all(Array.from({ length: 8 }, () => api.queryDnsARecord('fixture.example', '127.0.0.1', own.address().port, 1000)));
    assert.ok(results.every(result => result === true)); successes += results.length;
  }
  await wait(20); assert.equal(clients.size, 0); assert.equal(timers.size, 0);
  const evidence = { requests: 256, successes, malformedOrForeignPackets: 1280, totalPeerPackets: packets, elapsedMs: Number((performance.now() - started).toFixed(3)), clientSocketsRemaining: clients.size };
  assert.equal(packets, 1536); recordNetworkEvidence('dnsUdpStress', evidence); t.diagnostic(JSON.stringify(evidence));
});
const routeApi = () => load('route-probe', { isIP }, ['buildRouteProbeResult']);
test('TUN route coverage is unknown without observed Windows interface/routes', () => {
  const result = routeApi().buildRouteProbeResult({ mode: 'tun', directIp: '203.0.113.1', vpnIp: '203.0.113.2' });
  assert.equal(result.verdict, 'inconclusive');
  assert.equal(result.bypassDetected, false);
});
test('a shared TUN exit is not evidence of a bypass', () => {
  const result = routeApi().buildRouteProbeResult({ mode: 'tun', directIp: '203.0.113.2', vpnIp: '203.0.113.2' });
  assert.equal(result.bypassDetected, false);
  assert.equal(result.checks.find(x => x.id === 'egress-changed').status, 'skipped');
});
test('TUN route observations must include both distinct control destinations and matching prefixes', () => {
  const evidence = { interfaceName: 'egoist-tun', interfaceIndex: 15, interfaceUp: true,
    runtimeInstanceUnchanged: true, selectedRoutes: [
      { destination: '1.1.1.1', interfaceIndex: 15, prefix: '0.0.0.0/1' },
      { destination: '8.8.8.8', interfaceIndex: 15, prefix: '0.0.0.0/1' }] };
  const report = value => routeApi().buildRouteProbeResult({ mode: 'tun', vpnIp: '203.0.113.2', tunEvidence: value });
  assert.equal(report(evidence).verdict, 'partial');
  for (const selectedRoutes of [[evidence.selectedRoutes[0], evidence.selectedRoutes[0]],
    [evidence.selectedRoutes[0], { ...evidence.selectedRoutes[1], prefix: '192.0.2.0/24' }],
    [evidence.selectedRoutes[0], { ...evidence.selectedRoutes[1], prefix: 'malformed' }]]) {
    assert.equal(report({ ...evidence, selectedRoutes }).verdict, 'inconclusive');
  }
});
test('a foreign working DNS endpoint cannot declare our stopped or unknown service running', async () => {
  const { GravitylessDnsManager } = load('gravityless-dns-manager', {
    path, resolveGravitylessDnsPaths: () => ({}), promisify: fn => fn, execFile() {},
    GRAVITYLESS_DNS_EXE_NAME: 'fixture.exe',
  }, ['GravitylessDnsManager']);
  const manager = new GravitylessDnsManager('fixture');
  manager.verifyLocalDns = async () => true;
  manager.pathExists = async () => true;
  for (const state of ['stopped', 'unknown']) {
    manager.queryService = async () => ({ state });
    const result = await manager.readStatus();
    assert.equal(result.running, false); assert.equal(result.serviceRunning, false);
    assert.equal(result.resolutionVerified, true); assert.equal(result.resolverIdentityVerified, null);
  }
});
test('IPv6 aliases do not report a changed exit and retain original display addresses', () => {
  const directIp = '2001:db8:0:0:0:0:0:1', vpnIp = '2001:DB8::1';
  const result = routeApi().buildRouteProbeResult({ mode: 'system_proxy', directIp, vpnIp });
  assert.equal(result.checks.find(x => x.id === 'egress-changed').status, 'fail');
  assert.equal(result.directIp, directIp); assert.equal(result.vpnIp, vpnIp);
  assert.ok(result.limitations.some(x => x.includes('IPv6')));
  assert.ok(result.limitations.every(x => !x.includes('только IPv4')));
});
test('network ports containing 401/403 do not disable automatic reconnect', () => {
  const { classifyReconnectFailure } = load('vpn-reconnect-supervisor', {}, ['classifyReconnectFailure']);
  assert.equal(classifyReconnectFailure('connect ECONNREFUSED 203.0.113.40:40123'), 'network');
  assert.equal(classifyReconnectFailure('connect ETIMEDOUT 203.0.113.40:40301'), 'network');
  assert.equal(classifyReconnectFailure({ code: 'ECONNREFUSED', port: 40123, message: 'connection refused' }), 'network');
  assert.equal(classifyReconnectFailure({ status: 401, message: 'upstream rejected' }), 'auth');
  assert.equal(classifyReconnectFailure({ statusCode: 403 }), 'auth');
  assert.equal(classifyReconnectFailure('HTTP 401 Unauthorized'), 'auth');
});
test('DNS resolver IPv6 aliases compare equally and expanded loopback stays a local forwarder', () => {
  const { buildDnsLeakTestResult } = load('dns-leak-test', { isIP }, ['buildDnsLeakTestResult']);
  const equivalent = buildDnsLeakTestResult({ mode: 'app-managed', resolverIp: '2001:db8:0:0:0:0:0:1', expectedResolvers: ['2001:DB8::1'], resolutionWorks: true });
  assert.equal(equivalent.checks.find(x => x.id === 'dns-path').status, 'pass');
  const loopback = buildDnsLeakTestResult({ mode: 'app-managed', resolverIp: '192.0.2.53', expectedResolvers: ['0:0:0:0:0:0:0:1'], resolutionWorks: true });
  assert.equal(loopback.checks.find(x => x.id === 'dns-path').status, 'warn');
});
test('an external recursor address is an observation, not evidence of a managed DNS bypass or complete protection', () => {
  const { buildDnsLeakTestResult } = load('dns-leak-test', { isIP }, ['buildDnsLeakTestResult']);
  const result = resolverIp => buildDnsLeakTestResult({ mode: 'app-managed', resolverIp, expectedResolvers: ['1.1.1.1'], resolutionWorks: true });
  assert.equal(result('192.0.2.53').bypassDetected, false);
  assert.equal(result('192.0.2.53').verdict, 'partial');
  assert.equal(result('1.1.1.1').verdict, 'partial');
});
test('IPv4 and IPv6 observations do not by themselves prove a changed exit', () => {
  const result = routeApi().buildRouteProbeResult({ mode: 'system_proxy', directIp: '192.0.2.1', vpnIp: '2001:db8::1' });
  assert.equal(result.checks.find(x => x.id === 'egress-changed').status, 'warn');
});
test('monotonic DNS freshness survives rollback/forward and discards late generations', async () => {
  let wall = Date.now(), monotonic = 1000, reads = 0, live = true;
  class VirtualDate extends Date { static now() { return wall; } }
  const { GravitylessDnsManager } = load('gravityless-dns-manager', {
    path, resolveGravitylessDnsPaths: () => ({}), promisify: x => x, execFile() {},
    Date: VirtualDate, performance: { now: () => monotonic },
  }, ['GravitylessDnsManager']);
  const manager = new GravitylessDnsManager('fixture');
  manager.readStatus = async () => { reads++; return { running: live, verified: live }; };
  assert.equal((await manager.status()).running, true);
  live = false; wall -= 90 * 86400000; monotonic += 3100;
  assert.equal((await manager.status()).running, false);
  assert.equal(reads, 2);
  wall += 180 * 86400000;
  await manager.status(); assert.equal(reads, 2, 'wall jump should not invalidate a fresh monotonic sample');
  let oldRelease;
  manager.readStatus = () => new Promise(resolve => { oldRelease = resolve; });
  const old = manager.status({ force: true });
  manager.invalidateStatusCache(); manager.readStatus = async () => ({ running: false, verified: false });
  await manager.status({ force: true }); oldRelease({ running: true, verified: true }); await old;
  assert.equal((await manager.status()).running, false);
});
const vpnApi = extra => load('handlers-vpn', { process: { env: {} }, http, tls, performance,
  app: { getVersion: () => 'fixture' }, ...extra },
  ['openRouteProbeTls', 'measureDownloadEndpoint', 'measureUploadEndpoint']);
test('actual CONNECT drip cannot extend the absolute handshake budget', async t => {
  const server = http.createServer(), sockets = new Set(), drips = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); });
  server.on('connect', (_req, socket) => {
    socket.write('HTTP/1.1 200 Connection Established\r\nX-Drip: ');
    const interval = setInterval(() => { if (!socket.destroyed) socket.write('a'); }, 10);
    drips.add(interval); socket.once('close', () => { clearInterval(interval); drips.delete(interval); });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { for (const i of drips) clearInterval(i); for (const s of sockets) s.destroy(); await new Promise(r => server.close(r)); });
  const caller = new AbortController(), cutoff = setTimeout(() => caller.abort(), 350);
  const started = performance.now();
  await assert.rejects(vpnApi().openRouteProbeTls({ name: 'own drip', host: 'fixture.example' }, server.address().port, 70, caller.signal));
  const elapsed = performance.now() - started; clearTimeout(cutoff);
  assert.ok(elapsed < 250, `drip held the operation for ${elapsed.toFixed(2)} ms`);
  await wait(35); assert.equal(sockets.size, 0);
  recordNetworkEvidence('connectDrip', { deadlineMs: 70, elapsedMs: Number(elapsed.toFixed(3)), serverSocketsRemaining: sockets.size });
  t.diagnostic(`CONNECT elapsed=${elapsed.toFixed(2)} ms, deadline=70 ms, caller safety cutoff=350 ms, own server sockets=0`);
});
test('actual stalled CONNECT cancellation stops every owned connection', async t => {
  const server = http.createServer(), sockets = new Set(), clients = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); });
  server.on('connect', (_request, socket) => { socket.once('end', () => socket.end()); socket.resume(); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(r => server.close(r)); });
  const countedHttp = { ...http, request(...args) { const request = http.request(...args); request.once('socket', socket => {
    clients.add(socket); socket.once('close', () => clients.delete(socket)); }); return request; } };
  const api = vpnApi({ http: countedHttp }), started = performance.now();
  for (let batch = 0; batch < 8; batch++) {
    const controllers = Array.from({ length: 8 }, () => new AbortController());
    const requests = controllers.map(controller => api.openRouteProbeTls({ name: 'own cancelled CONNECT', host: 'fixture.example' }, server.address().port, 1000, controller.signal));
    await wait(7); controllers.forEach(controller => controller.abort());
    const results = await Promise.allSettled(requests); assert.ok(results.every(result => result.status === 'rejected'));
  }
  await wait(25); assert.equal(sockets.size, 0); assert.equal(clients.size, 0);
  const evidence = { requests: 64, cancelled: 64, elapsedMs: Number((performance.now() - started).toFixed(3)), clientSocketsRemaining: clients.size, serverSocketsRemaining: sockets.size };
  recordNetworkEvidence('connectCancellation', evidence); t.diagnostic(JSON.stringify(evidence));
});
async function tlsLab(t, responder) {
  const work = process.env.LAGOM_DNS_TEST_WORK, python = process.env.LAGOM_DNS_TEST_PYTHON, openssl = process.env.LAGOM_DNS_TEST_OPENSSL;
  if (!work || !python && !openssl) { t.skip('Set task-owned LAGOM_DNS_TEST_WORK and Python/openssl for real TLS'); return null; }
  const dir = await fsp.mkdtemp(path.join(work, 'net-tls-'));
  const keyPath = path.join(dir, 'key.pem'), certPath = path.join(dir, 'cert.pem');
  if (openssl) execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=fixture.example', '-addext', 'subjectAltName=DNS:fixture.example', '-keyout', keyPath, '-out', certPath], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
  else execFileSync(python, ['-c', `
from pathlib import Path
from datetime import datetime,timedelta,timezone
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
import sys
k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'fixture.example')]);now=datetime.now(timezone.utc)
c=(x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=1)).not_valid_after(now+timedelta(days=2)).add_extension(x509.SubjectAlternativeName([x509.DNSName('fixture.example')]),False).add_extension(x509.BasicConstraints(ca=True,path_length=None),True).sign(k,hashes.SHA256()))
Path(sys.argv[1]).write_bytes(k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));Path(sys.argv[2]).write_bytes(c.public_bytes(serialization.Encoding.PEM))
`, keyPath, certPath], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
  const cert = await fsp.readFile(certPath), key = await fsp.readFile(keyPath);
  const server = https.createServer({ cert, key }, responder), sockets = new Set();
  server.on('connection', s => { sockets.add(s); s.on('error', () => {}); s.on('close', () => sockets.delete(s)); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); for (const s of sockets) s.destroy(); await new Promise(r => server.close(r));
    const relative = path.relative(path.resolve(work), path.resolve(dir));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await fsp.rm(dir, { recursive: true }); });
  const trustedTls = { ...tls, connect: (options, callback) => tls.connect({ ...options, host: options.host ? '127.0.0.1' : options.host, ca: cert }, callback) };
  return { api: vpnApi({ tls: trustedTls }), port: server.address().port, sockets };
}
test('actual chunked TLS download counts decoded payload only', async t => {
  const lab = await tlsLab(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    for (let i = 0; i < 10; i++) response.write(Buffer.alloc(100, 97));
    response.end();
  }); if (!lab) return;
  const result = await lab.api.measureDownloadEndpoint({ name: 'own chunked', host: 'fixture.example', port: lab.port, path: '/', bytes: 5000 }, null);
  assert.equal(result.bytes, 1000);
  await wait(30); assert.equal(lab.sockets.size, 0);
});
test('actual TLS fragmented chunks/extensions/trailers decode without counting framing', async t => {
  const lab = await tlsLab(t, (request) => {
    const fragments = ['HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r',
      '\n6', '4;fixture=yes\r', '\n', Buffer.alloc(100, 97), '\r', '\n6', '4\r\n',
      Buffer.alloc(100, 98), '\r\n0\r', '\nX-Fixture: ok\r', '\n\r', '\n'];
    let index = 0;
    const next = () => {
      if (request.socket.destroyed) return;
      if (index === fragments.length) { request.socket.end(); return; }
      request.socket.write(fragments[index++]); timer = setTimeout(next, 3);
    };
    let timer; request.socket.on('error', () => {}); request.socket.once('close', () => clearTimeout(timer)); next();
  }); if (!lab) return;
  const result = await lab.api.measureDownloadEndpoint({ name: 'own fragments', host: 'fixture.example', port: lab.port, path: '/', bytes: 5000 }, null);
  assert.equal(result.bytes, 200); assert.equal(result.terminationReason, 'body-complete');
});
test('actual TLS truncated/ambiguous/invalid framing does not produce a completed speed sample', async t => {
  const bodies = {
    truncated: 'HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nshort',
    ambiguous: 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Length: 5\r\n\r\n5\r\nhello\r\n0\r\n\r\n',
    invalid: 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nxx\r\nhello\r\n0\r\n\r\n',
    brokenDelimiter: 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhelloxx0\r\n\r\n',
    forbiddenTrailer: 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\nContent-Length: 5\r\n\r\n',
    compressed: 'HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: 5\r\n\r\nhello',
    excessContentLength: 'HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhelloextra',
  };
  const lab = await tlsLab(t, request => { request.socket.on('error', () => {}); request.socket.end(bodies[request.url.slice(1)]); });
  if (!lab) return;
  for (const name of Object.keys(bodies)) await assert.rejects(lab.api.measureDownloadEndpoint({ name, host: 'fixture.example', port: lab.port, path: '/' + name, bytes: 5000 }, null));
});
test('actual TLS download obeys requested payload cap and rejects a spent shared budget before succeeding', async t => {
  const lab = await tlsLab(t, (_request, response) => { response.writeHead(200); response.end(Buffer.alloc(5000)); });
  if (!lab) return;
  const { createSpeedtestBudget } = load('handlers-vpn', { process: { env: {} } }, ['createSpeedtestBudget']);
  const budget = createSpeedtestBudget(1500);
  const endpoint = { name: 'own cap', host: 'fixture.example', port: lab.port, path: '/', bytes: 1000 };
  const first = await lab.api.measureDownloadEndpoint(endpoint, null, 0, undefined, budget);
  assert.equal(first.bytes, 1000); assert.equal(first.terminationReason, 'byte-budget');
  await assert.rejects(lab.api.measureDownloadEndpoint(endpoint, null, 0, undefined, budget), error => error.name === 'SpeedtestBudgetExceededError');
  assert.equal(budget.usedBytes, 1000); assert.ok(budget.usedBytes <= budget.maxBytes);
  await wait(30); assert.equal(lab.sockets.size, 0);
});
test('actual TLS repeated framed downloads and cancellations leave no connection or budget reservations', async t => {
  const lab = await tlsLab(t, (request, response) => {
    if (request.url === '/malformed') { request.socket.on('error', () => {}); request.socket.end('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhelloextra'); }
    else if (request.url === '/cancel') { response.writeHead(200, { 'content-type': 'application/octet-stream' }); response.write(Buffer.alloc(50)); }
    else { response.writeHead(200, { 'content-type': 'application/octet-stream' }); for (let i = 0; i < 10; i++) response.write(Buffer.alloc(100)); response.end(); }
  }); if (!lab) return;
  const { createSpeedtestBudget } = load('handlers-vpn', { process: { env: {} } }, ['createSpeedtestBudget']);
  const budget = createSpeedtestBudget(100000), endpoint = name => ({ name, host: 'fixture.example', port: lab.port, path: '/' + name, bytes: 5000 });
  const started = performance.now(); let decoded = 0, expectedFailures = 0;
  for (let batch = 0; batch < 8; batch++) {
    const requests = Array.from({ length: 8 }, (_unused, index) => lab.api.measureDownloadEndpoint(endpoint(index < 6 ? 'ok' : 'malformed'), null, 0, undefined, budget));
    const results = await Promise.allSettled(requests);
    results.forEach((result, index) => { if (index < 6) { assert.equal(result.status, 'fulfilled'); assert.equal(result.value.bytes, 1000); decoded += result.value.bytes; }
      else { assert.equal(result.status, 'rejected'); expectedFailures++; } });
  }
  for (let batch = 0; batch < 4; batch++) {
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const requests = controllers.map(controller => lab.api.measureDownloadEndpoint(endpoint('cancel'), null, 0, controller.signal, budget));
    await wait(25); controllers.forEach(controller => controller.abort());
    const results = await Promise.allSettled(requests); assert.ok(results.every(result => result.status === 'rejected')); expectedFailures += results.length;
  }
  await wait(30); assert.equal(lab.sockets.size, 0); assert.equal(budget.reservedBytes, 0);
  assert.equal(decoded, 48000); assert.ok(budget.usedBytes >= decoded && budget.usedBytes <= decoded + 800);
  const evidence = { requests: 80, completed: 48, malformedRejected: 16, cancelled: 16, decodedPayloadBytes: decoded, usedBudgetBytes: budget.usedBytes,
    reservedBytesRemaining: budget.reservedBytes, serverSocketsRemaining: lab.sockets.size, elapsedMs: Number((performance.now() - started).toFixed(3)) };
  assert.equal(expectedFailures, 32); recordNetworkEvidence('tlsStress', evidence); t.diagnostic(JSON.stringify(evidence));
});
