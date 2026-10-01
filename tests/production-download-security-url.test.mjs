import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent, fetch as undiciFetch } from 'undici';
import { loadRecovered } from './load-recovered.mjs';

const safeExports = ['fetchWithRetry', 'fetchTextWithRetry', 'fetchJsonWithRetry', 'ResponseTooLargeError',
  'assertReleaseHttpsUrl', 'waitWithNetworkAbort', 'createNetworkTimeoutError', 'createRequestAbortError', 'cancelNetworkBody'];
function transport(bindings = {}) {
  const safe = loadRecovered('electron/ipc/safe-network', { fetch, Error, ...bindings }, safeExports);
  return { ...safe, ...loadRecovered('electron/ipc/github-release', {
    promisify, execFile, path, promises: fs, randomUUID, createHash, createReadStream, ...safe, ...bindings,
  }, ['downloadFileWithProgress', 'assertGitHubAssetDownloadUrl', 'buildGitHubAssetDownloadUrl']) };
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP || os.tmpdir(), 'transport-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, 'runtime.zip');
  await fs.writeFile(destination, 'LAST GOOD ARCHIVE');
  return { root, destination };
}
async function server(t, handler) {
  const sockets = new Set();
  const listener = http.createServer(handler);
  listener.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => listener.close(resolve)); });
  const url = `http://127.0.0.1:${listener.address().port}/runtime.zip`;
  const validateUrl = candidate => assert.equal(candidate, url);
  return { url, validateUrl, sockets };
}
const budgets = { headerTimeoutMs: 100, bodyIdleTimeoutMs: 100, totalTimeoutMs: 1000, retries: 0 };
async function lastGood(root, destination) {
  assert.equal(await fs.readFile(destination, 'utf8'), 'LAST GOOD ARCHIVE');
  assert.deepEqual(await fs.readdir(root), ['runtime.zip']);
}

test('shared download bounds a real missing-header response and retains the last good file', async t => {
  const { root, destination } = await fixture(t);
  const { url, validateUrl } = await server(t, () => {});
  const started = performance.now();
	await assert.rejects(transport().downloadFileWithProgress(url, destination, null, {}, { ...budgets, validateUrl }), error => error.name === 'AbortError');
  assert.ok(performance.now() - started < 1000);
  await lastGood(root, destination);
});

test('shared download bounds a real stalled body and closes its connection', async t => {
  const { root, destination } = await fixture(t);
  const { url, validateUrl, sockets } = await server(t, (_, response) => { response.writeHead(200); response.write('PARTIAL'); });
  const started = performance.now();
  await assert.rejects(transport().downloadFileWithProgress(url, destination, null, {}, { ...budgets, validateUrl }), /body stalled/);
  assert.ok(performance.now() - started < 1000);
  for (let attempt = 0; attempt < 20 && sockets.size; attempt++) await delay(10);
  assert.equal(sockets.size, 0, 'aborting a body must close this unfinished transport');
  await lastGood(root, destination);
});

test('small real body drips cannot extend the total deadline', async t => {
  const { root, destination } = await fixture(t);
  let interval;
  const { url, validateUrl } = await server(t, (_, response) => {
    response.writeHead(200);
    response.write('X');
    interval = setInterval(() => response.write('X'), 15);
    response.on('close', () => clearInterval(interval));
  });
  t.after(() => clearInterval(interval));
  const started = performance.now();
  await assert.rejects(transport().downloadFileWithProgress(url, destination, null, {}, { ...budgets, totalTimeoutMs: 180, validateUrl }), /total deadline/);
  assert.ok(performance.now() - started < 1000);
  await lastGood(root, destination);
});

test('caller cancellation after headers interrupts the body without publishing its partial file', async t => {
  const { root, destination } = await fixture(t);
  const { url, validateUrl } = await server(t, (_, response) => { response.writeHead(200); response.write('PARTIAL'); });
  const caller = new AbortController();
  const download = transport().downloadFileWithProgress(url, destination, null, {}, { ...budgets, validateUrl, signal: caller.signal });
  await delay(25);
  caller.abort();
  await assert.rejects(download, error => error.name === 'AbortError');
  await lastGood(root, destination);
});

