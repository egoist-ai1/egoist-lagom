import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

// These are production controller tests with inert transport/OS leaves. They do
// not claim Windows 10/11 native, NRPT, split-DNS, or driver acceptance.
function loadLive(name, bindings, exports) {
  const context = vm.createContext({ URL, Buffer, AbortController, setTimeout, clearTimeout, structuredClone, console, ...bindings });
  vm.runInContext(fs.readFileSync(`src/recovered/${name}.js`, 'utf8') +
    `\n;globalThis.api = { ${exports.join(',')} };`, context);
  return context.api;
}
const { isValidIpLiteral } = loadLive('shared/system-dns', {}, ['isValidIpLiteral']);
const secure = loadLive('shared/secure-dns', { isValidIpLiteral }, ['parseCustomDnsUrl', 'normalizeCustomDnsUrl']);
const shared = loadLive('shared/system-doh', secure, [
  'parseSystemDohUrl', 'normalizeSystemDohUrl', 'normalizeSystemDohLocalAddress',
  'buildSystemDohLoopbackCandidates', 'buildXrayLocalDohServerUrl',
  'SYSTEM_DOH_HEALTH_DOMAIN', 'SYSTEM_DOH_VERIFICATION_DOMAINS',
]);
const deniedExec = async () => { throw new Error('Unexpected OS execution in DNS fixture'); };
const wire = loadLive('electron/ipc/system-doh-service-manager', {
  promisify: value => value, execFile: deniedExec,
}, ['createDnsQuery', 'hasSuccessfulDnsAnswer']);

function resolverFixture({ state: initial = {}, fetchBootstrap, fetchUpstream } = {}) {
  const calls = [], requests = [], agents = [];
  let state = { supported: true, enabled: false, verified: false, encrypted: false,
    url: null, servers: [], fallbackToUdp: false, hasIpv6DefaultRoute: false, ...initial };
  class Agent {
    constructor(options) { this.options = options; agents.push(this); }
    async destroy() { this.destroyed = true; }
  }
  const config = loadLive('electron/ipc/system-doh-manager', {
    ...shared, ...wire, DohBootstrapAgent: Agent,
    fetch: async (url, options) => {
      requests.push({ kind: 'bootstrap', url, options });
      if (!fetchBootstrap) throw new Error('Unconfigured HTTPS bootstrap');
      return fetchBootstrap(url, options);
    },
    dohBootstrapFetch: async (url, options) => {
      requests.push({ kind: 'upstream', url, options });
      if (!fetchUpstream) throw new Error('Unconfigured upstream HTTPS');
      return fetchUpstream(url, options);
    },
  }, ['resolveSystemDohNativeServers', 'resolveSystemDohBootstrapHosts',
    'probeSystemDohBootstrapAddresses', 'buildSystemDohXrayConfig']);
  const core = {
    async nativeDohStatus() { calls.push({ operation: 'status' }); return structuredClone(state); },
    async applyNativeDoh(url, servers, options) {
      calls.push({ operation: 'apply', url, servers: Array.from(servers), options });
      if (core.applyError) throw core.applyError;
      state = { ...state, url, servers: Array.from(servers), enabled: true, verified: true, encrypted: true };
      return structuredClone(state);
    },
    async restoreOwnedDns() { calls.push({ operation: 'restore' }); return { pendingAdapters: core.pendingAdapters ?? 0 }; },
    async removeNativeDoh() { calls.push({ operation: 'remove' }); state = { ...state, enabled: false }; return structuredClone(state); },
  };
  const { SystemDohManager } = loadLive('electron/ipc/system-doh-service-manager', {
    ...shared, ...config, path, process: { platform: 'win32', env: {} },
    promisify: value => value, execFile: deniedExec,
    promises: { async readFile() { throw Object.assign(new Error('No managed local state'), { code: 'ENOENT' }); } },
    resolveWindowsExecutable: value => value,
    createSocket() { throw new Error('Unexpected DNS socket in fixture'); },
  }, ['SystemDohManager']);
  const manager = new SystemDohManager('C:/fixture/resources', 'C:/fixture/app', 'C:/fixture/profile', undefined, core);
  return { manager, core, config, calls, requests, agents, state: () => structuredClone(state) };
}

