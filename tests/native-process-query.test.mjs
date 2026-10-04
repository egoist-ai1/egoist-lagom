import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { isIP } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadRecovered } from './load-recovered.mjs';

const born = '2026-09-29T12:00:00.000Z';
const childBorn = '2026-09-29T12:00:02.000Z';
const wrapper = 'C:\\Fixture\\Telegram\\service-wrapper\\egoistshield-telegram-proxy-service.exe';
const runtime = 'C:\\Fixture\\Telegram\\runtime\\egoistshield-tg-ws-proxy.exe';
const missing = { state: 'missing', ownerPid: null, ownerName: null, ownerCreatedAt: null, rootPid: null, rootCreatedAt: null };
const processRow = (processId, parentProcessId, executablePath, createdAt = born) => ({ processId, parentProcessId, executablePath, createdAt });

function snapshot({ running = false, managed = false, foreign = false } = {}) {
  const ownerPid = foreign ? 900 : 102;
  const rootPid = managed ? 101 : 100;
  const hasOwner = running || managed || foreign;
  return {
    schemaVersion: 2, operation: 'telegram-listener-snapshot', serviceName: 'EgoistShieldTelegramProxy', port: 1443,
    snapshotAvailable: true, stable: true, serviceState: running ? 'Running' : 'Stopped', serviceProcessId: running ? 100 : 0,
    rootProcessPathVerified: running, rootProcessCreatedAt: running ? born : null,
    managedProcessId: managed ? 101 : null, managedIdentityVerified: managed, managedRootCreatedAt: managed ? born : null,
    ipv4: hasOwner ? { state: foreign ? 'foreign' : 'owned', ownerPid, ownerName: foreign ? 'foreign.exe' : 'egoistshield-tg-ws-proxy.exe',
      ownerCreatedAt: childBorn, rootPid: foreign ? null : rootPid, rootCreatedAt: foreign ? null : born } : { ...missing },
    ipv6: { ...missing },
    snapshot: { serviceProcessId: running ? 100 : 0, serviceState: running ? 'Running' : 'Stopped', stable: true,
      processes: [
        ...(running ? [processRow(100, 1, wrapper)] : []),
        ...(managed ? [processRow(101, 1, runtime)] : []),
        ...(hasOwner ? [processRow(ownerPid, foreign ? 1 : rootPid, foreign ? 'C:\\Foreign\\foreign.exe' : runtime, childBorn)] : []),
      ],
      listeners: hasOwner ? [{ localAddress: '127.0.0.1', localPort: 1443, owningProcess: ownerPid }] : [],
    },
  };
}

function telegram(valueOrRead) {
  const calls = [];
  const { TelegramProxyManager } = loadRecovered('electron/ipc/telegram-proxy-manager', {
    path: path.win32, process: { env: {}, platform: 'win32' }, isIP,
    promisify: fn => fn, execFile: async (exe, args, options) => {
      calls.push({ exe, args, options });
      const value = typeof valueOrRead === 'function' ? valueOrRead(calls.length) : valueOrRead;
      if (value instanceof Error) throw value;
      return { stdout: JSON.stringify(value) };
    },
  }, ['TelegramProxyManager']);
  return { manager: new TelegramProxyManager('C:\\Fixture\\resources', 'app', 'user', 'C:\\Fixture\\Telegram'), calls };
}

for (const state of ['not-installed', 'stopped']) {
  test(`Telegram ${state} preflight uses native TCP snapshot without PowerShell`, async () => {
    const { manager, calls } = telegram(snapshot());
    manager.readConfig = async () => ({ host: '127.0.0.1', port: 1443 });
    manager.readManagedState = async () => null;
    manager.isStateRunning = async () => false;
    assert.equal((await manager.assertConfiguredEndpointAvailable({ running: false, state })).state, 'none');
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.ok(call.exe.endsWith('core-service\\win-x64\\EgoistShield.Service.exe'));
      assert.deepEqual(Array.from(call.args), ['--telegram-listener-snapshot', '--port', '1443']);
      assert.ok(call.options.timeout > 0 && call.options.timeout <= 4000);
      assert.equal(Object.hasOwn(call.options, 'env'), false);
    }
  });
}