test('streaming byte caps reject a real chunked response before changing the last good file', async t => {
  const { root, destination } = await fixture(t);
  const { url, validateUrl } = await server(t, (_, response) => { response.writeHead(200); response.write(Buffer.alloc(256, 1)); response.end(); });
  await assert.rejects(transport().downloadFileWithProgress(url, destination, null, {}, { ...budgets, validateUrl, maxBytes: 128 }), /exceeded 128 bytes/);
  await lastGood(root, destination);
});

test('open, ENOSPC, and zero-progress write failures close the reader and file before removing the stage', async t => {
  for (const failure of ['open', 'ENOSPC', 'zero-write']) {
    const { root, destination } = await fixture(t);
    const events = [];
    const body = new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('NEW CONTENT')); }, cancel() { events.push('cancel'); } });
    const promises = { ...fs,
      async open(file, ...args) {
        if (failure === 'open') { const error = new Error('Fixture open denied'); error.code = 'EACCES'; throw error; }
        const handle = await fs.open(file, ...args);
        return {
          async write(...args) {
            if (failure === 'ENOSPC') { const error = new Error('Fixture disk full'); error.code = 'ENOSPC'; throw error; }
            return { bytesWritten: 0 };
          },
          async close() { events.push('close'); return handle.close(); },
          sync: () => handle.sync(),
        };
      },
      async rm(file, ...args) { events.push('remove'); return fs.rm(file, ...args); },
    };
    const api = transport({ promises });
    await assert.rejects(api.downloadFileWithProgress('https://github.com/XTLS/Xray-core/releases/download/v1/runtime.zip', destination, null, {}, {
      ...budgets, fetchImpl: async () => new Response(body),
    }), error => failure === 'open' ? error.code === 'EACCES' : failure === 'ENOSPC' ? error.code === 'ENOSPC' : /no progress/.test(error.message));
    assert.equal(body.locked, false);
    assert.equal(events.filter(x => x === 'cancel').length, 1);
    if (failure !== 'open') assert.ok(events.indexOf('close') < events.indexOf('remove'));
    await lastGood(root, destination);
  }
});

test('a real failed publish leaves the previous file intact and removes its closed stage', async t => {
  const { root, destination } = await fixture(t);
  const promises = { ...fs, rename: async () => { throw new Error('Fixture publication sharing violation'); } };
  await assert.rejects(transport({ promises }).downloadFileWithProgress('https://github.com/XTLS/Xray-core/releases/download/v1/runtime.zip', destination, null, {}, {
    ...budgets, fetchImpl: async () => new Response('COMPLETE'),
  }), /sharing violation/);
  await lastGood(root, destination);
});

test('an actual exclusive-open collision preserves the preexisting stage and cancels the response', async t => {
  const { root, destination } = await fixture(t);
  const preexisting = path.join(root, '.runtime.zip.fixed.partial');
  await fs.writeFile(preexisting, 'PREEXISTING FOREIGN STAGE');
  let canceled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('INERT')); }, cancel() { canceled = true; } });
  await assert.rejects(transport({ randomUUID: () => 'fixed' }).downloadFileWithProgress('https://github.com/XTLS/Xray-core/releases/download/v1/runtime.zip', destination, null, {}, {
    ...budgets, fetchImpl: async () => new Response(body),
  }), error => error.code === 'EEXIST');
  assert.equal(canceled, true);
  assert.equal(body.locked, false);
  assert.equal(await fs.readFile(preexisting, 'utf8'), 'PREEXISTING FOREIGN STAGE');
  assert.equal(await fs.readFile(destination, 'utf8'), 'LAST GOOD ARCHIVE');
});