const providers = [
  ['https://cloudflare-dns.com/dns-query', ['1.1.1.1', '1.0.0.1'], ['2606:4700:4700::1111', '2606:4700:4700::1001']],
  ['https://dns.google/dns-query', ['8.8.8.8', '8.8.4.4'], ['2001:4860:4860::8888', '2001:4860:4860::8844']],
  ['https://dns.quad9.net/dns-query', ['9.9.9.9', '149.112.112.112'], ['2620:fe::fe', '2620:fe::9']],
  ['https://dns.adguard-dns.com/dns-query', ['94.140.14.14', '94.140.15.15'], ['2a10:50c0::ad1:ff', '2a10:50c0::ad2:ff']],
];
test('production native provider matrix preserves operator and enables IPv6 only with an authoritative route flag', async t => {
  for (const [url, ipv4, ipv6] of providers) await t.test(new URL(url).host, async () => {
    for (const hasIpv6DefaultRoute of [false, true]) {
      const fixture = resolverFixture({ state: { hasIpv6DefaultRoute } });
      const status = await fixture.manager.apply(url);
      const applied = fixture.calls.filter(call => call.operation === 'apply');
      assert.equal(applied.length, 1);
      assert.deepEqual(applied[0].servers, [...ipv4, ...(hasIpv6DefaultRoute ? ipv6 : [])]);
      assert.deepEqual(Array.from(applied[0].options.probeHosts), Array.from(shared.SYSTEM_DOH_VERIFICATION_DOMAINS));
      assert.equal(status.currentUrl, url);
      assert.equal(status.verified, true);
      assert.equal(status.fallbackToUdp, false);
      assert.equal(fixture.requests.length, 0, 'documented addresses need no bootstrap resolver');
      assert.equal(fixture.calls.some(call => ['restore', 'remove'].includes(call.operation)), false);
    }
  });
});

test('production provider denial leaves a working operator intact without removing DNS or trying public fallback', async () => {
  for (const cause of ['HTTPS 403 policy denied', 'DNS upstream SERVFAIL']) {
    const fixture = resolverFixture({ state: { enabled: true, verified: true, encrypted: true,
      url: providers[2][0], servers: providers[2][1] } });
    const before = fixture.state();
    fixture.core.applyError = new Error(cause);
    await assert.rejects(fixture.manager.apply(providers[0][0]), error => error === fixture.core.applyError);
    assert.deepEqual(fixture.state(), before);
    assert.deepEqual(fixture.calls.filter(call => call.operation !== 'status').map(call => call.operation), ['apply']);
    assert.equal(fixture.requests.length, 0);
  }
});

test('production custom-host bootstrap uses only returned private IPv4/IPv6 addresses', async () => {
  const fixture = resolverFixture({ state: { hasIpv6DefaultRoute: true }, fetchBootstrap: async url => ({
    ok: true, json: async () => ({ Status: 0, Answer: new URL(url).searchParams.get('type') === 'AAAA'
      ? [{ type: 28, data: 'fd00::53' }]
      : [{ type: 1, data: '10.20.30.53' }, { type: 1, data: '10.20.30.53' }, { type: 5, data: 'alias.example' }] }),
  }) });
  const status = await fixture.manager.apply('https://private.example/profile?token=fixture');
  assert.deepEqual(Array.from(status.serverAddresses), ['10.20.30.53', 'fd00::53']);
  assert.equal(status.currentUrl, 'https://private.example/profile?token=fixture');
  assert.equal(fixture.requests.length, 2);
  assert.ok(fixture.requests.every(request => request.kind === 'bootstrap' && request.url.startsWith('https://')));
  assert.ok(fixture.requests.every(request => new URL(request.url).searchParams.get('name') === 'private.example'));
});

