import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPrefix = path.join(project, 'docs/product-hardening-2026-10-01/auto-update-public-final');
const baselineDirectory = `${reportPrefix}.baselines`;
const commonPins = Object.freeze({
  'trust.js': '3ef271144d65fe0f7e5b0d8b81e120605a59227d6e59e96b3d8c3db4d0eca125',
  'helpers.js': 'cf178b03ef657b26aba3830717ff94125e73dd0ba21f118e1bb3708914692c10',
  'installerGate.js': '1157ea97745a135417b42d236c5ee2c40f4c7500d0f89ff2e1671f0504e6d196',
  'root-public-key.pem': '30c069d617b6e6b1792e7fb6e0f73c17fb659676dd90f6a55d50bc537ac862e7',
  'release-key-registry.json': 'd3cbbd5b636adbb5f47733be32197f0d7dd7ed3294d8785b1aa4b9bb51197dbc',
  'release-key-registry.json.sig': '651104184902338cd00dcc38baff0dadc718946c26e1326e204cdd6eaaa5a6de' });
const clientPins = Object.freeze({
  '3.7.8': { archive: '08db1827d678faedab285711f180e6296a8984f122d0c13ed224155d482c9985', main: '1e15edc490d1d52a789ffc57a23d822d21ef8c11a3346cc922b56c27a88e24e2', desktop: '2e60185e40e55c49db6b8c1bba6f796daff17463818576e030f15fde13c1d342' },
  '3.7.9': { archive: '0696d3f37b56e70fb6dd3cbbb4c14f820aeafe9931ef32a74787ffe6055d7711', main: '8b2c019c6369a5a9e14e343df76271487e7736c0f9643bdc98eb3f8b90962ade', desktop: '5271a02eea5455d5953f3bd62c8c4a4bf9401469849e52bb030c1fd2d34cc215' }
});
const apiRoot = 'https://api.github.com/repos/egoist-ai1/egoist-lagom';
const stableRoot = 'https://github.com/egoist-ai1/egoist-lagom/releases/latest/download/';
const hosts = new Set(['github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function parseArguments(argv) {
  const [mode, ...args] = argv;
  assert.ok(mode === 'prepare' || mode === 'verify-public', 'Mode must be prepare or verify-public');
  let cache, candidate, releaseId = null, nativeRunId = null, confirmed = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--cache') {
      assert.ok(cache === undefined && args[index + 1] && !args[index + 1].startsWith('--'), 'Exactly one cache path is required');
      cache = args[++index];
    } else if (args[index] === '--candidate') {
      assert.ok(candidate === undefined && args[index + 1] && !args[index + 1].startsWith('--'), 'Exactly one candidate directory is required');
      candidate = args[++index];
    } else if (args[index] === '--release-id' || args[index] === '--native-run-id') {
      const name = args[index], raw = args[++index];
      assert.ok(/^[1-9]\d{0,15}$/.test(raw ?? '') && Number.isSafeInteger(Number(raw)), 'ID must be an explicit positive safe integer');
      if (name === '--release-id') { assert.equal(releaseId, null, 'Duplicate release ID'); releaseId = Number(raw); }
      else { assert.equal(nativeRunId, null, 'Duplicate native run ID'); nativeRunId = Number(raw); }
    } else if (args[index] === '--publication-confirmed') {
      assert.equal(confirmed, false, 'Duplicate publication confirmation');
      confirmed = true;
    } else throw new Error('Unknown argument');
  }
  assert.ok(cache && path.isAbsolute(cache), 'Cache must be an explicit absolute task-owned directory');
  assert.ok(candidate && path.isAbsolute(candidate), 'Candidate must be an explicit absolute signed-artifact directory');
  assert.ok(mode === 'prepare' ? !confirmed : confirmed, 'verify-public requires an explicit publication confirmation');
  assert.ok(mode === 'prepare' ? releaseId === null && nativeRunId === null : releaseId !== null, 'Public mode requires the root-confirmed release ID; prepare has no public IDs');
  const cachePath = path.resolve(cache);
  const candidatePath = path.resolve(candidate);
  const candidateRelation = path.relative(path.join(project, 'dist'), candidatePath);
  assert.ok(candidateRelation && !candidateRelation.startsWith('..') && !path.isAbsolute(candidateRelation), 'Candidate must be inside project dist');
  const relation = path.relative(project, cachePath);
  assert.ok(relation.startsWith('..' + path.sep) || path.isAbsolute(relation), 'Cache must be outside the project');
  assert.notEqual(cachePath, path.parse(cachePath).root, 'Root cache is forbidden');
  return { mode, cachePath, candidatePath, releaseId, nativeRunId };
}

