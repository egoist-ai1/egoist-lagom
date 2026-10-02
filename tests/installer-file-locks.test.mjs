import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
test('installer RM guards bind own payload locks to PID birth and preserve OS/shared hosts', {skip:process.platform!=='win32'},async()=>{
 assert.ok(path.isAbsolute(process.env.LAGOM_TEST_TEMP||''),'Set own task LAGOM_TEST_TEMP.');
 const dir=await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP,'rm-'));
 const ps=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 const {stdout,stderr}=await promisify(execFile)(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tests/installer-file-locks.ps1'),'-TestDirectory',dir],{windowsHide:true,timeout:45000,env:{...process.env,TEMP:process.env.LAGOM_TEST_TEMP,TMP:process.env.LAGOM_TEST_TEMP,PSModulePath:path.join(path.dirname(ps),'Modules')}});
 assert.equal(stderr.trim(),'');const receipt=JSON.parse(stdout);assert.equal(receipt.passed,true);assert.ok(receipt.groupCount>=20);assert.ok(receipt.assertionCount>=50);assert.equal(receipt.nativeRmShutdowns,0);assert.equal(receipt.nativeScmMutations,0);assert.equal(receipt.nativeRmQueries,1);assert.equal(receipt.ownFixtureChildStopped,true);assert.match(receipt.powerShellVersion,/^5\.1\./);assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'file-locks-receipt.json'),'utf8')),receipt);
 assert.equal(receipt.sourceSha256,createHash('sha256').update(await fs.readFile('src/installer/installer-file-locks.ps1')).digest('hex'));
});
