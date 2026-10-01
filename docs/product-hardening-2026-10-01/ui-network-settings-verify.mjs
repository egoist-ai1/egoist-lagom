import fs from 'node:fs/promises';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// UI acceptance uses production renderer/CSS with explicit inert IPC fixtures.
// It measures rendering and interaction only; it does not prove native services.
const root=process.env.LAGOM_UI_PROJECT_ROOT||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const work=process.env.LAGOM_UI_WORK_DIR;
if(!work||!path.isAbsolute(work))throw new Error('Set LAGOM_UI_WORK_DIR to this task work directory.');
const require=createRequire(path.join(root,'package.json'));
const {build,transform}=require('esbuild');
const {chromium}=require(process.env.LAGOM_PLAYWRIGHT_MODULE||'playwright');
await fs.mkdir(work,{recursive:true});
const glyphs={};
for(const name of (await fs.readdir(path.join(root,'src/brand/icons'))).filter(name=>name.endsWith('.svg'))){
  const svg=await fs.readFile(path.join(root,'src/brand/icons',name),'utf8');
  glyphs[name.slice(0,-4)]=[...svg.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*?)\s*\/>/g)].map(([,tag,raw])=>[tag,Object.fromEntries([...raw.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,value])=>[key.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value]))]);
}
const brandSource=(await transform('const rubyGlyphs='+JSON.stringify(glyphs)+';\n'+await fs.readFile(path.join(root,'src/brand/ShieldWidget.jsx'),'utf8')+'\n'+await fs.readFile(path.join(root,'src/brand/CompactRuby.jsx'),'utf8'),{loader:'jsx',jsxFactory:'O.createElement',jsxFragment:'O.Fragment',charset:'utf8'})).code;
let renderer=await fs.readFile(path.join(root,'src/recovered/renderer.js'),'utf8');
for(const name of ['sp','cp','lp','ap']){
  const start=renderer.indexOf('function '+name+'('),end=renderer.indexOf('\nfunction ',start+1);
  if(start<0||end<0)throw new Error('Production renderer boundary missing: '+name);
  renderer=renderer.slice(0,start)+renderer.slice(end+1);
}
renderer=renderer.replace('function op(',brandSource+'\nfunction op(');
const iconStart=renderer.indexOf('J = (e2, t2) => {'),iconEnd=renderer.indexOf('}, Y = J(',iconStart);
renderer=renderer.slice(0,iconStart)+`J = (name) => { const Icon = O.forwardRef((props,ref)=>O.createElement(RubyIcon,{...props,forwardedRef:ref,name:rubyLegacyIconNames[name],className:od('lucide','lucide-'+name,props.className)})); Icon.displayName=name; return Icon; `+renderer.slice(iconEnd);
renderer=renderer.replaceAll('V.jsx)(`button`,','V.jsx)(RubyButton,').replaceAll('V.jsxs)(`button`,','V.jsxs)(RubyButton,');
const compiled=(await transform(renderer,{loader:'js',charset:'utf8'})).code;
const motion=(await build({stdin:{contents:"export {gsap} from 'gsap';",resolveDir:root},platform:'browser',format:'iife',globalName:'ShieldMotion',bundle:true,write:false,minify:true})).outputFiles[0].contents;
const css=(await Promise.all(['tokens.css','compact-ruby.css','compact-surfaces.css','shield-widget.css','final-polish.css'].map(name=>fs.readFile(path.join(root,'src/brand',name),'utf8')))).join('\n');
const baseCss=await fs.readFile(path.join(root,'src/recovered/renderer.css'),'utf8');
const errors=[];
const fixture=`(()=>{
  window.__calls=[];window.__networkFailure=false;window.__writeFailure=false;window.__settingsConflict=false;window.__rulesConflict=false;
  const event=()=>()=>{};
  const state={stateRevision:3,nodes:[{id:'selected-node',name:'Выбранный сервер',server:'192.0.2.10',port:443,protocol:'socks',uri:'',metadata:{}}],subscriptions:[],domainRules:[],processRules:[],usageHistory:[],activeNodeId:'selected-node',settings:{routeMode:'global',dnsMode:'auto',customDnsUrl:'',useTunMode:false,autoStart:false,autoConnect:false,autoUpdate:false,minimizeToTray:false,systemDohUrl:'https://resolver.example/dns-query'}};
  window.__fixtureState=state;
  window.__background={serviceInstalled:true,serviceState:'running',backgroundEnabled:true,running:true,activeNodeId:'selected-node',activeNodeName:'Сохранённый сервер',useTunMode:true,routeProtection:'inconclusive'};
  window.__backgroundSnapshot=structuredClone({settings:state.settings,domainRules:state.domainRules,processRules:state.processRules});
  const result=()=>({ok:true,conflict:false,state:structuredClone(state),revision:state.stateRevision});
  const read=value=>async()=>{if(window.__networkFailure)throw new Error('UI fixture: Core unavailable');return structuredClone(typeof value==='function'?value():value)};
  const record=(name,method)=>async(...args)=>{window.__calls.push({name,args:structuredClone(args)});return method(...args)};
  const patch=(kind)=>record(kind==='settings'?'patchSettings':'patchRules',async(patch,revision)=>{
    if(window.__holdWrite)await new Promise(resolve=>window.__releaseWrite=resolve);
    if(window.__writeFailure)return {ok:false,conflict:false,error:'STATE_WRITE_FAILED',state:structuredClone(state),revision:state.stateRevision};
    if(window.__settingsConflict&&kind==='settings'){window.__settingsConflict=false;state.settings={...state.settings,routeMode:'global'};state.stateRevision++;}
    if(revision!==state.stateRevision)return {ok:false,conflict:true,error:'STATE_REVISION_CONFLICT',state:structuredClone(state),revision:state.stateRevision};
    if(kind==='settings')state.settings={...state.settings,...patch};else Object.assign(state,patch);
    state.stateRevision++;return result();
  });
  window.egoistAPI={
    app:{getVersion:async()=>({version:'3.8.0',buildDate:'01.10.2026'}),isAdmin:async()=>false},
    window:{setWidgetMode:async()=>{},onSwitchToWidget:event,minimize:async()=>{},close:async()=>{},toggleMaximize:async()=>{}},
    state:{get:record('get',async()=>{if(window.__rulesConflict){window.__rulesConflict=false;state.stateRevision++;}return read(state)()}),patchSettings:patch('settings'),patchRules:patch('rules')},
    shield:{status:read({running:false,dnsRunning:false,telegramRunning:false,busy:false,phase:'idle'}),onProgress:event},
    vpn:{serviceStatus:read(()=>window.__background),serviceInstall:record('serviceInstall',async nodeId=>{if(typeof nodeId!=='string')throw new Error('node ID must be a string');window.__backgroundSnapshot=structuredClone({settings:state.settings,domainRules:state.domainRules,processRules:state.processRules});window.__background={...window.__background,activeNodeId:nodeId,activeNodeName:state.nodes.find(node=>node.id===nodeId).name};return {ok:true}}),status:read({running:true,connected:true,executionMode:'background-service',temporaryRuntimeActive:false,egressVerified:false,lifecycle:'connected'})},
    zapret:{status:read({serviceInstalled:false,serviceRunning:false,runtimeReady:false}),listProfiles:async()=>[],onAutoSelectProgress:event},
    telegramProxy:{status:read({running:false,serviceInstalled:false}),tailLogs:async()=>[],onLog:event},health:{getReport:async()=>({})},network:{inspect:async()=>({})},
    system:{dnsControllerStatus:read({running:false,verified:false}),systemDohStatus:read({running:false,verified:false}),getMyIp:async()=>({ip:'203.0.113.1',provider:'UI fixture'}),onSpeedtestProgress:event},
    logs:{getRuntimeSummary:async()=>[]},traffic:{onUpdate:event},autoConnect:{onAutoConnect:event},updater:{onUpdateAvailable:event,onDownloadProgress:event,onUpdateError:event,onUpdateNotAvailable:event,getLastResult:async()=>null,check:async()=>({ok:true,phase:'up-to-date',message:'UI fixture: current'})}
  };
})();`;
const routes=new Map([['/index.html',Buffer.from('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/brand.css"><script src="/motion.js"></script></head><body><div id="root"></div><script src="/fixture.js"></script><script type="module" src="/renderer.js"></script></body></html>')],['/base.css',Buffer.from(baseCss)],['/brand.css',Buffer.from(css)],['/fixture.js',Buffer.from(fixture)],['/renderer.js',Buffer.from(compiled)],['/motion.js',motion]]);
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=new URL(request.url,'http://localhost').pathname;
    const extension=path.extname(pathname);
    let body=routes.get(pathname);
    if(!body&&/^\/assets\/icons\/[a-z-]+\.svg$/.test(pathname))body=await fs.readFile(path.join(root,'src/brand/icons',path.basename(pathname)));
    if(!body&&/^\/fonts\/(unbounded|manrope)-(latin|cyrillic|cyrillic-ext)\.woff2$/.test(pathname)){
      const [,family,subset]=pathname.match(/\/fonts\/(unbounded|manrope)-(latin|cyrillic|cyrillic-ext)\.woff2$/);
      body=await fs.readFile(path.join(root,'node_modules/@fontsource-variable',family,'files',family+'-'+subset+'-wght-normal.woff2'));
    }
    if(!body&&/^\/assets\/[\w-]+\.(svg|png)$/.test(pathname))body=await fs.readFile(path.join(root,'public-ui/main_window',pathname.slice(1)));
    if(!body){response.writeHead(404);return response.end();}
    response.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'}[extension]||'application/octet-stream'});response.end(body);
  }catch{response.writeHead(404);response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-first-run']});
const report={schemaVersion:1,scope:'Actual production renderer/CSS and native HTML dialog, inert loopback IPC fixtures; no native networking/service/SCM mutation or proof.',browser:browser.version(),cases:[],interactions:[],errors,sourceHashes:{},nativeSystemMutations:0};
for(const file of ['src/recovered/renderer.js','src/brand/CompactRuby.jsx','src/brand/compact-surfaces.css','src/recovered/preload.cjs','src/recovered/electron/ipc/ipc-schemas.js','src/recovered/electron/ipc/state-store.js'])report.sourceHashes[file]=crypto.createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
const assert=(condition,message)=>{if(!condition)throw new Error(message)};
const page=await browser.newPage({viewport:{width:1060,height:720}});
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(!request.url().startsWith(origin)&&!request.url().startsWith('data:'))errors.push('External request: '+request.url())});
async function settle(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function snapshot(name){
  await settle();
  const observation=await page.evaluate(()=>{
    const modal=document.querySelector('dialog[open]');
    const controls=Array.from((modal||document).querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary'));
    const blocked=[];
    for(const item of controls){
      const box=item.getBoundingClientRect();
      if(!item.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})||box.width<1||box.height<1)continue;
      const x=box.x+box.width/2,y=box.y+box.height/2;
      if(x<0||y<0||x>=innerWidth||y>=innerHeight)continue;
      let clipped=false;
      for(let ancestor=item.parentElement;ancestor;ancestor=ancestor.parentElement){const style=getComputedStyle(ancestor),rect=ancestor.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(style.overflowX)&&(x<rect.left||x>rect.right)||/auto|scroll|hidden|clip/.test(style.overflowY)&&(y<rect.top||y>rect.bottom)){clipped=true;break;}}
      if(clipped)continue;
      const hit=document.elementFromPoint(x,y);if(hit&&!item.contains(hit)&&!hit.contains(item))blocked.push({label:item.getAttribute('aria-label')||item.textContent.trim(),hitClass:hit.className});
    }
    return {viewport:{width:innerWidth,height:innerHeight},horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,blockedControls:blocked,modal:!!modal,focus:document.activeElement?.getAttribute('aria-label')||document.activeElement?.tagName,settings:window.__fixtureState.settings,domainRules:window.__fixtureState.domainRules,processRules:window.__fixtureState.processRules};
  });
  await page.screenshot({path:path.join(work,name+'.png')});report.cases.push({name,...observation});
  assert(!observation.horizontalOverflow,name+' horizontal overflow');assert(!observation.blockedControls.length,name+' blocked controls: '+JSON.stringify(observation.blockedControls));
}
const panel=()=>page.locator('.ruby-network-settings');
const openDialog=kind=>panel().getByRole('button',{name:'Добавить правило '+(kind==='domain'?'домена':'процесса')+' VPN'}).click();
async function addRule(kind,target,mode='vpn'){
  await openDialog(kind);const dialog=page.getByRole('dialog');await dialog.getByLabel(kind==='domain'?'Домен для правила VPN':'Процесс для правила VPN',{exact:true}).fill(target);await dialog.getByLabel('Действие правила VPN').selectOption(mode);await dialog.getByRole('button',{name:'Сохранить правило',exact:true}).click();await page.waitForSelector('dialog[open]',{state:'detached'});await settle();
}
try{
  await page.goto(origin+'/index.html');await page.waitForSelector('.shield-settings-open-btn');await page.locator('.shield-settings-open-btn').click();await page.waitForSelector('.ruby-network-settings');
  await snapshot('network-settings-collapsed');
  await panel().locator('summary').click();await panel().scrollIntoViewIfNeeded();await snapshot('network-settings-default');
  await panel().getByLabel('Режим маршрутизации VPN',{exact:true}).selectOption('selected');await panel().getByLabel('DNS соединения VPN',{exact:true}).selectOption('system');await panel().getByLabel('Использовать TUN для временного VPN',{exact:false}).check();
  await panel().getByRole('button',{name:'Сохранить настройки VPN',exact:true}).click();await page.waitForFunction(()=>window.__fixtureState.settings.routeMode==='selected'&&window.__fixtureState.settings.dnsMode==='system');
  const saved=await page.evaluate(()=>window.__calls.filter(call=>call.name==='patchSettings').at(-1));assert(saved.args[0].routeMode==='selected'&&saved.args[0].dnsMode==='system'&&saved.args[0].useTunMode===true,'Real settings patch values');assert(saved.args[1]===3,'Settings CAS revision');assert(await page.evaluate(()=>window.__backgroundSnapshot.settings.routeMode==='global'),'Settings must not silently change protected snapshot');
  report.interactions.push({name:'selected-system-TUN-real-settings-patch',ok:true,call:saved,protectedSnapshotUnchanged:true});
  await addRule('process','LagomVpnProbe.exe');await addRule('domain','пример.рф','direct');
  await panel().scrollIntoViewIfNeeded();await snapshot('network-settings-rules');
  const rules=await page.evaluate(()=>({domainRules:window.__fixtureState.domainRules,processRules:window.__fixtureState.processRules}));assert(rules.domainRules[0].domain==='xn--e1afmkfd.xn--p1ai','Unicode domain normalizes to punycode');assert(rules.processRules[0].process==='LagomVpnProbe.exe'&&rules.processRules[0].mode==='vpn','Exact process rule');
  await openDialog('process');const dialog=page.getByRole('dialog');assert(await dialog.getByLabel('Процесс для правила VPN',{exact:true}).evaluate(element=>element===document.activeElement),'Dialog initial focus on actual input');
  for(let index=0;index<8;index++){await page.keyboard.press('Tab');assert(await dialog.evaluate(element=>element.contains(document.activeElement)),'Native dialog contains Tab focus');}
  await snapshot('network-settings-rule-dialog');await page.keyboard.press('Escape');await page.waitForSelector('dialog[open]',{state:'detached'});assert(await panel().getByRole('button',{name:'Добавить правило процесса VPN'}).evaluate(element=>element===document.activeElement),'Escape restores trigger focus');report.interactions.push({name:'native-dialog-tab-containment-escape-focus',ok:true});
  const originalId=await page.evaluate(()=>window.__fixtureState.processRules[0].id);await panel().getByRole('button',{name:'Изменить правило LagomVpnProbe.exe',exact:true}).click();await page.getByRole('dialog').getByLabel('Действие правила VPN').selectOption('block');await page.getByRole('dialog').getByRole('button',{name:'Сохранить правило',exact:true}).click();await page.waitForSelector('dialog[open]',{state:'detached'});assert(await page.evaluate(id=>window.__fixtureState.processRules[0].id===id&&window.__fixtureState.processRules[0].mode==='block',originalId),'Editing preserves stable ID');
  await addRule('process','browser.exe','direct');await panel().getByRole('button',{name:'Выше правило browser.exe',exact:true}).click();await page.waitForFunction(()=>window.__fixtureState.processRules[0].process==='browser.exe');await panel().getByRole('button',{name:'Удалить правило browser.exe',exact:true}).click();await page.waitForFunction(()=>window.__fixtureState.processRules.length===1);await panel().getByRole('button',{name:'Изменить правило LagomVpnProbe.exe',exact:true}).click();await page.getByRole('dialog').getByLabel('Действие правила VPN').selectOption('vpn');await page.getByRole('dialog').getByRole('button',{name:'Сохранить правило',exact:true}).click();await page.waitForSelector('dialog[open]',{state:'detached'});await panel().getByRole('button',{name:'Удалить правило xn--e1afmkfd.xn--p1ai',exact:true}).click();await page.waitForFunction(()=>window.__fixtureState.domainRules.length===0);report.interactions.push({name:'edit-reorder-remove-stable-id-and-array-preservation',ok:true});
  await panel().scrollIntoViewIfNeeded();await snapshot('network-settings-selected-system-process');
  await panel().getByLabel('DNS соединения VPN',{exact:true}).selectOption('custom');await panel().getByLabel('HTTPS-адрес DNS соединения VPN',{exact:true}).fill('tls://dns.example');const beforeBad=await page.evaluate(()=>window.__calls.filter(call=>call.name==='patchSettings').length);await panel().getByRole('button',{name:'Сохранить настройки VPN',exact:true}).click();assert(await panel().getByText('Поддерживается HTTPS DoH без логина, пароля и фрагмента.',{exact:true}).isVisible(),'Unsupported DoT error visible');assert(await page.evaluate(count=>window.__calls.filter(call=>call.name==='patchSettings').length===count,beforeBad),'Invalid DNS never sent');await snapshot('network-settings-custom-invalid');
  await panel().getByLabel('HTTPS-адрес DNS соединения VPN',{exact:true}).fill('https://resolver.example:8443/dns-query?client=one');await panel().getByRole('button',{name:'Сохранить настройки VPN',exact:true}).click();await page.waitForFunction(()=>window.__fixtureState.settings.dnsMode==='custom');assert(await page.evaluate(()=>window.__fixtureState.settings.customDnsUrl==='https://resolver.example:8443/dns-query?client=one'),'DoH preserves port/query');report.interactions.push({name:'custom-DoH-contract-validation-and-preserved-address',ok:true});await snapshot('network-settings-custom-saved');
  await panel().getByLabel('DNS соединения VPN',{exact:true}).selectOption('system');await page.evaluate(()=>window.__holdWrite=true);await panel().getByRole('button',{name:'Сохранить настройки VPN',exact:true}).click();await page.waitForFunction(()=>typeof window.__releaseWrite==='function');await snapshot('network-settings-save-pending');assert(await panel().getByLabel('DNS соединения VPN',{exact:true}).isDisabled(),'Pending save disables draft input');await page.evaluate(()=>{window.__holdWrite=false;window.__releaseWrite();});await page.waitForFunction(()=>window.__fixtureState.settings.dnsMode==='system');report.interactions.push({name:'pending-write-no-double-actions',ok:true});
  await panel().getByLabel('Режим маршрутизации VPN',{exact:true}).selectOption('global');await page.evaluate(()=>window.__writeFailure=true);await panel().getByRole('button',{name:'Сохранить настройки VPN',exact:true}).click();await panel().getByText('Не удалось сохранить настройки. Изменение не применено.',{exact:true}).waitFor();assert(await page.evaluate(()=>window.__fixtureState.settings.routeMode==='selected'),'Failed save preserves persisted settings');await snapshot('network-settings-write-failure');await page.evaluate(()=>window.__writeFailure=false);await panel().getByRole('button',{name:'Отменить изменения',exact:true}).click();
  await panel().getByLabel('Режим маршрутизации VPN',{exact:true}).selectOption('global');await page.evaluate(()=>window.__settingsConflict=true);const beforeConflict=await page.evaluate(()=>window.__calls.filter(call=>call.name==='patchSettings').length);await panel().getByRole('button',{name:'Сохранить настройки VPN',exact:true}).click();await panel().getByRole('button',{name:'Взять текущие значения',exact:true}).waitFor();assert(await panel().getByRole('button',{name:'Сохранить настройки VPN',exact:true}).isDisabled(),'Conflict blocks automatic stale save');assert(await page.evaluate(count=>window.__calls.filter(call=>call.name==='patchSettings').length===count+1,beforeConflict),'Conflict is not silently retried');await snapshot('network-settings-settings-conflict');await panel().getByRole('button',{name:'Взять текущие значения',exact:true}).click();
  await openDialog('process');await page.getByRole('dialog').getByLabel('Процесс для правила VPN',{exact:true}).fill('other.exe');await page.evaluate(()=>window.__rulesConflict=true);const beforeRuleConflict=await page.evaluate(()=>window.__calls.filter(call=>call.name==='patchRules').length);await page.getByRole('dialog').getByRole('button',{name:'Сохранить правило',exact:true}).click();await page.getByRole('dialog').getByRole('alert').waitFor();assert(await page.evaluate(count=>window.__calls.filter(call=>call.name==='patchRules').length===count,beforeRuleConflict),'Fresh-read rule conflict causes no mutation');await snapshot('network-settings-rule-conflict');await page.keyboard.press('Escape');report.interactions.push({name:'failed-write-and-CAS-conflicts-no-overwrite-no-auto-retry',ok:true});
  await panel().getByLabel('Режим маршрутизации VPN',{exact:true}).selectOption('selected');await panel().getByRole('button',{name:'Сохранить настройки VPN',exact:true}).click();await page.waitForFunction(()=>window.__fixtureState.settings.routeMode==='selected');await page.getByRole('navigation',{name:'Основная навигация'}).getByRole('button',{name:'VPN',exact:true}).click();await page.getByRole('button',{name:'Применить сервер и правила',exact:true}).click();await page.getByRole('button',{name:'Применить',exact:true}).click();await page.waitForFunction(()=>window.__calls.some(call=>call.name==='serviceInstall'));const apply=await page.evaluate(()=>({call:window.__calls.filter(call=>call.name==='serviceInstall').at(-1),snapshot:window.__backgroundSnapshot}));assert(apply.call.args[0]==='selected-node','Exact string node ID installation contract');assert(apply.snapshot.settings.routeMode==='selected'&&apply.snapshot.settings.dnsMode==='system'&&apply.snapshot.processRules.length===1,'Only explicit apply changes service snapshot');await page.waitForSelector('.modal-layer',{state:'detached'});await snapshot('network-settings-explicit-background-apply');for(const width of [1060,600,400]){await page.setViewportSize({width,height:720});await page.waitForSelector('.activity-hud');await snapshot('network-settings-hud-'+width);const region=await page.locator('.ruby-activity-region').boundingBox();const content=await page.locator('.screen-stage').boundingBox();assert(region&&content&&region.y>=content.y+content.height-1,'HUD occupies its own row outside scroll content');report.interactions.push({name:'dedicated-visible-HUD-row-'+width,ok:true,region,content});}await page.getByRole('button',{name:'Закрыть уведомление',exact:true}).click();await page.waitForSelector('.activity-hud',{state:'detached'});await page.setViewportSize({width:1060,height:720});report.interactions.push({name:'background-snapshot-remains-unchanged-until-explicit-apply',ok:true,...apply});
  await page.getByRole('navigation',{name:'Основная навигация'}).getByRole('button',{name:'Настройки',exact:true}).click();await panel().locator('summary').click();await panel().scrollIntoViewIfNeeded();await page.setViewportSize({width:400,height:640});await panel().scrollIntoViewIfNeeded();await snapshot('network-settings-narrow');await openDialog('process');await snapshot('network-settings-rule-dialog-narrow');await page.keyboard.press('Escape');await page.setViewportSize({width:1060,height:720});
  await openDialog('process');await page.evaluate(()=>window.__networkFailure=true);await panel().getByText('Настройки не проверены. Сохранение доступно после актуального ответа приложения.',{exact:true}).waitFor({timeout:12000});assert(await panel().getByRole('button',{name:'Добавить правило процесса VPN'}).isDisabled(),'Unknown observation blocks changes');assert(await page.getByRole('dialog').getByRole('button',{name:'Сохранить правило',exact:true}).isDisabled(),'Unknown observation disables open-dialog Save');assert(await page.getByRole('dialog').getByRole('button',{name:'Отмена',exact:true}).isEnabled(),'Unknown observation allows leaving dialog');await snapshot('network-settings-rule-dialog-unknown');await page.keyboard.press('Escape');await page.waitForSelector('dialog[open]',{state:'detached'});await panel().scrollIntoViewIfNeeded();await snapshot('network-settings-unknown');report.interactions.push({name:'unknown-observation-keeps-facts-and-blocks-writes',ok:true});
  const scaled=await browser.newPage({viewport:{width:530,height:360},deviceScaleFactor:2,reducedMotion:'reduce'});await scaled.goto(origin+'/index.html');await scaled.locator('.shield-settings-open-btn').click();await scaled.waitForSelector('.ruby-network-settings');await scaled.locator('.ruby-network-settings>summary').click();await scaled.locator('.ruby-network-settings').scrollIntoViewIfNeeded();const scaledState=await scaled.evaluate(()=>({horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,devicePixelRatio,transition:getComputedStyle(document.querySelector('.ruby-network-settings')).transitionDuration}));assert(!scaledState.horizontalOverflow&&scaledState.devicePixelRatio===2,'Browser scaled viewport');await scaled.screenshot({path:path.join(work,'network-settings-browser-200-reduced.png')});report.cases.push({name:'network-settings-browser-200-reduced',...scaledState,nativeWindowsDpiVerified:false});await scaled.close();
  report.calls=await page.evaluate(()=>window.__calls);assert(errors.length===0,'No renderer errors or external network requests');
}finally{await page.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
await fs.writeFile(path.join(work,'ui-network-settings-validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({cases:report.cases.length,interactions:report.interactions.length,errors:report.errors.length,nativeSystemMutations:report.nativeSystemMutations,report:path.join(work,'ui-network-settings-validation.json')}));
