import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter, once } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, createConnection } from 'node:net';
import { loadRecovered } from './load-recovered.mjs';

const { ConfigBuilder } = process.env.LAGOM_ROUTING_BASELINE_FILE ? (() => {
  const context = vm.createContext({ URL });
  vm.runInContext(fs.readFileSync(process.env.LAGOM_ROUTING_BASELINE_FILE, 'utf8'), context);
  return context;
})() : loadRecovered('electron/ipc/config-builder', {}, ['ConfigBuilder']);
const { buildProtocolRuntimePlan } = loadRecovered('shared/protocol-matrix', {}, ['buildProtocolRuntimePlan']);
const node = { id: 'rule-fixture', name: 'rule fixture', protocol: 'socks', server: '127.0.0.1', port: 19876, metadata: {} };
const settings = { routeMode: 'rules', dnsMode: 'system', useTunMode: false };
const domainRule = (domain, mode = 'vpn') => ({ id: 'domain', domain, mode });
const xray = (domainRules, processRules = [], useTunMode = false) => JSON.parse(ConfigBuilder.buildXray(node, domainRules, { ...settings, useTunMode }, 10809, 10808, 10085, processRules));
const sing = (domainRules, processRules = [], useTunMode = false) => JSON.parse(ConfigBuilder.buildSingBox(node, domainRules, processRules, { ...settings, useTunMode }, 10809));
const ownXray = config => config.routing.rules.filter(rule => rule.domain && !rule.domain.includes('geosite:cn'));
const ownSing = config => config.route.rules.filter(rule => ['domain', 'domain_suffix', 'domain_keyword', 'domain_regex'].some(field => rule[field]));

test('a plain domain matches only the domain and its subdomains in both generated runtimes', () => {
  assert.deepEqual(ownXray(xray([domainRule('example.org')]))[0].domain, ['domain:example.org']);
  assert.deepEqual(ownSing(sing([domainRule('example.org')]))[0].domain_suffix, ['example.org']);
});

test('full, suffix, keyword and regex explicit rules retain their meaning rather than a literal prefix', () => {
  const cases = [
    ['full:exact.example.org', 'domain', 'exact.example.org'],
    ['domain:suffix.example.org', 'domain_suffix', 'suffix.example.org'],
    ['keyword:needle', 'domain_keyword', 'needle'],
    ['regexp:^api[0-9]+\\.example\\.org$', 'domain_regex', '^api[0-9]+\\.example\\.org$']
  ];
  for (const [input, field, expected] of cases) {
    assert.deepEqual(ownXray(xray([domainRule(input)]))[0].domain, [input]);
    const rule = ownSing(sing([domainRule(input)]))[0];
    assert.deepEqual(rule[field], [expected]);
    assert.equal(Object.hasOwn(rule, 'domain_suffix'), field === 'domain_suffix');
  }
});

test('canonical host names retain IDNA labels and reject IP, CIDR, URL, wildcard and unknown prefixes', () => {
  assert.deepEqual(ownXray(xray([domainRule('  EXAMPLE.org.  ')]))[0].domain, ['domain:example.org']);
  assert.deepEqual(ownSing(sing([domainRule('пример.рф')]))[0].domain_suffix, ['xn--e1afmkfd.xn--p1ai']);
  for (const invalid of ['127.0.0.1', '2001:db8::1', '10.0.0.0/8', 'https://example.org', '*.example.org', 'example.org/path', 'foo:bar', '', 'example..org']) {
    for (const build of [xray, sing]) assert.throws(() => build([domainRule(invalid)]), /правил|домен|формат/i);
  }
});

test('engine-specific domain tokens remain explicit or fail preflight before any config is returned', () => {
  assert.deepEqual(ownXray(xray([domainRule('geosite:category-ads-all')]))[0].domain, ['geosite:category-ads-all']);
  assert.deepEqual(ownXray(xray([domainRule('dotless:pc-')]))[0].domain, ['dotless:pc-']);
  for (const value of ['geosite:category-ads-all', 'dotless:pc-']) {
    assert.throws(() => ConfigBuilder.validateRoutingRules('sing-box', [domainRule(value)], [], false), /sing-box/);
    assert.throws(() => sing([domainRule(value)]), /sing-box/);
  }
});

