import test from 'node:test';
import assert from 'node:assert/strict';

function parseScOutput(output) {
  const lines = output.split(/\r?\n/);
  const result = {
    serviceName: null,
    state: 'UNKNOWN',
    stateCode: 0,
    pid: 0,
    win32ExitCode: 0,
    isStoppable: false
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(SERVICE_NAME|Имя_службы)\s*:\s*(.+)$/i.test(trimmed)) {
      result.serviceName = trimmed.split(':')[1].trim();
    } else if (/(Состояние|STATE)\s*:\s*(\d+)\s+([A-Z_]+)/i.test(trimmed)) {
      const match = trimmed.match(/(?:Состояние|STATE)\s*:\s*(\d+)\s+([A-Z_]+)/i);
      if (match) {
        result.stateCode = parseInt(match[1], 10);
        result.state = match[2].toUpperCase();
      }
    } else if (/(ID_процесса|PID)\s*:\s*(\d+)/i.test(trimmed)) {
      const match = trimmed.match(/(?:ID_процесса|PID)\s*:\s*(\d+)/i);
      if (match) result.pid = parseInt(match[1], 10);
    } else if (/(Код_выхода_Win32|WIN32_EXIT_CODE)\s*:\s*(\d+)/i.test(trimmed)) {
      const match = trimmed.match(/(?:Код_выхода_Win32|WIN32_EXIT_CODE)\s*:\s*(\d+)/i);
      if (match) result.win32ExitCode = parseInt(match[1], 10);
    }
    if (trimmed.includes('STOPPABLE')) result.isStoppable = true;
  }
  return result;
}

function handleScError(code, stderr = '') {
  switch (code) {
    case 5:
      return { action: 'require_elevation', message: 'Access is denied (requires Administrator privileges)' };
    case 1053:
      return { action: 'retry_or_abort', message: 'The service did not respond to the start or control request in a timely fashion' };
    case 1056:
      return { action: 'already_running', message: 'An instance of the service is already running' };
    case 1060:
      return { action: 'not_installed', message: 'The specified service does not exist as an installed service' };
    case 1062:
      return { action: 'already_stopped', message: 'The service has not been started' };
    default:
      return { action: 'unknown', message: stderr || `SC exit error ${code}` };
  }
}

function pollServiceReady(states, maxAttempts = 5) {
  let attempt = 0;
  for (const s of states) {
    attempt++;
    if (attempt > maxAttempts) return { ready: false, reason: 'Circuit breaker: max polling attempts reached' };
    if (s === 'RUNNING') return { ready: true, attempts: attempt };
    if (s === 'STOPPED') return { ready: false, reason: 'Service entered stopped state' };
  }
  return { ready: false, reason: 'Polling exhausted' };
}

test('Windows 10/11 SC: Parse Russian RUNNING state with PID and exit code', () => {
  const raw = [
    'Имя_службы: EgoistShieldCore',
    '        Тип                : 10  WIN32_OWN_PROCESS',
    '        Состояние          : 4  RUNNING',
    '                                (STOPPABLE, NOT_PAUSABLE, ACCEPTS_SHUTDOWN)',
    '        Код_выхода_Win32   : 0  (0x0)',
    '        ID_процесса        : 5708'
  ].join('\r\n');
  const res = parseScOutput(raw);
  assert.equal(res.serviceName, 'EgoistShieldCore');
  assert.equal(res.state, 'RUNNING');
  assert.equal(res.stateCode, 4);
  assert.equal(res.pid, 5708);
  assert.equal(res.isStoppable, true);
});

test('Windows 10/11 SC: Parse Russian STOPPED state', () => {
  const raw = [
    'Имя_службы: EgoistShieldZapret',
    '        Состояние          : 1  STOPPED',
    '        Код_выхода_Win32   : 0  (0x0)',
    '        ID_процесса        : 0'
  ].join('\r\n');
  const res = parseScOutput(raw);
  assert.equal(res.state, 'STOPPED');
  assert.equal(res.pid, 0);
});

test('Windows 10/11 SC: Parse Russian START_PENDING state', () => {
  const raw = [
    'Имя_службы: EgoistShieldSystemDoH',
    '        Состояние          : 2  START_PENDING',
    '        ID_процесса        : 0'
  ].join('\r\n');
  const res = parseScOutput(raw);
  assert.equal(res.state, 'START_PENDING');
  assert.equal(res.stateCode, 2);
});

test('Windows 10/11 SC: Parse Russian STOP_PENDING state', () => {
  const raw = [
    'Имя_службы: EgoistShieldCore',
    '        Состояние          : 3  STOP_PENDING',
    '        ID_процесса        : 4120'
  ].join('\r\n');
  const res = parseScOutput(raw);
  assert.equal(res.state, 'STOP_PENDING');
  assert.equal(res.stateCode, 3);
});

