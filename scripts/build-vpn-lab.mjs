import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..');
process.chdir(root);
const order=JSON.parse(await fs.readFile('src/recovered/order.json','utf8'));
const modules=await Promise.all(order.slice(0,-1).map(name=>fs.readFile('src/recovered/'+name,'utf8')));
const diagnostic=process.argv.includes('--diagnostic');
const output=process.argv.find((value,index)=>index>1&&!value.startsWith('--'));
if(!output||!path.isAbsolute(output))throw new Error('Supply an absolute task-scoped output path');
if(diagnostic){
  for(let i=0;i<modules.length;i++){
    if(order[i].endsWith('handlers-vpn.js'))modules[i]=modules[i].replace('timeoutMs: 6e3,\n\t\t\t\t\t\tretries: 0,','timeoutMs: 30e3,\n\t\t\t\t\t\tretries: 0,');
    if(order[i].endsWith('vpn-manager.js'))modules[i]=modules[i].replace('child.stdout?.on("data", appendRuntimeOutput);','child.stdout?.on("data", appendRuntimeOutput);\n child.stdout?.on("data", chunk => console.error(redactDiagnosticText(chunk.toString())));\n child.stderr?.on("data", chunk => console.error(redactDiagnosticText(chunk.toString())));').replace('waitForPort(proxyPort, 3e3)','waitForPort(proxyPort, effectiveSettings.useTunMode ? 6e4 : 3e3)');
  }
}
const electron=`const app = new EventEmitter(); app.isPackaged=true; app.getVersion=()=> '3.7.0'; app.getPath=()=> 'C:/ShieldLab/vpn-data'; const powerMonitor=new EventEmitter(); const Notification={isSupported:()=>false}; const shell={}; const labHandlers=new Map(); const ipcMain={handle:(name,handler)=>labHandlers.set(name,handler)}; const updateTrayMenu=()=>{};`;
const log=`const log={hooks:[],transports:{file:{},console:{}}}; for(const level of ['info','warn','error','debug']) log[level]=(...data)=>{let message={data};for(const hook of log.hooks)message=hook(message);process.stderr.write(JSON.stringify({level,data:message.data})+'\\n')};`;
modules[0]=modules[0].replace(/^import .* from "electron";$/m,electron).replace(/^import log from "electron-log";$/m,log);
for(let i=0;i<modules.length;i++)modules[i]=modules[i].replaceAll('path.dirname(fileURLToPath(import.meta.url))','__dirname');
await fs.mkdir(path.dirname(output),{recursive:true});
await build({stdin:{contents:modules.join('\n')+'\n'+await fs.readFile('src/component-protocol.js','utf8')+'\n'+await fs.readFile('src/component-facade.js','utf8')+'\n'+await fs.readFile('tests/vpn-lab-entry.js','utf8'),resolveDir:root,sourcefile:'vpn-lab.js'},outfile:output,platform:'node',format:'cjs',target:'node22',bundle:true});
console.log('Built real VPN handlers and runtime manager for disposable guest tests.');
