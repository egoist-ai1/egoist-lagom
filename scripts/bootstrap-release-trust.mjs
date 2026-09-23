import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { argumentsFor, readTrust } from './prepare-release-assets.mjs';

// Existing installations pin this root. Recovery must preserve it and its registry.
export async function bootstrapReleaseTrust(options) {
  for (const name of Object.keys(options)) if (!['trust-dir', 'root-private-key', 'output-dir'].includes(name)) throw new Error(`Unknown option: ${name}`);
  for (const name of ['trust-dir', 'root-private-key', 'output-dir']) if (!options[name] || !path.isAbsolute(options[name])) throw new Error(`Provide an absolute --${name} path; automatic key generation is disabled`);
  const { files, root } = await readTrust(options['trust-dir']);
  const privateKey = createPrivateKey(await fs.readFile(options['root-private-key']));
  if (privateKey.asymmetricKeyType !== 'ed25519' || !createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).equals(root.export({ type: 'spki', format: 'der' }))) throw new Error('Root private key does not match the pinned root; refuse trust replacement');
  const output = options['output-dir'];
  for (const name of Object.keys(files)) {
    try { if (!(await fs.readFile(path.join(output, name))).equals(files[name])) throw new Error(`Existing trust output differs: ${name}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  files['release-key-registry.json.sig'] = Buffer.from(sign(null, files['release-key-registry.json'], privateKey).toString('base64') + '\n');
  await fs.mkdir(output, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(output, name), bytes);
  return { preservedRoot: true, generatedKeys: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await bootstrapReleaseTrust(argumentsFor(process.argv.slice(2))))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
