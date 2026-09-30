// Audit-only baseline defect reproducer. Arguments: absolute project path, own task work outside project.
// Inert files/controlled loopback only. The assertions demonstrate the baseline defects; they are not post-fix tests.
import fs, { promises } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const project = process.argv[2];
const work = process.argv[3];
if (!project || !work || !path.isAbsolute(project) || !path.isAbsolute(work)) throw new Error('Pass an absolute project path and your own task work outside the project.');
const normalizedProject = path.resolve(project).toLowerCase();
const normalizedWork = path.resolve(work).toLowerCase();
if (normalizedWork === normalizedProject || normalizedWork.startsWith(normalizedProject + path.sep)) throw new Error('Work must be the active task runtime outside the project.');
const fixture = path.join(work, 'security-boundary-fixture');
await promises.mkdir(fixture, { recursive: true });
const read = relative => fs.readFileSync(path.join(project, relative), 'utf8');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const trustedIpcPath='src/recovered/electron/ipc/trusted-ipc.js';
const trustedIpcSource = read(trustedIpcPath);
const ipc=vm.runInNewContext(trustedIpcSource+'\n({configureTrustedIpcPolicy,isTrustedUrl})', {path:path.win32,URL});
const rendererRoot=String.raw`C:\Program Files\EgoistShield\resources\app.asar\.vite\renderer\main_window`;
ipc.configureTrustedIpcPolicy({packagedRendererRoot:rendererRoot});
const pathUrl='/C:/Program%20Files/EgoistShield/resources/app.asar/.vite/renderer/main_window/index.html';
const urls=[
{kind:'canonical-local-file',url:'file://'+pathUrl,expected:true},
{kind:'foreign-network-host',url:'file://audit.invalid'+pathUrl,expected:false},
{kind:'localhost-alias',url:'file://localhost'+pathUrl,expected:true},
{kind:'outside-renderer',url:'file:///C:/Program%20Files/EgoistShield/resources/app.asar/.vite/other/index.html',expected:false},
{kind:'renderer-prefix-sibling',url:'file:///C:/Program%20Files/EgoistShield/resources/app.asar/.vite/renderer/main_window-other/index.html',expected:false},
{kind:'remote-https',url:'https://audit.invalid/index.html',expected:false}
].map(item=>({...item,actual:ipc.isTrustedUrl(item.url)}));
assert.equal(urls.find(x=>x.kind==='canonical-local-file').actual,true);
assert.equal(urls.find(x=>x.kind==='foreign-network-host').actual,true);
assert.equal(urls.find(x=>x.kind==='outside-renderer').actual,false);
const vpnPath='src/recovered/electron/ipc/vpn-manager.js';
const vpnSource = read(vpnPath);
const VpnRuntimeManager=vm.runInNewContext(vpnSource+'\nVpnRuntimeManager', {path,promises,EventEmitter,promisify,execFile,process,logger:{warn(){}}});
const profile=path.join(fixture,'user-profile');
const appRoot=path.join(fixture,'protected-install-fixture');
const userExecutable=path.join(profile,'runtime','xray','xray.exe');
const bundledExecutable=path.join(appRoot,'runtime','xray','xray.exe');
await promises.mkdir(path.dirname(userExecutable),{recursive:true});
await promises.mkdir(path.dirname(bundledExecutable),{recursive:true});
await promises.writeFile(userExecutable,'INERT USER RUNTIME INITIAL\n');
await promises.writeFile(bundledExecutable,'INERT BUNDLED RUNTIME\n');
const manager=Object.create(VpnRuntimeManager.prototype);
manager.userDataDir=profile;
manager.appRoot=appRoot;
const beforeHash=hash(await promises.readFile(userExecutable));
const selectedBefore=await manager.resolveRuntimePath('', 'xray', false);
await promises.writeFile(userExecutable,'INERT REPLACED RUNTIME BY PROFILE WRITER\n');
const afterHash=hash(await promises.readFile(userExecutable));
const selectedAfter=await manager.resolveRuntimePath('', 'xray', false);
assert.equal(selectedBefore.runtimePath,userExecutable);
assert.equal(selectedAfter.runtimePath,userExecutable);
assert.notEqual(beforeHash,afterHash);
const runtime={kind:'modified-profile-runtime-selected',selectedBefore:'userData/runtime/xray/xray.exe',selectedAfter:'userData/runtime/xray/xray.exe',bundledRuntimeExists:fs.existsSync(bundledExecutable),fileDigestChanged:beforeHash!==afterHash,inertBytesOnly:true,binaryExecuted:false};
const evidence={schemaVersion:1,checkedAt:new Date().toISOString(),expectedBaselineCommit:'199236e3b227f9885c2beef64faffbe9e9a35583',scope:'Audit-only direct production function execution, isolated own fixture, no GUI, services, privilege change or executable launch',sourceFiles:[{path:trustedIpcPath,sha256:hash(trustedIpcSource)},{path:vpnPath,sha256:hash(vpnSource)}],ipcCases:urls,runtimeCase:runtime,observedBoundaryDefects:2,checks:7,expectedRejectionsNotObserved:1,limitations:['UNC content navigation and privilege escalation were not executed.','Fixture directory label does not assert a real Program Files ACL.','Existing updater package signature does not authenticate later profile runtime bytes.']};
await promises.writeFile(path.join(work,'security-boundary-reproductions.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({observedBoundaryDefects:evidence.observedBoundaryDefects,foreignFileHostAccepted:urls[1].actual,modifiedProfileRuntimeAccepted:runtime.fileDigestChanged&&selectedAfter.runtimePath===userExecutable,inertOnly:true,binaryExecuted:false}));