test('rule order and route/reject actions are preserved without combining different match conditions', () => {
  const rules = [domainRule('full:example.org', 'direct'), { ...domainRule('keyword:example', 'block'), id: 'second' }, { ...domainRule('example.org'), id: 'third' }];
  const xrules = ownXray(xray(rules)), srules = ownSing(sing(rules));
  assert.deepEqual(xrules.map(rule => rule.outboundTag), ['direct', 'block', 'proxy']);
  assert.equal(srules[0].outbound, 'direct'); assert.equal(srules[1].action, 'reject'); assert.equal(srules[2].outbound, 'proxy');
  for (const config of [xray, sing]) assert.throws(() => config([domainRule('example.org', 'unexpected')]), /режим.*правил/i);
});

test('process names apply only to TUN and unsupported process paths cannot masquerade as basenames', () => {
  const rules = [{ id: 'process', process: 'browser.exe', mode: 'block' }];
  assert.equal(xray([], rules).routing.rules.some(rule => rule.process), false);
  assert.equal(sing([], rules).route.rules.some(rule => rule.process_name), false);
  assert.deepEqual(xray([], rules, true).routing.rules.find(rule => rule.process).process, ['browser.exe']);
  assert.deepEqual(sing([], rules, true).route.rules.find(rule => rule.process_name).process_name, ['browser.exe']);
  const absolute = [{ id: 'path', process: 'C:/Program Files/App/app.exe', mode: 'vpn' }];
  assert.deepEqual(xray([], absolute, true).routing.rules.find(rule => rule.process).process, ['C:/Program Files/App/app.exe']);
  assert.throws(() => ConfigBuilder.validateRoutingRules('sing-box', [], absolute, true), /путь|имя.*\.exe/i);
  assert.throws(() => sing([], absolute, true), /путь|имя.*\.exe/i);
  assert.throws(() => sing([], [{ id: 'name', process: 'browser', mode: 'vpn' }], true), /\.exe/);
  for (const process of ['*.exe', 'relative/app.exe', 'app\u0000.exe']) assert.throws(() => xray([], [{ id: 'invalid', process, mode: 'vpn' }], true), /процесс|правил/i);
});

const recoveryRuntimeProfile = process.env.LAGOM_ROUTING_RECOVERY_RUNTIME === '1';
const pinnedRuntimes = {
  'sing-box': recoveryRuntimeProfile
    ? { files: ['recovery/official-app/resources/runtime/sing-box/sing-box.exe'], bytes: 44954624, sha256: '64b1dfaed6fa758295233fd0bec8b32cf2115f29773adbf38e0f026c3c7986f2', version: '1.13.12' }
    : { files: ['recovery/component-candidates/sing-box-1.14.0-windows-amd64/sing-box-1.14.0-windows-amd64/sing-box.exe', 'out/EgoistShield-3.8.0-win-x64/resources/runtime/sing-box/sing-box.exe'], bytes: 81819136, sha256: 'aad0ede010eafa7b277e520464f3a66fde820103d737eff739f40f3cc9451dcc', version: '1.14.0' },
  xray: { files: ['recovery/official-app/resources/runtime/xray/xray.exe'], bytes: 35819008, sha256: '47f612eff0a553c982a3e2806e54f94bee0639d0f3f0fa11116a11bbd6abda3f', version: '26.5.3' }
};
function runtimeBinary(t, kind) {
  const runtime = pinnedRuntimes[kind], file = runtime.files.find(file => fs.existsSync(file));
  if (process.platform !== 'win32' || !file) { t.skip('Pinned Windows runtime is absent; no native routing acceptance'); return null; }
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.length, runtime.bytes, 'pinned runtime size must match');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), runtime.sha256, 'never execute a different binary as the pinned runtime');
  recordEvidence('runtime-' + kind, { file, bytes: runtime.bytes, sha256: runtime.sha256, version: runtime.version, profile: recoveryRuntimeProfile ? 'recovery' : 'production' });
  return path.resolve(file);
}
function recordEvidence(name, value) {
  const file = process.env.LAGOM_ROUTING_EVIDENCE_PATH;
  if (!file) return;
  const evidence = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  evidence[name] = value; fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n');
}
async function temporaryDirectory(t, prefix) {
  const dir = await fsp.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP || os.tmpdir(), prefix));
  t.after(() => fsp.rm(dir, { recursive: true, force: true })); return dir;
}
async function nativeCheck(binary, kind, config) {
  const check = promisify(execFile)(binary, kind === 'xray' ? ['run', '-test', '-c', 'stdin:'] : ['check', '-c', 'stdin'],
    { windowsHide: true, cwd: path.dirname(binary), timeout: 15000, maxBuffer: 65536 });
  const input = new Promise((resolve, reject) => {
    check.child.stdin.once('error', error => { check.child.kill(); reject(error); });
    check.child.stdin.end(JSON.stringify(config), 'utf8', error => error ? reject(error) : resolve());
  });
  const [result] = await Promise.all([check, input]); return result;
}

