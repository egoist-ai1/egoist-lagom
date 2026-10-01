import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Run with an absolute task-owned evidence directory. No Electron or host APIs are used.
const evidenceArg=process.argv[2];
if(!evidenceArg || !path.isAbsolute(evidenceArg))throw new Error('Supply an absolute task-scoped evidence directory as the first argument');
const evidence=path.resolve(evidenceArg);
const project="C:/Users/Egoist/Desktop/Проекты/Приложения/Egoist Lagom";
const packageVersion=JSON.parse(await fs.readFile(path.join(project,'package.json'),'utf8')).version;
const buildDir=process.env.EGOIST_UI_BUILD_DIR||path.join(project,'.vite');
if(!path.isAbsolute(buildDir))throw new Error('EGOIST_UI_BUILD_DIR must be absolute');
const builtMain=await fs.readFile(path.join(buildDir,'build/main.js'),'utf8');
const buildDate=builtMain.match(/EGOIST_SHIELD_BUILD_DATE = "([^"]+)"/)?.[1];
assert.ok(buildDate,'Built app date is missing');
const build=path.join(buildDir,'renderer/main_window');
const moduleName=process.env.PLAYWRIGHT_MODULE;
const {chromium}=await import(moduleName ? (path.isAbsolute(moduleName)?pathToFileURL(moduleName).href:moduleName) : 'playwright');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const assets=new Map();
async function snapshot(dir){
  for(const item of await fs.readdir(dir,{withFileTypes:true})){
    const full=path.join(dir,item.name);
    if(item.isDirectory())await snapshot(full);
    else if(item.isFile())assets.set('/'+path.relative(build,full).split(path.sep).join('/'),await fs.readFile(full));
  }
}
await snapshot(build);
assert.ok(assets.has('/index.html'),'Build .vite/renderer/main_window before running');
const manifest=[...assets].map(([name,data])=>({name,bytes:data.length,sha256:hash(data)})).sort((a,b)=>a.name.localeCompare(b.name));
await fs.mkdir(evidence,{recursive:true});
const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  const file=name==='/'?'/index.html':name;
  const data=assets.get(file);
  if(!data){res.writeHead(404);res.end();return}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff'})[path.extname(file)]||'application/octet-stream');
  res.end(data);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const report={startedAt:new Date().toISOString(),buildManifest:manifest,checks:[],pageErrors:[],blockedRequests:[],limitations:['Renderer contracts exercised with mocks; Windows services, real persistence and packaged Electron behavior are not tested.']};
let browser;

