import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { loadRecovered } from './load-recovered.mjs';

const noLog = { info() {}, warn() {}, error() {}, debug() {} };
const foreignListener = { state: 'foreign', ownerPid: 900, ownerName: 'egoist-tg-proxy.exe' };

function telegramFixture(ownership = foreignListener) {
  const events = [];
  const { TelegramProxyManager } = loadRecovered('electron/ipc/telegram-proxy-manager', {
    path: path.win32, process: { env: {}, platform: 'win32' }, randomBytes,
    promisify: fn => fn,
    execFile: async (_exe, _args, options) => {
      assert.ok(options.timeout <= 4000, 'listener ownership query has a bounded deadline');
      if (ownership instanceof Error) throw ownership;
      return { stdout: JSON.stringify(ownership) };
    },
    resolveWindowsExecutable: name => name,
    resolveTelegramProxyChecksumState: () => 'verified',
    buildTelegramProxyLinks: () => ({}),
    buildTelegramProxyUpdateGate: () => ({}),
    buildTelegramProxyHealthState: value => value,
  }, ['TelegramProxyManager']);
  const manager = new TelegramProxyManager('resources', 'app', 'user', 'C:\\Lagom\\Telegram');
  manager.appendProxyLog = async () => {};
  manager.ensureConfigExists = async () => {};
  manager.readConfig = async () => ({ host: '127.0.0.1', port: 1443, secret: 'a'.repeat(32), checkUpdates: false });
  manager.readManagedState = async () => null;
  manager.isStateRunning = async () => false;
  manager.queryServiceStatus = async () => ({ installed: true, running: true, state: 'running', pid: 100 });
  manager.readLogTailLines = async () => [];
  manager.readRuntimeTraffic = () => ({ rx: 0, tx: 0, source: 'unavailable' });
  manager.getManagedRuntimeInfo = async () => ({ runtimePath: 'runtime.exe', version: '1' });
  manager.getBundledRuntimeInfo = async () => null;
  manager.sha256File = async () => null;
  manager.isLocalTcpPortOpen = async () => true;
  manager.ensureManagedRuntimeInstalled = async () => { events.push('runtime'); return { runtimePath: 'runtime.exe' }; };
  manager.ensureServicePersistence = async () => { events.push('persistence'); };
  manager.stopServiceInternal = async () => { events.push('stop'); };
  manager.stopStaleTelegramProxyProcesses = async () => { events.push('cleanup'); };
  manager.writeServiceWrapperConfig = async () => { events.push('write'); };
  manager.status = async () => ({ running: true, runtimeReady: true });
  return { manager, events };
}

test('foreign Relay listener cannot make a running Telegram wrapper ready', async () => {
  const { manager } = telegramFixture();
  const status = await manager.readStatus();
  assert.equal(status.serviceRunning, true);
  assert.equal(status.running, false);
  assert.equal(status.runtimeReady, false);
  assert.equal(status.listenerReady, false);
  assert.equal(status.listenerOwnership, 'foreign');
  assert.equal(status.portConflict.available, false);
  assert.match(status.portConflict.owner, /egoist-tg-proxy/);
  assert.match(status.lastError, /1443.*egoist-tg-proxy/);
});

test('Telegram foreign-port preflight prevents runtime publication, stop and another spawn', async () => {
  const { manager, events } = telegramFixture();
  await assert.rejects(manager.startService(), /1443.*egoist-tg-proxy/);
  assert.deepEqual(events, []);
});

test('Telegram readiness wait rejects a foreign port even when SCM remains running', async () => {
  const { manager } = telegramFixture();
  await assert.rejects(manager.waitForServiceReady(1443, 50), /1443.*egoist-tg-proxy/);
});

test('Telegram unknown listener ownership blocks start without exposing command details', async () => {
  const { manager, events } = telegramFixture(new Error('a private diagnostic must not be echoed'));
  await assert.rejects(manager.startService(), error => /принадлежность|владельца/.test(error.message) && !/private diagnostic/.test(error.message));
  assert.deepEqual(events, []);
});

test('an owned Telegram listener remains ready and preserves its configured port', async () => {
  const { manager } = telegramFixture({ state: 'owned', ownerPid: 102, ownerName: 'egoistshield-tg-ws-proxy.exe' });
  const status = await manager.readStatus();
  assert.equal(status.running, true);
  assert.equal(status.listenerReady, true);
  assert.equal(status.listenerOwnership, 'owned');
  assert.equal(status.config.port, 1443);
  assert.equal(status.portConflict.available, true);
  assert.equal(status.portConflict.owner, null);
});

test('an unknown Telegram owner stays unready and does not claim the port is free', async () => {
  const { manager } = telegramFixture(new Error('ownership probe unavailable'));
  const status = await manager.readStatus();
  assert.equal(status.running, false);
  assert.equal(status.listenerOwnership, 'unknown');
  assert.equal(status.portConflict.available, null);
  assert.match(status.lastError, /владельца/);
});

