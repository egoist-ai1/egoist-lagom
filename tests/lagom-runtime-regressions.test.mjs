import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loadRecovered } from './load-recovered.mjs';
import { compactAutoSelectResult } from '../src/component-response.js';

function managerWith(inspectors = {}) {
  const { NetworkCombinatorManager } = loadRecovered('electron/ipc/network-combinator-manager', {
    buildNetworkCombinatorInspection: ({ modules, admin }) => ({ modules, admin, activeLocks: [], activeMutations: [] })
  }, ['NetworkCombinatorManager']);
  return new NetworkCombinatorManager({ isElevated: async () => true, moduleInspectors: inspectors });
}

test('Shield preemption never evicts a live VPN mutation, even after its timestamp looks stale', async () => {
  const manager = managerWith();
  let release;
  let entered;
  const active = new Promise(resolve => { entered = resolve; });
  const vpn = manager.runCoordinatedMutation({module:'vpn',action:'reconnect',requiredLocks:['traffic-route']}, async () => {
    entered(); await new Promise(resolve => { release = resolve; });
  });
  await active;
  for (const value of manager.activeCoordinatedMutations.values()) value.startedAt = '2000-01-01';
  let called = false;
  try {
    await assert.rejects(manager.runCoordinatedMutation({module:'zapret',action:'shield-connect',requiredLocks:['dns'],conflictsWith:['traffic-route'],preempt:true,waitTimeoutMs:25}, async()=>{called=true}), /Timed out/);
    assert.equal(called,false);
    assert.equal(manager.activeCoordinatedMutations.size,1);
  } finally { release(); await vpn; }
  await manager.runCoordinatedMutation({module:'zapret',action:'shield-connect',requiredLocks:['dns']}, async()=>{called=true});
  assert.equal(called,true);
});

test('Shield preemption cannot bypass steady VPN ownership on timeout', async () => {
  const manager=managerWith({vpn:async()=>({ownedLocks:['traffic-route']})});
  let called=false;
  await assert.rejects(manager.runCoordinatedMutation({module:'zapret',action:'shield-connect',requiredLocks:['dns'],conflictsWith:['traffic-route'],preempt:true,waitTimeoutMs:10},async()=>{called=true}), /Timed out/);
  assert.equal(called,false);
});

test('Core mutations from separate clients are serialized before reaching the service', async () => {
  const { CoreServiceClient } = loadRecovered('electron/ipc/port-utils', {
    createConnection: () => {}, createServer: () => {}, execFile: () => {}, fs: {}, net: {}, path: {},
    promisify: () => {}, randomUUID: () => 'test'
  }, ['CoreServiceClient']);
  const client = new CoreServiceClient('\\\\.\\pipe\\test');
  const otherClient = new CoreServiceClient('\\\\.\\pipe\\test');
  const events = [];
  let release;
  client.requestOnce = async operation => {
    events.push(`start:${operation}`);
    await new Promise(resolve => { release = resolve; });
    events.push(`end:${operation}`);
    return { ok: true };
  };
  otherClient.requestOnce = client.requestOnce;
  const first = client.request('component.execute', { id: 1 });
  const second = otherClient.request('component.execute', { id: 2 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['start:component.execute']);
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['start:component.execute', 'end:component.execute', 'start:component.execute']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['start:component.execute', 'end:component.execute', 'start:component.execute', 'end:component.execute']);
});

test('Core mutation queue advances after a failed mutation', async () => {
  const { CoreServiceClient } = loadRecovered('electron/ipc/port-utils', {
    createConnection: () => {}, createServer: () => {}, execFile: () => {}, fs: {}, net: {}, path: {},
    promisify: () => {}, randomUUID: () => 'test'
  }, ['CoreServiceClient']);
  const client = new CoreServiceClient('\\\\.\\pipe\\test');
  let calls = 0;
  client.requestOnce = async () => {
    calls += 1;
    if (calls === 1) throw new Error('first mutation failed');
    return { ok: true };
  };
  await assert.rejects(client.request('component.execute', { id: 1 }), /first mutation failed/);
  assert.deepEqual(await client.request('component.execute', { id: 2 }), { ok: true });
  assert.equal(calls, 2);
});

