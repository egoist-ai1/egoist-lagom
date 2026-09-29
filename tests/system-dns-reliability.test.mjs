import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { isIP } from 'node:net';
import { execFileSync, spawnSync } from 'node:child_process';

function source(name) {
  return process.env.LAGOM_DNS_BASELINE === '1'
    ? execFileSync('git', ['show', `b8662d3:src/recovered/${name}.js`], { encoding: 'utf8', windowsHide: true })
    : fs.readFileSync(`src/recovered/${name}.js`, 'utf8');
}
function load(name, bindings, exports) {
  const context = vm.createContext({ Buffer, setTimeout, clearTimeout, console, structuredClone, ...bindings });
  vm.runInContext(`${source(name)}\n;globalThis.exports = {${exports.join(',')}}`, context);
  return context.exports;
}
const transactionScripts = load('electron/ipc/dns-transaction', { promisify: value => value, execFile() {} }, ['createDnsRestoreScript', 'createSnapshotScript']);
const dnsScripts = load('electron/ipc/system-dns', { promisify: value => value, execFile() {}, __exportAll: value => value }, ['createWindowsDnsScript']);

function mockPowerShell(script) {
  return spawnSync(`${process.env.SystemRoot || 'C:/Windows'}/System32/WindowsPowerShell/v1.0/powershell.exe`, [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
}

const baseline = { interfaceIndex: 7, interfaceAlias: 'Ethernet', interfaceGuid: 'saved-guid', ipv4: ['192.0.2.53'], ipv6: [], ipv4Static: true, ipv6Static: false };
function restoreFixture(current, { ignoreWrites = false } = {}) {
  return `
$global:state = @{ ipv4 = @{ addresses = @('${current}'); static = $true }; ipv6 = @{ addresses = @(); static = $false } }
$global:writes = New-Object System.Collections.Generic.List[string]
function Get-NetAdapter { param($InterfaceIndex,$ErrorAction) [pscustomobject]@{InterfaceGuid='saved-guid';ifIndex=19;Name='Ethernet'} }
function Get-DnsClientServerAddress { param($InterfaceIndex,$AddressFamily,$ErrorAction) [pscustomobject]@{ServerAddresses=@($global:state[$AddressFamily.ToLower()].addresses)} }
function Get-ItemProperty { param($Path,$ErrorAction) $family=if($Path -like '*Tcpip6*'){'ipv6'}else{'ipv4'}; [pscustomobject]@{NameServer=if($global:state[$family].static){$global:state[$family].addresses -join ','}else{''}} }
function netsh {
  $global:writes.Add(($args -join ' ')); $global:LASTEXITCODE=0
  ${ignoreWrites ? 'return' : ''}
  $family=[string]$args[1]; $address=($args | Where-Object {$_ -like 'address=*'} | Select-Object -First 1)
  if($args -contains 'source=dhcp') { $global:state[$family].static=$false; $global:state[$family].addresses=@() }
  elseif($address) { $global:state[$family].static=$true; $global:state[$family].addresses=@($address.Substring(8)) }
}
function ipconfig.exe { }
`;
}

test('rollback restores only its owned DNS and preserves a later external edit', { skip: process.platform !== 'win32' }, () => {
  for (const current of ['1.1.1.1', '192.0.2.53', '203.0.113.53']) {
    const script = restoreFixture(current) + transactionScripts.createDnsRestoreScript([baseline], { intent: 'apply', desiredServers: ['1.1.1.1', '1.0.0.1'] }) + '\nWrite-Output ("WRITES=" + $global:writes.Count)';
    const result = mockPowerShell(script);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout.split(/\r?\n/).find(value => value.startsWith('{')));
    if (current === '1.1.1.1') {
      assert.equal(report.restored, 1); assert.equal(report.failures.length, 0); assert.match(result.stdout, /WRITES=1/);
    } else if (current === '192.0.2.53') {
      assert.equal(report.restored, 1); assert.match(result.stdout, /WRITES=0/);
    } else {
      assert.equal(report.restored, 0); assert.match(report.failures[0], /outside/); assert.match(result.stdout, /WRITES=0/);
    }
  }
});

test('rollback requires DNS readback even when netsh returns success', { skip: process.platform !== 'win32' }, () => {
  const result = mockPowerShell(restoreFixture('1.1.1.1', { ignoreWrites: true }) + transactionScripts.createDnsRestoreScript([baseline], { intent: 'apply', desiredServers: ['1.1.1.1'] }));
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim());
  assert.equal(report.restored, 0);
  assert.match(report.failures[0], /readback failed/);
});

