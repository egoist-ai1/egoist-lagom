import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sourceFor } from './load-recovered.mjs';
import { extractRendererCallback, extractTopLevelFunction } from './renderer-fixture-helper.mjs';

// Real production manager/renderer methods with inert OS/IPC leaves. No app,
// Core/SCM, private profiles, UIA, network sockets, or native commands are used.
const renderer=fs.readFileSync(new URL('../src/recovered/renderer.js',import.meta.url),'utf8');
const managerSource=sourceFor('electron/ipc/telegram-proxy-manager');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function fixture({bindBeforeCompletion=false,stopFailure=false}={}){
  const events=[],gate=deferred(),stopped=deferred();let scmRunning=true,foreign=false,cleanups=0;
  const managerContext=vm.createContext({path:path.win32,process:{env:{},platform:'win32'},randomBytes,promisify:f=>f,execFile:()=>{throw Error('Forbidden live native call');},resolveWindowsExecutable:name=>name,
    resolveTelegramProxyChecksumState:()=> 'verified',buildTelegramProxyLinks:()=>({}),buildTelegramProxyUpdateGate:()=>({}),buildTelegramProxyHealthState:v=>v,Buffer,Date,Error,Promise,setTimeout,clearTimeout});
  vm.runInContext(managerSource+'\n;globalThis.Manager=TelegramProxyManager;',managerContext);
  const manager=new managerContext.Manager('fixture-resources','fixture-app','fixture-user','C:\\Fictional\\Telegram',{
    stopOwnedService:async()=>{events.push('core-stop-ack');scmRunning=false;stopped.resolve();},
    startOwnedService:async()=>{throw Error('No ON allowed in this bounded stop fixture');}
  });
  manager.appendProxyLog=async (_level,message)=>events.push(message);
  manager.ensureConfigExists=async()=>{};
  manager.readConfig=async()=>awaitConfig();
  manager.readManagedState=async()=>null;manager.isStateRunning=async()=>false;
  manager.queryServiceStatus=async()=>({installed:true,running:scmRunning,state:scmRunning?'running':'stopped',pid:scmRunning?100:null});
  manager.execSc=async args=>{events.push(['sc-adapter',...args]);};
  manager.waitForServiceState=async expected=>!scmRunning && expected==='stopped';
  manager.stopStaleTelegramProxyProcesses=async()=>{cleanups++;events.push(['cleanup-adapter',cleanups]);if(cleanups===1){await gate.promise;if(stopFailure)throw Error('Synthetic cleanup failure after SCM stop');}};
  manager.readLogTailLines=async()=>[];manager.readRuntimeTraffic=()=>({rx:0,tx:0,source:'unavailable'});
  manager.getManagedRuntimeInfo=async()=>({runtimePath:'fictional-runtime.exe',version:'1'});
  manager.getBundledRuntimeInfo=async()=>null;manager.sha256File=async()=>null;
  manager.queryListenerOwnership=async()=>foreign?{state:'foreign',ownerPid:5196,ownerName:'pwsh.exe'}:{state:'none',ownerPid:null,ownerName:null};
  manager.isLocalTcpPortOpen=async()=>foreign;
  let snapshot={telegram:{config:awaitConfig(),serviceInstalled:true,serviceRunning:true,running:true,runtimeReady:true,listenerReady:true,uiObservation:{known:true}},state:{nodes:[],stateRevision:1},storage:{writable:true},busy:null,busyActions:[],runtimeLogs:[]};
  function awaitConfig(){return {host:'127.0.0.1',port:1443,secret:'a'.repeat(32),dcIp:[],verbose:false,bufKb:256,poolSize:8,logMaxMb:5,checkUpdates:false};}
  const activities=[],consoleWarnings=[],hooks=[];let hookIndex=0;const effects=[];
  const rendererContext=vm.createContext({Date,Error,URL,console:{warn:v=>consoleWarnings.push(v)},window:{egoistAPI:{telegramProxy:{stop:()=>manager.stop(),status:()=>manager.status()}}},
    O:{useMemo:f=>f(),useCallback:f=>f,useRef:initial=>({current:initial}),useEffect:()=>{},useState(initial){const index=hookIndex++;if(!(index in hooks))hooks[index]=typeof initial==='function'?initial():initial;return [hooks[index],v=>{hooks[index]=typeof v==='function'?v(hooks[index]):v;}];}},
    V:{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},readGeneration:{current:0},telegramReadSequence:{current:0},rendererMounted:{current:true},telegramForegroundReads:{current:0},updateRevision:{current:0},f2:{current:new Map()},d2:{current:0},p2:{current:false},Zf:{},l2(){},zapretHistoryResult:()=>null,
    r2:fn=>snapshot=fn(snapshot),get n2(){return snapshot},s2:activity=>{activities.push(activity);events.push(['activity',activity.id,activity.tone,activity.title]);},
    y2:async()=>{events.push('post-action-refresh');const next=await manager.status({force:true});snapshot={...snapshot,telegram:{...next,uiObservation:{known:true}}};}
  });
  for(const name of ['Q','$','am','Z','om','sm','cm','lm','um','If','Lf','Rf',...(renderer.includes('function rubyTelegramStoppedActionConfirmed(')?['rubyTelegramStoppedActionConfirmed']:[])])vm.runInContext(extractTopLevelFunction(renderer,name),rendererContext);
  const widget=fs.readFileSync(new URL('../src/brand/ShieldWidget.jsx',import.meta.url),'utf8');
  vm.runInContext(widget.slice(0,widget.indexOf('function ShieldWidget(')),rendererContext);
  const bf=renderer.match(/Bf = (\{ host:.*?checkUpdates: true \})/);assert.ok(bf);vm.runInContext('globalThis.Bf='+bf[1]+';',rendererContext);
  vm.runInContext('globalThis.readTelegramStatus='+extractRendererCallback(renderer,'readTelegramStatus')+';',rendererContext);
  rendererContext.y2=async()=>{events.push('post-action-refresh-with-actual-telegram-adoption');await rendererContext.readTelegramStatus(rendererContext.readGeneration.current,Date.now());await flush();};
  const panel=extractTopLevelFunction(renderer,'Ep');for(const match of panel.matchAll(/\(0, V\.jsxs?\)\(([$\w]+),/g))if(!(match[1]in rendererContext))rendererContext[match[1]]=match[1];rendererContext.$p=v=>v;
  vm.runInContext(panel+'\n;globalThis.runAction='+extractRendererCallback(renderer,'S2')+';',rendererContext);
  function elements(tree){return !tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(elements):[tree,...elements(tree.props?.children)];}
  function text(tree){return typeof tree==='string'||typeof tree==='number'?String(tree):Array.isArray(tree)?tree.map(text).join(''):tree?.props?text(tree.props.children):'';}
  function control(){hookIndex=0;const tree=rendererContext.Ep({snapshot,runAction:rendererContext.runAction,refreshTelegram:async()=>manager.status({force:true}),confirmAction(){}});const button=elements(tree).find(row=>row.type==='button'&& ['Остановить','Останавливается…','Запустить'].includes(text(row)));assert.ok(button);return {name:text(button),disabled:!!button.props.disabled};}
  return {events,activities,consoleWarnings,stopped,gate,manager,context:rendererContext,control,get snapshot(){return snapshot},bind(){assert.equal(scmRunning,false);foreign=true;events.push('bind-own-actor-adapter');}, async run(){const pending=rendererContext.runAction('tg-stop',()=>manager.stop(),'Telegram Proxy остановлен');await stopped.promise;await flush();const atScmStopped=control();assert.equal(atScmStopped.name,'Останавливается…');assert.equal(atScmStopped.disabled,true);
      if(bindBeforeCompletion)this.bind();gate.resolve();const ok=await pending;const afterAck=control();return {ok,atScmStopped,afterAck,lastActivity:activities.at(-1),events,consoleWarnings};}};
}
test('successful manual Telegram OFF remains successful when a foreign listener arrives before the final status ACK',async()=>{
  const target=fixture({bindBeforeCompletion:true}),report=await target.run();
  assert.equal(report.ok,true,'SCM/runtime cleanup completed; the new foreign endpoint is readiness for a future ON, not failed OFF');
  assert.equal(report.lastActivity.tone,'good');assert.equal(report.lastActivity.detail,'Telegram Proxy остановлен');
  assert.equal(report.atScmStopped.name,'Останавливается…');assert.equal(report.atScmStopped.disabled,true);
  assert.equal(report.afterAck.name,'Запустить');assert.equal(report.afterAck.disabled,false);
  const status=await target.manager.status({force:true});assert.equal(status.listenerOwnership,'foreign');assert.equal(status.runtimeReady,false);assert.equal(status.serviceRunning,false);assert.equal(status.portConflict.available,false);assert.match(status.lastError,/занят pwsh/);
});
test('GUI OFF ACK before occupying the port keeps later status conflict separate from the completed action',async()=>{
  const target=fixture(),report=await target.run();assert.equal(report.ok,true);assert.equal(report.afterAck.name,'Запустить');assert.equal(report.afterAck.disabled,false);target.bind();
  const status=await target.manager.status({force:true});assert.equal(status.listenerOwnership,'foreign');assert.equal(status.runtimeReady,false);assert.equal(target.activities.at(-1).tone,'good');
});
test('a genuine cleanup exception after SCM stopped still reports failed OFF',async()=>{
  const target=fixture({stopFailure:true}),report=await target.run();assert.equal(report.ok,false);assert.equal(report.lastActivity.tone,'bad');assert.match(report.lastActivity.detail,/Synthetic cleanup failure/);
});
const negatives=[
  {name:'unknown SCM',patch:{serviceState:'unknown'}},
  {name:'service still active',patch:{serviceRunning:true}},
  {name:'runtime still active',patch:{running:true}},
  {name:'runtime ready contradiction',patch:{runtimeReady:true}},
  {name:'listener ready contradiction',patch:{listenerReady:true}},
  {name:'uninstalled service contradiction',patch:{serviceInstalled:false}},
  {name:'unknown listener owner',patch:{listenerOwnership:'unknown'}},
  {name:'owned listener contradiction',patch:{listenerOwnership:'owned'}},
  {name:'available endpoint contradiction',patch:{portConflict:{available:true}}},
  {name:'explicit backend failure',patch:{ok:false}},
  {name:'explicit lifecycle failure',patch:{lifecycle:'failed'}},
  {name:'other returned operation error',patch:{error:'Synthetic earlier operation failure'}},
  {name:'different Start action',action:'tg-start',patch:{}},
  {name:'different Remove action',action:'tg-remove',patch:{}},
];
for(const item of negatives)test(`foreign readiness never masks ${item.name}`,async()=>{
  const source=fixture();assert.equal((await source.run()).ok,true);source.bind();const actualForeignStatus=await source.manager.status({force:true});
  // Mutated return boundary only; the base is a real readStatus result.
  const status={...actualForeignStatus,...item.patch},target=fixture();const ok=await target.context.runAction(item.action??'tg-stop',async()=>status,'Synthetic result boundary');assert.equal(ok,false);assert.equal(target.activities.at(-1).tone,'bad');
});
test('normal next Telegram ON still refuses the foreign endpoint before any Core start',async()=>{
  const target=fixture();assert.equal((await target.run()).ok,true);target.bind();
  await assert.rejects(target.manager.start(),/Порт Telegram Proxy 127\.0\.0\.1:1443 занят pwsh/);
});
