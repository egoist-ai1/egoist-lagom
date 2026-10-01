import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { loadRecovered } from './load-recovered.mjs';

const exec = promisify(execFile);
const tempRoot = process.env.LAGOM_TEST_TEMP || os.tmpdir();
assert.ok(path.isAbsolute(tempRoot), 'Test temp root must be absolute');
await fs.mkdir(tempRoot, { recursive: true });
const work = await fs.mkdtemp(path.join(tempRoot, 'zapret-query-diagnostics-'));
const childScript = path.join(work, 'child.cjs');
const marker = `synthetic-sensitive-${randomUUID()}`;
await fs.writeFile(childScript, `
const mode = process.argv[2];
const marker = process.argv[3];
if (mode === 'success') process.stdout.write('[]');
else if (mode === 'invalid-json') process.stdout.write('unexpected:' + marker);
else if (mode === 'output-limit') process.stdout.write(marker.repeat(40000));
else {
  process.stdout.write(marker);
  process.stderr.write(marker);
  if (mode === 'exit') process.exitCode = 7;
  else if (mode === 'timeout') setInterval(() => {}, 60000);
}
`, 'utf8');
test.after(async () => {
  await fs.unlink(childScript);
  await fs.rmdir(work);
});

function fixture(mode, replacement = null) {
  const observed = { calls: [], originalError: null, child: null };
  function run(executable, args, options) {
    observed.calls.push({ executable, args, options });
    if (replacement) return replacement(observed);
    const target = mode === 'spawn' ? path.join(work, 'missing-powershell.exe') : process.execPath;
    const pending = exec(target, [childScript, mode, marker], { ...options, cwd: work });
    observed.child = pending.child;
    pending.catch(error => { observed.originalError = error; });
    return pending;
  }
  const { ZapretManager } = loadRecovered('electron/ipc/zapret-manager', {
    path: path.win32, promisify: () => run, execFile,
    package_default: { version: '3.8.0' },
    resolveWindowsExecutable: name => path.win32.join('C:\\Windows\\System32\\WindowsPowerShell\\v1.0', name),
    logger: { info() {}, warn() {} },
  }, ['ZapretManager']);
  return { manager: new ZapretManager('resources', 'app', 'user', 'C:\\Fixture\\Zapret'), observed };
}

async function rejected(run) {
  try { await run(); } catch (error) { return error; }
  assert.fail('Expected production operation to reject');
}

function assertSafe(error) {
  assert.doesNotMatch(error.message, /synthetic-sensitive-|unexpected:|Command failed:|CommandLine|missing-powershell\.exe|child\.cjs/);
  assert.ok(error.message.length <= 512, `Diagnostic message exceeded bound: ${error.message.length}`);
  assert.doesNotMatch(JSON.stringify(error), /synthetic-sensitive-/);
}

test('actual harmless child exit retains metadata and original cause through WinWS wrapper', async () => {
  const { manager, observed } = fixture('exit');
  const error = await rejected(() => manager.listWinwsProcesses());
  assertSafe(error);
  const execution = error.cause;
  assert.equal(execution.name, 'PowerShellExecutionError');
  assert.equal(execution.cause, observed.originalError);
  assert.equal(execution.powerShellDiagnostic.kind, 'exit');
  assert.equal(execution.powerShellDiagnostic.code, 7);
  assert.equal(execution.powerShellDiagnostic.killed, false);
  assert.equal(execution.powerShellDiagnostic.signal, null);
  assert.equal(execution.powerShellDiagnostic.pid, observed.child.pid);
  assert.ok(execution.powerShellDiagnostic.elapsedMs >= 0);
  assert.equal(execution.powerShellDiagnostic.stdoutBytes, Buffer.byteLength(marker));
  assert.equal(execution.powerShellDiagnostic.stderrBytes, Buffer.byteLength(marker));
  assert.match(error.message, /kind=exit.*code=7.*killed=false.*elapsedMs=\d+.*pid=\d+/);
  assert.equal(observed.calls[0].options.timeout, 12000);
  assert.equal(observed.calls[0].options.windowsHide, true);
  assert.equal(Object.hasOwn(observed.calls[0].options, 'env'), false);
  assert.equal(Object.hasOwn(observed.calls[0].options, 'cwd'), false);
  assert.equal(observed.calls[0].args.slice(0, 3).join(' '), '-NoProfile -NonInteractive -Command');
  assert.match(observed.calls[0].args[3], /Get-CimInstance Win32_Process -Filter "Name='winws\.exe'"/);
});

