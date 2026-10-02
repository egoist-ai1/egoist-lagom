import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const renderer=fs.readFileSync(new URL('../src/recovered/renderer.js',import.meta.url),'utf8');
const widget=fs.readFileSync(new URL('../src/brand/ShieldWidget.jsx',import.meta.url),'utf8');
const handlers=fs.readFileSync(new URL('../src/recovered/electron/ipc/handlers-system.js',import.meta.url),'utf8');
function extract(source,name){const start=source.indexOf(`function ${name}(`),end=source.indexOf('\n}',start+1)+2;assert.ok(start>=0&&end>start,name);return source.slice(start,end);}
const base={state:{settings:{systemDohEnabled:true,systemDnsServers:'127.0.0.1',systemDohUrl:'https://private.example/dns-query/example'}},dns:{mode:'system-doh',servers:['127.0.0.1']},systemDoh:{running:true,verified:true,encrypted:true,serviceInstalled:true,serviceRunning:true,localAddress:'127.0.0.1',localPort:53},dnsCheck:{current:{address:'127.0.0.1',encrypted:true,protocol:'System DoH',localChannel:'127.0.0.1:53',statusLabel:'Активен',status:'active',mode:'system-doh'},summary:{okCount:3,total:3}}};
function page(patch={}){
 const snapshot={...base,...patch};
 const create=(type,props)=>({type,props});
 const context={URL,window:{egoistAPI:{},setTimeout(){}},O:{useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect(){},useCallback:f=>f,useMemo:f=>f()},V:{jsx:create,jsxs:create,Fragment:'Fragment'},Q:(...v)=>v.find(x=>typeof x==='string'&&x.trim())??null,$:(...v)=>v.find(Number.isFinite)??null,jm:()=>null,Nm:()=>null,zf:{manualPrimary:'1.1.1.1',manualSecondary:'8.8.8.8',localAddress:'127.0.0.1',localPort:53},Vf:[],Hf:[],Mp:'panel',Np:'title',Wp:'rows',Bp:'input',Z(){}};
 const helpers=['Jd','Pm','Nm'];
 if(renderer.includes('function rubyDnsCurrentSummary('))helpers.push('rubyDnsCurrentSummary');
 vm.createContext(context);
 vm.runInContext(widget.slice(0,widget.indexOf('function ShieldWidget('))+'\n'+helpers.map(n=>extract(renderer,n)).join('\n')+'\n'+extract(renderer,'wp')+'\nglobalThis.render=wp;',context);
 const tree=context.render({snapshot,confirmAction(){},refreshDnsDiagnostics(){},runAction(){}});
 function find(node){if(!node||typeof node!=='object')return null;if(node.props?.className==='dns-current-panel')return node;for(const child of [node.props?.children].flat(Infinity)){const found=find(child);if(found)return found;}return null;}
 const panel=find(tree);assert.ok(panel,'actual production wp current panel rendered');
 return Object.fromEntries(panel.props.children.find(n=>n.type==='rows').props.rows);
}
async function diagnostics({servers=['127.0.0.1'],doh=base.systemDoh,settings=base.state.settings}={}){
 const start=handlers.indexOf('\tipcMain.handle("system:dns-diagnostics",'),end=handlers.indexOf('\n\tipcMain.handle(',start+1);assert.ok(start>=0&&end>start);
 let callback;
 const context={ipcMain:{handle:(_n,fn)=>{callback=fn;}},stateStore:{get:()=>({settings})},resolveDnsControllerMode:s=>s.settings.systemDohEnabled?'system-doh':s.settings.systemDnsServers?'manual-dns':'system-default',process:{env:{NODE_ENV:'production'}},readDnsControllerAdapters:async()=>[],canBindPort:async()=>false,buildDnsControllerState:v=>v,systemDohManager:{status:async()=>doh},gravitylessDnsManager:null,readCurrentDnsServers:async()=>servers,DNS_DIAGNOSTIC_TARGETS:[],checkDnsTarget:async()=>({}),firstNonEmpty:(...v)=>v.find(x=>typeof x==='string'&&x.trim())??null,URL,hostWithoutPort:v=>v.split(':')[0],isLocalDnsAddress:v=>['127.0.0.1','::1'].includes(v),isGravitylessLoopbackDnsRequest:v=>v.includes('127.0.0.1'),providerFromDnsValue:()=>null,knownDnsCountry:()=>null,geoipCountry:async()=>({country:null,countryCode:null}),average:()=>null};
 vm.runInNewContext(handlers.slice(start,end),context);
 return callback();
}
test('current page uses live router DNS instead of a cached successful private DoH check',()=>{
 const rows=page({dns:{mode:'system-doh',servers:['192.168.31.1']}});
 assert.equal(rows['Адрес'],'192.168.31.1');
 assert.equal(rows['Протокол'],'System DNS');
 assert.equal(rows['Шифрование'],'Выключено');
 assert.notEqual(rows['Статус'],'Активен');
 assert.match(rows['Локальный канал'],/не используется Windows/);
});
test('loopback with a running service and failed health is configured, not falsely inactive or ready',()=>{
 const rows=page({systemDoh:{...base.systemDoh,running:false,verified:false,encrypted:false}});
 assert.equal(rows['Адрес'],'127.0.0.1');
 assert.equal(rows['Протокол'],'System DoH');
 assert.match(rows['Локальный канал'],/127\.0\.0\.1:53.*ответ не подтверждён/);
 assert.notEqual(rows['Статус'],'Активен');
 assert.notEqual(rows['Шифрование'],'Включено');
});
test('ready owned loopback uses latest DoH status despite an old failed check',()=>{
 const rows=page({dnsCheck:{current:{address:'192.168.31.1',encrypted:false,protocol:'System DNS',localChannel:'не активен',statusLabel:'Неактивен'}}});
 assert.equal(rows['Адрес'],'127.0.0.1');assert.equal(rows['Протокол'],'System DoH');assert.equal(rows['Шифрование'],'Включено');assert.equal(rows['Статус'],'Активен');assert.match(rows['Локальный канал'],/ответ подтверждён/);
});
test('stale adapter observations cannot reuse cached success as current encryption',()=>{
 const rows=page({dns:{...base.dns,uiObservation:{known:false,stale:true}},systemDoh:{...base.systemDoh,uiObservation:{known:false,stale:true}}});
 assert.notEqual(rows['Адрес'],'127.0.0.1');assert.notEqual(rows['Шифрование'],'Включено');assert.notEqual(rows['Статус'],'Активен');
});
test('Windows native DoH works without a local Xray channel',()=>{
 const rows=page({dns:{mode:'system-doh',servers:['203.0.113.10']},systemDoh:{running:true,verified:true,encrypted:true,nativeManaged:true,serverAddresses:['203.0.113.10']}});
 assert.equal(rows['Адрес'],'203.0.113.10');assert.equal(rows['Протокол'],'System DoH (Windows)');assert.match(rows['Локальный канал'],/Windows DNS Client.*HTTPS/);assert.equal(rows['Шифрование'],'Включено');
});
test('mixed local and external DNS does not claim all DNS is encrypted',()=>{
 const rows=page({dns:{mode:'system-doh',servers:['127.0.0.1','8.8.8.8']}});
 assert.notEqual(rows['Шифрование'],'Включено');assert.notEqual(rows['Статус'],'Активен');
});
test('fresh diagnostics do not substitute saved loopback settings for actual router DNS',async()=>{
 const result=await diagnostics({servers:['192.168.31.1']});
 assert.equal(result.current.address,'192.168.31.1');assert.equal(result.current.encrypted,false);assert.equal(result.current.protocol,'System DNS');assert.equal(result.current.localChannel,'не активен');assert.notEqual(result.current.status,'active');
});
test('fresh diagnostics reject mixed resolver encryption and preserve actual first DNS',async()=>{
 const result=await diagnostics({servers:['8.8.8.8','127.0.0.1']});
 assert.equal(result.current.address,'8.8.8.8');assert.equal(result.current.encrypted,false);assert.notEqual(result.current.status,'active');
});
test('fresh diagnostics confirm healthy selected loopback and native DoH',async()=>{
 const local=await diagnostics();assert.equal(local.current.encrypted,true);assert.equal(local.current.status,'active');
 const native=await diagnostics({servers:['203.0.113.10'],doh:{...base.systemDoh,nativeManaged:true,serverAddresses:['203.0.113.10']}});assert.equal(native.current.encrypted,true);assert.match(native.current.localChannel,/Windows DNS Client/);
});

test('private loopback does not identify an operator from an older private profile check',()=>{
 const rows=page({dnsCheck:{current:{address:'127.0.0.1',provider:'Old private operator',country:'Old country'}}});
 assert.equal(rows['Провайдер'],'Не определён');assert.equal(rows['Страна'],'Не определена');
});
