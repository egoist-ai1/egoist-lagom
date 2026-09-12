import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { loadRecovered } from './load-recovered.mjs';

function psMock(script) {
  return spawnSync(`${process.env.SystemRoot || 'C:/Windows'}/System32/WindowsPowerShell/v1.0/powershell.exe`, [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
}

test('DNS readback must match each adapter even when every write reports success', { skip: process.platform !== 'win32' }, () => {
  const { createWindowsDnsScript } = loadRecovered('electron/ipc/system-dns', {
    promisify: x => x, execFile() {}, __exportAll: x => x,
  }, ['createWindowsDnsScript']);
  for (const wrongAdapter of [false, true]) {
    const result = psMock(`
function Get-NetIPInterface { foreach($n in @(7,8)) { [pscustomobject]@{InterfaceIndex=$n;InterfaceAlias='Ethernet';ConnectionState='Connected';InterfaceMetric=10} } }
function Get-NetAdapter { param($InterfaceIndex,$ErrorAction) [pscustomobject]@{InterfaceDescription='Ethernet';ifIndex=$InterfaceIndex} }
function Set-DnsClientServerAddress { param($InterfaceIndex,$ServerAddresses,$ResetServerAddresses,$ErrorAction) }
function netsh { throw 'Unexpected fallback'; }
function Get-DnsClientServerAddress { param($InterfaceIndex,$ErrorAction) [pscustomobject]@{InterfaceIndex=7;AddressFamily=2;ServerAddresses=@('1.1.1.1')}; [pscustomobject]@{InterfaceIndex=8;AddressFamily=2;ServerAddresses=@('${wrongAdapter ? '192.0.2.53' : '1.1.1.1'}')} }
${createWindowsDnsScript({ reset: false, servers: { servers: ['1.1.1.1'], ipv4Servers: ['1.1.1.1'], ipv6Servers: [] } })}
Write-Output 'VERIFIED'
`);
    assert.equal(result.status === 0, !wrongAdapter, result.stdout + result.stderr);
  }
});

test('DNS restoration follows the saved GUID to its new index', { skip: process.platform !== 'win32' }, () => {
  const { createDnsRestoreScript } = loadRecovered('electron/ipc/dns-transaction', {
    promisify: x => x, execFile() {},
  }, ['createDnsRestoreScript']);
  const result = psMock(`
$global:mockCalls = New-Object System.Collections.Generic.List[string]
function Get-NetAdapter { param($InterfaceIndex, $ErrorAction) [pscustomobject]@{ InterfaceGuid='saved-guid'; ifIndex=19 } }
function netsh { $global:mockCalls.Add(($args -join ' ')); $global:LASTEXITCODE=0 }
function ipconfig.exe { }
${createDnsRestoreScript([{ interfaceIndex: 7, interfaceGuid: 'saved-guid', ipv4: ['192.0.2.53'], ipv6: [], ipv4Static: true, ipv6Static: false }])}
Write-Output ($global:mockCalls -join '|')
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /name=19/);
  assert.doesNotMatch(result.stdout, /name=7\b/);
});

test('a notification-only proxy retry keeps the journal until WinINet acknowledges restoration', async () => {
  const context = vm.createContext({
    promisify: x => x, execFile() {}, process: { platform: 'win32' },
    randomUUID: () => 'test-id', structuredClone, logger: { warn() {}, error() {} },
  });
  vm.runInContext(fs.readFileSync('src/recovered/electron/ipc/system-proxy.js', 'utf8') + `
globalThis.values=Object.fromEntries(PROXY_VALUE_NAMES.map(name=>[name,{exists:false,value:null}]));
globalThis.journal=null; globalThis.notifyOk=true;
readProxyValues=async()=>structuredClone(values); readRollback=async()=>journal;
writeRollback=async v=>{journal=v}; removeRollback=async()=>{journal=null};
writeRegistryValue=async(name,v)=>{values[name]={...v}};
notifySystemProxyChanged=async()=>notifyOk;
globalThis.enable=enableSystemProxy;globalThis.disable=disableSystemProxy;
`, context);
  assert.equal((await context.enable(1080)).ok, true);
  context.notifyOk = false;
  assert.equal((await context.disable()).ok, false);
  assert.equal((await context.disable()).ok, false, 'already-restored registry must still retry notification');
  assert.ok(context.journal);
  context.notifyOk = true;
  assert.equal((await context.disable()).restored, true);
  assert.equal(context.journal, null);
});

function networkHelpers() {
  return loadRecovered('electron/ipc/safe-network', { AbortController, Error }, [
    'fetchTextWithRetry', 'fetchJsonWithRetry', 'fetchBufferWithRetry',
  ]);
}

test('JSON and buffer helpers include body consumption in their timeout', async () => {
  const api = networkHelpers();
  for (const method of ['fetchJsonWithRetry', 'fetchBufferWithRetry']) {
    let signal;
    await assert.rejects(api[method]('https://example.test', {
      timeoutMs: 20, retries: 0,
      fetchImpl: async (_url, options) => {
        signal = options.signal;
        return new Response(new ReadableStream({ start(controller) {
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        } }));
      },
    }), error => error.name === 'AbortError');
    assert.equal(signal.aborted, true);
  }
});

test('a body timeout retries the whole response and preserves the text result contract', async () => {
  const { fetchTextWithRetry } = networkHelpers();
  let calls = 0;
  const result = await fetchTextWithRetry('https://example.test', {
    timeoutMs: 20, retries: 1, retryBaseDelayMs: 0,
    fetchImpl: async (_url, { signal }) => {
      calls++;
      if (calls > 1) return new Response('complete');
      return new Response(new ReadableStream({ start(controller) {
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      } }));
    },
  });
  assert.equal(result.text, 'complete');
  assert.equal(result.attempts, 2);
  assert.ok(result.elapsedMs >= 20);
});

test('caller cancellation during body reading does not start another network attempt', async () => {
  const { fetchTextWithRetry } = networkHelpers();
  const caller = new AbortController();
  let calls = 0;
  const request = fetchTextWithRetry('https://example.test', {
    timeoutMs: 1000, retries: 2, retryBaseDelayMs: 0, signal: caller.signal,
    fetchImpl: async (_url, { signal }) => {
      calls++;
      return new Response(new ReadableStream({ start(controller) {
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        queueMicrotask(() => caller.abort());
      } }));
    },
  });
  await assert.rejects(request, error => error.name === 'AbortError');
  assert.equal(calls, 1);
});

function combinator(inspectors) {
  const { NetworkCombinatorManager } = loadRecovered('electron/ipc/network-combinator-manager', {
    buildNetworkCombinatorInspection: ({ modules, admin }) => ({ modules, admin,
      activeLocks: [...new Set(modules.flatMap(item => item.ownedLocks ?? []))], activeMutations: [] }),
  }, ['NetworkCombinatorManager']);
  return new NetworkCombinatorManager({ isElevated: async () => true, moduleInspectors: inspectors });
}

test('VPN suspension intent never bypasses an active Zapret mutation', async () => {
  const manager = combinator({ zapret: async () => ({ ownedLocks: ['packet-interception', 'windivert'] }) });
  manager.tryAcquireMutation({ module: 'zapret', action: 'auto-select', requiredLocks: ['packet-interception', 'windivert'], conflictsWith: [] });
  let executed = false;
  await assert.rejects(manager.runCoordinatedMutation({
    module: 'vpn', action: 'connect', requiredLocks: ['traffic-route', 'zapret-suspend'],
    conflictsWith: ['packet-interception', 'windivert'], waitTimeoutMs: 25,
  }, async () => { executed = true; }), /Timed out/);
  assert.equal(executed, false);
});

test('VPN exemption applies only to the Zapret owner and a declared suspension transition', async () => {
  for (const inspectors of [
    { firewall: async () => ({ ownedLocks: ['packet-interception'] }) },
    { zapret: async () => ({ ownedLocks: ['packet-interception'] }) },
  ]) {
    const manager = combinator(inspectors);
    await assert.rejects(manager.runCoordinatedMutation({
      module: 'vpn', action: 'connect', requiredLocks: ['traffic-route', ...(inspectors.firewall ? ['zapret-suspend'] : [])],
      conflictsWith: ['packet-interception'], waitTimeoutMs: 25,
    }, async () => assert.fail('conflicting operation must not execute')), /Timed out/);
  }
});
