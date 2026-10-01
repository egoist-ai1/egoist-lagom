import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, randomBytes } from 'node:crypto';
import { isIP, createServer, createConnection } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

const command = promisify(execFile);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const probeProcess = 'LagomVpnNativeProbe.exe';
export const syntheticHost = '198.18.0.254';
export const syntheticPort = 19080;
const pinnedRuntimeSha256 = 'aad0ede010eafa7b277e520464f3a66fde820103d737eff739f40f3cc9451dcc';

async function productionSources(sourceCommit, requireWorkingMatch = false) {
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  const files = ['src/recovered/electron/ipc/ipc-schemas.js', 'src/recovered/electron/ipc/config-builder.js',
    'src/component-protocol.js', 'src/recovered/electron/ipc/vpn-service-manager.js', 'src/recovered/electron/ipc/state-store.js',
    'src/recovered/renderer.js', 'src/brand/CompactRuby.jsx', 'src/recovered/electron/ipc/handlers-import.js', 'src/recovered/preload.cjs'];
  const sources = {}, sourceHashes = [];
  for (const file of files) {
    const result = await command('git', ['show', `${sourceCommit}:${file}`], { cwd: project, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: 10000 });
    sources[file] = result.stdout.toString('utf8');
    const sha256 = digest(result.stdout);
    if (requireWorkingMatch) await command('git', ['diff', '--quiet', sourceCommit, '--', file], { cwd: project, timeout: 10000 });
    sourceHashes.push({ file, sha256, ...(requireWorkingMatch ? { workingSha256: digest(await fs.readFile(path.join(project, file))), workingMatchesGit: true } : {}) });
  }
  const context = vm.createContext({ z, URL, Buffer, createHash, isIP });
  for (const file of files.slice(0, 5)) vm.runInContext(sources[file], context, { filename: file });
  return { context, sources, sourceHashes };
}

async function verifyRuntime(resources) {
  const executable = path.join(resources, 'runtime/sing-box/sing-box.exe');
  const manifestBytes = await fs.readFile(path.join(resources, 'runtime/manifest.json'));
  const component = JSON.parse(manifestBytes).components.find(item => item.name === 'sing-box');
  const pin = component.files.find(item => item.path === 'sing-box/sing-box.exe');
  const bytes = await fs.readFile(executable);
  assert.equal(bytes.length, pin.size); assert.equal(digest(bytes), pin.sha256.toLowerCase());
  assert.equal(component.version, 'v1.14.0'); assert.equal(bytes.length, 81819136); assert.equal(digest(bytes), pinnedRuntimeSha256);
  const version = await command(executable, ['version'], { windowsHide: true, timeout: 10000, maxBuffer: 16384 });
  assert.match(version.stdout, /^sing-box version 1\.14\.0\r?\n/);
  return { executable, receipt: { version: '1.14.0', sha256: digest(bytes), bytes: bytes.length, manifestSha256: digest(manifestBytes) } };
}

export function assertSelectedSystemProbeConfig(config, fixturePort) {
  assert.equal(config.route.final, 'direct'); assert.equal(config.route.auto_detect_interface, true);
  const tun = config.inbounds.filter(item => item.type === 'tun'); assert.equal(tun.length, 1);
  assert.equal(tun[0].interface_name, 'egoist-vpn'); assert.equal(tun[0].auto_route, true); assert.equal(tun[0].strict_route, true);
  assert.deepEqual(tun[0].address, ['172.19.0.1/30']);
  const mixed = config.inbounds.filter(item => item.type === 'mixed'); assert.equal(mixed.length, 1);
  assert.equal(mixed[0].listen, '127.0.0.1'); assert.equal(mixed[0].listen_port, 10838);
  assert.ok(config.dns.servers.some(server => server.type === 'local'));
  assert.ok(config.dns.servers.every(server => !server.detour || server.detour === 'direct'));
  assert.ok(!config.dns.final || config.dns.final === 'system-dns');
  const processRules = config.route.rules.filter(rule => rule.process_name);
  assert.deepEqual(processRules, [{ process_name: [probeProcess], outbound: 'proxy' }]);
  assert.ok(config.route.rules.every(rule => !rule.domain_suffix && !rule.domain && !rule.process_path && !rule.process_path_regex));
  assert.ok(config.route.rules.every(rule => rule.outbound !== 'proxy' || rule === processRules[0]));
  const proxy = config.outbounds.filter(item => item.tag === 'proxy'); assert.equal(proxy.length, 1);
  assert.equal(proxy[0].type, 'socks'); assert.equal(proxy[0].server, '127.0.0.1'); assert.equal(proxy[0].server_port, fixturePort);
  assert.ok(!proxy[0].username && !proxy[0].password);
}

