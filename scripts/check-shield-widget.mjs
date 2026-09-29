import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const evidence = process.argv[2];
if (!evidence || !path.isAbsolute(evidence)) throw new Error('Supply an absolute task-owned evidence directory');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const buildDir = process.env.EGOIST_UI_BUILD_DIR || path.resolve(import.meta.dirname, '../.vite');
if (!path.isAbsolute(buildDir)) throw new Error('EGOIST_UI_BUILD_DIR must be absolute');
const root = path.join(buildDir, 'renderer/main_window');
await fs.mkdir(evidence, { recursive: true });
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
  if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try {
    res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.woff2':'font/woff2' })[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
function fixture() {
  const noop = () => () => {};
  const state = { settings: { autoStart:false, startMinimized:false, minimizeToTray:false, autoConnect:false, autoUpdate:false, systemDohUrl:'https://resolver.example:8443/dns-query/test', systemDohEnabled:false }, nodes:[], subscriptions:[] };
  const initialDnsRunning = localStorage.getItem('shield_lab_dns_running') === 'true';
  const statusFailures = Number(localStorage.getItem('shield_lab_status_failures') || 0);
  localStorage.removeItem('shield_lab_dns_running');
  localStorage.removeItem('shield_lab_status_failures');
  const data = window.shieldLab = { state, status:{ phase:'idle',busy:false,progress:0,running:false,dnsRunning:initialDnsRunning,telegramRunning:false,error:null }, statusFailures, calls:[], failure:null, finish:null, statusReads:0, statusHold:localStorage.getItem('shield_lab_status_hold')==='true', heldReads:[], holdConnect:false, blockDns:false, telegramReady:true };
  localStorage.removeItem('shield_lab_status_hold');
  data.releaseStatus = (failed=false) => { data.statusHold=false; for(const read of data.heldReads.splice(0)) failed ? read.reject(new Error('Obsolete status read failed')) : read.resolve(structuredClone(data.status)); };
  let progress;
  window.egoistAPI = {
    state:{ get:async()=>structuredClone(state), set:async next=>Object.assign(state,next) },
    app:{ isAdmin:async()=>false, getVersion:async()=>({version:'3.7.0'}), isFirstRun:async()=>false },
    shield:{ status:async()=>{
      data.statusReads++;
      if(data.statusHold)return new Promise((resolve,reject)=>data.heldReads.push({resolve,reject}));
      if(data.statusFailures>0){data.statusFailures--;throw new Error('Temporary IPC timeout')}
      return structuredClone(data.status);
    }, onProgress:callback=>{progress=callback;data.emit=value=>{Object.assign(data.status,value);progress?.(structuredClone(data.status))};return()=>{progress=null;data.emit=null}},
      connect:async options=>{
        data.calls.push(['connect',options]);
        if(data.holdConnect)await new Promise(resolve=>{data.releaseStart=resolve});
        Object.assign(data.status,{phase:'selecting',busy:true,progress:24,message:'Проверяем general (ALT11)'}); progress?.(structuredClone(data.status));
        await new Promise(resolve=>{data.finish=resolve});
        if(data.failure){Object.assign(data.status,{phase:'error',busy:false,error:data.failure});progress?.(structuredClone(data.status));return{ok:false,message:data.failure}}
        Object.assign(data.status,{phase:'connected',busy:false,progress:100,running:true,dnsRunning:options.dnsEnabled,error:null,profile:'general (ALT11)'});state.settings.autoStart=true;progress?.(structuredClone(data.status));return{ok:true};
      },
      disconnect:async()=>{data.calls.push(['disconnect']);Object.assign(data.status,{phase:'idle',busy:false,progress:0,running:false,dnsRunning:false,error:null});progress?.(structuredClone(data.status));return{ok:true}},
      cancel:async()=>{data.calls.push(['cancel']);data.failure='Отменено';data.finish?.();return{ok:true}}
    },
    window:{setWidgetMode:async value=>{data.calls.push(['mode',value]);return value},close:async()=>true,minimize:async()=>true},
    vpn:{status:async()=>({running:false,connected:false}),onFallback:noop},
    zapret:{status:async()=>({serviceRunning:data.status.running,currentProfile:'general (ALT11)'}),listProfiles:async()=>[{name:'general (ALT11)'}],getUserLists:async()=>({generalDomains:[],includedCidrs:[],excludedDomains:[],excludedCidrs:[]}),onAutoSelectProgress:noop},
    system:{systemDohStatus:async()=>({running:data.status.dnsRunning}),dnsControllerStatus:async()=>({mode:'system-default'}),dnsDiagnostics:async()=>({targets:[],summary:{}}),getMyIp:async()=>({}),pingActiveProxy:async()=>null,onSpeedtestProgress:noop,applySystemDoh:async()=>{data.calls.push(['dns-on']);if(!data.blockDns)data.status.dnsRunning=true;return{ok:true}},resetSystemDoh:async()=>{data.calls.push(['dns-off']);if(!data.blockDns)data.status.dnsRunning=false;return{ok:true}}},
    telegramProxy:{status:async()=>({running:data.status.telegramRunning,config:{}}),tailLogs:async()=>[],start:async()=>{data.calls.push(['tg-on']);data.status.telegramRunning=data.telegramReady;return{ok:true,serviceRunning:true,running:data.telegramReady,runtimeReady:data.telegramReady,listenerReady:data.telegramReady}},stop:async()=>{data.calls.push(['tg-off']);data.status.telegramRunning=false;return{ok:true,running:false,serviceRunning:false,runtimeReady:false,listenerReady:false}}},health:{getReport:async()=>({})},network:{inspect:async()=>({})},logs:{getRuntimeSummary:async()=>[]},traffic:{onUpdate:noop},autoConnect:{onAutoConnect:noop},
    updater:{getLastResult:async()=>null,onUpdateAvailable:noop,onDownloadProgress:noop,onUpdateDownloaded:noop,onUpdateNotAvailable:noop,onUpdateError:noop}
  };
}
let browser;
const report = { checks:[], errors:[], testEnvironment:'Headless renderer with fixture/mocked egoistAPI; no production IPC or real network reset.', limitations:['Headless renderer fixtures; native DWM, installation and network behavior require separate checks.'] };
async function checkConnectedHover(page, mode) {
  const trigger = page.getByRole('button',{name:'Отключить защиту',exact:true});
  const glyphs = () => page.locator('.shield-widget-emblem').evaluate(el=>{
    const power=getComputedStyle(el.querySelector('.shield-power')),check=getComputedStyle(el.querySelector('.shield-connected-check'));
    return {powerVisible:power.visibility,checkVisible:check.visibility,powerOpacity:power.opacity,checkOpacity:check.opacity,powerStroke:power.stroke,fill:getComputedStyle(el.querySelector('.shield-base-fill')).fill};
  });
  const sampleTransition = () => page.locator('.shield-widget-emblem').evaluate(el=>new Promise(resolve=>{
    const start=performance.now();let samples=0,overlap=false;
    const sample=()=>{const power=getComputedStyle(el.querySelector('.shield-power')),check=getComputedStyle(el.querySelector('.shield-connected-check'));samples++;overlap ||= power.visibility==='visible'&&check.visibility==='visible'&&Number(power.opacity)>0&&Number(check.opacity)>0;performance.now()-start<380?requestAnimationFrame(sample):resolve({samples,overlap})};sample();
  }));
  await page.mouse.move(1,1);
  await page.waitForTimeout(380);
  const initial=await glyphs();
  await trigger.hover();
  const entered=await glyphs();
  (report.hoverObservations ||= []).push({mode,initial,entered});
  assert.equal(entered.checkVisible,'hidden','The connected check disappears immediately on hover');
  assert.equal(initial.powerVisible,'hidden');
  assert.equal(initial.checkVisible,'visible');
  const entering=await sampleTransition();
  assert.equal(entering.overlap,false,'Hover entry never paints both glyphs');
  const hovered=await glyphs();
  assert.equal(hovered.powerVisible,'visible');assert.equal(hovered.powerOpacity,'1');assert.equal(hovered.powerStroke,'rgb(255, 255, 255)');assert.equal(hovered.fill,'rgb(39, 39, 42)');
  await page.mouse.move(1,1);
  assert.equal((await glyphs()).powerVisible,'hidden','The power glyph disappears immediately on hover leave');
  const leaving=await sampleTransition();
  assert.equal(leaving.overlap,false,'Hover leave never paints both glyphs');
  const settled=await glyphs();assert.equal(settled.checkVisible,'visible');assert.equal(settled.checkOpacity,'1');assert.equal(settled.fill,'rgb(255, 255, 255)');
  report.checks.push(`Connected hover has exclusive glyph visibility on entry and leave (${mode}; ${entering.samples+leaving.samples} frame samples)`);
}
try {
  browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {}) });
  const context = await browser.newContext({ viewport:{width:296,height:340}, reducedMotion:'reduce' });
  await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('pageerror', error=>report.errors.push(error.message));
  await page.addInitScript(fixture);
  await page.goto(origin, {waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Подключить защиту',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.shield-interactive-trigger').disabled);
  const idleGlyphs=await page.locator('.shield-widget-emblem').evaluate(el=>({powerVisibility:getComputedStyle(el.querySelector('.shield-power')).visibility,powerOpacity:getComputedStyle(el.querySelector('.shield-power')).opacity,checkOpacity:getComputedStyle(el.querySelector('.shield-connected-check')).opacity}));
  assert.equal(idleGlyphs.powerVisibility,'visible');assert.equal(idleGlyphs.powerOpacity,'0.95');assert.equal(idleGlyphs.checkOpacity,'0');
  const overflow = await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.querySelector('.shield-widget-container').getBoundingClientRect().height}));
  assert.ok(overflow.width<=296 && overflow.height<=340, JSON.stringify(overflow));
  await page.screenshot({path:path.join(evidence,'widget-idle.png')});
  report.checks.push('296×340 layout has no horizontal or vertical overflow');
  assert.equal(await page.getByRole('switch',{name:'Зашифрованный DNS',exact:true}).getAttribute('aria-checked'),'true');
  await page.getByRole('button',{name:'Подключить защиту',exact:true}).click();
  await page.getByText('Проверяем general (ALT11)',{exact:true}).waitFor();
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'24');
  const busyGlyphs=await page.locator('.shield-widget-emblem').evaluate(el=>({powerVisibility:getComputedStyle(el.querySelector('.shield-power')).visibility,powerOpacity:getComputedStyle(el.querySelector('.shield-power')).opacity,checkOpacity:getComputedStyle(el.querySelector('.shield-connected-check')).opacity}));
  assert.equal(busyGlyphs.powerVisibility,'visible');assert.ok(Number(busyGlyphs.powerOpacity)>0);assert.equal(busyGlyphs.checkOpacity,'0');
  report.checks.push('Idle and busy glyphs keep their existing power symbol and hidden check');
  assert.ok(await page.locator('.shield-widget-footer').evaluate(el=>el.getBoundingClientRect().bottom<=340),'Progress keeps footer inside the compact window');
  await page.screenshot({path:path.join(evidence,'widget-progress.png')});
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.setViewportSize({width:1360,height:900});
  await page.getByRole('navigation',{name:'Основная навигация'}).waitFor();
  await page.screenshot({path:path.join(evidence,'dashboard.png')});
  await page.getByRole('button',{name:'Виджет',exact:true}).click();
  await page.setViewportSize({width:296,height:340});
  await page.getByText('Проверяем general (ALT11)',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>shieldLab.calls.filter(x=>x[0]==='connect').length),1);
  report.checks.push('Dashboard round-trip retains a single active connection');
  await page.evaluate(()=>shieldLab.finish());
  await page.getByRole('heading',{name:'Подключено',exact:true}).waitFor();
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'100');
  await page.screenshot({path:path.join(evidence,'widget-connected.png')});
  await checkConnectedHover(page,'reduced motion');
  await page.getByRole('switch',{name:'Зашифрованный DNS',exact:true}).click();
  await page.waitForFunction(()=>!shieldLab.status.dnsRunning);
  report.checks.push('Connected DNS switch dispatches the reset action to the fixture API');
  await page.getByRole('button',{name:'Отключить защиту',exact:true}).click();
  await page.getByRole('button',{name:'Подключить защиту',exact:true}).waitFor();
  await page.evaluate(()=>{shieldLab.failure='DNS не прошёл проверку. Исходные настройки сети восстановлены. Проверьте доступность сервера и повторите подключение.'});
  await page.getByRole('button',{name:'Подключить защиту',exact:true}).click();
  await page.waitForFunction(()=>shieldLab.status.busy);
  await page.evaluate(()=>shieldLab.finish());
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(),/Исходные настройки/);
  await page.screenshot({path:path.join(evidence,'widget-error.png'),fullPage:true});
  report.checks.push('Failure remains readable with a retry action');
  await page.getByRole('button',{name:'Подключить защиту',exact:true}).focus();
  assert.ok(await page.getByRole('button',{name:'Подключить защиту',exact:true}).evaluate(el=>el===document.activeElement));
  assert.equal(await page.locator('.shield-live-dot').evaluate(el=>getComputedStyle(el).animationName),'none');
  report.checks.push('Keyboard focus and reduced motion');
  assert.equal(await page.locator('.shield-widget-container').evaluate(el=>el.getAnimations({subtree:true}).length),0,'Reduced motion disables CSS loops as well as GSAP');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Подключить защиту',exact:true}).click();
  await page.getByText('Проверяем general (ALT11)',{exact:true}).waitFor();
  const before=await page.locator('.shield-travel-edge').evaluate(el=>getComputedStyle(el).strokeDashoffset);
  await page.waitForTimeout(180);
  const after=await page.locator('.shield-travel-edge').evaluate(el=>getComputedStyle(el).strokeDashoffset);
  assert.notEqual(before,after,'CSS contour moves during selection');
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('.shield-travel-edge').evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
  const paused=await page.locator('.shield-travel-edge').evaluate(el=>getComputedStyle(el).strokeDashoffset);
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.shield-travel-edge').evaluate(el=>getComputedStyle(el).strokeDashoffset),paused,'Hidden widget stops CSS motion');
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  report.checks.push('Hidden widget pauses its continuous motion');
  await page.evaluate(()=>shieldLab.finish());
  await page.getByRole('heading',{name:'Подключено',exact:true}).waitFor();
  await page.waitForTimeout(600);
  const timelines=await page.evaluate(()=>ShieldMotion.gsap.globalTimeline.getChildren().filter(t=>t.repeat?.()===-1).length);
  assert.equal(timelines,0,'Selection loop is reverted after success');
  const cssLoops=await page.locator('.shield-widget-container').evaluate(el=>el.getAnimations({subtree:true}).filter(animation=>animation.effect?.getTiming().iterations===Infinity).length);
  assert.equal(cssLoops,0,'A stable connected widget needs no repeating CSS animation');
  report.checks.push('CSS selection contour moves; connected widget has no repeating CSS or GSAP animation');
  await checkConnectedHover(page,'normal motion');
  await page.evaluate(()=>{
    localStorage.setItem('shield_dns_on_connect','false');
    localStorage.setItem('shield_lab_dns_running','true');
  });
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.getByRole('switch',{name:'Зашифрованный DNS',exact:true}).getAttribute('aria-checked'),'true');
  await page.getByRole('switch',{name:'Зашифрованный DNS',exact:true}).click();
  await page.waitForFunction(()=>shieldLab.calls.some(call=>call[0]==='dns-off'));
  assert.equal(await page.evaluate(()=>shieldLab.calls.some(call=>call[0]==='dns-on')),false);
  report.checks.push('Running DNS is shown and reset even when the saved connect preference is off');
  await page.evaluate(()=>localStorage.setItem('shield_lab_status_failures','1'));
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(),/Temporary IPC timeout/);
  await page.getByRole('heading',{name:'Готов к подключению',exact:true}).waitFor({timeout:6500});
  assert.equal(await page.getByRole('alert').count(),0);
  report.checks.push('A successful status refresh clears a transient IPC error');

  await page.evaluate(()=>{shieldLab.holdConnect=true;const button=document.querySelector('.shield-interactive-trigger');button.click();button.click();});
  assert.equal(await page.evaluate(()=>shieldLab.calls.filter(call=>call[0]==='connect').length),1,'Same-turn double click must dispatch one connect');
  await page.waitForTimeout(4250);
  assert.equal(await page.locator('.shield-interactive-trigger').isDisabled(),true,'Polling must not unlock a pending local operation before the first backend event');
  assert.equal(await page.getByRole('switch',{name:'Telegram Proxy',exact:true}).isDisabled(),true,'Related mutations remain locked during connect');
  await page.evaluate(()=>shieldLab.releaseStart());
  await page.getByText('Проверяем general (ALT11)',{exact:true}).waitFor();
  await page.evaluate(()=>{const button=document.querySelector('.shield-cancel');button.click();button.click()});
  await page.waitForFunction(()=>shieldLab.calls.some(call=>call[0]==='cancel'));
  assert.equal(await page.evaluate(()=>shieldLab.calls.filter(call=>call[0]==='cancel').length),1,'Cancellation is single-flight');
  report.checks.push('Same-turn double connect and cancel dispatch one action; polling preserves the local action lock');

  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Готов к подключению',exact:true}).waitFor();
  await page.evaluate(()=>{shieldLab.statusHold=true;document.dispatchEvent(new Event('visibilitychange'))});
  await page.waitForFunction(()=>shieldLab.heldReads.length>0);
  await page.evaluate(()=>{shieldLab.emit({busy:true,phase:'selecting',progress:24,message:'Свежий статус подключения'});shieldLab.releaseStatus(true)});
  await page.getByText('Свежий статус подключения',{exact:true}).waitFor();
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('alert').count(),0,'An obsolete polling rejection must not cover newer progress with an error');
  report.checks.push('Newer progress supersedes an obsolete status-read failure');

  await page.evaluate(()=>localStorage.setItem('shield_lab_status_hold','true'));
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Проверяем состояние…',exact:true}).waitFor();
  assert.equal(await page.locator('.shield-interactive-trigger').isDisabled(),true);
  assert.equal(await page.getByRole('switch',{name:'Зашифрованный DNS',exact:true}).isDisabled(),true);
  await page.evaluate(()=>{document.querySelector('.shield-interactive-trigger').click();shieldLab.releaseStatus()});
  await page.getByRole('heading',{name:'Готов к подключению',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>shieldLab.calls.filter(call=>call[0]==='connect').length),0);
  report.checks.push('Unresolved initial status disables mutations instead of advertising an idle connection');

  await page.evaluate(()=>{shieldLab.emit({running:true,dnsRunning:true,phase:'connected'});shieldLab.blockDns=true});
  await page.getByRole('heading',{name:'Подключено',exact:true}).waitFor();
  await page.getByRole('switch',{name:'Зашифрованный DNS',exact:true}).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(),/не подтвердила изменение DNS/);
  assert.equal(await page.getByRole('switch',{name:'Зашифрованный DNS',exact:true}).getAttribute('aria-checked'),'true');
  report.checks.push('A successful DNS IPC result cannot replace a contradictory observed state');

  await page.evaluate(()=>{shieldLab.telegramReady=false;shieldLab.emit({running:true,dnsRunning:true,telegramRunning:false,error:null})});
  await page.getByRole('switch',{name:'Telegram Proxy',exact:true}).click();
  await page.waitForFunction(()=>shieldLab.calls.some(call=>call[0]==='tg-on'));
  assert.equal(await page.getByRole('switch',{name:'Telegram Proxy',exact:true}).getAttribute('aria-checked'),'false');
  assert.match(await page.getByRole('alert').innerText(),/Не удалось изменить Telegram/);
  report.checks.push('SCM running without a ready Telegram listener cannot be shown as active');

  await page.evaluate(()=>{shieldLab.blockDns=false;shieldLab.telegramReady=true;shieldLab.emit({running:true,dnsRunning:true,telegramRunning:false,error:null})});
  const beforeBurst=await page.evaluate(()=>shieldLab.calls.length);
  await page.evaluate(()=>{const [dns,tg]=document.querySelectorAll('.shield-switch-toggle');for(let index=0;index<100;index++)dns.click();for(let index=0;index<100;index++)tg.click()});
  await page.waitForFunction(()=>!shieldLab.status.dnsRunning&&!document.querySelector('.shield-switch-toggle').disabled);
  const dnsBurst=await page.evaluate(start=>shieldLab.calls.slice(start),beforeBurst);
  assert.deepEqual(dnsBurst,[['dns-off']],'200 same-turn component clicks dispatch one DNS operation and no conflicting Telegram operation');
  const beforeTelegramBurst=await page.evaluate(()=>shieldLab.calls.length);
  await page.evaluate(()=>{const tg=document.querySelectorAll('.shield-switch-toggle')[1];for(let index=0;index<100;index++)tg.click()});
  await page.waitForFunction(()=>shieldLab.status.telegramRunning&&!document.querySelector('.shield-switch-toggle').disabled);
  const tgBurst=await page.evaluate(start=>shieldLab.calls.slice(start),beforeTelegramBurst);
  assert.deepEqual(tgBurst,[['tg-on']]);
  assert.equal(await page.getByRole('heading',{name:'Подключено',exact:true}).count(),1,'Current healthy connection remains visible alongside a prior failed action');
  report.checks.push('300 same-turn component clicks dispatch one DNS and one Telegram action with no conflict');

  await page.getByRole('button',{name:'Отключить защиту',exact:true}).click();
  await page.getByRole('button',{name:'Подключить защиту',exact:true}).waitFor();
  await page.evaluate(()=>shieldLab.emit({error:'Начало подробной ошибки. '+ 'Подробности проверки службы и сети. '.repeat(16)+' Последняя строка ошибки.'}));
  const details=page.getByRole('alert');await details.waitFor();await details.focus();
  const errorScroll=await details.evaluate(el=>{el.scrollTop=el.scrollHeight;return {overflow:getComputedStyle(el).overflowY,scrollTop:el.scrollTop,text:el.textContent}});
  assert.equal(errorScroll.overflow,'auto');assert.ok(errorScroll.scrollTop>0);assert.match(errorScroll.text,/Последняя строка ошибки\.$/);
  const targets=await page.locator('.shield-widget-container button').evaluateAll(buttons=>buttons.map(el=>{const r=el.getBoundingClientRect();return {label:el.getAttribute('aria-label')||el.textContent,width:r.width,height:r.height}}));
  assert.deepEqual(targets.filter(target=>target.width<24||target.height<24),[],'All widget buttons have 24 CSS pixel targets');
  await page.screenshot({path:path.join(evidence,'widget-error-details.png')});
  await page.setViewportSize({width:148,height:170});
  await page.screenshot({path:path.join(evidence,'widget-200-percent.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=148),'200 percent equivalent widget has no horizontal overflow');
  await details.scrollIntoViewIfNeeded();
  const errorVisible=await details.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el||el.contains(hit)});
  assert.equal(errorVisible,true,'Short-window controls must not overlay the full error details');
  await page.screenshot({path:path.join(evidence,'widget-200-percent-error.png')});
  await page.getByRole('button',{name:'Настройки',exact:true}).scrollIntoViewIfNeeded();
  assert.ok(await page.getByRole('button',{name:'Настройки',exact:true}).isVisible());
  report.checks.push('Full error details scroll with keyboard focus, 24px targets and 200 percent equivalent layout');
  assert.deepEqual(report.errors,[]);
  report.ok=true;
} catch(error) {report.ok=false;report.failure=error.stack;process.exitCode=1;}
finally {await browser?.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(evidence,'widget-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