function installFixture(){
  localStorage.setItem('egoist_widget_mode','false');
  const clone=v=>structuredClone(v);
  const data=window.compactLab={calls:[],reads:{},listeners:{},state:{settings:{autoStart:false,minimizeToTray:false,autoConnect:false,reconnectOnDrop:true,notifications:true,sendSubscriptionHwid:false,autoUpdate:true,soundNotifications:false},nodes:[{id:'fixture-node',name:'QA server',server:'192.0.2.2',port:443,protocol:'vless'}],subscriptions:[],activeNodeId:'fixture-node'},vpn:{connected:false,running:false},doh:{running:false,nativeManaged:true,serviceInstalled:false,serviceRunning:false},zapret:{serviceRunning:false,standaloneRunning:false,currentProfile:'general'},userLists:{generalDomains:['existing.example.test'],includedCidrs:[],excludedDomains:[],excludedCidrs:[]},telegram:{running:false,serviceRunning:false,serviceInstalled:true,config:{host:'127.0.0.1',port:1443,secret:'0123456789abcdef0123456789abcdef',dcIp:[],verbose:false,bufKb:256,poolSize:8,logMaxMb:5,checkUpdates:true}}};
  const read=(name,fn)=>async(...args)=>{data.reads[name]=(data.reads[name]??0)+1;return clone(fn(...args))};
  const action=(name,fn=()=>({ok:true}))=>async(...args)=>{data.calls.push({name,args:clone(args)});return clone(fn(...args))};
  const noop=()=>()=>{};
  const listen=name=>callback=>{data.listeners[name]=callback;return()=>{if(data.listeners[name]===callback)delete data.listeners[name]}};
  const checkUpdate=async()=>{
    data.reads['updater.check']=(data.reads['updater.check']??0)+1;
    if(window.__qaUpdateCheckFails)throw new Error('Initial updater IPC failed');
    if(window.__qaUpdateCheckHold)return await new Promise(resolve=>{data.finishUpdateCheck=resolve});
    return {ok:false,phase:'blocked',latestVersion:'3.7.1',message:'QA fixture: release verification required'};
  };
  window.egoistAPI={
    state:{get:read('state.get',()=>data.state),set:action('state.set',next=>data.state=clone(next))},
    app:{isAdmin:async()=>true,getVersion:async()=>({version:window.__qaVersion,buildDate:window.__qaBuildDate}),isFirstRun:async()=>false},
    vpn:{status:read('vpn.status',()=>data.vpn),onFallback:noop},
    system:{dnsControllerStatus:read('dns.status',()=>({mode:'system-default'})),systemDohStatus:read('doh.status',()=>data.doh),dnsDiagnostics:read('dns.diagnostics',()=>({targets:[],summary:{total:0,okCount:0}})),getMyIp:async()=>({ip:'192.0.2.1',country:'QA',provider:'Fixture'}),pingActiveProxy:async()=>20,ping:async()=>20,setDnsServers:action('system.setDnsServers'),resetDnsServers:action('system.resetDnsServers'),internetFix:action('system.internetFix'),onSpeedtestProgress:noop,cancelSpeedtest:action('system.cancelSpeedtest')},
    zapret:{status:read('zapret.status',()=>data.zapret),listProfiles:async()=>JSON.parse(localStorage.getItem('qa-zapret-profiles')||'null')??[{name:'general'}],getUserLists:read('zapret.getUserLists',()=>data.userLists),saveUserLists:action('zapret.saveUserLists',lists=>{data.userLists=clone(lists);return {ok:true}}),onAutoSelectProgress:noop},
    telegramProxy:{status:read('telegram.status',()=>data.telegram),tailLogs:async()=>[],saveConfig:action('telegramProxy.saveConfig',config=>{data.telegram.config=clone(config);return {ok:true}}),start:action('telegramProxy.start',()=>{data.telegram.running=true;return {ok:true}})},
    health:{getReport:async()=>({})},network:{inspect:async()=>({})},logs:{getRuntimeSummary:async()=>[]},
    updater:{getLastResult:async()=>null,check:checkUpdate,checkAndInstall:action('updater.checkAndInstall',()=>({ok:true,phase:'up-to-date',currentVersion:window.__qaVersion,latestVersion:window.__qaVersion,message:'Установлена последняя доступная версия.'})),setAuto:action('updater.setAuto',enabled=>{data.state.settings.autoUpdate=enabled;return {ok:true,enabled}}),onUpdateAvailable:listen('updateAvailable'),onDownloadProgress:listen('downloadProgress'),onUpdateDownloaded:noop,onUpdateNotAvailable:listen('updateNotAvailable'),onUpdateError:listen('updateError')},
    traffic:{onUpdate:noop},autoConnect:{onAutoConnect:noop},

  };
}


