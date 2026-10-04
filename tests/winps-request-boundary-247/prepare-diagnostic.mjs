// Preparation only: copies verified SDK bytes and creates ASAR; no executable launch.
import fs from 'node:fs/promises';
import {constants,createReadStream} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const SOURCE='247cb3c8f3a171202613b5b679ebab400f040ca7';
const ENGINE='49b61a030a520fc36a4b8fa5cce53fb4e935a7bdbbe4b80e9222f598e49cc7fa';
async function hash(file) { const h=crypto.createHash('sha256'); for await(const chunk of createReadStream(file)) h.update(chunk); return h.digest('hex'); }
function relative(value) {
  if(typeof value!=='string'||value.includes('\\')||value.startsWith('/')||value.split('/').some(part=>!part||part==='.'||part==='..'||part.includes(':'))) throw Error('Invalid relative inventory path');
  return value;
}
async function ordinary(value,directory=false) {
  if(!path.isAbsolute(value)||value.startsWith('\\\\')) throw Error('Absolute local path required');
  const full=path.resolve(value); let at=full;
  while(true) {
    const stat=await fs.lstat(at);
    if(stat.isSymbolicLink()) throw Error('Linked input rejected');
    if(at===full&&(directory?!stat.isDirectory():!stat.isFile()||stat.nlink!==1)) throw Error('Ordinary input required');
    const next=path.dirname(at); if(next===at) break; at=next;
  }
  return full;
}
async function json(file) {
  await ordinary(file);
  if((await fs.stat(file)).size>1048576) throw Error('Metadata bound exceeded');
  return JSON.parse(await fs.readFile(file,'utf8'));
}
async function copy(source,destination,expected) {
  await ordinary(source);
  if((await fs.stat(source)).size!==expected.bytes||await hash(source)!==expected.sha256) throw Error('Input checksum changed');
  await fs.mkdir(path.dirname(destination),{recursive:true});
  await fs.copyFile(source,destination,constants.COPYFILE_EXCL);
  if((await fs.stat(destination)).size!==expected.bytes||await hash(destination)!==expected.sha256) throw Error('Copy checksum changed');
}
async function prepare(options) {
  if(process.platform!=='win32'||process.arch!=='x64') throw Error('Windows x64 preparation required');
  const project=await ordinary(options.project,true), work=await ordinary(options.work,true), bundle=await ordinary(options.bundle,true);
  const bundleManifest=await json(path.join(bundle,'bundle-review-hashes.json'));
  if(bundleManifest.schemaVersion!==1||bundleManifest.sourceCommit!==SOURCE||bundleManifest.supervisorSourceCommit!=='622db4ccc208cb4cc4c04e8b9005eb338f13903d'||!Array.isArray(bundleManifest.inputs)||bundleManifest.inputs.length<16||bundleManifest.inputs.length>40) throw Error('Reviewed bundle contract mismatch');
  const names=new Set();
  for(const entry of bundleManifest.inputs) {
    relative(entry.relative);
    if(names.has(entry.relative.toLowerCase())||!Number.isInteger(entry.bytes)||entry.bytes<1||entry.bytes>1048576||!/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error('Bundle inventory invalid');
    names.add(entry.relative.toLowerCase());
    const file=path.join(bundle,...entry.relative.split('/')); await ordinary(file);
    if((await fs.stat(file)).size!==entry.bytes||await hash(file)!==entry.sha256) throw Error('Reviewed bundle changed');
  }
  if(bundleManifest.inputs.filter(entry=>entry.relative.startsWith('frozen-csharp/')&&entry.relative.endsWith('.cs')).length!==9) throw Error('Exactly nine unchanged supervisor inputs required');
  const receiptPath=await ordinary(options['runtime-receipt']), runtime=await json(receiptPath), pin=await json(path.join(project,'scripts','electron-runtime.json'));
  if(runtime.schemaVersion!==1||runtime.version!=='44.5.1'||runtime.platform!=='win32'||runtime.arch!=='x64'||runtime.releaseUrl!==pin.releaseUrl||runtime.archive?.sha256!==pin.asset.sha256||runtime.archive?.bytes!==pin.asset.bytes||runtime.archive?.id!==pin.asset.id||runtime.shasums?.sha256!==pin.shasums.sha256) throw Error('Verified runtime receipt differs from project pin');
  if(!Array.isArray(runtime.files)||runtime.files.length<17||runtime.files.length>512) throw Error('Runtime inventory bound');
  const runtimeRoot=await ordinary(runtime.runtimePath,true), seen=new Set(); let total=0;
  for(const entry of runtime.files) {
    relative(entry.path);
    if(seen.has(entry.path.toLowerCase())||!Number.isInteger(entry.bytes)||entry.bytes<1||entry.bytes>268435456||!/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error('Runtime inventory invalid');
    seen.add(entry.path.toLowerCase()); total+=entry.bytes;
  }
  const image=runtime.files.filter(entry=>entry.path==='electron.exe');
  if(total>1610612736||image.length!==1||image[0].sha256!==ENGINE||seen.has('resources/app.asar')||seen.has('asinvoker.exe')) throw Error('Runtime image identity mismatch');
  const pkg=await json(path.join(project,'package.json')), lock=await json(path.join(project,'package-lock.json')), installed=await json(path.join(project,'node_modules','@electron','asar','package.json'));
  if(pkg.devDependencies?.['@electron/asar']!=='3.4.1'||lock.packages?.['node_modules/@electron/asar']?.version!=='3.4.1'||installed.version!=='3.4.1') throw Error('Locked ASAR package mismatch');
  const asar=createRequire(path.join(project,'package.json'))('@electron/asar');
  const root=path.join(work,'winps-request-boundary');
  await fs.mkdir(root,{recursive:false});
  const dist=path.join(root,'dist'); await fs.mkdir(dist,{recursive:false});
  const engineInputs=[];
  for(const entry of runtime.files) {
    const source=path.join(runtimeRoot,...entry.path.split('/'));
    await ordinary(source);
    if((await fs.stat(source)).size!==entry.bytes||await hash(source)!==entry.sha256) throw Error('Official runtime bytes changed');
    if(entry.path==='resources/default_app.asar') continue; // SDK default app is not used.
    const relativeName=entry.path==='electron.exe'?'asInvoker.exe':entry.path;
    const target=path.join(dist,...relativeName.split('/'));
    await copy(source,target,entry);
    engineInputs.push({absolute:target,relative:relativeName,sha256:entry.sha256,bytes:entry.bytes});
  }
  const inputs=[];
  for(const entry of bundleManifest.inputs) {
    const target=path.join(root,...entry.relative.split('/'));
    await copy(path.join(bundle,...entry.relative.split('/')),target,entry);
    inputs.push(entry);
  }
  await fs.copyFile(path.join(bundle,'bundle-review-hashes.json'),path.join(root,'bundle-review-hashes.json'),constants.COPYFILE_EXCL);
  await fs.mkdir(path.join(dist,'resources'),{recursive:true});
  const archive=path.join(dist,'resources','app.asar');
  await asar.createPackage(path.join(root,'payload'),archive);
  if(asar.listPackage(archive).some(name=>/(?:^|\/)node_modules(?:\/|$)/.test(name))) throw Error('Unexpected ASAR contents');
  const extractedMain=asar.extractFile(archive,'main.mjs');
  const main=inputs.find(entry=>entry.relative==='payload/main.mjs');
  if(!main||crypto.createHash('sha256').update(extractedMain).digest('hex')!==main.sha256) throw Error('ASAR main readback mismatch');
  engineInputs.push({absolute:archive,relative:'resources/app.asar',sha256:await hash(archive),bytes:(await fs.stat(archive)).size});
  const manifest={schemaVersion:1,sourceCommit:SOURCE,supervisorSourceCommit:bundleManifest.supervisorSourceCommit,reviewBundleSha256:await hash(path.join(bundle,'bundle-review-hashes.json')),
    sdkImageUnmodified:true,sdkManifestLevel:'asInvoker',productionFusesEquivalent:false,defaultAppAsarUsed:false,applicationTargetExecutions:0,
    engineInputs,inputs,runtimeReceiptSha256:await hash(receiptPath)};
  const manifestPath=path.join(root,'probe-review-hashes.json');
  await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return {schemaVersion:1,prepared:true,root,projectFile:path.join(root,'WinPsRequestBoundaryProbe.csproj'),runScript:path.join(root,'run-request-boundary.ps1'),
    reviewedSeal:path.join(root,'probe-review-hashes.json'),reviewedSealSha256:await hash(manifestPath),electronSha256:ENGINE,asarSha256:await hash(archive),
    sourceCommit:SOURCE,applicationTargetExecutions:0,nativeCompileRequired:true,defaultAppAsarUsed:false,productionFusesEquivalent:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const options={};
    for(let i=2;i<process.argv.length;i+=2) {
      const key=process.argv[i];
      if(!/^--(project|runtime-receipt|work|bundle)$/.test(key)||!process.argv[i+1]||options[key.slice(2)]) throw Error('Fixed preparation arguments required');
      options[key.slice(2)]=process.argv[i+1];
    }
    for(const name of ['project','runtime-receipt','work','bundle']) if(!options[name]) throw Error('Missing fixed preparation argument');
    console.log(JSON.stringify(await prepare(options)));
  } catch(error) { console.error(JSON.stringify({schemaVersion:1,preparationFailed:true,errorClass:error?.constructor?.name==='TypeError'?'TypeError':'PreparationError'})); process.exitCode=1; }
}
