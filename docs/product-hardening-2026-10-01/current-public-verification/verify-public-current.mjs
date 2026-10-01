import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authenticateCurrentCandidateBytes, verifyCurrentCandidateInstaller } from '../../../tests/windows-production-legacy-upgrade.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(directory, '../../..');
const api = 'https://api.github.com/repos/egoist-ai1/egoist-lagom';
const releaseRoot = 'https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.8.0/';
const stableRoot = 'https://github.com/egoist-ai1/egoist-lagom/releases/latest/download/';
const names = ['stable-channel.json', 'stable-channel.json.sig', 'release-manifest.json', 'release-manifest.json.sig',
  'release-key-registry.json', 'release-key-registry.json.sig', 'root-public-key.pem', 'package-integrity.json'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const key = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const inside = (file, root) => key(file).startsWith(key(root) + path.sep);
const limit = name => name.endsWith('.sig') ? 1024 : name.endsWith('.pem') ? 4096 : name === 'package-integrity.json' ? 16 * 1024 ** 2 : 256 * 1024;

export function parsePublicCurrentArguments(argv, taskWork) {
  assert.equal(argv.length, 10, 'Exactly five explicit argument pairs required.');
  const allowed = new Set(['--candidate', '--release-id', '--source-commit', '--cache', '--output']), values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    assert.ok(allowed.has(argv[index]) && !values.has(argv[index]) && typeof argv[index + 1] === 'string' && !argv[index + 1].startsWith('--'), 'Unknown, duplicate or missing argument.');
    values.set(argv[index], argv[index + 1]);
  }
  const sourceCommit = values.get('--source-commit'), rawId = values.get('--release-id');
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  assert.ok(/^[1-9]\d{0,15}$/.test(rawId) && Number.isSafeInteger(Number(rawId)), 'Explicit positive safe release ID required.');
  const candidate = values.get('--candidate'), cache = values.get('--cache'), output = values.get('--output');
  assert.ok([candidate, cache, output, taskWork].every(value => typeof value === 'string' && path.isAbsolute(value)), 'Absolute candidate/cache/output and actual task work required.');
  assert.equal(key(candidate), key(path.join(project, 'dist', `october-${sourceCommit.slice(0, 12)}`)), 'Candidate must match current source-bound project dist.');
  assert.ok(key(cache) === key(taskWork) || inside(cache, taskWork), 'Cache must belong to actual caller task work.');
  assert.equal(key(output), key(path.join(directory, 'report.json')), 'Output must be the current public-verification report.');
  return { candidate: path.resolve(candidate), cache: path.resolve(cache), output: path.resolve(output), sourceCommit, releaseId: Number(rawId) };
}

export function guardedPublicCurrentUrl(raw, { redirect = false, apiRequest = false } = {}) {
  const url = new URL(raw), host = url.hostname.toLowerCase();
  const cdn = ['objects.githubusercontent.com', 'release-assets.githubusercontent.com'].includes(host);
  assert.ok(url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && !url.hash, 'HTTPS/port/credential guard refused.');
  assert.ok(apiRequest ? host === 'api.github.com' : host === 'github.com' || redirect && cdn, 'Public host/redirect guard refused.');
  assert.ok(!url.search || redirect && cdn, 'Only signed CDN redirects may contain queries.');
  assert.ok(apiRequest ? url.pathname.startsWith('/repos/egoist-ai1/egoist-lagom/') : cdn || url.pathname.startsWith('/egoist-ai1/egoist-lagom/releases/'), 'Canonical repository path required.');
  return url;
}

async function ordinary(target, directoryOnly = false) {
  let current = path.resolve(target), first = true;
  while (true) {
    const stat = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    assert.ok(!stat?.isSymbolicLink() && (!first || !stat || (directoryOnly ? stat.isDirectory() : stat.isFile() && stat.nlink === 1)), 'Ordinary nonlinked path required.');
    const parent = path.dirname(current); if (parent === current) break; current = parent; first = false;
  }
}
async function read(file, maximum) {
  await ordinary(file); const stat = await fs.stat(file);
  assert.ok(stat.isFile() && stat.size > 0 && stat.size <= maximum, 'Input size/type refused.');
  const bytes = await fs.readFile(file); assert.ok(bytes.length <= maximum, 'Input grew beyond bound.'); return bytes;
}
async function actualTaskWork() {
  assert.match(process.env.CODEX_THREAD_ID ?? '', /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.ok(process.env.USERPROFILE && path.isAbsolute(process.env.USERPROFILE), 'Configured local user profile required.');
  const pointer = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read(path.join(process.env.USERPROFILE, '.codex/brain-pointer.json'), 8192)));
  assert.ok(typeof pointer.chat_runtime === 'string' && path.isAbsolute(pointer.chat_runtime), 'Configured task runtime required.');
  return path.join(pointer.chat_runtime, 'tasks', process.env.CODEX_THREAD_ID, 'work');
}

