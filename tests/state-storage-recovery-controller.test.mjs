import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createStorageRecovery} from '../src/state-storage-recovery.js';
function fixture() {
  const jobs=new Map(),delays=[],seen=[]; let next=1,reads=0,retries=0,writable=false;
  const value=()=>({state:{stateRevision:9,nodes:[{id:'saved'}]},storage:{writable,status:writable?'ready':'unavailable'}});
  const controller=createStorageRecovery({read:async()=>{reads++;return value();},retry:async()=>{retries++;return value();},
    onSnapshot:s=>seen.push(s),schedule:(fn,delay)=>{delays.push(delay);const id=next++;jobs.set(id,fn);return id;},cancel:id=>jobs.delete(id)});
  return {controller,jobs,delays,seen,get reads(){return reads;},get retries(){return retries;},ready(){writable=true;},
    async tick(){const [id,fn]=jobs.entries().next().value;jobs.delete(id);fn();await new Promise(resolve=>setImmediate(resolve));}};
}
test('automatic retries follow 5/15/30/60 seconds and coalesce reads',async()=>{
  const f=fixture();await Promise.all([f.controller.read(),f.controller.read()]);assert.equal(f.reads,1);
  for(let i=0;i<4;i++)await f.tick();
  assert.deepEqual(f.delays,[5000,15000,30000,60000,60000]);assert.equal(f.retries,4);
});
test('manual retry runs immediately, resets pending timer and recovers without restart',async()=>{
  const f=fixture();await f.controller.read();f.ready();await Promise.all([f.controller.retry(),f.controller.retry()]);
  assert.equal(f.retries,1);assert.equal(f.jobs.size,0);assert.equal(f.seen.at(-1).storage.writable,true);
  assert.equal(f.seen.at(-1).state.nodes[0].id,'saved');
});
test('manual retry behind a pending snapshot is joined once',async()=>{
  let resolve,reads=0,retries=0;const seen=[];
  const c=createStorageRecovery({read:()=>{reads++;return new Promise(r=>resolve=r)},retry:async()=>{retries++;return {state:null,storage:{writable:true}}},onSnapshot:s=>seen.push(s)});
  const initial=c.read();await Promise.resolve();const a=c.retry(),b=c.retry();
  resolve({state:null,storage:{writable:false}});await Promise.all([initial,a,b]);assert.equal(reads,1);assert.equal(retries,1);c.dispose();
});
test('dispose cancels retries and suppresses a late response',async()=>{
  const f=fixture();await f.controller.read();f.controller.dispose();assert.equal(f.jobs.size,0);
  const before=f.seen.length;await f.controller.retry();assert.equal(f.seen.length,before);
});
test('failed snapshot preserves the last confirmed state and produces a readonly storage status',async()=>{
  let fail=false;const seen=[];
  const c=createStorageRecovery({read:async()=>{if(fail)throw Object.assign(new Error('ACL'),{code:'EACCES'});return {state:{nodes:[{id:'saved'}]},storage:{writable:true}}},retry:async()=>{},onSnapshot:s=>seen.push(s)});
  await c.read();fail=true;await c.read();assert.equal(seen.at(-1).storage.writable,false);assert.equal(seen.at(-1).state.nodes[0].id,'saved');c.dispose();
});
test('late snapshot cannot clear a newer storage failure or regress a confirmed revision',async()=>{
  let resolve;const seen=[];
  const c=createStorageRecovery({read:()=>new Promise(r=>resolve=r),retry:async()=>{},onSnapshot:s=>seen.push(s)});
  const pending=c.read();await Promise.resolve();
  c.observe({sequence:4,writable:false,status:'unavailable',error:'STATE_STORAGE_UNAVAILABLE'});
  resolve({state:{stateRevision:8},storage:{sequence:3,writable:true,status:'ready'}});await pending;
  assert.equal(seen.at(-1).storage.sequence,4);assert.equal(seen.at(-1).storage.writable,false);c.dispose();
});