test('rollback preserves an external IPv4 edit while independently restoring its owned IPv6 change', { skip: process.platform !== 'win32' }, () => {
  const snapshot = { ...baseline, ipv6: ['2001:db8::53'], ipv6Static: true };
  const script = restoreFixture('203.0.113.53') + `
$global:state.ipv6 = @{ addresses = @('2001:db8::1'); static = $true }
` + transactionScripts.createDnsRestoreScript([snapshot], { intent: 'apply', desiredServers: ['1.1.1.1', '2001:db8::1'] }) + `
Write-Output ('WRITES=' + ($global:writes -join '|'))
Write-Output ('FINALV4=' + ($global:state.ipv4.addresses -join ','))
Write-Output ('FINALV6=' + ($global:state.ipv6.addresses -join ','))
`;
  const result = mockPowerShell(script);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.split(/\r?\n/).find(value => value.startsWith('{')));
  assert.equal(report.restored, 0, 'the retained external change remains an unresolved adapter');
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0], /ipv4.*outside/);
  assert.match(result.stdout, /WRITES=interface ipv6 set dnsservers/);
  assert.match(result.stdout, /FINALV4=203\.0\.113\.53/);
  assert.match(result.stdout, /FINALV6=2001:db8::53/);
});

test('transaction apply follows its captured GUID, excludes newly connected adapters and rejects index reuse', { skip: process.platform !== 'win32' }, () => {
  for (const exists of [true, false]) {
    const script = `
$global:writes = New-Object System.Collections.Generic.List[int]
function Get-NetIPInterface { foreach($n in @(7,9)) { [pscustomobject]@{InterfaceIndex=$n;ConnectionState='Connected';InterfaceAlias='Ethernet';InterfaceMetric=10} } }
function Get-NetAdapter { param($InterfaceIndex,$ErrorAction)
  [pscustomobject]@{InterfaceGuid='recycled-guid';ifIndex=7;InterfaceDescription='Ethernet'}
  [pscustomobject]@{InterfaceGuid='new-guid';ifIndex=9;InterfaceDescription='Ethernet'}
  ${exists ? "[pscustomobject]@{InterfaceGuid='saved-guid';ifIndex=19;InterfaceDescription='Ethernet'}" : ''}
}
function Set-DnsClientServerAddress { param($InterfaceIndex,$ServerAddresses,$ResetServerAddresses,$ErrorAction) $global:writes.Add($InterfaceIndex) }
function Get-DnsClientServerAddress { param($InterfaceIndex,$ErrorAction) foreach($n in @($InterfaceIndex)){[pscustomobject]@{InterfaceIndex=$n;AddressFamily=2;ServerAddresses=@('1.1.1.1')}} }
function netsh { throw 'unexpected fallback' }
try {
${dnsScripts.createWindowsDnsScript({ reset: false, servers: { servers: ['1.1.1.1'], ipv4Servers: ['1.1.1.1'], ipv6Servers: [] }, adapters: [baseline] })}
} catch { Write-Output ('ERROR=' + $_.Exception.Message) }
Write-Output ('INDICES=' + ($global:writes -join ','))
`;
    const result = mockPowerShell(script);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, exists ? /INDICES=19/ : /INDICES=\r?\n/);
    if (!exists) assert.match(result.stdout, /ERROR=.*no longer present/);
  }
});

test('DNS readback rejects additional unwanted resolvers and an incorrect priority', { skip: process.platform !== 'win32' }, () => {
  for (const configured of ["'1.1.1.1','203.0.113.53'", "'1.0.0.1','1.1.1.1'"]) {
    const result = mockPowerShell(`
function Get-NetIPInterface { [pscustomobject]@{InterfaceIndex=7;InterfaceAlias='Ethernet';ConnectionState='Connected';InterfaceMetric=10} }
function Get-NetAdapter { param($InterfaceIndex,$ErrorAction) [pscustomobject]@{InterfaceDescription='Ethernet';InterfaceGuid='saved-guid';ifIndex=7} }
function Set-DnsClientServerAddress { param($InterfaceIndex,$ServerAddresses,$ResetServerAddresses,$ErrorAction) }
function netsh { throw 'unexpected fallback' }
function Get-DnsClientServerAddress { param($InterfaceIndex,$ErrorAction) [pscustomobject]@{InterfaceIndex=7;AddressFamily=2;ServerAddresses=@(${configured})} }
${dnsScripts.createWindowsDnsScript({ reset: false, servers: { servers: ['1.1.1.1', '1.0.0.1'], ipv4Servers: ['1.1.1.1', '1.0.0.1'], ipv6Servers: [] } })}
`);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
  }
});