async function request(url, { maxBytes, outputFile = null, timeoutMs = 20000 }, observations) {
  const apiRequest = new URL(url).hostname === 'api.github.com';
  let current = guardedPublicCurrentUrl(url, { apiRequest }), response, handle, transferred = 0;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs), hops = [];
  const chunks = [], sha256 = createHash('sha256'), sha512 = createHash('sha512');
  const observation = { url, method: 'GET', observedAtUtc: new Date().toISOString(), hops, outcome: 'failed' };
  observations.push(observation);
  try {
    for (let hop = 0; hop <= 5; hop++) {
      response = await fetch(current, { redirect: 'manual', credentials: 'omit', signal: controller.signal,
        headers: { 'User-Agent': 'EgoistLagom-CurrentPublicReadback', Accept: outputFile ? 'application/octet-stream' : 'application/json', 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' } });
      hops.push({ host: current.hostname, status: response.status });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location'); await response.body?.cancel();
      assert.ok(location && hop < 5, 'Redirect bound/referral failed.');
      current = guardedPublicCurrentUrl(new URL(location, current).href, { redirect: true, apiRequest });
    }
    assert.ok(response.status === 200 && response.body, 'Public endpoint is unavailable.');
    const length = response.headers.get('content-length');
    assert.ok(length === null || /^\d+$/.test(length) && Number(length) <= maxBytes, 'Response length exceeds bound.');
    if (outputFile) handle = await fs.open(outputFile, 'wx', 0o600);
    for await (const chunk of response.body) {
      transferred += chunk.length; assert.ok(transferred <= maxBytes, 'Body exceeded bound.');
      sha256.update(chunk); sha512.update(chunk);
      if (handle) { let offset = 0; while (offset < chunk.length) { const part = await handle.write(chunk, offset, chunk.length - offset); assert.ok(part.bytesWritten > 0); offset += part.bytesWritten; } }
      else chunks.push(chunk);
    }
    if (handle) await handle.sync();
    Object.assign(observation, { outcome: 'pass', status: 200, bytes: transferred, sha256: sha256.digest('hex'), sha512: sha512.digest('hex') });
    return { ...observation, body: outputFile ? null : Buffer.concat(chunks) };
  } finally { clearTimeout(timer); if (handle) await handle.close(); await response?.body?.cancel().catch(() => {}); }
}
const json = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
function inputs(materials, baseline, sourceCommit, stable = false) {
  return { rootBytes: materials.get('root-public-key.pem'), bundledRegistryBytes: baseline.registry,
    bundledRegistrySignature: baseline.signature, candidateRegistryBytes: materials.get('release-key-registry.json'),
    candidateRegistrySignature: materials.get('release-key-registry.json.sig'), manifestBytes: materials.get(stable ? 'stable-channel.json' : 'release-manifest.json'),
    manifestSignature: materials.get(stable ? 'stable-channel.json.sig' : 'release-manifest.json.sig'),
    integrityBytes: materials.get('package-integrity.json'), sourceCommit };
}

async function main() {
  let options, cache, stage = 'arguments', report;
  try {
    options = parsePublicCurrentArguments(process.argv.slice(2), await actualTaskWork());
    assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0', 'TLS verification must remain enabled.');
    await ordinary(options.cache, true); await fs.access(options.cache);
    await ordinary(options.candidate, true); await ordinary(options.output);
    assert.equal(await fs.stat(options.output).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }), false, 'Existing report refused.');
    cache = path.join(options.cache, `current-public-${options.releaseId}-${randomUUID()}`); await fs.mkdir(cache);
    report = { schemaVersion: 1, kind: 'current-public-feed-download-verification', ok: false, startedAtUtc: new Date().toISOString(),
      scope: 'current 3.8.0 public latest/stable feed and actual file download only', sourceCommit: options.sourceCommit, expectedReleaseId: options.releaseId,
      cache, httpObservations: [], installerExecuted: false, guiUpdaterExecuted: false, serviceNetworkMutations: false,
      futureUpdateBehavior: 'covered by separate source tests; not executed by this tool' };
    stage = 'local-signed-candidate';
    const baseline = { root: await read(path.join(project, 'resources/release/root-public-key.pem'), 4096),
      registry: await read(path.join(project, 'resources/release/release-key-registry.json'), 256 * 1024),
      signature: await read(path.join(project, 'resources/release/release-key-registry.json.sig'), 1024) };
    const local = new Map(await Promise.all(names.map(async name => [name, await read(path.join(options.candidate, name), limit(name))])));
    assert.ok(local.get('root-public-key.pem').equals(baseline.root), 'Candidate root differs from project pin baseline.');
    const accepted = authenticateCurrentCandidateBytes(inputs(local, baseline, options.sourceCommit));
    authenticateCurrentCandidateBytes(inputs(local, baseline, options.sourceCommit, true));
    assert.ok(local.get('stable-channel.json').equals(local.get('release-manifest.json')) && local.get('stable-channel.json.sig').equals(local.get('release-manifest.json.sig')), 'Stable metadata differs from current candidate manifest.');
    const manifest = accepted.candidate;
    await verifyCurrentCandidateInstaller(path.join(options.candidate, manifest.installerName), manifest);
    const sourceTree = execFileSync(process.platform === 'win32' ? 'git.exe' : 'git', ['rev-parse', `${options.sourceCommit}^{tree}`],
      { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    assert.match(sourceTree, /^[a-f0-9]{40}$/); report.acceptedCandidate = accepted; report.expectedSourceTree = sourceTree;
    stage = 'public-release-identity';
    const latest = json((await request(api + '/releases/latest', { maxBytes: 2 * 1024 ** 2 }, report.httpObservations)).body);
    const tagged = json((await request(api + '/releases/tags/v3.8.0', { maxBytes: 2 * 1024 ** 2 }, report.httpObservations)).body);
    for (const value of [latest, tagged]) assert.ok(value.id === options.releaseId && value.tag_name === 'v3.8.0' && value.draft === false && value.prerelease === false,
      'Latest/tag published release identity differs.');
    assert.ok(Array.isArray(latest.assets) && latest.assets.length <= 128 && new Set(latest.assets.map(value => value.name)).size === latest.assets.length, 'Ambiguous public asset inventory.');
    const assets = new Map(latest.assets.map(value => [value.name, value]));
    const asset = (name, bytes, sha256) => { const value = assets.get(name); assert.ok(value && Number.isSafeInteger(value.id) && value.id > 0 && value.browser_download_url === releaseRoot + name && value.size === bytes && value.digest === `sha256:${sha256}` && value.state === 'uploaded', 'Canonical public asset size/digest/state differs.'); return value; };
    asset(manifest.installerName, manifest.size, manifest.sha256);
    stage = 'public-metadata-signatures';
    const materials = new Map();
    for (const name of names) {
      const item = await request(releaseRoot + name, { maxBytes: limit(name) }, report.httpObservations);
      assert.ok(item.body.equals(local.get(name)), 'Public metadata differs from accepted candidate bytes.');
      asset(name, item.bytes, item.sha256); materials.set(name, item.body);
      await fs.writeFile(path.join(cache, name), item.body, { flag: 'wx', mode: 0o600 });
    }
    report.publicTrust = authenticateCurrentCandidateBytes(inputs(materials, baseline, options.sourceCommit));
    report.publicAssets = [...names, manifest.installerName].map(name => ({ name, id: assets.get(name).id,
      bytes: assets.get(name).size, apiDigest: assets.get(name).digest, canonicalUrl: releaseRoot + name }));
    for (const name of ['stable-channel.json', 'stable-channel.json.sig']) {
      const item = await request(stableRoot + name, { maxBytes: limit(name) }, report.httpObservations);
      assert.ok(item.body.equals(materials.get(name)), 'Public latest stable feed differs from this release.');
      materials.set(name, item.body);
    }
    authenticateCurrentCandidateBytes(inputs(materials, baseline, options.sourceCommit, true));
    stage = 'public-tag-source-tree';
    let object = json((await request(api + '/git/ref/tags/v3.8.0', { maxBytes: 128 * 1024 }, report.httpObservations)).body).object;
    const seen = new Set();
    for (let depth = 0; object?.type === 'tag'; depth++) {
      assert.ok(depth < 4 && /^[a-f0-9]{40}$/.test(object.sha) && !seen.has(object.sha), 'Invalid public annotated tag chain.');
      seen.add(object.sha); object = json((await request(api + '/git/tags/' + object.sha, { maxBytes: 128 * 1024 }, report.httpObservations)).body).object;
    }
    assert.ok(object?.type === 'commit' && object.sha === options.sourceCommit, 'Public tag source commit differs.');
    const commit = json((await request(api + '/git/commits/' + object.sha, { maxBytes: 256 * 1024 }, report.httpObservations)).body);
    assert.ok(commit.sha === options.sourceCommit && commit.tree?.sha === sourceTree, 'Public commit/tree differs.');
    report.publicSource = { commit: commit.sha, tree: commit.tree.sha };
    stage = 'actual-public-installer-download';
    const file = path.join(cache, 'public-' + manifest.installerName);
    const download = await request(releaseRoot + manifest.installerName, { maxBytes: manifest.size, timeoutMs: 180000, outputFile: file }, report.httpObservations);
    assert.ok(download.bytes === manifest.size && download.sha256 === manifest.sha256 && download.sha512 === manifest.sha512, 'Downloaded installer hash/size differs.');
    const installer = await verifyCurrentCandidateInstaller(file, manifest); asset(manifest.installerName, installer.bytes, installer.sha256);
    report.installer = { file, ...installer }; report.publicRelease = { id: latest.id, tag: latest.tag_name, publishedAt: latest.published_at };
    report.ok = true; report.finishedAtUtc = new Date().toISOString();
    await fs.writeFile(options.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log('Current public feed/download verified; installer and GUI were not executed.');
  } catch (error) {
    if (report) { report.failureStage = stage; report.failureKind = ['AssertionError', 'AbortError', 'TypeError'].includes(error.name) ? error.name : 'Error';
      report.finishedAtUtc = new Date().toISOString(); await fs.writeFile(options.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }).catch(() => {}); }
    console.error('Current public verification refused/failed at ' + stage + '.'); process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