test('both actual pinned binaries accept supported route fields from stdin and reject invalid Go regex syntax', async t => {
  const checks = [];
  for (const kind of ['xray', 'sing-box']) {
    const binary = runtimeBinary(t, kind); if (!binary) return;
    for (const pattern of ['example.org', 'full:exact.example.org', 'domain:suffix.example.org', 'keyword:needle', 'regexp:^api[0-9]+\\.example\\.org$']) {
      const config = kind === 'xray' ? xray([domainRule(pattern)]) : sing([domainRule(pattern)]);
      await nativeCheck(binary, kind, config); checks.push({ runtime: kind, pattern, outcome: 'accepted', input: 'stdin' });
    }
    const invalid = kind === 'xray' ? xray([domainRule('regexp:(?=lookahead)')]) : sing([domainRule('regexp:(?=lookahead)')]);
    await assert.rejects(nativeCheck(binary, kind, invalid)); checks.push({ runtime: kind, pattern: 'regexp:(?=lookahead)', outcome: 'rejected', input: 'stdin' });
  }
  recordEvidence('nativeChecks', checks);
});

test('both selected native stdin checks preserve the old child and write no temporary config or credential file', async t => {
  const directory = await temporaryDirectory(t, 'rules-preflight-');
  const oldChild = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  await once(oldChild, 'spawn');
  t.after(async () => { if (oldChild.exitCode === null && !oldChild.signalCode) { const exited = once(oldChild, 'exit'); oldChild.kill(); await exited; } });
  class RuntimeInstaller {} class KillSwitch { isActive() { return false; } }
  const children = [], releases = [], writes = [], sentinels = [], leakedOutput = [];
  const privatePromises = { ...fsp };
  for (const method of ['mkdir', 'writeFile', 'rm', 'open', 'rename', 'appendFile', 'copyFile', 'mkdtemp'])
    privatePromises[method] = () => { writes.push(method); throw new Error('Preflight must not write a configuration file'); };
  const { VpnRuntimeManager } = loadRecovered('electron/ipc/vpn-manager', { EventEmitter, RuntimeInstaller, KillSwitch, path, os,
    promises: privatePromises, process, promisify, execFile, randomUUID, ConfigBuilder, buildProtocolRuntimePlan,
    runtimeExecutionEnvironment: (_lease, inherited) => inherited,
    logger: { info() {}, warn() {}, debug() {}, error() {} }, formatRuntimeLogEvent: value => JSON.stringify(value) }, ['VpnRuntimeManager']);
  const manager = new VpnRuntimeManager(directory, directory); manager.cachedIsAdmin = false;
  manager.applyActiveSession({ process: oldChild, processGeneration: 1, startedAt: new Date().toISOString(), nodeId: 'old', proxyPort: 10001,
    socksPort: 10001, runtimeKind: 'sing-box', configPath: null, activeRuntimePath: process.execPath, processRulesApplied: false });
  manager.lastSettings = { useTunMode: true };
  let mutations = 0;
  const afterPreflight = new Error('Native preflight accepted; stop at the fixture teardown boundary');
  manager.clearPendingHandoff = () => { throw afterPreflight; };
  manager.flushRetiringSessions = async () => { mutations++; };
  manager.terminateSession = async () => { mutations++; };
  manager.prepareConnection = async () => { mutations++; throw new Error('Unexpected prepare'); };
  for (const kind of ['sing-box', 'xray']) {
    const binary = runtimeBinary(t, kind); if (!binary) return;
    const sentinel = 'owned-fixture-credential-' + randomUUID();
    const credentialNode = { ...node, metadata: { username: 'owned-fixture', password: sentinel } };
    manager.resolveRuntimePath = async () => ({ runtimeKind: kind, runtimePath: binary });
    // Trust is a controlled boundary here; the hash-checked executable, parser,
    // stdin pipe and old process are real. Native identity has separate acceptance.
    manager.verifyRuntimeCandidate = async () => ({ runtimePath: binary, watch(child) {
      assert.ok(child.pid > 0); children.push(child);
      assert.equal(child.spawnargs.some(argument => argument.includes(sentinel)), false);
      const end = child.stdin.end;
      child.stdin.end = function (content, ...args) { sentinels.push(content.toString().includes(sentinel)); return end.call(this, content, ...args); };
      let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
        output = (output + chunk.toString()).slice(-65536); if (output.includes(sentinel)) leakedOutput.push(true);
      });
    }, release() { releases.push(true); } });
    if (kind === 'sing-box') {
      await assert.rejects(manager._connect(credentialNode, [domainRule('geosite:category-ads-all')], [], { ...settings, useTunMode: true }), /sing-box/);
      assert.equal(children.length, 0, 'unsupported mapping must fail before launching the checker');
    }
    await assert.rejects(manager._connect(credentialNode, [domainRule('regexp:(?=lookahead)')], [], { ...settings, useTunMode: true }), error =>
      /Runtime отклонил/.test(error.message) && !error.message.includes(sentinel));
    await assert.rejects(manager._connect(credentialNode, [domainRule('example.org')], [], { ...settings, useTunMode: true }), error => error === afterPreflight);
  }
  assert.equal(children.length, 4); assert.equal(releases.length, 4); assert.equal(mutations, 0); assert.equal(writes.length, 0);
  assert.equal(sentinels.length, 4); assert.ok(sentinels.every(Boolean)); assert.equal(leakedOutput.length, 0);
  assert.ok(children.every(child => child.exitCode !== null || child.signalCode));
  assert.equal(manager.isChildProcessAlive(oldChild), true);
  assert.equal(manager.snapshot.nodeId, 'old');
  recordEvidence('preflight', { actualNativeChecks: children.length, accepted: 2, rejected: 2, teardownMutations: mutations,
    oldOwnedChildPreserved: true, configurationFileWrites: writes.length, credentialOnlyInStdin: sentinels.every(Boolean),
    credentialInOutput: false, actualCheckerChildrenRetired: true });
});

