import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createPrivateKey, createPublicKey, sign, verify, randomUUID } from 'node:crypto';

const rootDefault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const trustNames = ['root-public-key.pem', 'release-key-registry.json', 'release-key-registry.json.sig'];
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const publicDer = key => createPublicKey(key).export({ type: 'spki', format: 'der' });
export function argumentsFor(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!/^--[a-z-]+$/.test(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Expected --option value pairs');
    const name = argv[i].slice(2);
    if (name in options) throw new Error(`Duplicate option: ${name}`);
    options[name] = argv[i + 1];
  }
  return options;
}
export async function readTrust(directory) {
  const files = Object.fromEntries(await Promise.all(trustNames.map(async name => [name, await fs.readFile(path.join(directory, name))])));
  const root = createPublicKey(files['root-public-key.pem']);
  if (root.asymmetricKeyType !== 'ed25519' || !verify(null, files['release-key-registry.json'], root, Buffer.from(files['release-key-registry.json.sig'].toString().trim(), 'base64'))) throw new Error('Release key registry signature is invalid');
  const registry = JSON.parse(files['release-key-registry.json']);
  if (registry.schemaVersion !== 1 || !Number.isFinite(Date.parse(registry.generatedAt)) || !Array.isArray(registry.keys) || !registry.keys.length || new Set(registry.keys.map(key => key.id)).size !== registry.keys.length) throw new Error('Invalid release key registry');
  for (const key of registry.keys) if (typeof key.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(key.id) || key.algorithm !== 'Ed25519' || !['trusted', 'revoked'].includes(key.status) || !Number.isFinite(Date.parse(key.notBefore)) || !Number.isFinite(Date.parse(key.notAfter)) || createPublicKey(key.publicKeyPem).asymmetricKeyType !== 'ed25519') throw new Error('Invalid release key registry entry');
  return { files, registry, root };
}
function releaseKey(registry, keyId, publishedAt) {
  const key = registry.keys.find(item => item.id === keyId);
  const time = Date.parse(publishedAt);
  if (!key || key.status !== 'trusted' || key.algorithm !== 'Ed25519' || !Number.isFinite(time) || !Number.isFinite(Date.parse(key.notBefore)) || !Number.isFinite(Date.parse(key.notAfter)) || time < Date.parse(key.notBefore) || time > Date.parse(key.notAfter) || time > Date.now() + 900000) throw new Error('Release signing key is absent, revoked, or outside its validity interval');
  return key;
}
export async function prepareReleaseAssets(options = {}) {
  for (const name of Object.keys(options)) if (!['project-root', 'dist', 'runtime-dir', 'trust-dir', 'private-key', 'key-id', 'notices', 'license', 'verify-only'].includes(name)) throw new Error(`Unknown option: ${name}`);
  const root = path.resolve(options['project-root'] ?? rootDefault);
  const dist = path.resolve(options.dist ?? path.join(root, 'dist'));
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Expected a stable semantic version');
  const installerName = 'Egoist-Lagom-Setup.exe';
  const installer = await fs.readFile(path.join(dist, installerName));
  const integrity = JSON.parse(await fs.readFile(path.join(dist, 'package-integrity.json'), 'utf8'));
  if (!installer.length || installer.length > 1024 ** 3 || integrity.version !== pkg.version || integrity.publicInstaller?.bytes !== installer.length || typeof integrity.publicInstaller?.sha256 !== 'string' || integrity.publicInstaller.sha256.toLowerCase() !== hash(installer) || path.basename(integrity.publicInstaller?.path ?? '') !== installerName) throw new Error('Installer does not match package-integrity.json');
  const trust = await readTrust(path.resolve(options['trust-dir'] ?? path.join(root, 'resources/release')));
  for (const name of trustNames) {
    const packed = integrity.payload?.find(item => item.path === `resources/release/${name}`);
    const bytes = trust.files[name];
    if (!packed || packed.bytes !== bytes.length || String(packed.sha256).toLowerCase() !== hash(bytes)) throw new Error(`Source trust differs from packaged trust: ${name}; rebuild the installer`);
  }
  const expected = { schemaVersion: 2, channel: 'stable', version: pkg.version, tag: `v${pkg.version}`, installerName, canonicalDownloadUrl: `https://github.com/egoist-ai1/egoist-lagom/releases/download/v${pkg.version}/${installerName}`, size: installer.length, sha256: hash(installer), sha512: hash(installer, 'sha512'), githubDigest: `sha256:${hash(installer)}` };
  if (options['verify-only']) {
    if (options['verify-only'] !== 'true') throw new Error('--verify-only requires true');
    const bytes = await fs.readFile(path.join(dist, 'release-manifest.json'));
    const manifest = JSON.parse(bytes);
    const key = releaseKey(trust.registry, manifest.keyId, manifest.publishedAt);
    const signature = await fs.readFile(path.join(dist, 'release-manifest.json.sig'));
    if (!verify(null, bytes, createPublicKey(key.publicKeyPem), Buffer.from(signature.toString().trim(), 'base64'))) throw new Error('Release manifest signature is invalid');
    if (Object.entries(expected).some(([name, value]) => manifest[name] !== value) || typeof manifest.minimumAppVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.minimumAppVersion) || !['valid', 'not-signed'].includes(manifest.authenticodeStatus) || typeof manifest.licenseVersion !== 'string' || !manifest.licenseVersion.trim()) throw new Error('Signed manifest does not match candidate');
    if (!(await fs.readFile(path.join(dist, 'stable-channel.json'))).equals(bytes) || !(await fs.readFile(path.join(dist, 'stable-channel.json.sig'))).equals(signature)) throw new Error('Stable channel differs from signed manifest');
    for (const name of trustNames) if (!(await fs.readFile(path.join(dist, name))).equals(trust.files[name])) throw new Error(`Published trust file differs from bundled trust: ${name}`);
    if ((await fs.readFile(path.join(dist, `${installerName}.sha256`), 'utf8')).trim() !== `${manifest.sha256}  ${installerName}`) throw new Error('Installer checksum file does not match candidate');
    return manifest;
  }
  const privatePath = options['private-key'] ?? process.env.EGOIST_RELEASE_PRIVATE_KEY;
  if (!privatePath || !path.isAbsolute(privatePath)) throw new Error('Provide an absolute --private-key path or EGOIST_RELEASE_PRIVATE_KEY; trusted keys are never regenerated');
  const keyId = options['key-id'] ?? 'release-2026-09';
  const publishedAt = new Date().toISOString();
  const trustedKey = releaseKey(trust.registry, keyId, publishedAt);
  const privateKey = createPrivateKey(await fs.readFile(privatePath));
  if (privateKey.asymmetricKeyType !== 'ed25519' || !publicDer(privateKey).equals(publicDer(trustedKey.publicKeyPem))) throw new Error('Private signing key does not match the trusted release key');
  const manifest = { ...expected, minimumAppVersion: pkg.version, keyId, authenticodeStatus: 'not-signed', licenseVersion: '1.0', publishedAt };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  const signature = sign(null, bytes, privateKey).toString('base64') + '\n';
  const runtimeDir = path.resolve(options['runtime-dir'] ?? path.join(root, `out/EgoistShield-${pkg.version}-win-x64/resources/runtime`));
  const [license, notices, lockText, runtimeText] = await Promise.all([
    fs.readFile(path.resolve(options.license ?? path.join(root, 'LICENSE.txt'))),
    fs.readFile(path.resolve(options.notices ?? path.join(root, 'THIRD-PARTY-NOTICES.txt'))),
    fs.readFile(path.join(root, 'package-lock.json'), 'utf8'),
    fs.readFile(path.join(runtimeDir, 'manifest.json'), 'utf8')
  ]);
  const components = Object.entries(JSON.parse(lockText).packages).filter(([location, info]) => location && info.version).map(([location, info]) => ({ type: 'library', name: info.name ?? location.split('node_modules/').at(-1), version: info.version, scope: info.dev && location !== 'node_modules/gsap' ? 'excluded' : 'required', ...(info.license ? { licenses: [{ license: { name: info.license } }] } : {}) }));
  for (const entry of JSON.parse(runtimeText).components) components.push({ type: 'application', name: entry.name, version: entry.version ?? entry.desiredVersion ?? 'unknown', properties: [{ name: 'egoistlagom:source', value: entry.upstream?.repositoryUrl ?? 'bundled runtime manifest' }] });
  const sbom = { bomFormat: 'CycloneDX', specVersion: '1.6', serialNumber: `urn:uuid:${randomUUID()}`, version: 1, metadata: { timestamp: publishedAt, component: { type: 'application', name: 'Egoist Lagom', version: pkg.version, hashes: [{ alg: 'SHA-256', content: manifest.sha256 }] }, properties: [{ name: 'egoistlagom:inventory-scope', value: 'Current npm lock and bundled runtime manifest. This inventory does not claim complete coverage of recovered renderer code or transitive native dependencies.' }] }, components };
  // Finish input validation before replacing release metadata.
  const outputs = { ...trust.files, 'LICENSE.txt': license, 'THIRD-PARTY-NOTICES.txt': notices, [`${installerName}.sha256`]: `${manifest.sha256}  ${installerName}\n`, [`Egoist-Lagom-${pkg.version}.cdx.json`]: JSON.stringify(sbom, null, 2) + '\n' };
  for (const name of ['release-manifest.json', 'stable-channel.json']) { outputs[name] = bytes; outputs[`${name}.sig`] = signature; }
  for (const [name, data] of Object.entries(outputs)) await fs.writeFile(path.join(dist, name), data);
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await prepareReleaseAssets(argumentsFor(process.argv.slice(2))); console.log(JSON.stringify({ version: result.version, tag: result.tag, keyId: result.keyId, sha256: result.sha256, size: result.size })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
