import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

test('protected boot recovery registration preserves ownership, bounds and verified retirement', {skip:process.platform !== 'win32'}, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'boot-'));
  try {
    const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const env = {...process.env, PSModulePath:path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules')};
    const result = await exec(ps, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tests/installer-boot-recovery.ps1'),'-TestDirectory',dir], {env,windowsHide:true,timeout:60000});
    assert.match(result.stdout, /installer boot recovery: \d+ groups passed/);
    const receipt = JSON.parse(await fs.readFile(path.join(dir,'boot-recovery-test.json'),'utf8'));
    assert.equal(receipt.passed,true);
    assert.ok(receipt.groupCount >= 20);
    assert.ok(receipt.assertionCount > 100);
    for (const name of ['nativeSchedulerReads','nativeTaskCreates','nativeTaskUpdates','nativeTaskDeletes','nativeTaskActions','nativeScmMutations','systemDnsWrites','nativeFileAclWrites']) assert.equal(receipt[name],0,name);
    assert.ok(receipt.groups.includes('create-only collision race'));
    assert.ok(receipt.groups.includes('worker/helper/module hash binding'));
    assert.ok(receipt.groups.includes('historical missing-task retirement'));
    assert.ok(receipt.groups.includes('verified restoration and owned marker retirement gate'));
    assert.match(receipt.productionModuleSha256,/^[a-f0-9]{64}$/);
  } finally {
    assert.equal(await fs.realpath(dir),dir);
    await fs.rm(dir,{recursive:true,force:true});
  }
});