test('an actual owned child exiting before buffered stdin completes and oversized input fail before teardown', async t => {
  const directory = await temporaryDirectory(t, 'rules-input-');
  const oldChild = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  await once(oldChild, 'spawn');
  t.after(async () => { if (oldChild.exitCode === null && !oldChild.signalCode) { const exited = once(oldChild, 'exit'); oldChild.kill(); await exited; } });
  const checkingChildren = [], inputErrors = [], writes = [];
  // This boundary uses a real owned Node child to close the OS stdin pipe early;
  // it does not claim that the pinned core itself exhibits this fault.
  const pipePeer = () => {};
  pipePeer[promisify.custom] = (_binary, _args, options) => {
    const check = promisify(execFile)(process.execPath, ['-e', 'require("node:fs").closeSync(0);setTimeout(()=>process.exit(0),1000)'], { ...options, cwd: directory });
    checkingChildren.push(check.child); check.child.stdin.once('error', error => inputErrors.push(error.code)); return check;
  };
  let padding = 300000;
  const checkingConfig = { ...ConfigBuilder, buildSingBox(...args) {
    const config = JSON.parse(ConfigBuilder.buildSingBox(...args)); config.fixturePadding = 'x'.repeat(padding); return JSON.stringify(config);
  } };
  const privatePromises = { ...fsp };
  for (const method of ['mkdir', 'writeFile', 'rm', 'open']) privatePromises[method] = () => { writes.push(method); throw new Error('Preflight cannot write files'); };
  class RuntimeInstaller {} class KillSwitch { isActive() { return false; } }
  const { VpnRuntimeManager } = loadRecovered('electron/ipc/vpn-manager', { EventEmitter, RuntimeInstaller, KillSwitch, path, os,
    promises: privatePromises, process, promisify, execFile: pipePeer, randomUUID, ConfigBuilder: checkingConfig, buildProtocolRuntimePlan,
    runtimeExecutionEnvironment: (_lease, inherited) => inherited,
    logger: { info() {}, warn() {}, debug() {}, error() {} }, formatRuntimeLogEvent: value => JSON.stringify(value) }, ['VpnRuntimeManager']);
  const manager = new VpnRuntimeManager(directory, directory); manager.cachedIsAdmin = false;
  manager.applyActiveSession({ process: oldChild, processGeneration: 1, startedAt: new Date().toISOString(), nodeId: 'old', proxyPort: 10001,
    socksPort: 10001, runtimeKind: 'sing-box', configPath: null, activeRuntimePath: process.execPath, processRulesApplied: false });
  manager.lastSettings = { useTunMode: true };
  manager.resolveRuntimePath = async () => ({ runtimeKind: 'sing-box', runtimePath: process.execPath });
  let releases = 0, mutations = 0;
  manager.verifyRuntimeCandidate = async () => ({ runtimePath: process.execPath, watch() {}, release() { releases++; } });
  manager.clearPendingHandoff = () => { mutations++; throw new Error('Unexpected teardown'); };
  const startedAt = performance.now();
  await assert.rejects(manager._connect(node, [domainRule('example.org')], [], { ...settings, useTunMode: true }), /Runtime отклонил/);
  const elapsedMs = performance.now() - startedAt;
  assert.ok(elapsedMs < 5000, 'early closed pipe must not wait for the full native timeout');
  assert.equal(checkingChildren.length, 1); assert.ok(inputErrors.length > 0); assert.equal(checkingChildren[0].exitCode, 0);
  assert.ok(checkingChildren[0].exitCode !== null || checkingChildren[0].signalCode); assert.equal(releases, 1);
  padding = 1048576;
  await assert.rejects(manager._connect(node, [domainRule('example.org')], [], { ...settings, useTunMode: true }), /Runtime отклонил/);
  assert.equal(checkingChildren.length, 1, 'oversized JSON must fail without another child');
  assert.equal(mutations, 0); assert.equal(writes.length, 0); assert.equal(manager.isChildProcessAlive(oldChild), true);
  recordEvidence('stdinFailure', { ownedPipeChildRetired: true, checkerExitCode: checkingChildren[0].exitCode, checkedFailure: true,
    inputErrors, elapsedMs, oldOwnedChildPreserved: true,
    oversizedInputRejectedBeforeSpawn: true, teardownMutations: mutations, configurationFileWrites: writes.length });
});

