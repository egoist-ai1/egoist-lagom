import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const moduleName=process.env.PLAYWRIGHT_MODULE??'playwright';
const {chromium}=await import(path.isAbsolute(moduleName)?pathToFileURL(moduleName).href:moduleName);
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const evidence=process.argv[2];
if(!evidence||!path.isAbsolute(evidence))throw new Error('Supply an absolute task-scoped evidence directory');
await fs.mkdir(evidence,{recursive:true});
const source=await fs.readFile(path.join(project,'scripts/check-compact-ui.mjs'),'utf8');
const fixture=source.slice(source.indexOf('function installFixture()'),source.indexOf('\nconst calls='));
const root=path.join(project,'.vite/renderer/main_window');
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');const p=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!p.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[path.extname(p)]||'application/octet-stream');res.end(await fs.readFile(p));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});const report=[];
try{for(const viewport of [{width:1360,height:900},{width:1024,height:768},{width:550,height:728}]){
 const context=await browser.newContext({viewport,deviceScaleFactor:2,reducedMotion:'reduce'});
 await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await context.addInitScript({content:fixture+`\ninstallFixture();
 const name='general (FAKE TLS AUTO)';
 const result={schemaVersion:2,completed:true,bestProfile:name,testedProfiles:[name],goodProfiles:[name],badProfiles:[],testedAt:'2026-09-12T13:39:00Z',results:[{configName:name,result:'success',pingMs:40,passedTargets:17,totalTargets:17,targets:[{key:'DiscordMain',label:'Discord',ok:true,pingMs:40}]}]};
 localStorage.setItem('egoistshield.zapret.autoSelect',JSON.stringify(result));
 egoistAPI.zapret.listProfiles=async()=>[{name:'General'},{name}];
 compactLab.zapret.currentProfile=name;
 `});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const item={viewport};try{await page.goto(origin,{waitUntil:'networkidle'});await page.locator('.shield-settings-open-btn').click();await page.getByRole('button',{name:'Профили',exact:true}).click();await page.evaluate(()=>document.fonts.ready);
 const rows=page.getByTestId('zapret-history-row');await rows.first().waitFor();assert.equal(await rows.count(),1,'History must contain only tested rows');assert.match(await rows.first().innerText(),/Успех 17\/17/);
 const button=page.getByTestId('zapret-best-connect');await button.scrollIntoViewIfNeeded();
 item.geometry=await button.evaluate(el=>{const b=el.getBoundingClientRect();const r=document.createRange();r.selectNodeContents(el);const content=r.getBoundingClientRect();return {button:{x:b.x,y:b.y,right:b.right,width:b.width,height:b.height},content:{x:content.x,right:content.right},scroll:el.scrollWidth,client:el.clientWidth}});
 item.legend=await page.locator('.config-legend').evaluate(el=>{const p=el.getBoundingClientRect();return [...el.children].map(child=>{const r=child.getBoundingClientRect();return {text:child.textContent,inside:r.x>=p.x-.5&&r.right<=p.right+.5}})});
 assert.ok(item.geometry.content.x>=item.geometry.button.x&&item.geometry.content.right<=item.geometry.button.right,'Connect button clips icon or text');
 assert.ok(item.geometry.scroll<=item.geometry.client+1,'Button content overflows');assert.ok(item.legend.every(x=>x.inside),'Legend is clipped');assert.deepEqual(errors,[]);item.passed=true;
 }catch(e){item.passed=false;item.error=e.message;}finally{await page.screenshot({path:path.join(evidence,`profiles-${viewport.width}.png`),fullPage:true});await context.close();report.push(item);}
}
}finally{await browser.close();await new Promise(r=>server.close(r));await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.some(r=>!r.passed))process.exitCode=1;}
