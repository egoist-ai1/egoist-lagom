import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { loadRecovered } from './load-recovered.mjs';

const RUSSIAN_RUNNING_OUTPUT = [
  'Имя_службы: EgoistShieldCore',
  '        Тип                : 10  WIN32_OWN_PROCESS',
  '        Состояние          : 4  RUNNING',
  '                                (STOPPABLE, NOT_PAUSABLE, ACCEPTS_SHUTDOWN)',
  '        Код_выхода_Win32   : 0  (0x0)',
  '        ID_процесса        : 5708',
].join('\r\n');
const ENGLISH_RUNNING_OUTPUT = [
  'SERVICE_NAME: EgoistShieldTelegramProxy',
  '        TYPE               : 10  WIN32_OWN_PROCESS',
  '        STATE              : 4  RUNNING',
  '        PID                : 4812',
].join('\r\n');
const RUSSIAN_START_PENDING_OUTPUT = [
  'Имя_службы: EgoistShieldTelegramProxy',
  '        Состояние          : 2  START_PENDING',
  '        ID_процесса        : 0',
].join('\r\n');
const RUSSIAN_SYSTEM_DOH_RUNNING_OUTPUT = [
  'Имя_службы: EgoistShieldSystemDoH',
  '        Тип                : 10  WIN32_OWN_PROCESS',
  '        Состояние          : 4  RUNNING',
  '        ID_процесса        : 6124',
].join('\r\n');

let scQueryResult = { stdout: '' };
const { TelegramProxyManager } = loadRecovered('electron/ipc/telegram-proxy-manager', {
  promisify: fn => fn,
  execFile: async () => {
    if (scQueryResult instanceof Error) throw scQueryResult;
    return scQueryResult;
  },
  resolveWindowsExecutable: name => `Windows/${name}`,
  path,
  process,
}, ['TelegramProxyManager']);
const { parseScQueryState$1: parseGravitylessScQuery } = loadRecovered('electron/ipc/gravityless-dns', { process }, ['parseScQueryState$1']);
let systemDohScQueryResult = { stdout: '' };
let systemDohCimResult = 'not-installed|0';
let systemDohCalls = [];
const { SystemDohManager } = loadRecovered('electron/ipc/system-doh-service-manager', {
  promisify: fn => fn,
  execFile: async executable => {
    systemDohCalls.push(executable);
    if (executable.endsWith('powershell.exe')) return { stdout: systemDohCimResult };
    if (systemDohScQueryResult instanceof Error) throw systemDohScQueryResult;
    return systemDohScQueryResult;
  },
  resolveWindowsExecutable: name => `Windows/${name}`,
  path,
  process,
}, ['SystemDohManager']);

async function queryTelegramService(scQuery, { controller = null, cim = null } = {}) {
  scQueryResult = scQuery;
  const manager = new TelegramProxyManager('C:/resources', 'C:/app', 'C:/profile');
  manager.queryServiceStatusViaServiceController = async () => controller;
  manager.queryServiceStatusViaCim = async () => cim;
  return manager.queryServiceStatus();
}

async function querySystemDohService(scQuery, cimResult = 'not-installed|0') {
  systemDohScQueryResult = scQuery;
  systemDohCimResult = cimResult;
  systemDohCalls = [];
  const manager = new SystemDohManager('C:/resources', 'C:/app', 'C:/profile');
  return { status: await manager.queryServiceStatus(), calls: systemDohCalls };
}

test('sc.exe state parsing accepts the captured Russian locale output and English output', async () => {
  const russian = await queryTelegramService({ stdout: RUSSIAN_RUNNING_OUTPUT });
  assert.equal(russian.installed, true);
  assert.equal(russian.running, true);
  assert.equal(russian.state, 'running');
  assert.equal(russian.rawState, 'RUNNING');
  assert.equal(russian.pid, null);
  const english = await queryTelegramService({ stdout: ENGLISH_RUNNING_OUTPUT });
  assert.equal(english.running, true);
  assert.equal(english.state, 'running');
  assert.equal(english.pid, 4812);
  assert.equal(parseGravitylessScQuery(RUSSIAN_RUNNING_OUTPUT).state, 'running');
  assert.equal(parseGravitylessScQuery(ENGLISH_RUNNING_OUTPUT).state, 'running');
});

test('sc.exe parser preserves pending, missing, and unknown fallback behaviour', async () => {
  const pendingTelegram = await queryTelegramService({ stdout: RUSSIAN_START_PENDING_OUTPUT });
  assert.equal(pendingTelegram.state, 'start-pending');
  assert.equal(pendingTelegram.running, false);
  const pending = parseGravitylessScQuery(RUSSIAN_START_PENDING_OUTPUT);
  assert.equal(pending.state, 'start-pending');
  const unknown = parseGravitylessScQuery('Состояние          : 9  NOT_A_STATE');
  assert.equal(unknown.state, 'unknown');
  const controllerFallback = { installed: true, running: false, state: 'stopped', rawState: 'Stopped', pid: null };
  assert.strictEqual(await queryTelegramService({ stdout: 'unrecognized sc.exe output' }, { controller: controllerFallback }), controllerFallback);
  const cimFallback = { installed: false, running: false, state: 'not-installed', rawState: null, pid: null };
  const missing = Object.assign(new Error('sc.exe query failed'), { code: 1060 });
  assert.strictEqual(await queryTelegramService(missing, { cim: cimFallback }), cimFallback);
});

test('System DoH parses Russian running and pending states without falling back to CIM', async () => {
  const running = await querySystemDohService({ stdout: RUSSIAN_SYSTEM_DOH_RUNNING_OUTPUT });
  assert.equal(running.status.installed, true);
  assert.equal(running.status.running, true);
  assert.equal(running.status.state, 'running');
  assert.equal(running.status.rawState, 'RUNNING');
  assert.deepEqual(running.calls, ['Windows/sc.exe']);
  const pending = await querySystemDohService({ stdout: RUSSIAN_START_PENDING_OUTPUT });
  assert.equal(pending.status.installed, true);
  assert.equal(pending.status.running, false);
  assert.equal(pending.status.state, 'start-pending');
  assert.deepEqual(pending.calls, ['Windows/sc.exe']);
  const missing = await querySystemDohService(Object.assign(new Error('sc.exe query failed'), { code: 1060 }));
  assert.equal(missing.status.state, 'not-installed');
  assert.deepEqual(missing.calls, ['Windows/sc.exe', 'Windows/powershell.exe']);
});
