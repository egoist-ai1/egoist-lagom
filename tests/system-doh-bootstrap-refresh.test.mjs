import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import https from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { Agent, fetch as undiciFetch } from 'undici';

function load(name, bindings, names) {
  const context = vm.createContext({ URL, Buffer, setTimeout, clearTimeout, AbortController, ...bindings });
  vm.runInContext(`${fs.readFileSync(`src/recovered/${name}.js`, 'utf8')}\n;globalThis.api={${names.join(',')}}`, context);
  return context.api;
}
const literals = load('shared/system-dns', {}, ['isValidIpLiteral']);
const secure = load('shared/secure-dns', literals, ['parseCustomDnsUrl', 'normalizeCustomDnsUrl']);
const shared = load('shared/system-doh', secure, ['parseSystemDohUrl', 'normalizeSystemDohUrl', 'normalizeSystemDohLocalAddress', 'buildXrayLocalDohServerUrl', 'SYSTEM_DOH_HEALTH_DOMAIN', 'SYSTEM_DOH_VERIFICATION_DOMAINS']);
const pure = load('electron/ipc/system-doh-manager', shared, ['uniqueIpv4Addresses', 'KNOWN_NATIVE_DOH_SERVERS', 'buildSystemDohXrayConfig']);
const root = path.join('C:/ProgramData', 'EgoistShield', 'Runtime', 'SystemDoH');
const url = 'https://resolver.example/profile?token=fixture';
const configText = `${JSON.stringify({
  ...JSON.parse(pure.buildSystemDohXrayConfig({ url, localAddress: '127.0.0.1', bootstrapHosts: { 'resolver.example': ['192.0.2.10', '192.0.2.20'] } })),
  policy: { levels: { 0: { connIdle: 120 } } },
})}\n`;

function fixture(options = {}) {
  const files = new Map([[path.join(root, 'config.json'), configText]]);
  const events = [];
  let lookupCount = 0, running = true, uid = 0, renameFailed = false, commandFailed = false;
  const noFile = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
  const promises = {
    mkdir: async () => {},
    readFile: async target => { if (!files.has(target)) throw noFile(); return files.get(target); },
    open: async target => ({
      writeFile: async content => { files.set(target, content); events.push(['write', target]); },
      sync: async () => events.push(['sync']), close: async () => {},
    }),
    rename: async (from, to) => {
      if (options.renameError && !renameFailed && to === path.join(root, 'config.json')) { renameFailed = true; throw new Error('simulated atomic replacement failure'); }
      files.set(to, files.get(from)); files.delete(from); events.push(['rename', to]);
    },
    rm: async target => files.delete(target),
  };
  const { SystemDohManager } = load('electron/ipc/system-doh-service-manager', {
    ...shared, ...pure, promises, path, createHash, randomUUID: () => `fixture-${++uid}`,
    process: { pid: 42, env: { ProgramData: 'C:/ProgramData' } }, promisify: value => value, execFile() {},
    resolveSystemDohNativeServers: async (_url, flags) => flags.allowIpv6 ? ['192.0.2.30', '2001:db8::30'] : ['192.0.2.30'],
    resolveSystemDohBootstrapHosts: async () => {
      lookupCount++; events.push(['lookup']);
      if (options.lookupError) throw new Error('simulated HTTPS bootstrap outage');
      return { 'resolver.example': options.addresses ?? ['192.0.2.30'] };
    },
    probeSystemDohBootstrapAddresses: async (value, addresses) => {
      events.push(['preflight', value, Array.from(addresses)]);
      if (options.preflightError) throw new Error('certificate validation failed');
      return addresses;
    },
  }, ['SystemDohManager']);
  const manager = new SystemDohManager('C:/resources', 'C:/app', 'C:/profile', root);
  const state = { url, localAddress: '127.0.0.1', localPort: 53, pid: 99, startedAt: '2026-01-01T00:00:00Z' };
  manager.readManagedState = async () => options.state ?? state;
  manager.queryServiceStatus = async () => ({ installed: true, running, state: running ? 'running' : 'stopped', pid: 99 });
  manager.isManagedServiceOwned = async () => options.owned !== false;
  manager.validateBootstrapConfig = async () => {
    events.push(['validate']); if (options.validationError) throw new Error('Xray rejected candidate');
  };
  manager.controlBootstrapService = async command => {
    events.push([command]);
    if (!commandFailed && options.commandError === command) { commandFailed = true; throw new Error('simulated SCM failure'); }
    running = command === 'start';
  };
  manager.waitForBootstrapServiceState = async expected => { assert.equal(running, expected === 'running'); };
  manager.queryBootstrapServiceState = async () => running ? 'running' : 'stopped';
  const ready = [...(options.readiness ?? [true])];
  manager.waitForBootstrapReady = async () => { events.push(['ready']); options.onReady?.(files); return ready.length ? ready.shift() : true; };
  return { manager, files, events, lookupCount: () => lookupCount, running: value => { running = value; }, original: configText };
}