test('Direct Zapret auto-select restores an unusable owned DNS resolver before probing', async () => {
  const { prepareZapretProbeDns } = loadRecovered('electron/ipc/handlers-zapret', {}, ['prepareZapretProbeDns']);
  const calls = [];
  let running = false;
  const dns = {
    status: async () => ({ running, verified: running }),
    stopAndRemove: async () => { calls.push('restore'); running = false; return { ok: true }; }
  };
  await prepareZapretProbeDns(dns);
  assert.deepEqual(calls, ['restore']);
  running = true;
  calls.length = 0;
  await prepareZapretProbeDns(dns);
  assert.deepEqual(calls, []);
});

const { coordinateShieldAction } = loadRecovered('electron/ipc/handlers-system', {
  promisify:()=>()=>{},execFile(){},CoreServiceClient:class{}
}, ['coordinateShieldAction']);

test('Shield handoff waits for VPN owner and verifies stop before invoking the operation', async () => {
  const manager=managerWith();
  const events=[];
  let running=true;
  const result=await coordinateShieldAction('connect',async()=>{events.push('shield');return 7}, {
    manager,supervisor:{cancel(){events.push('cancel')}},vpn:{status:async()=>({running}),disconnect:async()=>{assert.equal(manager.activeCoordinatedMutations.size,1);events.push('disconnect');running=false}}
  });
  assert.equal(result,7);assert.deepEqual(events,['cancel','disconnect','shield']);
});

test('Shield handoff reports failed VPN stop and never runs the Shield mutation', async () => {
  let called=false;
  await assert.rejects(coordinateShieldAction('connect',async()=>{called=true},{manager:managerWith(),vpn:{status:async()=>({running:true}),disconnect:async()=>({ok:false,message:'Owned VPN failed to stop'})}}), /Owned VPN failed/);
  assert.equal(called,false);
});

test('Telegram ownership discovery failure never falls back to image-name killing or clears state',async()=>{
  const commands=[];
  const {TelegramProxyManager}=loadRecovered('electron/ipc/telegram-proxy-manager',{
    path,promisify:()=>async(executable,args)=>{commands.push([executable,args]);throw new Error('CIM unavailable')},execFile(){},resolveWindowsExecutable:name=>name
  },['TelegramProxyManager']);
  let cleared=false;
  const target=Object.create(TelegramProxyManager.prototype);
  target.clearManagedState=async()=>{cleared=true};
  await assert.rejects(target.stopProcessesUsingManagedRuntime('C:\\Owned\\egoistshield-tg-ws-proxy.exe'),/CIM unavailable/);
  assert.equal(commands.length,1);assert.equal(commands[0][0],'powershell.exe');assert.equal(cleared,false);
});

