import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import { loadRecovered } from './load-recovered.mjs';

// Real controller + execPowerShell + protocol + worker serializer. The OS
// boundary runs only our harmless Node actor; installService delegates to the
// actual identity reader, so this is not a complete installer/SCM/driver test.
const require = createRequire(path.resolve('package.json'));
const { z } = require('zod');
const exec = promisify(execFile);
const source = file => fs.readFile(path.resolve(file), 'utf8');
const workerSource = await fs.readFile(
  process.env.LAGOM_COMPONENT_WORKER_TEST_SOURCE || path.resolve('src/component-worker-entry.js'), 'utf8');
const protocolSource = await source('src/component-protocol.js');
const schemasSource = await source('src/recovered/electron/ipc/ipc-schemas.js');
const { redactDiagnosticText } = loadRecovered('electron/ipc/diagnostics-redaction',
  { createHash }, ['redactDiagnosticText']);
const temporaryRoot = path.resolve(process.env.LAGOM_TEST_TEMP || os.tmpdir());
assert.ok(path.isAbsolute(temporaryRoot));
await fs.mkdir(temporaryRoot, { recursive: true });
const work = await fs.mkdtemp(path.join(temporaryRoot, 'zapret-identity-diagnostic-'));
const childScript = path.join(work, 'leaf.cjs');
const marker = 'synthetic-sensitive-' + randomUUID();
const wrapper = 'C:\\Identity Fixture\\Runtime\\Zapret\\service-wrapper\\egoistshield-zapret-service.exe';
const stopped = { state: 'Stopped', pid: 0, birth: null, image: wrapper };
const running = { state: 'Running', pid: 42420, birth: '2026-10-06T07:00:00.000Z', image: wrapper };
const failureMessage = 'Не удалось подтвердить личность службы Zapret перед изоляцией DNS.';
const shapeMessage = 'Личность службы Zapret перед изоляцией DNS не подтверждена.';
const plain = value => JSON.parse(JSON.stringify(value));
await fs.writeFile(childScript, [
  "const [mode, marker, response] = process.argv.slice(2);",
  "if (mode === 'json') process.stdout.write(response);",
  "else if (mode === 'invalid-json') process.stdout.write('unexpected:' + marker);",
  "else if (mode === 'output-limit') process.stdout.write(marker.repeat(40000));",
  "else { process.stdout.write(marker); process.stderr.write(marker);",
  "if (mode === 'exit') process.exitCode = 7;",
  "else if (mode === 'timeout') setInterval(() => {}, 60000); }",
].join('\n'), 'utf8');
test.after(async () => {
  assert.equal(path.dirname(work), temporaryRoot, 'Only the created owned directory may be removed');
  await fs.unlink(childScript);
  await fs.rmdir(work);
});

