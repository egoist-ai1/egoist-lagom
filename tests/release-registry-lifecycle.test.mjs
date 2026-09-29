import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { sourceFor } from './load-recovered.mjs';

const fixtureRoot = process.env.LAGOM_TRUST_TEST_WORK ?? (process.env.EGOIST_RELEASE_TEST_DIR ? path.join(process.env.EGOIST_RELEASE_TEST_DIR, 'trust') : undefined);
const source = process.env.LAGOM_RELEASE_TRUST_SOURCE
  ? await fs.readFile(process.env.LAGOM_RELEASE_TRUST_SOURCE, 'utf8')
  : sourceFor('electron/ipc/release-trust');
const registryUrl = 'https://github.com/egoist-ai1/egoist-lagom/releases/latest/download/release-key-registry.json';
const signature = (bytes, key) => Buffer.from(sign(null, bytes, key).toString('base64') + '\n');
const toPem = key => key.export({ type: 'spki', format: 'pem' });

async function fixture(t) {
  assert.ok(fixtureRoot && path.isAbsolute(fixtureRoot), 'LAGOM_TRUST_TEST_WORK must be this task\'s absolute fixture directory');
  await fs.mkdir(fixtureRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(fixtureRoot, 'registry-'));
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(fixtureRoot) + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const root = generateKeyPairSync('ed25519');
  const release = generateKeyPairSync('ed25519');
  const generatedAt = new Date(Date.now() - 3 * 864e5).toISOString();
  const nextGeneratedAt = new Date(Date.now() - 2 * 864e5).toISOString();
  const registry = { schemaVersion: 1, generatedAt, keys: [{ id: 'fixture-release', algorithm: 'Ed25519', status: 'trusted', publicKeyPem: toPem(release.publicKey), notBefore: '2020-01-01T00:00:00.000Z', notAfter: '2099-01-01T00:00:00.000Z' }] };
  const bundled = Buffer.from(JSON.stringify(registry));
  const resourcesPath = path.join(directory, 'resources');
  const releasePath = path.join(resourcesPath, 'release');
  const userDataDir = path.join(directory, 'profile');
  const cachePath = path.join(userDataDir, 'updates', 'release-key-registry-cache.json');
  await fs.mkdir(releasePath, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(releasePath, 'release-key-registry.json'), bundled),
    fs.writeFile(path.join(releasePath, 'release-key-registry.json.sig'), signature(bundled, root.privateKey)),
    fs.writeFile(path.join(releasePath, 'root-public-key.pem'), toPem(root.publicKey))
  ]);
  const manifest = { schemaVersion: 2, channel: 'stable', version: '3.8.0', tag: 'v3.8.0', installerName: 'EgoistShield-Setup-3.8.0.exe', canonicalDownloadUrl: 'https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.8.0/EgoistShield-Setup-3.8.0.exe', size: 100, sha256: 'a'.repeat(64), sha512: 'b'.repeat(128), githubDigest: 'sha256:' + 'a'.repeat(64), minimumAppVersion: '3.7.8', keyId: 'fixture-release', authenticodeStatus: 'not-signed', licenseVersion: '1.0', publishedAt: new Date(Date.now() - 864e5).toISOString() };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const requests = [];
  let remote = bundled;
  let remoteSignature = signature(remote, root.privateKey);
  let customFetch;
  const fetch = async (url, options) => {
    requests.push({ url, options });
    if (customFetch) return customFetch(url, options);
    const bytes = url === registryUrl ? remote : url === registryUrl + '.sig' ? remoteSignature : url.endsWith('.sig') ? signature(manifestBytes, release.privateKey) : manifestBytes;
    return new Response(bytes, { status: 200 });
  };
  class SafeHttpError extends Error {
    constructor(status, statusText) { super(`HTTP ${status} ${statusText}`); this.status = status; }
  }
  const getNetworkErrorDetails = error => error instanceof SafeHttpError
    ? { kind: 'http', status: error.status }
    : ['AbortError', 'TimeoutError'].includes(error?.name) ? { kind: 'timeout' }
      : /offline|fetch failed|ECONN/.test(error?.message ?? '') ? { kind: 'network' } : { kind: 'unknown' };
  const bindings = { path, promises: fs, createHash, createPublicKey, verify, randomUUID, SafeHttpError, getNetworkErrorDetails, fetch, process: { resourcesPath, pid: process.pid, cwd: () => directory }, __dirname: directory, Buffer, TextDecoder, URL, AbortController, setTimeout, clearTimeout, console, extractSha256FromGitHubAssetDigest: value => value?.replace(/^sha256:/, ''), buildGitHubAssetDownloadUrl: (_, tag, name) => `https://github.com/egoist-ai1/egoist-lagom/releases/download/${tag}/${name}`, fetchBufferWithRetry: async (url, options) => {
    const response = await fetch(url, options);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > options.maxBytes) throw new Error('Response oversized');
    return { bytes };
  } };
  const load = (overrides = {}, includeUpdater = false) => {
    const context = vm.createContext({ ...bindings, ...overrides });
    vm.runInContext(source + (includeUpdater ? '\n' + sourceFor('electron/ipc/desktop-updater') : '') + '\n;globalThis.api = { loadTrustedKeyRegistry, verifyRemoteReleaseTrust, verifyStableChannelTrust' + (includeUpdater ? ', DesktopUpdater' : '') + ' };', context);
    return context.api;
  };
  const options = { userDataDir, headers: { 'User-Agent': 'Lagom-registry-regression' } };
  const releaseOptions = { ...options, release: { assets: [{ name: manifest.installerName, browser_download_url: manifest.canonicalDownloadUrl, digest: manifest.githubDigest }] }, releaseApiUrl: 'https://api.github.com/repos/egoist-ai1/egoist-lagom/releases/latest', tagName: manifest.tag, expectedVersion: manifest.version, expectedInstallerName: manifest.installerName, expectedInstallerUrl: manifest.canonicalDownloadUrl };
  const stableOptions = { ...options, manifestUrl: 'https://github.com/egoist-ai1/egoist-lagom/releases/latest/download/stable-channel.json', signatureUrl: 'https://github.com/egoist-ai1/egoist-lagom/releases/latest/download/stable-channel.json.sig' };
  return { root, release, registry, bundled, manifest, userDataDir, cachePath, requests, options, releaseOptions, stableOptions, load,
    updateRegistry(change, timestamp = nextGeneratedAt, signer = root.privateKey) {
      const next = structuredClone(registry); next.generatedAt = timestamp; change(next);
      remote = Buffer.from(JSON.stringify(next)); remoteSignature = signature(remote, signer); return next;
    },
    setFetch(value) { customFetch = value; },
    setRemote(bytes, sig) { remote = bytes; remoteSignature = sig; },
    async offline() { customFetch = async () => { throw new Error('offline fetch failed'); }; }
  };
}