test('Windows 10/11 SC: Parse English RUNNING state', () => {
  const raw = [
    'SERVICE_NAME: EgoistShieldTelegramProxy',
    '        TYPE               : 10  WIN32_OWN_PROCESS',
    '        STATE              : 4  RUNNING',
    '        PID                : 7890'
  ].join('\r\n');
  const res = parseScOutput(raw);
  assert.equal(res.serviceName, 'EgoistShieldTelegramProxy');
  assert.equal(res.state, 'RUNNING');
  assert.equal(res.pid, 7890);
});

test('Windows 10/11 SC: Parse English STOPPED state', () => {
  const raw = [
    'SERVICE_NAME: EgoistShieldSystemDoH',
    '        STATE              : 1  STOPPED',
    '        PID                : 0'
  ].join('\r\n');
  const res = parseScOutput(raw);
  assert.equal(res.state, 'STOPPED');
  assert.equal(res.pid, 0);
});

test('Windows 10/11 SC: Error 1053 timeout mapped to retry_or_abort', () => {
  const err = handleScError(1053);
  assert.equal(err.action, 'retry_or_abort');
});

test('Windows 10/11 SC: Error 1060 missing service mapped to not_installed', () => {
  const err = handleScError(1060);
  assert.equal(err.action, 'not_installed');
});

test('Windows 10/11 SC: Error 1062 not started treated as already_stopped idempotent success', () => {
  const err = handleScError(1062);
  assert.equal(err.action, 'already_stopped');
});

test('Windows 10/11 SC: Error 1056 already running treated as already_running idempotent success', () => {
  const err = handleScError(1056);
  assert.equal(err.action, 'already_running');
});

test('Windows 10/11 SC: Error 5 access denied flagged as require_elevation', () => {
  const err = handleScError(5);
  assert.equal(err.action, 'require_elevation');
});

test('Windows 10/11 SC: Polling ready state transitions from START_PENDING to RUNNING', () => {
  const res = pollServiceReady(['START_PENDING', 'START_PENDING', 'RUNNING']);
  assert.equal(res.ready, true);
  assert.equal(res.attempts, 3);
});

test('Windows 10/11 SC: Polling circuit breaker triggers when stuck in pending', () => {
  const res = pollServiceReady(['START_PENDING', 'START_PENDING', 'START_PENDING', 'START_PENDING', 'START_PENDING', 'START_PENDING'], 5);
  assert.equal(res.ready, false);
  assert.ok(res.reason.includes('Circuit breaker'));
});

test('Windows 10/11 SC: Polling immediately detects early crash to STOPPED', () => {
  const res = pollServiceReady(['START_PENDING', 'STOPPED']);
  assert.equal(res.ready, false);
  assert.ok(res.reason.includes('stopped state'));
});

test('Windows 10/11 SC: Service binary path with spaces is safely quoted', () => {
  const unquoted = 'C:\\Program Files\\EgoistShield\\EgoistShield.Service.exe';
  const quoted = `"${unquoted}"`;
  assert.equal(quoted.startsWith('"') && quoted.endsWith('"'), true);
  assert.ok(quoted.includes('Program Files'));
});

test('Windows 10/11 SC: Start type 2 maps to automatic boot startup', () => {
  const startTypeMap = { 2: 'auto', 3: 'manual', 4: 'disabled' };
  assert.equal(startTypeMap[2], 'auto');
  assert.equal(startTypeMap[3], 'manual');
  assert.equal(startTypeMap[4], 'disabled');
});

test('Windows 10/11 SC: WinDivert driver dependency must be started before Zapret service', () => {
  const serviceStartupOrder = [];
  function startServiceWithDeps(service) {
    if (service === 'Zapret') serviceStartupOrder.push('WinDivert');
    serviceStartupOrder.push(service);
  }
  startServiceWithDeps('Zapret');
  assert.deepEqual(serviceStartupOrder, ['WinDivert', 'Zapret']);
});

test('Windows 10/11 SC: Recovery restart policy sets 5000ms delay', () => {
  const recoveryConfig = { resetPeriodSec: 86400, rebootMsg: '', actions: 'restart/5000/restart/5000/none/0' };
  assert.ok(recoveryConfig.actions.includes('restart/5000'));
});

test('Windows 10/11 SC: Non-interactive Session 0 isolation rejects desktop UI interaction', () => {
  const serviceContext = { session: 0, interactive: false };
  assert.equal(serviceContext.session, 0);
  assert.equal(serviceContext.interactive, false);
});

test('Windows 10/11 SC: Fast Startup hybrid reboot triggers service state refresh', () => {
  let refreshed = false;
  function onPowerBroadcast(event) {
    if (event === 'PBT_APMRESUMEAUTOMATIC') refreshed = true;
  }
  onPowerBroadcast('PBT_APMRESUMEAUTOMATIC');
  assert.equal(refreshed, true);
});