test('production unavailable HTTPS bootstrap refuses native admission and preserves existing DNS', async () => {
  const fixture = resolverFixture({ state: { enabled: true, url: providers[2][0], servers: providers[2][1] },
    fetchBootstrap: async () => ({ ok: false, status: 503 }) });
  const before = fixture.state();
  await assert.rejects(fixture.manager.apply('https://private.example/dns-query'), /bootstrap/);
  assert.deepEqual(fixture.state(), before);
  assert.equal(fixture.calls.some(call => call.operation !== 'status'), false);
  assert.equal(fixture.requests.length, 2, 'bounded configured HTTPS paths were attempted');
});

test('production private upstream config has no unsolicited public or plaintext resolver', () => {
  const fixture = resolverFixture();
  const value = JSON.parse(fixture.config.buildSystemDohXrayConfig({
    url: 'https://private.example:8443/profile?token=fixture', localAddress: '127.0.0.1',
    bootstrapHosts: { 'private.example': ['10.20.30.53'] },
  }));
  assert.deepEqual(value.dns.servers.map(server => server.address), ['https://private.example:8443/profile?token=fixture']);
  assert.deepEqual(value.dns.hosts['private.example'], ['10.20.30.53']);
  assert.deepEqual(value.inbounds.map(inbound => inbound.listen), ['127.0.0.1', '::1']);
  assert.equal(value.dns.disableFallback, true);
  assert.equal(value.dns.enableParallelQuery, false);
  assert.equal(value.dns.serveExpiredTTL, 120);
  assert.equal(value.routing.rules.find(rule => rule.inboundTag.includes(value.dns.tag)).outboundTag, 'direct');
  assert.throws(() => fixture.config.buildSystemDohXrayConfig({ url: 'https://private.example/dns-query',
    localAddress: '127.0.0.1', bootstrapHosts: { 'private.example': ['10.20.30.53'] }, fallbackUrls: ['udp://1.1.1.1'] }));
});

test('production private upstream TLS denial disposes every pinned transport and never falls back to a different operator', async () => {
  const fixture = resolverFixture({ fetchUpstream: async () => { throw new Error('TLS certificate rejected'); } });
  await assert.rejects(fixture.config.probeSystemDohBootstrapAddresses(
    'https://private.example/profile?token=fixture', ['10.20.30.53', 'fd00::53']), /HTTPS/);
  assert.equal(fixture.requests.length, 2);
  for (const [index, request] of fixture.requests.entries()) {
    assert.equal(request.url, 'https://private.example/profile?token=fixture');
    assert.equal(request.options.redirect, 'error');
    assert.equal(request.options.signal.aborted, true);
    const agent = fixture.agents[index];
    assert.equal(agent.options.connect.servername, 'private.example');
    assert.equal(agent.options.connect.rejectUnauthorized, true);
    assert.equal(agent.destroyed, true);
    const address = await new Promise((resolve, reject) => agent.options.connect.lookup('private.example', {},
      (error, value) => error ? reject(error) : resolve(value)));
    assert.equal(address, ['10.20.30.53', 'fd00::53'][index]);
  }
});

test('production unknown native status blocks changes instead of treating failed inspection as an empty machine', async () => {
  const fixture = resolverFixture();
  fixture.core.nativeDohStatus = async () => { throw new Error('Core status inaccessible'); };
  const status = await fixture.manager.status({ force: true });
  assert.equal(status.serviceState, 'unavailable');
  assert.equal(status.verified, false);
  await assert.rejects(fixture.manager.apply(providers[0][0]), /проверить текущее состояние DNS/);
  assert.equal(fixture.calls.some(call => call.operation !== 'status'), false);
});

