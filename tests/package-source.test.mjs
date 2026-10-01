import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { packageSource, assertPackageSource } from '../scripts/package-source.mjs';

test('candidate source binding rejects modified and uncommitted inputs and detects a changed commit during packaging', { skip: !process.env.LAGOM_TEST_TEMP && 'Set LAGOM_TEST_TEMP to an isolated task work directory' }, async () => {
  const work = process.env.LAGOM_TEST_TEMP;
  assert.ok(work && path.isAbsolute(work), 'Set LAGOM_TEST_TEMP to the task-owned work directory');
  const directory = await fs.mkdtemp(path.join(work, 'package-source-'));
  const git = args => execFileSync('git', args, { cwd: directory, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const commit = () => {
    git(['add', '--', 'src']);
    git(['-c', 'user.name=Candidate Test', '-c', 'user.email=candidate@example.invalid', 'commit', '-m', 'fixture']);
  };
  try {
    git(['init', '--quiet']);
    await fs.mkdir(path.join(directory, 'src'));
    const source = path.join(directory, 'src', 'main.js');
    await fs.writeFile(source, 'export const value=1;\n');
    commit();
    const snapshot = await packageSource(directory);
    assert.match(snapshot.source.commit, /^[a-f0-9]{40}$/);
    assert.deepEqual(snapshot.files.map(file => file.path), ['src/main.js']);
    await assertPackageSource(directory, snapshot);
    const extra = path.join(directory, 'src', 'untracked.js');
    await fs.writeFile(extra, 'export const extra=1;\n');
    await assert.rejects(packageSource(directory), /Uncommitted build inputs/);
    await fs.unlink(extra);
    await fs.writeFile(source, 'export const value=2;\n');
    await assert.rejects(packageSource(directory), /Commit tracked changes/);
    commit();
    await assert.rejects(assertPackageSource(directory, snapshot), /Source changed during packaging/);
  } finally {
    assert.equal(path.dirname(directory), path.resolve(work));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