test('bootstrap maintenance skips unowned, stopped, literal and documented-provider configurations', async () => {
  for (const [options, reason] of [
    [{ owned: false }, 'not-owned'],
    [{ state: { url: 'https://1.1.1.1/dns-query' } }, 'ip-literal'],
    [{ state: { url: 'https://dns.google/dns-query' } }, 'documented-provider'],
  ]) {
    const f = fixture(options);
    assert.equal((await f.manager.refreshBootstrap()).reason, reason);
    assert.equal(f.lookupCount(), 0);
    assert.equal(f.events.length, 0);
  }
  const f = fixture(); f.running(false);
  assert.equal((await f.manager.refreshBootstrap()).reason, 'not-running');
  assert.equal(f.events.some(([event]) => ['stop', 'write', 'rename'].includes(event)), false);
});

test('unchanged address sets do not restart and the attempt throttle persists across manager restarts', async () => {
  const f = fixture({ addresses: ['192.0.2.20', '192.0.2.10', '192.0.2.20'] });
  assert.equal((await f.manager.refreshBootstrap()).reason, 'unchanged');
  assert.equal(f.lookupCount(), 1);
  assert.equal(f.events.some(([event]) => event === 'stop'), false);
  assert.equal(f.files.get(f.manager.configPath), f.original);
  const replacement = fixture();
  replacement.files.set(replacement.manager.bootstrapRefreshPath, f.files.get(f.manager.bootstrapRefreshPath));
  assert.equal((await replacement.manager.refreshBootstrap()).reason, 'rate-limited');
  assert.equal(replacement.lookupCount(), 0);
});

test('bootstrap lookup, TLS preflight and runtime validation failures preserve the running configuration', async () => {
  for (const options of [{ lookupError: true }, { preflightError: true }, { validationError: true }]) {
    const f = fixture(options);
    await assert.rejects(f.manager.refreshBootstrap());
    assert.equal(f.files.get(f.manager.configPath), f.original);
    assert.equal(f.events.some(([event]) => event === 'stop'), false);
    assert.equal((await f.manager.refreshBootstrap()).reason, 'rate-limited');
    assert.equal(f.lookupCount(), 1);
  }
});

test('verified address rotation preserves every other config field and backs up before atomic replacement', async () => {
  const f = fixture();
  const report = await f.manager.refreshBootstrap();
  assert.equal(report.changed, true);
  assert.equal(report.reason, 'refreshed');
  assert.equal(f.files.get(f.manager.bootstrapPreviousConfigPath), f.original);
  const previous = JSON.parse(f.original), next = JSON.parse(f.files.get(f.manager.configPath));
  assert.deepEqual(next.dns.hosts['resolver.example'], ['192.0.2.30']);
  assert.deepEqual(next.dns.hosts[shared.SYSTEM_DOH_HEALTH_DOMAIN], ['127.0.0.1']);
  previous.dns.hosts = next.dns.hosts;
  assert.deepEqual(next, previous);
  const backup = f.events.findIndex(([event, target]) => event === 'rename' && target === f.manager.bootstrapPreviousConfigPath);
  const replacement = f.events.findIndex(([event, target]) => event === 'rename' && target === f.manager.configPath);
  const preflight = f.events.findIndex(([event]) => event === 'preflight');
  const validation = f.events.findIndex(([event]) => event === 'validate');
  const stop = f.events.findIndex(([event]) => event === 'stop');
  assert.ok(preflight < validation && validation < backup && backup < replacement && replacement < stop);
  assert.equal(JSON.parse(f.files.get(f.manager.bootstrapRefreshPath)).phase, 'idle');
});

test('one hundred simultaneous maintenance requests cause one lookup and one verified service restart', async () => {
  const f = fixture();
  const reports = await Promise.all(Array.from({ length: 100 }, () => f.manager.refreshBootstrap()));
  assert.equal(reports.filter(report => report.changed).length, 1);
  assert.equal(reports.filter(report => report.reason === 'rate-limited').length, 99);
  assert.equal(f.lookupCount(), 1);
  assert.equal(f.events.filter(([event]) => event === 'stop').length, 1);
  assert.equal(f.events.filter(([event]) => event === 'ready').length, 1);
});

