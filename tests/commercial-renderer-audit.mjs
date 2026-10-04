import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const evidence=process.argv[2];
assert.ok(evidence&&path.isAbsolute(evidence),'absolute task evidence required');
assert.ok(process.env.PLAYWRIGHT_MODULE&&path.isAbsolute(process.env.PLAYWRIGHT_MODULE));
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const {transform}=await import(pathToFileURL(path.join(project,'node_modules/esbuild/lib/main.js')));
await fs.mkdir(evidence,{recursive:true});
// Compile exactly the production renderer composition in memory: no .vite or installed files touched.
const build=await fs.readFile(path.join(project,'scripts/build.mjs'),'utf8');
const start=build.indexOf('let rendererSource =');
const end=build.indexOf("await fs.writeFile('.vite/renderer/main_window/assets/index-Eaqlb9_F.js'");
assert.ok(start>=0&&end>start);
const rootFs={readFile:(name,...args)=>fs.readFile(path.join(project,name),...args),readdir:(name,...args)=>fs.readdir(path.join(project,name),...args)};
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const version=JSON.parse(await fs.readFile(path.join(project,'package.json'),'utf8')).version;
const source=await new AsyncFunction('fs','transform','packageVersion','buildDate',build.slice(start,end)+'\nreturn rendererSource;')(rootFs,transform,version,'04.10.2026');
const css=(await Promise.all(['src/recovered/renderer.css',...['tokens.css','compact-ruby.css','compact-surfaces.css','shield-widget.css','final-polish.css'].map(n=>'src/brand/'+n)].map(n=>fs.readFile(path.join(project,n),'utf8')))).join('\n');
const compiled=(await transform(source,{loader:'js',minify:true,charset:'utf8'})).code;
const origin='https://lagom.test';
const preload=await fs.readFile(path.join(project,'src/recovered/preload.cjs'),'utf8');
function fixture({extraMethods=[]}={}){
 const clone=v=>structuredClone(v),noop=()=>()=>{};
 const lab=window.lab={calls:[],reads:{},listeners:{},shield:{running:false,dnsRunning:false,dnsHealthState:'stopped',telegramRunning:false,busy:false},state:{stateRevision:1,domainRules:[],processRules:[],settings:{autoStart:false,minimizeToTray:false,systemDohUrl:'https://dns.example.test/query',systemDohEnabled:false,autoUpdate:false},nodes:[{id:'node-1',name:'Test server',server:'192.0.2.2',port:443,protocol:'vless'}],subscriptions:[],activeNodeId:'node-1'},vpn:{running:false,connected:false},vpnService:{serviceInstalled:false,serviceRunning:false,running:false,backgroundEnabled:false,serviceState:'not-installed',observation:{state:'known'}},doh:{running:false,serviceRunning:false,nativeManaged:true},zapret:{serviceRunning:false,standaloneRunning:false,currentProfile:'general (EGOIST MIX)'},telegram:{running:false,serviceRunning:false,serviceInstalled:true,config:{host:'127.0.0.1',port:1443,secret:'0123456789abcdef0123456789abcdef',dcIp:[],verbose:false,bufKb:256,poolSize:8,logMaxMb:5,checkUpdates:true}},lists:{generalDomains:[],includedCidrs:[],excludedDomains:[],excludedCidrs:[]}};
 Object.assign(lab,{readCalls:[],clipboard:'',manualServers:[],effects:{}});
 Object.assign(lab.state.settings,{routeMode:'global',dnsMode:'auto',useTunMode:false});
 const read=(name,fn)=>async(...args)=>{const method=({'dns.status':'system.dnsControllerStatus','doh.status':'system.systemDohStatus','telegram.status':'telegramProxy.status'})[name]??name;lab.reads[method]=(lab.reads[method]??0)+1;lab.readCalls.push({name:method,args:clone(args)});return clone(fn(...args))};
 const act=(name,fn=()=>({ok:true}))=>async(...args)=>{lab.calls.push({name,args:clone(args)});return clone(fn(...args))};
 const listen=name=>cb=>{lab.listeners[name]=cb;return()=>delete lab.listeners[name]};
 window.egoistAPI={
  shield:{status:read('shield.status',()=>lab.shield),connect:act('shield.connect',()=>{lab.shield.running=true;return {ok:true}}),disconnect:act('shield.disconnect',()=>{lab.shield.running=false;return {ok:true}}),cancel:act('shield.cancel'),onProgress:listen('shield.progress')},
  state:{get:read('state.get',()=>lab.state),patchSettings:act('state.patchSettings',patch=>{Object.assign(lab.state.settings,patch);lab.state.stateRevision++;return {ok:true,state:lab.state}}),patchRules:act('state.patchRules',()=>({ok:true,state:lab.state}))},
  node:{select:act('node.select',(id)=>{lab.state.activeNodeId=id;lab.state.stateRevision++;return {ok:true,state:lab.state}}),setFavorite:act('node.setFavorite'),rename:act('node.rename'),delete:act('node.delete')},
  app:{isAdmin:async()=>false,isFirstRun:async()=>false,getVersion:async()=>({version:'3.8.0',buildDate:'04.10.2026'})},
  window:{minimize:act('window.minimize'),close:act('window.close'),setWidgetMode:act('window.setWidgetMode'),onSwitchToWidget:listen('window.widget'),isMaximized:async()=>false,toggleMaximize:act('window.toggleMaximize')},
  vpn:{status:read('vpn.status',()=>lab.vpn),serviceStatus:read('vpn.serviceStatus',()=>lab.vpnService),connect:act('vpn.connect',()=>{lab.vpn.running=true;lab.vpn.connected=true;return lab.vpn}),disconnect:act('vpn.disconnect',()=>{lab.vpn.running=false;return lab.vpn}),onFallback:noop,serviceInstall:act('vpn.serviceInstall'),serviceStart:act('vpn.serviceStart'),serviceStop:act('vpn.serviceStop'),serviceRemove:act('vpn.serviceRemove')},
  system:{dnsControllerStatus:read('dns.status',()=>({mode:'system-default',currentServers:[]})),systemDohStatus:read('doh.status',()=>lab.doh),getMyIp:async()=>({ip:'192.0.2.1',country:'Test',provider:'Fixture'}),ping:async()=>20,pingActiveProxy:async()=>20,dnsDiagnostics:async()=>({targets:[],summary:{total:0,okCount:0}}),applySystemDoh:act('system.applySystemDoh',()=>{lab.shield.dnsRunning=true;lab.doh.running=true;return {ok:true,running:true,verified:true}}),resetSystemDoh:act('system.resetSystemDoh',()=>{lab.shield.dnsRunning=false;lab.doh.running=false;return {ok:true,running:false}}),setDnsServers:act('system.setDnsServers'),resetDnsServers:act('system.resetDnsServers'),restartSystemDoh:act('system.restartSystemDoh'),internetFix:act('system.internetFix'),readClipboard:async()=>'',pickFile:async()=>null,onSpeedtestProgress:noop,cancelSpeedtest:act('system.cancelSpeedtest')},
  zapret:{status:read('zapret.status',()=>lab.zapret),listProfiles:async()=>[{name:'general (EGOIST MIX)',fileName:'general (EGOIST MIX).bat'},{name:'general'}],getUserLists:read('zapret.getUserLists',()=>lab.lists),saveUserLists:act('zapret.saveUserLists',lists=>{lab.lists=clone(lists);return {ok:true}}),onAutoSelectProgress:noop},
  telegramProxy:{status:read('telegram.status',()=>lab.telegram),tailLogs:async()=>[],saveConfig:act('telegramProxy.saveConfig',c=>{lab.telegram.config=c;return {ok:true}}),start:act('telegramProxy.start',()=>{lab.telegram.running=true;lab.shield.telegramRunning=true;return {ok:true,running:true}}),stop:act('telegramProxy.stop',()=>{lab.telegram.running=false;lab.shield.telegramRunning=false;return {ok:true,running:false}}),openLink:act('telegramProxy.openLink'),openLogs:act('telegramProxy.openLogs'),checkUpdates:act('telegramProxy.checkUpdates'),installService:act('telegramProxy.installService'),removeService:act('telegramProxy.removeService')},
  health:{getReport:async()=>({})},network:{inspect:async()=>({}),plan:act('network.plan'),approve:act('network.approve'),apply:act('network.apply'),rollback:act('network.rollback'),verify:act('network.verify'),diagnose:act('network.diagnose')},logs:{getRuntimeSummary:async()=>[],openFolder:act('logs.openFolder')},diagnostics:{exportBundle:act('diagnostics.exportBundle')},
  updater:{getLastResult:async()=>null,check:async()=>({ok:true,phase:'up-to-date',currentVersion:'3.8.0'}),setAuto:act('updater.setAuto'),checkAndInstall:act('updater.checkAndInstall',()=>({ok:true,phase:'up-to-date'})),openReleasePage:act('updater.openReleasePage'),onUpdateAvailable:noop,onDownloadProgress:noop,onUpdateDownloaded:noop,onUpdateNotAvailable:noop,onUpdateError:noop},traffic:{onUpdate:noop},autoConnect:{onAutoConnect:noop},subscription:{refreshAll:act('subscription.refreshAll'),deleteById:act('subscription.deleteById')},import:{text:act('import.text')}
 };
 for(const method of extraMethods){const [ns,name]=method.split('.');window.egoistAPI[ns]??={};window.egoistAPI[ns][name]??=act(method);}
 // These are deliberately inert, schema-shaped acknowledgements with fresh
 // readback. They model renderer contracts, never Windows or network success.
 window.egoistAPI.state.patchRules=act('state.patchRules',(patch,revision)=>{
  if(revision!==lab.state.stateRevision)throw new Error('Fixture revision conflict');
  for(const key of Object.keys(patch)){if(!['domainRules','processRules'].includes(key))throw new Error('Unexpected fixture rule key');lab.state[key]=clone(patch[key]);}
  lab.state.stateRevision++;return {ok:true,state:lab.state};
 });
 window.egoistAPI.node.setFavorite=act('node.setFavorite',(id,favorite)=>{const node=lab.state.nodes.find(n=>n.id===id);if(!node)throw new Error('Unknown fixture node');node.metadata={...node.metadata,favorite:String(favorite)};lab.state.stateRevision++;return {ok:true,state:lab.state};});
 const vpnService=(installed,running)=>Object.assign(lab.vpnService,{serviceInstalled:installed,serviceRunning:running,running,backgroundEnabled:running,serviceState:running?'running':installed?'stopped':'not-installed'});
 Object.assign(window.egoistAPI.vpn,{
  serviceInstall:act('vpn.serviceInstall',id=>{if(id!==lab.state.activeNodeId)throw new Error('Unknown fixture VPN target');vpnService(true,true);return {ok:true};}),
  serviceStart:act('vpn.serviceStart',()=>{vpnService(true,true);return {ok:true};}),
  serviceStop:act('vpn.serviceStop',()=>{vpnService(true,false);return {ok:true};}),
  serviceRemove:act('vpn.serviceRemove',()=>{vpnService(false,false);return {ok:true};}),
 });
 Object.assign(window.egoistAPI.system,{
  dnsControllerStatus:read('system.dnsControllerStatus',()=>({mode:lab.manualServers.length?'manual':'system-default',currentServers:lab.manualServers})),
  readClipboard:read('system.readClipboard',()=>lab.clipboard),
  dnsDiagnostics:read('system.dnsDiagnostics',()=>({targets:[{host:'api.openai.com',label:'OpenAI',ok:true,dnsMs:12,pingMs:25}],summary:{total:1,okCount:1,averagePingMs:25,averageDnsMs:12}})),
  applySystemDoh:act('system.applySystemDoh',url=>{Object.assign(lab.doh,{running:true,verified:true,resolutionVerified:true,currentUrl:url});Object.assign(lab.shield,{dnsRunning:true,dnsHealthState:'ready'});return {ok:true,running:true,verified:true};}),
  setDnsServers:act('system.setDnsServers',value=>{lab.manualServers=value.split(/\r?\n/).filter(Boolean);return {ok:true};}),
  resetDnsServers:act('system.resetDnsServers',()=>{lab.manualServers=[];return {ok:true};}),
  internetFix:act('system.internetFix',()=>{lab.effects.internetFix=(lab.effects.internetFix??0)+1;return {ok:true};}),
 });
 Object.assign(window.egoistAPI.zapret,{
  startStandalone:act('zapret.startStandalone',profile=>{Object.assign(lab.zapret,{standaloneRunning:true,runtimeReady:true,standaloneProfile:profile,currentProfile:profile});return {ok:true,...lab.zapret};}),
  installService:act('zapret.installService',profile=>{Object.assign(lab.zapret,{serviceInstalled:true,serviceRunning:true,runtimeReady:true,serviceProfile:profile,currentProfile:profile});return {ok:true,...lab.zapret};}),
  removeService:act('zapret.removeService',()=>{Object.assign(lab.zapret,{serviceInstalled:false,serviceRunning:false,standaloneRunning:false,runtimeReady:false});return {ok:true};}),
  cleanDiscordCache:act('zapret.cleanDiscordCache',scope=>{lab.effects.discordCacheScope=scope;return {ok:true};}),
  resetNetworkState:act('zapret.resetNetworkState',()=>{Object.assign(lab.zapret,{serviceRunning:false,standaloneRunning:false,runtimeReady:false});return {ok:true};}),
  checkUpdates:act('zapret.checkUpdates',()=>({releaseVerified:true,updateAvailable:false,currentVersion:'5.4.0',latestVersion:'5.4.0'})),
 });
 Object.assign(window.egoistAPI.telegramProxy,{
  saveConfig:act('telegramProxy.saveConfig',config=>{lab.telegram.config=clone(config);return {ok:true,...lab.telegram};}),
  installService:act('telegramProxy.installService',()=>{Object.assign(lab.telegram,{serviceInstalled:true,serviceRunning:true,running:true});return {ok:true,...lab.telegram};}),
  removeService:act('telegramProxy.removeService',()=>{Object.assign(lab.telegram,{serviceInstalled:false,serviceRunning:false,running:false});return {ok:true};}),
 });
 window.egoistAPI.updater.setAuto=act('updater.setAuto',enabled=>{lab.state.settings.autoUpdate=enabled;lab.state.stateRevision++;return {ok:true};});
 window.egoistAPI.diagnostics.exportBundle=act('diagnostics.exportBundle',()=>({ok:true,filePath:'C:\\AuditFixture\\diagnostics.zip'}));
}
const report={schemaVersion:1,complete:false,compiledSha256:crypto.createHash('sha256').update(compiled).digest('hex'),cssSha256:crypto.createHash('sha256').update(css).digest('hex'),checks:[],pageErrors:[],blockedRequests:[],controls:[],limitations:['Isolated headless Edge with inert IPC fixture; no installed app, services, real network or persistence outside browser profile.','Memory compilation uses production renderer composition; no package build outputs mutated.']};
let browser;
async function context(viewport){
 const ctx=await browser.newContext({viewport,reducedMotion:'reduce',serviceWorkers:'block'});
 await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==origin){report.blockedRequests.push(u.href);return route.abort()};if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><link rel="stylesheet" href="/all.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'});if(u.pathname==='/all.css')return route.fulfill({contentType:'text/css',body:css});if(u.pathname==='/app.js')return route.fulfill({contentType:'text/javascript',body:compiled});if(u.pathname.includes('/fonts/')){const n=path.basename(u.pathname),match=/^(manrope|unbounded)-(latin|cyrillic|cyrillic-ext)\.woff2$/.exec(n);if(match)return route.fulfill({body:await fs.readFile(path.join(project,'node_modules','@fontsource-variable',match[1],'files',`${match[1]}-${match[2]}-wght-normal.woff2`)),contentType:'font/woff2'})};return route.fulfill({status:404,body:''})});
 await ctx.addInitScript(fixture,{extraMethods:[...preload.matchAll(/\t(\w+): \{([\s\S]*?)\n\t\}/g)].flatMap(m=>[...m[2].matchAll(/\t\t(\w+):.*?invoke\(/g)].map(v=>m[1]+'.'+v[1]))});return ctx;
}
async function check(id,viewport,fn){
 if(process.env.UI_AUDIT_CASE_FILTER&&!new RegExp(process.env.UI_AUDIT_CASE_FILTER).test(id))return;
 const ctx=await context(viewport),page=await ctx.newPage();page.setDefaultTimeout(5000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const record={id,viewport,status:'running'};report.checks.push(record);let baseline;
 try{
  await page.goto(origin);await page.getByRole('button',{name:'Компоненты при подключении'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.shield-widget-container')?.dataset.phase==='idle');
  baseline=await mark(page);await fn(page,record);await idle(page);assert.deepEqual(errors,[]);record.status='passed';
 }catch(e){record.status='failed';record.error=e.stack??String(e);}
 finally{
  record.calls=await page.evaluate(()=>lab.calls).catch(()=>[]);
  if(baseline){try{record.scenarioObservation=await observation(page,baseline);}catch(error){record.observationError=String(error);}}
  report.pageErrors.push(...errors.map(message=>({id,message})));
  await page.screenshot({path:path.join(evidence,id+'.png')}).catch(()=>{});await ctx.close();
  console.log(record.status.toUpperCase()+' '+id+(record.error?' '+record.error.split('\n')[0]:''));await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));
 }
}
async function bounds(page){return page.locator('[role="group"][aria-label="Компоненты при следующем подключении"]').evaluate(el=>{const r=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect(),f=document.querySelector('.shield-widget-footer').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,footerTop:f.top,triggerTop:p.top,innerWidth,innerHeight,scroll:el.scrollHeight,client:el.clientHeight}})}
const screenLabels={dashboard:'Обзор',vpn:'Соединение',dns:'DNS',zapret:'Профили','telegram-proxy':'Telegram',settings:'Настройки'};
const protectedConfirmations={
 'dashboard:Восстановить интернет':'system.internetFix','vpn:VPN без приложения (TUN)':'vpn.serviceInstall',
 'dns:Установить':'system.setDnsServers','dns:Сбросить':'system.resetDnsServers','dns:Отключить DoH':'system.resetSystemDoh',
 'zapret:Запустить':'zapret.startStandalone','zapret:Служба':'zapret.installService','zapret:Удалить службу':'zapret.removeService','zapret:Кэш Discord':'zapret.cleanDiscordCache','zapret:Сброс WinWS':'zapret.resetNetworkState',
 'telegram-proxy:Удалить':'telegramProxy.removeService','settings:Добавить правило домена VPN':'state.patchRules','settings:Добавить правило процесса VPN':'state.patchRules',
};
const expectedDispatch={
 'dashboard:Подключить VPN':[['vpn.connect',['node-1']]],'dashboard:DNS':[['system.applySystemDoh',['https://dns.example.test/query']]],'dashboard:Запрет':[['zapret.startStandalone',['general (EGOIST MIX)']]],'dashboard:Telegram':[['telegramProxy.start',[]]],
 'dashboard:Проверить':[['system.routeProbe',[]],['system.dnsLeakTest',[]]],'dashboard:Измерить скорость':[['system.speedtest',[]],['system.cancelSpeedtest',[]]],
 'vpn:Добавить Test server в избранное':[['node.setFavorite',['node-1',true]]],'vpn:Test server Страна не определена · VLESS':[['node.select',['node-1']]],'vpn:Подключить':[['vpn.connect',['node-1']]],'vpn:Обновить подписку':[['subscription.refreshAll',[]]],
 'dns:Подключить ссылку':[['system.applySystemDoh',['https://dns.example.test/query']]],
 'zapret:Автоподбор':[['zapret.autoSelect',[]]],'zapret:Сохранить и применить':[['zapret.saveUserLists',[{generalDomains:[],includedCidrs:[],excludedDomains:[],excludedCidrs:[]}]]],'zapret:Обновить IPSet':[['zapret.updateIpsetList',[]]],'zapret:Обновить Flowseal Core':[['zapret.checkUpdates',[]]],
 'telegram-proxy:Переустановить службу':[['telegramProxy.installService',[]]],'telegram-proxy:Запустить':[['telegramProxy.start',[]]],'telegram-proxy:Добавить в приложение':[['telegramProxy.openLink',[]]],'telegram-proxy:Проверить обновление':[['telegramProxy.checkUpdates',[]]],'telegram-proxy:Открыть':[['telegramProxy.openLogs',[]]],
 'settings:Автообновление':[['updater.setAuto',[true]]],'settings:Проверить и установить':[['updater.checkAndInstall',[]]],'settings:Открыть папку с логами':[['logs.openFolder',[]]],'settings:Экспортировать диагностику':[['diagnostics.exportBundle',[]]],
};
for(const [label,key,value] of [['Запуск при входе в Windows','autoStart',true],['Сворачивать в трей','minimizeToTray',true],['Автоподключение','autoConnect',true],['Переподключаться при обрыве','reconnectOnDrop',false],['Показывать уведомления','notifications',false],['Передавать ID устройства','sendSubscriptionHwid',true]])expectedDispatch['settings:'+label]=[['state.patchSettings',[{[key]:value},1]]];
const presetValues={'CloudflareПубличный DNS':['1.1.1.1','1.0.0.1'],'Google DNSПубличный DNS':['8.8.8.8','8.8.4.4'],'Quad9Публичный DNS':['9.9.9.9','149.112.112.112'],'AdGuardФильтрация':['94.140.14.14','94.140.15.15']};
const idle=page=>page.waitForFunction(()=>!document.querySelector('.app-shell')?.dataset.busy,null,{timeout:3000});
async function observation(page,before){return page.evaluate(before=>({calls:lab.calls.slice(before.calls),readCalls:lab.readCalls.slice(before.readCalls),reads:Object.fromEntries(Object.entries(lab.reads).map(([key,count])=>[key,count-(before.reads[key]??0)]).filter(([,count])=>count>0)),screen:document.querySelector('.screen-stage')?.dataset.screen,widget:!!document.querySelector('.shield-widget-container'),alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent)}),before);}
const mark=page=>page.evaluate(()=>({calls:lab.calls.length,readCalls:lab.readCalls.length,reads:{...lab.reads}}));
async function assertGenericAction(page,record,entry,control,target,beforeChecked){
 const key=entry.screen+':'+control.label,seen=record.observed;
 const noMutation=()=>assert.deepEqual(seen.calls,[],'UI/read-only control must not mutate components');
 if(protectedConfirmations[key]){assert.equal(record.confirmationCancelled,true);assert.equal(await page.getByRole('dialog').count(),0);noMutation();record.assertionScope='confirmation-cancelled';return;}
 if(control.index<=11){
  if(control.index===1){assert.deepEqual(seen.calls,[{name:'window.setWidgetMode',args:[true]}]);assert.equal(seen.widget,true);}
  else if(control.index>=2&&control.index<=4)assert.deepEqual(seen.calls,[{name:['window.minimize','window.toggleMaximize','window.close'][control.index-2],args:[]}]);
  else{noMutation();if(control.index===11){assert.match(record.dialogText,/О приложении/);assert.match(record.dialogText,new RegExp(version.replaceAll('.','\\.')));assert.equal(await page.getByRole('dialog').count(),0);}else assert.equal(seen.screen,control.index===0?'dashboard':Object.keys(screenLabels)[control.index-5]);}
  record.assertionScope='window-or-navigation';return;
 }
 if(expectedDispatch[key]){
  assert.deepEqual(seen.calls.map(call=>[call.name,call.args]),expectedDispatch[key],key+' dispatch/payload');
  if(control.role==='switch')assert.equal(await target.getAttribute('aria-checked'),beforeChecked==='true'?'false':'true');
  record.assertionScope='ipc-dispatch-and-payload';return;
 }
 noMutation();record.assertionScope='read-or-local-ui';
 if(control.label.startsWith('Настроить ')){assert.equal(seen.screen,({'Настроить DNS':'dns','Настроить Запрет':'zapret','Настроить Telegram':'telegram-proxy'})[control.label]);return;}
 if(control.label.startsWith('Пояснение: ')){assert.equal(await target.getAttribute('aria-expanded'),'true');assert.ok(await page.getByRole('tooltip').count());return;}
 if(presetValues[control.label]){assert.deepEqual(await page.locator('.dns-inputs-row input').evaluateAll(els=>els.map(el=>el.value)),presetValues[control.label]);return;}
 if(entry.screen==='zapret'&&control.label.startsWith('general')){assert.ok((await target.getAttribute('class')).split(' ').includes('active'));return;}
 if(control.role==='tab'){assert.equal(await target.getAttribute('aria-selected'),'true');await page.locator('#'+await target.getAttribute('aria-controls')).waitFor();return;}
 if(control.label==='Test server'){assert.match(record.dialogText,/Выберите сервер/);assert.equal(await page.getByRole('dialog').count(),0);return;}
 if(control.label==='Подробный журнал'||control.label==='Проверять обновления runtime'){assert.equal(await target.getAttribute('aria-checked'),beforeChecked==='true'?'false':'true');return;}
 if(control.label==='Импорт'||control.label==='Вставить'){
  assert.ok(seen.reads['system.readClipboard']>=1,'clipboard read must occur');
  if(control.label==='Вставить')assert.equal(await page.locator('.dns-link-input').inputValue(),'');
  else await page.getByText(/Буфер обмена пуст/).first().waitFor();
  return;
 }
 if(control.label==='Проверить DNS'){assert.ok(seen.reads['system.dnsDiagnostics']>=1);await page.getByText('1/1',{exact:true}).waitFor();return;}
 if(control.label==='Перепроверить конфигурацию'){assert.ok(seen.reads['telegramProxy.status']>=1);assert.equal(await target.isDisabled(),false);return;}
 throw new Error('No meaningful assertion is defined for '+key);
}
report.limitations.push('Generic controls assert local UI effects, cancellation or exact IPC dispatch/payload. Inert fixture readback is not proof of backend persistence, Windows service operation, network health, archive creation or an actual update installation. Conditional update, subscription deletion, pagination and other non-baseline branches are not all exercised by this renderer matrix.');
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.UI_BROWSER_EXE||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',args:['--no-first-run','--disable-background-networking','--disable-component-update']});
 for(const viewport of [{width:220,height:220},{width:240,height:250},{width:280,height:250},{width:300,height:250},{width:300,height:370},{width:320,height:300},{width:360,height:400},{width:420,height:500}])for(const state of ['idle','error','busy'])await check(`widget-${viewport.width}x${viewport.height}-${state}`,viewport,async(page,r)=>{
 if(state!=='idle'){await page.evaluate(s=>{lab.shield={...lab.shield,...(s==='error'?{error:'Не удалось подтвердить работу DNS. Настройки сохранены.'}:{busy:true,phase:'preparing',progress:50})};lab.listeners['shield.progress']?.(lab.shield)},state)}
 r.widgetLayout=await page.evaluate(()=>{const rect=s=>{const e=document.querySelector(s),r=e?.getBoundingClientRect();return r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}:null};return {header:rect('.shield-widget-header'),trigger:rect('.shield-interactive-trigger'),status:rect('.shield-widget-status-group'),error:rect('.shield-widget-error'),preferences:rect('.shield-on-connect-preferences'),footer:rect('.shield-widget-footer'),cancel:rect('.shield-cancel'),height:innerHeight,width:innerWidth}});assert.ok(r.widgetLayout.trigger.top>=r.widgetLayout.header.bottom-.5,'shield trigger must not overlap header');assert.ok(r.widgetLayout.status.bottom<=(r.widgetLayout.error?.top??r.widgetLayout.preferences.top)+.5,'status must not overlap error or preferences');assert.ok(r.widgetLayout.footer.bottom<=viewport.height+.5,'footer not clipped');const trigger=page.getByRole('button',{name:'Компоненты при подключении'});await trigger.click();assert.equal(await trigger.getAttribute('aria-expanded'),'true');const dns=page.getByRole('checkbox',{name:'DNS при подключении'}),tg=page.getByRole('checkbox',{name:'Telegram при подключении'});await dns.waitFor();assert.equal(await dns.evaluate(el=>el===document.activeElement),true);r.panel=await bounds(page);assert.ok(r.panel.y>=0&&r.panel.x>=0&&r.panel.right<=viewport.width+.5&&r.panel.bottom<=r.panel.footerTop+.5,'panel fits/clipping-free and does not overlap footer');await page.keyboard.press('Tab');assert.equal(await tg.evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Space');assert.equal(await tg.isChecked(),false);await page.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);await trigger.click();await page.locator('.shield-widget-brand').click();assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await page.getByRole('switch',{name:'Telegram Proxy'}).getAttribute('aria-checked'),'false');assert.equal(await page.evaluate(()=>lab.calls.filter(c=>!c.name.startsWith('window.')).length),0);
 });
 await check('widget-preferences-current-connect-persist',{width:320,height:300},async(page)=>{await page.getByRole('button',{name:'Компоненты при подключении'}).click();await page.getByRole('checkbox',{name:'DNS при подключении'}).uncheck();await page.keyboard.press('Escape');await page.getByRole('button',{name:'Подключить профиль DPI и выбранные компоненты'}).click();await page.waitForFunction(()=>lab.calls.some(c=>c.name==='shield.connect'));assert.deepEqual(await page.evaluate(()=>lab.calls.find(c=>c.name==='shield.connect').args[0]),{dnsEnabled:false,telegramEnabled:true});await page.reload();await page.getByRole('button',{name:'Компоненты при подключении'}).click();assert.equal(await page.getByRole('checkbox',{name:'DNS при подключении'}).isChecked(),false);assert.equal(await page.getByRole('checkbox',{name:'Telegram при подключении'}).isChecked(),true)});
 for(const viewport of [{width:1000,height:700},{width:1440,height:940}])for(const [screen,label]of Object.entries({dashboard:'Обзор',vpn:'Соединение',dns:'DNS',zapret:'Профили','telegram-proxy':'Telegram',settings:'Настройки'}))await check(`page-${screen}-${viewport.width}`,viewport,async(page,r)=>{await page.getByRole('button',{name:'Настройки',exact:true}).click();if(screen!=='settings')await page.getByRole('button',{name:label,exact:true}).click();await page.waitForFunction(s=>document.querySelector('.screen-stage')?.dataset.screen===s,screen);r.controls=await page.locator('button,input,select,textarea').evaluateAll(els=>els.filter(e=>e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0).map((e,index)=>({index,tag:e.tagName,type:e.type,label:e.getAttribute('aria-label')||e.textContent?.trim()||e.placeholder||'',role:e.getAttribute('role'),disabled:e.disabled,checked:e.checked,value:e.value,rect:{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}})));report.controls.push({screen,viewport,controls:r.controls});r.horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(r.horizontalOverflow,false,'no document horizontal overflow')});

 if(process.env.UI_AUDIT_ACTIONS==='1'){
  const labels={dashboard:'Обзор',vpn:'Соединение',dns:'DNS',zapret:'Профили','telegram-proxy':'Telegram',settings:'Настройки'};
  const go=async(page,screen)=>{await page.getByRole('button',{name:'Настройки',exact:true}).click();if(screen!=='settings')await page.getByRole('button',{name:labels[screen],exact:true}).click();await page.waitForFunction(s=>document.querySelector('.screen-stage')?.dataset.screen===s,screen)};

  const expand=async(page,screen)=>{if(screen==='zapret')await page.getByRole('tab',{name:'Маршруты',exact:true}).click();for(const summary of await page.locator('details>summary').all())if(await summary.isVisible()&&!await summary.evaluate(el=>el.parentElement.open))await summary.click()};
  for(const screen of ['telegram-proxy','settings','zapret'])await check(`expanded-${screen}`,{width:1440,height:940},async(page,r)=>{await go(page,screen);await expand(page,screen);r.controls=await page.locator('button,input,select,textarea').evaluateAll(els=>els.filter(e=>e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0).map((e,index)=>({index,tag:e.tagName,type:e.type,label:e.getAttribute('aria-label')||e.textContent?.trim()||e.placeholder||'',role:e.getAttribute('role'),disabled:e.disabled,checked:e.checked,value:e.value})));report.controls.push({screen,viewport:{width:1440,height:940},expanded:true,controls:r.controls});});
  // Each baseline button gets a fresh isolated renderer. Conditional controls remain explicit scenarios in inventory.
  for(const entry of report.controls.filter(v=>v.viewport.width===1440))for(const control of entry.controls.filter(v=>v.tag==='BUTTON')){
   await check(`action-${entry.expanded?'expanded-':''}${entry.screen}-${control.index}`,{width:1440,height:940},async(page,r)=>{
    await go(page,entry.screen);if(entry.expanded)await expand(page,entry.screen);
    await page.locator('button,input,select,textarea').evaluateAll(els=>{let i=0;for(const e of els)if(e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0)e.setAttribute('data-lab-control',String(i++))});
    const target=page.locator(`[data-lab-control="${control.index}"]`);r.control=control;
    const before=await mark(page),beforeChecked=await target.getAttribute('aria-checked');
    if(await target.isDisabled()){
     const reasons={'vpn:Удалить подписку':'No selected subscription exists in this fixture.','settings:Сохранить настройки VPN':'The verified settings draft has no changes.'};
     r.disabledReason=reasons[entry.screen+':'+control.label];assert.ok(r.disabledReason,'Unclassified disabled control');
     r.observed=await observation(page,before);assert.deepEqual(r.observed.calls,[]);assert.equal(await target.isDisabled(),true);r.disabledPreserved=true;r.assertionScope='disabled-precondition';return;
    }
    await target.click();
    const dialog=page.getByRole('dialog');
    if(await dialog.count()&&await dialog.isVisible()){
      r.dialogText=await dialog.innerText();
      const buttons=dialog.locator('button:not(:disabled)');
      if(await buttons.count()){const cancel=buttons.filter({hasText:/Отмена|Закрыть/});if(await cancel.count())await cancel.first().click();else await page.keyboard.press('Escape');r.confirmationCancelled=true;}
    }
    await idle(page);
    r.observed=await observation(page,before);
    await assertGenericAction(page,r,entry,control,target,beforeChecked);
   });
  }
  for(const [state,label,tone,activeConnections] of [['degraded','Есть ошибки маршрута','warn',2],['error','Маршрут недоступен','bad',0]])await check(`telegram-route-${state}-local-ready`,{width:1000,height:700},async(page,r)=>{await page.evaluate(({state,activeConnections})=>{Object.assign(lab.telegram,{running:true,serviceRunning:true,runtimeReady:true,listenerReady:true,health:{route:{state,mode:'cloudflare',activeConnections,totalConnections:3,successfulFallbackConnections:2}}})},{state,activeConnections});await go(page,'telegram-proxy');await page.getByRole('button',{name:'Перепроверить конфигурацию',exact:true}).click();const chip=page.locator('.telegram-status-chip').filter({hasText:'Маршрут'});await chip.getByText(label,{exact:true}).waitFor();assert.ok(await chip.locator(`.dot.${tone}`).count(),`Actual route ${state} uses ${tone} tone`);await page.locator('.telegram-status-chip').filter({hasText:'Прокси'}).getByText('работает',{exact:true}).waitFor();r.route={state,label,tone,activeConnections};});
  await check('action-dns-doh-payload-and-live-readback',{width:1000,height:700},async(page,r)=>{await go(page,'dns');await page.locator('.screen-stage textarea').fill('https://resolver.example.test/dns-query');await page.getByRole('button',{name:'Подключить ссылку',exact:true}).click();await page.waitForFunction(()=>lab.calls.some(c=>c.name==='system.applySystemDoh'));assert.deepEqual(await page.evaluate(()=>lab.calls.find(c=>c.name==='system.applySystemDoh').args),['https://resolver.example.test/dns-query']);await page.waitForFunction(()=>!document.querySelector('.app-shell')?.dataset.busy);await page.getByRole('button',{name:'Отключить DoH',exact:true}).click();assert.equal(await page.evaluate(()=>lab.calls.some(c=>c.name==='system.resetSystemDoh')),false);await page.getByRole('dialog').getByRole('button',{name:/Отключить/}).click();await page.waitForFunction(()=>lab.calls.some(c=>c.name==='system.resetSystemDoh'));assert.equal(await page.evaluate(()=>lab.doh.running),false)});
  await check('action-zapret-selected-profile-confirmation',{width:1000,height:700},async(page,r)=>{await go(page,'zapret');await page.locator('.config-row').last().click();await page.getByTestId('zapret-service-start').click();assert.equal(await page.evaluate(()=>lab.calls.some(c=>c.name==='zapret.installService')),false);const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Запустить',exact:true}).click();await page.waitForFunction(()=>lab.calls.some(c=>c.name==='zapret.installService'));assert.deepEqual(await page.evaluate(()=>lab.calls.find(c=>c.name==='zapret.installService').args),['general'])});
  const confirmedActions=[
   {id:'internet-restore',screen:'dashboard',button:'Восстановить интернет',confirm:'Восстановить',method:'system.internetFix',args:[]},
   {id:'manual-dns-apply',screen:'dns',button:'Установить',confirm:'Установить',method:'system.setDnsServers',args:['1.1.1.1\n8.8.8.8']},
   {id:'manual-dns-reset',screen:'dns',button:'Сбросить',confirm:'Сбросить',method:'system.resetDnsServers',args:[]},
   {id:'vpn-service-install',screen:'vpn',role:'switch',button:'VPN без приложения (TUN)',confirm:'Установить и включить',method:'vpn.serviceInstall',args:['node-1']},
   {id:'zapret-standalone',screen:'zapret',testId:'zapret-start',confirm:'Запустить',method:'zapret.startStandalone',args:['general']},
   {id:'zapret-service-remove',screen:'zapret',testId:'zapret-remove',confirm:'Удалить',method:'zapret.removeService',args:[]},
   {id:'discord-cache-all',screen:'zapret',testId:'zapret-clean-cache',confirm:'Очистить',method:'zapret.cleanDiscordCache',args:['all']},
   {id:'zapret-runtime-reset',screen:'zapret',testId:'zapret-reset',confirm:'Сбросить',method:'zapret.resetNetworkState',args:[]},
   {id:'telegram-service-remove',screen:'telegram-proxy',button:'Удалить',confirm:'Удалить',method:'telegramProxy.removeService',args:[]},
  ];
  for(const spec of confirmedActions)await check('confirmed-'+spec.id,{width:1000,height:700},async(page,r)=>{
   await page.evaluate(id=>{
    if(id==='manual-dns-reset')lab.manualServers=['198.51.100.53'];
    if(id==='zapret-service-remove'||id==='zapret-runtime-reset')Object.assign(lab.zapret,{serviceInstalled:true,serviceRunning:true,standaloneRunning:id==='zapret-runtime-reset',runtimeReady:true});
    if(id==='telegram-service-remove')Object.assign(lab.telegram,{serviceInstalled:true,serviceRunning:true,running:true});
   },spec.id);
   await go(page,spec.screen);if(spec.id==='zapret-standalone')await page.locator('.config-row').last().click();
   const before=await mark(page),dnsBefore=await page.evaluate(()=>({manualServers:lab.manualServers,doh:lab.doh,url:lab.state.settings.systemDohUrl}));
   await (spec.testId?page.getByTestId(spec.testId):page.getByRole(spec.role??'button',{name:spec.button,exact:true})).click();
   const dialog=page.getByRole('dialog');await dialog.waitFor();r.dialogText=await dialog.innerText();
   assert.deepEqual((await observation(page,before)).calls,[],'Protected command must wait for confirmation');
   await dialog.getByRole('button',{name:spec.confirm,exact:true}).click();
   await page.waitForFunction(({method,start})=>lab.calls.slice(start).some(call=>call.name===method),{method:spec.method,start:before.calls});
   await idle(page);assert.equal(await page.getByRole('dialog').count(),0);
   r.observed=await observation(page,before);assert.deepEqual(r.observed.calls,[{name:spec.method,args:spec.args}]);r.assertionScope='confirmed-inert-ipc-and-readback';
   const actual=await page.evaluate(()=>({manualServers:lab.manualServers,doh:lab.doh,url:lab.state.settings.systemDohUrl,vpnService:lab.vpnService,zapret:lab.zapret,telegram:lab.telegram,effects:lab.effects}));
   if(spec.id==='internet-restore'){assert.equal(actual.effects.internetFix,1);assert.deepEqual({manualServers:actual.manualServers,doh:actual.doh,url:actual.url},dnsBefore);}
   if(spec.id==='manual-dns-apply')assert.deepEqual(actual.manualServers,['1.1.1.1','8.8.8.8']);
   if(spec.id==='manual-dns-reset')assert.deepEqual(actual.manualServers,[]);
   if(spec.id==='vpn-service-install'){assert.equal(actual.vpnService.running,true);assert.equal(actual.vpnService.backgroundEnabled,true);assert.ok(r.observed.reads['vpn.serviceStatus']>=1);await page.locator('.vpn-background-status strong').getByText('Работает',{exact:true}).waitFor();}
   if(spec.id==='zapret-standalone'){assert.equal(actual.zapret.standaloneRunning,true);assert.equal(actual.zapret.standaloneProfile,'general');assert.ok(r.observed.reads['zapret.status']>=1);}
   if(spec.id==='zapret-service-remove'){assert.equal(actual.zapret.serviceInstalled,false);assert.equal(actual.zapret.serviceRunning,false);}
   if(spec.id==='discord-cache-all')assert.equal(actual.effects.discordCacheScope,'all');
   if(spec.id==='zapret-runtime-reset'){assert.equal(actual.zapret.serviceRunning,false);assert.equal(actual.zapret.standaloneRunning,false);}
   if(spec.id==='telegram-service-remove'){assert.equal(actual.telegram.serviceInstalled,false);assert.equal(actual.telegram.running,false);assert.equal(await page.getByRole('button',{name:'Удалить',exact:true}).isDisabled(),true);}
  });
  await check('settings-vpn-dirty-save-payload',{width:1000,height:700},async(page,r)=>{
   await go(page,'settings');await expand(page,'settings');
   const before=await mark(page);await page.getByRole('combobox',{name:'Режим маршрутизации VPN'}).selectOption('selected');
   const button=page.getByRole('button',{name:'Сохранить настройки VPN',exact:true});assert.equal(await button.isDisabled(),false);await button.click();
   await page.waitForFunction(()=>lab.state.settings.routeMode==='selected');await idle(page);
   r.observed=await observation(page,before);assert.deepEqual(r.observed.calls,[{name:'state.patchSettings',args:[{routeMode:'selected'},1]}]);
   await page.locator('.ruby-network-message').filter({hasText:'Сохранено.'}).waitFor();assert.equal(await button.isDisabled(),true);r.assertionScope='settings-cas-payload-and-rendered-save';
  });
  await check('settings-domain-and-process-rule-save-payloads',{width:1000,height:700},async(page,r)=>{
   await go(page,'settings');await expand(page,'settings');r.ruleSteps=[];
   for(const [kind,target,mode,revision]of [['domain','rule.example.test','vpn',1],['process','browser.exe','direct',2]]){
    const before=await mark(page),key=kind==='domain'?'domainRules':'processRules';
    await page.getByRole('button',{name:kind==='domain'?'Добавить правило домена VPN':'Добавить правило процесса VPN',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.locator('input').fill(target);await dialog.getByRole('combobox',{name:'Действие правила VPN'}).selectOption(mode);
    assert.deepEqual((await observation(page,before)).calls,[]);await dialog.getByRole('button',{name:'Сохранить правило',exact:true}).click();
    await page.waitForFunction(key=>lab.state[key].length===1,key);await idle(page);assert.equal(await page.getByRole('dialog').count(),0);
    const seen=await observation(page,before);assert.equal(seen.calls.length,1);assert.equal(seen.calls[0].name,'state.patchRules');
    const [patch,expectedRevision]=seen.calls[0].args;assert.equal(expectedRevision,revision);assert.deepEqual(Object.keys(patch),[key]);assert.equal(patch[key].length,1);
    const rule=patch[key][0];assert.match(rule.id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);assert.deepEqual(rule,{id:rule.id,[kind==='domain'?'domain':'process']:target,mode});
    await page.getByRole('button',{name:'Изменить правило '+target,exact:true}).waitFor();r.ruleSteps.push({kind,target,mode,expectedRevision,observed:seen});
   }
   const state=await page.evaluate(()=>lab.state);assert.equal(state.domainRules.length,1);assert.equal(state.processRules.length,1);assert.equal(state.stateRevision,3);r.assertionScope='rule-cas-payload-and-rendered-rows';
  });
 }

 await check('widget-focus-storage-failure',{width:300,height:370},async(page,r)=>{await page.getByRole('button',{name:'Компоненты при подключении'}).click();await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='shield_dns_on_connect')throw new Error('fixture blocked storage');return original.call(this,key,value)}});await page.getByRole('checkbox',{name:'DNS при подключении'}).click();assert.equal(await page.getByRole('checkbox',{name:'DNS при подключении'}).isChecked(),true);await page.getByRole('alert').filter({hasText:'Не удалось сохранить выбор'}).waitFor();assert.equal(await page.evaluate(()=>lab.calls.some(c=>!c.name.startsWith('window.'))),false)});
 await check('widget-focus-stale-status-future-preferences',{width:300,height:250},async(page,r)=>{await page.evaluate(()=>lab.listeners['shield.progress']?.({statusError:'fixture unavailable',running:false,dnsRunning:false,telegramRunning:false}));assert.equal(await page.locator('.shield-interactive-trigger').isDisabled(),true);assert.equal(await page.getByRole('switch',{name:'Зашифрованный DNS'}).isDisabled(),true);await page.getByRole('button',{name:'Компоненты при подключении'}).click();await page.getByRole('checkbox',{name:'Telegram при подключении'}).uncheck();assert.equal(await page.evaluate(()=>localStorage.getItem('shield_telegram_on_connect')),'false');assert.equal(await page.evaluate(()=>lab.calls.some(c=>!c.name.startsWith('window.'))),false)});
 await check('widget-focus-loading-status-controls',{width:300,height:370},async(page,r)=>{await page.evaluate(()=>lab.listeners['shield.progress']?.({running:undefined,dnsRunning:undefined,telegramRunning:undefined,statusError:null}));await page.getByRole('button',{name:'Проверяем состояние службы'}).waitFor();assert.equal(await page.locator('.shield-interactive-trigger').isDisabled(),true);assert.equal(await page.getByRole('switch',{name:'Зашифрованный DNS'}).isDisabled(),true);assert.equal(await page.getByRole('switch',{name:'Telegram Proxy'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Компоненты при подключении'}).isDisabled(),false)});
 report.complete=true;report.testedWidgetMinimum={ordinary:{width:300,height:370},workAreaClamped:[{width:220,height:220},{width:240,height:250},{width:280,height:250},{width:300,height:250}],note:'main.js min300x370; switchWidgetMode clamps to smaller Windows work area.'};
}finally{await browser?.close();report.passed=report.checks.filter(c=>c.status==='passed').length;report.failed=report.checks.filter(c=>c.status==='failed').length;await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,errors:report.pageErrors},null,2));if(report.failed)process.exitCode=1}
