'use strict';

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { TextDecoder } = require('node:util');

const PIPE = '\\\\.\\pipe\\EgoistShield.Service.v1';
const EXPECTED_VERSION = '3.7.9';
const REQUEST_TIMEOUT_MS = 20000;
const RUN_TIMEOUT_MS = 180000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const CONCURRENCY = 4;
const ROUNDS = 6;
const SPECS = Object.freeze([
  { operation: 'hello', component: null },
  { operation: 'service.status', component: null },
  ...['TelegramProxy', 'Zapret', 'SystemDoH'].map(component => ({ operation: 'component.query', component })),
]);
const activeRequests = new Set();
let stopped = false;

function failure(code) { const error = new Error(code); error.safeCode = code; return error; }
function safeCode(value, fallback = 'READ_ONLY_FAILURE') {
  return typeof value === 'string' && /^[A-Z0-9_]{1,80}$/.test(value) ? value : fallback;
}
function requireCondition(value, code) { if (!value) throw failure(code); }
function validateEnvelope(response, requestId) {
  requireCondition(response && typeof response === 'object' && !Array.isArray(response), 'RESPONSE_SHAPE');
  requireCondition(response.protocolVersion === 1, 'PROTOCOL_MISMATCH');
  requireCondition(response.requestId === requestId, 'RESPONSE_CORRELATION');
  requireCondition(typeof response.ok === 'boolean', 'RESPONSE_OK_TYPE');
  if (!response.ok) throw failure(safeCode(response.error?.code, 'CORE_REJECTED'));
  requireCondition(response.serviceVersion === EXPECTED_VERSION, 'CORE_VERSION_MISMATCH');
  requireCondition(Number.isSafeInteger(response.sequence) && response.sequence >= 0, 'RESPONSE_SEQUENCE');
  requireCondition(response.result && typeof response.result === 'object' && !Array.isArray(response.result), 'RESULT_SHAPE');
  return response.result;
}

function request(spec) {
  requireCondition(SPECS.some(allowed => allowed.operation === spec.operation && allowed.component === spec.component), 'READ_ONLY_SCOPE');
  const payload = spec.operation === 'component.query'
    ? { component: spec.component, method: 'status', args: [{ force: true }] }
    : {};
  return new Promise((resolve, reject) => {
    const requestId = 'stress-readonly:' + randomUUID();
    let socket;
    let buffered = Buffer.alloc(0);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeRequests.delete(cancel);
      socket?.destroy();
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => finish(failure('RUN_DEADLINE'));
    const timer = setTimeout(() => finish(failure('REQUEST_DEADLINE')), REQUEST_TIMEOUT_MS);
    activeRequests.add(cancel);
    if (stopped) return cancel();
    try {
      socket = net.connect(PIPE);
      socket.once('error', error => finish(failure(safeCode(error.code, 'PIPE_IO_ERROR'))));
      socket.once('connect', () => {
        try { socket.write(JSON.stringify({ protocolVersion: 1, requestId, operation: spec.operation, payload }) + '\n'); }
        catch { finish(failure('REQUEST_WRITE_FAILED')); }
      });
      socket.on('data', chunk => {
        if (settled) return;
        if (buffered.length + chunk.length > MAX_RESPONSE_BYTES) return finish(failure('RESPONSE_TOO_LARGE'));
        buffered = Buffer.concat([buffered, chunk]);
        const end = buffered.indexOf(10);
        if (end < 0) return;
        try {
          requireCondition(buffered.subarray(end + 1).every(byte => byte === 10 || byte === 13 || byte === 32 || byte === 9), 'EXTRA_RESPONSE_FRAME');
          const text = new TextDecoder('utf-8', { fatal: true }).decode(buffered.subarray(0, end));
          const response = JSON.parse(text);
          finish(null, validateEnvelope(response, requestId));
        } catch (error) { finish(error.safeCode ? error : failure('INVALID_RESPONSE_JSON')); }
      });
      socket.once('close', () => finish(failure('INCOMPLETE_RESPONSE')));
    } catch { finish(failure('PIPE_CONNECT_FAILED')); }
  });
}