test('a VPN-only network cannot enter the fallback snapshot route without a stable uplink', { skip: process.platform !== 'win32' }, () => {
  const result = mockPowerShell(`
function Get-NetIPInterface { [pscustomobject]@{InterfaceIndex=7;InterfaceAlias='WireGuard';ConnectionState='Connected';InterfaceMetric=10} }
function Get-NetAdapter { param($InterfaceIndex,$ErrorAction) [pscustomobject]@{InterfaceDescription='WireGuard';InterfaceGuid='vpn-guid';ifIndex=7} }
function Get-DnsClientServerAddress { throw 'VPN adapter must not be snapshotted' }
${transactionScripts.createSnapshotScript()}
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '[]');
});

function transactionFixture() {
  const files = new Map();
  const operations = [];
  let failPhase = null, failRemoval = false, restores = 0;
  const noFile = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
  const fsMock = {
    mkdir: async () => {},
    readFile: async target => { if (!files.has(target)) throw noFile(); return files.get(target); },
    open: async target => ({
      writeFile: async value => {
        const phase = JSON.parse(value).phase;
        if (phase === failPhase) throw new Error('simulated disk failure');
        operations.push(`write:${phase}`); files.set(target, value);
      },
      sync: async () => operations.push('sync'), close: async () => {},
    }),
    // The baseline uses writeFile; keep its fake operational so failures prove behavior.
    writeFile: async (target, value) => {
      const phase = JSON.parse(value).phase;
      if (phase === failPhase) throw new Error('simulated disk failure');
      files.set(target, value); operations.push(`write:${phase}`);
    },
    rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); operations.push('rename'); },
    rm: async target => { if (failRemoval && target.endsWith('dns-transaction.json')) throw new Error('locked'); files.delete(target); },
  };
  const context = vm.createContext({
    path, isIP, fs$1: fsMock, randomUUID: () => 'test-transaction', promisify: value => value, execFile() {},
    process: { platform: 'win32', pid: 42, env: {} }, logger: { info() {}, warn() {}, error() {} },
    snapshot: [structuredClone(baseline)], fakeRestore: async () => { restores++; return { restored: 1, failures: [] }; },
  });
  vm.runInContext(source('electron/ipc/dns-transaction') + `
readAdapterDnsSnapshot=async()=>snapshot;
restoreAdapterDnsSnapshot=fakeRestore;
configureDnsTransactionStore({programDataDir:'C:/test-state',userDataDir:'C:/profile'});
globalThis.api={beginDnsTransaction,recoverDnsTransaction,readDnsTransaction,transactionPath};
`, context);
  return { api: context.api, files, operations, failPhase: value => { failPhase = value; }, failRemoval: value => { failRemoval = value; }, restores: () => restores };
}

test('DNS journal is synced before rename and commit survives a temporarily locked journal file', async () => {
  const fixture = transactionFixture();
  const handle = await fixture.api.beginDnsTransaction({ intent: 'apply', desiredServers: ['1.1.1.1'] });
  assert.deepEqual(fixture.operations.slice(0, 3), ['write:prepared', 'sync', 'rename']);
  await handle.setPhase('applying'); await handle.setPhase('verified');
  fixture.failRemoval(true); await handle.commit();
  const persisted = JSON.parse(fixture.files.get(fixture.api.transactionPath()));
  assert.equal(persisted.phase, 'committed');
  fixture.failRemoval(false);
  await fixture.api.recoverDnsTransaction();
  assert.equal(fixture.restores(), 0, 'a completed change must not be rolled back because cleanup was delayed');
});

test('an unfinished or corrupt DNS journal cannot be overwritten by a new mutation', async () => {
  const fixture = transactionFixture();
  const handle = await fixture.api.beginDnsTransaction({ intent: 'apply', desiredServers: ['1.1.1.1'] });
  await assert.rejects(fixture.api.beginDnsTransaction({ intent: 'apply', desiredServers: ['8.8.8.8'] }), /уже выполняется/);
  await handle.rollback('test cleanup');
  fixture.files.set(fixture.api.transactionPath(), '{broken');
  await assert.rejects(fixture.api.beginDnsTransaction({ intent: 'apply', desiredServers: ['8.8.8.8'] }), /журнал DNS/);
  assert.equal(fixture.files.get(fixture.api.transactionPath()), '{broken');
});

test('a rollback marker write failure still restores adapter DNS rather than skipping recovery', async () => {
  const fixture = transactionFixture();
  const handle = await fixture.api.beginDnsTransaction({ intent: 'apply', desiredServers: ['1.1.1.1'] });
  await handle.setPhase('applying');
  fixture.failPhase('rollingBack');
  assert.equal((await handle.rollback('write failed')).restored, 1);
  assert.equal(fixture.restores(), 1);
});

test('targeted adapter recovery snapshots only its targets and application remains serialized', async () => {
  const fixture = transactionFixture();
  await assert.rejects(fixture.api.beginDnsTransaction({ intent: 'reset', desiredServers: [], interfaceIndices: [99] }), /со стабильным GUID/);
  let active = 0, maxActive = 0;
  const applied = [];
  const context = vm.createContext({
    promisify: value => value, execFile() {}, __exportAll: value => value,
    beginDnsTransaction: async options => ({
      transaction: { original: [baseline] },
      setPhase: async () => {}, commit: async () => {}, rollback: async () => ({ restored: 1, failures: [] }),
    }),
    fakeApply: async options => {
      active++; maxActive = Math.max(maxActive, active); applied.push(options);
      await new Promise(resolve => setTimeout(resolve, 4)); active--;
    },
  });
  vm.runInContext(source('electron/ipc/system-dns') + '\napplyWindowsDnsScript=fakeApply;globalThis.apply=applyWindowsDnsInTransaction;', context);
  await Promise.all(Array.from({ length: 50 }, () => context.apply({ intent: 'apply', desiredServers: ['1.1.1.1'], scriptOptions: { reset: false } })));
  assert.equal(maxActive, 1);
  assert.equal(applied.length, 50);
  assert.equal(applied.every(options => options.adapters?.[0].interfaceGuid === 'saved-guid'), true);
});
