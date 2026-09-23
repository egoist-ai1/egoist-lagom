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
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packageVersion=JSON.parse(await fs.readFile(path.join(project,'package.json'),'utf8')).version;
const builtMain=await fs.readFile(path.join(project,'.vite/build/main.js'),'utf8');
const buildDate=builtMain.match(/EGOIST_SHIELD_BUILD_DATE = "([^"]+)"/)?.[1];
assert.ok(buildDate,'Built app date is missing');
const build=path.join(project,'.vite/renderer/main_window');
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
  const data=window.compactLab={calls:[],reads:{},state:{settings:{autoStart:false,minimizeToTray:false,autoConnect:false,reconnectOnDrop:true,notifications:true,sendSubscriptionHwid:false,autoUpdate:true,soundNotifications:false},nodes:[{id:'fixture-node',name:'QA server',server:'192.0.2.2',port:443,protocol:'vless'}],subscriptions:[],activeNodeId:'fixture-node'},vpn:{connected:false,running:false},doh:{running:false,nativeManaged:true,serviceInstalled:false,serviceRunning:false},zapret:{serviceRunning:false,standaloneRunning:false,currentProfile:'general'},userLists:{generalDomains:['existing.example.test'],includedCidrs:[],excludedDomains:[],excludedCidrs:[]},telegram:{running:false,serviceRunning:false,serviceInstalled:true,config:{host:'127.0.0.1',port:1443,secret:'0123456789abcdef0123456789abcdef',dcIp:[],verbose:false,bufKb:256,poolSize:8,logMaxMb:5,checkUpdates:true}}};
  const read=(name,fn)=>async(...args)=>{data.reads[name]=(data.reads[name]??0)+1;return clone(fn(...args))};
  const action=(name,fn=()=>({ok:true}))=>async(...args)=>{data.calls.push({name,args:clone(args)});return clone(fn(...args))};
  const noop=()=>()=>{};
  window.egoistAPI={
    state:{get:read('state.get',()=>data.state),set:action('state.set',next=>data.state=clone(next))},
    app:{isAdmin:async()=>true,getVersion:async()=>({version:window.__qaVersion,buildDate:window.__qaBuildDate}),isFirstRun:async()=>false},
    vpn:{status:read('vpn.status',()=>data.vpn),onFallback:noop},
    system:{dnsControllerStatus:read('dns.status',()=>({mode:'system-default'})),systemDohStatus:read('doh.status',()=>data.doh),dnsDiagnostics:read('dns.diagnostics',()=>({targets:[],summary:{total:0,okCount:0}})),getMyIp:async()=>({ip:'192.0.2.1',country:'QA',provider:'Fixture'}),pingActiveProxy:async()=>20,ping:async()=>20,setDnsServers:action('system.setDnsServers'),resetDnsServers:action('system.resetDnsServers'),internetFix:action('system.internetFix'),onSpeedtestProgress:noop,cancelSpeedtest:action('system.cancelSpeedtest')},
    zapret:{status:read('zapret.status',()=>data.zapret),listProfiles:async()=>JSON.parse(localStorage.getItem('qa-zapret-profiles')||'null')??[{name:'general'}],getUserLists:read('zapret.getUserLists',()=>data.userLists),saveUserLists:action('zapret.saveUserLists',lists=>{data.userLists=clone(lists);return {ok:true}}),onAutoSelectProgress:noop},
    telegramProxy:{status:read('telegram.status',()=>data.telegram),tailLogs:async()=>[],saveConfig:action('telegramProxy.saveConfig',config=>{data.telegram.config=clone(config);return {ok:true}}),start:action('telegramProxy.start',()=>{data.telegram.running=true;return {ok:true}})},
    health:{getReport:async()=>({})},network:{inspect:async()=>({})},logs:{getRuntimeSummary:async()=>[]},
    updater:{getLastResult:async()=>null,check:read('updater.check',()=>({ok:false,phase:'blocked',latestVersion:'3.7.1',message:'QA fixture: release verification required'})),setAuto:action('updater.setAuto',enabled=>{data.state.settings.autoUpdate=enabled;return {ok:true,enabled}}),onUpdateAvailable:noop,onDownloadProgress:noop,onUpdateDownloaded:noop,onUpdateNotAvailable:noop,onUpdateError:noop},
    traffic:{onUpdate:noop},autoConnect:{onAutoConnect:noop},

  };
}

