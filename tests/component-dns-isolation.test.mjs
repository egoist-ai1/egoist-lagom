import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const source=await fs.readFile(process.env.LAGOM_COMPONENT_WORKER_TEST_SOURCE || new URL('../src/component-worker-entry.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('async function executeWorkerRequest('),source.indexOf('function replyWorker('));
function fixture({failIsolation=false,failDns=false}={}) {
 let refreshes=0,warnings=0;const dnsResult={enabled:true,running:false,verified:false,readinessPending:true};
 const dns=async()=>{if(failDns)throw Error('DNS failure');return dnsResult;};
 const managers={SystemDoH:Object.fromEntries(['apply','restart','recover','refreshBootstrap','status','stop','stopAndRemove'].map(k=>[k,dns])),Zapret:{status:async()=>({running:true}),refreshSystemDohTransportProtection:async()=>{refreshes++;if(failIsolation)throw Error('isolation failure');return {ok:true,changed:true};}}};
 const ctx=vm.createContext({workerManagers:managers,validateComponentRequest:v=>v,redactDiagnosticText:s=>s,log:{warn:()=>warnings++}});vm.runInContext(code+'\nglobalThis.run=executeWorkerRequest;',ctx);
 return {run:ctx.run,refreshes:()=>refreshes,warnings:()=>warnings,dnsResult};
}
for(const method of ['apply','restart','recover','refreshBootstrap','stop','stopAndRemove'])test('successful DNS '+method+' synchronizes addon guard without altering DNS readiness',async()=>{const f=fixture();const r=await f.run({component:'SystemDoH',method,args:[],query:false});assert.equal(f.refreshes(),1);assert.equal(r.enabled,true);assert.equal(r.verified,false);assert.equal(r.readinessPending,true);assert.equal(r.transportIsolation.ok,true);});
test('addon isolation failure preserves successful degraded DNS result',async()=>{const f=fixture({failIsolation:true});const r=await f.run({component:'SystemDoH',method:'apply',args:[],query:false});assert.equal(r.enabled,true);assert.equal(r.transportIsolation.ok,false);assert.equal(r.transportIsolation.deferred,true);assert.equal(f.warnings(),1);});
test('DNS failure does not mutate addon',async()=>{const f=fixture({failDns:true});await assert.rejects(f.run({component:'SystemDoH',method:'apply',args:[],query:false}),/DNS failure/);assert.equal(f.refreshes(),0);});
test('status and unrelated component queries do not refresh or restart addon',async()=>{const f=fixture();await f.run({component:'SystemDoH',method:'status',args:[],query:true});await f.run({component:'Zapret',method:'status',args:[],query:true});assert.equal(f.refreshes(),0);});