test('production disconnected-adapter restoration blocks resolver removal and keeps restoration intent', async () => {
  const fixture = resolverFixture({ state: { enabled: true, verified: true, url: providers[0][0], servers: providers[0][1] } });
  fixture.core.pendingAdapters = 1;
  const before = fixture.state();
  await assert.rejects(fixture.manager.stopAndRemove(), /адаптер/);
  assert.deepEqual(fixture.state(), before);
  assert.deepEqual(fixture.calls.map(call => call.operation), ['restore']);
});

const transaction = loadLive('electron/ipc/dns-transaction', { promisify: value => value, execFile: deniedExec },
  ['createSnapshotScript', 'createDnsRestoreScript']);
const dnsController = loadLive('electron/ipc/system-dns', { promisify: value => value, execFile: deniedExec,
  __exportAll: value => value }, ['createWindowsDnsScript']);
const ps = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:/Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe') : null;
const osModel = [
  { index: 7, guid: 'ethernet-guid', name: 'Ethernet', description: 'Physical Ethernet',
    ipv4: ['192.0.2.53'], ipv6: ['2001:db8::53'], ipv4Static: false, ipv6Static: false,
    dhcp4: ['192.0.2.53'], dhcp6: ['2001:db8::53'] },
  { index: 12, guid: 'wifi-guid', name: 'Wi-Fi', description: 'Physical Wi-Fi',
    ipv4: ['10.0.0.53', '10.0.0.54'], ipv6: ['fd00::53', 'fd00::54'], ipv4Static: true, ipv6Static: true,
    dhcp4: [], dhcp6: [] },
  { index: 21, guid: 'vpn-guid', name: 'Corporate VPN', description: 'Wintun',
    ipv4: ['10.99.0.53'], ipv6: [], ipv4Static: true, ipv6Static: false, dhcp4: [], dhcp6: [] },
];
const snapshot = osModel.slice(0, 2).map(row => ({ interfaceIndex: row.index, interfaceGuid: row.guid,
  interfaceAlias: row.name, ipv4: row.ipv4, ipv6: row.ipv6, ipv4Static: row.ipv4Static, ipv6Static: row.ipv6Static }));
