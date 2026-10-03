import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const run = promisify(execFile);
const script = fileURLToPath(new URL('./installer-owned-wrapper-log-recovery.ps1', import.meta.url));
function workRoot() {
  if (process.env.EGOISTSHIELD_TEST_WORK_ROOT) return path.resolve(process.env.EGOISTSHIELD_TEST_WORK_ROOT);
  const pointerPath = path.join(os.homedir(), '.codex', 'brain-pointer.json');
  if (!fs.existsSync(pointerPath)) return os.tmpdir();
  assert.ok(process.env.CODEX_THREAD_ID, 'Brain fixtures require the actual current task ID');
  const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
  return path.join(pointer.chat_runtime, 'tasks', process.env.CODEX_THREAD_ID, 'work');
}
test('authenticated owned wrapper append log archives while every unsafe collision refuses', { skip: process.platform !== 'win32', timeout: 30_000 }, async () => {
  const native5 = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  assert.ok(fs.existsSync(native5), 'Native Windows PowerShell 5.1 is required');
  const parent = fs.realpathSync(workRoot());
  const fixture = fs.mkdtempSync(path.join(parent, 'wlr-'));
  const args = ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-TestDirectory',fixture];
  if (process.env.EGOISTSHIELD_WRAPPER_LOG_BASELINE_SNAPSHOT) args.push('-BaselineSnapshot', path.resolve(process.env.EGOISTSHIELD_WRAPPER_LOG_BASELINE_SNAPSHOT));
  try {
    const { stdout, stderr } = await run(native5, args, {
      windowsHide: true, cwd: fixture, timeout: 25_000, maxBuffer: 1024 * 1024,
      env: {...process.env,PSModulePath:path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','Modules'),TEMP:fixture,TMP:fixture},
    });
    assert.equal(stderr.trim(), '');
    const result = JSON.parse(stdout.trim());
    assert.equal(result.result, 'GREEN');
    assert.match(result.nativeVersion, /^5\.1\./);
    assert.equal(result.positives, 1);
    assert.equal(result.negatives, 9);
    assert.equal(result.results.length, 10);
    assert.ok(result.checks > 70);
    assert.ok(result.runtimeHeldAclReads > 0 && result.protectedHeldAclReads > 0);
    assert.equal(result.operationalCalls, 0);
    assert.equal(result.results[0].receiptVerified, true);
    for (const refusal of result.results.slice(1)) {
      assert.equal(refusal.refused, true);
      assert.equal(refusal.archiveCreated, false);
      assert.equal(refusal.copiesPreserved, true);
    }
    assert.equal(result.results.find(row => row.case === 'active writer').nativeError, 32);
    for (const mode of ['running','missing','foreign-path']) assert.equal(result.results.find(row => row.case === `SCM ${mode}`).refused, true);
    assert.ok(result.controlledScmQueries >= 5);
    console.log(JSON.stringify(result));
  } finally {
    const actual = fs.realpathSync(fixture);
    assert.equal(path.dirname(actual).toLowerCase(), parent.toLowerCase());
    assert.match(path.basename(actual), /^wlr-[a-zA-Z0-9]{6}$/);
    fs.rmSync(actual, {recursive:true,force:false});
  }
});