test('actual own child timeout differs from nonzero exit without claiming provider cause', async () => {
  const { manager, observed } = fixture('timeout');
  const error = await rejected(() => manager.execPowerShell('synthetic input ' + marker, 200));
  assertSafe(error);
  assert.equal(error.cause, observed.originalError);
  assert.equal(error.powerShellDiagnostic.kind, 'terminated');
  assert.equal(error.powerShellDiagnostic.killed, true);
  assert.equal(error.powerShellDiagnostic.pid, observed.child.pid);
  assert.equal(error.powerShellDiagnostic.timeoutMs, 200);
  assert.ok(error.powerShellDiagnostic.elapsedMs >= 150);
  assert.match(error.message, /kind=terminated.*killed=true/);
});

test('actual nonexistent own executable spawn failure has no PID and no path disclosure', async () => {
  const { manager, observed } = fixture('spawn');
  const error = await rejected(() => manager.listWinwsProcesses());
  assertSafe(error);
  assert.equal(error.cause.cause, observed.originalError);
  assert.equal(error.cause.powerShellDiagnostic.kind, 'spawn');
  assert.equal(error.cause.powerShellDiagnostic.code, 'ENOENT');
  assert.equal(error.cause.powerShellDiagnostic.pid, null);
  assert.equal(error.cause.powerShellDiagnostic.killed, false);
  assert.match(error.message, /kind=spawn.*code=ENOENT.*pid=null/);
});

test('actual output-limit failure is distinct from timeout and never emits captured output', async () => {
  const { manager } = fixture('output-limit');
  const error = await rejected(() => manager.listWinwsProcesses());
  assertSafe(error);
  assert.equal(error.cause.powerShellDiagnostic.kind, 'output-limit');
  assert.equal(error.cause.powerShellDiagnostic.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  assert.ok(error.cause.powerShellDiagnostic.stdoutBytes > 0);
});

test('successful own child keeps stdout and WinWS empty-result semantics unchanged', async () => {
  const { manager, observed } = fixture('success');
  assert.equal(await manager.execPowerShell('synthetic-success'), '[]');
  assert.equal(observed.calls[0].options.timeout, 8000);
  assert.equal((await manager.listWinwsProcesses()).length, 0);
});

test('invalid JSON output is a fixed safe parse error while preserving SyntaxError cause', async () => {
  const { manager } = fixture('invalid-json');
  const error = await rejected(() => manager.listWinwsProcesses());
  assertSafe(error);
  assert.equal(error.cause.name, 'SyntaxError');
  assert.match(error.message, /JSON/);
});

test('unrecognized error string fields are not reflected into public diagnostics', async () => {
  const nativeError = Object.assign(new Error(`Command failed: ${marker}`), {
    code: marker, signal: marker, stdout: marker, stderr: marker, killed: false,
  });
  const { manager } = fixture('unused', () => Promise.reject(nativeError));
  const error = await rejected(() => manager.listWinwsProcesses());
  assertSafe(error);
  assert.equal(error.cause.cause, nativeError);
  assert.equal(error.cause.powerShellDiagnostic.code, 'unknown');
  assert.equal(error.cause.powerShellDiagnostic.signal, 'unknown');
  assert.equal(error.cause.powerShellDiagnostic.kind, 'unknown');
  assert.equal(error.cause.powerShellDiagnostic.pid, null);
});