function selectResult(value, spec) {
  if (spec.operation === 'hello') {
    requireCondition(value.protocolVersion === 1 && value.serviceVersion === EXPECTED_VERSION, 'HELLO_VERSION');
    requireCondition(value.clientPid === process.pid && value.developmentOverride === false && value.identityProbe === false, 'PRODUCTION_IDENTITY');
    return { selected: { protocolVersion: 1, serviceVersion: value.serviceVersion, developmentOverride: false, identityProbe: false, clientPidMatches: true }, healthy: true };
  }
  if (spec.operation === 'service.status') {
    requireCondition(value.version === EXPECTED_VERSION && value.consoleMode === false, 'SERVICE_PRODUCTION_IDENTITY');
    requireCondition(Number.isSafeInteger(value.processId) && value.processId > 0, 'SERVICE_PID_TYPE');
    const selected = { version: value.version, consoleMode: false, supervisionPresent: value.supervision != null && typeof value.supervision === 'object' };
    return { selected, healthy: selected.supervisionPresent, corePid: value.processId };
  }
  const names = spec.component === 'TelegramProxy'
    ? ['available', 'running', 'runtimeReady', 'listenerReady', 'serviceInstalled', 'serviceRunning']
    : spec.component === 'Zapret'
      ? ['available', 'runtimeReady', 'serviceReady', 'serviceInstalled', 'serviceRunning', 'standaloneRunning', 'winwsRunning']
      : ['available', 'running', 'serviceInstalled', 'serviceRunning', 'enabled', 'encrypted', 'verified', 'nativeManaged'];
  const selected = {};
  for (const name of names) {
    requireCondition(typeof value[name] === 'boolean', 'STATUS_BOOLEAN_SCHEMA');
    selected[name] = value[name];
  }
  requireCondition(typeof value.serviceState === 'string', 'STATUS_STATE_SCHEMA');
  const state = value.serviceState.toLowerCase().replace(/_/g, '-');
  requireCondition(['running', 'stopped', 'start-pending', 'stop-pending', 'not-installed', 'unknown', 'unavailable'].includes(state), 'STATUS_STATE_VALUE');
  selected.serviceState = state;
  selected.lastErrorPresent = value.lastError != null;
  let healthy = selected.available && selected.serviceInstalled && selected.serviceRunning && state === 'running' && !selected.lastErrorPresent;
  if (spec.component === 'TelegramProxy') {
    requireCondition(['owned', 'none', 'foreign', 'unknown'].includes(value.listenerOwnership), 'LISTENER_OWNERSHIP_VALUE');
    selected.listenerOwnership = value.listenerOwnership;
    healthy &&= selected.running && selected.runtimeReady && selected.listenerReady && selected.listenerOwnership === 'owned';
  } else if (spec.component === 'Zapret') {
    healthy &&= selected.runtimeReady && selected.serviceReady && selected.winwsRunning && !selected.standaloneRunning;
  } else healthy &&= selected.running && selected.enabled && selected.encrypted && selected.verified && !selected.nativeManaged;
  return { selected, healthy: Boolean(healthy) };
}

function verifyServerIdentity(executable) {
  return new Promise((resolve, reject) => {
    execFile(executable, ['--verify-pipe-server'], { windowsHide: true, timeout: REQUEST_TIMEOUT_MS, maxBuffer: 32768 }, (error, stdout) => {
      if (error) return reject(failure('SERVER_IDENTITY_COMMAND_FAILED'));
      try {
        const result = JSON.parse(stdout.trim());
        requireCondition(result.ok === true && result.code === 'VERIFIED' &&
          Number.isSafeInteger(result.serverProcessId) && result.serverProcessId > 0 && result.serverProcessId === result.serviceProcessId,
          'SERVER_IDENTITY_NOT_VERIFIED');
        resolve({ verified: true, serverPid: result.serverProcessId });
      } catch (error) { reject(error.safeCode ? error : failure('SERVER_IDENTITY_INVALID_JSON')); }
    });
  });
}

function latency(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = fraction => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return { minMs: sorted[0], p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1) };
}
function writeReceipt(outputPath, receipt) { fs.writeFileSync(outputPath, JSON.stringify(receipt, null, 2) + '\n'); }