function installTelegramQaFixture() {
  const data = window.compactLab;
  const clone = value => structuredClone(value);
  data.fixtureLabel = 'EXPLICIT IPC FIXTURE: no native Windows services, disk persistence or network';
  data.telegram = {...data.telegram,serviceInstalled:false,serviceRunning:false,running:false,runtimeReady:false,listenerReady:false};
  data.state.stateRevision = 0;
  data.statusMode = 'hold';
  data.pendingReads = [];
  const status = async () => {
    data.reads['telegram.status'] = (data.reads['telegram.status'] ?? 0) + 1;
    if (data.statusMode === 'reject') throw new Error('UI QA IPC fixture: Telegram status unavailable');
    if (data.statusMode === 'hold') return await new Promise((resolve,reject)=>data.pendingReads.push({resolve,reject}));
    return clone(data.telegram);
  };
  data.releaseReads = mode => {
    data.statusMode = mode;
    for (const pending of data.pendingReads.splice(0)) {
      if (mode === 'reject') pending.reject(new Error('UI QA IPC fixture: Telegram status unavailable'));
      else pending.resolve(clone(data.telegram));
    }
  };
  window.egoistAPI.telegramProxy = {
    status,tailLogs:async()=>[],
    saveConfig:async config => {
      data.calls.push({name:'telegramProxy.saveConfig',args:[clone(config)]});
      return await new Promise(resolve=>{data.finishSave=()=>{data.telegram.config=clone(config);resolve({ok:true,...clone(data.telegram)})}});
    },
    installService:async()=>{
      data.calls.push({name:'telegramProxy.installService',args:[]});
      return await new Promise(resolve=>{data.finishInstall=resolve});
    },
    start:async()=>{data.calls.push({name:'telegramProxy.start',args:[]});return {ok:true,...clone(data.telegram)}},
    stop:async()=>{data.calls.push({name:'telegramProxy.stop',args:[]});return {ok:true,...clone(data.telegram)}},
    openLink:async()=>{data.calls.push({name:'telegramProxy.openLink',args:[]});return {ok:true}},
  };
}

const calls = page => page.evaluate(()=>compactLab.calls);
const installButton = page => page.getByRole('button',{name:'Установить фоновую службу',exact:true});
const retryButton = page => page.getByRole('button',{name:'Перепроверить конфигурацию',exact:true});
async function ready(page) { await page.waitForFunction(()=>{const button=Array.from(document.querySelectorAll('.telegram-primary-actions button')).find(el=>el.textContent==='Установить фоновую службу');return button&&!button.disabled}); }

