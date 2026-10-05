import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute=promisify(execFile);
const ps7=process.env.LAGOM_TEST_POWERSHELL7||process.env.LAGOM_TEST_POWERSHELL;
const ps5=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
const core=path.resolve(process.env.LAGOM_TEST_NATIVE_DOH_SOURCE||'src/service/EgoistShield.Service/WindowsNativeDohController.cs');
const dto=path.resolve(process.env.LAGOM_TEST_NATIVE_DOH_DTO_SOURCE||path.join(path.dirname(core),'NativeDohEntrySnapshot.cs'));
const options=path.resolve(process.env.LAGOM_TEST_NATIVE_DOH_JSON_SOURCE||path.join(path.dirname(core),'JsonDefaults.cs'));
const fixture=path.resolve(process.env.LAGOM_TEST_NATIVE_DOH_FLAGS_FIXTURE||'tests/windows-native-doh-registry-flags.ps1');
for(const [shell,edition] of [[ps5,'Desktop'],[ps7,'Core']]){
 test(edition+' actual native DoH scripts and DTO preserve raw Flags absence/type/value and reject unverified changes',{skip:process.platform!=='win32'},async()=>{
  assert.ok(ps7&&path.isAbsolute(ps7),'Absolute selected PS7 compiler required.');
  assert.ok((await fs.stat(ps7)).isFile(),'Selected PS7 compiler must exist.');
  const base=process.env.LAGOM_TEST_TEMP;assert.ok(base&&path.isAbsolute(base),'Absolute own LAGOM_TEST_TEMP required.');
  assert.ok((await fs.stat(base)).isDirectory(),'Existing own test directory required.');
  const dir=await fs.mkdtemp(path.join(base,'native-doh-flags-'));
  try{
   const result=await execute(ps7,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fixture,'-CoreSource',core,'-DtoSource',dto,'-JsonSource',options,'-ChildShell',shell,'-WorkRoot',dir],{env:{...process.env,TEMP:dir,TMP:dir},windowsHide:true,timeout:40_000,maxBuffer:256*1024});
   assert.equal(result.stderr.trim(),'');
   const summary=JSON.parse(result.stdout);assert.equal(summary.passed,true);assert.equal(summary.caseCount,37);
   const proof=JSON.parse(await fs.readFile(path.join(dir,'receipt.json'),'utf8'));
   assert.equal(proof.childEdition,edition);assert.equal(proof.actualGeneratorDtoJsonDefaults,true);assert.equal(proof.registryIoOnlySeamReplaced,true);
   assert.equal(proof.liveRegistryDnsServiceActions,0);assert.equal(proof.actualApiRegistryBitMappingClaimed,false);assert.equal(proof.actualHostedApplyCloseCauseProven,false);assert.equal(proof.historicalMissingRawBaselineGuessed,false);assert.equal(proof.fullCoreBuild,false);
   assert.equal(proof.results.length,37);for(const row of proof.results){assert.equal(row.passed,true,row.case);assert.equal(row.untouchedPreserved,true,row.case);assert.equal(row.apiContractPreserved,true,row.case);}
  }finally{assert.equal(path.dirname(dir),path.resolve(base));await fs.rm(dir,{recursive:true,force:true});}
 });
}