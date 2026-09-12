import fs from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPairSync, createHash, createPrivateKey, sign } from 'node:crypto';
const secrets = path.resolve('.local/release-secrets');
const trust = path.resolve('resources/release');
await fs.mkdir(secrets, { recursive: true });
await fs.mkdir(trust, { recursive: true });
const keys = {};
for (const kind of ['root','release']) {
  const privatePath = path.join(secrets, `${kind}.private.pem`);
  const publicPath = path.join(secrets, `${kind}.public.pem`);
  try { keys[kind] = { privateKey: await fs.readFile(privatePath, 'utf8'), publicKey: await fs.readFile(publicPath, 'utf8') }; }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { await fs.access(privatePath); throw new Error('Incomplete signing key set; refuse to replace an existing private key'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    keys[kind] = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    await fs.writeFile(privatePath, keys[kind].privateKey, { flag: 'wx', mode: 0o600 });
    await fs.writeFile(publicPath, keys[kind].publicKey, { flag: 'wx' });
  }
}
const oldRegistry = JSON.parse(await fs.readFile('recovery/official-app/resources/release/release-key-registry.json', 'utf8'));
const registry = { schemaVersion: 1, generatedAt: new Date().toISOString(), keys: [...oldRegistry.keys, { id: 'release-2026-09', algorithm: 'Ed25519', status: 'trusted', publicKeyPem: keys.release.publicKey, notBefore: '2026-09-07T00:00:00.000Z', notAfter: '2028-09-07T00:00:00.000Z' }] };
const bytes = Buffer.from(JSON.stringify(registry, null, 2) + '\n');
await fs.writeFile(path.join(trust,'release-key-registry.json'), bytes);
await fs.writeFile(path.join(trust,'release-key-registry.json.sig'), sign(null, bytes, createPrivateKey(keys.root.privateKey)).toString('base64') + '\n');
await fs.writeFile(path.join(trust,'root-public-key.pem'), keys.root.publicKey);
console.log(JSON.stringify({ keyId: 'release-2026-09', rootPublicKeySha256: createHash('sha256').update(keys.root.publicKey).digest('hex') }));
