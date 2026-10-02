import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { loadRecovered } from './load-recovered.mjs';

const sdk = loadRecovered('electron/ipc/zapret-manager', {
  path, isIP, createHash, promises: fs, package_default: { version: '3.8.0' },
  promisify: fn => fn, execFile: () => {}, logger: { warn() {} },
  escapeXmlText: value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;'),
}, ['ZapretManager', 'splitWindowsCommandLine', 'applyZapretDnsTransportExclusions', 'readZapretOwnedServiceXml']);
const endpoints = [{ address: '192.0.2.10', port: 8443 }, { address: '2001:db8::1', port: 8443 }];
const filter = '!impostor and !loopback and ((tcp and (tcp.DstPort == 443 or tcp.SrcPort == 443 or tcp.DstPort == 8443 or tcp.SrcPort == 8443)) or (udp and (udp.DstPort == 443 or udp.SrcPort == 443)))';
const canonical = 'instagram.com\ncdninstagram.com\nx.com\ntwitter.com\ntwimg.com\nt.co\nfut.gg\n';
const args = value => [...sdk.splitWindowsCommandLine(value)];
function quote(value) { return '"' + value.replaceAll('"', '\\"') + '"'; }

async function fixture(t, { running = true, current = false } = {}) {
  assert.ok(process.env.LAGOM_TEST_TEMP && path.isAbsolute(process.env.LAGOM_TEST_TEMP));
  const root = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP, 'installed-sites-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const work = path.join(root, 'Runtime', 'Zapret'), doh = path.join(root, 'Runtime', 'SystemDoH');
  await fs.mkdir(path.join(work, 'service-wrapper'), { recursive: true });
  await fs.mkdir(path.join(work, 'core', 'lists'), { recursive: true });
  await fs.mkdir(doh, { recursive: true });
  const state = { url: 'https://dns.example:8443/dns-query/test-profile', localAddress: '127.0.0.1', localPort: 53 };
  const config = { inbounds: [{ tag: 'dns-in', protocol: 'dokodemo-door', listen: '127.0.0.1', port: 53 }], dns: { tag: 'doh-upstream', servers: [{ address: state.url }], hosts: { 'dns.example': endpoints.map(e => e.address) } } };
  await fs.writeFile(path.join(doh, 'state.json'), JSON.stringify(state));
  await fs.writeFile(path.join(doh, 'config.json'), JSON.stringify(config));
  const lists = path.join(work, 'core', 'lists');
  const named = '--hostlist=' + path.join(lists, 'list-egoist-sites.txt');
  const legacy = '--wf-tcp=443,8443 --wf-udp=443 --filter-tcp=443 ' + quote('--hostlist=' + path.join(lists, 'list-general.txt')) +
    ' ' + quote('--hostlist=' + path.join(lists, 'list-general-user.txt')) + ' --dpi-desync=fake --dpi-desync-repeats=7 ' + (current ? quote(named) + ' ' : '') +
    '--new --filter-udp=443 --filter-l7=discord,stun --dpi-desync=fake --new --filter-tcp=8443 --hostlist-domains=discord.media --dpi-desync=multisplit ' +
    '--new --filter-tcp=443 ' + quote('--hostlist=' + path.join(root, 'custom', 'list-general.txt')) + ' --dpi-desync=fake';
  const beforeArgs = sdk.applyZapretDnsTransportExclusions(legacy, endpoints, filter);
  const manager = new sdk.ZapretManager('resources', 'app', 'user', work);
  const xmlPath = manager.getServiceWrapperPaths().xmlPath;
  const xml = manager.buildServiceWrapperXml('Existing Custom Profile', path.join(work, 'core', 'bin', 'winws.exe'), beforeArgs);
  await fs.writeFile(xmlPath, xml);
  await fs.writeFile(path.join(lists, 'list-general-user.txt'), 'user.example.org\r\n');
  await fs.writeFile(path.join(lists, 'list-egoist-sites.txt'), 'obsolete.example\n');
  const events = []; let active = running, pid = running ? 100 : 0;
  manager.readDnsKernelCaptureFilter = async () => { throw Error('Existing guarded filter must be reused without native parsing.'); };
  manager.listIntegratedWinwsProcesses = async () => [];
  manager.queryService = async () => ({ installed: true, running: active, state: active ? 'RUNNING' : 'STOPPED' });
  manager.readDnsProtectionServiceIdentity = async () => ({ state: active ? 'Running' : 'Stopped', pid, birth: active ? '2026-10-02T14:00:00Z' : null, image: manager.getServiceWrapperPaths().wrapperPath });
  manager.assertNoExternalConflict = async () => {};
  manager.stopServiceInternal = async () => { events.push('stop'); active = false; pid = 0; };
  manager.startWrappedService = async () => { events.push('start'); active = true; pid = 200; };
  manager.waitForServiceState = async () => {};
  manager.waitForIntegratedWinwsStart = async () => true;
  const dnsBefore = await Promise.all(['state.json', 'config.json'].map(file => fs.readFile(path.join(doh, file))));
  async function unchangedDns() {
    const after = await Promise.all(['state.json', 'config.json'].map(file => fs.readFile(path.join(doh, file))));
    assert.deepEqual(after, dnsBefore);
  }
  async function currentArgs() { return sdk.readZapretOwnedServiceXml(await fs.readFile(xmlPath, 'utf8'), path.join(work, 'core', 'bin', 'winws.exe'), work).arguments; }
  return { root, work, doh, lists, named, manager, xmlPath, xml, beforeArgs, events, running: () => active, unchangedDns, currentArgs };
}