// Reads the profile saved by genuine UI. It never patches the profile or the
// protected service snapshot. The resulting config is an own-file preflight.
export async function preflightGenuineUiProfile(options) {
  const { sourceCommit, stateFile, resources, workRoot, fixturePort, nodeName } = options;
  assert.ok(path.isAbsolute(stateFile) && path.isAbsolute(resources) && path.isAbsolute(workRoot));
  assert.ok(Number.isInteger(fixturePort) && fixturePort > 0 && fixturePort < 65536);
  const { context, sourceHashes } = await productionSources(sourceCommit, true);
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  assert.equal(state.settings.routeMode, 'selected'); assert.equal(state.settings.dnsMode, 'system');
  assert.equal(state.settings.autoConnect, false); assert.equal(state.settings.killSwitch, false);
  assert.equal(String(state.settings.runtimePath || '').trim(), '');
  assert.deepEqual(state.domainRules, []); assert.equal(state.processRules.length, 1);
  assert.equal(state.processRules[0].process, probeProcess); assert.equal(state.processRules[0].mode, 'vpn');
  assert.equal(state.nodes.length, 1, 'Native acceptance requires exactly the UI-imported fixture node.');
  const node = state.nodes[0]; assert.equal(node.id, state.activeNodeId); assert.equal(node.name, nodeName);
  assert.equal(node.protocol, 'socks'); assert.equal(node.server, '127.0.0.1'); assert.equal(node.port, fixturePort);
  const record = context.validateBackgroundVpnSnapshot({ node, settings: state.settings, domainRules: state.domainRules, processRules: state.processRules });
  assertSelectedSystemProbeConfig(JSON.parse(record.config), fixturePort);
  const runtime = await verifyRuntime(resources);
  const file = path.join(workRoot, 'ui-config-preflight.json'); await fs.writeFile(file, record.config, 'utf8');
  await command(runtime.executable, ['check', '-c', file], { cwd: path.dirname(runtime.executable), windowsHide: true, timeout: 15000, maxBuffer: 65536 });
  const result = { schemaVersion: 1, kind: 'genuine-ui-profile-config-preflight', sourceCommit, sourceHashes, nodeId: record.nodeId,
    stateRevision: state.stateRevision, configSha256: record.configSha256, configFile: file, configCheckAccepted: true, runtime: runtime.receipt,
    nativeAcceptancePassed: false, actualTunRuns: 0 };
  await fs.writeFile(path.join(workRoot, 'ui-config-preflight.receipt.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

// Run belongs only to the guarded PowerShell native gate. Inspect, Preflight,
// and Fixture here have no product mutation, TUN or service authority.
export async function inspectVpnAcceptanceFeasibility(sourceCommit, workRoot) {
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  assert.ok(path.isAbsolute(workRoot), 'Use an absolute task-owned work root.');
  const root = path.join(workRoot, 'vpn-configuration-feasibility');
  await fs.mkdir(root, { recursive: true });
  const files = [
    'src/recovered/electron/ipc/ipc-schemas.js',
    'src/recovered/electron/ipc/config-builder.js',
    'src/component-protocol.js',
    'src/recovered/electron/ipc/vpn-service-manager.js',
    'src/recovered/electron/ipc/state-store.js',
    'src/recovered/renderer.js', 'src/brand/CompactRuby.jsx',
    'src/recovered/electron/ipc/handlers-import.js',
    'src/recovered/preload.cjs',
  ];
  const sources = {}, sourceHashes = [];
  for (const file of files) {
    const result = await command('git', ['show', `${sourceCommit}:${file}`], { cwd: project, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: 10000 });
    sources[file] = result.stdout.toString('utf8');
    sourceHashes.push({ file, sha256: digest(result.stdout) });
  }
  const context = vm.createContext({ z, URL, Buffer, createHash, isIP });
  for (const file of files.slice(0, 5)) vm.runInContext(sources[file], context, { filename: file });
  const settings = JSON.parse(JSON.stringify(context.DEFAULT_STATE.settings));
  const node = { id: 'native-feasibility', name: 'native-feasibility', protocol: 'socks', server: '127.0.0.1', port: 19876, uri: 'socks5://127.0.0.1:19876#native-feasibility', metadata: {} };
  const candidates = [
    { name: 'clean-profile', node, settings, domainRules: [], processRules: [] },
    { name: 'proposed-selected-system', node, settings: { ...settings, routeMode: 'selected', dnsMode: 'system' }, domainRules: [],
      processRules: [{ id: 'native-probe', process: probeProcess, mode: 'vpn' }] },
  ];
  const resources = path.resolve(process.env.SHIELD_VPN_PINNED_RESOURCES || path.join(project, 'out/EgoistShield-3.8.0-win-x64/resources'));
  const runtime = await verifyRuntime(resources), executable = runtime.executable;
  const configurations = [];
  for (const candidate of candidates) {
    const { name, ...input } = candidate;
    const record = context.validateBackgroundVpnSnapshot(input);
    const file = path.join(root, name + '.json');
    await fs.writeFile(file, record.config, 'utf8');
    await command(executable, ['check', '-c', file], { cwd: path.dirname(executable), windowsHide: true, timeout: 15000, maxBuffer: 65536 });
    const config = JSON.parse(record.config), tun = config.inbounds.find(inbound => inbound.type === 'tun');
    configurations.push({ name, configSha256: record.configSha256, nativeCheckAccepted: true,
      routeFinal: config.route.final, autoDetectInterface: config.route.auto_detect_interface, tunAutoRoute: tun.auto_route,
      tunStrictRoute: tun.strict_route, interfaceName: tun.interface_name, dnsServerTypes: config.dns.servers.map(server => server.type),
      dnsProxyDetour: config.dns.servers.some(server => server.detour === 'proxy'),
      processRules: config.route.rules.filter(rule => rule.process_name) });
  }
  const gui = sources['src/recovered/renderer.js'] + sources['src/brand/CompactRuby.jsx'];
  const guiSettingReferences = Object.fromEntries(['routeMode', 'dnsMode', 'domainRules', 'processRules'].map(key => [key, (gui.match(new RegExp(`\\b${key}\\b`, 'g')) || []).length]));
  const receipt = { schemaVersion: 1, kind: 'configuration-feasibility-only', sourceCommit,
    status: Object.values(guiSettingReferences).every(count => count === 0) ? 'blocked-ui-routing-controls-in-inspected-commit' : 'native-safety-not-yet-verified',
    nativeAcceptancePassed: false, actualTunRuns: 0, nativeScmMutations: 0, dnsMutations: 0, guiOperations: 0,
    sourceHashConvention: 'SHA256 of exact git blob bytes', sourceHashes, guiSettingReferences,
    cleanSettings: { routeMode: settings.routeMode, dnsMode: settings.dnsMode }, configurations,
    runtime: runtime.receipt,
    limitations: ['Generated config acceptance is not runtime network safety.', 'No native TUN, GUI/Core operation, SCM installation, or runner-control proof is asserted.'] };
  await fs.writeFile(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

function socketReader(socket) {
  let buffer = Buffer.alloc(0), waiter = null, failure = null;
  const wake = () => { if (waiter) { const current = waiter; waiter = null; current(); } };
  socket.on('data', bytes => { buffer = Buffer.concat([buffer, bytes]); if (buffer.length > 32768) { failure = new Error('Fixture input exceeded its bound.'); socket.destroy(); } wake(); });
  socket.on('error', error => { failure = error; wake(); });
  socket.on('end', () => { failure ??= new Error('Fixture peer ended early.'); wake(); });
  socket.on('close', () => { failure ??= new Error('Fixture peer closed early.'); wake(); });
  return {
    async take(count) { while (buffer.length < count) { if (failure) throw failure; await new Promise(resolve => { waiter = resolve; }); }
      const bytes = buffer.subarray(0, count); buffer = buffer.subarray(count); return bytes; },
    async headers() { while (!buffer.includes('\r\n\r\n')) { if (failure) throw failure; await new Promise(resolve => { waiter = resolve; }); }
      const end = buffer.indexOf('\r\n\r\n') + 4; const bytes = buffer.subarray(0, end); buffer = buffer.subarray(end); return bytes.toString('ascii'); },
  };
}

// A real bounded SOCKS5 peer, with no external dial and no product readiness
// model. Only this synthetic destination receives the per-request nonce.
export async function startNonceSocksFixture({ onEvent = () => {}, instance = randomBytes(24).toString('hex') } = {}) {
  assert.match(instance, /^[a-f0-9]{48}$/);
  const sockets = new Set(); let served = 0;
  const server = createServer(socket => {
    if (sockets.size >= 16) { socket.destroy(); return; }
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.setTimeout(8000, () => socket.destroy(new Error('Fixture deadline.')));
    const reader = socketReader(socket);
    void (async () => {
      const greeting = await reader.take(2);
      if (greeting[0] !== 5 || greeting[1] < 1 || greeting[1] > 16) throw new Error('Invalid SOCKS greeting.');
      const methods = await reader.take(greeting[1]);
      if (!methods.includes(0)) { socket.end(Buffer.from([5, 255])); return; }
      socket.write(Buffer.from([5, 0]));
      const request = await reader.take(4);
      if (request[0] !== 5 || request[1] !== 1 || request[2] !== 0) { socket.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0])); return; }
      let target;
      if (request[3] === 1) target = [...await reader.take(4)].join('.');
      else if (request[3] === 3) { const length = (await reader.take(1))[0]; if (length < 1) throw new Error('Empty target.'); target = (await reader.take(length)).toString('ascii'); }
      else { socket.end(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0])); return; }
      const port = (await reader.take(2)).readUInt16BE();
      if (target !== syntheticHost || port !== syntheticPort) { onEvent({ kind: 'target-refused', target, port }); socket.end(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0])); return; }
      socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
      const headers = await reader.headers(), match = /^GET \/nonce\/([a-f0-9]{48}) HTTP\/1\.1\r\n/.exec(headers);
      if (!match || !headers.includes(`\r\nHost: ${syntheticHost}:${syntheticPort}\r\n`)) throw new Error('Invalid nonce HTTP request.');
      const nonce = match[1], body = JSON.stringify({ nonce, fixtureInstance: instance });
      const response = `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: keep-alive\r\n\r\n${body}`;
      socket.write(response); served++;
      onEvent({ kind: 'nonce-served', nonce, fixtureInstance: instance, target, port, peerAddress: socket.remoteAddress, peerPort: socket.remotePort,
        localAddress: socket.localAddress, localPort: socket.localPort, responseSha256: digest(Buffer.from(body)) });
    })().catch(error => { onEvent({ kind: 'protocol-failure', error: error.message }); socket.destroy(); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve); });
  return { port: server.address().port, instance, get served() { return served; },
    async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}

