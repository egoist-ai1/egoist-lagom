import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadRecovered} from './load-recovered.mjs';
const serviceName='EgoistShieldTelegramProxy';
function proof(change={}) {return {schemaVersion:1,operation:'telegram-service-recovery',serviceName,snapshotAvailable:true,stable:true,installed:true,identityVerified:true,startType:2,delayedAutoStart:false,resetPeriodSeconds:3600,actions:[5000,10000,60000].map(delayMs=>({type:'restart',delayMs})),failureActionsOnNonCrashFailures:true,...change};}
function fixture(response=proof(),failure=null) {
 const calls=[];const {TelegramProxyManager}=loadRecovered('electron/ipc/telegram-proxy-manager',{path:path.win32,process:{platform:'win32',env:{ProgramData:'C:\\ProgramData'}},promisify:fn=>fn,
 execFile:async(exe,args,options)=>{calls.push({exe,args,options});if(failure)throw failure;return{stdout:typeof response==='string'?response:JSON.stringify(response)}},resolveWindowsExecutable:name=>name},['TelegramProxyManager']);
 const manager=new TelegramProxyManager('C:\\Lagom\\resources','app','user','C:\\ProgramData\\EgoistShield\\Runtime\\TelegramProxy');manager.appendProxyLog=async()=>{};
 const mutations=[];manager.coreService={installOwnedService:async()=>{mutations.push('install');},removeOwnedService:async()=>{mutations.push('remove');},startOwnedService:async()=>{mutations.push('start');}};
 return{manager,calls,mutations};
}
test('Telegram recovery verifies actual fixed native SCM policy without registry PowerShell',async()=>{
 const f=fixture();const r=await f.manager.ensureServicePersistence();assert.equal(r.ok,true);assert.equal(r.readbackAvailable,true);assert.equal(f.mutations.length,0);
 assert.equal(f.calls[0].exe,'C:\\Lagom\\resources\\core-service\\win-x64\\EgoistShield.Service.exe');assert.deepEqual(Array.from(f.calls[0].args),['--telegram-service-recovery']);assert.equal(f.calls[0].options.timeout,4000);assert.equal(Object.hasOwn(f.calls[0].options,'env'),false);
});
test('delayed auto start is reported without changing existing mandatory policy',async()=>{const f=fixture(proof({delayedAutoStart:true}));const r=await f.manager.verifyServiceRecoveryConfiguration();assert.equal(r.ok,true);assert.equal(r.delayedAutoStart,true);});
for(const [name,change] of Object.entries({manual:{startType:3},empty:{actions:[]},reboot:{actions:[{type:'reboot',delayMs:5000}]},reset:{resetPeriodSeconds:0},delays:{actions:[5000,10000,60001].map(delayMs=>({type:'restart',delayMs}))},flag:{failureActionsOnNonCrashFailures:false}})) {
 test(`actual mismatched policy refuses persistence success: ${name}`,async()=>{const f=fixture(proof(change));const r=await f.manager.verifyServiceRecoveryConfiguration();assert.equal(r.ok,false);assert.equal(r.readbackAvailable,true);});
}
for(const [name,change] of Object.entries({schema:{schemaVersion:2},operation:{operation:'other'},service:{serviceName:'foreign'},partial:{snapshotAvailable:false},unstable:{stable:false},foreign:{identityVerified:false},unknownInstalled:{installed:null},missingDelay:{delayedAutoStart:null},overflow:{resetPeriodSeconds:4294967296},negativeDelay:{actions:[{type:'restart',delayMs:-1}]},missingFlag:{failureActionsOnNonCrashFailures:null}})){
 test(`unknown or foreign SCM data refuses repair and success: ${name}`,async()=>{const f=fixture(proof(change));await assert.rejects(f.manager.ensureServicePersistence());assert.equal(f.mutations.length,0);});
}
test('missing service is observed separately and cannot claim persistence',async()=>{const f=fixture(proof({installed:false,identityVerified:false}));const r=await f.manager.verifyServiceRecoveryConfiguration();assert.equal(r.ok,false);assert.equal(r.readbackAvailable,true);assert.match(r.details.join(';'),/не установлена/);});
test('malformed native bytes preserve inspection failure without repair',async()=>{const f=fixture('{');await assert.rejects(f.manager.ensureServicePersistence());assert.equal(f.mutations.length,0);});
test('native child failure preserves original cause and bounded diagnostics without dumping command output',async()=>{
 const failure=new Error('private command/secret text');failure.code=1;failure.signal='SIGTERM';failure.killed=true;failure.stdout=JSON.stringify({schemaVersion:1,operation:'telegram-service-recovery',serviceName,snapshotAvailable:false,stable:false,error:{stage:'failure-actions',win32:5,kind:'Win32Exception'}});failure.stderr='private stderr';
 const f=fixture(null,failure);await assert.rejects(f.manager.ensureServicePersistence(),e=>{assert.equal(e.cause,failure);assert.match(e.message,/failure-actions/);assert.match(e.message,/win32=5/);assert.match(e.message,/SIGTERM/);assert.doesNotMatch(e.message,/private|secret/);return true});assert.equal(f.mutations.length,0);
});
test('observed bad owned policy allows one repair and requires actual readback afterwards',async()=>{
 const f=fixture(proof());let reads=0;const original=f.manager.verifyServiceRecoveryConfiguration.bind(f.manager);f.manager.verifyServiceRecoveryConfiguration=async()=>++reads===1?{ok:false,readbackAvailable:true,details:['observed policy mismatch']}:original();const r=await f.manager.ensureServicePersistence();assert.equal(r.ok,true);assert.deepEqual(f.mutations,['install']);
});
test('unknown second read cannot promote a performed repair to success',async()=>{
 const f=fixture(proof({snapshotAvailable:false}));let reads=0;const original=f.manager.verifyServiceRecoveryConfiguration.bind(f.manager);f.manager.verifyServiceRecoveryConfiguration=async()=>++reads===1?{ok:false,readbackAvailable:true,details:['observed policy mismatch']}:original();await assert.rejects(f.manager.ensureServicePersistence());assert.deepEqual(f.mutations,['install']);
});