test('failed readiness rolls back the exact old config and verifies its restarted service', async () => {
  const f = fixture({ readiness: [false, true] });
  await assert.rejects(f.manager.refreshBootstrap(), /предыдущая конфигурация восстановлена/);
  assert.equal(f.files.get(f.manager.configPath), f.original);
  assert.equal(f.events.filter(([event]) => event === 'stop').length, 2);
  assert.equal(f.events.filter(([event]) => event === 'ready').length, 2);
  assert.equal(JSON.parse(f.files.get(f.manager.bootstrapRefreshPath)).phase, 'idle');
});

test('an unavailable old upstream completes config rollback and can retry the next bootstrap rotation', async () => {
  const f = fixture({ readiness: [false, false] });
  await assert.rejects(f.manager.refreshBootstrap(), /работа службы восстановлены, но upstream не прошёл проверку/);
  assert.equal(f.files.get(f.manager.configPath), f.original);
  const metadata = JSON.parse(f.files.get(f.manager.bootstrapRefreshPath));
  assert.equal(metadata.phase, 'idle');
  assert.equal(metadata.previousVerified, false);
  f.files.set(f.manager.bootstrapRefreshPath, JSON.stringify({ ...metadata, lastAttemptAt: Date.now() - 16 * 60 * 1000 }));
  assert.equal((await f.manager.refreshBootstrap()).reason, 'refreshed');
  assert.equal(f.lookupCount(), 2, 'stale pins cannot trap maintenance in a permanent rollback loop');
  assert.deepEqual(JSON.parse(f.files.get(f.manager.configPath)).dns.hosts['resolver.example'], ['192.0.2.30']);
});

test('SCM stop/start failures restore config and can start the previous service even when it is already stopped', async () => {
  for (const command of ['stop', 'start']) {
    const f = fixture({ commandError: command });
    await assert.rejects(f.manager.refreshBootstrap(), /предыдущая конфигурация восстановлена/);
    assert.equal(f.files.get(f.manager.configPath), f.original);
    assert.equal(await f.manager.queryBootstrapServiceState(), 'running');
    assert.equal(JSON.parse(f.files.get(f.manager.bootstrapRefreshPath)).phase, 'idle');
    if (command === 'start') assert.equal(f.events.filter(([event]) => event === 'stop').length, 1, 'rollback must not try to stop an already stopped service');
  }
});

test('a failed atomic replacement preserves the old config without stopping its unchanged service', async () => {
  const f = fixture({ renameError: true });
  await assert.rejects(f.manager.refreshBootstrap());
  assert.equal(f.files.get(f.manager.configPath), f.original);
  assert.equal(f.files.get(f.manager.bootstrapPreviousConfigPath), f.original);
  assert.equal(f.events.some(([event]) => event === 'stop'), false);
});

test('rollback preserves an external config edit made while candidate readiness was being checked', async () => {
  const f = fixture({ readiness: [false], onReady: files => files.set(path.join(root, 'config.json'), '{}\n') });
  await assert.rejects(f.manager.refreshBootstrap(), /предыдущая конфигурация сохранена/);
  assert.equal(f.files.get(f.manager.configPath), '{}\n');
  assert.equal(f.files.get(f.manager.bootstrapPreviousConfigPath), f.original);
  assert.equal(f.events.filter(([event]) => event === 'stop').length, 1);
  assert.equal(JSON.parse(f.files.get(f.manager.bootstrapRefreshPath)).phase, 'switching');
});

test('ownership checks require the expected SCM executable and exact protected runtime/config wrapper', { skip: process.platform !== 'win32' }, async () => {
  for (const fault of ['', 'service-path', 'runtime-path', 'config-argument']) {
    let manager;
    const { SystemDohManager } = load('electron/ipc/system-doh-service-manager', {
      ...shared, path, process, promisify: value => value, resolveWindowsExecutable: value => value,
      execFile: async (_command, args) => {
        const wrapper = fault === 'service-path' ? 'C:/foreign/service.exe' : manager.serviceWrapperPath;
        const runtime = fault === 'runtime-path' ? 'C:/foreign/runtime.exe' : path.join(manager.runtimeDir, 'xray-system-doh.exe');
        const config = fault === 'config-argument' ? 'C:/foreign/config.json' : manager.configPath;
        const xml = `<service><executable>${runtime}</executable><arguments>run -c ${config}</arguments></service>`;
        const literal = value => `'${value.replaceAll("'", "''")}'`;
        const script = `
function Get-CimInstance { [pscustomobject]@{ PathName=${literal(`"${wrapper}"`)} } }
function Get-Content { ${literal(xml)} }
${args.at(-1)}
`;
        const result = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
        assert.equal(result.status, 0, result.stderr);
        return { stdout: result.stdout };
      },
    }, ['SystemDohManager']);
    manager = new SystemDohManager('', '', '', root);
    manager.getManagedRuntimeInfo = async () => ({ runtimePath: path.join(manager.runtimeDir, 'xray-system-doh.exe') });
    assert.equal(await manager.isManagedServiceOwned(), !fault, fault);
  }
});