function fixture(mode = 'json', response = stopped, injected = null) {
  const observed = { calls: [], originalError: null, child: null };
  const run = (executable, args, options) => {
    observed.calls.push({ executable, args: Array.from(args), options });
    if (injected) return injected(observed);
    const target = mode === 'spawn' ? path.join(work, 'missing-owned-leaf.exe') : process.execPath;
    // The timeout actor uses a short OS-leaf deadline only. The production
    // reader and captured execPowerShell contract remain at 8000 ms.
    const pending = exec(target, [childScript, mode, marker, JSON.stringify(response)],
      { ...options, timeout: mode === 'timeout' ? 200 : options.timeout, cwd: work });
    observed.child = pending.child;
    pending.catch(error => { observed.originalError = error; });
    return pending;
  };
  const { ZapretManager } = loadRecovered('electron/ipc/zapret-manager', {
    path: path.win32, promisify: () => run, execFile,
    package_default: { version: '3.8.1' },
    resolveWindowsExecutable: name => path.win32.join('C:\\Windows\\System32\\WindowsPowerShell\\v1.0', name),
    logger: { info() {}, warn() {} },
  }, ['ZapretManager']);
  const manager = new ZapretManager('resources', 'app', 'user', 'C:\\Identity Fixture\\Runtime\\Zapret');
  return { manager, observed };
}
async function rejected(action) {
  try { await action(); } catch (error) { return error; }
  assert.fail('Production identity reader must refuse this fixture');
}
function checkQueryCall(observed) {
  assert.equal(observed.calls.length, 1);
  const call = observed.calls[0];
  assert.equal(call.executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(call.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
  assert.match(call.args[3], /Get-CimInstance Win32_Service/);
  assert.match(call.args[3], /Owned Zapret service image mismatch/);
  assert.match(call.args[3], /Owned Zapret wrapper identity unavailable/);
  assert.doesNotMatch(call.args[3], /Stop-Process|Start-Process|Set-DnsClient|netsh|Start-Service|Stop-Service|Remove-Service/);
  assert.equal(call.options.timeout, 8000);
  assert.equal(call.options.windowsHide, true);
  assert.equal(Object.hasOwn(call.options, 'env'), false);
}
function safeWire(wire) {
  const serialized = JSON.stringify(wire);
  assert.doesNotMatch(serialized, /synthetic-sensitive-|unexpected:|Command failed:|CommandLine|missing-owned-leaf|leaf\.cjs/);
  assert.ok(serialized.length <= 2048, 'Public diagnostic response remains bounded');
  if (wire.nativeQueryDiagnostic) {
    assert.ok(Object.keys(wire.nativeQueryDiagnostic).every(key =>
      ['kind', 'code', 'killed', 'signal', 'elapsedMs', 'timeoutMs', 'stdoutBytes', 'stderrBytes'].includes(key)));
  }
}
function workerFor(manager, error = null, component = 'Zapret') {
  const lines = [], protocol = vm.createContext({ z, URL, isIP });
  vm.runInContext(schemasSource + '\n' + protocolSource +
    '\nglobalThis.checkedRequest=validateComponentRequest;', protocol);
  manager.installService = error ? async () => { throw error; } :
    async () => manager.readDnsProtectionServiceIdentity();
  function QuietManager() {
    return { installService: async () => { if (error) throw error; return null; } };
  }
  function ControlledZapret() { return manager; }
  const context = vm.createContext({
    path: path.win32, __dirname: 'C:\\Synthetic Resources', Buffer, URL,
    process: {
      env: { ProgramData: 'C:\\Synthetic ProgramData' },
      stdin: { setEncoding() {}, on() {} },
      stdout: { write: text => { lines.push(text); } },
    },
    SystemDohManager: QuietManager, TelegramProxyManager: QuietManager,
    VpnServiceManager: QuietManager, ZapretManager: ControlledZapret,
    validateComponentRequest: protocol.checkedRequest, redactDiagnosticText,
    compactAutoSelectResult: value => value,
    log: { warn() { throw new Error('Unexpected unrelated isolation call'); } },
  });
  vm.runInContext(workerSource + '\nglobalThis.reply=replyWorker;', context);
  return async (override = {}) => {
    await context.reply({
      id: 'identity-fixture', requestId: 'identity-request', component,
      method: 'installService', args: component === 'Zapret' ? ['Selected'] : [],
      query: false, ...override,
    });
    assert.equal(lines.length, 1);
    const value = JSON.parse(lines[0].trim());
    assert.equal(value.id, override.id ?? 'identity-fixture');
    assert.equal(value.requestId, override.requestId ?? 'identity-request');
    safeWire(value);
    return value;
  };
}

for (const [name, value] of [['stopped', stopped], ['running', running]]) {
  test('actual identity reader and worker accept unchanged owned ' + name + ' identity', async () => {
    const { manager, observed } = fixture('json', value);
    const result = await workerFor(manager)();
    assert.equal(result.ok, true);
    assert.deepEqual(result.result, value);
    assert.equal(Object.hasOwn(result, 'nativeQueryDiagnostic'), false);
    checkQueryCall(observed);
  });
}
test('actual negative child exit keeps two-level original cause and safe identity metadata', async () => {
  const { manager, observed } = fixture('exit');
  const error = await rejected(() => manager.readDnsProtectionServiceIdentity());
  assert.equal(error.message, failureMessage);
  assert.equal(error.cause?.name, 'PowerShellExecutionError');
  assert.equal(error.cause?.cause, observed.originalError);
  assert.equal(error.nativeQueryDiagnostic, error.cause.powerShellDiagnostic);
  assert.equal(error.nativeQueryDiagnostic.kind, 'exit');
  assert.equal(error.nativeQueryDiagnostic.code, 7);
  assert.equal(error.nativeQueryDiagnostic.pid, observed.child.pid);
  assert.equal(error.nativeQueryDiagnostic.stdoutBytes, Buffer.byteLength(marker));
  assert.equal(error.nativeQueryDiagnostic.stderrBytes, Buffer.byteLength(marker));
  assert.equal(Object.isFrozen(error.nativeQueryDiagnostic), true);
  assert.doesNotMatch(JSON.stringify(error), /synthetic-sensitive-/);
  checkQueryCall(observed);
});
for (const [mode, kind, code] of [
  ['exit', 'exit', 7], ['spawn', 'spawn', 'ENOENT'],
  ['timeout', 'terminated', null], ['output-limit', 'output-limit', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'],
]) {
  test('actual worker response classifies own harmless child ' + mode + ' and preserves refusal', async () => {
    const { manager, observed } = fixture(mode);
    const wire = await workerFor(manager)();
    assert.equal(wire.ok, false);
    assert.equal(wire.error, failureMessage);
    assert.equal(wire.nativeQueryDiagnostic?.kind, kind);
    if (code !== null) assert.equal(wire.nativeQueryDiagnostic.code, code);
    assert.equal(wire.nativeQueryDiagnostic.timeoutMs, 8000);
    assert.ok(Number.isSafeInteger(wire.nativeQueryDiagnostic.elapsedMs));
    assert.ok(wire.nativeQueryDiagnostic.elapsedMs >= 0);
    if (mode === 'timeout') assert.equal(wire.nativeQueryDiagnostic.killed, true);
    checkQueryCall(observed);
  });
}
test('actual malformed child stdout gets fixed invalid-json label and SyntaxError local cause', async () => {
  const f = fixture('invalid-json');
  const error = await rejected(() => f.manager.readDnsProtectionServiceIdentity());
  assert.equal(error.message, failureMessage);
  assert.equal(error.cause?.name, 'SyntaxError');
  assert.deepEqual(plain(error.nativeQueryDiagnostic), { kind: 'invalid-json' });
  checkQueryCall(f.observed);
  const next = fixture('invalid-json');
  const wire = await workerFor(next.manager)();
  assert.equal(wire.ok, false);
  assert.equal(wire.error, failureMessage);
  assert.deepEqual(wire.nativeQueryDiagnostic, { kind: 'invalid-json' });
});
for (const [name, value] of [
  ['null', null], ['array', []], ['empty object', {}],
  ['foreign image', { ...stopped, image: 'C:\\Foreign\\wrapper.exe' }],
  ['nonstring image', { ...stopped, image: {} }],
  ['pending state', { ...running, state: 'Start Pending' }],
  ['negative PID', { ...stopped, pid: -1 }],
  ['fractional PID', { ...stopped, pid: 0.5 }],
  ['missing running PID', { ...running, pid: 0 }],
  ['missing running birth', { ...running, birth: null }],
  ['invalid running birth', { ...running, birth: 'not-a-date' }],
]) {
  test('actual identity validator refuses ' + name + ' with fixed invalid-snapshot wire label', async () => {
    const f = fixture('json', value);
    const wire = await workerFor(f.manager)();
    assert.equal(wire.ok, false);
    assert.equal(wire.error, shapeMessage);
    assert.deepEqual(wire.nativeQueryDiagnostic, { kind: 'invalid-snapshot' });
    checkQueryCall(f.observed);
  });
}
test('unrecognized native error text/code/signal cannot enter worker diagnostic', async () => {
  const rawError = Object.assign(new Error('Command failed: ' + marker), {
    code: marker, signal: marker, stdout: marker, stderr: marker, killed: false,
  });
  const f = fixture('unused', stopped, () => Promise.reject(rawError));
  const wire = await workerFor(f.manager)();
  assert.equal(wire.ok, false);
  assert.equal(wire.error, failureMessage);
  assert.equal(wire.nativeQueryDiagnostic.kind, 'unknown');
  assert.equal(wire.nativeQueryDiagnostic.code, 'unknown');
  assert.equal(wire.nativeQueryDiagnostic.signal, 'unknown');
  checkQueryCall(f.observed);
});
test('actual worker serializer drops raw text, paths, arguments, profile and PID even on injected diagnostic', async () => {
  const error = new Error(failureMessage);
  error.nativeQueryDiagnostic = {
    kind: 'exit', code: 7, killed: false, signal: null,
    elapsedMs: 12, timeoutMs: 8000, stdoutBytes: 27, stderrBytes: 41,
    pid: 42420, stdout: marker, stderr: marker, script: marker,
    args: [marker], profile: marker, cause: { message: marker },
  };
  const wire = await workerFor(fixture().manager, error)();
  assert.equal(wire.ok, false);
  assert.deepEqual(wire.nativeQueryDiagnostic, {
    kind: 'exit', code: 7, killed: false, signal: null,
    elapsedMs: 12, timeoutMs: 8000, stdoutBytes: 27, stderrBytes: 41,
  });
});
test('actual worker rejects invalid diagnostic fields while keeping valid classification', async () => {
  const error = new Error(failureMessage);
  error.nativeQueryDiagnostic = {
    kind: 'invalid-response', code: marker, signal: marker, killed: 'true',
    elapsedMs: -1, timeoutMs: NaN, stdoutBytes: Number.MAX_SAFE_INTEGER + 1,
    stderrBytes: 0.5, text: marker,
  };
  const wire = await workerFor(fixture().manager, error)();
  assert.equal(wire.ok, false);
  assert.deepEqual(wire.nativeQueryDiagnostic, { kind: 'invalid-response' });
});
test('actual worker omits unrecognized diagnostic classification', async () => {
  const error = new Error(failureMessage);
  error.nativeQueryDiagnostic = { kind: marker, code: 7, stdout: marker };
  const wire = await workerFor(fixture().manager, error)();
  assert.equal(wire.ok, false);
  assert.equal(Object.hasOwn(wire, 'nativeQueryDiagnostic'), false);
});
test('actual worker leaves unrelated component error envelope unchanged', async () => {
  const error = new Error(failureMessage);
  error.nativeQueryDiagnostic = { kind: 'exit', code: 7, stdout: marker };
  const wire = await workerFor(fixture().manager, error, 'TelegramProxy')();
  assert.equal(wire.ok, false);
  assert.equal(Object.hasOwn(wire, 'nativeQueryDiagnostic'), false);
});
test('actual protocol rejects mutation presented as query before running identity OS boundary', async () => {
  const f = fixture('exit');
  const wire = await workerFor(f.manager)({ query: true });
  assert.equal(wire.ok, false);
  assert.match(wire.error, /Mutation requires the serialized endpoint/);
  assert.equal(f.observed.calls.length, 0);
  assert.equal(Object.hasOwn(wire, 'nativeQueryDiagnostic'), false);
});
