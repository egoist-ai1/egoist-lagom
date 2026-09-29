const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

const outputPath = path.join(__dirname, 'installed-contract-receipt.json');
const allowed = new Set(['hello','service.status','component.query','dns.status','dns.doh.status']);
function request(operation, payload = {}) {
  if (!allowed.has(operation)) throw new Error('Read-only scope violation');
  if (operation === 'component.query' && (payload.method !== 'status' || !['TelegramProxy','Zapret','SystemDoH'].includes(payload.component))) throw new Error('Read-only component scope violation');
  return new Promise((resolve, reject) => {
    const requestId = 'contract-readonly:' + randomUUID();
    let buffer = '', settled = false;
    const socket = net.connect('\\\\.\\pipe\\EgoistShield.Service.v1');
    const finish = (error, value) => { if(settled)return; settled=true; clearTimeout(timer); socket.destroy(); error?reject(error):resolve(value); };
    const timer = setTimeout(() => finish(new Error('Read-only request deadline exceeded')), 45000);
    socket.once('error', error => finish(error));
    socket.once('connect', () => socket.write(JSON.stringify({protocolVersion:1,requestId,operation,payload})+'\n'));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if(Buffer.byteLength(buffer)>1024*1024)return finish(new Error('Read-only response size bound exceeded'));
      const end = buffer.indexOf('\n');
      if(end<0)return;
      try {
        const response = JSON.parse(buffer.slice(0,end));
        if(response.requestId!==requestId)throw new Error('Response correlation mismatch');
        if(!response.ok)throw new Error('Core returned '+String(response.error?.code || 'failure'));
        finish(null,response.result);
      } catch(error){finish(error);}
    });
    socket.once('close', () => {if(!settled)finish(new Error('Incomplete read-only response'));});
  });
}
function shape(value, depth=0) {
  if(value===null)return 'null';
  if(Array.isArray(value))return {type:'array',length:value.length,element: value.length ? shape(value[0],depth+1) : null};
  if(typeof value!=='object')return typeof value;
  if(depth>=3)return {type:'object',keys:Object.keys(value).sort()};
  return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,shape(v,depth+1)]));
}
function selected(result, operation, component) {
  if(operation==='hello')return {protocolVersion:result.protocolVersion,serviceVersion:result.serviceVersion,developmentOverride:result.developmentOverride,identityProbe:result.identityProbe};
  if(operation==='service.status')return {version:result.version,consoleMode:result.consoleMode,supervisionPresent:typeof result.supervision==='object'&&result.supervision!==null};
  if(operation==='dns.status')return {adapterCount:Array.isArray(result.adapters)?result.adapters.length:null,staticV4AdapterCount:result.adapters?.filter(a=>a.ipv4Static===true).length};
  if(operation==='dns.doh.status')return {supported:result.supported,enabled:result.enabled,encrypted:result.encrypted,verified:result.verified,nativeManaged:result.nativeManaged};
  const safe = {};
  for(const name of ['available','running','runtimeReady','listenerReady','listenerOwnership','serviceInstalled','serviceRunning','serviceState','serviceReady','standaloneRunning','winwsRunning','nativeStatusUnavailable','dnsProbeOk','localProbeOk','healthy','enabled','encrypted','verified','nativeManaged'])if(name in result)safe[name]=result[name];
  safe.hasLastError = result.lastError!=null;
  if(component==='TelegramProxy')safe.portConflict={host:result.portConflict?.host,port:result.portConflict?.port,available:result.portConflict?.available,ownerPresent:result.portConflict?.owner!=null};
  return safe;
}
(async()=>{
  const receipt={observedAt:new Date().toISOString(),method:'Real installed EXE running Node-only read-only named-pipe requests to installed production Core; no emulated statuses or mutations',executable:process.execPath,nodeVersion:process.version,results:[]};
  for(const spec of [{operation:'hello'},{operation:'service.status'},...['TelegramProxy','Zapret','SystemDoH'].map(component=>({operation:'component.query',payload:{component,method:'status',args:[{force:true}]}})),{operation:'dns.status'},{operation:'dns.doh.status'}]){
    const started=Date.now();
    try {
      const value=await request(spec.operation,spec.payload);
      receipt.results.push({operation:spec.operation,component:spec.payload?.component??null,ok:true,milliseconds:Date.now()-started,selected:selected(value,spec.operation,spec.payload?.component),schema:shape(value)});
    }catch(error){receipt.results.push({operation:spec.operation,component:spec.payload?.component??null,ok:false,milliseconds:Date.now()-started,error:error.message});}
    fs.writeFileSync(outputPath,JSON.stringify(receipt,null,2)+'\n');
    const row=receipt.results.at(-1);
    console.log(JSON.stringify({...row,schema:undefined}));
  }
  const sourcePaths=['src/recovered/electron/ipc/telegram-proxy-manager.js','src/recovered/electron/ipc/zapret-manager.js','src/recovered/electron/ipc/system-doh-manager.js','src/recovered/electron/ipc/system-doh-service-manager.js','src/component-facade.js','src/component-worker-entry.js','src/service/EgoistShield.Service/OperationDispatcher.cs'];
  const project=path.resolve(__dirname,'..','..','..');
  receipt.sourceSnapshot={packageVersion:JSON.parse(fs.readFileSync(path.join(project,'package.json'),'utf8')).version,files:sourcePaths.map(name=>({path:name,sha256:createHash('sha256').update(fs.readFileSync(path.join(project,name))).digest('hex')}))};
  fs.writeFileSync(outputPath,JSON.stringify(receipt,null,2)+'\n');
  process.exitCode=receipt.results.some(r=>!r.ok)?1:0;
})().catch(()=>{console.error('Read-only audit runner failed');process.exitCode=1;});