test('native Telegram running wrapper requires real path, birth and child ancestry proof', async () => {
  assert.equal((await telegram(snapshot({ running: true })).manager.queryListenerOwnership(1443, '127.0.0.1', { serviceRunning: true })).state, 'owned');
  for (const change of [value => value.snapshot.processes[1].parentProcessId = 900,
    value => value.snapshot.processes[0].executablePath = 'C:\\Foreign\\wrapper.exe',
    value => value.snapshot.processes[1].createdAt = null,
    value => value.snapshot.stable = false,
    value => value.snapshot.processes.push({ ...value.snapshot.processes[0] })]) {
    const value = snapshot({ running: true }); change(value);
    assert.equal((await telegram(value).manager.queryListenerOwnership(1443, '127.0.0.1', { serviceRunning: true })).state, 'unknown');
  }
});

test('native managed Telegram proof uses fixed CLI PID/birth with exact allowed runtime path', async () => {
  const state = { pid: 101, startedAt: born };
  const { manager, calls } = telegram(snapshot({ managed: true }));
  assert.equal((await manager.queryListenerOwnership(1443, '127.0.0.1', { managedState: state })).state, 'owned');
  assert.equal(calls[0].args.at(-1), String(Date.parse(born)));
  assert.deepEqual(Array.from(calls[0].args.slice(3, 6)), ['--managed-pid', '101', '--managed-started-at']);
  for (const change of [value => value.managedIdentityVerified = false,
    value => value.snapshot.processes[0].executablePath = 'C:\\Foreign\\egoistshield-tg-ws-proxy.exe',
    value => value.snapshot.processes[0].createdAt = '2026-09-29T12:02:00.000Z',
    value => value.snapshot.processes[1].parentProcessId = 900]) {
    const value = snapshot({ managed: true }); change(value);
    assert.equal((await telegram(value).manager.queryListenerOwnership(1443, '127.0.0.1', { managedState: state })).state, 'unknown');
  }
});

test('native foreign listener blocks service installation before any runtime publication', async () => {
  const { manager } = telegram(snapshot({ foreign: true }));
  manager.queryServiceStatus = async () => ({ running: false, installed: false, state: 'not-installed' });
  manager.readConfig = async () => ({ host: '127.0.0.1', port: 1443 });
  manager.readManagedState = async () => null;
  manager.isStateRunning = async () => false;
  let published = false;
  manager.ensureManagedRuntimeInstalled = async () => { published = true; };
  await assert.rejects(manager.installService(), /1443.*foreign\.exe/);
  assert.equal(published, false);
});

test('native changed, malformed or unavailable listener proof never claims a free port', async () => {
  for (const value of [{ ...snapshot(), snapshotAvailable: false }, { ...snapshot(), schemaVersion: 1 }, new Error('private fixture command details')]) {
    assert.equal((await telegram(value).manager.queryListenerOwnership(1443, '127.0.0.1')).state, 'unknown');
  }
  const changing = telegram(read => read === 1 ? snapshot() : snapshot({ foreign: true }));
  assert.equal((await changing.manager.queryListenerOwnership(1443, '127.0.0.1')).state, 'unknown');
  const invalid = telegram(snapshot());
  assert.equal((await invalid.manager.queryListenerOwnership(1443, '127.0.0.1', { managedState: { pid: 1, startedAt: 'invalid' } })).state, 'unknown');
  assert.equal(invalid.calls.length, 0);
});

function winws(value) {
  const calls = [];
  const { ZapretManager } = loadRecovered('electron/ipc/zapret-manager', {
    path: path.win32, promisify: fn => fn, package_default: { version: '3.8.0' }, logger: { info() {}, warn() {} },
    execFile: async (exe, args, options) => { calls.push({ exe, args, options }); return { stdout: JSON.stringify(value) }; },
  }, ['ZapretManager']);
  return { manager: new ZapretManager('C:\\Fixture\\resources', 'app', 'user', 'C:\\Fixture\\Zapret'), calls };
}
const winwsSnapshot = processes => ({ schemaVersion: 1, operation: 'winws-process-snapshot', processName: 'winws.exe', snapshotAvailable: true, identityComplete: true, processes });

