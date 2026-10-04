import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {isTrustedGuiLaunchArguments} from '../src/gui-launch-policy.js';
const source=fs.readFileSync(new URL('../src/gui-entry.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('let startMain = true;')).replace("await import('./main-internal.js')",'await importMain()');
const execute=new Function('app','process','path','isTrustedGuiLaunchArguments','checkProtectedGuiPrivilege','requestProtectedGuiElevation','importMain','console',`return (async()=>{${body}})()`);
for(const [name,options,expected] of [
  ['High admission',{privilege:{admitted:true,canRequestElevation:true}}, {imports:1,launches:0,exits:[]}],
  ['medium UAC handoff',{privilege:{admitted:false,canRequestElevation:true},outcome:{ok:true,cancelled:false}}, {imports:0,launches:1,exits:[0]}],
  ['cancelled UAC',{privilege:{admitted:false,canRequestElevation:true},outcome:{ok:false,cancelled:true}}, {imports:0,launches:1,exits:[0]}],
  ['restricted token refused',{privilege:{admitted:false,canRequestElevation:false}}, {imports:0,launches:0,exits:[64]}],
  ['unknown token refused',{probeError:true}, {imports:0,launches:0,exits:[64]}],
  ['debug argv refused before token read',{args:['--remote-debugging-port=9222']}, {imports:0,launches:0,exits:[64]}],
  ['native launch failure refuses main',{privilege:{admitted:false,canRequestElevation:true},launchError:true}, {imports:0,launches:1,exits:[64]}]
])test(`outer GUI entry gates all main initializers: ${name}`,async()=>{
  const proof={imports:0,launches:0,exits:[]};let probes=0;
  await execute({isPackaged:true,exit:code=>proof.exits.push(code)},{platform:'win32',argv:['EgoistShield.exe',...(options.args||[])],execPath:'C:\\Program Files\\EgoistShield\\EgoistShield.exe',resourcesPath:'C:\\Program Files\\EgoistShield\\resources'},path.win32,isTrustedGuiLaunchArguments,async()=>{probes++;if(options.probeError)throw Error();return options.privilege;},async(_root,args)=>{proof.launches++;assert.deepEqual(args,[]);if(options.launchError)throw Error();return options.outcome;},async()=>{proof.imports++;},{error(){}});
  assert.deepEqual(proof,expected);
  if(options.args)assert.equal(probes,0);
});
test('admission diagnostics preserve refusal and omit arbitrary exception content',async()=>{
  for(const code of ['WINDOWS_TRUST_TIMEOUT','GUI_TOKEN_STREAM_TIMEOUT','GUI_TOKEN_PROCESS_TIMEOUT','UNTRUSTED_SECRET_CODE']) {
    const logs=[],proof={imports:0,exits:[]};
    const error=Object.assign(new Error('private-path-and-token-secret'),{code,observation:{responseBytes:7,exitObserved:true,exitCode:0,nativeCode:'private-secret',path:'private-path',stack:'private-stack'}});
    await execute({isPackaged:true,exit:value=>proof.exits.push(value)},{platform:'win32',argv:['EgoistShield.exe'],execPath:'C:\\Program Files\\EgoistShield\\EgoistShield.exe',resourcesPath:'C:\\Program Files\\EgoistShield\\resources'},path.win32,isTrustedGuiLaunchArguments,async()=>{throw error;},async()=>assert.fail('No elevation after failed privilege proof'),async()=>{proof.imports++;},{error:(...values)=>logs.push(values)});
    assert.deepEqual(proof,{imports:0,exits:[64]});
    assert.equal(logs.length,1);
    const diagnostic=JSON.parse(logs[0][1]);
    assert.equal(diagnostic.stage,'privilege');
    assert.equal(diagnostic.code,code==='UNTRUSTED_SECRET_CODE'?'GUI_ADMISSION_UNVERIFIED':code);
    assert.equal(diagnostic.responseBytes,7);
    assert.equal(diagnostic.exitObserved,true);
    assert.equal(diagnostic.exitCode,0);
    assert.ok(Number.isFinite(diagnostic.elapsedMs));
    assert.deepEqual(Object.keys(diagnostic).sort(),['stage','code','elapsedMs','responseBytes','exitObserved','exitCode'].sort());
    assert.doesNotMatch(JSON.stringify(logs),/private|secret|UNTRUSTED_SECRET_CODE/);
  }
});
test('GUI admission emits only enumerated trust phases and bounded stderr counts', async () => {
  for (const [stderrPhase, stderrBytes, expected] of [
    ['code-validation', 123, { stderrPhase: 'code-validation', stderrBytes: 123 }],
    ['private-secret', 17000, {}],
    ['not-observed', 0, { stderrPhase: 'not-observed', stderrBytes: 0 }]
  ]) {
    const logs = [];
    const error = Object.assign(new Error('private-secret'), { code: 'WINDOWS_TRUST_TIMEOUT', observation: { stderrPhase, stderrBytes } });
    await execute({ isPackaged: true, exit: value => assert.equal(value, 64) }, { platform: 'win32', argv: ['EgoistShield.exe'], execPath: 'C:\\Program Files\\EgoistShield\\EgoistShield.exe', resourcesPath: 'C:\\Program Files\\EgoistShield\\resources' }, path.win32, isTrustedGuiLaunchArguments, async () => { throw error; }, async () => assert.fail('No elevation after failed proof'), async () => assert.fail('No main after failed proof'), { error: (...values) => logs.push(values) });
    const diagnostic = JSON.parse(logs[0][1]);
    const phaseFields = Object.fromEntries(Object.entries(diagnostic).filter(([key]) => key.startsWith('stderr')));
    assert.deepEqual(phaseFields, expected); assert.doesNotMatch(JSON.stringify(logs), /private|secret/);
  }
});
