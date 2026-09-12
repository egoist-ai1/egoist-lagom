import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const requireBanner = "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);";

async function bundle(tempDir, name, source, banner) {
  const output = path.join(tempDir, `${name}.mjs`);
  await build({
    stdin: {
      contents: source,
      resolveDir: root,
      sourcefile: 'undici-bootstrap-entry.mjs'
    },
    outfile: output,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    bundle: true,
    ...(banner ? { banner: { js: requireBanner } } : {})
  });
  return spawnSync(process.execPath, [output], { encoding: 'utf8', windowsHide: true });
}

test('ESM main bundles initialize eager yaml and undici through createRequire', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egoistshield-esm-bootstrap-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const staticUndici = "import { ProxyAgent } from 'undici'; process.stdout.write(typeof ProxyAgent);";
  const withoutBanner = await bundle(tempDir, 'without-banner', staticUndici, false);
  assert.notEqual(withoutBanner.status, 0);
  assert.match(withoutBanner.stderr, /Dynamic require of /);

  const eagerMainDependencies = "import { parse } from 'yaml'; import { ProxyAgent } from 'undici'; process.stdout.write(`${parse('enabled: true').enabled}:${typeof ProxyAgent}`);";
  const eagerWithoutBanner = await bundle(tempDir, 'eager-without-banner', eagerMainDependencies, false);
  assert.notEqual(eagerWithoutBanner.status, 0);
  assert.match(eagerWithoutBanner.stderr, /Dynamic require of /);

  const lazyUndici = "export async function load() { return import('undici'); }\nprocess.stdout.write('initialized');";
  const lazyWithoutBanner = await bundle(tempDir, 'lazy-without-banner', lazyUndici, false);
  assert.equal(lazyWithoutBanner.status, 0, lazyWithoutBanner.stderr);
  assert.equal(lazyWithoutBanner.stdout, 'initialized');

  const withBanner = await bundle(tempDir, 'with-banner', eagerMainDependencies, true);
  assert.equal(withBanner.status, 0, withBanner.stderr);
  assert.equal(withBanner.stdout, 'true:function');

  const buildScript = await fs.readFile(path.join(root, 'scripts', 'build.mjs'), 'utf8');
  assert.match(buildScript, /banner:\s*\{ js: esmRequireBanner \}/);
});
