import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {sourceFor} from './load-recovered.mjs';
import {extractRendererCallback,extractTopLevelFunction} from './renderer-fixture-helper.mjs';
import {createStorageRecovery} from '../src/state-storage-recovery.js';

// The actual renderer observer/action and storage controller execute against inert
// IPC. No profile persistence or native service is reached by these regressions.
const renderer=sourceFor('renderer');
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes});return{promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t) {
  const initial={stateRevision:9,nodes:[{id:'saved'}],settings:{notifications:true}};
  const confirmed={...structuredClone(initial),stateRevision:10,settings:{notifications:false}};
  const replies=[],timers=new Map();
  let model={state:structuredClone(initial),storage:{sequence:1,status:'ready',writable:true},busy:null,busyActions:[]};
  let handler,cleanup,readCount=0,nextTimer=0;
  const api={state:{
    async getSnapshot(){
      readCount++;
      if(readCount===1)return{state:structuredClone(initial),storage:{sequence:1,status:'ready',writable:true}};
      if(replies.length)return await replies.shift();
      throw Object.assign(new Error('Virtual ACL denial'),{code:'EACCES'});
    },
    async retryLoad(){throw new Error('Automatic timers are inert in this fixture');},
    onStorageChange(callback){handler=callback;return()=>{handler=null;};}
  }};
  const context=vm.createContext({
    window:{egoistAPI:api},
    createStorageRecovery:options=>createStorageRecovery({...options,schedule:(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,delay});return id;},cancel:id=>timers.delete(id)}),
    rendererMounted:{current:true},get n2(){return model;},
    O:{useMemo:callback=>callback(),useCallback:callback=>callback,useEffect:callback=>{cleanup=callback();}},
    r2:update=>{model=update(model);},Date,Error,URL,console:{warn(){}},
    f2:{current:new Map()},updateRevision:{current:0},readGeneration:{current:0},d2:{current:0},Zf:{},
    s2(){},l2(){},p2:{current:false},y2:async()=>{}
  });
  for(const name of ['Z','If','Lf','Rf','om','sm','cm','lm','um','rubyTelegramStoppedActionConfirmed'])vm.runInContext(extractTopLevelFunction(renderer,name),context);
  const start=renderer.indexOf('const storageController = O.useMemo('),end=renderer.indexOf('  const readStorageState',start);
  assert.ok(start>=0&&end>start,'Actual renderer storage lifecycle is present');
  vm.runInContext(renderer.slice(start,end)+'\nglobalThis.storageController=storageController;\nglobalThis.runAction='+extractRendererCallback(renderer,'S2')+';',context);
  t.after(()=>{context.rendererMounted.current=false;cleanup();assert.equal(timers.size,0,'Disposed fixture clears the real controller timer');});
  return{initial,confirmed,replies,controller:context.storageController,
    get model(){return model;},get readCount(){return readCount;},
    observe:storage=>handler(storage),
    async acknowledge(){assert.equal(await context.runAction('setting-notifications',async()=>({ok:true,state:structuredClone(confirmed)}),'Настройка сохранена'),true);assert.equal(model.state.stateRevision,10);}
  };
}

test('newer acknowledged settings survive a cached profile emitted by later storage failure',async t=>{
  const f=fixture(t);await f.controller.read();
  const old=deferred();f.replies.push(old.promise);const reading=f.controller.read();await turn();assert.equal(f.readCount,2);
  f.observe({sequence:2,status:'ready',writable:true});
  await f.acknowledge();
  old.resolve({state:structuredClone(f.initial),storage:{sequence:1,status:'ready',writable:true}});await reading;
  assert.equal(f.model.state.stateRevision,10);
  f.observe({sequence:3,status:'unavailable',writable:false,error:'STATE_STORAGE_UNAVAILABLE'});
  for(let n=0;n<5;n++)await turn();
  assert.equal(f.model.state.stateRevision,10,'A health event carrying a cached profile cannot reverse an acknowledged mutation');
  assert.equal(f.model.state.settings.notifications,false);
  assert.equal(f.model.storage.sequence,3);assert.equal(f.model.storage.writable,false);assert.equal(f.model.storage.systemCode,'EACCES');
});

test('a newer atomic storage snapshot replaces the confirmed profile and its health',async t=>{
  const f=fixture(t);await f.controller.read();await f.acknowledge();
  f.replies.push({state:{stateRevision:11,nodes:[{id:'newer'}],settings:{notifications:false,theme:'light'}},storage:{sequence:4,status:'ready',writable:true}});
  await f.controller.read();
  assert.equal(f.model.state.stateRevision,11);assert.equal(f.model.state.nodes[0].id,'newer');assert.equal(f.model.state.settings.theme,'light');
  assert.equal(f.model.storage.sequence,4);assert.equal(f.model.storage.status,'ready');assert.equal(f.model.storage.writable,true);
});

test('an older healthy response cannot erase newer readonly health or the acknowledged profile',async t=>{
  const f=fixture(t);await f.controller.read();
  const old=deferred();f.replies.push(old.promise);const reading=f.controller.read();await turn();await f.acknowledge();
  f.observe({sequence:3,status:'unavailable',writable:false,error:'STATE_STORAGE_UNAVAILABLE',systemCode:'EACCES'});
  assert.equal(f.model.state.stateRevision,10);assert.equal(f.model.storage.sequence,3);assert.equal(f.model.storage.writable,false);
  old.resolve({state:{...structuredClone(f.initial),stateRevision:11},storage:{sequence:2,status:'ready',writable:true}});await reading;
  assert.equal(f.model.state.stateRevision,10,'A stale health generation cannot import even a numerically newer profile');
  assert.equal(f.model.state.settings.notifications,false);assert.equal(f.model.storage.sequence,3);assert.equal(f.model.storage.writable,false);assert.equal(f.model.storage.systemCode,'EACCES');
});