async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
async function socksPeer(t, label) {
  const hits = [], sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let stage = 0, pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      if (!stage) { if (pending.length < 2 || pending.length < 2 + pending[1]) return;
        pending = pending.subarray(2 + pending[1]); socket.write(Buffer.from([5, 0])); stage = 1; }
      if (stage === 1 && pending.length >= 5) {
        const size = pending[3] === 3 ? 7 + pending[4] : pending[3] === 1 ? 10 : 22;
        if (pending.length < size) return;
        assert.equal(pending[0], 5); assert.equal(pending[1], 1); assert.equal(pending[3], 3);
        hits.push(pending.subarray(5, 5 + pending[4]).toString('ascii'));
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80])); socket.end(label); stage = 2;
      }
    });
  });
  const port = await listen(server);
  let closed;
  const close = () => closed ??= (async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); })();
  t.after(close);
  return { port, hits, sockets, close };
}
async function freePort() { const server = createServer(); const port = await listen(server); await new Promise(resolve => server.close(resolve)); return port; }
async function waitForCore(child, port, logs) {
  const deadline = performance.now() + 7000;
  while (performance.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) throw new Error('Pinned core exited: ' + logs());
    const ready = await new Promise(resolve => { const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => { socket.destroy(); resolve(false); }); });
    if (ready) return; await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Pinned loopback core did not become ready: ' + logs());
}
function routedRequest(port, domain) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port }); let stage = 0, pending = Buffer.alloc(0), settled = false;
    const timer = setTimeout(() => finish(new Error('Loopback routed request deadline exceeded')), 3000);
    function finish(error, result) { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(result); }
    socket.on('error', error => finish(error)); socket.on('close', () => { if (!settled) finish(new Error('Loopback routed request closed without a result')); });
    socket.once('connect', () => socket.write(Buffer.from([5, 1, 0])));
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      if (!stage && pending.length >= 2) {
        if (pending[0] !== 5 || pending[1] !== 0) return finish(new Error('SOCKS greeting rejected'));
        pending = pending.subarray(2); const host = Buffer.from(domain, 'ascii');
        socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, host.length]), host, Buffer.from([0, 80])])); stage = 1;
      }
      if (stage === 1 && pending.length >= 5) {
        if (pending[0] !== 5 || pending[1] !== 0) return finish(new Error('SOCKS routed request rejected'));
        const size = pending[3] === 3 ? 7 + pending[4] : pending[3] === 1 ? 10 : 22;
        if (pending.length < size) return; pending = pending.subarray(size); stage = 2;
      }
      if (stage === 2 && pending.length) finish(null, pending.toString('ascii'));
    });
  });
}

