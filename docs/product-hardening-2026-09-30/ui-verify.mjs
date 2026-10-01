import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// UI acceptance uses production renderer/CSS with explicit inert IPC fixtures.
// It measures rendering and interaction only; it does not prove native services.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
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
const calls=[];
const fixture=`(()=>{
  window.__fixtureMode='off'; window.__calls=[];
  const event=()=>()=>{};
  const read=(value)=>async()=>{if(window.__fixtureMode==='unknown')throw new Error('Fixture: Core unavailable');return typeof value==='function'?value():value};
  const active=()=>window.__fixtureMode==='connected';
  const state={stateRevision:3,nodes:[{id:'nA',name:'A · Первый',server:'192.0.2.10',port:443,protocol:'vless',subscriptionId:'A',metadata:{}},{id:'nB',name:'B · Второй',server:'192.0.2.20',port:443,protocol:'vless',subscriptionId:'B',metadata:{}}],subscriptions:[{id:'A',name:'Провайдер A',url:'https://a.example/sub'},{id:'B',name:'Провайдер B',url:'https://b.example/sub'}],activeNodeId:'nB',settings:{autoStart:false,autoConnect:true,autoUpdate:false,minimizeToTray:false,systemDohUrl:'https://resolver.example/dns-query'}};
  const dpi=()=>({serviceInstalled:true,serviceRunning:active(),runtimeReady:active(),currentProfile:'stable'});
  const dns=()=>({running:active(),verified:active(),serviceInstalled:true,serviceRunning:active(),mode:'system-doh',currentUrl:state.settings.systemDohUrl});
  const tg=()=>({running:active(),runtimeReady:active(),listenerReady:active(),serviceInstalled:true,serviceRunning:active(),config:{host:'127.0.0.1',port:1443,secret:'',poolSize:8,bufKb:256,logMaxMb:5,dcIp:[]}});
  const action=(name,value)=>async(...args)=>{window.__calls.push({name,args});return typeof value==='function'?value(...args):value??{ok:true}};
  window.egoistAPI={
    app:{getVersion:async()=>({version:'3.8.0',buildDate:'30.09.2026'}),isAdmin:async()=>false},
    window:{setWidgetMode:async()=>{},onSwitchToWidget:event,minimize:async()=>{},close:async()=>{},toggleMaximize:async()=>{}},
    state:{get:read(state),patchSettings:action('patchSettings',(patch,expectedRevision)=>{if(expectedRevision!==state.stateRevision)return {ok:false,conflict:true,state:{...state},revision:state.stateRevision,error:'STATE_REVISION_CONFLICT'};state.settings={...state.settings,...patch};state.stateRevision+=1;return {ok:true,conflict:false,state:{...state},revision:state.stateRevision}})},node:{select:action('select',state),setFavorite:action('favorite',state)},
    shield:{status:read(()=>({running:active(),dnsRunning:active(),telegramRunning:active(),busy:window.__fixtureMode==='pending',phase:window.__fixtureMode==='pending'?'preparing':'idle',progress:window.__fixtureMode==='pending'?40:0})),onProgress:event},
    vpn:{status:read(()=>({running:active(),connected:active(),egressVerified:active(),egressIp:active()?'198.51.100.9':null,lifecycle:active()?'connected':'idle'}))},
    zapret:{status:read(dpi),listProfiles:async()=>[{name:'stable'}],onAutoSelectProgress:event},
    telegramProxy:{status:read(tg),tailLogs:async()=>[],onLog:event},health:{getReport:async()=>({})},network:{inspect:async()=>({})},
    system:{dnsControllerStatus:read(dns),systemDohStatus:read(dns),getMyIp:async()=>({ip:'203.0.113.1',provider:'Fixture network'}),ping:async()=>30,onSpeedtestProgress:event,dnsDiagnostics:async()=>({}),cancelSpeedtest:async()=>{}},
    logs:{getRuntimeSummary:async()=>[]},traffic:{onUpdate:event},autoConnect:{onAutoConnect:event},
    updater:{onUpdateAvailable:event,onDownloadProgress:event,onUpdateError:event,onUpdateNotAvailable:event,getLastResult:async()=>null,check:async()=>({ok:true,phase:'up-to-date',message:'Fixture: current'})},
    subscription:{deleteById:action('deleteById',true),refreshAll:action('refreshAll',{added:0,issues:[]})}
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
const report={schemaVersion:1,scope:'Production renderer and CSS, inert local IPC fixtures; no SCM/DNS mutations; headless Chromium, not native DPI/FPS/service readiness.',browser:browser.version(),cases:[],errors,contrast:[],interactions:[],nativeSystemMutations:0};
try{
  const page=await browser.newPage({viewport:{width:1060,height:720}});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(!request.url().startsWith(origin)&&!request.url().startsWith('data:'))errors.push('External request: '+new URL(request.url()).origin)});
  await page.goto(origin+'/index.html');
  await page.waitForSelector('.shield-widget-container');
  async function waitPaint(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
  async function snapshot(name){
    await waitPaint();
    const result=await page.evaluate(()=>{
      const scroller=document.querySelector('.shield-widget-container')||document.querySelector('.screen-stage');
      const visible=element=>{const rect=element.getBoundingClientRect(),style=getComputedStyle(element);return rect.width>0&&rect.height>0&&style.visibility!=='hidden'&&style.display!=='none'&&element.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})};
      const controls=[...document.querySelectorAll('button,input,select,textarea,summary')].filter(visible);
      const errors=[...document.querySelectorAll('.ruby-read-notice')].map(element=>element.innerText);
      const blocked=controls.filter(element=>{
        if(element.disabled||element.matches('input[type=checkbox]'))return false;
        const r=element.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
        if(x<0||x>=innerWidth||y<0||y>=innerHeight)return false;
        for(let ancestor=element.parentElement;ancestor;ancestor=ancestor.parentElement){
          const style=getComputedStyle(ancestor),box=ancestor.getBoundingClientRect();
          if(/auto|scroll|hidden|clip/.test(style.overflowX)&&(x<box.left||x>box.right))return false;
          if(/auto|scroll|hidden|clip/.test(style.overflowY)&&(y<box.top||y>box.bottom))return false;
        }
        const top=document.elementFromPoint(x,y);
        return top&&!element.contains(top)&&!top.contains(element);
      }).map(element=>({label:element.getAttribute('aria-label')||element.innerText?.slice(0,80),className:element.className}));
      return {viewport:{width:innerWidth,height:innerHeight},phase:document.querySelector('.shield-widget-container')?.dataset.phase, horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,scroll:{clientHeight:scroller?.clientHeight,scrollHeight:scroller?.scrollHeight},controls:controls.length,lastControl:controls.at(-1)?.getAttribute('aria-label')||controls.at(-1)?.textContent,blockedControls:blocked,readNotices:errors};
    });
    await page.screenshot({path:path.join(work,name+'.png')});
    report.cases.push({name,...result});
    return result;
  }
  for(const [width,height]of [[296,340],[148,170]]){
    await page.setViewportSize({width,height});
    await snapshot('mini-off-'+width);
    await page.locator('.shield-widget-container').evaluate(element=>{element.scrollTop=element.scrollHeight});
    const reachable=await page.locator('.shield-settings-open-btn').evaluate(element=>{const r=element.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight});
    report.interactions.push({name:'mini-settings-reachable-'+width,ok:reachable});
    await snapshot('mini-off-bottom-'+width);
  }
  await page.setViewportSize({width:296,height:340});
  for(const mode of ['connected','pending','unknown']){
    await page.evaluate(mode=>{window.__fixtureMode=mode;document.dispatchEvent(new Event('visibilitychange'))},mode);
    await page.waitForTimeout(100);
    if(mode==='connected'){
      await page.locator('.shield-interactive-trigger').hover();
      const paint=await page.locator('.shield-interactive-trigger').evaluate(element=>({checkVisibility:getComputedStyle(element.querySelector('.shield-connected-check')).visibility,powerVisibility:getComputedStyle(element.querySelector('.shield-power')).visibility,checkOpacity:getComputedStyle(element.querySelector('.shield-connected-check')).opacity,powerStroke:getComputedStyle(element.querySelector('.shield-power')).stroke}));
      report.interactions.push({name:'connected-hover-single-power-glyph',ok:paint.checkVisibility==='hidden'&&paint.powerVisibility==='visible',paint});
      await page.mouse.move(0,0);
      await page.locator('.shield-interactive-trigger').focus();
      const focusPaint=await page.locator('.shield-interactive-trigger').evaluate(element=>({checkVisibility:getComputedStyle(element.querySelector('.shield-connected-check')).visibility,powerVisibility:getComputedStyle(element.querySelector('.shield-power')).visibility}));
      report.interactions.push({name:'connected-keyboard-focus-single-power-glyph',ok:focusPaint.checkVisibility==='hidden'&&focusPaint.powerVisibility==='visible',paint:focusPaint});
    }
    await snapshot('mini-'+mode);
  }
  await page.evaluate(()=>{window.__fixtureMode='off';document.dispatchEvent(new Event('visibilitychange'))});
  await page.waitForTimeout(160);
  await page.locator('.shield-settings-open-btn').click();
  await page.setViewportSize({width:1060,height:720});
  await page.waitForSelector('.ruby-sidebar');
  for(const [width,height]of [[1060,720],[680,450],[340,225]]){
    await page.setViewportSize({width,height});
    for(const screen of ['dashboard','vpn','dns','zapret','telegram-proxy','settings']){
      const index=['dashboard','vpn','dns','zapret','telegram-proxy','settings'].indexOf(screen);
      await page.locator('.ruby-sidebar nav button').nth(index).click();
      await page.waitForTimeout(200);
      await snapshot(width+'-'+screen);
    }
  }
  await page.setViewportSize({width:1060,height:720});
  await page.locator('.ruby-sidebar nav button').nth(5).click();await page.waitForTimeout(160);
  const startup=page.getByRole('switch',{name:'Запускать приложение при входе в Windows'});
  report.interactions.push({name:'auto-connect-does-not-check-app-startup',ok:await startup.getAttribute('aria-checked')==='false'});
  await startup.click();await page.waitForTimeout(100);
  const settingCalls=await page.evaluate(()=>window.__calls.filter(call=>call.name==='patchSettings'));
  report.interactions.push({name:'settings-send-single-field-and-observed-revision',ok:settingCalls.length===1&&Object.keys(settingCalls[0].args[0]).join()==='autoStart'&&settingCalls[0].args[0].autoStart===true&&settingCalls[0].args[1]===3,calls:settingCalls});
  for(const screen of ['dashboard','vpn','dns','zapret','telegram-proxy','settings']){
    const index=['dashboard','vpn','dns','zapret','telegram-proxy','settings'].indexOf(screen);
    await page.locator('.ruby-sidebar nav button').nth(index).click();await page.waitForTimeout(160);
    const measureContrast=()=>{
      const parse=text=>{const values=text.match(/[\d.]+/g)?.map(Number)||[];return {rgb:values.slice(0,3),a:values[3]??1}};
      const mix=(front,back)=>front.rgb.map((channel,index)=>channel*front.a+back[index]*(1-front.a));
      const background=element=>{const chain=[];for(let node=element;node;node=node.parentElement)chain.push(parse(getComputedStyle(node).backgroundColor));let color=[9,9,9];for(const layer of chain.reverse())color=mix(layer,color);return color};
      const luminance=color=>color.map(channel=>{const c=channel/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((value,channel,index)=>value+channel*[.2126,.7152,.0722][index],0);
      const textElements=new Set(document.querySelectorAll('button, .kv-list span, .kv-list strong, .toggle-setting-description, .ruby-component-status, .ruby-page-heading p, .dns-link-head span'));
      const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
      for(let text=walker.nextNode();text;text=walker.nextNode())if(text.textContent.trim())textElements.add(text.parentElement);
      return [...textElements].filter(element=>{
        const r=element.getBoundingClientRect(),s=getComputedStyle(element);return r.width&&r.height&&s.visibility!=='hidden'&&s.display!=='none'&&!element.closest(':disabled')&&element.innerText?.trim()&&element.checkVisibility({checkVisibilityCSS:true,checkOpacity:true});
      }).map(element=>{
        const style=getComputedStyle(element),bg=background(element),foreground=mix(parse(style.color),bg),a=luminance(foreground),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        return {text:element.innerText.trim().slice(0,90),className:element.className,ratio:Number(ratio.toFixed(4)),foreground:style.color,background:bg,fontSize:style.fontSize};
      });
    };
    report.contrast.push({screen,state:'default',pairs:await page.evaluate(measureContrast)});
    const primary=page.locator('.screen-stage .btn-primary:not(:disabled)').first();
    if(await primary.count()){
      await primary.hover();
      report.contrast.push({screen,state:'primary-hover',pairs:await page.evaluate(measureContrast)});
    }
  }
  await page.locator('.ruby-sidebar nav button').nth(1).click();await page.waitForTimeout(160);
  const provider=await page.locator('.vpn-subscription-panel').innerText();
  report.interactions.push({name:'subscription-follows-active-node-B',ok:provider.includes('Провайдер B'),provider});
  await page.locator('.subscription-selector select').selectOption('A');
  await page.getByRole('button',{name:'Удалить подписку',exact:true}).click();
  await page.getByRole('button',{name:'Удалить',exact:true}).click();await page.waitForTimeout(60);
  calls.push(...await page.evaluate(()=>window.__calls));
  report.interactions.push({name:'subscription-delete-captured-selected-A',ok:calls.some(call=>call.name==='deleteById'&&call.args[0]==='A'),calls});
  await page.locator('.ruby-sidebar nav button').nth(2).click();
  await page.evaluate(()=>{window.__fixtureMode='unknown';document.dispatchEvent(new Event('visibilitychange'))});await page.waitForTimeout(140);
  await snapshot('dns-read-failure');
  await page.emulateMedia({reducedMotion:'reduce'});
  const reduced=await page.evaluate(()=>getComputedStyle(document.querySelector('.screen-stage')).animationName);
  report.interactions.push({name:'reduced-motion',ok:reduced==='none',animationName:reduced});
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
report.summary={cases:report.cases.length,horizontalOverflowCases:report.cases.filter(row=>row.horizontalOverflow).map(row=>row.name),blockedControls:report.cases.filter(row=>row.blockedControls.length).map(row=>({name:row.name,controls:row.blockedControls})),failedInteractions:report.interactions.filter(row=>!row.ok).map(row=>row.name),lowContrast:report.contrast.flatMap(row=>row.pairs.filter(pair=>pair.ratio<4.5).map(pair=>({screen:row.screen,...pair}))),pageErrors:errors.length};
await fs.writeFile(path.join(work,'ui-layout-validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary,null,2));
process.exitCode=report.summary.horizontalOverflowCases.length||report.summary.blockedControls.length||report.summary.failedInteractions.length||report.summary.lowContrast.length||errors.length?1:0;