async function rejectLinks(target) {
  let current = path.resolve(target);
  while (true) {
    const stat = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    assert.ok(!stat?.isSymbolicLink(), 'Symlink/junction path is forbidden');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function readBounded(file, maxBytes = 256 * 1024) {
  await rejectLinks(file);
  const stat = await fs.stat(file);
  assert.ok(stat.isFile() && stat.size <= maxBytes, 'Input is missing, not a file or oversized');
  const bytes = await fs.readFile(file);
  assert.ok(bytes.length <= maxBytes, 'Input grew beyond its limit');
  return bytes;
}

async function digestFile(file) {
  const digest256 = createHash('sha256'), digest512 = createHash('sha512');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) { bytes += chunk.length; digest256.update(chunk); digest512.update(chunk); }
  return { bytes, sha256: digest256.digest('hex'), sha512: digest512.digest('hex') };
}

function expectedFromManifest(manifest, releaseId = null) {
  assert.ok(/^[a-f0-9]{40}$/.test(manifest.sourceCommit), 'Signed source commit is missing or malformed');
  assert.ok(/^[a-f0-9]{64}$/.test(manifest.integrityManifestSha256), 'Signed package-integrity hash is missing or malformed');
  assert.ok(/^\d+\.\d+\.\d+$/.test(manifest.version) && manifest.tag === `v${manifest.version}`);
  return Object.fromEntries([...['version', 'tag', 'installerName', 'size', 'sha256', 'sha512', 'sourceCommit', 'integrityManifestSha256', 'minimumAppVersion'].map(name => [name, manifest[name]]), ['releaseId', releaseId]]);
}

function assertManifest(manifest, expected) {
  const releaseRoot = `https://github.com/egoist-ai1/egoist-lagom/releases/download/${expected.tag}/`;
  for (const field of ['version', 'tag', 'installerName', 'size', 'sha256', 'sha512', 'sourceCommit', 'integrityManifestSha256']) assert.equal(manifest[field], expected[field], 'Signed candidate binding mismatch');
  assert.equal(manifest.githubDigest, `sha256:${expected.sha256}`);
  assert.equal(manifest.canonicalDownloadUrl, releaseRoot + expected.installerName);
  assert.equal(manifest.minimumAppVersion, expected.minimumAppVersion);
}

async function loadBaselines() {
  const clients = [];
  for (const [version, pins] of Object.entries(clientPins)) {
    const directory = path.join(baselineDirectory, version);
    const baseline = JSON.parse(await readBounded(path.join(directory, 'baseline.json')));
    assert.equal(baseline.version, version);
    assert.equal(baseline.sourceArchive.sha256, pins.archive);
    assert.equal(baseline.main.sha256, pins.main);
    assert.equal(baseline.publicTrustSnapshotIsOriginalBundledBytes, true);
    if (version === '3.7.8') assert.equal(baseline.sourceSetup.sha256, '34136729f0924e95af65b7fefd2792763c29694056b8ff76a79c9fe0e325f927');
    const files = new Map();
    for (const [name, digest] of Object.entries({ ...commonPins, 'desktopPure.js': pins.desktop })) {
      const bytes = await readBounded(path.join(directory, name));
      assert.equal(hash(bytes), digest, 'Original verifier/trust snapshot mismatch');
      files.set(name, bytes);
    }
    clients.push({ version, baseline, files });
  }
  return clients;
}

function oldVerifier(client, getMetadata) {
  const trust = client.files.get('trust.js').toString('utf8');
  const ioStart = trust.indexOf('function getBundledReleaseDirectoryCandidates(');
  const ioEnd = trust.indexOf('function decodeUtf8Json(');
  assert.ok(ioStart > 0 && ioEnd > ioStart);
  // Keep the captured verifier/crypto functions unchanged; only their read-only
  // bundled-file IO uses the exact pinned original snapshot after GUI replacement.
  const trustWithoutPathIO = trust.slice(0, ioStart) + trust.slice(ioEnd);
  let allowedInstaller = null;
  const context = vm.createContext({ path, process, createHash, createPublicKey, verify, Buffer, URL, TextDecoder,
    readBundledReleaseFile: async name => {
      assert.ok(['root-public-key.pem', 'release-key-registry.json', 'release-key-registry.json.sig'].includes(name));
      return Buffer.from(client.files.get(name));
    },
    fetchBufferWithRetry: async url => ({ bytes: Buffer.from(await getMetadata(url)) }),
    promises: { stat: async file => { assert.equal(path.resolve(file), allowedInstaller); return fs.stat(file); } },
    createReadStream: file => { assert.equal(path.resolve(file), allowedInstaller); return createReadStream(file); }
  });
  vm.runInContext(client.files.get('helpers.js').toString('utf8') + '\n' + trustWithoutPathIO + '\n' + client.files.get('desktopPure.js').toString('utf8'), context, { timeout: 5000 });
  vm.runInContext(`async function exactOldInstallerGate(partialPath,candidate) {\n${client.files.get('installerGate.js').toString('utf8')}\nreturn true;\n}`, context, { timeout: 5000 });
  return { context, allowInstaller(file) { allowedInstaller = path.resolve(file); } };
}

function guardedUrl(raw, redirect = false) {
  const url = new URL(raw);
  assert.ok(url.protocol === 'https:' && hosts.has(url.hostname.toLowerCase()) && !url.username && !url.password && (!url.port || url.port === '443') && !url.hash, 'HTTPS host/port/credential guard rejected an address');
  if (!redirect) assert.equal(url.search, '', 'Canonical request must have no query');
  return url;
}

async function publicRequest(url, { maxBytes, timeoutMs = 20000, outputFile = null }, observations) {
  let current = guardedUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const hops = [];
  let response, handle, transferred = 0;
  const chunks = [], digest256 = createHash('sha256'), digest512 = createHash('sha512');
  try {
    for (let hop = 0; hop <= 5; hop++) {
      response = await fetch(current, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'EgoistLagom-PublicFinalReadback', Accept: outputFile ? 'application/octet-stream' : 'application/json', 'Cache-Control': 'no-cache' } });
      hops.push({ host: current.hostname, status: response.status });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      assert.ok(location && hop < 5, 'Redirect chain is invalid or too long');
      current = guardedUrl(new URL(location, current).href, true);
    }
    assert.equal(response.status, 200, 'Public endpoint is unavailable');
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) assert.ok(/^\d+$/.test(contentLength) && Number(contentLength) <= maxBytes, 'Response length exceeds the limit');
    if (outputFile) handle = await fs.open(outputFile, 'wx', 0o600);
    for await (const chunk of response.body) {
      transferred += chunk.length;
      assert.ok(transferred <= maxBytes, 'Response body exceeds the limit');
      digest256.update(chunk); digest512.update(chunk);
      if (handle) {
        let offset = 0;
        while (offset < chunk.length) { const written = await handle.write(chunk, offset, chunk.length - offset); assert.ok(written.bytesWritten > 0); offset += written.bytesWritten; }
      } else chunks.push(chunk);
    }
    if (handle) await handle.sync();
    const result = { url, method: 'GET', observedAtUtc: new Date().toISOString(), status: 200, hops, bytes: transferred, sha256: digest256.digest('hex'), sha512: digest512.digest('hex') };
    observations.push(result);
    return { ...result, body: outputFile ? null : Buffer.concat(chunks) };
  } catch {
    observations.push({ url, method: 'GET', observedAtUtc: new Date().toISOString(), status: response?.status ?? null, hops, bytes: transferred, outcome: 'failed' });
    throw new Error('Public HTTPS read failed; inspect the bounded status/hop record');
  } finally {
    controller.abort(); clearTimeout(timer);
    await handle?.close();
  }
}