test('root-signed remote revocation blocks both release manifest and stable fallback', async t => {
  const f = await fixture(t);
  f.updateRegistry(next => { next.keys[0].status = 'revoked'; });
  const api = f.load();
  const releaseResult = await api.verifyRemoteReleaseTrust(f.releaseOptions);
  assert.equal(releaseResult.trustStatus, 'untrusted');
  assert.equal(releaseResult.failureCode, 'key-revoked');
  const fallbackResult = await api.verifyStableChannelTrust(f.stableOptions);
  assert.equal(fallbackResult.trustStatus, 'untrusted');
  assert.equal(fallbackResult.failureCode, 'key-revoked');
});

test('root-signed rotation reaches client without adopting any remote root', async t => {
  const f = await fixture(t);
  const nextKey = generateKeyPairSync('ed25519');
  f.updateRegistry(next => { next.keys.push({ ...next.keys[0], id: 'fixture-next-key', publicKeyPem: toPem(nextKey.publicKey) }); });
  const result = await f.load().loadTrustedKeyRegistry(f.options);
  assert.equal(result.source, 'remote'); assert.equal(result.freshness, 'checked');
  assert.equal(result.registry.keys.length, 2);
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every(request => request.url === registryUrl || request.url === registryUrl + '.sig'));
  const envelope = JSON.parse(await fs.readFile(f.cachePath));
  assert.ok(verify(null, Buffer.from(envelope.registryBytes, 'base64'), f.root.publicKey, Buffer.from(Buffer.from(envelope.signatureBytes, 'base64').toString().trim(), 'base64')));
});

