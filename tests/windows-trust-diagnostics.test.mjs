import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
const source = fs.readFileSync(new URL('../src/native-runtime-trust.js', import.meta.url), 'utf8');
const failure = source.slice(source.indexOf('function trustFailure('), source.indexOf('function verifierEnvironment('));
const probe = source.slice(source.indexOf('async function probeWindows('), source.indexOf('export async function checkNativeExecutionPrivilege('));
const compile = new Function('path', 'windowsSystemDirectory', 'ordinaryFile', 'verifierEnvironment', 'spawn', 'Buffer', 'setTimeout', 'clearTimeout', failure + probe + ';return probeWindows;');
function fixture() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stdout.resume = () => {};
  child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  let released = 0, killed = 0;
  child.stdin.end = () => released++; child.kill = () => killed++; child.exitCode = null;
  const timers = [];
  const invoke = compile(path.win32, () => 'C:\\Windows\\System32', async value => value, () => ({}), () => child, Buffer,
    (callback, milliseconds) => { const timer = { callback, milliseconds, unref() {}, cancelled: false }; timers.push(timer); return timer; },
    timer => { timer.cancelled = true; });
  return { child, timers, invoke, released: () => released, killed: () => killed };
}
async function start(f) { const pending = f.invoke('trusted-fixture'); await Promise.resolve(); return { pending }; }
function deadline(f) { const timer = f.timers.find(value => value.milliseconds === 30000); assert.ok(timer); assert.equal(timer.cancelled, false); timer.callback(); }
for (const exited of [false, true]) test(`protected verifier timeout records ${exited ? 'exited child with open pipes' : 'live child'} and only a known phase`, async () => {
  const f = fixture(), { pending } = await start(f);
  f.child.stderr.emit('data', Buffer.from('private secret path\nEGOIST_TRUST_PHA'));
  f.child.stderr.emit('data', Buffer.from('SE:code-validation\r\n'));
  if (exited) { f.child.exitCode = 0; f.child.emit('exit', 0); }
  deadline(f);
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'WINDOWS_TRUST_TIMEOUT');
    assert.deepEqual(error.observation, { responseBytes: 0, exitObserved: exited, exitCode: exited ? 0 : null, stderrPhase: 'code-validation', stderrBytes: 56 });
    assert.doesNotMatch(JSON.stringify(error.observation), /private|secret|path/); return true;
  });
  assert.equal(f.released(), 1);
});
test('stderr cannot admit a verifier and malformed or oversized lines never become diagnostic phases', async () => {
  const f = fixture(), { pending } = await start(f);
  f.child.stderr.emit('data', Buffer.from('{"ok":true}\nEGOIST_TRUST_PHASE:private-secret\n'));
  f.child.stderr.emit('data', Buffer.from('x'.repeat(17000) + 'EGOIST_TRUST_PHASE:code-validated\n'));
  deadline(f);
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'WINDOWS_TRUST_TIMEOUT');
    assert.equal(error.observation.stderrPhase, 'not-observed'); assert.equal(error.observation.stderrBytes, 16384);
    assert.equal(error.observation.responseBytes, 0); return true;
  });
  assert.equal(f.released(), 1);
});
test('a completed verifier without stdout records the observed process exit', async () => {
  const f = fixture(), { pending } = await start(f);
  f.child.stderr.emit('data', Buffer.from('EGOIST_TRUST_PHASE:command-start\n'));
  f.child.exitCode = 1; f.child.emit('exit', 1); f.child.emit('close', 1);
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'WINDOWS_TRUST_NO_RESPONSE'); assert.equal(error.observation.exitObserved, true);
    assert.equal(error.observation.exitCode, 1); assert.equal(error.observation.stderrPhase, 'command-start'); return true;
  });
  assert.equal(f.released(), 1);
});
test('only a valid stdout proof grants a retained verifier lease and release stays idempotent', async () => {
  const f = fixture(), { pending } = await start(f);
  f.child.stderr.emit('data', Buffer.from('EGOIST_TRUST_PHASE:result-flushed\n'));
  f.child.stdout.emit('data', Buffer.from('{"ok":true,"helperPath":"fixture"}\n'));
  const lease = await pending;
  assert.deepEqual(lease.value, { ok: true, helperPath: 'fixture' }); assert.equal(f.released(), 0);
  lease.release(); lease.release(); assert.equal(f.released(), 1);
});
test('a known stderr marker cannot replace missing or invalid stdout JSON', async () => {
  const f = fixture(), { pending } = await start(f);
  f.child.stderr.emit('data', Buffer.from('EGOIST_TRUST_PHASE:result-flushed\n'));
  f.child.stdout.emit('data', Buffer.from('not-json\n'));
  await assert.rejects(pending, { code: 'WINDOWS_TRUST_INVALID_RESPONSE' }); assert.equal(f.released(), 1);
});
