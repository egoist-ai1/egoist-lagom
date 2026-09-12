import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const playwrightModule=process.env.PLAYWRIGHT_MODULE??'playwright';
const {chromium}=await import(path.isAbsolute(playwrightModule)?pathToFileURL(playwrightModule).href:playwrightModule);
const root=path.resolve('.vite/renderer/main_window');
if(!process.argv[2]||!path.isAbsolute(process.argv[2]))throw new Error('Supply an absolute task-scoped evidence directory as the first argument');
const evidence=path.resolve(process.argv[2]);
await fs.mkdir(evidence,{recursive:true});
const server=http.createServer(async(req,res)=>{try{const name=path.resolve(root,'.'+(req.url==='/'?'/index.html':req.url));if(!name.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(name)]||'application/octet-stream');res.end(await fs.readFile(name))}catch{res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:940},reducedMotion:'reduce'});
const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
  const logs=Array.from({length:26},(_,index)=>({timestamp:new Date(Date.now()-index*1000).toISOString(),level:index%7===0?'WARN':'INFO',message:`Событие ${index}: ${'длинное сообщение для проверки переноса строки '.repeat(8)}`}));
  const data=window.lab={calls:[],state:{settings:{systemDohEnabled:true,systemDohUrl:'https://dns.example.test/profile?key=test'},nodes:[],subscriptions:[]},vpn:{connected:false,running:false},doh:{running:false},zapret:{serviceRunning:false,standaloneRunning:false,currentProfile:'general'},telegram:{running:false,serviceInstalled:true}};
  const read=name=>async()=>structuredClone(data[name]);
  const action=(name,fn)=>async(...args)=>{data.calls.push({name,args});return fn?.(...args)??{ok:true}};
  window.egoistAPI={state:{get:read('state'),set:action('state.set',v=>(data.state=v))},app:{isAdmin:async()=>false},vpn:{status:read('vpn'),connect:action('vpn.connect',()=>{data.vpn={connected:true,running:true,egressVerified:false};return data.vpn}),disconnect:action('vpn.disconnect',()=>{data.vpn={connected:false,running:false};return data.vpn})},system:{dnsControllerStatus:async()=>({mode:'system-default'}),systemDohStatus:read('doh'),getMyIp:async()=>({ip:'192.0.2.1',country:'Test',provider:'Test network'}),pingActiveProxy:async()=>18,applySystemDoh:action('system.applySystemDoh',()=>{data.doh={running:true};return data.doh}),resetSystemDoh:action('system.resetSystemDoh',()=>{data.doh={running:false};return data.doh}),internetFix:action('system.internetFix')},zapret:{status:read('zapret'),listProfiles:async()=>[],startStandalone:action('zapret.startStandalone',()=>{data.zapret.standaloneRunning=true}),stopStandalone:action('zapret.stopStandalone',()=>{data.zapret.standaloneRunning=false}),stopService:action('zapret.stopService',()=>{data.zapret.serviceRunning=false})},telegramProxy:{status:read('telegram'),tailLogs:async()=>logs,start:action('telegramProxy.start',()=>{data.telegram.running=true}),stop:action('telegramProxy.stop',()=>{data.telegram.running=false})},health:{getReport:async()=>({})},network:{inspect:async()=>({})},logs:{getRuntimeSummary:async()=>logs}};
});
const refresh=()=>page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
async function check(name,fn){await fn();checks.push(name)}
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'Настройки',exact:true}).click();
 await page.getByRole('button',{name:'Обзор',exact:true}).click();
 await check('Initial render performs no network mutations and ignores stale enabled DNS preference',async()=>{assert.deepEqual(await page.evaluate(()=>lab.calls),[]);assert.equal(await page.getByRole('switch',{name:'DNS',exact:true}).getAttribute('aria-checked'),'false')});
 await check('Connect without selected node opens VPN management without starting a connection',async()=>{await page.locator('.ruby-connect-button').click();await page.waitForFunction(()=>document.querySelector('.screen-stage')?.dataset.screen==='vpn');assert.deepEqual(await page.evaluate(()=>lab.calls),[])});
 await page.evaluate(()=>{lab.state.nodes=[{id:'test-node',name:'Test server',server:'192.0.2.2',port:443,protocol:'vless'},{id:'second-node',name:'Second server',server:'192.0.2.3',port:443,protocol:'trojan'}];lab.state.activeNodeId='test-node'});await refresh();
 await page.getByRole('button',{name:'Обзор',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.ruby-server-select')?.textContent.includes('Test server'));
 await check('Selecting a server persists real node ID without auto-connecting',async()=>{await page.locator('.ruby-server-select').click();await page.getByRole('dialog').getByRole('button',{name:/Second server/}).click();await page.waitForFunction(()=>lab.calls.some(c=>c.name==='state.set'));assert.equal(await page.evaluate(()=>lab.state.activeNodeId),'second-node');assert.equal(await page.evaluate(()=>lab.calls.filter(c=>c.name==='vpn.connect').length),0)});
 await check('Running connection remains unverified until egress proof arrives',async()=>{await page.locator('.ruby-connect-button').click();await page.getByRole('heading',{name:'Проверяем маршрут',exact:true}).waitFor();assert.equal(await page.evaluate(()=>lab.calls.find(c=>c.name==='vpn.connect').args[0]),'second-node');await page.evaluate(()=>{lab.vpn.egressVerified=true;lab.vpn.egressIp='198.51.100.1'});await refresh();await page.getByRole('heading',{name:'Маршрут подключён',exact:true}).waitFor()});
 await check('Disconnect uses the existing connection action',async()=>{await page.getByRole('button',{name:'Отключить',exact:true}).click();await page.getByRole('heading',{name:'Маршрут отключён',exact:true}).waitFor()});
 for(const [name,on,off] of [['DNS','system.applySystemDoh','system.resetSystemDoh'],['Профили','zapret.startStandalone','zapret.stopStandalone'],['Telegram','telegramProxy.start','telegramProxy.stop']])await check(name+' switch starts and stops the corresponding backend action',async()=>{const control=page.getByRole('switch',{name,exact:true});await control.click();await page.waitForFunction(n=>document.querySelector(`[role="switch"][aria-label="${n}"]`)?.getAttribute('aria-checked')==='true',name);await control.click();await page.waitForFunction(n=>document.querySelector(`[role="switch"][aria-label="${n}"]`)?.getAttribute('aria-checked')==='false',name);const calls=await page.evaluate(()=>lab.calls.map(c=>c.name));assert.ok(calls.includes(on)&&calls.includes(off))});
  await check('Restore requires the existing confirmation before mutation',async()=>{await page.getByRole('button',{name:'Восстановить интернет',exact:true}).click();assert.equal(await page.evaluate(()=>lab.calls.filter(c=>c.name==='system.internetFix').length),0);await page.getByRole('button',{name:'Восстановить',exact:true}).click();await page.waitForFunction(()=>lab.calls.some(c=>c.name==='system.internetFix'))});
  await page.getByRole('button',{name:'Telegram',exact:true}).first().click();
  await page.waitForFunction(()=>document.querySelector('.screen-stage')?.dataset.screen==='telegram-proxy');
  await check('Telegram event rows keep a fixed readable rhythm without text overlap',async()=>{
    const boxes=await page.locator('.telegram-status .log-line').evaluateAll(rows=>rows.map(row=>{const rect=row.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,height:rect.height}}));
    assert.ok(boxes.length>=9);
    for(let index=1;index<boxes.length;index++) assert.ok(boxes[index].top>=boxes[index-1].bottom-0.5,`row ${index} overlaps row ${index-1}`);
    assert.ok(boxes.every(box=>box.height>=39));
  });
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({checks,errors},null,2));
 await page.screenshot({path:path.join(evidence,'dashboard-actions.png')});
 await fs.writeFile(path.join(evidence,'action-report.json'),JSON.stringify({checks,errors},null,2));
}finally{await browser.close();server.close()}
