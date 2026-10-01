// Audit-only baseline defect reproducer. Arguments: absolute project path, own task work outside project.
// Inert files/controlled loopback only. The assertions demonstrate the baseline defects; they are not post-fix tests.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const project = process.argv[2];
const work = process.argv[3];
if (!project || !work || !path.isAbsolute(project) || !path.isAbsolute(work)) throw new Error('Pass an absolute project path and your own task work outside the project.');
const normalizedProject = path.resolve(project).toLowerCase();
const normalizedWork = path.resolve(work).toLowerCase();
if (normalizedWork === normalizedProject || normalizedWork.startsWith(normalizedProject + path.sep)) throw new Error('Work must be the active task runtime outside the project.');
const sources=await Promise.all(['release-trust.js','desktop-updater.js'].map(name=>fs.readFile(path.join(project,'src/recovered/electron/ipc',name),'utf8')));
const api=vm.runInNewContext(sources.join('\n')+'\n({validateManifest,assertCanonicalCandidateUrl})',{URL,process});
const pathname='/egoist-ai1/egoist-lagom/releases/download/v3.8.0/EgoistShield-Setup-3.8.0.exe';
const base={schemaVersion:2,channel:'stable',version:'3.8.0',tag:'v3.8.0',installerName:'EgoistShield-Setup-3.8.0.exe',canonicalDownloadUrl:'https://github.com'+pathname,size:100,sha256:'a'.repeat(64),sha512:'b'.repeat(128),githubDigest:'sha256:'+'a'.repeat(64),minimumAppVersion:'3.7.8',keyId:'fixture-release',authenticodeStatus:'not-signed',licenseVersion:'1.0',publishedAt:'2026-09-29T00:00:00.000Z'};
const cases=[['canonical','https://github.com'+pathname,true],['unexpected-port','https://github.com:8443'+pathname,false],['inert-url-credentials','https://fixture-user:inert-password@github.com'+pathname,false],['plain-http','http://github.com'+pathname,false],['wrong-host','https://audit.invalid'+pathname,false],['query','https://github.com'+pathname+'?inert=1',false]].map(([kind,url,expected])=>{
 let manifestAccepted,launchAccepted;
 try{api.validateManifest({...base,canonicalDownloadUrl:url});manifestAccepted=true;}catch{manifestAccepted=false;}
 try{api.assertCanonicalCandidateUrl({version:'3.8.0',tag:'v3.8.0',assetName:base.installerName,assetUrl:url});launchAccepted=true;}catch{launchAccepted=false;}
 return {kind,url,expected,manifestAccepted,launchAccepted};
});
assert.equal(cases[1].manifestAccepted,true);
assert.equal(cases[1].launchAccepted,true);
assert.equal(cases[2].manifestAccepted,true);
assert.equal(cases[2].launchAccepted,true);
const result={schemaVersion:1,checkedAt:new Date().toISOString(),expectedBaselineCommit:'199236e3b227f9885c2beef64faffbe9e9a35583',scope:'Actual schema/candidate URL validation functions with synthetic public metadata. No signatures generated, remote request, executable or service launched.',cases,sourceFiles:sources.map((source,i)=>({path:'src/recovered/electron/ipc/'+['release-trust.js','desktop-updater.js'][i],sha256:createHash('sha256').update(source).digest('hex')})),limitation:'A signed stable manifest or trusted producer error is required to reach this URL. This reproduction does not bypass Ed25519 or prove SSRF from an untrusted renderer.'};
await fs.writeFile(path.join(work,'canonical-url-reproductions.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({cases:cases.length,unexpectedPortAccepted:true,urlCredentialsAccepted:true,networkRequests:0}));