async function proveOldContracts(clients, materials, release, installerFile, expected) {
  const releaseRoot = `https://github.com/egoist-ai1/egoist-lagom/releases/download/${expected.tag}/`;
  const proofs = [];
  for (const client of clients) {
    const verifier = oldVerifier(client, async url => { assert.ok(materials.has(url), 'Verifier requested unobserved metadata'); return materials.get(url); });
    const { context } = verifier;
    const registry = await context.loadTrustedKeyRegistry();
    assert.ok(registry.keys.some(key => key.status === 'trusted'));
    const stable = await context.verifyStableChannelTrust({ manifestUrl: stableRoot + 'stable-channel.json', signatureUrl: stableRoot + 'stable-channel.json.sig' });
    assert.equal(stable.trustStatus, 'trusted', 'Original stable verifier rejected metadata');
    const remote = await context.verifyRemoteReleaseTrust({ release, releaseApiUrl: apiRoot + '/releases/latest', tagName: expected.tag, expectedVersion: expected.version, expectedInstallerName: expected.installerName, expectedInstallerUrl: releaseRoot + expected.installerName });
    assert.equal(remote.trustStatus, 'trusted', 'Original release verifier rejected metadata');
    const candidate = context.buildCandidate(remote, 'https://github.com/egoist-ai1/egoist-lagom/releases/latest');
    context.assertCanonicalCandidateUrl(candidate);
    assert.ok(context.compareLooseVersions(expected.version, client.version) > 0);
    assert.ok(context.compareLooseVersions(client.version, remote.manifest.minimumAppVersion) >= 0);
    if (installerFile) {
      verifier.allowInstaller(installerFile);
      assert.equal(await context.exactOldInstallerGate(installerFile, candidate), true);
    }
    proofs.push({ version: client.version, outcome: 'pass', stableSignature: 'pass', releaseSignatureAndApiDigest: 'pass', canonicalUrl: 'pass', minimumVersionCompatibility: 'pass against signed manifest', candidateRetainsMinimumVersion: candidate.minimumAppVersion === remote.manifest.minimumAppVersion, exactOriginalSizeSha256Sha512Gates: installerFile ? 'pass' : 'not-run-before-public-download', sourceBaseline: client.baseline, originalBundledTrustSnapshot: true, liveGuiUpdaterOrHelperExecuted: false });
  }
  return proofs;
}

