import test from 'node:test';
import assert from 'node:assert/strict';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const run=promisify(execFile);
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('actual build-input API authorization is bounded, redirect-free and scoped to fixed component actor',{timeout:45000},async t=>{
 const base=process.env.LAGOM_TEST_TEMP;
 assert.ok(base&&path.isAbsolute(base),'Set task-owned LAGOM_TEST_TEMP');
 const temp=await fs.mkdtemp(path.join(base,'build-api-auth-'));
 t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 const env={...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'};
 // No real build credential is required or exposed by the synthetic-token fixture.
 delete env.SHIELD_BUILD_GITHUB_TOKEN;
 const {stdout,stderr}=await run(process.env.SHIELD_PYTHON||'python',
  [path.join(root,'tests/build-input-api-auth.py'),root,path.join(temp,'fixture')],
  {env,windowsHide:true,timeout:40000,maxBuffer:128*1024});
 assert.equal(stderr.trim(),'');
 const report=JSON.parse(stdout);
 assert.equal(report.actualProductionFunctions,true);
 assert.equal(report.cases,17);
 assert.equal(report.passed,17);
 assert.equal(report.externalNetworkOperations,0);
 assert.equal(report.nativeOperations,0);
 assert.equal(report.parentEnvironmentUnchanged,true);
 assert.equal(report.syntheticTokenOnly,true);
});