test('reader-cleanup failure cannot suppress the write error or leave the actual file handle open', async t => {
  const { root, destination } = await fixture(t);
  let closed = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('INERT')); } });
  const getReader = body.getReader.bind(body);
  body.getReader = () => {
    const reader = getReader(), release = reader.releaseLock.bind(reader);
    reader.releaseLock = () => { release(); throw new Error('Fixture reader release error'); };
    return reader;
  };
  const promises = { ...fs, async open(file, ...args) {
    const handle = await fs.open(file, ...args);
    return {
      write: async () => { const error = new Error('Fixture disk full'); error.code = 'ENOSPC'; throw error; },
      close: async () => { closed = true; return handle.close(); },
    };
  } };
  await assert.rejects(transport({ promises }).downloadFileWithProgress('https://github.com/XTLS/Xray-core/releases/download/v1/runtime.zip', destination, null, {}, {
    ...budgets, fetchImpl: async () => new Response(body),
  }), error => error.code === 'ENOSPC');
  assert.equal(closed, true);
  await lastGood(root, destination);
});

test('short writes are completed, the file is flushed, and completion is emitted after publication', async t => {
  const { root, destination } = await fixture(t);
  let writes = 0, synced = false;
  const promises = { ...fs, async open(file, ...args) {
    const handle = await fs.open(file, ...args);
    return {
      write: async (bytes, offset, length, position) => { writes++; return handle.write(bytes, offset, Math.min(3, length), position); },
      sync: async () => { synced = true; return handle.sync(); },
      close: () => handle.close(),
    };
  } };
  const progress = [];
  await transport({ promises }).downloadFileWithProgress('https://github.com/XTLS/Xray-core/releases/download/v1/runtime.zip', destination, item => {
    progress.push(item.percent);
    if (item.percent === 100) assert.equal(synced, true);
  }, {}, { ...budgets, expectedBytes: 10, fetchImpl: async () => new Response('0123456789', { headers: { 'content-length': '10' } }) });
  assert.equal(await fs.readFile(destination, 'utf8'), '0123456789');
  assert.equal(writes, 4);
  assert.equal(synced, true);
  assert.deepEqual(progress, [99, 100]);
  assert.deepEqual(await fs.readdir(root), ['runtime.zip']);
});

test('declared and authenticated sizes must match bytes read before publication', async t => {
  for (const [headers, bytes, expectedBytes, message] of [
    [{ 'content-length': 'not-a-size' }, 'DATA', undefined, /Content-Length/],
    [{ 'content-length': '20' }, 'DATA', 4, /metadata/],
    [{ 'content-length': '20' }, 'DATA', undefined, /before/],
    [{ 'content-length': '2' }, 'DATA', undefined, /exceeds/],
    [{ 'content-length': '0' }, 'DATA', undefined, /exceeds/],
    [{}, 'DATA', 8, /before/],
  ]) {
    const { root, destination } = await fixture(t);
    await assert.rejects(transport().downloadFileWithProgress('https://github.com/XTLS/Xray-core/releases/download/v1/runtime.zip', destination, null, {}, {
      ...budgets, expectedBytes, fetchImpl: async () => new Response(bytes, { headers }),
    }), message);
    await lastGood(root, destination);
  }
});

test('forbidden release URL and redirect destinations are rejected before they are requested', async () => {
  const api = transport();
  const initial = 'https://github.com/XTLS/Xray-core/releases/download/v1/runtime.zip';
  for (const url of [initial.replace('https:', 'http:'), initial.replace('github.com', 'user:inert@github.com'),
    initial.replace('github.com', 'github.com:8443'), initial.replace('github.com', 'unexpected.invalid'), initial + '?secret=inert']) {
    let requests = 0;
    await assert.rejects(api.downloadFileWithProgress(url, '/unused/file', null, {}, { fetchImpl: async () => { requests++; throw new Error('Unexpected request'); } }));
    assert.equal(requests, 0);
  }
  for (const location of ['http://github.com/inert', 'https://user:inert@release-assets.githubusercontent.com/a',
    'https://release-assets.githubusercontent.com:8443/a', 'https://unexpected.invalid/a']) {
    const requested = [];
    await assert.rejects(api.fetchWithRetry(initial, { retries: 0, validateUrl: api.assertGitHubAssetDownloadUrl,
      fetchImpl: async (url, options) => { requested.push(url); assert.equal(options.redirect, 'manual'); return new Response(null, { status: 302, headers: { location } }); },
    }));
    assert.deepEqual(requested, [initial]);
  }
});

