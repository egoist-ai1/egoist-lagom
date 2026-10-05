import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadRecovered } from './load-recovered.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const oldCommand = '$configs = Get-DnsClientServerAddress -AddressFamily IPv4,IPv6 -ErrorAction SilentlyContinue; $configs | Select-Object InterfaceAlias,InterfaceIndex,AddressFamily,ServerAddresses | ConvertTo-Json -Compress';
const inertRows = [
  { InterfaceAlias:'inert-owned-reader', InterfaceIndex:77, AddressFamily:2, ServerAddresses:['192.0.2.53'] },
  { InterfaceAlias:'inert-owned-reader', InterfaceIndex:77, AddressFamily:23, ServerAddresses:['2001:db8::53'] }
];
function snapshotFixture(run) {
  const calls = [];
  const { createDnsMutationRollbackSnapshot } = loadRecovered('electron/ipc/handlers-system', {
    Error, JSON, process:{platform:'win32',env:{}}, promisify:value=>value,
    CoreServiceClient:class {}, path:{join:()=>'<inert marker>'}, app:{getPath:()=>'<inert>'},
    resolveWindowsExecutable:()=> 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    createAdapterDnsRollbackSnapshot:(rows,reason)=>({rows:plain(rows),reason}),
    execFile:async (image,args,options)=>{
      calls.push({image,args:plain(args),options:plain(options)});
      return run(args[3]);
    }
  }, ['createDnsMutationRollbackSnapshot']);
  return { calls, invoke:()=>createDnsMutationRollbackSnapshot('inert-owned-baseline') };
}
function checkContract(call) {
  assert.equal(call.image,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(call.args.length,4);
  assert.deepEqual(call.args.slice(0,3),['-NoProfile','-NonInteractive','-Command']);
  assert.deepEqual(call.options,{timeout:15000,maxBuffer:1048576,windowsHide:true});
}
function runInertCommand(command, missingModule=false) {
  const selectedTemp=process.env.LAGOM_TEST_TEMP;
  assert.ok(typeof selectedTemp==='string' && selectedTemp.length>0 && path.isAbsolute(selectedTemp),'An absolute existing LAGOM_TEST_TEMP is required');
  const base=path.resolve(selectedTemp);
  assert.ok(fs.statSync(base).isDirectory(),'An absolute existing LAGOM_TEST_TEMP directory is required');
  const work=fs.mkdtempSync(path.join(base,'doh-snapshot-command-'));
  assert.ok(work.startsWith(base+path.sep));
  const commandPath=path.join(work,'command.txt');
  try {
    fs.writeFileSync(commandPath,command,'utf8');
    const shell=process.env.LAGOM_TEST_POWERSHELL || path.join(process.env.SystemRoot || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
      fileURLToPath(new URL('./system-doh-rollback-snapshot.ps1',import.meta.url)),
      '-CommandPath',commandPath,'-WorkRoot',work];
    if(missingModule) args.push('-MissingModule');
    const result=spawnSync(shell,args,{encoding:'utf8',timeout:15000,maxBuffer:1048576,windowsHide:true});
    if(result.error) throw result.error;
    const markers=(result.stderr || '').split(/\r?\n/).filter(line=>line.startsWith('INERT_SNAPSHOT_PROBE:'));
    assert.equal(markers.length,1,'bounded inert fixture marker must be present');
    const metadata=JSON.parse(markers[0].slice('INERT_SNAPSHOT_PROBE:'.length));
    assert.equal(metadata.nativeQueries,0);
    if(result.status!==0) throw Object.assign(new Error('Inert module import was refused'),{code:result.status,killed:false,signal:result.signal,metadata});
    return {stdout:result.stdout,metadata};
  } finally {
    assert.ok(path.resolve(work).startsWith(base+path.sep));
    fs.rmSync(work,{recursive:true,force:true});
  }
}

test('actual rollback snapshot preserves child contract and both DNS families',async()=>{
  const f=snapshotFixture(()=>({stdout:JSON.stringify(inertRows)}));
  const value=await f.invoke();
  checkContract(f.calls[0]);
  assert.equal(value.reason,'inert-owned-baseline');
  assert.deepEqual(value.rows,[{adapterId:'77',adapterName:'inert-owned-reader',interfaceIndex:77,
    before:[{family:'ipv4',mode:'static',servers:['192.0.2.53']},{family:'ipv6',mode:'static',servers:['2001:db8::53']}]}]);
});
test('actual generated command bypasses an unrelated DNS reader shadow; frozen old command selects it',
  {skip:process.platform!=='win32',timeout:30000},async()=>{
    let metadata;
    const f=snapshotFixture(command=>{
      const result=runInertCommand(command); metadata=result.metadata; return result;
    });
    const value=await f.invoke(); checkContract(f.calls[0]);
    assert.equal(metadata.redirectedModuleRoots,1);
    assert.equal(metadata.moduleCalls,1); assert.equal(metadata.shadowCalls,0);
    assert.deepEqual(metadata.families,['IPv4','IPv6']);
    assert.equal(metadata.errorAction,'SilentlyContinue');
    assert.equal(value.rows[0].adapterId,'77');
    assert.equal(value.rows[0].before.length,2);
    const old=runInertCommand(oldCommand);
    assert.equal(old.metadata.redirectedModuleRoots,0);
    assert.equal(old.metadata.moduleCalls,0); assert.equal(old.metadata.shadowCalls,1);
    assert.equal(JSON.parse(old.stdout).InterfaceIndex,666);
  });
test('actual generated command fails closed if the owned DnsClient module cannot load',
  {skip:process.platform!=='win32',timeout:20000},async()=>{
    const f=snapshotFixture(command=>runInertCommand(command,true));
    await assert.rejects(f.invoke(),error=>{
      assert.equal(error.cause.code,1); assert.equal(error.cause.killed,false);
      assert.equal(error.cause.metadata.moduleCalls,0);
      assert.equal(error.cause.metadata.shadowCalls,0);
      assert.equal(error.cause.metadata.ok,false);
      return true;
    });
    checkContract(f.calls[0]);
  });

test('inert command fixture refuses missing or relative private temp before any file or process action',()=>{
  const saved=process.env.LAGOM_TEST_TEMP;
  try {
    for(const selected of [undefined,'relative-fixture-root']){
      if(selected===undefined) delete process.env.LAGOM_TEST_TEMP;
      else process.env.LAGOM_TEST_TEMP=selected;
      assert.throws(()=>runInertCommand(oldCommand),/absolute existing LAGOM_TEST_TEMP/);
    }
  } finally {
    if(saved===undefined) delete process.env.LAGOM_TEST_TEMP;
    else process.env.LAGOM_TEST_TEMP=saved;
  }
});