const desired = ['127.0.0.1', '::1'];
function adapterLeaves(rows, { ignoreWrites = false, useNetsh = false } = {}) {
  const encoded = Buffer.from(JSON.stringify(rows)).toString('base64');
  return `
$global:rows = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))
$global:writes = New-Object System.Collections.Generic.List[string]
$global:ignoreWrites = $${ignoreWrites}
$global:useNetsh = $${useNetsh}
$global:flushes = 0
function Get-NetAdapter {
  param([int]$InterfaceIndex,$ErrorAction)
  foreach($row in $global:rows){if(-not $InterfaceIndex -or $row.index -eq $InterfaceIndex){
    [pscustomobject]@{InterfaceGuid=$row.guid;ifIndex=$row.index;Name=$row.name;InterfaceDescription=$row.description}
  }}
}
function Get-NetIPInterface {
  foreach($row in $global:rows){foreach($family in @('IPv4','IPv6')){
    [pscustomobject]@{InterfaceIndex=$row.index;InterfaceAlias=$row.name;AddressFamily=$family;ConnectionState='Connected';InterfaceMetric=10}
  }}
}
function Get-DnsClientServerAddress {
  param([int[]]$InterfaceIndex,[string]$AddressFamily,$ErrorAction)
  foreach($row in $global:rows){if(-not $InterfaceIndex -or $InterfaceIndex -contains $row.index){
    foreach($family in @('IPv4','IPv6')){if(-not $AddressFamily -or $AddressFamily -eq $family){
      [pscustomobject]@{InterfaceIndex=$row.index;AddressFamily=$(if($family -eq 'IPv4'){2}else{23});ServerAddresses=@($row.($family.ToLower()))}
    }}
  }}
}
function Get-ItemProperty {
  param([string]$Path,$ErrorAction)
  $guid=$Path.Substring($Path.LastIndexOf([char]92)+1);$row=$global:rows|Where-Object {$_.guid -eq $guid}|Select-Object -First 1
  if(-not $row){throw 'Unknown fake registry identity'}
  $family=if($Path -like '*Tcpip6*'){'ipv6'}else{'ipv4'}
  [pscustomobject]@{NameServer=$(if($row.($family+'Static')){$row.$family -join ','}else{''})}
}
function Set-DnsClientServerAddress {
  param([int]$InterfaceIndex,[string[]]$ServerAddresses,[switch]$ResetServerAddresses,$ErrorAction)
  if($global:useNetsh){throw 'Controlled cmdlet failure: use production netsh fallback'}
  $row=$global:rows|Where-Object {$_.index -eq $InterfaceIndex}|Select-Object -First 1
  if(-not $row){throw 'Unknown fake adapter'}
  $global:writes.Add('cmdlet '+$InterfaceIndex)
  if($global:ignoreWrites){return}
  foreach($family in @('ipv4','ipv6')){
    $row.($family+'Static')=-not $ResetServerAddresses
    if($ResetServerAddresses){$row.$family=@($row.($(if($family -eq 'ipv4'){'dhcp4'}else{'dhcp6'})))}
    else{$row.$family=@($ServerAddresses|Where-Object {($_.Contains(':')) -eq ($family -eq 'ipv6')})}
  }
}
function netsh {
  $global:writes.Add('netsh '+($args -join ' '));$global:LASTEXITCODE=0
  if($global:ignoreWrites){return}
  $family=[string]$args[1];$idx=[int]([string]($args|Where-Object {$_ -like 'name=*'}|Select-Object -First 1)).Substring(5)
  $row=$global:rows|Where-Object {$_.index -eq $idx}|Select-Object -First 1
  if(-not $row){throw 'Unknown fake netsh adapter'}
  if($args -contains 'source=dhcp'){$row.($family+'Static')=$false;$row.$family=@($row.($(if($family -eq 'ipv4'){'dhcp4'}else{'dhcp6'})));return}
  $address=([string]($args|Where-Object {$_ -like 'address=*'}|Select-Object -First 1)).Substring(8)
  $row.($family+'Static')=$true
  if($args -contains 'add'){$row.$family=@($row.$family)+@($address)}else{$row.$family=@($address)}
}
function ipconfig.exe {$global:flushes++}
# Assert every OS command used below is shadowed before evaluating production.
foreach($name in @('Get-NetAdapter','Get-NetIPInterface','Get-DnsClientServerAddress','Get-ItemProperty','Set-DnsClientServerAddress','netsh','ipconfig.exe')){
  if((Get-Command $name -CommandType Function -ErrorAction Stop).CommandType -ne 'Function'){throw 'Unsealed fake OS adapter'}
}
`;
}
function runAdapterScript(rows, script, options) {
  // A full apply+restore program exceeds CreateProcess's command-line bound.
  // Compress it into a memory-only loader; no temporary files or OS cmdlets run.
  const encoded = gzipSync(Buffer.from(adapterLeaves(rows, options) + script)).toString('base64');
  const loader = `$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);
$bytes=[Convert]::FromBase64String('${encoded}');$memory=[IO.MemoryStream]::new($bytes,0,$bytes.Length);
$gzip=[IO.Compression.GZipStream]::new($memory,[IO.Compression.CompressionMode]::Decompress);
$reader=[IO.StreamReader]::new($gzip,[Text.Encoding]::UTF8);try{& ([scriptblock]::Create($reader.ReadToEnd()))}finally{$reader.Dispose()}`;
  const child = spawnSync(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(loader, 'utf16le').toString('base64')],
  { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  return child.stdout.trim().split(/\r?\n/).filter(Boolean);
}
const dump = '\nWrite-Output ("STATE=" + (ConvertTo-Json -InputObject @($global:rows) -Compress -Depth 5))\nWrite-Output ("WRITES="+$global:writes.Count)\nWrite-Output ("FLUSHES="+$global:flushes)';
const decodeState = output => JSON.parse(output.find(line => line.startsWith('STATE=')).slice(6));

test('production snapshot includes physical DHCP/static families and excludes the VPN adapter', { skip: !ps }, () => {
  const output = runAdapterScript(osModel, transaction.createSnapshotScript());
  assert.deepEqual(JSON.parse(output.join('')), snapshot);
});

test('production DNS apply and restoration round-trip multiple DHCP/static adapters and both families', { skip: !ps }, () => {
  for (const useNetsh of [false, true]) {
    const apply = dnsController.createWindowsDnsScript({ reset: false, adapters: snapshot,
      servers: { servers: desired, ipv4Servers: ['127.0.0.1'], ipv6Servers: ['::1'] } });
    const restore = transaction.createDnsRestoreScript(snapshot, { intent: 'apply', desiredServers: desired });
    const output = runAdapterScript(osModel, apply + '\n' + restore + dump, { useNetsh });
    assert.deepEqual(decodeState(output), osModel);
    const report = JSON.parse(output.find(line => line.startsWith('{')));
    assert.equal(report.restored, 2);
    assert.deepEqual(report.failures, []);
    assert.ok(output.includes('FLUSHES=1'));
  }
});

test('production restore follows a moved GUID and preserves an external edit independently per family', { skip: !ps }, () => {
  const rows = structuredClone(osModel);
  rows[0].index = 19;
  rows[0].ipv4 = ['203.0.113.53']; rows[0].ipv4Static = true;
  rows[0].ipv6 = ['::1']; rows[0].ipv6Static = true;
  const output = runAdapterScript(rows, transaction.createDnsRestoreScript(snapshot,
    { intent: 'apply', desiredServers: desired }) + dump);
  const restored = decodeState(output);
  assert.deepEqual(restored[0].ipv4, ['203.0.113.53']);
  assert.equal(restored[0].ipv4Static, true);
  assert.deepEqual(restored[0].ipv6, osModel[0].ipv6);
  assert.equal(restored[0].ipv6Static, false);
  assert.deepEqual(restored[1], osModel[1]);
  const report = JSON.parse(output.find(line => line.startsWith('{')));
  assert.equal(report.restored, 1);
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0], /outside this transaction/);
});