test('untrusted root signature is blocked without persisting remote bytes', async t => {
  const f = await fixture(t);
  f.updateRegistry(() => {}, undefined, generateKeyPairSync('ed25519').privateKey);
  await assert.rejects(f.load().loadTrustedKeyRegistry(f.options), /корневым ключом/);
  await assert.rejects(fs.access(f.cachePath), { code: 'ENOENT' });
});

test('authenticated cached revocation survives offline restart with explicit freshness warning', async t => {
  const f = await fixture(t);
  f.updateRegistry(next => { next.keys[0].status = 'revoked'; });
  await f.load().loadTrustedKeyRegistry(f.options);
  await f.offline();
  const result = await f.load().loadTrustedKeyRegistry(f.options);
  assert.equal(result.source, 'cache'); assert.equal(result.freshness, 'unavailable');
  assert.equal(result.registry.keys[0].status, 'revoked');
  assert.match(result.warnings.join(' '), /новые отзывы ключей могут быть неизвестны/);
});

test('offline initial profile retains authentic bundled keys and warns about freshness', async t => {
  const f = await fixture(t); await f.offline();
  const result = await f.load().loadTrustedKeyRegistry(f.options);
  assert.equal(result.source, 'bundled'); assert.equal(result.freshness, 'unavailable');
  assert.equal(result.registry.keys[0].status, 'trusted');
  assert.ok(result.warnings.length);
});

test('cached registry is authenticated on every new read and corruption fails closed', async t => {
  const f = await fixture(t); const api = f.load();
  await api.loadTrustedKeyRegistry(f.options);
  const envelope = JSON.parse(await fs.readFile(f.cachePath));
  const tampered = JSON.parse(Buffer.from(envelope.registryBytes, 'base64'));
  tampered.keys[0].status = 'revoked';
  envelope.registryBytes = Buffer.from(JSON.stringify(tampered)).toString('base64');
  await fs.writeFile(f.cachePath, JSON.stringify(envelope));
  const requestsBefore = f.requests.length;
  await assert.rejects(api.loadTrustedKeyRegistry(f.options), /Кэш.*не прошёл проверку/);
  assert.equal(f.requests.length, requestsBefore, 'Corrupt cache must not silently fall back to bundled trust');
});

test('older signed generation and conflicting equal generation are rejected', async t => {
  const f = await fixture(t); const api = f.load();
  f.updateRegistry(() => {});
  await api.loadTrustedKeyRegistry(f.options);
  f.setRemote(f.bundled, signature(f.bundled, f.root.privateKey));
  await assert.rejects(api.loadTrustedKeyRegistry(f.options), error => error.code === 'anti-rollback');
  f.updateRegistry(next => { next.keys[0].status = 'revoked'; });
  await assert.rejects(api.loadTrustedKeyRegistry(f.options), /без новой подписанной даты/);
});

for (const [name, mutate, expected] of [
  ['retains old IDs', next => { next.keys = [{ ...next.keys[0], id: 'different-id' }]; }, /удаляет прежний/],
  ['rejects changed material under same ID', next => { next.keys[0].publicKeyPem = toPem(generateKeyPairSync('ed25519').publicKey); }, /заменяет материал/]
]) test(`registry successor ${name}`, async t => {
  const f = await fixture(t); f.updateRegistry(mutate);
  await assert.rejects(f.load().loadTrustedKeyRegistry(f.options), expected);
});

test('revoked key cannot be restored by a newer signed registry', async t => {
  const f = await fixture(t); const api = f.load();
  f.updateRegistry(next => { next.keys[0].status = 'revoked'; });
  await api.loadTrustedKeyRegistry(f.options);
  f.updateRegistry(() => {}, new Date(Date.now() - 864e5).toISOString());
  await assert.rejects(api.loadTrustedKeyRegistry(f.options), error => error.code === 'key-revoked');
});

test('future registry is blocked with a clock explanation', async t => {
  const f = await fixture(t);
  f.updateRegistry(() => {}, new Date(Date.now() + 901e3).toISOString());
  await assert.rejects(f.load().loadTrustedKeyRegistry(f.options), /Проверьте часы Windows/);
});

