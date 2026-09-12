param([switch]$DnsOnly,[switch]$TelegramOnly)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')) { throw 'Disposable SHIELD-LAB guest required.' }
$scriptPath = 'C:\ShieldLab\components.cjs'
@'
const net = require('node:net');
const dns = require('node:dns').promises;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
if (!['SHIELD-LAB','SHIELD-UD5I7VUH'].includes(process.env.COMPUTERNAME)) throw new Error('Disposable guest required');
const evidence = [];
function request(operation, payload = {}) {
  return new Promise((resolve, reject) => {
    const label = operation + (payload.component ? '/' + payload.component + '.' + payload.method : '');
    let phase = 'connecting';
    const fail = error => reject(new Error(label + ' [' + phase + ']: ' + error.message));
    const requestId = 'lab:' + randomUUID();
    const socket = net.connect('\\\\.\\pipe\\EgoistShield.Service.v1');
    let buffer = '';
    const deadline = operation === 'component.execute' ? 1260000 : ['dns.apply','dns.reset'].includes(operation) ? 720000 : 130000;
    socket.setTimeout(deadline, () => socket.destroy(new Error(operation + ' timed out')));
    socket.on('error', fail);
    socket.on('connect', () => { phase = 'writing request'; socket.write(JSON.stringify({ protocolVersion: 1, requestId, operation, payload }) + '\n', error => { if (error) fail(error); else phase = 'waiting response'; }); });
    socket.on('close', () => { if (!buffer.includes('\n')) fail(new Error('Core closed the pipe before a complete response')); });
    socket.on('data', chunk => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      phase = 'parsing response';
      socket.end();
      try {
        const value = JSON.parse(buffer.split('\n')[0]);
        assert.equal(value.requestId, requestId);
        if (!value.ok) throw new Error(JSON.stringify(value.error));
        resolve(value.result);
      } catch (error) { fail(error); }
    });
  });
}
const component = (name, method, args = [], query = false) => request(query ? 'component.query' : 'component.execute', { component: name, method, args });
async function check(name, action) {
  if(process.env.SHIELD_LAB_DNS_ONLY === '1' && !name.includes('DoH') && !name.startsWith('Installed'))return;
  if(process.env.SHIELD_LAB_TELEGRAM_ONLY === '1' && !name.startsWith('Telegram') && !name.startsWith('Installed'))return;
  const started = Date.now();
  fs.writeFileSync('C:/ShieldLab/component-progress.json', JSON.stringify({ current: name, started, evidence }, null, 2));
  try { await action(); evidence.push({ name, ok: true, ms: Date.now() - started }); }
  catch (error) { evidence.push({ name, ok: false, error: error.message, ms: Date.now() - started }); }
  console.log(JSON.stringify(evidence.at(-1)));
  fs.writeFileSync('C:/ShieldLab/component-progress.json', JSON.stringify({ current: null, evidence }, null, 2));
}
(async () => {
  await check('Installed executable is authenticated without development override', async () => {
    const hello = await request('hello');
    assert.equal(hello.developmentOverride, false);
    assert.equal(hello.identityProbe, false);
  });
  for (const name of ['SystemDoH', 'Zapret', 'TelegramProxy']) {
    await check(name + ' status provisions through the protected worker, stays off', async () => {
      const state = await component(name, 'status', [{ force: true }], true);
      assert.ok(!state.running && !state.serviceRunning && !state.standaloneRunning);
    });
  }
  await check('Mutation rejected on query endpoint', async () => {
    await assert.rejects(component('SystemDoH', 'apply', ['https://cloudflare-dns.com/dns-query'], true));
  });
  await check('System DoH resolves real DNS on Windows and restores adapter ownership', async () => {
    const before = await request('dns.status');
    assert.equal(before.adapters.length, 1, 'DNS restoration fixture requires the single physical lab adapter');
    try {
      const state = await component('SystemDoH', 'apply', ['https://cloudflare-dns.com/dns-query']);
      assert.equal(state.running, true);
      assert.ok(state.localAddress);
      const resolver = new dns.Resolver();
      resolver.setServers([state.localAddress]);
      assert.ok((await resolver.resolve4('example.com')).length > 0);
      await request('dns.apply', { servers: [state.localAddress], probeHosts: ['example.com'] });
      assert.ok((await dns.resolve4('example.com')).length > 0);
    } finally {
      const original = before.adapters[0];
      if(original.ipv4Static) await request('dns.apply', {servers:original.ipv4,probeHosts:['example.com']});
      else await request('dns.reset');
      await component('SystemDoH', 'stopAndRemove');
    }
    const after = await request('dns.status');
    fs.writeFileSync('C:/ShieldLab/dns-roundtrip.json', JSON.stringify({ before, after }, null, 2));
  });
  await check('Telegram service starts, listens locally and stops', async () => {
    try {
      const state = await component('TelegramProxy', 'start');
      assert.equal(state.running, true);
      const port = state.portConflict.port;
      await new Promise((resolve, reject) => {
        const socket = net.connect({ host: '127.0.0.1', port });
        socket.setTimeout(5000, () => socket.destroy(new Error('Telegram listener timeout')));
        socket.once('error', reject);
        socket.once('connect', () => { socket.destroy(); resolve(); });
      });
    } finally { await component('TelegramProxy', 'stopService'); }
    assert.equal((await component('TelegramProxy', 'status', [{ force: true }], true)).running, false);
  });
  await check('Zapret bundled profiles validate and driver-backed service starts and stops', async () => {
    const profiles = await component('Zapret', 'listProfiles');
    assert.ok(Array.isArray(profiles) && profiles.length > 0);
    try {
      await component('Zapret', 'installService');
      await component('Zapret', 'startService');
      const state = await component('Zapret', 'status', [{ force: true }], true);
      assert.equal(state.serviceRunning, true);
    } finally { await component('Zapret', 'stopService'); }
    assert.equal((await component('Zapret', 'status', [{ force: true }], true)).serviceRunning, false);
  });
  fs.writeFileSync('C:/ShieldLab/component-results.json', JSON.stringify(evidence, null, 2));
  process.exitCode = evidence.some(value => !value.ok) ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
'@ | Set-Content -LiteralPath $scriptPath -Encoding UTF8
$before = @(Get-DnsClientServerAddress | Select-Object InterfaceIndex,AddressFamily,ServerAddresses)
$env:ELECTRON_RUN_AS_NODE = '1'
if($DnsOnly){$env:SHIELD_LAB_DNS_ONLY='1'}
if($TelegramOnly){$env:SHIELD_LAB_TELEGRAM_ONLY='1'}
try {
  $componentProcess = Start-Process 'C:\Program Files\EgoistShield\EgoistShield.exe' -ArgumentList $scriptPath -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput 'C:\ShieldLab\component-stdout.txt' -RedirectStandardError 'C:\ShieldLab\component-stderr.txt'
  $componentExit = $componentProcess.ExitCode
  Get-Content 'C:\ShieldLab\component-stdout.txt','C:\ShieldLab\component-stderr.txt' -Encoding UTF8
} finally { Remove-Item Env:\ELECTRON_RUN_AS_NODE; Remove-Item Env:\SHIELD_LAB_DNS_ONLY,Env:\SHIELD_LAB_TELEGRAM_ONLY -ErrorAction SilentlyContinue }
$after = @(Get-DnsClientServerAddress | Select-Object InterfaceIndex,AddressFamily,ServerAddresses)
if (($before | ConvertTo-Json -Depth 4 -Compress) -ne ($after | ConvertTo-Json -Depth 4 -Compress)) { throw 'DNS roundtrip did not restore adapter addresses' }
if ($componentExit -ne 0) { throw "Component integration failures: $componentExit" }
Write-Output 'PASS: component integration and DNS restoration'
