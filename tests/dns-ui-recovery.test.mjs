import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

const { ShieldConnectionController } = await import(process.env.LAGOM_SHIELD_CONTROLLER_TEST_SOURCE ? pathToFileURL(process.env.LAGOM_SHIELD_CONTROLLER_TEST_SOURCE).href : new URL('../src/shield-connection-controller.js', import.meta.url));
const filename = process.env.LAGOM_DNS_UI_TEST_SOURCE;
let source = await fs.readFile(filename || new URL('../src/brand/ShieldWidget.jsx', import.meta.url), 'utf8');
if (filename && source.includes('const ShieldSpeedPanel=')) {
  const start = source.indexOf('function rubyStatusKnown(') >= 0 ? source.indexOf('function rubyStatusKnown(') : source.indexOf('function rubyTelegramReady(');
  const end = source.indexOf('const ShieldSpeedPanel=', start);
  assert.ok(start >= 0 && end > start, 'Installed production widget boundary exists');
  source = source.slice(start, end);
}
const { code } = await transform(source + '\nglobalThis.component = ShieldWidget;', {
  loader: 'jsx', jsxFactory: 'O.createElement', jsxFragment: 'O.Fragment', charset: 'utf8',
});

const settle = async () => { for (let i=0; i<12; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return {promise,resolve,reject}; };
function mount({ initial = {}, snapshotSettings = {}, system = {} } = {}) {
  let cursor=0, tree, nextTimer=0, progress;
  const slots=[], effects=[], timers=new Map(), listeners=new Map(), storage=new Map();
  let state = { phase:'connected', busy:false, running:true, dnsRunning:false, telegramRunning:true, statusError:null, error:null, ...initial };
  const api = {
    state: { get: async () => ({ settings: { systemDohUrl:'https://resolver.example/dns-query', systemDohEnabled:true, ...snapshotSettings } }) },
    shield: { status: async () => state, onProgress: callback => { progress=callback; return () => {progress=null;}; } },
    system: { applySystemDoh: async () => ({ok:false,message:'DNS startup verification failed'}), resetSystemDoh: async () => ({ok:false,message:'DNS stop failed'}), ...system },
    telegramProxy: { start:async()=>({running:true}), stop:async()=>({running:false}) },
  };
  const hooks = {
    useState(initial) { const i=cursor++; if (!(i in slots)) slots[i]=typeof initial==='function'?initial():initial; return [slots[i], next=> {slots[i]=typeof next==='function'?next(slots[i]):next;}]; },
    useRef(initial) { const i=cursor++; if (!(i in slots)) slots[i]={current:initial}; return slots[i]; },
    useEffect(callback) { const i=cursor++; if (!(i in slots)) {slots[i]=true; effects.push(callback);} },
    useLayoutEffect() {cursor++;},
    createElement(type,props,...children) {return {type,props:{...props,children}};}, Fragment:Symbol('fragment'),
  };
  const context=vm.createContext({O:hooks, window:{egoistAPI:api}, URL,
    RubyIcon:()=>null, Z:(_name,fn,...args)=>fn(...args),
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    document:{hidden:false,addEventListener:(key,callback)=>{if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key).add(callback);},removeEventListener:(key,callback)=>listeners.get(key)?.delete(callback)},
    setTimeout:(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,delay});return id;}, clearTimeout:id=>timers.delete(id),
  });
  vm.runInContext(code,context);
  const render=()=>{cursor=0;tree=context.component({snapshot:{state:{settings:{systemDohEnabled:true,systemDohUrl:'https://resolver.example/dns-query',...snapshotSettings}}},onOpenSettings(){}}); return tree;};
  const descendants=value=> !value||typeof value!=='object'?[]:[value,...(value.props?.children??[]).flat(Infinity).flatMap(descendants)];
  const find=predicate=>descendants(tree).find(predicate);
  render(); for(const callback of effects.splice(0)) {const cleanup=callback();if(typeof cleanup==='function')effects.push(cleanup);}
  return { api, render, find, timers,
    setState:next=>{state={...state,...next};}, setStatusRead:fn=>{api.shield.status=fn;},
    async ready(){await settle();render();},
    async poll(){assert.equal(timers.size,1,'Exactly one poll is scheduled');const [id,timer]=timers.entries().next().value;timers.delete(id);await timer.callback();await settle();render();},
    async click(label){const button=find(e=>e.props?.['aria-label']===label);assert.ok(button,'Actual widget switch exists');assert.equal(button.props.disabled,false);const pending=button.props.onClick();render();await pending;await settle();render();},
    progress:next=>progress(next),
    dispose(){for(const cleanup of effects)cleanup();effects.length=0;},
  };
}
const dns=h=>h.find(e=>e.props?.['aria-label']==='Зашифрованный DNS');
const alerts=h=>h.find(e=>e.props?.role==='alert');

