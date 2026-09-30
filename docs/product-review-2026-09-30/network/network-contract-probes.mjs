// Audit-only: controlled JS state/time inputs, no Windows clock or service changes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const flag=process.argv.indexOf('--work');
assert(flag>0 && process.argv[flag+1], 'Explicit own --work path is required.');
assert(!process.env.SHIELD_BASELINE, 'This audit requires maintained sources; SHIELD_BASELINE must be unset.');
const work=path.resolve(process.argv[flag+1]);
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
process.chdir(project);
const {loadRecovered}=await import(pathToFileURL(path.join(project,'tests/load-recovered.mjs')));
const route=loadRecovered('electron/ipc/route-probe',{},['buildRouteProbeResult']);
const tunCases=[['different','203.0.113.1','203.0.113.2'],['same','203.0.113.2','203.0.113.2']].map(([label,directIp,vpnIp])=>{
  const result=route.buildRouteProbeResult({mode:'tun',directIp,vpnIp});
  return {label,verdict:result.verdict,bypassDetected:result.bypassDetected,checks:result.checks};
});
let virtualNow=Date.now(), reads=0, liveServing=true;
class VirtualDate extends Date {static now(){return virtualNow;}}
const {GravitylessDnsManager}=loadRecovered('electron/ipc/gravityless-dns-manager',{
  Date:VirtualDate,promisify:fn=>fn,execFile(){},resolveGravitylessDnsPaths:()=>({}),path,
},['GravitylessDnsManager']);
const manager=new GravitylessDnsManager('unused-lab-path');
manager.readStatus=async()=>{reads++;return{running:liveServing,verified:liveServing,serviceState:liveServing?'running':'stopped'};};
const before=await manager.status();
liveServing=false;virtualNow-=90*24*60*60*1000;
const afterRollback=await manager.status();
const readsBeforeForce=reads;
const forced=await manager.status({force:true});
const result={schemaVersion:1,sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tunCases,
  clockRollback:{scope:'isolated Date.now dependency for actual JS status-cache; no OS clock or SCM changed',virtualRollbackDays:90,before,afterRollback,readsBeforeForce,forced,totalReads:reads}};
await fs.mkdir(work,{recursive:true});
await fs.writeFile(path.join(work,'contract-reprobe.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