test('authenticated GitHub CDN URLs retain their signed query and redirect chains are bounded', async () => {
  const api = transport();
  const initial = 'https://github.com/XTLS/Xray-core/releases/download/v1/runtime.zip';
  const signed = 'https://release-assets.githubusercontent.com/github-production-release-asset/123/archive?se=inert&sig=signed-inert';
  const requested = [];
  const result = await api.fetchWithRetry(initial, { retries: 0, validateUrl: api.assertGitHubAssetDownloadUrl,
    fetchImpl: async (url, options) => {
      requested.push(url); assert.equal(options.redirect, 'manual');
      return requested.length === 1 ? new Response(null, { status: 302, headers: { location: signed } }) : new Response('ARCHIVE');
    },
  }, async response => ({ body: await response.text() }));
  assert.equal(result.body, 'ARCHIVE');
  assert.deepEqual(requested, [initial, signed]);
  let requests = 0;
  await assert.rejects(api.fetchWithRetry(initial, { retries: 0, maxRedirects: 2, validateUrl: api.assertGitHubAssetDownloadUrl,
    fetchImpl: async () => { requests++; return new Response(null, { status: 302, headers: { location: signed } }); },
  }), /redirect chain/);
  assert.equal(requests, 3);
});

test('cross-origin release redirects retain signed queries without forwarding account credentials', async () => {
  const api = transport();
  const headers = [];
  await api.fetchWithRetry('https://github.com/XTLS/Xray-core/releases/download/v1/runtime.zip', {
    retries: 0, validateUrl: api.assertGitHubAssetDownloadUrl,
    headers: { Authorization: 'Bearer inert-fixture', Cookie: 'inert=fixture', 'Proxy-Authorization': 'inert', Accept: 'application/octet-stream' },
    fetchImpl: async (_url, options) => {
      headers.push(options.headers);
      return headers.length === 1
        ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/archive?sig=inert-signed' } })
        : new Response('ARCHIVE');
    },
  }, async response => ({ body: await response.text() }));
  assert.equal(headers[0].Authorization, 'Bearer inert-fixture');
	assert.deepEqual(Array.from(headers[1], pair => Array.from(pair)), [['Accept', 'application/octet-stream']]);
});

test('actual desktop updater uses the shared redirect guard before any forbidden destination request', async t => {
  const { root } = await fixture(t);
  const candidate = { version: '3.8.0', tag: 'v3.8.0', size: 100, assetName: 'EgoistShield-Setup-3.8.0.exe',
    assetUrl: 'https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.8.0/EgoistShield-Setup-3.8.0.exe' };
  const safe = transport();
  for (const location of ['https://foreign.invalid/inert.exe', 'https://release-assets.githubusercontent.com:8443/inert.exe',
    'https://inert-user:inert-password@release-assets.githubusercontent.com/inert.exe', 'http://github.com/inert.exe']) {
    const requested = [];
    const { DesktopUpdater } = loadRecovered('electron/ipc/desktop-updater', {
      path, promises: fs, process, Error, assertReleaseHttpsUrl: safe.assertReleaseHttpsUrl,
      fetchWithRetry: (url, options) => safe.fetchWithRetry(url, { ...options, retries: 0,
        fetchImpl: async (nextUrl, request) => { requested.push(nextUrl); assert.equal(request.redirect, 'manual'); return new Response(null, { status: 302, headers: { location } }); },
      }),
    }, ['DesktopUpdater']);
    const updater = new DesktopUpdater({ currentVersion: '3.7.9', userDataDir: root });
    await assert.rejects(updater.downloadCandidate(candidate, path.join(root, 'updates', candidate.assetName + '.partial')), error => error.code === 'redirect-blocked');
    assert.deepEqual(requested, [candidate.assetUrl]);
    assert.equal((await fs.readdir(path.join(root, 'updates'))).length, 0);
  }
});