test('an interrupted owned bootstrap switch recovers without overwriting a later external config edit', async () => {
  for (const external of [false, true]) {
    const f = fixture();
    const candidate = `${f.original} `;
    const hash = value => createHash('sha256').update(value).digest('hex');
    f.files.set(f.manager.bootstrapPreviousConfigPath, f.original);
    f.files.set(f.manager.configPath, external ? '{}\n' : candidate);
    f.files.set(f.manager.bootstrapRefreshPath, JSON.stringify({
      schemaVersion: 1, phase: 'switching', lastAttemptAt: Date.now(), previousHash: hash(f.original), candidateHash: hash(candidate),
    }));
    if (external) {
      await assert.rejects(f.manager.refreshBootstrap(), /чужое изменение сохранено/);
      assert.equal(f.files.get(f.manager.configPath), '{}\n');
      assert.equal(f.events.length, 0);
    } else {
      const report = await f.manager.refreshBootstrap();
      assert.equal(report.reason, 'recovered'); assert.equal(report.rolledBack, true);
      assert.equal(f.files.get(f.manager.configPath), f.original);
    }
    assert.equal(f.lookupCount(), 0);
  }
});

test('native bootstrap helper is read-only and adds IPv6 only when explicitly requested', async () => {
  const f = fixture();
  assert.deepEqual(Array.from((await f.manager.bootstrapServers(url)).servers), ['192.0.2.30']);
  assert.deepEqual(Array.from((await f.manager.bootstrapServers(url, true)).servers), ['192.0.2.30', '2001:db8::30']);
  assert.equal((await f.manager.bootstrapServers(url)).knownProvider, false);
  assert.equal(f.events.filter(([event]) => event === 'preflight').length, 3);
  assert.equal(f.events.some(([event]) => ['stop', 'write', 'rename'].includes(event)), false);
  const failed = fixture({ preflightError: true });
  await assert.rejects(failed.manager.bootstrapServers(url), /HTTPS-проверку/);
  assert.equal(failed.events.some(([event]) => ['stop', 'write', 'rename'].includes(event)), false);
});

test('real bundled Xray accepts the preserved candidate and rejects invalid candidates without service mutations', { timeout: 15000 }, async t => {
  const work = process.env.LAGOM_DNS_TEST_WORK, binary = process.env.LAGOM_XRAY_TEST_BINARY;
  if (!work || !binary) { t.skip('Set task-owned LAGOM_DNS_TEST_WORK and LAGOM_XRAY_TEST_BINARY for real config validation'); return; }
  const lab = await fsp.mkdtemp(path.join(work, 'doh-candidate-'));
  const { SystemDohManager } = load('electron/ipc/system-doh-service-manager', { ...shared, path, process, promises: fsp, promisify, execFile, randomUUID }, ['SystemDohManager']);
  const manager = new SystemDohManager('', '', '', lab);
  manager.getManagedRuntimeInfo = async () => ({ runtimePath: binary });
  const config = JSON.parse(configText);
  config.dns.hosts['resolver.example'] = ['192.0.2.30'];
  await manager.validateBootstrapConfig(JSON.stringify(config));
  config.inbounds[0].protocol = 'invalid-test-protocol';
  await assert.rejects(manager.validateBootstrapConfig(JSON.stringify(config)));
  assert.deepEqual(await fsp.readdir(lab), [], 'candidate files are removed on both validation outcomes');
  t.diagnostic('Real Xray run -test only; no listener bindings, service calls or adapter changes.');
});

