import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const run=promisify(execFile);
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const native=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const modern=process.env.LAGOM_TEST_POWERSHELL7||process.env.LAGOM_TEST_POWERSHELL||path.join(process.env.ProgramFiles||'C:\\Program Files','PowerShell','7','pwsh.exe');

for(const [label,exe] of [['PS5',native],['PS7',modern]]){
  test('actual preserved runtime restore '+label+': empty excludes, old-assignment refusal and bounded recovery',{
    skip:process.platform!=='win32',timeout:35000,
  },async t=>{
    assert.ok(path.isAbsolute(exe)&&existsSync(exe),'Windows requires the selected absolute '+label+' executable.');
    const base=process.env.LAGOM_TEST_TEMP||(process.env.GITHUB_ACTIONS==='true'?process.env.RUNNER_TEMP:null);
    assert.ok(base&&path.isAbsolute(base),'Set task-owned LAGOM_TEST_TEMP or use CI RUNNER_TEMP.');
    const work=await fs.mkdtemp(path.join(base,'preserved-runtime-restore-'));
    const env={...process.env,LAGOM_TEST_TEMP:base};
    if(label==='PS5')env.PSModulePath=path.join(path.dirname(native),'Modules');
    const {stdout,stderr}=await run(exe,[
      '-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
      '-File',path.join(root,'tests/fixtures/preserved-runtime-restore-readonly.ps1'),
      '-Work',path.join(work,'fixture'),'-SourcePath',path.join(root,'scripts/invoke-final-silent-reinstall.ps1'),
    ],{env,windowsHide:true,timeout:30000,maxBuffer:256*1024});
    await fs.writeFile(path.join(work,'stdout.json'),stdout,'utf8');
    await fs.writeFile(path.join(work,'stderr.log'),stderr,'utf8');
    assert.equal(stderr.trim(),'');
    const report=JSON.parse(stdout);
    assert.equal(Number(report.powershellVersion.split('.')[0]),label==='PS5'?5:7,'Selected shell executed the wrong PowerShell major.');
    assert.equal(report.cases,14);assert.equal(report.passed,14);assert.equal(report.fail,0);
    assert.equal(report.rows.length,14);assert.ok(report.rows.every(row=>row.passed));
    for(const key of ['nativeOperations','installedPrivateReads','guiOperations','networkOperations','sourceSharedEdits'])assert.equal(report[key],0);
    assert.equal(report.realRobocopyExecuted,false);assert.equal(report.fullWorkerRun,false);
    assert.equal(report.actualImports.length,16);
    assert.equal(report.actualImports.filter(row=>row.knownOldAssignmentMutated).length,1);
    const rows=new Map(report.rows.map(row=>[row.name,row]));
    assert.equal(rows.get('RED-synthetic-Core-ordinary-restore-Count').observation.expectedProductionFailure,true);
    assert.equal(rows.get('RED-synthetic-Core-recovery-restore-Count').observation.recovered,false);
    assert.equal(rows.get('RED-synthetic-Core-bounded-recovery-attempts-retains-pending').observation.pendingRetained,true);
    assert.equal(rows.get('GREEN-synthetic-Core-ordinary-restore-zero-excludes').observation.excludedCount,0);
    assert.equal(rows.get('GREEN-true-keeps-one-SystemDoH-exclude').observation.excludedCount,1);
    assert.equal(rows.get('GREEN-synthetic-Core-recovery-closes-owned-inert-maintenance').observation.nativeRestorationVerified,false);
    assert.equal(rows.get('GREEN-synthetic-Core-bounded-recovery-removes-own-pending').observation.ownPendingRemoved,true);
    assert.equal(rows.get('GREEN-derived-own-two-user-files-checksum-and-copy').observation.actualOwnFileHashesVerified,true);
    assert.match(rows.get('GREEN-derived-corrupt-user-backup-refused').observation.guardRefusal,/checksum validation/);
    assert.match(rows.get('GREEN-robocopy-exit8-still-refused').observation.guardRefusal,/exit code 8/);
    assert.equal(rows.get('GREEN-foreign-maintenance-still-refused-before-copy').observation.copyCalls,0);
    assert.equal(rows.get('UNCHANGED-callee-omitted-argument-default-is-empty-array').observation.defaultPreserved,true);
    assert.equal(rows.get('UNCHANGED-callee-explicit-null-reproduces-overridden-default').observation.calleeUnchanged,true);
    t.diagnostic(JSON.stringify({powershell:report.powershellVersion,actualCases:14,proof:path.join(work,'fixture/proof.json'),nativeOperations:0}));
  });
}