test('release manifest accepts the exact canonical URL and rejects authority ambiguity', () => {
  const { validateManifest } = loadRecovered('electron/ipc/release-trust', {}, ['validateManifest']);
  const manifest = { schemaVersion: 2, channel: 'stable', version: '3.8.0', tag: 'v3.8.0', installerName: 'EgoistShield-Setup-3.8.0.exe',
    canonicalDownloadUrl: 'https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.8.0/EgoistShield-Setup-3.8.0.exe',
    size: 100, sha256: 'a'.repeat(64), sha512: 'b'.repeat(128), githubDigest: 'sha256:' + 'a'.repeat(64), minimumAppVersion: '3.7.8',
    keyId: 'fixture-release', authenticodeStatus: 'not-signed', licenseVersion: '1.0', publishedAt: '2026-09-29T00:00:00Z' };
  assert.equal(validateManifest({ ...manifest }).canonicalDownloadUrl, manifest.canonicalDownloadUrl);
  for (const url of [manifest.canonicalDownloadUrl.replace('github.com', 'user:inert@github.com'),
    manifest.canonicalDownloadUrl.replace('github.com', 'github.com:8443'), manifest.canonicalDownloadUrl + '?inert=1',
    manifest.canonicalDownloadUrl.replace('/download/', '/./download/'), manifest.canonicalDownloadUrl.replace('https:', 'http:')]) {
    assert.throws(() => validateManifest({ ...manifest, canonicalDownloadUrl: url }), /Canonical/);
  }
});

test('trusted renderer URLs permit exactly the installed document without host or encoded ambiguity', () => {
  const ipc = loadRecovered('electron/ipc/trusted-ipc', { path: path.win32 }, ['configureTrustedIpcPolicy', 'isTrustedUrl']);
  ipc.configureTrustedIpcPolicy({ packagedRendererRoot: String.raw`C:\Program Files\EgoistShield\resources\app.asar\.vite\renderer\main_window` });
  const canonical = 'file:///C:/Program%20Files/EgoistShield/resources/app.asar/.vite/renderer/main_window/index.html';
  assert.equal(ipc.isTrustedUrl(canonical), true);
  for (const url of [canonical.replace('file:///', 'file://audit.invalid/'), canonical.replace('file:///', 'file://localhost/'),
    canonical.replace('index.html', 'adjacent.html'), canonical.replace('main_window/', 'main_window-other/'),
    canonical.replace('/index.html', '%2findex.html'), canonical.replace('/index.html', '%5cindex.html'),
    canonical.replace('index.html', 'index.html%00'), canonical + '?inert=1', canonical + '#inert',
    canonical.replace('/index.html', '/other/../index.html'), 'https://foreign.invalid/index.html']) {
    assert.equal(ipc.isTrustedUrl(url), false, url);
  }
});

test('IPC accepts only the guarded main WebContents and its top frame', () => {
  const logger = { warn() {} };
  const ipc = loadRecovered('electron/ipc/trusted-ipc', { path: path.win32, logger, session: { defaultSession: { setPermissionRequestHandler() {} } } },
    ['configureTrustedIpcPolicy', 'installWindowSecurityGuards', 'assertTrustedIpcEvent']);
  ipc.configureTrustedIpcPolicy({ packagedRendererRoot: String.raw`C:\Installed\renderer` });
  const mainFrame = { url: 'file:///C:/Installed/renderer/index.html' };
  const webContents = { mainFrame, on() {}, setWindowOpenHandler() {}, getURL: () => mainFrame.url };
  const legitimate = { sender: webContents, senderFrame: mainFrame };
  assert.throws(() => ipc.assertTrustedIpcEvent(legitimate), /Untrusted/);
  ipc.installWindowSecurityGuards({ webContents });
  assert.doesNotThrow(() => ipc.assertTrustedIpcEvent(legitimate));
  for (const event of [{ sender: webContents, senderFrame: { url: mainFrame.url } },
    { sender: webContents }, { sender: { ...webContents }, senderFrame: mainFrame }]) assert.throws(() => ipc.assertTrustedIpcEvent(event), /Untrusted/);
});

