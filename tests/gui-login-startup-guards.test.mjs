import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute=promisify(execFile);
const ps=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
test('GUI task ownership, mutation, suspension and pinned payload guards use isolated fixtures', {skip:process.platform!=='win32'},async()=>{
 assert.ok(path.isAbsolute(process.env.LAGOM_TEST_TEMP||''),'Set task-scoped LAGOM_TEST_TEMP.');
 const dir=await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP,'gui-'));
 const env={...process.env,PSModulePath:path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/Modules')};
 const result=await execute(ps,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tests/gui-login-startup-guards.ps1'),'-TestDirectory',dir],{env,windowsHide:true,timeout:60_000});
 assert.equal(result.stderr.trim(),'');assert.match(result.stdout,/GUI login startup: \d+ groups, \d+ assertions passed/);
 const receipt=JSON.parse(await fs.readFile(path.join(dir,'gui-startup-test.json'),'utf8'));
 assert.equal(receipt.passed,true);assert.ok(receipt.groupCount>=16);assert.ok(receipt.assertionCount>=40);
 for(const key of ['nativeTaskReads','nativeTaskCreates','nativeTaskUpdates','nativeTaskDeletes','nativeTaskActions','nativeAclWrites'])assert.equal(receipt[key],0,key);
});
test('source helper CLI refuses noncanonical invocation before native session/task operations', {skip:process.platform!=='win32'},async()=>{
 await assert.rejects(execute(ps,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('src/installer/gui-login-startup.ps1'),'-Operation','Verify'],{windowsHide:true,timeout:10_000}),error=>error.code===1&&/GUI\s+startup\s+requires\s+its\s+canonical\s+installed\s+helper\./.test(error.stderr));
});
test('WinPS5 production receipt commit replaces an existing UTF8 fixture without changing its ACL', {skip:process.platform!=='win32'},async()=>{
 assert.ok(path.isAbsolute(process.env.LAGOM_TEST_TEMP||''),'Set task-scoped LAGOM_TEST_TEMP.');
 const dir=await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP,'gui-receipt-'));
 const nativeAcl=process.env.LAGOM_TEST_NATIVE_GUI_RECEIPT==='1';
 const args=['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tests/gui-login-startup-receipt.ps1'),'-TestDirectory',dir];
 if(nativeAcl)args.push('-NativeAcl');
 const env={...process.env,PSModulePath:path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/Modules')};
 const result=await execute(ps,args,{env,windowsHide:true,timeout:30_000});
 assert.equal(result.stderr.trim(),'');assert.match(result.stdout,/GUI startup receipt: .+, \d+ assertions passed\./);
 const receipt=JSON.parse(await fs.readFile(path.join(dir,'gui-startup-receipt-test.json'),'utf8'));
 assert.equal(receipt.passed,true);assert.equal(receipt.psEdition,'Desktop');assert.match(receipt.psVersion,/^5\./);
 assert.equal(receipt.mode,nativeAcl?'native-production-writer':'production-commit-branch');
 assert.equal(receipt.successfulWrites,2);assert.equal(receipt.aclPreserved,true);assert.equal(receipt.nativeTaskOperations,0);
 assert.ok(receipt.assertionCount>=(nativeAcl?18:5));
});