test('Auto-select completion is compact enough for legacy Core envelopes while retaining the UI result', () => {
  const checks = Array.from({ length: 6 }, (_, index) => ({
    url: `https://target-${index}.example.test/${'x'.repeat(2000)}`,
    ok: index === 0,
    pingMs: 42,
    status: index === 0 ? 200 : 503,
    error: 'probe output '.repeat(1000)
  }));
  const result = {
    completed: true,
    bestProfile: 'general',
    goodProfiles: ['general'],
    badProfiles: Array.from({ length: 21 }, (_, index) => `profile-${index}`),
    testedProfiles: Array.from({ length: 22 }, (_, index) => `profile-${index}`),
    summary: 'Подходит профиль «general»',
    detail: 'Проверка завершена. '.repeat(1000),
    results: Array.from({ length: 22 }, (_, index) => ({
      id: `profile-${index}`,
      configName: `profile-${index}`,
      result: index === 0 ? 'success' : 'error',
      pingMs: 42,
      targets: Array.from({ length: 17 }, (_, targetIndex) => ({
        key: `Target${targetIndex}`,
        label: `Target ${targetIndex}`,
        url: `https://target-${targetIndex}.example.test/${'u'.repeat(2000)}`,
        ok: targetIndex === 0,
        pingMs: 42,
        status: 200,
        error: targetIndex === 0 ? null : 'curl output '.repeat(1000),
        checks
      }))
    }))
  };
  const compact = compactAutoSelectResult(result);
  assert.ok(Buffer.byteLength(JSON.stringify(compact), 'utf8') < 240 * 1024);
  assert.equal(compact.bestProfile, 'general');
  assert.equal(compact.results.length, 22);
  assert.equal(compact.results[0].targets[0].ok, true);
  assert.equal(compact.results[0].targets[0].checks, undefined);
  assert.ok(compact.detail.length <= 2048);
});

test('Auto-select compaction enforces a byte budget for pathological diagnostics', () => {
  const result = {
    completed: true,
    bestProfile: 'general',
    opaque: 'z'.repeat(1024 * 1024),
    goodProfiles: Array.from({ length: 22 }, (_, index) => 'p' + index),
    testedProfiles: Array.from({ length: 22 }, (_, index) => 'p' + index),
    summary: 's'.repeat(5000),
    detail: 'd'.repeat(100000),
    results: Array.from({ length: 22 }, (_, index) => ({
      id: 'p' + index,
      configName: 'p' + index,
      result: 'error',
      error: 'e'.repeat(100000),
      targets: Array.from({ length: 17 }, (_, targetIndex) => ({
        key: 'k' + targetIndex,
        label: 'l'.repeat(1000),
        url: 'https://example.test/' + 'u'.repeat(1000),
        ok: false,
        error: 'x'.repeat(1000),
        pingMs: 1
      }))
    }))
  };
  const compact = compactAutoSelectResult(result);
  assert.ok(Buffer.byteLength(JSON.stringify(compact), 'utf8') < 220 * 1024);
  assert.equal(compact.opaque, undefined);
  assert.equal(compact.results.length, 22);
  assert.ok(compact.results.every(row => row.targets.length <= 8));
});

test('Component worker compacts only the completed Zapret auto-select response', async () => {
  const worker = await fs.readFile('src/component-worker-entry.js', 'utf8');
  assert.match(worker, /compactAutoSelectResult/);
  assert.match(worker, /request\.component === 'Zapret' && request\.method === 'autoSelectBestProfile'/);
});

test('Built UI styles contain no red accent colors', async () => {
  const files = [
    'src/recovered/renderer.css',
    'src/brand/tokens.css',
    'src/brand/compact-ruby.css',
    'src/brand/compact-surfaces.css',
    'src/brand/shield-widget.css',
    'src/brand/final-polish.css'
  ];
  const red = [];
  for (const file of files) {
    const css = await fs.readFile(file, 'utf8');
    for (const match of css.matchAll(/#[0-9a-f]{6,8}\b/gi)) {
      const value = match[0].slice(1, 7);
      const r = Number.parseInt(value.slice(0, 2), 16);
      const g = Number.parseInt(value.slice(2, 4), 16);
      const b = Number.parseInt(value.slice(4, 6), 16);
      if (r >= 96 && r > g + 30 && r > b + 30) red.push(`${file}:${match[0]}`);
    }
  }
  assert.deepEqual(red, []);
});

test('installer and background desktop PowerShell helpers never open visible console windows', async () => {
  const installer = await fs.readFile('src/installer/setup.nsi', 'utf8');
  assert.match(installer, /nsExec::Exec[\s\S]*?-WindowStyle Hidden[\s\S]*?owned-cleanup\.ps1/);
  assert.doesNotMatch(installer, /ExecWait[^\r\n]*powershell\.exe/i);
  assert.doesNotMatch(installer, /Sysnative\\WindowsPowerShell/i);
  const files = [
    'src/recovered/electron/ipc/dns-transaction.js',
    'src/recovered/electron/ipc/github-release.js',
    'src/recovered/electron/ipc/gravityless-dns-manager.js',
    'src/recovered/electron/ipc/handlers-health.js',
    'src/recovered/electron/ipc/handlers-system.js',
    'src/recovered/electron/ipc/system-dns.js',
    'src/recovered/electron/ipc/system-doh-service-manager.js',
    'src/recovered/electron/ipc/system-proxy.js',
    'src/recovered/electron/ipc/telegram-proxy-manager.js',
    'src/recovered/electron/ipc/zapret-manager.js'
  ];
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    let offset = 0;
    while ((offset = source.indexOf('resolveWindowsExecutable("powershell.exe")', offset)) >= 0) {
      const invocation = source.slice(offset, offset + 1400);
      // Flowseal's explicitly user-launched interactive diagnostic uses Read-Host
      // and intentionally owns a console; background operations must stay hidden.
      if (invocation.includes('"-NoExit"')) { offset += 20; continue; }
      assert.match(invocation, /windowsHide:\s*true/, `${file} has a visible PowerShell invocation near offset ${offset}`);
      offset += 20;
    }
  }
});

