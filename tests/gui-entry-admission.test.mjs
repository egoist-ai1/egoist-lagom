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