test('candidate preflight enforces TLS hostname trust, pins lookup and preserves the selected URL', { timeout: 15000 }, async t => {
  const work = process.env.LAGOM_DNS_TEST_WORK, openssl = process.env.LAGOM_DNS_TEST_OPENSSL, python = process.env.LAGOM_DNS_TEST_PYTHON;
  if (!work || !openssl && !python) { t.skip('Set task-owned LAGOM_DNS_TEST_WORK and LAGOM_DNS_TEST_OPENSSL or LAGOM_DNS_TEST_PYTHON for the local TLS lab'); return; }
  const lab = await fsp.mkdtemp(path.join(work, 'doh-tls-'));
  const keyPath = path.join(lab, 'key.pem'), certPath = path.join(lab, 'cert.pem');
  if (openssl) execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=resolver.example', '-addext', 'subjectAltName=DNS:resolver.example', '-keyout', keyPath, '-out', certPath], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
  else execFileSync(python, ['-c', `
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'resolver.example')])
now = datetime.now(timezone.utc)
cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=2))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName('resolver.example')]), critical=False)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256()))
Path(sys.argv[1]).write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
Path(sys.argv[2]).write_bytes(cert.public_bytes(serialization.Encoding.PEM))
`, keyPath, certPath], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
  const cert = await fsp.readFile(certPath);
  let requests = 0;
  const tlsOptions = { key: await fsp.readFile(keyPath), cert };
  const handler = async (request, response) => {
    requests++;
    if (request.url === '/stall') {
      response.writeHead(200, { 'content-type': 'application/dns-message' });
      response.write(Buffer.from([0]));
      return;
    }
    if (request.url === '/oversized') {
      response.writeHead(200, { 'content-type': 'application/dns-message' });
      response.end(Buffer.alloc(70000));
      return;
    }
    assert.equal(request.url, '/profile?token=fixture');
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const query = Buffer.concat(chunks), header = Buffer.from(query.subarray(0, 12));
    assert.equal(query.readUInt16BE(0), 0, 'DoH preflight uses the same zero message ID as Xray');
    header.writeUInt16BE(0x8180, 2); header.writeUInt16BE(1, 6);
    const answer = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 192, 0, 2, 123]);
    response.writeHead(200, { 'content-type': 'application/dns-message' });
    response.end(Buffer.concat([header, query.subarray(12), answer]));
  };
  const server = https.createServer(tlsOptions, handler);
  server.on('tlsClientError', () => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const server6 = https.createServer(tlsOptions, handler);
  server6.on('tlsClientError', () => {});
  await new Promise(resolve => server6.listen(server.address().port, '::1', resolve));
  t.after(async () => { for (const listener of [server, server6]) { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); } });
  const serviceFunctions = load('electron/ipc/system-doh-service-manager', { promisify, execFile, ...shared }, ['createDnsQuery', 'hasSuccessfulDnsAnswer']);
  const helpers = extra => load('electron/ipc/system-doh-manager', {
    ...shared, ...serviceFunctions, DohBootstrapAgent: extra ?? Agent, dohBootstrapFetch: undiciFetch,
  }, ['probeSystemDohBootstrapAddresses']);
  const port = server.address().port, selected = `https://resolver.example:${port}/profile?token=fixture`;
  await assert.rejects(helpers().probeSystemDohBootstrapAddresses(selected, ['127.0.0.1']));
  assert.equal(requests, 0, 'untrusted certificate must fail before sending the DNS query');
  class FixtureTrustAgent extends Agent { constructor(options) { super({ ...options, connect: { ...options.connect, ca: cert } }); } }
  assert.deepEqual(Array.from(await helpers(FixtureTrustAgent).probeSystemDohBootstrapAddresses(selected, ['127.0.0.1', '::1'])), ['127.0.0.1', '::1']);
  assert.equal(requests, 2);
  assert.deepEqual(Array.from(await helpers(FixtureTrustAgent).probeSystemDohBootstrapAddresses(selected, ['127.0.0.2', '127.0.0.1'])), ['127.0.0.1'], 'unreachable candidates are excluded while verified endpoints remain usable');
  assert.equal(requests, 3);
  await assert.rejects(helpers(FixtureTrustAgent).probeSystemDohBootstrapAddresses(`https://other.example:${port}/profile?token=fixture`, ['127.0.0.1']));
  assert.equal(requests, 3, 'a trusted certificate for the wrong hostname must also fail before a DNS query');
  const started = Date.now();
  await assert.rejects(helpers(FixtureTrustAgent).probeSystemDohBootstrapAddresses(`https://resolver.example:${port}/stall`, ['127.0.0.1']));
  assert.ok(Date.now() - started < 4000, 'the timeout includes the HTTPS response body and closes the stalled connection');
  await assert.rejects(helpers(FixtureTrustAgent).probeSystemDohBootstrapAddresses(`https://resolver.example:${port}/oversized`, ['127.0.0.1']));
  assert.equal(requests, 5);
  t.diagnostic('Local HTTPS lab: no system CA changes, no real adapters/services, candidate lookup pinned to loopback; trust injected only in test Agent.');
});
