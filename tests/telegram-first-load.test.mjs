import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { isIP } from 'node:net';
import { z } from 'zod';
import { createStorageRecovery } from '../src/state-storage-recovery.js';
import { extractRendererCallback } from './renderer-fixture-helper.mjs';

// This is a source-extracted UI/IPC fixture. It never starts the app or native services.
const baseline = process.env.LAGOM_TELEGRAM_UI_SOURCE_DIR;
const renderer = fs.readFileSync(baseline ? path.join(baseline,'renderer.js') : new URL('../src/recovered/renderer.js',import.meta.url),'utf8');
const widget = fs.readFileSync(baseline ? path.join(baseline,'ShieldWidget.jsx') : new URL('../src/brand/ShieldWidget.jsx',import.meta.url),'utf8');
const schemaSource = fs.readFileSync(new URL('../src/recovered/electron/ipc/ipc-schemas.js',import.meta.url),'utf8');
const handlersSource = fs.readFileSync(new URL('../src/recovered/electron/ipc/handlers-telegram-proxy.js',import.meta.url),'utf8');
const managerSource = fs.readFileSync(new URL('../src/recovered/electron/ipc/telegram-proxy-manager.js',import.meta.url),'utf8');
const config = () => ({host:'127.0.0.1',port:1443,secret:'0123456789abcdef0123456789abcdef',dcIp:[],verbose:false,bufKb:256,poolSize:8,logMaxMb:5,checkUpdates:true});
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const flush = () => new Promise(resolve=>setImmediate(resolve));
function extract(source,name){const start=source.indexOf(`function ${name}(`),end=source.indexOf('\n}',start)+2;assert.ok(start>=0&&end>start,name);return source.slice(start,end)}
const callback = name => extractRendererCallback(renderer, name);
function harness(options={}){
  let native={config:config(),serviceInstalled:false,serviceRunning:false,running:false,runtimeReady:false,listenerReady:false};
  let snapshot={telegram:options.initialTelegram??null,state:null,storage:{status:'ready',writable:true},busy:null,busyActions:[],zapretProfiles:[],runtimeLogs:[]};
  const calls={status:0,save:[],managerSave:0,install:0,start:0,stop:0,remove:0,open:0,activity:[],pending:[],refreshes:0};
  const schema=vm.createContext({z,isIP,URL});vm.runInContext(schemaSource+'\n;globalThis.schema=TelegramProxyConfigSchema;',schema);
  const actualManager=vm.createContext({isIP});for(const name of ['isLoopbackHost','normalizeDirectDcEndpoints','validateTelegramProxyConfig'])vm.runInContext(extract(managerSource,name),actualManager);
  const handlers=new Map(),manager={
    status:async()=>{calls.status++;return options.status?options.status(calls.status,native):structuredClone(native)},
    saveConfig:async draft=>{calls.managerSave++;const validated=actualManager.validateTelegramProxyConfig(draft);if(options.save)return options.save(validated,native);native={...native,config:{...validated}};return structuredClone(native)},
    installService:async()=>{calls.install++;native={...native,serviceInstalled:true,serviceRunning:true,running:true,runtimeReady:true,listenerReady:true};return structuredClone(native)},
    start:async()=>{calls.start++;return {ok:true}},stop:async()=>{calls.stop++;native={...native,serviceRunning:false,running:false,runtimeReady:false,listenerReady:false};return structuredClone(native)},removeService:async()=>{calls.remove++;native={...native,serviceInstalled:false,serviceRunning:false,running:false};return structuredClone(native)},openConnectionLink:async()=>{calls.open++;return {ok:true}},
  };
  const handlerContext=vm.createContext({ipcMain:{handle:(key,value)=>handlers.set(key,value)},TelegramProxyConfigSchema:schema.schema,manager});
  vm.runInContext(handlersSource+'\n;registerTelegramProxyHandlers({telegramProxyManager:manager});',handlerContext);
  const invoke=(channel,...args)=>Promise.resolve().then(()=>handlers.get(channel)({},...args));
  const confirmedState=()=>({nodes:[],stateRevision:1});
  const confirmedSnapshot=async()=>({state:confirmedState(),storage:{status:'ready',writable:true,checkedAt:new Date().toISOString()}});
  const api={state:{get:async()=>confirmedState(),getSnapshot:confirmedSnapshot,retryLoad:confirmedSnapshot},app:{isAdmin:async()=>true},vpn:{status:async()=>({connected:false}),serviceStatus:async()=>({serviceState:'not-installed'})},
    system:{dnsControllerStatus:async()=>({running:false}),systemDohStatus:async()=>({running:false}),getMyIp:()=>options.ip?.promise??Promise.resolve({ip:'198.51.100.1'})},
    zapret:{status:()=>options.zapret?.promise??Promise.resolve({serviceRunning:false}),listProfiles:async()=>[]},
    telegramProxy:{status:()=>invoke('telegram-proxy:status'),saveConfig:draft=>{calls.save.push(structuredClone(draft));return invoke('telegram-proxy:save-config',draft)},installService:()=>invoke('telegram-proxy:install-service'),start:()=>invoke('telegram-proxy:start'),stop:()=>invoke('telegram-proxy:stop'),removeService:()=>invoke('telegram-proxy:remove-service'),openLink:()=>invoke('telegram-proxy:open-link'),tailLogs:async()=>[]},
    health:{getReport:async()=>({})},network:{inspect:async()=>({})},logs:{getRuntimeSummary:async()=>[]}};
  const hooks=[];let hookIndex=0,changed=false;const effects=[];
  const context=vm.createContext({window:{egoistAPI:api},URL,Date,Error,createStorageRecovery,setTimeout,clearTimeout,console:{warn(){}},O:{useMemo:fn=>fn(),useCallback:fn=>fn,
    useState(initial){const index=hookIndex++;if(!(index in hooks))hooks[index]=typeof initial==='function'?initial():initial;return [hooks[index],value=>{const next=typeof value==='function'?value(hooks[index]):value;if(next!==hooks[index])changed=true;hooks[index]=next}]},
    useRef(initial){const index=hookIndex++;if(!(index in hooks))hooks[index]={current:initial};return hooks[index]},useEffect:fn=>effects.push(fn)},
    V:{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},readGeneration:{current:0},telegramReadSequence:{current:0},rendererMounted:{current:true},telegramForegroundReads:{current:0},h2:{current:false},_2:{current:null},Mf:1000,jf:1000,Nf:1000,updateRevision:{current:0},f2:{current:new Map()},d2:{current:0},p2:{current:false},Zf:{},
    r2:updater=>{snapshot=updater(snapshot)},get n2(){return snapshot},s2:value=>calls.activity.push(value),l2(){},zapretHistoryResult:(_next,previous)=>previous??null});
  for(const name of ['im','am','Z','om','sm','cm','lm','um','Q','$','Dm','Om','Em','If','Lf','Rf'])vm.runInContext(extract(renderer,name),context);
  vm.runInContext(widget.slice(0,widget.indexOf('function ShieldWidget(')),context);
  const bf=renderer.match(/Bf = (\{ host:.*?checkUpdates: true \})/);assert.ok(bf);vm.runInContext(`globalThis.Bf=${bf[1]};`,context);
  if(renderer.includes('let readTelegramStatus =')){
    vm.runInContext('globalThis.readTelegramStatus='+callback('readTelegramStatus')+';globalThis.refreshTelegram='+callback('refreshTelegram')+';',context);
  }else context.refreshTelegram=async()=>{const value=await api.telegramProxy.status();return value};
  if(renderer.includes('const storageController = O.useMemo(')){
    const start=renderer.indexOf('const storageController = O.useMemo('),end=renderer.indexOf('  O.useEffect(',start);
    assert.ok(end>start,'Actual storage controller setup exists');
    vm.runInContext(renderer.slice(start,end)+'\nglobalThis.readStorageState='+callback('readStorageState')+';',context);
  }
  vm.runInContext('globalThis.v2='+callback('v2')+';globalThis.y2='+callback('y2')+';globalThis.runAction='+callback('S2')+';',context);
  const quick=context.y2;context.y2=async()=>{calls.refreshes++;return quick()};
  context.document={hidden:false,addEventListener(){},removeEventListener(){}};context.window.setInterval=()=>1;context.window.clearInterval=()=>{};
  const pollStart=renderer.indexOf('let e3 = true, t3 = async (t4 = false) => {'),pollEnd=renderer.indexOf('}, [v2, y2, g2])',pollStart);assert.ok(pollStart>=0&&pollEnd>pollStart);vm.runInContext('globalThis.mountPoll=()=>{'+renderer.slice(pollStart,pollEnd)+'};',context);
  const lifetimeStart=renderer.indexOf('rendererMounted.current = true;');let lifetimeCleanup=()=>{};
  if(lifetimeStart>=0){const lifetimeEnd=renderer.indexOf('}, []);',lifetimeStart);vm.runInContext('globalThis.mountLifetime=()=>{'+renderer.slice(lifetimeStart,lifetimeEnd)+'};',context);lifetimeCleanup=context.mountLifetime();}
  const panel=extract(renderer,'Ep');for(const match of panel.matchAll(/\(0, V\.jsxs?\)\(([$\w]+),/g))if(!(match[1]in context))context[match[1]]=match[1];context.$p=value=>value;vm.runInContext(panel,context);
  function render(){let tree;for(let repeat=0;repeat<8;repeat++){hookIndex=0;effects.length=0;changed=false;tree=context.Ep({snapshot,refreshTelegram:context.refreshTelegram,confirmAction:(_title,_body,_label,action)=>{const result=action();calls.pending.push(result)},runAction:(...args)=>{const pending=context.runAction(...args);calls.pending.push(pending);return pending}});for(const effect of [...effects])effect();if(!changed)return tree}throw Error('Fixture hook effects failed to settle')}
  const elements=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(elements):[tree,...elements(tree.props?.children)];
  const text=tree=>typeof tree==='string'||typeof tree==='number'?String(tree):Array.isArray(tree)?tree.map(text).join(''):tree?.props?text(tree.props.children):'';
  function button(label,tree=render()){const found=elements(tree).find(value=>value.type==='button'&&text(value).includes(label));assert.ok(found,`Actual button ${label}`);return found}
  function edit(label,value,tree=render()){const field=elements(tree).find(element=>element.type==='Bp'&&element.props.label===label);assert.ok(field,label);field.props.onChange(value)}
  async function click(label){const before=calls.pending.length;const returned=button(label).props.onClick();return calls.pending.length>before?calls.pending.at(-1):returned}
  return {context,calls,render,button,edit,click,elements,text,schema:schema.schema,actualManager,mountPoll:()=>context.mountPoll(),unmount:pollCleanup=>{pollCleanup?.();lifetimeCleanup()},get snapshot(){return snapshot},get native(){return native},setNative(patch){native={...native,...patch}},setSnapshot(patch){snapshot={...snapshot,...patch}}};
}

test('early full-batch Telegram adoption does not wait for unrelated getMyIp and performs one status read',async()=>{
  const ip=deferred(),h=harness({ip}),read=h.context.v2();await flush();
  assert.equal(h.calls.status,1);assert.equal(h.context.rubyStatusKnown(h.snapshot.telegram),true);assert.equal(h.snapshot.telegram.config.secret.length,32);assert.equal(h.button('Установить фоновую службу').props.disabled,false);
  ip.resolve({});await read;
});
test('quick-batch Telegram adoption does not wait for an unrelated service',async()=>{
  const zapret=deferred(),h=harness({zapret}),read=h.context.y2();await flush();assert.equal(h.snapshot.telegram?.config?.port,1443);assert.equal(h.calls.status,1);zapret.resolve({serviceRunning:false});await read;
});
test('initial delayed Telegram disables mutation buttons and callback sends no default config',async()=>{
  const tg=deferred(),h=harness({status:()=>tg.promise}),read=h.context.v2();await flush();
  for(const label of ['Установить фоновую службу','Добавить в приложение'])assert.equal(h.button(label).props.disabled,true);
  assert.equal(await h.click('Установить фоновую службу'),false);assert.equal(h.calls.save.length,0);assert.equal(h.calls.install,0);
  tg.resolve({config:config(),serviceInstalled:false});await read;assert.equal(h.snapshot.telegram,null,'Action invalidates older first read');
  await h.context.refreshTelegram();assert.equal(h.snapshot.telegram.config.port,1443);assert.equal(h.button('Установить фоновую службу').props.disabled,false);
});
test('initial rejected status is unknown; genuine read-only retry restores config without any mutation',async()=>{
  const h=harness({status:(count,native)=>count===1?Promise.reject(Error('fixture core unavailable')):structuredClone(native)});await h.context.v2();
  assert.equal(h.snapshot.telegram.uiObservation.known,false);assert.equal(h.button('Установить фоновую службу').props.disabled,true);
  assert.equal(await h.click('Перепроверить конфигурацию'),true);await flush();assert.equal(h.calls.status,2);assert.equal(h.calls.save.length,0);assert.equal(h.calls.install,0);assert.equal(h.button('Установить фоновую службу').props.disabled,false);
});
test('stale/missing/malformed configuration never enables config mutations or paints cached autostart green',async()=>{
  for(const telegram of [{config:config(),serviceInstalled:true,uiObservation:{known:false,stale:true}}, {serviceInstalled:false,uiObservation:{known:true}}, {config:{...config(),host:123,dcIp:[42]},uiObservation:{known:true}}]){
    const h=harness({initialTelegram:telegram});const tree=h.render();assert.equal(h.button(telegram.serviceInstalled?'Переустановить службу':'Установить фоновую службу',tree).props.disabled,true);
    assert.equal(await h.click('Добавить в приложение'),false);assert.equal(h.calls.save.length,0);assert.equal(h.calls.open,0);
    if(telegram.uiObservation.stale){const chip=h.elements(tree).find(value=>value.props?.className==='telegram-status-chip'&&h.text(value).includes('Автозапуск'));assert.ok(chip);}
  }
});
test('authoritative pristine config installs without save even when runtime is not ready',async()=>{
  const h=harness();await h.context.v2();assert.equal(h.context.rubyTelegramReady(h.snapshot.telegram),false);
  assert.equal(await h.click('Установить фоновую службу'),true);assert.equal(h.calls.save.length,0);assert.equal(h.calls.install,1);assert.equal(h.snapshot.telegram.config.port,1443);
});
test('raw32 starting dd survives pristine and dirty UI callbacks, fingerprints and actual save handler; only valid34 prefix is stripped',async()=>{
  const raw='dd'+'0'.repeat(30),prefixed='dd'+raw,h=harness();h.setNative({config:{...config(),secret:raw}});await h.context.v2();
  assert.equal(h.context.rubyTelegramConfigReady(h.snapshot.telegram),true,'A genuine raw32 secret can begin with dd');
  assert.equal(h.context.rubyTelegramConfigKey({...config(),secret:raw}),h.context.rubyTelegramConfigKey({...config(),secret:prefixed}),'Raw32 and supported prefixed34 represent the same complete secret');
  assert.equal(h.button('Установить фоновую службу').props.disabled,false);assert.equal(await h.click('Установить фоновую службу'),true);assert.equal(h.calls.save.length,0,'Pristine authoritative raw32 is not rewritten');assert.equal(h.native.config.secret,raw);
  h.edit('Буфер, КБ','512');assert.equal(await h.click('Переустановить службу'),true);assert.equal(h.calls.managerSave,1);assert.equal(h.calls.save[0].secret,raw,'Dirty payload preserves all 32 valid raw hex chars');assert.equal(h.native.config.secret,raw);assert.equal(h.native.config.bufKb,512);
  assert.equal(h.schema.parse({...config(),secret:raw}).secret,raw);assert.equal(h.actualManager.validateTelegramProxyConfig({...config(),secret:raw}).secret,raw);
  assert.equal(h.schema.parse({...config(),secret:prefixed}).secret,raw);assert.equal(h.actualManager.validateTelegramProxyConfig({...config(),secret:prefixed}).secret,raw);
  h.edit('Secret (32 hex-символа)',prefixed);assert.equal(await h.click('Переустановить службу'),true);assert.equal(h.calls.managerSave,2);assert.equal(h.calls.save[1].secret,raw);assert.equal(h.native.config.secret,raw);
  for(const secret of ['dd'+'0'.repeat(29),'dd'+'0'.repeat(31),'dd'+'g'.repeat(32)])assert.notEqual(h.context.rubyTelegramConfigProblem({...config(),secret}),null,'Malformed length/nonhex still fails');
});
test('dirty draft saves only its actual config, verifies readback, then installs; untouched secret/port persist',async()=>{
  const h=harness();await h.context.v2();h.edit('Буфер, КБ','512');
  assert.equal(await h.click('Установить фоновую службу'),true);assert.equal(h.calls.save.length,1);assert.equal(h.calls.install,1);assert.equal(h.calls.save[0].bufKb,512);assert.equal(h.calls.save[0].secret,config().secret);assert.equal(h.calls.save[0].port,1443);
  assert.equal(h.schema.safeParse(h.calls.save[0]).success,true);assert.equal(h.native.config.bufKb,512);
  await h.context.refreshTelegram();h.render();await h.click('Остановить');h.setNative({running:false,serviceRunning:false,runtimeReady:false,listenerReady:false});await h.context.refreshTelegram();
  await h.click('Переустановить службу');assert.equal(h.calls.save.length,1,'Acknowledged draft is pristine on next action');
});
test('invalid dirty secret is not silently replaced by the old secret or sent to IPC',async()=>{
  const h=harness();await h.context.v2();h.edit('Secret (32 hex-символа)','');assert.equal(await h.click('Установить фоновую службу'),false);assert.equal(h.calls.save.length,0);assert.equal(h.calls.install,0);
  const draft=h.elements(h.render()).find(value=>value.type==='Bp'&&value.props.label==='Secret (32 hex-символа)');assert.equal(draft.props.value,'');
});
test('rejected and resolved ok:false saves block install and preserve dirty draft for an explicit retry',async()=>{
  for(const reject of [true,false]){let failed=true;const h=harness({save:(draft,native)=>{if(failed){failed=false;if(reject)throw Error('fixture write denied');return {ok:false,error:'fixture write denied'}}native.config={...draft};return structuredClone(native)}});await h.context.v2();h.edit('Буфер, КБ','512');
    assert.equal(await h.click('Установить фоновую службу'),false);assert.equal(h.calls.install,0);assert.equal(h.elements(h.render()).find(value=>value.type==='Bp'&&value.props.label==='Буфер, КБ').props.value,'512');
    assert.equal(await h.click('Установить фоновую службу'),true);assert.equal(h.calls.save.length,2);assert.equal(h.calls.install,1);
  }
});
test('changed authoritative config and dirty draft require existing explicit conflict choice',async()=>{
  const h=harness();await h.context.v2();h.edit('Буфер, КБ','512');h.setNative({config:{...config(),poolSize:9}});await h.context.refreshTelegram();h.render();
  assert.equal(h.button('Установить фоновую службу').props.disabled,true);assert.equal(await h.click('Установить фоновую службу'),false);assert.equal(h.calls.save.length,0);
  await h.click('Оставить мои изменения');assert.equal(await h.click('Установить фоновую службу'),true);assert.equal(h.calls.save.length,1);assert.equal(h.calls.save[0].bufKb,512);
});
test('fresh preflight detects unseen backend config drift before writing dirty draft',async()=>{
  const h=harness();await h.context.v2();h.edit('Буфер, КБ','512');h.setNative({config:{...config(),poolSize:9}});
  assert.equal(await h.click('Установить фоновую службу'),false);assert.equal(h.calls.save.length,0);assert.equal(h.calls.install,0);assert.ok(h.button('Взять значения службы'));
});
test('newer rejected retry cannot be replaced by an older successful batch in the same action generation',async()=>{
  const ip=deferred(),old=deferred(),h=harness({ip,status:count=>count===1?old.promise:Promise.reject(Error('fixture newer failure'))}),first=h.context.v2();await flush();
  await assert.rejects(h.context.refreshTelegram(),/newer failure/);await flush();assert.equal(h.snapshot.telegram.uiObservation.known,false);
  old.resolve({config:config(),serviceInstalled:false});ip.resolve({});await first;assert.equal(h.snapshot.telegram.uiObservation.known,false);assert.equal(h.button('Установить фоновую службу').props.disabled,true);
});
test('late first read and retry cannot cross a newer runAction generation fence',async()=>{
  const tg=deferred(),h=harness({status:()=>tg.promise}),first=h.context.v2();await flush();const retry=h.context.refreshTelegram();const caught=assert.rejects(retry,/изменилось во время чтения/);
  await h.context.runAction('tg-copy',async()=>({ok:true}),'fixture copied');tg.resolve({config:config(),serviceInstalled:false});await Promise.all([first,caught]);await flush();assert.equal(h.snapshot.telegram,null);
});
test('pending save locks advanced edits and repeated installation; stop/remove known service do not need a secret',async()=>{
  const save=deferred(),h=harness({save:async(draft,native)=>{await save.promise;native.config={...draft};return structuredClone(native)}});await h.context.v2();h.edit('Буфер, КБ','512');const action=h.click('Установить фоновую службу');await flush();
  const tree=h.render(),fieldset=h.elements(tree).find(value=>value.type==='fieldset');assert.equal(fieldset.props.disabled,true);assert.equal(h.button('Устанавливается…',tree).props.disabled,true);h.edit('Буфер, КБ','1024',tree);assert.equal(await h.click('Устанавливается…'),false);save.resolve();assert.equal(await action,true);assert.equal(h.calls.install,1);assert.equal(h.calls.save[0].bufKb,512);
  const noConfig=harness({initialTelegram:{serviceInstalled:true,serviceRunning:true,runtimeReady:false,uiObservation:{known:true}}});noConfig.setNative({config:undefined,serviceInstalled:true,serviceRunning:true,runtimeReady:false});assert.equal(noConfig.button('Остановить').props.disabled,false);await noConfig.click('Остановить');assert.equal(noConfig.calls.stop,1);assert.equal(noConfig.button('Удалить').props.disabled,false);await noConfig.click('Удалить');assert.equal(noConfig.calls.remove,1);assert.equal(noConfig.calls.save.length,0);
});
test('unconfirmed save reply and changed post-save readback retain dirty values and cannot proceed to installation',async()=>{
  for(const changedAfter of [false,true]){const h=harness({save:(draft,native)=>{native.config={...draft};return changedAfter?structuredClone(native):{ok:true,config:{...draft,bufKb:768}}},status:(count,native)=>changedAfter&&count===3?{...structuredClone(native),config:{...native.config,bufKb:768}}:structuredClone(native)});await h.context.v2();h.edit('Буфер, КБ','512');
    assert.equal(await h.click('Установить фоновую службу'),false);assert.equal(h.calls.save.length,1);assert.equal(h.calls.install,0);assert.equal(h.elements(h.render()).find(value=>value.type==='Bp'&&value.props.label==='Буфер, КБ').props.value,'512');
  }
});
test('repeated rejected retry exposes a useful inline error and performs no install or configuration write',async()=>{
  const h=harness({status:()=>Promise.reject(Error('fixture service unavailable'))});await h.context.v2();assert.equal(await h.click('Перепроверить конфигурацию'),false);await flush();const tree=h.render();assert.equal(h.button('Установить фоновую службу',tree).props.disabled,true);assert.ok(h.elements(tree).some(value=>value.props?.role==='alert'&&h.text(value).includes('fixture service unavailable')));assert.equal(h.calls.save.length,0);assert.equal(h.calls.install,0);
});
test('UI config validation agrees with actual IPC and manager bounds; malformed fingerprints are harmless',()=>{
  const h=harness();assert.equal(typeof h.context.rubyTelegramConfigReady,'function');const good={config:config(),runtimeReady:false,uiObservation:{known:true}};assert.equal(h.context.rubyTelegramConfigReady(good),true);
  for(const patch of [{host:'192.168.1.2'},{port:53},{secret:''},{bufKb:4097},{poolSize:33},{logMaxMb:101},{verbose:'true'},{dcIp:['6:149.154.167.220']},{dcIp:['2:example.invalid']},{dcIp:['2:[::1]']},{extra:true}]){const candidate={...config(),...patch};assert.equal(h.context.rubyTelegramConfigReady({config:candidate}),false,JSON.stringify(patch));let valid=h.schema.safeParse(candidate).success;try{h.actualManager.validateTelegramProxyConfig(candidate)}catch{valid=false}assert.equal(valid,false,'Real contract rejects same unsupported config');}
  assert.doesNotThrow(()=>h.context.rubyTelegramConfigKey({host:123,secret:42,dcIp:[42]}));
});
test('actual busy polling effect does not supersede a dirty foreground preflight',async()=>{
  const preflight=deferred(),h=harness({status:(count,native)=>count===2?preflight.promise:structuredClone(native)});await h.context.v2();h.edit('Буфер, КБ','512');const action=h.click('Установить фоновую службу');await flush();const dispose=h.mountPoll();await flush();
  preflight.resolve(structuredClone(h.native));assert.equal(await action,true);assert.equal(h.calls.save.length,1);assert.equal(h.calls.install,1);dispose();
});
test('actual lifetime cleanup prevents pending status callbacks from adopting facts after unmount',async()=>{
  const tg=deferred(),h=harness({status:()=>tg.promise}),dispose=h.mountPoll();await flush();h.unmount(dispose);tg.resolve({config:config(),serviceInstalled:false});await flush();assert.equal(h.snapshot.telegram,null);
});

for (const [state,label,tone,activeConnections] of [['degraded','Есть ошибки маршрута','warn',2],['error','Маршрут недоступен','bad',0]]) {
  test(`route ${state} is shown separately from a ready local Telegram proxy`,async()=>{
    const h=harness();h.setNative({serviceRunning:true,running:true,runtimeReady:true,listenerReady:true,health:{route:{state,mode:'cloudflare',activeConnections,totalConnections:3,successfulFallbackConnections:2}}});await h.context.v2();
    const tree=h.render(),route=h.elements(tree).find(v=>v.props?.className?.startsWith('telegram-status-chip')&&h.text(v).startsWith('Маршрут'));
    assert.ok(route);assert.equal(h.text(route),'Маршрут'+label);assert.equal(h.elements(route).find(v=>v.type==='Fp').props.tone,tone);
    const proxy=h.elements(tree).find(v=>v.props?.className?.startsWith('telegram-status-chip')&&h.text(v).startsWith('Прокси'));
    assert.equal(h.text(proxy),'Проксиработает','Local listener readiness does not prove the remote route');
  });
}
test('stale Telegram route does not retain cached error tone',async()=>{
  const h=harness({initialTelegram:{config:config(),serviceRunning:true,running:true,runtimeReady:true,listenerReady:true,health:{route:{state:'error'}},uiObservation:{known:false,stale:true}}});
  const route=h.elements(h.render()).find(v=>v.props?.className?.startsWith('telegram-status-chip')&&h.text(v).startsWith('Маршрут'));
  assert.ok(route);assert.equal(h.text(route),'Маршрутне проверен');assert.equal(h.elements(route).find(v=>v.type==='Fp').props.tone,'idle');
});