test('normal refresh upgrades actual saved legacy profile with optional hostlist and exact existing DNS guard, preserving every original argument', async t => {
  const f = await fixture(t);
  const result = await f.manager.refreshSystemDohTransportProtection();
  assert.equal(result.changed, true);
  assert.deepEqual(f.events, ['stop', 'start']);
  const after = args(await f.currentArgs());
  assert.equal(after.filter(a => a === f.named).length, 1);
  assert.deepEqual(after.filter(a => a !== f.named), args(f.beforeArgs), 'No defaults, tactics, exclusion flags or custom profile options rebuilt.');
  const guard = after.find(a => a.startsWith('--wf-raw='));
  assert.match(guard, /ip\.DstAddr != 192\.0\.2\.10 or tcp\.DstPort != 8443/);
  assert.match(guard, /ip\.SrcAddr != 192\.0\.2\.10 or tcp\.SrcPort != 8443/);
  assert.match(guard, /ipv6\.DstAddr != 2001:db8::1 or tcp\.DstPort != 8443/);
  assert.match(guard, /ipv6\.SrcAddr != 2001:db8::1 or tcp\.SrcPort != 8443/);
  assert.equal(await fs.readFile(path.join(f.lists, 'list-egoist-sites.txt'), 'utf8'), canonical);
  assert.equal(await fs.readFile(path.join(f.lists, 'list-general-user.txt'), 'utf8'), 'user.example.org\r\n');
  await f.unchangedDns();
  assert.equal((await f.manager.refreshSystemDohTransportProtection()).changed, false);
  assert.deepEqual(f.events, ['stop', 'start']);
});

test('already-current saved profile provisions canonical owned list and stays idempotent without restarting', async t => {
  const f = await fixture(t, { current: true });
  assert.equal((await f.manager.refreshSystemDohTransportProtection()).changed, false);
  assert.equal(await fs.readFile(path.join(f.lists, 'list-egoist-sites.txt'), 'utf8'), canonical);
  assert.deepEqual(f.events, []);
  assert.equal(await fs.readFile(f.xmlPath, 'utf8'), f.xml);
  await f.unchangedDns();
});

test('stopped saved legacy profile gains optional hostlist but remains stopped with the same startup policy', async t => {
  const f = await fixture(t, { running: false });
  const result = await f.manager.refreshSystemDohTransportProtection();
  assert.equal(result.changed, true); assert.equal(result.state, 'stopped');
  assert.ok(args(await f.currentArgs()).includes(f.named));
  assert.deepEqual(f.events, []); assert.equal(f.running(), false);
  assert.deepEqual((await fs.readFile(f.xmlPath, 'utf8')).match(/<startmode>[\s\S]*?<\/startmode>/g), f.xml.match(/<startmode>[\s\S]*?<\/startmode>/g));
  await f.unchangedDns();
});

test('foreign wrapper or process identity cannot provision lists or stop any service', async t => {
  for (const foreign of ['xml', 'identity']) {
    const f = await fixture(t); let provisionCalls = 0;
    const provision = f.manager.ensureUserLists.bind(f.manager);
    f.manager.ensureUserLists = async () => { provisionCalls++; await provision(); };
    if (foreign === 'xml') await fs.writeFile(f.xmlPath, f.xml.replace('<id>EgoistShieldZapret</id>', '<id>Foreign</id>'));
    else f.manager.readDnsProtectionServiceIdentity = async () => { throw Error('Foreign service identity'); };
    await assert.rejects(f.manager.refreshSystemDohTransportProtection());
    assert.equal(provisionCalls, 0); assert.deepEqual(f.events, []);
    assert.equal(await fs.readFile(path.join(f.lists, 'list-egoist-sites.txt'), 'utf8'), 'obsolete.example\n');
    await f.unchangedDns();
  }
});

