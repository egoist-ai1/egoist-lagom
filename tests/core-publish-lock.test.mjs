import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

test('production single-file graph adds only its pinned SDK task to the development dependencies', async () => {
  const normal = JSON.parse(await fs.readFile('src/service/packages.lock.json', 'utf8'));
  const publish = JSON.parse(await fs.readFile('src/service/packages.publish.lock.json', 'utf8'));
  const project = await fs.readFile('src/service/EgoistShield.Service.csproj', 'utf8');
  const runtimeVersion = project.match(/<RuntimeFrameworkVersion>([^<]+)<\/RuntimeFrameworkVersion>/)?.[1];
  const task = publish.dependencies['net10.0-windows7.0']['Microsoft.NET.ILLink.Tasks'];
  assert.equal(task.resolved, runtimeVersion);
  assert.equal(task.requested, `[${runtimeVersion}, )`);
  assert.equal(task.type, 'Direct');
  assert.match(task.contentHash, /^[A-Za-z0-9+/]{86}==$/);
  const developmentGraph = structuredClone(publish);
  delete developmentGraph.dependencies['net10.0-windows7.0']['Microsoft.NET.ILLink.Tasks'];
  assert.deepEqual(developmentGraph, normal);
});

test('actual package and diagnostic restore select the separate publish lock with locked mode intact', async () => {
  const source = await fs.readFile('scripts/package-windows.mjs', 'utf8');
  const lockExpression = source.match(/const corePublishLock = ([^;]+);/)?.[1];
  const propertiesExpression = source.match(/const coreBuildProperties = (\[[^;]+\]);/)?.[1];
  assert.ok(lockExpression && propertiesExpression);
  const root = path.resolve('.');
  const corePublishLock = vm.runInNewContext(lockExpression, {path, root});
  const properties = vm.runInNewContext(propertiesExpression, {corePublishLock, coreIntermediate: path.join(root, 'fixture-obj')});
  assert.equal(corePublishLock, path.join(root, 'src/service/packages.publish.lock.json'));
  assert.equal(properties.filter(value => value.startsWith('-p:NuGetLockFilePath=')).length, 1);
  assert.ok(properties.includes(`-p:NuGetLockFilePath=${corePublishLock}`));
  assert.ok(properties.includes('-p:PublishSingleFile=true') && properties.includes('-p:SelfContained=true'));
  assert.match(source, /\['restore',[\s\S]*?'--locked-mode',[\s\S]*?\.\.\.coreBuildProperties/);
  const diagnostic = await fs.readFile('tests/windows-installer-diagnostics.ps1', 'utf8');
  assert.match(diagnostic, /NuGetLockFilePath=[\s\S]*?packages\.publish\.lock\.json/);
});