test('current foreign or unknown Telegram ownership takes precedence over an old action error', async () => {
  for (const ownership of [foreignListener, new Error('ownership probe unavailable')]) {
    const { manager } = telegramFixture(ownership);
    manager.lastError = 'an old unrelated action error';
    const status = await manager.readStatus();
    assert.equal(status.running, false);
    assert.match(status.lastError, ownership === foreignListener ? /1443.*egoist-tg-proxy/ : /владельца/);
    assert.equal(status.lastError.includes('old unrelated'), false);
  }
});

const nativePowerShell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const { buildTelegramProxyListenerOwnershipScript } = loadRecovered('electron/ipc/telegram-proxy-manager', {
  promisify: fn => fn, execFile: () => {},
}, ['buildTelegramProxyListenerOwnershipScript']);
const wrapperPath = 'C:\\Lagom\\Telegram\\service-wrapper\\egoistshield-telegram-proxy-service.exe';
const runtimePath = 'C:\\Lagom\\Telegram\\runtime\\egoistshield-tg-ws-proxy.exe';
const fixtureRows = [
  { ProcessId: 100, ParentProcessId: 50, CreationDate: '2026-09-29T12:00:00Z', ExecutablePath: wrapperPath, Name: 'egoistshield-telegram-proxy-service.exe' },
  { ProcessId: 101, ParentProcessId: 100, CreationDate: '2026-09-29T12:00:01Z', ExecutablePath: runtimePath, Name: 'egoistshield-tg-ws-proxy.exe' },
  { ProcessId: 102, ParentProcessId: 101, CreationDate: '2026-09-29T12:00:02Z', ExecutablePath: runtimePath, Name: 'egoistshield-tg-ws-proxy.exe' },
  { ProcessId: 900, ParentProcessId: 500, CreationDate: '2026-09-29T11:00:00Z', ExecutablePath: 'C:\\Relay\\egoist-tg-proxy.exe', Name: 'egoist-tg-proxy.exe' },
];

