// Preparation only. Never executes Electron; no downloads or npm lifecycle.
import fs from 'node:fs/promises';
import {constants as fsConstants,createReadStream} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const appSource="'use strict';\nconst {app,BrowserWindow,session}=require('electron');\nconst fs=require('node:fs'),path=require('node:path');\nconst base=process.env.LAGOM_ENGINE_WORK,level=path.basename(process.execPath,'.exe');\nif(!base||!path.isAbsolute(base)||!['requireAdministrator','asInvoker'].includes(level)||process.argv.length!==1) process.exit(21);\nconst child=process.env.LAGOM_ENGINE_CHILD_PATH,synchronizeChildPath=process.env.LAGOM_ENGINE_SYNC_CHILD==='1';\nif(synchronizeChildPath&&!child)process.exit(26);\nif(child){if(level!=='requireAdministrator'||child!==path.join(path.dirname(process.execPath),'asInvoker.exe'))process.exit(26);if(synchronizeChildPath)app.setPath('exe',child);app.commandLine.appendSwitch('browser-subprocess-path',child);}\nconst proofFile=path.join(base,'app-proof.json');\nfor(const name of ['userData','sessionData']) fs.mkdirSync(path.join(base,name),{recursive:true});\napp.setName('Lagom isolated engine fixture');\napp.setPath('userData',path.join(base,'userData'));\napp.setPath('sessionData',path.join(base,'sessionData'));\nconst proof={schemaVersion:1,level,pid:process.pid,electron:process.versions.electron,chrome:process.versions.chrome,phase:'bootstrap',childImageSelected:Boolean(child),childPathSynchronized:synchronizeChildPath,actualParentImageName:path.basename(process.execPath),configuredExeImageName:path.basename(app.getPath('exe')),visible:false,focusObserved:false,networkRequestsBlocked:0,childFailures:[]};\nfunction save(){const bytes=JSON.stringify(proof);if(Buffer.byteLength(bytes)>16384)process.exit(22);fs.writeFileSync(proofFile+'.tmp',bytes,{encoding:'utf8',mode:0o600});fs.renameSync(proofFile+'.tmp',proofFile);}\nsave();\nconst timer=setTimeout(()=>{proof.phase='app-timeout';save();app.exit(23);},18000);timer.unref();\napp.on('browser-window-focus',()=>{proof.focusObserved=true;save();});\napp.on('child-process-gone',(_e,d)=>{if(proof.childFailures.length<16)proof.childFailures.push({type:d.type,reason:d.reason,exitCode:d.exitCode});save();});\napp.whenReady().then(async()=>{\n  session.defaultSession.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{const cancel=!details.url.startsWith('data:');if(cancel)proof.networkRequestsBlocked++;callback({cancel});});\n  session.defaultSession.setPermissionRequestHandler((_w,_p,callback)=>callback(false));\n  session.defaultSession.setPermissionCheckHandler(()=>false);\n  const win=new BrowserWindow({show:false,focusable:false,skipTaskbar:true,width:160,height:100,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true}});\n  proof.phase='window-created';save();\n  win.webContents.on('render-process-gone',(_e,d)=>{proof.rendererFailure={reason:d.reason,exitCode:d.exitCode};save();});\n  await win.loadURL('data:text/html;charset=utf-8,%3Cmeta%20http-equiv%3D%22Content-Security-Policy%22%20content%3D%22default-src%20%27none%27%22%3E%3Ctitle%3Eengine%20fixture%3C%2Ftitle%3E');\n  proof.result=await win.webContents.executeJavaScript('2+2',false);\n  proof.rendererPid=win.webContents.getOSProcessId();proof.phase='renderer-proof';save();\n  await app.getGPUInfo('complete');proof.gpuInfoResolved=true;\n  for(let attempt=0;attempt<20;attempt++){proof.metrics=app.getAppMetrics().slice(0,16).map(m=>({pid:m.pid,type:m.type}));proof.gpuMetricPresent=proof.metrics.some(m=>m.type==='GPU');if(proof.gpuMetricPresent)break;await new Promise(r=>setTimeout(r,100));}\n  proof.visible=win.isVisible();proof.phase='engine-complete';\n  proof.ok=proof.result===4&&proof.rendererPid>0&&proof.gpuMetricPresent&&!proof.visible&&!proof.focusObserved&&proof.electron==='44.5.1';\n  save();await new Promise(r=>setTimeout(r,1500));clearTimeout(timer);app.exit(proof.ok?0:24);\n}).catch(error=>{proof.phase='engine-error';proof.errorClass=error&&error.constructor?error.constructor.name:'Error';save();app.exit(25);});\n";
const libraryHashes=new Set(['b1abfb2359b4997a79cbf6aa9f57281f13b32ee240b6a624bfd7b5c7dcb436af','130b74997b48cd7b20f07c6dc00f0c178bf3f591ebdc907aaf367a6912461a06','7dcda8197eefb639d2ca341e6c00d5ec45f33390a5dd89f5d0a73b857819844c','5c4f5ed526b6c663ab8681a694d949c80e3b4b93baed24eadbf6126ceb75301b']);
const rceditSha='3e7801db1a5edbec91b49a24a094aad776cb4515488ea5a4ca2289c400eade2a';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function hash(file){const h=crypto.createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
async function ordinary(file,directory=false,windowsSystemFile=false){const full=path.resolve(file);if(!path.isAbsolute(file)||full.startsWith('\\\\'))throw Error('Absolute local paths required');let p=full;while(true){const s=await fs.lstat(p);if(s.isSymbolicLink())throw Error('Linked ancestor rejected');if(p===full&&((directory&&!s.isDirectory())||(!directory&&(!s.isFile()||(!windowsSystemFile&&s.nlink!==1)))))throw Error('Ordinary unlinked input required');const next=path.dirname(p);if(next===p)break;p=next;}return full;}
async function json(file){await ordinary(file);if((await fs.stat(file)).size>1048576)throw Error('Metadata bound exceeded');return JSON.parse(await fs.readFile(file,'utf8'));}
function relative(name){if(typeof name!=='string'||name.includes('\\')||name.startsWith('/')||name.split('/').some(s=>!s||s==='.'||s==='..'||s.includes(':')))throw Error('Unsafe inventory name');return name;}
function run(exe,args){const r=spawnSync(exe,args,{windowsHide:true,timeout:45000,maxBuffer:65536,encoding:'utf8',shell:false});if(r.error||r.status!==0)throw Error('Preparation helper failed: '+path.basename(exe)+'; status='+r.status+'; error='+r.error?.code);return r.stdout;}
export async function prepare(options){
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows x64 required');
  const project=await ordinary(options.project,true),work=await ordinary(options.work,true),python=await ordinary(options.python),library=await ordinary(options.library);
  const runtimeReceiptPath=await ordinary(options['runtime-receipt']);
  const runner=await ordinary(options.runner??path.join(path.dirname(fileURLToPath(import.meta.url)),'run-electron-manifest-fixture.ps1'));
  const librarySha=await hash(library);if(!libraryHashes.has(librarySha))throw Error('Accepted native resource library mismatch');
  const runtime=await json(runtimeReceiptPath),pin=await json(path.join(project,'scripts','electron-runtime.json'));
  if(runtime.schemaVersion!==1||runtime.version!=='44.5.1'||runtime.platform!=='win32'||runtime.arch!=='x64'||runtime.releaseUrl!==pin.releaseUrl||runtime.archive?.sha256!==pin.asset.sha256||runtime.archive?.bytes!==pin.asset.bytes||runtime.archive?.id!==pin.asset.id||runtime.shasums?.sha256!==pin.shasums.sha256)throw Error('Pinned official runtime receipt mismatch');
  if(!Array.isArray(runtime.files)||runtime.files.length<2||runtime.files.length>512)throw Error('Runtime inventory bound');
  const runtimeRoot=await ordinary(runtime.runtimePath,true),seen=new Set();let total=0;
  for(const e of runtime.files){relative(e.path);const key=e.path.toLowerCase();if(seen.has(key)||!Number.isInteger(e.bytes)||e.bytes<1||e.bytes>268435456||!/^[a-f0-9]{64}$/.test(e.sha256))throw Error('Invalid inventory');seen.add(key);total+=e.bytes;}
  if(total>1610612736||runtime.files.filter(e=>e.path==='electron.exe').length!==1||seen.has('resources/app.asar')||seen.has('requireadministrator.exe')||seen.has('asinvoker.exe'))throw Error('Unexpected runtime inventory');
  const req=createRequire(path.join(project,'package.json')),pkg=await json(path.join(project,'package.json')),lock=await json(path.join(project,'package-lock.json'));
  for(const [name,version] of [['@electron/asar','3.4.1'],['rcedit','5.0.2']])if(pkg.devDependencies?.[name]!==version||lock.packages?.['node_modules/'+name]?.version!==version||(await json(path.join(project,'node_modules',...name.split('/'),'package.json'))).version!==version)throw Error('Locked tool version mismatch');
  const rcedit=await ordinary(path.join(project,'node_modules','rcedit','bin','rcedit-x64.exe'));
  if(await hash(rcedit)!==rceditSha)throw Error('Locked rcedit bytes mismatch');
  const fuseHelper=await ordinary(path.join(project,'scripts','electron-fuses.mjs')),embedHelper=await ordinary(path.join(project,'scripts','embed-asar-integrity.py'));
  const {hardenElectronFuses,readElectronFuses}=await import(pathToFileURL(fuseHelper));
  const asar=req('@electron/asar');
  const root=path.join(work,'electron-manifest-fixture-'+crypto.randomUUID().replaceAll('-',''));await fs.mkdir(root,{recursive:false});
  const runtimeFiles=[];
  for(const e of runtime.files){
    const source=await ordinary(path.join(runtimeRoot,...e.path.split('/')));
    if((await fs.stat(source)).size!==e.bytes||await hash(source)!==e.sha256)throw Error('Source runtime checksum mismatch');
    if(e.path!=='electron.exe'){const target=path.join(root,...e.path.split('/'));await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(source,target,fsConstants.COPYFILE_EXCL);await ordinary(target);if(await hash(target)!==e.sha256)throw Error('Copy checksum mismatch');runtimeFiles.push(e);}
  }
  const selected=runtime.files.find(e=>e.path==='electron.exe'),sourceImage=path.join(runtimeRoot,'electron.exe');
  const appDir=path.join(root,'controlled-app');await fs.mkdir(appDir);await fs.writeFile(path.join(appDir,'package.json'),JSON.stringify({name:'lagom-isolated-engine-fixture',version:'1.0.0',main:'main.cjs'}),{flag:'wx'});await fs.writeFile(path.join(appDir,'main.cjs'),appSource,{flag:'wx'});
  const archive=path.join(root,'resources','app.asar');await fs.mkdir(path.dirname(archive),{recursive:true});await asar.createPackage(appDir,archive);
  const raw=asar.getRawHeader(archive),headerSha=sha(Buffer.from(raw.headerString,'utf8'));
  const images=[];
  for(const level of ['requireAdministrator','asInvoker']){
    const image=path.join(root,level+'.exe');await fs.copyFile(sourceImage,image,fsConstants.COPYFILE_EXCL);
    run(rcedit,[image,'--set-requested-execution-level',level]);
    run(python,[embedHelper,'--executable',image,'--header-sha256',headerSha]);
    const fuses=await hardenElectronFuses(image,'gui');if(fuses.wire!=='000011011'||readElectronFuses(await fs.readFile(image)).wire!=='000011011')throw Error('GUI fuse mismatch');
    images.push({level,name:level+'.exe',fuses:fuses.wire});
  }
  for(const e of runtime.files)if(await hash(path.join(runtimeRoot,...e.path.split('/')))!==e.sha256)throw Error('Source changed during preparation');
  const fixture={schemaVersion:1,prepared:false,root,work,project,library,librarySha,runner,runnerSha:await hash(runner),builderSha:await hash(fileURLToPath(import.meta.url)),runtimeReceiptSha:await hash(runtimeReceiptPath),version:runtime.version,sourceImage,sourceImageSha:selected.sha256,sourceImageBytes:selected.bytes,archiveSha:runtime.archive.sha256,runtimeFiles,asar:{name:'resources/app.asar',bytes:(await fs.stat(archive)).size,sha256:await hash(archive),headerSha256:headerSha,appSourceSha256:sha(appSource)},images,tools:{rceditSha256:rceditSha,fuseHelperSha256:await hash(fuseHelper),embedHelperSha256:await hash(embedHelper)},applicationTargetExecutions:0};
  const fixturePath=path.join(root,'fixture.json');await fs.writeFile(fixturePath,JSON.stringify(fixture,null,2)+'\n',{flag:'wx'});
  const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');await ordinary(powershell,false,true); // Windows servicing owns this fixed System32 binary and its hardlinks.
  run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',runner,'-Mode','PrepareOnly','-Project',project,'-Fixture',fixturePath,'-Work',work,'-Library',library]);
  const final=await json(fixturePath);if(final.prepared!==true||final.applicationTargetExecutions!==0||await hash(sourceImage)!==selected.sha256)throw Error('Prepared fixture readback rejected');
  return {schemaVersion:1,fixture:fixturePath,fixtureSha256:await hash(fixturePath),runnerSha256:fixture.runnerSha,applicationTargetExecutions:0};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const options={};for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i];if(!/^--(project|runtime-receipt|work|python|library|runner)$/.test(key)||!process.argv[i+1]||options[key.slice(2)])throw Error('Invalid argument pair; argvIndex='+i+'; argc='+process.argv.length+'; knownKey='+/^--(project|runtime-receipt|work|python|library|runner)$/.test(key)+'; hasValue='+Boolean(process.argv[i+1]));options[key.slice(2)]=process.argv[i+1];}for(const k of ['project','runtime-receipt','work','python','library'])if(!options[k])throw Error('Missing --'+k);console.log(JSON.stringify(await prepare(options)));}
  catch(error){console.error(JSON.stringify({schemaVersion:1,preparationFailed:true,errorClass:error.constructor.name,message:error.message}));process.exitCode=1;}
}