const calls=page=>page.evaluate(()=>compactLab.calls);
const waitIdle=page=>page.waitForFunction(()=>!document.querySelector('.app-shell')?.dataset.busy);
async function refresh(page){
  const before=await page.evaluate(()=>compactLab.reads['telegram.status']??0);
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(n=>(compactLab.reads['telegram.status']??0)>n,before);
}
async function expectFocused(locator){
  await locator.page().waitForFunction(el=>el===document.activeElement,await locator.elementHandle(),{timeout:1500});
}
async function dialogKeyboard(page,dialog,opener){
  await dialog.waitFor();
  await page.waitForFunction(()=>document.querySelector('[role="dialog"],dialog')?.contains(document.activeElement));
  const buttons=dialog.locator('button:not(:disabled)');
  await buttons.first().focus();await page.keyboard.press('Shift+Tab');await expectFocused(buttons.last());
  await page.keyboard.press('Tab');await expectFocused(buttons.first());
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await expectFocused(opener);
}
async function check(id,screen,fn,viewport={width:1440,height:940}){
  const context=await browser.newContext({viewport,deviceScaleFactor:2,reducedMotion:'reduce',serviceWorkers:'block'});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin || url.protocol==='data:')return route.continue();
    report.blockedRequests.push({check:id,url:url.origin});return route.abort();
  });
  const page=await context.newPage();page.setDefaultTimeout(7000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({version,date})=>{window.__qaVersion=version;window.__qaBuildDate=date},{version:packageVersion,date:buildDate});
  await page.addInitScript(installFixture);
  const result={id,screen,viewport,status:'running'};report.checks.push(result);
  try{
    await page.goto(`${origin}/?screen=${screen}`,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>compactLab.reads['state.get']>0);
    await page.locator('.shield-settings-open-btn').click();
    const screenLabels={dashboard:'Обзор',vpn:'Соединение',dns:'DNS',zapret:'Профили',telegram:'Telegram', 'telegram-proxy':'Telegram',settings:'Настройки'};
    if(screen!=='settings')await page.getByRole('button',{name:screenLabels[screen],exact:true}).click();
    await fn(page,result);
    assert.deepEqual(errors,[],'No renderer exceptions');
    result.status='passed';
  }catch(error){result.status='failed';result.error=error.stack??String(error)}
  finally{
    result.calls=await calls(page).catch(()=>[]);
    result.reads=await page.evaluate(()=>compactLab.reads).catch(()=>({}));
    report.pageErrors.push(...errors.map(message=>({check:id,message})));
    await page.screenshot({path:path.join(evidence,`${id}.png`),fullPage:true}).catch(()=>{});
    if(result.status==='failed')await fs.writeFile(path.join(evidence,`${id}.html`),await page.content()).catch(()=>{});
    await context.close();
    console.log(`${result.status.toUpperCase()} ${id}${result.error?' — '+result.error.split('\n')[0]:''}`);
  }
}