test('runtime download timeout releases the queue and preserves the installed executable', async t => {
  const { root } = await fixture(t);
  const target = path.join(root, 'runtime/xray');
  await fs.mkdir(target, { recursive: true });
  for (const name of ['xray.exe', 'geoip.dat', 'geosite.dat', 'wintun.dll', 'WINTUN-LICENSE.txt']) await fs.writeFile(path.join(target, name), 'OLD ' + name);
  await fs.writeFile(path.join(target, 'VERSION.txt'), 'v1');
  let requests = 0;
  const { url, validateUrl } = await server(t, (_, response) => {
    requests++;
    if (requests === 1) { response.writeHead(200); response.write('PARTIAL'); }
    else response.end('ARCHIVE');
  });
  const actual = transport();
  const runtime = loadRecovered('electron/ipc/runtime-installer', {
    path, promises: fs, randomUUID,
    prepareRuntimeInstallRoot: async ({ userDataDir }) => ({ runtimeRoot: path.join(userDataDir, 'runtime') }),
    readVersionFile: file => fs.readFile(file, 'utf8').then(value => value.trim()).catch(() => null),
    normalizeVersionTag: value => value, compareLooseVersions: (left, right) => left.localeCompare(right),
    resolveLatestGitHubRelease: async () => ({ tag_name: 'v2', release: { assets: [] } }),
    pickGitHubAsset: () => ({ name: 'xray.zip', browser_download_url: 'https://github.com/XTLS/Xray-core/releases/download/v2/xray.zip' }),
    buildGitHubAssetDownloadUrl: actual.buildGitHubAssetDownloadUrl,
    downloadFileWithProgress: (_remoteUrl, destination) => actual.downloadFileWithProgress(url, destination, null, {}, { ...budgets, validateUrl }),
    verifyGitHubReleaseAssetChecksum: async () => ({ verified: true, integritySource: 'sha256' }),
    extractZipArchive: async (_, destination) => { await fs.mkdir(destination, { recursive: true }); for (const name of ['xray.exe', 'geoip.dat', 'geosite.dat']) await fs.writeFile(path.join(destination, name), 'NEW ' + name); },
  }, ['RuntimeInstaller', 'XRAY_PLAN']);
  const installer = new runtime.RuntimeInstaller(root, root);
  installer.readBundledVersion = async () => null;
  installer.findBundledRuntimeDir = async () => null;
  installer.validateRuntimeExecutable = async () => {};
  const first = await installer.installRuntime(runtime.XRAY_PLAN);
  assert.equal(first.updated, false);
  assert.equal(await fs.readFile(path.join(target, 'xray.exe'), 'utf8'), 'OLD xray.exe');
  const second = await installer.installRuntime(runtime.XRAY_PLAN);
  assert.equal(second.updated, true);
  assert.equal(await fs.readFile(path.join(target, 'xray.exe'), 'utf8'), 'NEW xray.exe');
  assert.equal(requests, 2);
});

test('privileged runtime update refusal precedes local mutations, requests and candidate execution', async () => {
  const events = [];
  const { RuntimeInstaller, XRAY_PLAN } = loadRecovered('electron/ipc/runtime-installer', {
    prepareRuntimeInstallRoot: async () => { throw new Error('Privileged per-user runtime update is blocked.'); },
    path, promises: new Proxy({}, { get: (_target, name) => async () => { events.push(name); } }),
    resolveLatestGitHubRelease: async () => { events.push('request'); },
  }, ['RuntimeInstaller', 'XRAY_PLAN']);
  const installer = new RuntimeInstaller('/protected/install', '/user/profile');
  await assert.rejects(installer.installRuntime(XRAY_PLAN), /Privileged/);
  assert.deepEqual(events, []);
});