test('production missing-adapter restore never turns a reused index into DHCP', { skip: !ps }, () => {
  const rows = structuredClone(osModel);
  rows[0].guid = 'unrelated-new-guid';
  rows[0].ipv4 = ['203.0.113.53']; rows[0].ipv4Static = true;
  const output = runAdapterScript(rows, transaction.createDnsRestoreScript(snapshot,
    { intent: 'apply', desiredServers: desired }) + dump);
  assert.deepEqual(decodeState(output), rows);
  const report = JSON.parse(output.find(line => line.startsWith('{')));
  assert.equal(report.restored, 1);
  assert.match(report.failures[0], /gone; skipped/);
  assert.ok(output.includes('WRITES=0'));
});

test('production restore rejects a successful netsh acknowledgement without authoritative DNS readback', { skip: !ps }, () => {
  const rows = structuredClone(osModel);
  rows[0].ipv4 = ['127.0.0.1']; rows[0].ipv4Static = true;
  rows[0].ipv6 = ['::1']; rows[0].ipv6Static = true;
  const output = runAdapterScript(rows, transaction.createDnsRestoreScript(snapshot,
    { intent: 'apply', desiredServers: desired }) + dump, { ignoreWrites: true });
  assert.deepEqual(decodeState(output), rows);
  const report = JSON.parse(output.find(line => line.startsWith('{')));
  assert.equal(report.restored, 1);
  assert.equal(report.failures.length, 2);
  assert.ok(report.failures.every(failure => failure.includes('readback failed')));
});
