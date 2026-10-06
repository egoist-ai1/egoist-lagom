import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const run=promisify(execFile);
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const native=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const modern=process.env.LAGOM_TEST_POWERSHELL7||path.join(process.env.ProgramFiles||'C:\\Program Files','PowerShell','7','pwsh.exe');
for(const [label,exe] of [['PS5',native],['PS7',modern]]){
  test(`production optional DPI snapshot ${label}: absence is valid, failed or changed registry reads stop handoff`,{skip:process.platform!=='win32'||!existsSync(exe),timeout:35000},async()=>{
    const env={...process.env};if(label==='PS5')env.PSModulePath=path.join(path.dirname(native),'Modules');
    const {stdout,stderr}=await run(exe,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'tests/installer-optional-zapret-profile.ps1'),'-SourcePath',path.join(root,'scripts/invoke-final-silent-reinstall.ps1')],{env,windowsHide:true,timeout:30000,maxBuffer:128*1024});
    assert.equal(stderr.trim(),'');const report=JSON.parse(stdout);assert.equal(report.cases,27);assert.equal(report.pass,27);assert.equal(report.fail,0);assert.equal(report.actualRegistryReads,0);assert.equal(report.nativeServiceActions,0);assert.equal(report.privateDataReads,0);assert.equal(report.fullWorkerRun,false);
    assert.equal(report.results.length,27);assert.ok(report.results.every(item=>item.result==='passed'||item.result==='refused-as-required'));
  });
}