// This executes the actual React component with its handlers/effects and controlled IPC.
// No live application, DNS, service or renderer instrumentation is involved.
test('failed DNS enable error clears only when a later current poll confirms DNS recovery', async () => {
  const h=mount(); await h.ready(); await h.click('Зашифрованный DNS');
  assert.match(String(alerts(h)?.props.children), /DNS startup verification failed/);
  h.setState({dnsRunning:true}); await h.poll();
  assert.equal(dns(h).props['aria-checked'],true,'Healthy read must update actual switch');
  assert.equal(alerts(h),undefined,'Recovered DNS must not keep showing the obsolete action failure'); h.dispose();
});

test('failed DNS stop remains visible while the resolver is still running', async () => {
  const h=mount({initial:{dnsRunning:true}}); await h.ready(); await h.click('Зашифрованный DNS');
  await h.poll(); assert.equal(dns(h).props['aria-checked'],true);
  assert.match(String(alerts(h)?.props.children), /DNS stop failed/); h.dispose();
});

test('current status failure is visible even when an earlier DNS action also failed', async () => {
  const h=mount(); await h.ready(); await h.click('Зашифрованный DNS');
  h.setStatusRead(async()=>{throw new Error('Current Core status unavailable');}); await h.poll();
  assert.match(String(alerts(h)?.props.children), /Current Core status unavailable/,'Historical action failure must not hide current observation failure');
  assert.equal(dns(h).props.disabled,true); h.dispose();
});

test('current unknown DNS status never enables a cached switch', async () => {
  const h=mount({initial:{dnsRunning:true}}); await h.ready();
  h.setState({statusError:'DNS owner inspection unavailable'}); await h.poll();
  assert.equal(dns(h).props['aria-checked'],false,'Unknown is not verified enabled');
  assert.equal(dns(h).props.disabled,true); h.dispose();
});

test('desired enabled DNS with degraded process health is labelled as unverified, not switched off', async () => {
  const h=mount({initial:{dnsRunning:false,dnsHealthState:'degraded',dnsServiceRunning:true,dnsConfigured:true,dnsError:'Upstream query timed out'}});
  await h.ready(); const group=h.find(e=>e.props?.className==='shield-switch-group');
  assert.equal(dns(h).props['aria-checked'],false,'An unverified resolver cannot be presented as healthy');
  assert.match(group.props.title,/провер|восстанов|запрос/i,'Running degraded DNS must not be described as switched off'); h.dispose();
});

test('late poll cannot overwrite DNS recovery delivered by a newer read', async () => {
  const h=mount(); await h.ready(); const old=deferred(); h.setStatusRead(()=>old.promise);
  const pending=h.poll(); await settle();
  h.progress({dnsRunning:true}); h.render();
  old.resolve({running:true,dnsRunning:false,telegramRunning:true}); await pending;
  assert.equal(dns(h).props['aria-checked'],true,'Revision fencing preserves the newer status');
  h.dispose(); assert.equal(h.timers.size,0,'Dispose cancels the single polling timer');
});


test('DNS recovery cannot dismiss a newer Telegram failure', async () => {
  const h=mount(); await h.ready(); await h.click('Зашифрованный DNS');
  await h.click('Telegram Proxy');
  assert.match(String(alerts(h)?.props.children), /Telegram Proxy/);
  h.setState({dnsRunning:true,telegramRunning:true}); await h.poll();
  assert.match(String(alerts(h)?.props.children), /Telegram Proxy/,'A different component healed, while failed stop remains unresolved'); h.dispose();
});

