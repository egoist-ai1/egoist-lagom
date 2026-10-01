import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Package source identity could not be verified: ' + (result.error?.message || result.stderr));
  return result.stdout;
}

export async function packageSource(root) {
  if (git(root, ['status', '--porcelain', '--untracked-files=no']).trim()) throw new Error('Commit tracked changes before packaging a release candidate.');
  if (git(root, ['ls-files', '--others', '--exclude-standard', '--', 'src', 'scripts', 'resources', 'public-ui']).trim()) throw new Error('Uncommitted build inputs cannot be packaged as a release candidate.');
  const commit = git(root, ['rev-parse', 'HEAD']).trim();
  const tree = git(root, ['rev-parse', 'HEAD^{tree}']).trim();
  if (![commit, tree].every(value => /^[a-f0-9]{40}$/.test(value))) throw new Error('Package source requires exact Git commit and tree identities.');
  const names = git(root, ['ls-files', '-z', '--', 'src', 'scripts', 'resources', 'public-ui', 'package.json', 'package-lock.json', 'global.json', 'LICENSE.txt']).split('\0').filter(Boolean).sort();
  const files = [];
  for (const name of names) {
    const bytes = await fs.readFile(path.join(root, ...name.split('/')));
    files.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { source: { commit, tree }, files, sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
}

export async function assertPackageSource(root, expected) {
  const observed = await packageSource(root);
  if (observed.source.commit !== expected.source.commit || observed.source.tree !== expected.source.tree || observed.sha256 !== expected.sha256) throw new Error('Source changed during packaging; rebuild the candidate.');
}