async function fixtureMain(optionsPath) {
  assert.ok(path.isAbsolute(optionsPath));
  const optionsBytes = await fs.readFile(optionsPath); assert.ok(optionsBytes.length <= 16384);
  const options = JSON.parse(optionsBytes);
  for (const field of ['workRoot', 'receiptPath', 'eventsPath', 'stopPath']) {
    assert.ok(path.isAbsolute(options[field])); if (field !== 'workRoot') assert.ok(path.resolve(options[field]).startsWith(path.resolve(options.workRoot) + path.sep));
  }
  assert.ok(path.resolve(optionsPath).startsWith(path.resolve(options.workRoot) + path.sep));
  assert.match(options.stopNonce, /^[a-f0-9]{48}$/); assert.ok(Number.isInteger(options.leaseSeconds) && options.leaseSeconds >= 10 && options.leaseSeconds <= 1200);
  assert.equal((await fs.stat(options.workRoot)).isDirectory(), true);
  const events = [], eventsFile = await fs.open(options.eventsPath, 'wx');
  const fixture = await startNonceSocksFixture({ onEvent: event => { const row = { ...event, at: new Date().toISOString() }; events.push(row);
    void eventsFile.appendFile(JSON.stringify(row) + '\n').catch(() => {}); } });
  const receipt = { schemaVersion: 1, kind: 'actual-loopback-socks-nonce-fixture', processId: process.pid, instance: fixture.instance,
    listenAddress: '127.0.0.1', port: fixture.port, fixedTarget: syntheticHost, fixedTargetPort: syntheticPort, externalDial: false,
    stopNonce: options.stopNonce, at: new Date().toISOString(), sourceSha256: digest(await fs.readFile(fileURLToPath(import.meta.url))) };
  await fs.writeFile(options.receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  const deadline = Date.now() + options.leaseSeconds * 1000;
  while (Date.now() < deadline) {
    const stop = await fs.readFile(options.stopPath, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return ''; });
    if (stop === 'stop:' + options.stopNonce) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await fixture.close(); await eventsFile.close();
  await fs.writeFile(options.receiptPath, JSON.stringify({ ...receipt, stoppedAt: new Date().toISOString(), served: fixture.served,
    noRemainingSockets: true, events: events.length }, null, 2) + '\n');
}

export async function selfTestSocksFixture() {
  const events = [], fixture = await startNonceSocksFixture({ onEvent: event => events.push(event) });
  let cases = 0;
  async function connect() {
    const socket = createConnection({ host: '127.0.0.1', port: fixture.port }); socket.setTimeout(5000, () => socket.destroy());
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    return { socket, reader: socketReader(socket) };
  }
  try {
    for (const fragment of [false, true]) for (const addressType of [1, 3]) {
      const { socket, reader } = await connect();
      try {
        if (fragment) { socket.write(Buffer.from([5])); await new Promise(resolve => setTimeout(resolve, 5)); socket.write(Buffer.from([1, 0])); }
        else socket.write(Buffer.from([5, 1, 0]));
        assert.deepEqual(await reader.take(2), Buffer.from([5, 0]));
        const target = addressType === 1 ? Buffer.from([198, 18, 0, 254]) : Buffer.concat([Buffer.from([syntheticHost.length]), Buffer.from(syntheticHost)]);
        const port = Buffer.alloc(2); port.writeUInt16BE(syntheticPort);
        socket.write(Buffer.concat([Buffer.from([5, 1, 0, addressType]), target, port])); assert.equal((await reader.take(10))[1], 0);
        const nonce = randomBytes(24).toString('hex'); socket.write(`GET /nonce/${nonce} HTTP/1.1\r\nHost: ${syntheticHost}:${syntheticPort}\r\n\r\n`);
        const headers = await reader.headers(), count = Number(/Content-Length: (\d+)/.exec(headers)[1]);
        const response = JSON.parse((await reader.take(count)).toString('utf8')); assert.equal(response.nonce, nonce); assert.equal(response.fixtureInstance, fixture.instance); cases++;
      } finally { socket.destroy(); }
    }
    for (const method of [1, 2]) {
      const { socket, reader } = await connect(); try { socket.write(Buffer.from([5, 1, method])); assert.deepEqual(await reader.take(2), Buffer.from([5, 255])); cases++; } finally { socket.destroy(); }
    }
    for (const request of [[5, 2, 0, 1, 198, 18, 0, 254, 74, 136], [5, 1, 0, 1, 1, 1, 1, 1, 1, 187], [5, 1, 0, 4, 0, 0]]) {
      const { socket, reader } = await connect(); try { socket.write(Buffer.from([5, 1, 0])); await reader.take(2); socket.write(Buffer.from(request)); assert.notEqual((await reader.take(10))[1], 0); cases++; } finally { socket.destroy(); }
    }
    assert.equal(fixture.served, 4); assert.equal(events.filter(event => event.kind === 'nonce-served').length, 4);
    return { schemaVersion: 1, kind: 'safe-local-socks-fixture-test', cases, passed: cases, actualLoopbackSockets: 9,
      actualTunRuns: 0, nativeScmMutations: 0, dnsMutations: 0, nativeAcceptancePassed: false, externalDial: false };
  } finally { await fixture.close(); }
}

export function selfTestProbeConfigSafety(config, fixturePort) {
  assertSelectedSystemProbeConfig(config, fixturePort); let cases = 1;
  for (const mutate of [
    value => { value.route.final = 'proxy'; },
    value => { value.route.rules.push({ process_name: ['pwsh.exe'], outbound: 'proxy' }); },
    value => { value.route.rules.push({ domain_suffix: ['github.com'], outbound: 'proxy' }); },
    value => { value.dns.servers[0].detour = 'proxy'; },
    value => { value.inbounds.find(item => item.type === 'tun').auto_route = false; },
    value => { value.inbounds.find(item => item.type === 'tun').strict_route = false; },
    value => { value.inbounds.find(item => item.type === 'tun').interface_name = 'unexpected'; },
    value => { value.inbounds.find(item => item.type === 'mixed').listen = '0.0.0.0'; },
    value => { value.outbounds.find(item => item.tag === 'proxy').server = '1.1.1.1'; },
    value => { value.outbounds.find(item => item.tag === 'proxy').server_port++; },
  ]) { const bad = structuredClone(config); mutate(bad); assert.throws(() => assertSelectedSystemProbeConfig(bad, fixturePort)); cases++; }
  return { kind: 'pre-enable-config-safety-contract', cases, passed: cases, nativeAcceptancePassed: false, actualTunRuns: 0 };
}

// This test invokes the frozen plain-TCP child only on 127.0.0.1. There is no
// service, DNS, TUN, GUI or external-provider operation in this test.
export async function selfTestPlainTcpProbe(executable, workRoot) {
  assert.ok(path.isAbsolute(executable) && path.isAbsolute(workRoot));
  assert.ok(path.resolve(executable).startsWith(path.resolve(workRoot) + path.sep));
  assert.equal(path.basename(executable), probeProcess);
  const directory = path.join(workRoot, 'plain-probe-self-test-' + randomBytes(6).toString('hex')); await fs.mkdir(directory);
  let cases = 0, accepted = 0;
  const sockets = new Set(); let mode = 'valid';
  const server = createServer(socket => {
    accepted++; sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    socket.setTimeout(10000, () => socket.destroy()); const reader = socketReader(socket);
    void (async () => {
      const headers = await reader.headers(), nonce = /^GET \/nonce\/([a-f0-9]{48}) HTTP\/1\.1\r\n/.exec(headers)?.[1];
      assert.ok(nonce); const instance = instanceByNonce.get(nonce); assert.ok(instance);
      const body = JSON.stringify({ nonce: mode === 'wrong-nonce' ? 'f'.repeat(48) : nonce, fixtureInstance: mode === 'wrong-instance' ? 'e'.repeat(48) : instance });
      const status = mode === 'http-failure' ? '503 Service Unavailable' : '200 OK';
      const length = mode === 'truncated' ? Buffer.byteLength(body) + 10 : Buffer.byteLength(body);
      socket.write(`HTTP/1.1 ${status}\r\nContent-Length: ${length}\r\n\r\n${body}`);
      if (mode !== 'valid') socket.end();
    })().catch(() => socket.destroy());
  });
  const instanceByNonce = new Map();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port: syntheticPort, exclusive: true }, resolve); });
  try {
    for (const testMode of ['valid', 'wrong-nonce', 'wrong-instance', 'http-failure', 'truncated']) {
      mode = testMode; const nonce = randomBytes(24).toString('hex'), instance = randomBytes(24).toString('hex'); instanceByNonce.set(nonce, instance);
      const file = path.join(directory, testMode + '.json');
      const run = command(executable, ['--loopback-probe', nonce, instance, file], { windowsHide: true, timeout: 20000, maxBuffer: 16384,
        env: { ...process.env, DOTNET_ROOT: path.join(project, '.tools/dotnet-10.0.401'), DOTNET_ROOT_X64: path.join(project, '.tools/dotnet-10.0.401') } }).then(result => ({ code: 0, ...result }), error => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
      if (testMode === 'valid') {
        const deadline = Date.now() + 10000; let proof;
        while (Date.now() < deadline) { proof = await fs.readFile(file, 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; return null; }); if (proof) break; await new Promise(resolve => setTimeout(resolve, 50)); }
        assert.ok(proof); assert.equal(proof.nonce, nonce); assert.equal(proof.fixtureInstance, instance); assert.equal(proof.proxyConfigured, false);
        assert.equal(proof.targetAddress, '127.0.0.1'); assert.equal(proof.processName, probeProcess);
        await fs.writeFile(file + '.release', 'release:' + nonce);
        const result = await run; assert.equal(result.code, 0); assert.equal(JSON.parse(result.stdout).released, true);
      } else { const result = await run; assert.equal(result.code, 1); assert.equal(JSON.parse(result.stderr).ok, false); assert.equal(await fs.stat(file).then(() => true).catch(error => { if (error.code !== 'ENOENT') throw error; return false; }), false); }
      cases++;
    }
    const result = { schemaVersion: 1, kind: 'actual-safe-loopback-plain-tcp-native-probe', cases, passed: cases, actualLoopbackSockets: accepted,
      actualTunRuns: 0, nativeScmMutations: 0, dnsMutations: 0, guiOperations: 0, nativeAcceptancePassed: false,
      executableSha256: digest(await fs.readFile(executable)), sourceSha256: digest(await fs.readFile(path.join(project, 'tests/windows-vpn-native-probe.cs'))) };
    await fs.writeFile(path.join(directory, 'receipt.json'), JSON.stringify(result, null, 2) + '\n'); return result;
  } finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [action, argument, workRoot] = process.argv.slice(2);
  const main = async () => {
    if (action === 'Inspect') { const result = await inspectVpnAcceptanceFeasibility(argument, workRoot); console.log(JSON.stringify({ status: result.status, sourceCommit: argument, configurationsChecked: result.configurations.length, actualTunRuns: 0, nativeAcceptancePassed: false })); }
    else if (action === 'Preflight') { const result = await preflightGenuineUiProfile(JSON.parse(await fs.readFile(argument, 'utf8'))); console.log(JSON.stringify({ configCheckAccepted: result.configCheckAccepted, configSha256: result.configSha256 })); }
    else if (action === 'Fixture') await fixtureMain(argument);
    else if (action === 'SelfTest') console.log(JSON.stringify(await selfTestSocksFixture()));
    else if (action === 'SelfTestProbe') console.log(JSON.stringify(await selfTestPlainTcpProbe(argument, workRoot)));
    else if (action === 'SelfTestConfig') console.log(JSON.stringify(selfTestProbeConfigSafety(JSON.parse(await fs.readFile(argument, 'utf8')), 19876)));
    else { console.error('Native Run is available only through windows-vpn-native-acceptance.ps1 hosted guards. This helper has no service/TUN authority.'); process.exitCode = 2; }
  };
  main().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