test('WinWS empty and complete process sets use fixed native CLI without CIM or command lines', async () => {
  const empty = winws(winwsSnapshot([]));
  assert.equal((await empty.manager.listWinwsProcesses()).length, 0);
  assert.deepEqual(Array.from(empty.calls[0].args), ['--winws-process-snapshot']);
  assert.equal(empty.calls[0].options.timeout, 12000);
  const row = processRow(123, 1, 'C:\\Fixture\\Zapret\\core\\bin\\winws.exe');
  const { manager } = winws(winwsSnapshot([row]));
  const processes = await manager.listWinwsProcesses();
  assert.equal(processes[0].commandLine, '');
  assert.equal(processes[0].startedAt, born);
  assert.equal(manager.isOwnedWinwsProcess(processes[0], true), true);
  assert.equal(manager.isOwnedWinwsProcess({ pid: 123, executablePath: '', commandLine: '' }, true), false);
});

test('WinWS unreadable, duplicated, malformed and unapproved rows fail closed without exposing output', async () => {
  const row = processRow(123, 1, 'C:\\Fixture\\Zapret\\core\\bin\\winws.exe');
  for (const value of [{ ...winwsSnapshot([row]), identityComplete: false }, { ...winwsSnapshot([row]), identityComplete: undefined },
    winwsSnapshot([{ ...row, executablePath: null }]), winwsSnapshot([row, row]),
    winwsSnapshot([{ ...row, executablePath: 'C:\\Foreign\\private-payload.exe' }]),
    winwsSnapshot([{ ...row, createdAt: null }]), { ...winwsSnapshot([]), snapshotAvailable: false }]) {
    await assert.rejects(winws(value).manager.listWinwsProcesses(), error => /native snapshot failed/.test(error.message) && !/private-payload|executablePath/.test(error.message));
  }
});

test('actual Windows native CLI/API probe uses only own harmless child and ephemeral listeners', { skip: process.platform !== 'win32' }, async () => {
  const base = process.env.LAGOM_TEST_TEMP || process.env.RUNNER_TEMP;
  assert.ok(base && path.isAbsolute(base), 'Set task-owned LAGOM_TEST_TEMP or RUNNER_TEMP');
  const work = await fs.mkdtemp(path.join(base, 'native-query-'));
  const localSdk = path.resolve('.tools/dotnet-10.0.401/dotnet.exe');
  const dotnet = process.env.SHIELD_DOTNET || (process.env.DOTNET_INSTALL_DIR && path.join(process.env.DOTNET_INSTALL_DIR, 'dotnet.exe')) || (await fs.stat(localSdk).then(() => true, () => false) ? localSdk : 'dotnet');
  const env = { ...process.env, LAGOM_NATIVE_QUERY_TEST_ROOT: path.join(work, 'fixture'), DOTNET_CLI_HOME: path.join(work, 'dotnet-home'), NUGET_PACKAGES: process.env.LAGOM_NATIVE_NUGET_ROOT || path.join(work, 'n'), TEMP: work, TMP: work,
    DOTNET_ADD_GLOBAL_TOOLS_TO_PATH:'0',DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' };
  if (path.isAbsolute(dotnet)) { env.DOTNET_ROOT = path.dirname(dotnet); env.DOTNET_ROOT_X64 = path.dirname(dotnet); }
  const run = promisify(execFile);
  const compile = await run(dotnet, ['build', path.resolve('tests/NativeQueryRegression/NativeQueryRegression.csproj'), '-c', 'Release', '--nologo',
    `-p:BaseIntermediateOutputPath=${path.join(work, 'obj').replace(/\\/g, '/')}/`, `-p:OutputPath=${path.join(work, 'bin').replace(/\\/g, '/')}/`], { env, windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 }).catch(async error => {
      await fs.writeFile(path.join(work, 'compile-failed.txt'), (error.stdout ?? '') + (error.stderr ?? ''));
      throw error;
    });
  await fs.writeFile(path.join(work, 'compile.txt'), compile.stdout + compile.stderr);
  const actual = await run(path.join(work, 'bin', 'NativeQueryRegression.exe'), [], { env, windowsHide: true, timeout: 20000, maxBuffer: 128 * 1024 });
  await fs.writeFile(path.join(work, 'actual-native.txt'), actual.stdout + actual.stderr);
  const result = JSON.parse(actual.stdout.trim());
  assert.equal(result.kind, 'actual-harmless-native-query-regression');
  assert.equal(result.actualNativeApis, true);
  assert.ok(result.checks.length >= 20 && result.checks.every(check => check.passed === true));
  assert.equal(result.scmWrites, false);
  assert.equal(result.dnsWrites, false);
  assert.equal(result.registryWrites, false);
  assert.equal(result.serviceInstallationVerified, false);
});
