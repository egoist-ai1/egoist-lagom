import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { loadRecovered } from './load-recovered.mjs';

// Independent audit regressions. All Windows commands below are shadowed by
// in-process PowerShell functions. No host network, registry, or service writes.
function runMockPowerShell(script) {
  return spawnSync(`${process.env.SystemRoot || 'C:/Windows'}/System32/WindowsPowerShell/v1.0/powershell.exe`, [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')
  ], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
}

test('audit: DNS restore never falls back to a recycled index when its saved GUID is missing', { skip: process.platform !== 'win32' }, () => {
  const { createDnsRestoreScript } = loadRecovered('electron/ipc/dns-transaction', { promisify: x => x, execFile() {} }, ['createDnsRestoreScript']);
  const result = runMockPowerShell(`
$global:mockCalls = New-Object System.Collections.Generic.List[string]
function Get-NetAdapter { param($InterfaceIndex, $ErrorAction) [pscustomobject]@{ InterfaceGuid='new-guid'; ifIndex=7 } }
function netsh { $global:mockCalls.Add(($args -join ' ')); $global:LASTEXITCODE=0 }
function ipconfig.exe { }
${createDnsRestoreScript([{ interfaceIndex: 7, interfaceGuid: 'removed-guid', ipv4: ['192.0.2.53'], ipv6: [], ipv4Static: true, ipv6Static: false }])}
Write-Output ('MUTATIONS=' + $global:mockCalls.Count)
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /MUTATIONS=0/, result.stdout);
});

test('audit: DNS apply rejects a partial multi-adapter failure', { skip: process.platform !== 'win32' }, () => {
  const { createWindowsDnsScript } = loadRecovered('electron/ipc/system-dns', { promisify: x => x, execFile() {}, __exportAll: x => x }, ['createWindowsDnsScript']);
  const result = runMockPowerShell(`
function Get-NetIPInterface { foreach($n in @(7,8)) { [pscustomobject]@{InterfaceIndex=$n;InterfaceAlias='Ethernet';ConnectionState='Connected';InterfaceMetric=10} } }
function Get-NetAdapter { param($InterfaceIndex,$ErrorAction) [pscustomobject]@{InterfaceDescription='Ethernet';ifIndex=$InterfaceIndex} }
function Set-DnsClientServerAddress { param($InterfaceIndex,$ServerAddresses,$ResetServerAddresses,$ErrorAction) if($InterfaceIndex -eq 8) { throw 'simulated adapter failure' } }
function netsh { $global:LASTEXITCODE=1 }
function Get-DnsClientServerAddress { param($InterfaceIndex,$ErrorAction) [pscustomobject]@{InterfaceIndex=7;AddressFamily=2;ServerAddresses=@('1.1.1.1')}; [pscustomobject]@{InterfaceIndex=8;AddressFamily=2;ServerAddresses=@('192.0.2.53')} }
${createWindowsDnsScript({ reset: false, servers: { servers: ['1.1.1.1'], ipv4Servers: ['1.1.1.1'], ipv6Servers: [] } })}
Write-Output 'SCRIPT_REPORTED_SUCCESS'
`);
  assert.notEqual(result.status, 0, `Partially failed mutation returned success: ${result.stdout}`);
});

function mockProxy() {
  const context = vm.createContext({
    promisify: x => x, execFile() {}, process: { platform: 'win32' },
    randomUUID: () => 'test-id', structuredClone, logger: { warn() {}, error() {}, info() {} }
  });
  vm.runInContext(fs.readFileSync('src/recovered/electron/ipc/system-proxy.js', 'utf8') + `
globalThis.values=Object.fromEntries(PROXY_VALUE_NAMES.map(name=>[name,{exists:false,value:null}]));
globalThis.journal=null; globalThis.notifyOk=true;
readProxyValues=async()=>structuredClone(values);
readRollback=async()=>journal;
writeRollback=async v=>{journal=v};
removeRollback=async()=>{journal=null};
writeRegistryValue=async(name,v)=>{values[name]={...v}};
notifySystemProxyChanged=async()=>notifyOk;
globalThis.enable=enableSystemProxy;globalThis.disable=disableSystemProxy;
`, context);
  return context;
}

test('audit: failed proxy notification cannot be reported as successful enable', async () => {
  const proxy = mockProxy();
  proxy.notifyOk = false;
  assert.equal((await proxy.enable(1080)).ok, false);
});

test('audit: failed proxy restore notification keeps a retryable journal', async () => {
  const proxy = mockProxy();
  assert.equal((await proxy.enable(1080)).ok, true);
  proxy.notifyOk = false;
  const result = await proxy.disable();
  assert.equal(result.ok, false);
  assert.ok(proxy.journal);
});

test('audit: response body is included in the network timeout budget', async () => {
  const { fetchTextWithRetry } = loadRecovered('electron/ipc/safe-network', { AbortController, Error }, ['fetchTextWithRetry']);
  let streamController;
  let signal;
  const stream = new ReadableStream({ start(controller) { streamController = controller; } });
  let settled = false;
  const request = fetchTextWithRetry('https://example.test/sub', {
    timeoutMs: 20, retries: 0,
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      signal.addEventListener('abort', () => streamController.error(new DOMException('aborted', 'AbortError')), { once: true });
      return new Response(stream);
    }
  }).then(() => { settled = true; }, () => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 120));
  const bounded = settled;
  if (!signal.aborted) streamController.close();
  await request;
  assert.equal(bounded, true, '200 response headers disabled the timer, leaving the response body pending indefinitely');
});

test('audit: VPN may acquire the transition that suspends an already-running Zapret', async () => {
  const { NetworkCombinatorManager } = loadRecovered('electron/ipc/network-combinator-manager', {
    buildNetworkCombinatorInspection: ({ modules, admin }) => ({ modules, admin, activeLocks: [...new Set(modules.flatMap(item => item.ownedLocks ?? []))], activeMutations: [] })
  }, ['NetworkCombinatorManager']);
  let zapretRunning = true;
  const manager = new NetworkCombinatorManager({
    isElevated: async () => true,
    moduleInspectors: { zapret: async () => ({ ownedLocks: zapretRunning ? ['packet-interception', 'windivert'] : [] }) }
  });
  // Mirrors handlers-vpn.js connectVpn intent; prepareForVpn runs inside operation.
  await manager.runCoordinatedMutation({
    module: 'vpn', action: 'connect', requiredLocks: ['traffic-route', 'zapret-suspend'],
    conflictsWith: ['packet-interception', 'windivert'], waitTimeoutMs: 35
  }, async () => { zapretRunning = false; });
  assert.equal(zapretRunning, false);
});
