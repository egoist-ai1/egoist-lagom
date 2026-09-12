import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { loadRecovered } from './load-recovered.mjs';

function manager() {
  const { ZapretManager } = loadRecovered('electron/ipc/zapret-manager', {
    promisify, execFile, path: path.win32, package_default: { version: '3.7.1' },
    resolveWindowsExecutable: () => path.join(process.env.SystemRoot, 'System32', 'curl.exe'),
  }, ['ZapretManager']);
  return new ZapretManager('resources', 'app', 'user', 'C:\\TestProfiles');
}

test('Windows curl: a reachable large page must not fail profile selection because of its body size', { skip: process.platform !== 'win32' }, async t => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.method);
    res.writeHead(200, { 'Content-Length': 3 * 1024 * 1024 });
    res.end(req.method === 'HEAD' ? undefined : Buffer.alloc(3 * 1024 * 1024));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await manager().probeCurlHeadUrl(`http://127.0.0.1:${server.address().port}/`, 2000, 'HTTP', ['--http1.1']);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(requests, ['HEAD']);
});

test('Windows curl: redirects resolve to final status; denied endpoints remain failures', { skip: process.platform !== 'win32' }, async t => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') res.writeHead(302, { Location: '/ok' });
    else res.writeHead(req.url === '/ok' ? 204 : 403);
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const probe = manager();
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await probe.probeCurlHeadUrl(base + '/redirect', 2000, 'HTTP', [])).ok, true);
  assert.equal((await probe.probeCurlHeadUrl(base + '/denied', 2000, 'HTTP', [])).ok, false);
});

test('Windows curl: a server that rejects HEAD can still confirm a bounded GET', { skip: process.platform !== 'win32' }, async t => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, range: req.headers.range });
    res.writeHead(req.method === 'HEAD' ? 405 : 206, { 'Content-Length': req.method === 'HEAD' ? 0 : 2 });
    res.end(req.method === 'HEAD' ? undefined : 'ok');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await manager().probeCurlHeadUrl(`http://127.0.0.1:${server.address().port}/`, 2000, 'HTTP', []);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(requests, [{ method: 'HEAD', range: undefined }, { method: 'GET', range: 'bytes=0-65535' }]);
});

test('Windows curl: cancellation ends a pending header probe instead of returning success', { skip: process.platform !== 'win32' }, async t => {
  const controller = new AbortController();
  const server = http.createServer(() => controller.abort());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  await assert.rejects(manager().probeCurlHeadUrl(`http://127.0.0.1:${server.address().port}/`, 2000, 'HTTP', [], controller.signal), /cancelled/);
});