test('actual Windows readonly SCM recovery API and strict fixed CLI', {skip:process.platform!=='win32',timeout:150000},async()=>{
 const base=process.env.LAGOM_TEST_TEMP || process.env.RUNNER_TEMP;
 assert.ok(base && path.isAbsolute(base),'Caller-owned test temp is required');
 const work=await fs.mkdtemp(path.join(base,'scm-'));
 const local=path.resolve('.tools/dotnet-10.0.401/dotnet.exe');
 const dotnet=process.env.SHIELD_DOTNET || (process.env.DOTNET_INSTALL_DIR && path.join(process.env.DOTNET_INSTALL_DIR,'dotnet.exe')) || (await fs.stat(local).then(()=>true,()=>false)?local:'dotnet');
 const env={...process.env,LAGOM_TEST_TEMP:base,DOTNET_CLI_HOME:path.join(work,'dotnet-home'),NUGET_PACKAGES:path.join(work,'n'),TEMP:work,TMP:work,
 DOTNET_ADD_GLOBAL_TOOLS_TO_PATH:'0',DOTNET_SKIP_FIRST_TIME_EXPERIENCE:'1',DOTNET_GENERATE_ASPNET_CERTIFICATE:'false',DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_NOLOGO:'1'};
 if(path.isAbsolute(dotnet)){env.DOTNET_ROOT=path.dirname(dotnet);env.DOTNET_ROOT_X64=path.dirname(dotnet)}
 const run=promisify(execFile);
 const compiled=await run(dotnet,['build',path.resolve('tests/NativeServiceRecoveryRegression/NativeServiceRecoveryRegression.csproj'),'-c','Release','--nologo',
 `-p:BaseIntermediateOutputPath=${path.join(work,'obj').split(path.sep).join('/')}/`,`-p:OutputPath=${path.join(work,'bin').split(path.sep).join('/')}/`],{env,windowsHide:true,timeout:120000,maxBuffer:8*1024*1024}).catch(async error=>{await fs.writeFile(path.join(work,'compile-failed.txt'),(error.stdout??'')+(error.stderr??''));throw error});
 await fs.writeFile(path.join(work,'compile.txt'),compiled.stdout+compiled.stderr);
 const result=await run(path.join(work,'bin','NativeServiceRecoveryRegression.exe'),['--work',work],{env,windowsHide:true,timeout:15000,maxBuffer:128*1024}).catch(async error=>{await fs.writeFile(path.join(work,'actual-native-failed.txt'),(error.stdout??'')+(error.stderr??''));throw error});
 await fs.writeFile(path.join(work,'actual-native.txt'),result.stdout+result.stderr);
 const actual=JSON.parse(result.stdout.trim());assert.equal(actual.kind,'actual-readonly-native-service-recovery');assert.equal(actual.actualNativeApis,true);
 assert.ok(actual.checks.length>=20&&actual.checks.every(check=>check.passed));assert.equal(actual.scmWrites,false);assert.equal(actual.registryWrites,false);assert.equal(actual.dnsWrites,false);assert.equal(actual.serviceInstallationVerified,false);
});