try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  report.browserVersion=browser.version();
  const preferences=[['autoStart','Запускать при старте Windows',false],['minimizeToTray','Сворачивать в трей',false],['autoConnect','Автоподключение маршрута',false],['reconnectOnDrop','Переподключаться при обрыве',true],['notifications','Показывать уведомления',true],['sendSubscriptionHwid','Передавать HWID провайдеру подписки',false],['autoUpdate','Автообновление приложения и компонентов',true]];
  for(const [key,label,initial] of preferences)await check(`setting-${key}`,'settings',async page=>{
    const control=page.getByRole('switch',{name:label,exact:true});
    assert.equal(await control.getAttribute('aria-checked'),String(initial));
    const before=await page.evaluate(()=>structuredClone(compactLab.state));
    await control.click();await page.waitForFunction(([k,v])=>compactLab.state.settings[k]===v,[key,!initial]);await waitIdle(page);
    const writes=await calls(page);assert.equal(writes.length,1,'Exactly one persistence call');
    assert.equal(writes[0].name,key==='autoUpdate'?'updater.setAuto':'state.set');
    if(key==='autoUpdate')assert.deepEqual(writes[0].args,[false]);
    else assert.deepEqual(writes[0].args,[{...before,settings:{...before.settings,[key]:!initial}}]);
    await page.getByRole('button',{name:'Обзор',exact:true}).click();
    await page.getByRole('button',{name:'Настройки',exact:true}).click();
    const persisted=key==='autoStart'?page.getByRole('switch',{name:label,exact:true}):control;
    await persisted.waitFor();assert.equal(await persisted.getAttribute('aria-checked'),String(!initial));
  });
  await check('startup-autoConnect-dependency','settings',async page=>{
    await page.getByRole('switch',{name:'Автоподключение маршрута',exact:true}).click();
    const startup=page.getByRole('switch',{name:'Фоновый запуск при старте Windows',exact:true});await startup.waitFor();await waitIdle(page);
    assert.equal(await startup.getAttribute('aria-checked'),'true');assert.equal(await startup.getAttribute('aria-disabled'),'true');
    const before=await calls(page);await startup.focus();await page.keyboard.press('Space');await page.keyboard.press('Enter');
    assert.deepEqual(await calls(page),before);assert.equal(await page.evaluate(()=>compactLab.state.settings.autoStart),false);
    await page.getByRole('switch',{name:'Автоподключение маршрута',exact:true}).click();
    const restored=page.getByRole('switch',{name:'Запускать при старте Windows',exact:true});await restored.waitFor();assert.equal(await restored.getAttribute('aria-checked'),'false');
  });
  await check('help-focus-ref-and-keyboard','settings',async (page,result)=>{
    const control=page.getByRole('switch',{name:'Сворачивать в трей',exact:true});
    const help=page.getByRole('button',{name:'Пояснение: Сворачивать в трей',exact:true});
    await control.focus();await page.keyboard.press('Tab');await expectFocused(help);
    assert.equal(await help.getAttribute('aria-expanded'),'true');
    const hint=page.locator('.toggle-setting-hint.visible');await hint.waitFor();
    assert.equal(await hint.textContent(),'Крестик прячет окно в трей вместо выхода.');
    const helpBox=await help.boundingBox(),hintBox=await hint.boundingBox();
    result.anchor={helpBox,hintBox,ancestors:await hint.evaluate(el=>{const items=[];for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);items.push({tag:p.tagName,className:p.className,position:s.position,transform:s.transform,filter:s.filter,backdropFilter:s.backdropFilter,contain:s.contain,willChange:s.willChange})}return items})};
    assert.ok(Math.abs(hintBox.y-(helpBox.y+helpBox.height+6))<3,'Tooltip must anchor to the forwarded button ref');
    await page.keyboard.press('Tab');await hint.waitFor({state:'hidden'});assert.equal(await help.getAttribute('aria-expanded'),'false');
    await help.focus();await page.keyboard.press('Enter');assert.equal(await help.getAttribute('aria-expanded'),'false');
    await page.keyboard.press('Enter');assert.equal(await help.getAttribute('aria-expanded'),'true');assert.deepEqual(await calls(page),[]);
  });
  await check('privacy-help-narrow-viewport','settings',async (page,result)=>{
    const help=page.getByRole('button',{name:'Пояснение: Передавать HWID провайдеру подписки',exact:true});
    await help.scrollIntoViewIfNeeded();await help.focus();
    const hint=page.locator('.toggle-setting-hint.visible');await hint.waitFor();
    assert.equal(await hint.textContent(),'Идентификатор устройства уходит с запросом подписки.');
    const helpBox=await help.boundingBox(),hintBox=await hint.boundingBox();
    result.bounds={helpBox,hintBox,viewport:page.viewportSize()};
    assert.ok(hintBox.x>=0&&hintBox.y>=0&&hintBox.x+hintBox.width<=550&&hintBox.y+hintBox.height<=728,'Privacy tooltip must fit within the 550x728 viewport after scrolling the help button into view');
    assert.deepEqual(await calls(page),[]);
  },{width:550,height:728});
  await check('release-actions-fit','settings',async page=>{
    const actions=page.locator('.settings-release-actions > button');
    await actions.nth(1).waitFor();
    const layout=await actions.evaluateAll(buttons=>buttons.map(button=>{const rect=button.getBoundingClientRect();return {label:button.textContent.trim(),left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width}}));
    const geometry=await page.evaluate(()=>{const layout=document.querySelector('.settings-layout'),service=document.querySelector('.settings-service-surface'),version=document.querySelector('.settings-layout > .app-version');const rect=element=>{const value=element?.getBoundingClientRect();return value?{top:value.top,bottom:value.bottom,height:value.height}:null};return {layout:rect(layout),service:rect(service),version:rect(version),versionVisible:Boolean(version&&getComputedStyle(version).display!=='none')}});
    assert.equal(layout.length,2);
    assert.ok(layout.every(item=>item.width>0&&item.right<=page.viewportSize().width+0.5));
    assert.ok(layout[1].top>=layout[0].bottom-0.5||layout[1].left>=layout[0].right-0.5,'Release actions must not overlap');
    assert.ok(!geometry.versionVisible||!geometry.service||!geometry.version||geometry.version.top>=geometry.service.bottom-0.5,'App version must not overlap service settings');
    assert.match(layout[0].label,/Открыть релиз/);assert.match(layout[1].label,/Проверить/);
  },{width:550,height:728});
  await check('dns-presets-and-confirmed-apply','dns',async page=>{
    for(const [name,primary,secondary] of [['Cloudflare','1.1.1.1','1.0.0.1'],['Google DNS','8.8.8.8','8.8.4.4'],['Quad9','9.9.9.9','149.112.112.112'],['AdGuard','94.140.14.14','94.140.15.15']]){
      await page.getByRole('button',{name:new RegExp('^'+name)}).click();assert.equal(await page.getByLabel('Основной DNS',{exact:true}).inputValue(),primary);assert.equal(await page.getByLabel('Дополнительный DNS',{exact:true}).inputValue(),secondary);
    }
    assert.deepEqual(await calls(page),[]);
    await page.getByRole('button',{name:'Установить',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Установить DNS',exact:true});await dialog.waitFor();assert.deepEqual(await calls(page),[]);
    await dialog.getByRole('button',{name:'Установить',exact:true}).click();await page.waitForFunction(()=>compactLab.calls.length===1);
    assert.deepEqual(await calls(page),[{name:'system.setDnsServers',args:['94.140.14.14\n94.140.15.15']}]);
  });
  await check('zapret-routes-four-fields-save','zapret',async page=>{
    await page.getByRole('tab',{name:'Маршруты',exact:true}).click();
    const fields=[['Добавить в обработку','one.example.test\ntwo.example.test'],['Добавить IP / CIDR в обработку','192.0.2.0/24'],['Исключённые домены','exclude.example.test'],['Исключённые IP / CIDR','198.51.100.0/24']];
    assert.equal(await page.locator('.zapret-routes-flowseal textarea').count(),4);
    await page.waitForFunction(()=>compactLab.reads['zapret.getUserLists']>0);
    for(const [label,value] of fields)await page.getByRole('textbox',{name:label,exact:true}).fill(value);
    assert.deepEqual(await calls(page),[]);await page.getByRole('button',{name:'Сохранить и применить',exact:true}).click();await page.waitForFunction(()=>compactLab.calls.length===1);
    assert.deepEqual(await calls(page),[{name:'zapret.saveUserLists',args:[{generalDomains:['one.example.test','two.example.test'],includedCidrs:['192.0.2.0/24'],excludedDomains:['exclude.example.test'],excludedCidrs:['198.51.100.0/24']}]}]);
  });
  await check('telegram-advanced-draft-passive-refresh','telegram-proxy',async page=>{
    await page.getByText('Расширенные настройки',{exact:true}).click();
    for(const label of ['Локальный адрес','Порт','Secret (32 hex-символа)','Прямые Telegram DC (необязательно, по одному на строку)','Буфер, КБ','Пул соединений','Лимит лога, МБ'])assert.ok(await page.getByLabel(label,{exact:true}).isVisible(),label);
    for(const label of ['Подробный журнал','Проверять обновления runtime'])assert.ok(await page.getByRole('switch',{name:label,exact:true}).isVisible());
    await page.getByLabel('Порт',{exact:true}).fill('2443');await page.getByLabel('Пул соединений',{exact:true}).fill('12');
    await page.evaluate(()=>{compactLab.telegram.config.port=3443});await refresh(page);
    await page.getByText('Конфигурация изменилась на стороне службы',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Порт',{exact:true}).inputValue(),'2443');assert.equal(await page.getByLabel('Пул соединений',{exact:true}).inputValue(),'12');assert.deepEqual(await calls(page),[]);
    await page.getByRole('button',{name:'Оставить мои изменения',exact:true}).click();await page.getByRole('button',{name:'Запустить',exact:true}).click();
    await page.waitForFunction(()=>compactLab.calls.length===2);const writes=await calls(page);
    assert.equal(writes[0].name,'telegramProxy.saveConfig');assert.equal(writes[0].args[0].port,2443);assert.equal(writes[0].args[0].poolSize,12);assert.equal(writes[1].name,'telegramProxy.start');
  });
  await check('generic-dialog-escape-focus-trap','dashboard',async page=>{
    const opener=page.getByRole('button',{name:'Восстановить интернет',exact:true});await opener.click();await dialogKeyboard(page,page.getByRole('dialog',{name:'Восстановить настройки',exact:true}),opener);assert.deepEqual(await calls(page),[]);
  });
  await check('about-dialog-escape-focus-trap','dashboard',async page=>{
    await page.evaluate(()=>{window.__qaVersion='9.8.7';window.__qaBuildDate='17.04.2042'});
    const opener=page.getByRole('button',{name:'О приложении',exact:true});await opener.click();
    const dialog=page.getByRole('dialog');
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role="dialog"] .modal-meta-row strong')).some(element=>element.textContent==='9.8.7'));
    const rows=dialog.locator('.modal-meta-row');
    assert.equal(await rows.nth(0).locator('span').innerText(),'Версия Egoist Shield:');
    assert.equal(await rows.nth(0).locator('strong').innerText(),'9.8.7');
    assert.equal(await rows.nth(1).locator('span').innerText(),'Дата сборки:');
    assert.equal(await rows.nth(1).locator('strong').innerText(),'17.04.2042');
    const copy=await dialog.innerText();
    assert.doesNotMatch(copy,/10\.08\.2026|Версия приложения Lagom/);
    assert.equal(await dialog.locator('.modal-list-title').textContent(),`Что нового в ${packageVersion}:`);
    await dialogKeyboard(page,dialog,opener);assert.deepEqual(await calls(page),[]);
  });
  for (const viewport of [{width:820,height:760},{width:550,height:740}]) await check(`zapret-recommendation-fit-${viewport.width}`,'zapret',async (page,result)=>{
    await page.evaluate(()=>{
      const names=Array.from({length:23},(_,index)=>index===22?'general (EGOIST MIX)':`general (ALT${index+1})`);
      const targets=['DiscordMain','DiscordGateway','DiscordCDN','DiscordVoiceControl','YouTubeWeb','YouTubeShort','YouTubeImage'].map(key=>({key,label:key,url:'https://example.test/',ok:true,pingMs:42}));
      const results=names.map((name,index)=>({configName:name,result:'success',pingMs:index===22?42:85,passedTargets:7,totalTargets:7,targets}));
      localStorage.setItem('qa-zapret-profiles',JSON.stringify(names.map(name=>({name,fileName:`${name}.bat`}))));
      localStorage.setItem('egoistshield.zapret.autoSelect',JSON.stringify({schemaVersion:2,targetCount:17,completed:true,cancelled:false,earlyExit:false,totalProfiles:23,testedProfiles:names,bestProfile:names[22],results,testResults:results,goodProfiles:names,badProfiles:[],testedAt:new Date().toISOString()}));
    });
    await page.reload({waitUntil:'networkidle'});
    await page.waitForFunction(()=>compactLab.reads['state.get']>0);
    if(await page.locator('.shield-settings-open-btn').isVisible())await page.locator('.shield-settings-open-btn').click();
    await page.getByRole('button',{name:'Профили',exact:true}).click();
    const banner=page.getByTestId('zapret-best-banner');await banner.waitFor();
    const button=page.getByTestId('zapret-best-connect');
    result.layout=await banner.evaluate(element=>{const button=element.querySelector('button'),title=element.querySelector('strong'),body=element.querySelector('small'),status=element.closest('.zapret-status-panel'),workbench=document.querySelector('.zapret-workbench');const outer=element.getBoundingClientRect(),inner=button.getBoundingClientRect(),statusBox=status.getBoundingClientRect(),workbenchBox=workbench.getBoundingClientRect();return {bannerWidth:outer.width,buttonWidth:inner.width,buttonScroll:button.scrollWidth,buttonClient:button.clientWidth,buttonWithin:inner.left>=outer.left&&inner.right<=outer.right&&inner.bottom<=outer.bottom+1,titleFits:title.scrollHeight<=title.clientHeight+1,bodyFits:body.scrollHeight<=body.clientHeight+1,insideStatus:outer.bottom<=statusBox.bottom+1,noWorkbenchOverlap:statusBox.bottom<=workbenchBox.top+1}});
    assert.equal(result.layout.buttonWithin,true);
    assert.ok(result.layout.buttonScroll<=result.layout.buttonClient+1,JSON.stringify(result.layout));
    assert.equal(result.layout.titleFits,true);assert.equal(result.layout.bodyFits,true);
    assert.equal(result.layout.insideStatus,true);assert.equal(result.layout.noWorkbenchOverlap,true);
    assert.match(await banner.innerText(),/23 профилей/);
    assert.equal(await page.getByTestId('zapret-history-row').count(),23);
    assert.deepEqual(await calls(page),[],'Recommendation must not auto-connect');
    await button.focus();assert.equal(await button.getAttribute('aria-label'),'Подключить рекомендованный профиль general (EGOIST MIX)');
  },viewport);
  for (const viewport of [{width:1440,height:940},{width:820,height:760}]) await check(`button-text-fit-${viewport.width}`,'settings',async (page,result)=>{
    result.screens=[];
    for (const label of ['Обзор','Соединение','DNS','Профили','Telegram','Настройки']) {
      await page.getByRole('button',{name:label,exact:true}).click();
      const clipped=await page.evaluate(()=>[...document.querySelectorAll('button')].filter(button=>{
        const style=getComputedStyle(button);
        return button.getClientRects().length>0&&button.clientHeight>=24&&style.visibility!=='hidden'&&style.display!=='none'&&button.textContent.trim().length>1&&
          ((style.overflowX!=='visible'&&button.scrollWidth>button.clientWidth+2)||(style.overflowY!=='visible'&&button.scrollHeight>button.clientHeight+2));
      }).map(button=>({text:button.textContent.trim().slice(0,80),className:button.className,scrollWidth:button.scrollWidth,clientWidth:button.clientWidth,scrollHeight:button.scrollHeight,clientHeight:button.clientHeight})));
      result.screens.push({label,clipped});
    }
    assert.deepEqual(result.screens.flatMap(screen=>screen.clipped.map(item=>({...item,screen:screen.label}))),[]);
  },viewport);
  await check('server-picker-escape-focus-trap','dashboard',async page=>{
    const opener=page.locator('.ruby-server-select');await opener.click();await dialogKeyboard(page,page.getByRole('dialog',{name:'Выберите сервер',exact:true}),opener);assert.deepEqual(await calls(page),[]);
  });
  for(const viewport of [{width:550,height:370},{width:512,height:364}]){
    const suffix=`${viewport.width}x${viewport.height}`;
    const inside=box=>box&&box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height;
    await check(`zoom-settings-tooltips-${suffix}`,'settings',async (page,result)=>{
      result.tooltips=[];
      for(const [key,label] of preferences){
        const help=page.getByRole('button',{name:`Пояснение: ${label}`,exact:true});
        await help.scrollIntoViewIfNeeded();await help.focus();
        const hint=page.locator('.toggle-setting-hint.visible');await hint.waitFor();
        const helpBox=await help.boundingBox(),hintBox=await hint.boundingBox();
        const overlaps=hintBox.x<helpBox.x+helpBox.width&&hintBox.x+hintBox.width>helpBox.x&&hintBox.y<helpBox.y+helpBox.height&&hintBox.y+hintBox.height>helpBox.y;
        result.tooltips.push({key,label,helpBox,hintBox,insideViewport:inside(hintBox),coversOwnTrigger:overlaps});
        await page.screenshot({path:path.join(evidence,`zoom-tooltip-${suffix}-${key}.png`)});
        await page.keyboard.press('Tab');await hint.waitFor({state:'hidden'});
      }
      assert.deepEqual(await calls(page),[]);
      assert.deepEqual(result.tooltips.filter(item=>!item.insideViewport||item.coversOwnTrigger),[],`All seven tooltips must fit and avoid covering their trigger at ${suffix}`);
    },viewport);
    for(const kind of ['generic'])await check(`zoom-${kind}-modal-${suffix}`,'dashboard',async (page,result)=>{
      const opener=page.getByRole('button',{name:'Восстановить интернет',exact:true});
      await page.evaluate(()=>{window.compactFocusEvents=[];document.addEventListener('focusin',event=>compactFocusEvents.push({tag:event.target.tagName,className:event.target.className,text:event.target.textContent.slice(0,90),at:performance.now()}))});
      await opener.click();
      const dialog=page.getByRole('dialog',{name:'Восстановить настройки',exact:true});await dialog.waitFor();
      result.controls=[];
      const buttons=dialog.locator('button');
      for(let index=0;index<await buttons.count();index++){
        const button=buttons.nth(index);await button.scrollIntoViewIfNeeded();
        const box=await button.boundingBox();
        const receivesPointer=await button.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el||el.contains(hit)});
        result.controls.push({label:await button.getAttribute('aria-label')||await button.textContent(),box,insideViewport:inside(box),receivesPointer});
      }
      await page.screenshot({path:path.join(evidence,`zoom-${kind}-modal-${suffix}-open.png`)});
      const cancel=dialog.getByRole('button',{name:'Отмена',exact:true});await cancel.click();await dialog.waitFor({state:'hidden'});
      result.focusAfterCancel=await page.evaluate(()=>({active:{tag:document.activeElement?.tagName,className:document.activeElement?.className,text:document.activeElement?.textContent?.slice(0,120)},events:compactFocusEvents}));
      await expectFocused(opener);
      await opener.click();await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      result.focusAfterEscape=await page.evaluate(()=>({active:{tag:document.activeElement?.tagName,className:document.activeElement?.className,text:document.activeElement?.textContent?.slice(0,120)},events:compactFocusEvents}));
      await expectFocused(opener);
      assert.deepEqual(await calls(page),[],'Cancel and Escape must not dispatch mutations');
      assert.deepEqual(result.controls.filter(item=>!item.insideViewport||!item.receivesPointer),[],`All ${kind} dialog actions must be reachable by scrolling at ${suffix}`);
    },viewport);
  }
  assert.deepEqual(report.blockedRequests,[],'Renderer attempted requests outside the local fixture server');
}catch(error){report.fatal=error.stack??String(error)}
finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));
  const current=[];
  for(const entry of manifest){const data=await fs.readFile(path.join(build,entry.name.slice(1))).catch(()=>null);if(!data||hash(data)!==entry.sha256)current.push(entry.name)}
  report.buildChangedDuringRun=current;
  report.finishedAt=new Date().toISOString();
  report.passed=!report.fatal&&report.checks.length===25&&report.checks.every(c=>c.status==='passed')&&current.length===0;
  await fs.writeFile(path.join(evidence,'compact-ui-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,failed:report.checks.filter(c=>c.status!=='passed').map(c=>c.id),buildChanged:current,evidence}));
  if(!report.passed)process.exitCode=1;
}
