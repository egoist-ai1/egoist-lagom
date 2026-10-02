import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createSocket } from 'node:dgram';
const context=vm.createContext({Buffer,AbortController,setTimeout,clearTimeout,createSocket,promisify:x=>x,execFile(){},import_node_util:{promisify:x=>x},import_node_child_process:{execFile(){}},import_node_dgram:{createSocket},SYSTEM_DOH_VERIFICATION_DOMAINS:['blocked.example','working.example','other.example'],normalizeSystemDohUrl:x=>x,parseSystemDohUrl:()=>({serverPort:8443})});
vm.runInContext(fs.readFileSync(process.env.LAGOM_DOH_TEST_SOURCE || 'src/recovered/electron/ipc/system-doh-service-manager.js','utf8')+';globalThis.api={SystemDohManager}',context);
const {SystemDohManager}=context.api;
test('boot recovery of running same-provider DNS returns degraded status without a readiness loop or mutation',async()=>{
 const manager=Object.create(SystemDohManager.prototype); const calls=[];
 const state={url:'https://resolver.example:8443/private',localAddress:'127.0.0.1',localPort:53};
 manager.readManagedState=async()=>state;
 manager.queryServiceStatus=async()=>({installed:true,running:true,state:'running'});
 manager.status=async()=>{calls.push('status');return {enabled:true,serviceRunning:true,verified:false,currentUrl:state.url};};
 manager.waitUntilReady=async()=>{calls.push('readiness');return false;};
 manager.applyInternal=async()=>{calls.push('apply');return {verified:false};};
 manager.writeManagedState=async()=>calls.push('write');
 const result=await manager.recoverInternal({enabled:true,url:state.url});
 assert.equal(result.verified,false);
 assert.deepEqual(calls,['status']);
});
test('one stalled verification domain cannot delay a working domain in the same probe',async(t)=>{
 const server=createSocket('udp4'); await new Promise(resolve=>server.bind(0,'127.0.0.2',resolve));
 t.after(()=>server.close());
 server.on('message',(query,peer)=>{
  if(query.includes(Buffer.from('blocked')))return;
  const reply=Buffer.concat([query,Buffer.from([0xc0,0x0c,0,1,0,1,0,0,0,60,0,4,192,0,2,53])]);
  reply.writeUInt16BE(0x8180,2);reply.writeUInt16BE(1,6);server.send(reply,peer.port,peer.address);
 });
 const manager=Object.create(SystemDohManager.prototype);const start=Date.now();
 assert.equal(await manager.verifyDns({localAddress:'127.0.0.2',localPort:server.address().port}),true);
 assert.ok(Date.now()-start<1200,'healthy alternative must complete before stalled-domain timeout');
});

test('a running service with failed resolution reports degradation and a reason',async()=>{
 const manager=Object.create(SystemDohManager.prototype);
 Object.assign(manager,{lastError:null,readManagedState:async()=>({localAddress:'127.0.0.1',localPort:53,url:'https://resolver.example:8443/private'}),queryServiceStatus:async()=>({installed:true,running:true,state:'running'}),verifyDns:async()=>false,migrateLegacyStateIfNeeded:async()=>{},getManagedRuntimeInfo:async()=>({runtimePath:'owned.exe'}),getSourceRuntimeInfo:async()=>null,});
 context.normalizeSystemDohLocalAddress=x=>x;
 const status=await manager.readStatus();assert.equal(status.enabled,true);assert.equal(status.serviceRunning,true);assert.equal(status.running,false);assert.equal(status.healthState,'degraded');assert.match(status.lastError,/DoH/);
});
