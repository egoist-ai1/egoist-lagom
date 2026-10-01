import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { isTrustedGuiLaunchArguments } from '../src/gui-launch-policy.js';
import { loadRecovered } from './load-recovered.mjs';

test('packaged runtime ignores test environment overrides', () => {
  const { detectRuntimeEnvironment }=loadRecovered('electron/app-paths',{},['detectRuntimeEnvironment']);
  for (const nodeEnv of [undefined,'test','production','development']) assert.equal(detectRuntimeEnvironment({isPackaged:true,nodeEnv}),'production');
  assert.equal(detectRuntimeEnvironment({isPackaged:false,nodeEnv:'test'}),'test');
  assert.equal(detectRuntimeEnvironment({isPackaged:false,nodeEnv:'production'}),'development');
});

test('production GUI accepts only finite normal launch flags', () => {
  for (const args of [[], ['--minimized'], ['--background'], ['--minimized','--background'], ['--background','--minimized']]) assert.equal(isTrustedGuiLaunchArguments(args),true);
  for (const args of [null, {}, ['--minimized','--minimized'], ['--background','--background'], ['--remote-debugging-port=9222'], ['--remote-debugging-pipe'], ['--app=C:\\outside'], ['--type=renderer'], ['--user-data-dir=C:\\outside'], ['--js-flags=--expose-gc'], ['outside.js'], ['--inspect'], ['--MINIMIZED'], [null]]) assert.equal(isTrustedGuiLaunchArguments(args),false);
});

test('invalid packaged launch exits before path, state or service initialization', () => {
  const source=fs.readFileSync('src/recovered/electron/main.js','utf8');
  const start=source.indexOf('var runtimeEnvironment = detectRuntimeEnvironment(');
  const end=source.indexOf('var appPathConfig = ',start);
  assert.ok(start >= 0 && end > start);
  const exits=[];
  const context=vm.createContext({ app:{isPackaged:true,exit:code=>exits.push(code)}, process:{env:{},argv:['EgoistShield.exe','--remote-debugging-port=9222']},
    detectRuntimeEnvironment:()=> 'production',isTrustedGuiLaunchArguments,console:{error(){}} });
  assert.throws(()=>vm.runInContext(source.slice(start,end),context),/Unsupported production GUI/);
  assert.deepEqual(exits,[64]);
  context.process.argv=['EgoistShield.exe','--minimized'];
  vm.runInContext(source.slice(start,end),context);
  assert.deepEqual(exits,[64]);
});
