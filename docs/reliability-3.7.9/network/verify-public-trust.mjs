import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const work = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public-artifacts');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = (folder, file) => fs.readFileSync(path.join(work, folder, file));
const sig = bytes => Buffer.from(bytes.toString('utf8').trim(), 'base64');
const folderFiles = folder => fs.readdirSync(path.join(work, folder));
const receipt = { observedAt: new Date().toISOString(), nodeVersion: process.version, method: 'Actual Ed25519 crypto.verify over original artifact bytes; no generated keys, signatures, mocks or installed-app execution', roots: [], registries: [], manifests: [], sourceFacts: {} };
const folders = fs.readdirSync(work, { withFileTypes: true }).filter(v => v.isDirectory()).map(v => v.name);
const trusts = [];
for (const label of folders) {
  const folder = ['b8662d3', '174983d', 'v3.7.1'].includes(label) ? path.join(label, 'resources', 'release') : label;
  if (!fs.existsSync(path.join(work, folder, 'root-public-key.pem'))) continue;
  const rootBytes = read(folder, 'root-public-key.pem');
  const root = createPublicKey(rootBytes);
  const registryBytes = read(folder, 'release-key-registry.json');
  const registrySig = sig(read(folder, 'release-key-registry.json.sig'));
  const registry = JSON.parse(registryBytes);
  trusts.push({ label, root, rootBytes, registry, registryBytes, registrySig });
  receipt.roots.push({ label, pemSha256: hash(rootBytes), spkiSha256: hash(root.export({type:'spki',format:'der'})) });
}
for (const t of trusts) {
  receipt.registries.push({ label: t.label, bytesSha256: hash(t.registryBytes), signatureBytes: t.registrySig.length, keys: t.registry.keys.map(k => ({id:k.id,status:k.status,notBefore:k.notBefore,notAfter:k.notAfter,spkiSha256:hash(createPublicKey(k.publicKeyPem).export({type:'spki',format:'der'}))})), verifiedByRoots: Object.fromEntries(trusts.map(r => [r.label, verify(null, t.registryBytes, r.root, t.registrySig)])) });
}
for (const folder of folders) {
  for (const name of ['release-manifest.json', 'stable-channel.json']) {
    if (!folderFiles(folder).includes(name)) continue;
    const bytes = read(folder, name);
    const signature = sig(read(folder, name + '.sig'));
    const manifest = JSON.parse(bytes);
    const verifiedByRegistries = Object.fromEntries(trusts.map(t => {
      const registryTrusted = verify(null, t.registryBytes, t.root, t.registrySig);
      const key = t.registry.keys.find(k => k.id === manifest.keyId);
      if (!registryTrusted || !key || key.status !== 'trusted') return [t.label, {accepted:false,reason:!registryTrusted?'registry-signature-invalid':!key?'key-unknown':'key-revoked'}];
      const published = Date.parse(manifest.publishedAt);
      const keyWindow = published >= Date.parse(key.notBefore) && published <= Date.parse(key.notAfter);
      const signatureValid = verify(null, bytes, createPublicKey(key.publicKeyPem), signature);
      return [t.label, {accepted:keyWindow && signatureValid,signatureValid,keyWindow}];
    }));
    receipt.manifests.push({ label: folder, name, bytesSha256:hash(bytes), version:manifest.version, keyId:manifest.keyId, minimumAppVersion:manifest.minimumAppVersion, publishedAt:manifest.publishedAt, assetName:manifest.installerName, assetUrl:manifest.canonicalDownloadUrl, assetBytes:manifest.size, assetSha256:manifest.sha256, assetSha512:manifest.sha512, verifiedByRegistries });
  }
}
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const baselineSource = name => execFileSync('git', ['show', 'b8662d3:src/recovered/electron/' + name], {cwd:project, encoding:'utf8', maxBuffer:2*1024*1024});
const updater = baselineSource('ipc/desktop-updater.js');
const trustSource = baselineSource('ipc/release-trust.js');
const main = baselineSource('main.js');
const stateStore = baselineSource('ipc/state-store.js');
receipt.sourceFacts = {
  baseline:'b8662d3', updaterSha256:hash(Buffer.from(updater)), trustSourceSha256:hash(Buffer.from(trustSource)),
  minimumAppVersionMentionedInUpdater:updater.includes('minimumAppVersion'),
  minimumAppVersionMentionsInTrustSource:(trustSource.match(/minimumAppVersion/g)||[]).length,
  bundledRegistryOnly:/readBundledReleaseFile\(RELEASE_KEY_REGISTRY_NAME\)/.test(trustSource),
  startupDelayTenSeconds:/runBackgroundUpdateCheck\(\);\s*\}, 1e4\)/.test(main),
  dailyInterval:/86400 \* 1e3/.test(main),
  automaticInstallOnAvailable:/desktopUpdater\.checkAndInstall\(\)/.test(main),
  autoUpdateDefaultTrue:/autoUpdate:\s*true/.test(stateStore),
};
const registryFor = label => receipt.registries.find(r => r.label === label);
const manifestFor = label => receipt.manifests.find(r => r.label === label && r.name === 'release-manifest.json');
const assertions = [
  ['Old bundled registry has a valid old-root signature', () => assert.equal(registryFor('b8662d3').verifiedByRoots.b8662d3, true)],
  ['New bundled registry has a valid new-root signature', () => assert.equal(registryFor('current').verifiedByRoots.current, true)],
  ['New registry is rejected by the old pinned root', () => assert.equal(registryFor('current').verifiedByRoots.b8662d3, false)],
  ['Installed root exactly matches the current public root', () => assert.equal(receipt.roots.find(r=>r.label==='installed').spkiSha256, receipt.roots.find(r=>r.label==='current').spkiSha256)],
  ['Actual candidate signature is valid for the installed key registry', () => assert.equal(manifestFor('candidate').verifiedByRegistries.installed.accepted, true)],
  ['Actual candidate key is unknown to the old key registry', () => assert.equal(manifestFor('candidate').verifiedByRegistries.b8662d3.reason, 'key-unknown')],
  ['Published3.7.1 signature verifies with its original own registry', () => assert.equal(manifestFor('published-v3.7.1').verifiedByRegistries['published-v3.7.1'].accepted, true)],
  ['Published3.5.4 signature verifies with the old release key', () => assert.equal(manifestFor('published-v3.5.4').verifiedByRegistries.b8662d3.accepted, true)],
  ['Exact old updater has no minimumAppVersion comparison', () => assert.equal(receipt.sourceFacts.minimumAppVersionMentionedInUpdater, false)],
];
for (const [, check] of assertions) check();
receipt.verificationAssertions = assertions.map(([name]) => ({name,ok:true}));
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'crypto-receipt.json'), JSON.stringify(receipt,null,2)+'\n');
const old = 'b8662d3';
console.log(JSON.stringify({ observedAt:receipt.observedAt, nodeVersion:receipt.nodeVersion, roots:receipt.roots.filter(r => ['b8662d3','current','installed'].includes(r.label)), registryMatrix:receipt.registries.filter(r=>['b8662d3','current','installed'].includes(r.label)).map(r=>({label:r.label,oldRoot:r.verifiedByRoots[old],currentRoot:r.verifiedByRoots.current,keys:r.keys.map(k=>k.id)})), manifestMatrix:receipt.manifests.filter(m=>['published-v3.7.7','candidate','published-v3.7.1','legacy-3.7.1'].includes(m.label)&&m.name==='release-manifest.json').map(m=>({label:m.label,version:m.version,keyId:m.keyId,minimumAppVersion:m.minimumAppVersion,old:m.verifiedByRegistries[old],current:m.verifiedByRegistries.current,installed:m.verifiedByRegistries.installed})), sourceFacts:receipt.sourceFacts},null,2));