async function audit(page) {
  const originalScroll = await page.evaluate(()=>Array.from(document.querySelectorAll('*')).filter(el=>el.scrollHeight>el.clientHeight+2&&getComputedStyle(el).overflowY.match(/auto|scroll/)).map((el,index)=>{el.dataset.telegramQaScroll=String(index);return {index,top:el.scrollTop}}));
  const controls = page.locator('.telegram-form button:enabled,.telegram-form summary,.telegram-form input:enabled,.telegram-form textarea:enabled');
  const hits = [];
  for (let i=0;i<await controls.count();i++) {
    const control = controls.nth(i);
    if (!await control.isVisible()) continue;
    await control.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
    hits.push(await control.evaluate(el=>{
      const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,top=document.elementFromPoint(x,y);
      return {label:el.getAttribute('aria-label')??el.closest('.field')?.textContent?.trim()??el.textContent?.trim()??el.tagName,tag:el.tagName,x,y,width:r.width,height:r.height,insideViewport:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,receivesPointer:!!top&&(el===top||el.contains(top)),scrollWidth:el.scrollWidth,clientWidth:el.clientWidth};
    }));
  }
  await page.evaluate(saved=>{for(const item of saved){const el=document.querySelector(`[data-telegram-qa-scroll="${item.index}"]`);if(el)el.scrollTop=item.top}},originalScroll);
  const geometry = await page.evaluate(()=>{
    const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,right:r.right,bottom:r.bottom,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}};
    const form=document.querySelector('.telegram-form');
    const elements=Array.from(form?.querySelectorAll('button,input,textarea,summary,.draft-conflict,.telegram-advanced-note')??[]).filter(el=>el.getClientRects().length);
    const horizontal=elements.map(el=>{
      const box=rect(el),textOutside=[];
      if(!['INPUT','TEXTAREA'].includes(el.tagName)){
        const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
        for(let node=walker.nextNode();node;node=walker.nextNode()){
          if(!node.textContent.trim()||!node.parentElement.getClientRects().length)continue;
          const range=document.createRange();range.selectNodeContents(node);
          for(const r of range.getClientRects())if(r.width>0&&(r.left<box.left-1||r.right>box.right+1))textOutside.push({text:node.textContent.trim(),left:r.left,right:r.right});
        }
      }
      return {label:el.getAttribute('aria-label')??el.textContent?.trim()?.slice(0,120)??el.tagName,...box,textOutside};
    }).filter(r=>r.left<-1||r.right>innerWidth+1||r.textOutside.length);
    const internalScroll=elements.filter(el=>el.scrollWidth>el.clientWidth+2).map(el=>({tag:el.tagName,type:el.getAttribute('type'),label:el.getAttribute('aria-label')??el.textContent?.trim()??'',scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,beforeContent:getComputedStyle(el,'::before').content,afterContent:getComputedStyle(el,'::after').content}));
    const focused=document.activeElement,cs=focused?getComputedStyle(focused):null;
    return {viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},document:{width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth},form:rect(form),status:rect(document.querySelector('.telegram-status')),horizontalOverflow:horizontal,internalScroll,focus:focused?{tag:focused.tagName,label:focused.getAttribute('aria-label')??focused.textContent?.trim()??'',focusVisible:focused.matches(':focus-visible'),outlineWidth:cs.outlineWidth,outlineColor:cs.outlineColor,outlineStyle:cs.outlineStyle}:null,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,animations:document.getAnimations().map(a=>({playState:a.playState,duration:a.effect?.getComputedTiming()?.duration,targetClass:a.effect?.target?.className})),goodIndicators:form?.querySelectorAll('.service-ready,.dot.good,.good-text').length??0};
  });
  assert.deepEqual(hits.filter(item=>!item.insideViewport||!item.receivesPointer),[],'All enabled Telegram control centers must be reachable after native DOM scrolling');
  assert.equal(geometry.document.scrollWidth<=geometry.viewport.width+1,true,'Document horizontal overflow');
  assert.deepEqual(geometry.horizontalOverflow,[],'Telegram controls/text must fit the viewport and own bounds');
  assert.equal(geometry.reducedMotion,true);
  return {geometry,hits};
}

async function capture(page,result,state) {
  const measured=await audit(page);
  const filename=`fixture-${result.width}-${state}.png`;
  await page.screenshot({path:path.join(evidence,filename),fullPage:false});
  const bytes=await fs.readFile(path.join(evidence,filename));
  result.states.push({state,file:filename,bytes:bytes.length,sha256:hash(bytes),...measured,calls:await calls(page),reads:await page.evaluate(()=>compactLab.reads)});
}

