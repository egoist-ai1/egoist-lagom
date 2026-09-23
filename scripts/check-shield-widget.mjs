import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const evidence = process.argv[2];
if (!evidence || !path.isAbsolute(evidence)) throw new Error('Supply an absolute task-owned evidence directory');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = path.resolve(import.meta.dirname, '../.vite/renderer/main_window');
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
  const data = window.shieldLab = { state, status:{ phase:'idle',busy:false,progress:0,running:false,dnsRunning:initialDnsRunning,error:null }, statusFailures, calls:[], failure:null, finish:null };
  let progress;
  window.egoistAPI = {
    state:{ get:async()=>structuredClone(state), set:async next=>Object.assign(state,next) },
    app:{ isAdmin:async()=>false, getVersion:async()=>({version:'3.7.0'}), isFirstRun:async()=>false },
    shield:{ status:async()=>{
      if(data.statusFailures>0){data.statusFailures--;throw new Error('Temporary IPC timeout')}
      return structuredClone(data.status);
    }, onProgress:callback=>{progress=callback;return()=>{progress=null}},
      connect:async options=>{
        data.calls.push(['connect',options]);
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
    system:{systemDohStatus:async()=>({running:data.status.dnsRunning}),dnsControllerStatus:async()=>({mode:'system-default'}),dnsDiagnostics:async()=>({targets:[],summary:{}}),getMyIp:async()=>({}),pingActiveProxy:async()=>null,onSpeedtestProgress:noop,applySystemDoh:async()=>{data.calls.push(['dns-on']);data.status.dnsRunning=true;return{ok:true}},resetSystemDoh:async()=>{data.calls.push(['dns-off']);data.status.dnsRunning=false;return{ok:true}}},
    telegramProxy:{status:async()=>({running:false,config:{}}),tailLogs:async()=>[]},health:{getReport:async()=>({})},network:{inspect:async()=>({})},logs:{getRuntimeSummary:async()=>[]},traffic:{onUpdate:noop},autoConnect:{onAutoConnect:noop},
    updater:{getLastResult:async()=>null,onUpdateAvailable:noop,onDownloadProgress:noop,onUpdateDownloaded:noop,onUpdateNotAvailable:noop,onUpdateError:noop}
  };
}
let browser;
const report = { checks:[], errors:[], limitations:['Headless renderer fixtures; native DWM, installation and network behavior require separate checks.'] };
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
  const overflow = await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.querySelector('.shield-widget-container').getBoundingClientRect().height}));
  assert.ok(overflow.width<=296 && overflow.height<=340, JSON.stringify(overflow));
  await page.screenshot({path:path.join(evidence,'widget-idle.png')});
  report.checks.push('296×340 layout has no horizontal or vertical overflow');
  assert.equal(await page.getByRole('switch',{name:'Зашифрованный DNS',exact:true}).getAttribute('aria-checked'),'true');
  await page.getByRole('button',{name:'Подключить защиту',exact:true}).click();
  await page.getByText('Проверяем general (ALT11)',{exact:true}).waitFor();
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'24');
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
  await page.getByRole('switch',{name:'Зашифрованный DNS',exact:true}).click();
  await page.waitForFunction(()=>!shieldLab.status.dnsRunning);
  report.checks.push('Connected DNS switch sends a real reset action');
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
  assert.notEqual(before,after,'GSAP contour moves during selection');
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
  report.checks.push('GSAP selection animation runs and is disposed after success');
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
  assert.deepEqual(report.errors,[]);
  report.ok=true;
} catch(error) {report.ok=false;report.failure=error.stack;process.exitCode=1;}
finally {await browser?.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(evidence,'widget-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