async function main() {
  const args = process.argv.slice(2);
  requireCondition(args.length === 2 && args[0] === '--output' && path.isAbsolute(args[1]), 'USE_ABSOLUTE_OUTPUT_PATH');
  const outputPath = path.resolve(args[1]);
  requireCondition(fs.existsSync(path.dirname(outputPath)) && !fs.existsSync(outputPath), 'OUTPUT_MUST_BE_NEW_IN_EXISTING_DIRECTORY');
  const expectedExe = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'EgoistShield', 'EgoistShield.exe');
  requireCondition(process.platform === 'win32' && path.resolve(process.execPath).toLowerCase() === path.resolve(expectedExe).toLowerCase(), 'INSTALLED_EXE_REQUIRED');
  requireCondition(process.env.ELECTRON_RUN_AS_NODE === '1', 'NODE_ONLY_MODE_REQUIRED');
  const coreExe = path.join(path.dirname(process.execPath), 'resources', 'core-service', 'win-x64', 'EgoistShield.Service.exe');
  const receipt = {
    schemaVersion: 1, startedAt: new Date().toISOString(), method: 'Actual installed EXE Node-only real production Core IPC; read-only status requests, no fixtures or result overrides',
    status: 'running', executable: process.execPath, nodeVersion: process.version, electronVersion: process.versions.electron ?? null,
    expectedCoreVersion: EXPECTED_VERSION, mutationRequested: false, requestTimeoutMs: REQUEST_TIMEOUT_MS, runTimeoutMs: RUN_TIMEOUT_MS,
    maxResponseBytes: MAX_RESPONSE_BYTES, concurrency: CONCURRENCY, plannedRequests: ROUNDS * SPECS.length * CONCURRENCY,
    serverIdentityProbeAdditionalHello: true,
    helperSha256: createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
    executableSha256: createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'),
    coreExecutableSha256: createHash('sha256').update(fs.readFileSync(coreExe)).digest('hex'), batches: [],
    coalescing: { overlappingSameComponentRequests: 0, batchesWithIdenticalSafeStatus: 0,
      publicContractExposesInternalReadCounter: false, internalCoalescingProven: false },
  };
  writeReceipt(outputPath, receipt);
  const started = performance.now();
  const globalTimer = setTimeout(() => { stopped = true; for (const cancel of [...activeRequests]) cancel(); }, RUN_TIMEOUT_MS);
  try {
    const identity = await verifyServerIdentity(coreExe);
    receipt.serverIdentityVerified = identity.verified;
    for (let round = 0; round < ROUNDS && !stopped; round++) {
      for (const spec of SPECS) {
        if (stopped) break;
        const batchId = receipt.batches.length + 1;
        const rows = await Promise.all(Array.from({ length: CONCURRENCY }, async (_, index) => {
          const requestStarted = performance.now();
          try {
            const value = await request(spec);
            const result = selectResult(value, spec);
            requireCondition(result.corePid == null || result.corePid === identity.serverPid, 'CORE_PROCESS_CHANGED');
            return { index, ok: true, healthy: result.healthy, milliseconds: Math.round((performance.now() - requestStarted) * 100) / 100,
              selected: result.selected, schema: Object.fromEntries(Object.entries(result.selected).map(([key, item]) => [key, typeof item])) };
          } catch (error) {
            return { index, ok: false, healthy: false, milliseconds: Math.round((performance.now() - requestStarted) * 100) / 100,
              errorCode: safeCode(error.safeCode), rawErrorPublished: false };
          }
        }));
        receipt.batches.push({ batch: batchId, round: round + 1, operation: spec.operation, component: spec.component, rows });
        if (spec.component) {
          receipt.coalescing.overlappingSameComponentRequests += rows.length;
          if (rows.every(row => row.ok) && rows.every(row => JSON.stringify(row.selected) === JSON.stringify(rows[0].selected))) receipt.coalescing.batchesWithIdenticalSafeStatus++;
        }
        writeReceipt(outputPath, receipt);
        console.log(JSON.stringify({ batch: batchId, operation: spec.operation, component: spec.component, pass: rows.filter(row => row.ok).length,
          healthy: rows.filter(row => row.healthy).length, requestsCompleted: receipt.batches.length * CONCURRENCY }));
        if (rows.some(row => !row.ok)) { stopped = true; break; }
      }
    }
  } catch (error) { receipt.preflightErrorCode = safeCode(error.safeCode); }
  finally {
    clearTimeout(globalTimer);
    stopped = true;
    for (const cancel of [...activeRequests]) cancel();
    const rows = receipt.batches.flatMap(batch => batch.rows);
    receipt.completedAt = new Date().toISOString();
    receipt.durationMs = Math.round((performance.now() - started) * 100) / 100;
    receipt.summary = { completed: rows.length, pass: rows.filter(row => row.ok).length, fail: rows.filter(row => !row.ok).length,
      healthy: rows.filter(row => row.healthy).length, notAttempted: receipt.plannedRequests - rows.length,
      latency: latency(rows.map(row => row.milliseconds)), errors: Object.fromEntries([...new Set(rows.filter(row => !row.ok).map(row => row.errorCode))].map(code => [code, rows.filter(row => row.errorCode === code).length])),
      perOperation: SPECS.map(spec => { const matching = receipt.batches.filter(batch => batch.operation === spec.operation && batch.component === spec.component).flatMap(batch => batch.rows);
        return { operation: spec.operation, component: spec.component, completed: matching.length, pass: matching.filter(row => row.ok).length,
          healthy: matching.filter(row => row.healthy).length, latency: latency(matching.map(row => row.milliseconds)) }; }),
    };
    receipt.status = receipt.serverIdentityVerified && rows.length === receipt.plannedRequests && rows.every(row => row.ok && row.healthy) ? 'passed' : 'failed';
    writeReceipt(outputPath, receipt);
    console.log(JSON.stringify({ status: receipt.status, ...receipt.summary, preflightErrorCode: receipt.preflightErrorCode }));
    process.exitCode = receipt.status === 'passed' ? 0 : 1;
  }
}

if (require.main === module) main().catch(error => { console.error(JSON.stringify({ status: 'runner-rejected', errorCode: safeCode(error.safeCode), rawErrorPublished: false })); process.exitCode = 1; });