async function runRouteFixture(t, kind, domainRules, processRules, requests) {
  const binary = runtimeBinary(t, kind); if (!binary) return [];
  const dir = await temporaryDirectory(t, 'rules-route-'), matched = await socksPeer(t, 'MATCH'), missed = await socksPeer(t, 'MISS'), port = await freePort();
  const generated = kind === 'xray' ? xray(domainRules, processRules, processRules.length > 0) : sing(domainRules, processRules, processRules.length > 0);
  const rules = kind === 'xray' ? generated.routing.rules.filter(rule => rule.process || rule.domain && !rule.domain.includes('geosite:cn'))
    : generated.route.rules.filter(rule => rule.process_name || ['domain', 'domain_suffix', 'domain_keyword', 'domain_regex'].some(field => rule[field]));
  const config = kind === 'xray' ? { log: { loglevel: 'warning' }, inbounds: [{ listen: '127.0.0.1', port, protocol: 'socks', settings: { auth: 'noauth' } }],
    outbounds: [{ protocol: 'socks', tag: 'proxy', settings: { servers: [{ address: '127.0.0.1', port: matched.port }] } },
      { protocol: 'socks', tag: 'direct', settings: { servers: [{ address: '127.0.0.1', port: missed.port }] } }],
    routing: { domainStrategy: 'AsIs', rules: [...rules, { type: 'field', network: 'tcp,udp', outboundTag: 'direct' }] } }
    : { log: { level: 'error' }, inbounds: [{ type: 'socks', listen: '127.0.0.1', listen_port: port }],
      outbounds: [{ type: 'socks', tag: 'proxy', server: '127.0.0.1', server_port: matched.port },
        { type: 'socks', tag: 'direct', server: '127.0.0.1', server_port: missed.port }], route: { rules, final: 'direct' } };
  const file = path.join(dir, 'loopback.json'); await fsp.writeFile(file, JSON.stringify(config));
  await nativeCheck(binary, kind, config);
  const child = spawn(binary, ['run', '-c', file], { windowsHide: true, cwd: path.dirname(binary), stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk.toString()).slice(-32768); });
  const results = [];
  try { await waitForCore(child, port, () => logs);
    for (const [domain, expected] of requests) { const actual = await routedRequest(port, domain); assert.equal(actual, expected, `${kind} rule decision for ${domain}`); results.push({ runtime: kind, domain, expected, actual }); }
  } finally {
    if (child.exitCode === null && !child.signalCode) { const exited = once(child, 'exit'); child.kill(); await exited; }
    await Promise.all([matched.close(), missed.close()]);
    assert.equal(matched.sockets.size + missed.sockets.size, 0, 'loopback peer sockets must close');
  }
  return results;
}

test('actual loopback routing proves the same plain-domain boundary in both pinned cores', async t => {
  const results = [];
  for (const kind of ['xray', 'sing-box']) results.push(...await runRouteFixture(t, kind, [domainRule('example.org')], [],
    [['example.org', 'MATCH'], ['www.example.org', 'MATCH'], ['notexample.org', 'MISS'], ['example.org.evil', 'MISS']]));
  recordEvidence('plainDomainRouteDecisions', results);
});

test('actual loopback routing keeps full, keyword and regexp decisions distinct in both pinned cores', async t => {
  const results = [], cases = [
    ['full:exact.example.org', [['exact.example.org', 'MATCH'], ['sub.exact.example.org', 'MISS']]],
    ['keyword:needle', [['needle.example.org', 'MATCH'], ['n.example.org', 'MISS']]],
    ['regexp:^api[0-9]+\\.example\\.org$', [['api2.example.org', 'MATCH'], ['api.example.org', 'MISS']]]
  ];
  for (const kind of ['xray', 'sing-box']) for (const [pattern, requests] of cases) results.push(...await runRouteFixture(t, kind, [domainRule(pattern)], [], requests));
  recordEvidence('explicitDomainRouteDecisions', results);
});

test('actual Windows loopback process lookup distinguishes the owned node.exe client from another basename', async t => {
  const results = [];
  for (const kind of ['xray', 'sing-box']) {
    for (const [processName, expected] of [[path.basename(process.execPath), 'MATCH'], ['lagom-not-this-owned-client.exe', 'MISS']])
      results.push(...await runRouteFixture(t, kind, [], [{ id: 'process', process: processName, mode: 'vpn' }], [['process.fixture.test', expected]]));
  }
  recordEvidence('loopbackProcessRouteDecisions', results);
});