function evaluateOwnershipScript({ rows = fixtureRows, listeners, host = '127.0.0.1', options = { serviceRunning: true, wrapperPath } }) {
  const literal = value => "'" + JSON.stringify(value).replace(/'/g, "''") + "'";
  const fixture = [
    `$fixtureProcesses = ConvertFrom-Json ${literal(rows)}`,
    'foreach ($item in $fixtureProcesses) { $item.CreationDate = [datetime]$item.CreationDate }',
    `$fixtureListeners = ConvertFrom-Json ${literal(listeners)}`,
    'function Get-NetTCPConnection { param($ErrorAction) $fixtureListeners }',
    "function Get-CimInstance { param($ClassName,$Filter,$ErrorAction) if ($ClassName -eq 'Win32_Service') { [pscustomobject]@{ State='Running'; ProcessId=100 } } else { $fixtureProcesses } }",
    buildTelegramProxyListenerOwnershipScript(1443, host, options),
  ].join('\n');
  return JSON.parse(execFileSync(nativePowerShell, ['-NoProfile', '-NonInteractive', '-Command', fixture], { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim());
}

test('PowerShell ownership snapshot accepts the actual service grandchild and refuses foreign Relay', { skip: process.platform !== 'win32' }, () => {
  assert.equal(evaluateOwnershipScript({ listeners: [{ State: 'Listen', LocalPort: 1443, LocalAddress: '127.0.0.1', OwningProcess: 102 }] }).state, 'owned');
  const foreign = evaluateOwnershipScript({ listeners: [{ State: 'Listen', LocalPort: 1443, LocalAddress: '127.0.0.1', OwningProcess: 900 }] });
  assert.equal(foreign.state, 'foreign');
  assert.equal(foreign.ownerName, 'egoist-tg-proxy.exe');
  const recycled = fixtureRows.map(row => row.ProcessId === 900 ? { ...row, ParentProcessId: 100 } : row);
  assert.equal(evaluateOwnershipScript({ rows: recycled, listeners: [{ State: 'Listen', LocalPort: 1443, LocalAddress: '0.0.0.0', OwningProcess: 900 }] }).state, 'foreign');
});

test('PowerShell IPv6 ownership cannot hide a foreign IPv4 listener behind localhost', { skip: process.platform !== 'win32' }, () => {
  const listeners = [
    { State: 'Listen', LocalPort: 1443, LocalAddress: '::1', OwningProcess: 102 },
    { State: 'Listen', LocalPort: 1443, LocalAddress: '127.0.0.1', OwningProcess: 900 },
  ];
  assert.equal(evaluateOwnershipScript({ listeners, host: 'localhost' }).state, 'foreign');
  assert.equal(evaluateOwnershipScript({ listeners, host: '[::1]' }).state, 'owned');
  assert.equal(evaluateOwnershipScript({ listeners: [], host: 'localhost' }).state, 'none');
});

test('PowerShell standalone ownership checks the saved process creation time and executable', { skip: process.platform !== 'win32' }, () => {
  const options = { serviceRunning: false, managedPid: 101, managedStartedAt: '2026-09-29T12:00:01.100Z', managedRuntimePaths: [runtimePath] };
  assert.equal(evaluateOwnershipScript({ options, listeners: [{ State: 'Listen', LocalPort: 1443, LocalAddress: '127.0.0.1', OwningProcess: 102 }] }).state, 'owned');
  assert.throws(() => evaluateOwnershipScript({ options: { ...options, managedStartedAt: '2026-09-29T12:05:00Z' }, listeners: [{ State: 'Listen', LocalPort: 1443, LocalAddress: '127.0.0.1', OwningProcess: 102 }] }), /Managed process identity changed/);
});

test('Telegram CIM service fallback returns the service PID without assigning the PowerShell PID variable', { skip: process.platform !== 'win32' }, async () => {
  const { TelegramProxyManager } = loadRecovered('electron/ipc/telegram-proxy-manager', {
    path: path.win32, process: { env: {} }, promisify: fn => fn,
    resolveWindowsExecutable: name => name,
    execFile: async (_exe, args) => ({ stdout: execFileSync(nativePowerShell, ['-NoProfile', '-NonInteractive', '-Command', "function Get-CimInstance { param($ClassName,$Filter,$ErrorAction) [pscustomobject]@{ State='Running'; ProcessId=100 } }; " + args.at(-1)], { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }) }),
  }, ['TelegramProxyManager']);
  const manager = new TelegramProxyManager('resources', 'app', 'user');
  const result = await manager.queryServiceStatusViaCim();
  assert.equal(result.running, true);
  assert.equal(result.pid, 100);
});

test('a changing Telegram listener snapshot is unknown rather than a free or ready port', async () => {
  const { manager } = telegramFixture({ state: 'none', ownerPid: null, ownerName: null });
  const status = await manager.readStatus();
  assert.equal(status.listenerOwnership, 'unknown');
  assert.equal(status.running, false);
  assert.equal(status.portConflict.available, null);
});

function standaloneFixture(serviceState = 'STOPPED') {
  const events = [];
  const { ZapretManager } = loadRecovered('electron/ipc/zapret-manager', {
    path: path.win32, promisify: fn => fn,
    execFile: async () => { throw new Error('Unexpected host command'); },
    package_default: { version: '3.7.8' }, logger: noLog,
    buildZapretSuspensionState: () => ({ active: false }), findZapretConflicts: () => [],
    buildZapretRecoveryPlan: value => value,
    splitWindowsCommandLine: value => [value],
    spawn: () => { const child = new EventEmitter(); child.pid = 123; child.unref = () => {}; events.push('spawn'); return child; },
  }, ['ZapretManager']);
  const manager = new ZapretManager('resources', 'app', 'user', 'C:\\Lagom\\Zapret');
  manager.ensureProvisioned = async () => {};
  manager.assertNoExternalConflict = async () => {};
  manager.queryService = async () => ({ installed: true, running: serviceState === 'RUNNING', state: serviceState });
  manager.execSc = async args => { events.push(args.join(' ')); };
  manager.stopStandaloneInternal = async () => { events.push('stop-standalone'); };
  manager.buildServiceCommand = async name => ({ profile: { name }, args: 'args', winwsPath: 'winws.exe' });
  manager.writeStandaloneState = async () => {};
  manager.waitForIntegratedWinwsStart = async () => true;
  manager.status = async () => ({ standaloneRunning: true });
  return { manager, events };
}

for (const method of ['startStandalone', 'restartStandalone']) {
  test(`Zapret ${method} disables a stopped automatic SCM registration before spawning`, async () => {
    const { manager, events } = standaloneFixture();
    await manager[method]('General');
    const disable = events.indexOf('config EgoistShieldZapret start= disabled');
    assert.ok(disable >= 0);
    assert.ok(disable < events.indexOf('spawn'));
  });
}

test('Zapret unknown SCM state cannot enter standalone mode', async () => {
  const { manager, events } = standaloneFixture('UNKNOWN');
  await assert.rejects(manager.startStandalone('General'), /состояние|проверить/);
  assert.deepEqual(events, []);
});

test('temporary VPN suspension preserves Zapret service startup mode', async () => {
  const { manager, events } = standaloneFixture('RUNNING');
  manager.readServiceProfile = async () => 'General';
  manager.stopServiceInternal = async clear => { events.push(['stop-service', clear]); };
  await manager.prepareForVpn(true);
  assert.deepEqual(events, [['stop-service', false]]);
  assert.equal(manager.suspendedByVpnMode, 'service');
});