test('failed cache persistence blocks adopting a new registry and cleans temporary bytes', async t => {
  const f = await fixture(t);
  f.updateRegistry(() => {});
  const faultyFs = { ...fs, rename: async () => { throw Object.assign(new Error('fixture denied write'), { code: 'EACCES' }); } };
  await assert.rejects(f.load({ promises: faultyFs }).loadTrustedKeyRegistry(f.options), /Не удалось сохранить проверенный registry/);
  await assert.rejects(fs.access(f.cachePath), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(path.dirname(f.cachePath)), []);
});

test('unsafe redirect is blocked before target fetch and intermediate response is cancelled', async t => {
  const f = await fixture(t); let cancellations = 0;
  f.setFetch(async () => ({ status: 302, headers: new Headers({ location: 'https://example.invalid/registry' }), body: { async cancel() { cancellations++; } } }));
  await assert.rejects(f.load().loadTrustedKeyRegistry(f.options), /за пределы разрешённого/);
  assert.equal(f.requests.length, 2); assert.equal(cancellations, 2);
});

test('oversized headers are blocked and every acquired response is cancelled', async t => {
  const f = await fixture(t); let cancellations = 0;
  f.setFetch(async () => ({ ok: true, status: 200, headers: new Headers({ 'content-length': '999999999' }), body: { async cancel() { cancellations++; } } }));
  await assert.rejects(f.load().loadTrustedKeyRegistry(f.options), /размер/);
  assert.equal(cancellations, 2);
});

test('stalled registry body reaches deadline and cancels both owned readers', async t => {
  const f = await fixture(t); let cancellations = 0, releases = 0;
  f.setFetch(async () => ({ ok: true, status: 200, headers: new Headers(), body: { getReader() { return { read: () => new Promise(() => {}), async cancel() { cancellations++; }, releaseLock() { releases++; } }; } } }));
  const started = performance.now();
  const result = await f.load().loadTrustedKeyRegistry(f.options);
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 4900 && elapsed < 6500, `Deadline elapsed ${elapsed}ms`);
  assert.equal(result.freshness, 'unavailable');
  assert.equal(cancellations, 2); assert.equal(releases, 2);
});

test('concurrent registry reads coalesce one fetch pair then independently authenticate next read', async t => {
  const f = await fixture(t); const api = f.load();
  const results = await Promise.all(Array.from({ length: 20 }, () => api.loadTrustedKeyRegistry(f.options)));
  assert.equal(f.requests.length, 2); assert.ok(results.every(value => value.registry.keys.length === 1));
  await api.loadTrustedKeyRegistry(f.options);
  assert.equal(f.requests.length, 4);
});

test('missing explicit profile fails closed before any network or cache operation', async t => {
  const f = await fixture(t);
  await assert.rejects(f.load().loadTrustedKeyRegistry(), /Не задан профиль/);
  assert.equal(f.requests.length, 0);
});

test('publication-time key expiry remains compatible for authentic historical releases', async t => {
  const f = await fixture(t);
  f.updateRegistry(next => { next.keys[0].notAfter = new Date(Date.now() - 432e5).toISOString(); });
  const result = await f.load().verifyRemoteReleaseTrust(f.releaseOptions);
  assert.equal(result.trustStatus, 'trusted');
  assert.ok(Date.parse(result.manifest.publishedAt) < Date.now() - 432e5);
});

test('real fetch streaming body stalls are aborted within the registry budget', async t => {
  const f = await fixture(t);
  const sockets = new Set();
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.write('incomplete registry bytes');
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  f.setFetch((_url, options) => globalThis.fetch(`http://127.0.0.1:${server.address().port}/stall`, options));
  const started = performance.now();
  const result = await f.load().loadTrustedKeyRegistry(f.options);
  assert.equal(result.freshness, 'unavailable');
  assert.ok(performance.now() - started < 6500);
});

test('production updater blocks remote revoked key before stable fallback can mask it', async t => {
  const f = await fixture(t);
  f.updateRegistry(next => { next.keys[0].status = 'revoked'; });
  const api = f.load({
    fetchLatestGitHubRelease: async () => ({ ...f.releaseOptions.release, tag_name: f.manifest.tag, draft: false, prerelease: false }),
    normalizeVersionTag: value => value.slice(1),
    compareLooseVersions: (left, right) => left.localeCompare(right, undefined, { numeric: true })
  }, true);
  const updater = new api.DesktopUpdater({ currentVersion: '3.7.9', userDataDir: f.userDataDir });
  await assert.rejects(updater.resolveTrustedCandidate(), error => error.code === 'key-revoked');
  assert.ok(f.requests.every(request => !request.url.includes('stable-channel.json')), 'REST trust failure must not trigger fallback');
});