report.kind='Bounded production renderer visual QA with explicit IPC fixtures, not native service evidence';
report.harnessBase={file:'scripts/check-compact-ui.mjs',sha256:hash(await fs.readFile(path.join(project,'scripts/check-compact-ui.mjs')))};
report.sources={};
for(const file of ['src/recovered/renderer.js','src/brand/ShieldWidget.jsx','src/brand/compact-surfaces.css','src/brand/compact-ruby.css']) {
  const bytes=await fs.readFile(path.join(project,file));
  report.sources[file]={bytes:bytes.length,sha256:hash(bytes),sha256LF:hash(Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n')))};
}
assert.equal(report.sources['src/recovered/renderer.js'].sha256LF,'947836bac950728a674bdc35fede32a03d7eb2bcfbaaf2019c061235704852f4','Frozen tested source');
const builtJs=[...assets].filter(([file])=>file.endsWith('.js')).map(([,bytes])=>bytes.toString('utf8')).join('\n');
assert.ok(builtJs.includes('Перепроверить конфигурацию'),'Snapshot must include the new readiness/retry UI');
assert.ok(builtJs.includes('Предыдущее действие Telegram ещё не завершено.'),'Snapshot must include the pending guard');
report.limitations=[
  'Headless Chromium loads a memory snapshot of the built production renderer; all egoistAPI methods are explicitly named IPC fixtures.',
  'No native Electron window, UIA, privilege, Windows service, disk persistence, route or network health is exercised.',
  'Screenshots include fixture observations and are not evidence that genuine Windows services work.',
  'Only new Telegram first-load/rejected/retry/conflict/pending flows at two widths are covered; prior gallery and successful 47 Node cases are not rerun.',
  'Built/source SHA binding and snapshot markers are recorded; this check does not independently prove the full build pipeline correspondence.',
  'No months-long soak or all possible timing/conflict guarantees are claimed.'
];

try {
  browser=await chromium.launch({headless:true});
  report.browserVersion=browser.version();
  for(const viewport of [{width:1060,height:760},{width:400,height:600}]) {
    const result={width:viewport.width,viewport,states:[],status:'running'};
    report.checks.push(result);
    const context=await browser.newContext({viewport,deviceScaleFactor:viewport.width===400?2:1,reducedMotion:'reduce',serviceWorkers:'block'});
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin===origin||url.protocol==='data:')return route.continue();
      report.blockedRequests.push({width:viewport.width,url:url.origin});return route.abort();
    });
    const page=await context.newPage();page.setDefaultTimeout(6000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(({version,date})=>{window.__qaVersion=version;window.__qaBuildDate=date},{version:packageVersion,date:buildDate});
    await page.addInitScript(installFixture);
    await page.addInitScript(installTelegramQaFixture);
    try {
      await page.goto(origin,{waitUntil:'networkidle'});
      await page.locator('.shield-settings-open-btn').click();
      await page.getByRole('button',{name:'Telegram',exact:true}).click();
      await page.getByText('Расширенные настройки',{exact:true}).click();
      await installButton(page).waitFor();
      assert.equal(await installButton(page).isDisabled(),true);
      assert.equal(await page.getByLabel('Порт',{exact:true}).isDisabled(),true);
      assert.equal((await calls(page)).length,0);
      await capture(page,result,'first-load');

      await page.evaluate(()=>compactLab.releaseReads('reject'));
      await page.getByText('UI QA IPC fixture: Telegram status unavailable',{exact:true}).waitFor();
      assert.equal(await installButton(page).isDisabled(),true);
      const retry=retryButton(page);
      await retry.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
      assert.equal(await retry.evaluate(el=>el===document.activeElement&&el.matches(':focus-visible')),true);
      result.keyboardRetryFocus=await retry.evaluate(el=>({focused:el===document.activeElement,focusVisible:el.matches(':focus-visible'),outlineWidth:getComputedStyle(el).outlineWidth,outlineStyle:getComputedStyle(el).outlineStyle}));
      await capture(page,result,'rejected-focus');

      await page.evaluate(()=>{compactLab.statusMode='hold'});
      const before=await page.evaluate(()=>compactLab.reads['telegram.status']);
      await page.keyboard.press('Enter');
      await page.waitForFunction(n=>compactLab.reads['telegram.status']>n,before);
      await page.getByRole('button',{name:'Читаю конфигурацию…',exact:true}).waitFor();
      assert.equal(await installButton(page).isDisabled(),true);
      assert.equal(await page.getByLabel('Порт',{exact:true}).isDisabled(),true);
      await capture(page,result,'retry-pending');
      await page.evaluate(()=>compactLab.releaseReads('ok'));
      await ready(page);
      assert.equal(await page.getByLabel('Порт',{exact:true}).inputValue(),'1443');
      assert.equal((await calls(page)).length,0,'Read-only retry cannot write config/install');
      result.retryRecovered=true;

      await page.getByLabel('Порт',{exact:true}).fill('2443');
      await page.getByLabel('Пул соединений',{exact:true}).fill('12');
      await page.evaluate(()=>{compactLab.telegram.config.port=3443});
      await retryButton(page).click();
      await page.getByText('Конфигурация изменилась на стороне службы',{exact:true}).waitFor();
      assert.equal(await page.getByLabel('Порт',{exact:true}).inputValue(),'2443');
      assert.equal(await page.getByLabel('Пул соединений',{exact:true}).inputValue(),'12');
      assert.equal(await installButton(page).isDisabled(),true);
      assert.equal((await calls(page)).length,0);
      const keep=page.getByRole('button',{name:'Оставить мои изменения',exact:true});
      await keep.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
      assert.equal(await keep.evaluate(el=>el===document.activeElement&&el.matches(':focus-visible')),true);
      await capture(page,result,'conflict-focus');
      await page.keyboard.press('Enter');
      await page.getByText('Конфигурация изменилась на стороне службы',{exact:true}).waitFor({state:'hidden'});
      await installButton(page).click();
      await page.waitForFunction(()=>!!compactLab.finishSave);
      assert.equal(await page.getByLabel('Порт',{exact:true}).isDisabled(),true);
      assert.equal(await retryButton(page).isDisabled(),true);
      let current=await calls(page);
      assert.equal(current.filter(call=>call.name==='telegramProxy.saveConfig').length,1);
      assert.equal(current.filter(call=>call.name==='telegramProxy.installService').length,0);
      assert.equal(current[0].args[0].port,2443);
      assert.equal(current[0].args[0].poolSize,12);
      await capture(page,result,'dirty-save-pending');

      await page.evaluate(()=>compactLab.finishSave());
      await page.waitForFunction(()=>!!compactLab.finishInstall);
      current=await calls(page);
      assert.deepEqual(current.map(call=>call.name),['telegramProxy.saveConfig','telegramProxy.installService']);
      assert.equal(await page.getByLabel('Порт',{exact:true}).isDisabled(),true);
      assert.equal(await page.getByRole('button',{name:'Устанавливается…',exact:true}).isDisabled(),true);
      await capture(page,result,'install-pending');
      assert.deepEqual(errors,[]);
      result.status='passed';
    } catch(error) {
      result.status='failed';result.error=error.stack??String(error);
      await page.screenshot({path:path.join(evidence,`fixture-${viewport.width}-failed.png`)}).catch(()=>{});
      await fs.writeFile(path.join(evidence,`fixture-${viewport.width}-failed.html`),await page.content()).catch(()=>{});
    } finally {
      result.calls=await calls(page).catch(()=>[]);
      result.reads=await page.evaluate(()=>compactLab.reads).catch(()=>({}));
      report.pageErrors.push(...errors.map(message=>({width:viewport.width,message})));
      await context.close();
      console.log(`${result.status.toUpperCase()} Telegram ${viewport.width} states=${result.states.length}${result.error?' '+result.error.split('\n')[0]:''}`);
    }
  }
} catch(error) {report.fatal=error.stack??String(error)}
finally {
  await browser?.close();await new Promise(resolve=>server.close(resolve));
  report.buildChangedDuringRun=[];
  for(const entry of manifest){const bytes=await fs.readFile(path.join(build,entry.name.slice(1))).catch(()=>null);if(!bytes||hash(bytes)!==entry.sha256)report.buildChangedDuringRun.push(entry.name)}
  report.sourcesChangedDuringRun=[];
  for(const [file,source] of Object.entries(report.sources)){const bytes=await fs.readFile(path.join(project,file));if(hash(bytes)!==source.sha256)report.sourcesChangedDuringRun.push(file)}
  report.finishedAt=new Date().toISOString();
  report.passed=!report.fatal&&report.checks.length===2&&report.checks.every(check=>check.status==='passed'&&check.states.length===6)&&report.pageErrors.length===0&&report.blockedRequests.length===0&&report.buildChangedDuringRun.length===0&&report.sourcesChangedDuringRun.length===0;
  await fs.writeFile(path.join(evidence,'telegram-visual-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,states:report.checks.reduce((n,c)=>n+c.states.length,0),failures:report.checks.filter(c=>c.status!=='passed').map(c=>({width:c.width,error:c.error})),fatal:report.fatal,evidence}));
  if(!report.passed)process.exitCode=1;
}