async function loopbackStress(t, useTls) {
  const python = process.env.LAGOM_DNS_TEST_PYTHON, openssl = process.env.LAGOM_DNS_TEST_OPENSSL;
  if (useTls && !python && !openssl) { t.skip('Set LAGOM_DNS_TEST_PYTHON or LAGOM_DNS_TEST_OPENSSL for the task-owned TLS lab.'); return; }
  const root = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP || os.tmpdir(), 'transport-stress-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let cert, key;
  if (useTls) {
    const keyPath = path.join(root, 'key.pem'), certPath = path.join(root, 'cert.pem');
    if (python) execFileSync(python, ['-X', 'utf8', '-c', `
from pathlib import Path
from datetime import datetime,timedelta,timezone
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
import ipaddress,sys
k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'127.0.0.1')]);now=datetime.now(timezone.utc)
c=(x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=1)).not_valid_after(now+timedelta(days=2)).add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),False).add_extension(x509.BasicConstraints(ca=True,path_length=None),True).sign(k,hashes.SHA256()))
Path(sys.argv[1]).write_bytes(k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));Path(sys.argv[2]).write_bytes(c.public_bytes(serialization.Encoding.PEM))
`, keyPath, certPath], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
    else execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
    cert = await fs.readFile(certPath); key = await fs.readFile(keyPath);
  }
  const sockets = new Set();
  const respond = (request, response) => {
    const mode = Number(new URL(request.url, 'http://lab.invalid').searchParams.get('mode'));
    if (mode === 0) response.end('COMPLETE ARCHIVE');
    else if (mode === 2) { response.writeHead(200); response.write(Buffer.alloc(256)); response.end(); }
    else { response.writeHead(200); response.write('PARTIAL'); }
  };
  const listener = useTls ? https.createServer({ cert, key }, respond) : http.createServer(respond);
  listener.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const origin = `${useTls ? 'https' : 'http'}://127.0.0.1:${listener.address().port}`;
  const dispatcher = new Agent({ connect: useTls ? { ca: cert } : {}, connections: 8 });
  t.after(async () => { await dispatcher.destroy(); listener.closeAllConnections(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => listener.close(resolve)); });
  const actual = transport(), started = performance.now();
  let success = 0, rejected = 0;
  for (let batch = 0; batch < 8; batch++) await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const operation = batch * 8 + index, mode = operation % 4, destination = path.join(root, `${operation}.zip`);
    await fs.writeFile(destination, 'LAST GOOD');
    const caller = new AbortController();
    let timer;
    if (mode === 3) timer = setTimeout(() => caller.abort(), 35);
    try {
      const download = actual.downloadFileWithProgress(`${origin}/runtime.zip?mode=${mode}`, destination, null, {}, {
        headerTimeoutMs: 600, bodyIdleTimeoutMs: 100, totalTimeoutMs: 1400, maxBytes: 128, retries: 0, signal: caller.signal,
        fetchImpl: (url, options) => undiciFetch(url, { ...options, dispatcher }),
        validateUrl: candidate => { const url = new URL(candidate); assert.equal(url.origin, origin); assert.equal(url.pathname, '/runtime.zip'); },
      });
      if (mode === 0) { await download; success++; assert.equal(await fs.readFile(destination, 'utf8'), 'COMPLETE ARCHIVE'); }
      else {
        await assert.rejects(download, error => mode === 1 ? error.name === 'TimeoutError' : mode === 2 ? /exceeded/.test(error.message) : error.name === 'AbortError');
        rejected++;
        assert.equal(await fs.readFile(destination, 'utf8'), 'LAST GOOD');
      }
    } finally { clearTimeout(timer); }
  }));
  assert.equal(success, 16); assert.equal(rejected, 48);
  assert.equal((await fs.readdir(root)).filter(name => name.endsWith('.partial')).length, 0);
  await dispatcher.destroy();
  listener.closeAllConnections();
  for (const socket of sockets) socket.destroy();
  await delay(30); assert.equal(sockets.size, 0);
  t.diagnostic(JSON.stringify({ transport: useTls ? 'native HTTPS with per-agent trusted own CA' : 'native HTTP', operations: 64, successfulDownloads: success, expectedBoundedFailures: rejected, partialFilesAfter: 0, ownedServerSocketsAfter: sockets.size, durationMs: performance.now() - started }));
}
test('64 actual concurrent HTTP downloads preserve last-good files across repeated stalls, overflow and cancellation', async t => loopbackStress(t, false));
test('64 actual concurrent TLS downloads verify an own CA and preserve last-good files across repeated failures', async t => loopbackStress(t, true));
