import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { loadRecovered } from './load-recovered.mjs';

function fixture(outcome) {
  const calls = [];
  const { CoreServiceClient, CoreServiceUnavailableError } = loadRecovered('electron/ipc/port-utils', {
    execFile: () => { throw new Error('Native execution is forbidden in this isolated test'); },
    promisify: () => async (...args) => { calls.push(args); return outcome(); },
    fs: { existsSync: () => true },
    path,
    process: { platform: 'win32', resourcesPath: 'C:\\Synthetic\\resources', kill: () => { throw new Error('Unverified PID must not be checked'); } },
  }, ['CoreServiceClient', 'CoreServiceUnavailableError']);
  return { client: new CoreServiceClient(), CoreServiceUnavailableError, calls };
}

function nonzero(stdout) {
  const error = new Error('Native verifier exited with code 2');
  error.code = 2;
  error.stdout = stdout;
  throw error;
}

async function rejected(f) {
  let failure;
  try { await f.client.verifyServerIdentity(); } catch (error) { failure = error; }
  assert.ok(failure instanceof f.CoreServiceUnavailableError);
  assert.equal(f.client.verifiedServicePid, null);
  assert.equal(f.client.identityVerifiedAt, 0);
  assert.equal(f.client.identityVerificationInFlight, null);
  return failure;
}

test('native nonzero failure retains bounded safe code and connect stage', async () => {
  const f = fixture(() => nonzero(JSON.stringify({ ok: false, code: 'PIPE_IDENTITY_TIMEOUT',
    message: 'Core identity verification timed out. stage=connect, elapsedMs=15026, stageElapsedMs=15009' })));
  const failure = await rejected(f);
  assert.match(failure.message, /verifierCode=PIPE_IDENTITY_TIMEOUT/);
  assert.match(failure.message, /verifierStage=connect/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][2].windowsHide, true);
  assert.equal(f.calls[0][2].maxBuffer, 128 * 1024);
});

test('native exit status and matching positive safe PIDs are required for trust', async () => {
  await rejected(fixture(() => nonzero(JSON.stringify({ ok: true, serverProcessId: 41, serviceProcessId: 41 }))));
  for (const [serverProcessId, serviceProcessId] of [[41, 42], [0, 0], [-1, -1], ['41', '41'], [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1]]) {
    await rejected(fixture(() => ({ stdout: JSON.stringify({ ok: true, serverProcessId, serviceProcessId }) })));
  }
  const valid = fixture(() => ({ stdout: JSON.stringify({ ok: true, serverProcessId: 41, serviceProcessId: 41 }) }));
  await valid.client.verifyServerIdentity();
  assert.equal(valid.client.verifiedServicePid, 41);
  assert.ok(valid.client.identityVerifiedAt > 0);
});

test('invalid or oversized failure output cannot become a diagnostic or authority', async () => {
  for (const stdout of ['not-json', 'x'.repeat(128 * 1024 + 1), 'null', '[{"ok":false,"code":"FORGED"}]']) {
    const failure = await rejected(fixture(() => nonzero(stdout)));
    assert.match(failure.message, /verifierCode=unknown/);
    assert.match(failure.message, /verifierStage=unknown/);
  }
});

test('untrusted failure message cannot disclose arbitrary values or private URLs', async () => {
  const failure = await rejected(fixture(() => nonzero(JSON.stringify({ ok: false,
    code: 'PIPE_IDENTITY_FAILED,private=synthetic-secret',
    message: 'private=https://private.invalid/synthetic-secret stage=untrusted-stage' }))));
  assert.match(failure.message, /verifierCode=unknown/);
  assert.match(failure.message, /verifierStage=unknown/);
  assert.doesNotMatch(failure.message, /private\.invalid|synthetic-secret|untrusted-stage/);
});