test('failed hostlist activation restores exact saved profile and running mode while private DNS bytes stay unchanged', async t => {
  const f = await fixture(t); let calls = 0; const start = f.manager.startWrappedService;
  f.manager.startWrappedService = async () => { if (++calls === 1) throw Error('activation failed'); await start(); };
  await assert.rejects(f.manager.refreshSystemDohTransportProtection(), /прежний Zapret восстановлен, DNS сохранён/);
  assert.equal(await fs.readFile(f.xmlPath, 'utf8'), f.xml); assert.equal(f.running(), true);
  await f.unchangedDns();
});

test('changed authenticated wrapper identity is refused before canonical list provisioning', async t => {
  const f = await fixture(t); let identities = 0, provisions = 0;
  const identity = f.manager.readDnsProtectionServiceIdentity;
  f.manager.readDnsProtectionServiceIdentity = async () => ({ ...await identity(), pid: ++identities === 1 ? 100 : 101 });
  const provision = f.manager.ensureUserLists.bind(f.manager);
  f.manager.ensureUserLists = async () => { provisions++; await provision(); };
  await assert.rejects(f.manager.refreshSystemDohTransportProtection(), /изменилась/);
  assert.equal(provisions, 0);
  assert.equal(await fs.readFile(path.join(f.lists, 'list-egoist-sites.txt'), 'utf8'), 'obsolete.example\n');
  assert.deepEqual(f.events, []); await f.unchangedDns();
});

test('missing managed service remains missing without provisioning or activating any profile', async t => {
  const f = await fixture(t, { running: false }); let provisions = 0;
  f.manager.queryService = async () => ({ installed: false, running: false, state: 'MISSING' });
  f.manager.ensureUserLists = async () => { provisions++; };
  const result = await f.manager.refreshSystemDohTransportProtection();
  assert.equal(result.changed, false); assert.equal(result.state, 'not-installed');
  assert.equal(provisions, 0); assert.deepEqual(f.events, []);
  assert.equal(await fs.readFile(f.xmlPath, 'utf8'), f.xml); await f.unchangedDns();
});

test('changed standalone birth is refused before canonical list writes or process stop', async t => {
  const f = await fixture(t, { running: false }); let identities = 0, provisions = 0;
  f.manager.listIntegratedWinwsProcesses = async () => [{ pid: 100 }];
  f.manager.readDnsProtectionStandaloneIdentity = async () => ({ pid: 100, birth: ++identities === 1 ? '2026-10-02T14:00:00Z' : '2026-10-02T14:00:01Z', image: path.join(f.work, 'core', 'bin', 'winws.exe'), arguments: f.beforeArgs, profile: 'Existing Custom Profile', stateFingerprint: 'unchanged' });
  f.manager.ensureUserLists = async () => { provisions++; };
  await assert.rejects(f.manager.refreshSystemDohTransportProtection(), /изменился/);
  assert.equal(provisions, 0); assert.deepEqual(f.events, []);
  assert.equal(await fs.readFile(path.join(f.lists, 'list-egoist-sites.txt'), 'utf8'), 'obsolete.example\n');
  await f.unchangedDns();
});

test('owned standalone refresh activates optional list in actual args and preserves profile, intent and DNS bytes', async t => {
  const f = await fixture(t, { running: false }); let live = true, pid = 100, actualArgs = f.beforeArgs;
  const statePath = path.join(f.work, '.egoistshield-standalone.json');
  const state = () => JSON.stringify({ pid, profile: 'Existing Custom Profile', startedAt: '2026-10-02T14:00:00Z' });
  await fs.writeFile(statePath, state());
  f.manager.listIntegratedWinwsProcesses = async () => live ? [{ pid }] : [];
  f.manager.readDnsProtectionStandaloneIdentity = async () => ({ pid, birth: '2026-10-02T14:00:00Z', image: path.join(f.work, 'core', 'bin', 'winws.exe'), arguments: actualArgs, profile: 'Existing Custom Profile', stateFingerprint: createHash('sha256').update(await fs.readFile(statePath)).digest('hex') });
  f.manager.stopDnsProtectionStandaloneIdentity = async () => { f.events.push('stop-standalone'); live = false; };
  f.manager.startDnsProtectionStandaloneArgs = async (nextArgs, profile) => { assert.equal(profile, 'Existing Custom Profile'); f.events.push('start-standalone'); live = true; pid = 200; actualArgs = nextArgs; await fs.writeFile(statePath, state()); };
  assert.equal((await f.manager.refreshSystemDohTransportProtection()).changed, true);
  assert.ok(args(actualArgs).includes(f.named));
  assert.deepEqual(args(actualArgs).filter(a => a !== f.named), args(f.beforeArgs));
  assert.deepEqual(f.events, ['stop-standalone', 'start-standalone']);
  assert.equal((await f.manager.refreshSystemDohTransportProtection()).changed, false);
  assert.deepEqual(f.events, ['stop-standalone', 'start-standalone']);
  assert.equal(await fs.readFile(f.xmlPath, 'utf8'), f.xml);
  await f.unchangedDns();
});
