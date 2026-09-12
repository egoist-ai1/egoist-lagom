import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,createPrivateKey,sign,randomUUID} from 'node:crypto';
const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
const directory=path.resolve('dist');
const installerName=`EgoistShield-Setup-${pkg.version}.exe`;
const bytes=await fs.readFile(path.join(directory,installerName));
const hash=algorithm=>createHash(algorithm).update(bytes).digest('hex');
const manifest={schemaVersion:2,channel:'stable',version:pkg.version,tag:`v${pkg.version}`,installerName,canonicalDownloadUrl:`https://github.com/egoist-ai1/egoistshield/releases/download/v${pkg.version}/${installerName}`,size:bytes.length,sha256:hash('sha256'),sha512:hash('sha512'),githubDigest:`sha256:${hash('sha256')}`,minimumAppVersion:pkg.version,keyId:'release-2026-09',authenticodeStatus:'not-signed',licenseVersion:'1.0',publishedAt:new Date().toISOString()};
const key=createPrivateKey(await fs.readFile('.local/release-secrets/release.private.pem'));
const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
const signature=sign(null,manifestBytes,key).toString('base64')+'\n';
for(const name of ['release-manifest.json','stable-channel.json']){await fs.writeFile(path.join(directory,name),manifestBytes);await fs.writeFile(path.join(directory,name+'.sig'),signature)}
await fs.writeFile(path.join(directory,installerName+'.sha256'),`${manifest.sha256}  ${installerName}\n`);
await fs.copyFile('LICENSE.txt',path.join(directory,'LICENSE.txt'));
await fs.copyFile('docs/THIRD-PARTY-NOTICES.txt',path.join(directory,'THIRD-PARTY-NOTICES.txt'));
for(const name of ['root-public-key.pem','release-key-registry.json','release-key-registry.json.sig'])await fs.copyFile('resources/release/'+name,path.join(directory,name));
const inherited=JSON.parse(await fs.readFile('recovery/release-3.5.4/EgoistShield-3.5.4.cdx.json','utf8'));
const lock=JSON.parse(await fs.readFile('package-lock.json','utf8'));
const components=inherited.components.filter(c=>['electron','react','react-dom','framer-motion','motion','lucide-react','@fontsource/inter'].includes(c.name));
for(const [location,info] of Object.entries(lock.packages))if(location&&info.version){const name=location.replace(/^node_modules\//,'');components.push({type:'library',name,version:info.version,scope:info.dev?'excluded':'required',...(info.license?{licenses:[{license:{name:info.license}}]}:{})})}
components.push({type:'library',name:'Phosphor Icons (static SVG assets)',version:'2.1.10',licenses:[{license:{id:'MIT'}}]});
components.push({type:'library',name:'Wintun',version:'0.14.1',licenses:[{license:{name:'WireGuard LLC Prebuilt Binaries License',url:'https://www.wintun.net/'}}],hashes:[{alg:'SHA-256',content:createHash('sha256').update(await fs.readFile(`out/EgoistShield-${pkg.version}-win-x64/resources/runtime/xray/wintun.dll`)).digest('hex')}],externalReferences:[{type:'distribution',url:'https://www.wintun.net/builds/wintun-0.14.1.zip'}]});
const runtime=JSON.parse(await fs.readFile(`out/EgoistShield-${pkg.version}-win-x64/resources/runtime/manifest.json`,'utf8'));
for(const entry of runtime.components)components.push({type:'application',name:entry.name,version:entry.version??entry.desiredVersion??'unknown',properties:[{name:'egoistshield:source',value:entry.upstream?.repositoryUrl??'bundled runtime manifest'}]});
const sbom={bomFormat:'CycloneDX',specVersion:'1.6',serialNumber:'urn:uuid:'+randomUUID(),version:1,metadata:{timestamp:manifest.publishedAt,component:{type:'application',name:'Egoist Lagom',version:pkg.version,hashes:[{alg:'SHA-256',content:manifest.sha256}]},properties:[{name:'egoistlagom:inventory-scope',value:'Known renderer dependencies, current npm lock and bundled runtime manifest; development-only npm packages are excluded scope.'}]},components};
await fs.writeFile(path.join(directory,`EgoistShield-${pkg.version}.cdx.json`),JSON.stringify(sbom,null,2)+'\n');
console.log(JSON.stringify({version:pkg.version,keyId:manifest.keyId,sha256:manifest.sha256,size:bytes.length}));