test('Generated DNS snapshot is valid Windows PowerShell syntax', {skip:process.platform!=='win32'},()=>{
  const {createSnapshotScript}=loadRecovered('electron/ipc/dns-transaction',{promisify:()=>()=>{},execFile(){}},['createSnapshotScript']);
  const encoded=Buffer.from(createSnapshotScript(),'utf8').toString('base64');
  const parser=`$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); $tokens=$null; $errors=$null; $null=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors); if($errors.Count){$errors | ForEach-Object {Write-Output $_.Message};exit 1}`;
  assert.doesNotThrow(()=>execFileSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',parser],{windowsHide:true}));
});

test('Installer uses one canonical path and never kills network processes by image name',async()=>{
  const [nsi,ui,cleanup]=await Promise.all([
    fs.readFile('src/installer/setup.nsi','utf8'),
    fs.readFile('src/installer/ModernInstaller.cs','utf8'),
    fs.readFile('src/installer/owned-cleanup.ps1','utf8')
  ]);
  assert.match(nsi,/InstallDir "\$PROGRAMFILES64\\EgoistShield"/);
  assert.doesNotMatch(nsi,/taskkill\.exe\s+\/F\s+\/IM|net stop WinDivert/i);
  assert.match(nsi,/Ошибка подготовки установки \(код \$PhaseResult\)/);
  assert.doesNotMatch(ui,/GetProcessesByName|KillConflictingProcesses|SuppressBackgroundInstallerWindows|FolderBrowserDialog/);
  assert.doesNotMatch(ui,/MessageBoxIcon\.Error/);
  assert.doesNotMatch(ui,/MessageBox\.Show/);
  assert.doesNotMatch(cleanup,/S-1-5-32-545:\(OI\)\(CI\)M/);
});

test('Installer cleanup recognizes current and legacy owned DNS journals', async () => {
  const cleanup = await fs.readFile('src/installer/owned-cleanup.ps1', 'utf8');
  assert.match(cleanup, /dns-owned-state\.json/);
  assert.match(cleanup, /owned-dns\.json/);
  assert.match(cleanup, /--restore-owned-dns\s+--state-root/);
  assert.match(cleanup, /param\(\[switch\]\$LegacyOnly\)/);
  assert.match(cleanup, /Invoke-CoreOwnedDnsCleanup\s+-LegacyOnly/);
  assert.match(cleanup, /Repair-StaleOwnedRuntimeQuarantine/);
  assert.match(cleanup, /Merge-StaleOwnedRuntimeDirectory/);
  assert.match(cleanup, /stale-runtime-quarantine-reconciled/);
});