test('production updater preserves corrupt-cache failure when REST is unavailable', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.dirname(f.cachePath), { recursive: true });
  await fs.writeFile(f.cachePath, '{"schemaVersion":1,"registryBytes":"forged"}');
  const api = f.load({ fetchLatestGitHubRelease: async () => { throw new Error('offline REST fixture'); } }, true);
  const updater = new api.DesktopUpdater({ currentVersion: '3.7.9', userDataDir: f.userDataDir });
  await assert.rejects(updater.resolveTrustedCandidate(), error => error.code === 'signature-invalid' && /Кэш/.test(error.message));
});

test('production updater exposes unavailable registry freshness in its available message', async t => {
  const f = await fixture(t);
  const bytes = Buffer.from(JSON.stringify(f.manifest));
  f.setFetch(async url => {
    if (url.includes('release-key-registry.json')) throw new Error('offline registry fixture');
    return new Response(url.endsWith('.sig') ? signature(bytes, f.release.privateKey) : bytes);
  });
  const progress = [];
  const api = f.load({
    fetchLatestGitHubRelease: async () => ({ ...f.releaseOptions.release, tag_name: f.manifest.tag, draft: false, prerelease: false }),
    fetchGitHubReleases: async () => [],
    normalizeVersionTag: value => value.slice(1),
    compareLooseVersions: (left, right) => left.localeCompare(right, undefined, { numeric: true })
  }, true);
  const updater = new api.DesktopUpdater({ currentVersion: '3.7.9', userDataDir: f.userDataDir, onProgress: value => progress.push(value) });
  const result = await updater.check();
  assert.equal(result.ok, true); assert.equal(result.phase, 'available');
  assert.match(result.message, /новые отзывы ключей могут быть неизвестны/);
  assert.match(result.warnings.join(' '), /новые отзывы ключей могут быть неизвестны/);
  assert.match(progress.at(-1).message, /новые отзывы ключей могут быть неизвестны/);
});

test('production updater can authenticate stable fallback after manifest transport failure', async t => {
  const f = await fixture(t);
  const bytes = Buffer.from(JSON.stringify(f.manifest));
  f.setFetch(async url => {
    if (url.includes('release-manifest.json')) throw new Error('offline manifest transport fixture');
    if (url.includes('release-key-registry.json')) return new Response(url.endsWith('.sig') ? signature(f.bundled, f.root.privateKey) : f.bundled);
    return new Response(url.endsWith('.sig') ? signature(bytes, f.release.privateKey) : bytes);
  });
  const api = f.load({
    fetchLatestGitHubRelease: async () => ({ ...f.releaseOptions.release, tag_name: f.manifest.tag, draft: false, prerelease: false }),
    normalizeVersionTag: value => value.slice(1),
    compareLooseVersions: (left, right) => left.localeCompare(right, undefined, { numeric: true })
  }, true);
  const updater = new api.DesktopUpdater({ currentVersion: '3.7.9', userDataDir: f.userDataDir });
  const result = await updater.resolveTrustedCandidate();
  assert.equal(result.candidate.version, f.manifest.version);
  assert.ok(f.requests.some(request => request.url.includes('stable-channel.json')));
});

test('manifest timeout is reported truthfully and retryably rather than as an invalid signature', async t => {
  const f = await fixture(t);
  f.setFetch(async url => {
    if (url.includes('release-key-registry.json')) return new Response(url.endsWith('.sig') ? signature(f.bundled, f.root.privateKey) : f.bundled);
    throw Object.assign(new Error('fixture manifest deadline'), { name: 'TimeoutError' });
  });
  const result = await f.load().verifyRemoteReleaseTrust(f.releaseOptions);
  assert.equal(result.trustStatus, 'untrusted'); assert.equal(result.failureCode, 'timeout');
  assert.equal(result.retryable, true);
});