async function writeReports(report) {
  const expected = report.expected ?? {};
  await rejectLinks(reportPrefix + '.json'); await rejectLinks(reportPrefix + '.md');
  const json = JSON.stringify(report, null, 2) + '\n';
  const markdown = `# Публичная проверка окончательного автообновления 3.8.0\n\nРезультат: **${report.publicFeedProof}**. Наблюдение: ${report.observedAtUtc}. Подписанный source commit: \`${expected.sourceCommit}\`; tree: \`${expected.sourceTree}\`.\n\n${report.mode === 'prepare' ? 'Это подготовка. Публичные URL ещё не проверялись этим инструментом; запуск verify-public требует отдельного подтверждения публикации от root.' : 'Проверка использует реальные неавторизованные GitHub API и HTTPS assets. Локальный подписанный кандидат служит только точным эталоном байтов; сетевые ответы не заменяются локальными fixtures.'}\n\nSetup: **${expected.size} байт**; SHA-256 \`${expected.sha256}\`; SHA-512 \`${expected.sha512}\`. Integrity SHA-256 \`${expected.integrityManifestSha256}\`.\n\nСохранённые baseline: оригинальная установленная 3.7.9 (live archive при capture) и оригинальная 3.7.8, извлечённая без запуска из подписанного локального Setup. Публичность релиза 3.7.8 не утверждается. Их verifier, candidate builder и точный size/SHA-256/SHA-512 gate проверяются по собственным SHA. Публичные trust bytes сохранены неизменными; адаптер заменяет только чтение файлов snapshot. process, время, окружение, host и GITHUB_SHA не подменяются. Это отдельный запуск исходных функций, не запуск старого GUI updater.\n\nPublic feed proof и native helper execution — разные результаты. Этот инструмент **не запускает Setup, GUI updater или installer helper**, не меняет SCM/DNS/registry/tasks/live config. Native execution данным инструментом: **not-executed**. ${report.nativeWorkflow ? 'Актуальный read-only API snapshot native workflow включён в JSON; один API status не заменяет source/Setup-bound native receipts.' : 'Native acceptance выполняет root отдельно; этот инструмент не подразумевает её исход и не выбирает run автоматически.'}\n\nОбязательные публичные проверки: latest/tag ID и stable tag, metadata/signatures, фактические API asset size/digest/URL, публичные tag commit/tree, package-integrity SHA, скачанные Setup size/SHA-256/SHA-512, принятие обоими оригинальными verifier. Подробные URL, timestamps, безопасные redirect host/status и результаты находятся в [JSON](auto-update-public-final.json). Query подписанных CDN redirects, токены и приватные ключи не сохраняются.\n\nПодготовка: \`node scripts/auto-update-public-final.mjs prepare --candidate <absolute-final-signed-candidate> --cache <absolute-own-task-cache>\`. После подтверждения публикации: \`node scripts/auto-update-public-final.mjs verify-public --publication-confirmed --candidate <absolute-final-signed-candidate> --release-id <root-confirmed-published-id> --cache <new-absolute-own-task-cache>\`. Cache содержит только downloaded verification evidence; executable никогда не запускается.\n\n3.7.7 ниже minimumAppVersion3.7.8: ручной переход. Работа GUI-closed служб, полный старый updater install/restart и месяцы непрерывной работы этим file/feed proof не доказываются.\n`;
  await fs.writeFile(reportPrefix + '.json', json);
  await fs.writeFile(reportPrefix + '.md', markdown);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await rejectLinks(options.cachePath);
  await fs.mkdir(options.cachePath, { recursive: true });
  const report = { schemaVersion: 1, mode: options.mode, observedAtUtc: new Date().toISOString(), expected: null, candidateDirectory: options.candidatePath, publicFeedProof: 'not-run-awaiting-publication', nativeHelperExecution: 'not-executed', physicalHostWrites: false, externalWrites: false, privateKeysOrTokensRead: false, sourceBindingContract: 'authenticated signed metadata and its actual Git commit tree compared with the public tag/commit', httpObservations: [], baselineVerification: [], nativeWorkflow: null, toolSha256: hash(await fs.readFile(fileURLToPath(import.meta.url))) };
  try {
    const guardReceiptBytes = await readBounded(reportPrefix + '.guard-checks.json').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (guardReceiptBytes) {
      const guardReceipt = JSON.parse(guardReceiptBytes);
      report.guardChecks = { receiptSha256: hash(guardReceiptBytes), sourceMatches: guardReceipt.toolSha256 === report.toolSha256, passed: guardReceipt.passed, failed: guardReceipt.failed, skipped: guardReceipt.skipped, observedAtUtc: guardReceipt.observedAtUtc };
    }
    const clients = await loadBaselines();
    const local = new Map();
    for (const name of ['stable-channel.json', 'stable-channel.json.sig', 'release-manifest.json', 'release-manifest.json.sig', 'release-key-registry.json', 'release-key-registry.json.sig', 'root-public-key.pem', 'package-integrity.json']) local.set(name, await readBounded(path.join(options.candidatePath, name)));
    const manifest = JSON.parse(local.get('release-manifest.json'));
    const expected = expectedFromManifest(manifest, options.releaseId);
    report.expected = expected;
    const releaseRoot = `https://github.com/egoist-ai1/egoist-lagom/releases/download/${expected.tag}/`;
    assertManifest(manifest, expected);
    assert.equal(hash(local.get('package-integrity.json')), expected.integrityManifestSha256);
    assert.equal(hash(local.get('stable-channel.json')), hash(local.get('release-manifest.json')));
    assert.equal(hash(local.get('root-public-key.pem')), commonPins['root-public-key.pem']);
    assert.ok(verify(null, local.get('release-key-registry.json'), createPublicKey(local.get('root-public-key.pem')), Buffer.from(local.get('release-key-registry.json.sig').toString().trim(), 'base64')), 'Candidate registry signature is invalid');
    const localMaterials = new Map(['stable-channel.json', 'stable-channel.json.sig', 'release-manifest.json', 'release-manifest.json.sig'].map(name => [name.startsWith('stable-') ? stableRoot + name : releaseRoot + name, local.get(name)]));
    const offlineRelease = { tag_name: expected.tag, assets: [{ name: expected.installerName, size: expected.size, digest: `sha256:${expected.sha256}`, browser_download_url: manifest.canonicalDownloadUrl }, ...['release-manifest.json', 'release-manifest.json.sig'].map(name => ({ name, browser_download_url: releaseRoot + name }))] };
    report.localMetadataAuthentication = await proveOldContracts(clients, localMaterials, offlineRelease, null, expected);
    const sourceTree = execFileSync(process.platform === 'win32' ? 'git.exe' : 'git', ['rev-parse', `${expected.sourceCommit}^{tree}`], { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    assert.ok(/^[a-f0-9]{40}$/.test(sourceTree), 'Signed source commit does not resolve to an actual tree');
    expected.sourceTree = sourceTree;
    Object.freeze(expected);
    if (options.mode === 'prepare') {
      const installerFile = path.join(options.candidatePath, expected.installerName);
      const installer = await digestFile(installerFile);
      for (const field of ['bytes', 'sha256', 'sha512']) assert.equal(installer[field], field === 'bytes' ? expected.size : expected[field]);
      report.baselineVerification = await proveOldContracts(clients, localMaterials, offlineRelease, installerFile, expected);
      report.offlineApiEnvelope = true;
      report.localCandidateDigest = installer;
      report.localPreparation = 'pass';
    } else {
      const latest = await publicRequest(apiRoot + '/releases/latest', { maxBytes: 2 * 1024 * 1024 }, report.httpObservations);
      const tagged = await publicRequest(apiRoot + '/releases/tags/' + expected.tag, { maxBytes: 2 * 1024 * 1024 }, report.httpObservations);
      const release = JSON.parse(latest.body), releaseTag = JSON.parse(tagged.body);
      for (const item of [release, releaseTag]) { assert.equal(item.id, expected.releaseId); assert.equal(item.tag_name, expected.tag); assert.equal(item.draft, false); assert.equal(item.prerelease, false); }
      const assets = new Map(release.assets.map(asset => [asset.name, asset]));
      assert.equal(assets.get(expected.installerName)?.size, expected.size);
      assert.equal(assets.get(expected.installerName)?.digest, `sha256:${expected.sha256}`);
      assert.equal(assets.get(expected.installerName)?.browser_download_url, releaseRoot + expected.installerName);
      const materials = new Map();
      const assetResults = await Promise.allSettled(['stable-channel.json', 'stable-channel.json.sig', 'release-manifest.json', 'release-manifest.json.sig', 'release-key-registry.json', 'release-key-registry.json.sig', 'root-public-key.pem', 'package-integrity.json'].map(async name => {
        const url = name.startsWith('stable-') ? stableRoot + name : releaseRoot + name;
        assert.equal(assets.get(name)?.browser_download_url, releaseRoot + name, 'Published asset URL is not canonical');
        const item = await publicRequest(url, { maxBytes: name.endsWith('.sig') || name.endsWith('.pem') ? 4096 : 256 * 1024 }, report.httpObservations);
        assert.equal(hash(item.body), hash(local.get(name)), 'Published asset bytes differ from the accepted signed candidate');
        assert.equal(assets.get(name)?.size, item.bytes);
        assert.equal(assets.get(name)?.digest, `sha256:${item.sha256}`);
        materials.set(url, item.body);
        await fs.writeFile(path.join(options.cachePath, name), item.body, { flag: 'wx', mode: 0o600 });
        return { name, bytes: item.bytes, sha256: item.sha256 };
      }));
      assert.ok(assetResults.every(item => item.status === 'fulfilled'), 'A public metadata asset failed its contract');
      const records = assetResults.map(item => item.value);
      assertManifest(JSON.parse(materials.get(releaseRoot + 'release-manifest.json')), expected);
      const refResponse = await publicRequest(apiRoot + '/git/ref/tags/' + expected.tag, { maxBytes: 128 * 1024 }, report.httpObservations);
      let object = JSON.parse(refResponse.body).object;
      const seen = new Set();
      for (let count = 0; object?.type === 'tag'; count++) {
        assert.ok(count < 4 && /^[a-f0-9]{40}$/.test(object.sha) && !seen.has(object.sha), 'Invalid annotated tag chain');
        seen.add(object.sha);
        object = JSON.parse((await publicRequest(apiRoot + '/git/tags/' + object.sha, { maxBytes: 128 * 1024 }, report.httpObservations)).body).object;
      }
      assert.equal(object?.type, 'commit'); assert.equal(object.sha, expected.sourceCommit);
      const commit = JSON.parse((await publicRequest(apiRoot + '/git/commits/' + object.sha, { maxBytes: 256 * 1024 }, report.httpObservations)).body);
      assert.equal(commit.sha, expected.sourceCommit); assert.equal(commit.tree.sha, expected.sourceTree);
      const installerFile = path.join(options.cachePath, 'public-' + expected.installerName);
      const installer = await publicRequest(releaseRoot + expected.installerName, { maxBytes: expected.size, timeoutMs: 180000, outputFile: installerFile }, report.httpObservations);
      assert.equal(installer.bytes, expected.size); assert.equal(installer.sha256, expected.sha256); assert.equal(installer.sha512, expected.sha512);
      report.baselineVerification = await proveOldContracts(clients, materials, release, installerFile, expected);
      report.publishedRelease = { id: release.id, tag: release.tag_name, publishedAt: release.published_at, installerAssetId: assets.get(expected.installerName).id };
      report.publicAssets = records;
      report.publicCommitTree = { commit: commit.sha, tree: commit.tree.sha };
      report.installer = { path: installerFile, bytes: installer.bytes, sha256: installer.sha256, sha512: installer.sha512 };
      report.offlineApiEnvelope = false;
      report.publicFeedProof = 'pass';
      try {
        if (options.nativeRunId === null) throw new Error('No native run requested');
        const run = JSON.parse((await publicRequest(apiRoot + '/actions/runs/' + options.nativeRunId, { maxBytes: 256 * 1024 }, report.httpObservations)).body);
        report.nativeWorkflow = { id: run.id, headSha: run.head_sha, state: run.status, conclusion: run.conclusion, htmlUrl: run.html_url, limitation: 'Read-only API status only; no helper execution or native logs read by this tool' };
      } catch { report.nativeWorkflow = { observation: 'unavailable', helperExecution: 'not-executed' }; }
    }
    report.observedAtUtc = new Date().toISOString();
    await writeReports(report);
    console.log(JSON.stringify({ publicFeedProof: report.publicFeedProof, localPreparation: report.localPreparation ?? null, oldVerifierVersions: report.baselineVerification.map(item => item.version), reports: [reportPrefix + '.md', reportPrefix + '.json'], nativeHelperExecution: 'not-executed' }, null, 2));
  } catch {
    report.publicFeedProof = options.mode === 'verify-public' ? 'failed' : 'not-run';
    report.failure = 'Strict binding, input or HTTPS contract failed; no install was attempted';
    await writeReports(report);
    console.error(JSON.stringify({ publicFeedProof: report.publicFeedProof, failure: report.failure, reports: [reportPrefix + '.md', reportPrefix + '.json'] }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
export { expectedFromManifest, parseArguments, guardedUrl, assertManifest, loadBaselines, oldVerifier };