test('failed DNS stop is not dismissed when the service merely becomes degraded', async () => {
  const h=mount({initial:{dnsRunning:true,dnsHealthState:'ready',dnsConfigured:true,dnsServiceRunning:true}}); await h.ready(); await h.click('Зашифрованный DNS');
  h.setState({dnsRunning:false,dnsHealthState:'degraded',dnsServiceRunning:true,dnsError:'DNS upstream failure'}); await h.poll();
  assert.ok(alerts(h));
  h.setState({dnsRunning:true,dnsHealthState:'ready',dnsError:null}); await h.poll();
  assert.match(String(alerts(h)?.props.children), /DNS stop failed/,'A failed stop target was never observed');
  h.setState({dnsRunning:false,dnsConfigured:false,dnsServiceRunning:false,dnsHealthState:'stopped'}); await h.poll();
  assert.equal(alerts(h),undefined,'Only a confirmed stopped resolver resolves a failed stop');
  assert.equal(h.find(e=>e.props?.className==='shield-switch-group').props.title,'DNS выключен','Fresh explicit stopped configuration wins over an older desired setting snapshot'); h.dispose();
});

function controllerFixture(dnsStatus) {
  return new ShieldConnectionController({
    zapret:{status:async()=>({serviceRunning:true,runtimeReady:true})},
    dns:{status:async()=>dnsStatus.value},
    telegramProxy:{status:async()=>({running:true,serviceRunning:true,runtimeReady:true,listenerReady:true})},
  });
}

test('actual Shield status preserves configured/service state while DNS health moves degraded to verified', async () => {
  const dnsStatus={value:{enabled:true,serviceRunning:true,serviceState:'running',running:false,verified:false,healthState:'degraded',lastError:'Fresh upstream timeout'}};
  const controller=controllerFixture(dnsStatus);
  const degraded=await controller.status();
  assert.equal(degraded.dnsRunning,false); assert.equal(degraded.dnsConfigured,true); assert.equal(degraded.dnsServiceRunning,true);
  assert.equal(degraded.dnsHealthState,'degraded'); assert.equal(degraded.dnsError,'Fresh upstream timeout');
  dnsStatus.value={...dnsStatus.value,running:true,verified:true,healthState:'ready'};
  const healthy=await controller.status(); assert.equal(healthy.dnsRunning,true); assert.equal(healthy.dnsHealthState,'ready');
  assert.equal(healthy.dnsError,null,'Old manager lastError is not a current error after verified recovery');
});

test('unknown owner observation exposes unknown metadata instead of reusing cached health', async () => {
  const dnsStatus={value:{enabled:true,serviceRunning:true,running:true,verified:true,healthState:'ready'}};
  const controller=controllerFixture(dnsStatus); await controller.status();
  dnsStatus.value={serviceState:'unknown',ownerInspectionErrors:[{code:'ACCESS_DENIED'}],lastError:'Owner inspection denied'};
  const current=await controller.status(); assert.match(current.statusError,/Owner inspection denied/);
  assert.equal(current.dnsHealthState,'unknown'); assert.equal(current.dnsConfigured,null); assert.equal(current.dnsServiceRunning,null);
});

test('verified native DoH has ready health despite no separate local DNS service', async () => {
  const controller=controllerFixture({value:{enabled:true,nativeManaged:true,serviceRunning:false,serviceState:'native',running:true,verified:true,lastError:'Earlier native failure'}});
  const current=await controller.status(); assert.equal(current.dnsRunning,true); assert.equal(current.dnsHealthState,'ready');
  assert.equal(current.dnsConfigured,true); assert.equal(current.dnsServiceRunning,false); assert.equal(current.dnsError,null);
});

test('actual controller and actual widget recover a failed enable only after verified readback', async () => {
  const dnsStatus={value:{enabled:true,serviceRunning:true,serviceState:'running',running:false,verified:false,healthState:'degraded',lastError:'Fresh upstream timeout'}};
  const controller=controllerFixture(dnsStatus); const h=mount();
  h.setStatusRead(()=>controller.status()); await h.ready(); await h.poll(); await h.click('Зашифрованный DNS');
  assert.equal(dns(h).props['aria-checked'],false); assert.ok(alerts(h));
  dnsStatus.value={...dnsStatus.value,running:true,verified:true,healthState:'ready'}; await h.poll();
  assert.equal(dns(h).props['aria-checked'],true); assert.equal(alerts(h),undefined); h.dispose();
});
