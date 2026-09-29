import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { spawn, spawnSync } from 'node:child_process';
import { loadRecovered } from './load-recovered.mjs';

const binary = process.env.LAGOM_XRAY_TEST_BINARY;
const work = process.env.LAGOM_DNS_TEST_WORK;
const { isValidIpLiteral } = loadRecovered('shared/system-dns', {}, ['isValidIpLiteral']);
const secure = loadRecovered('shared/secure-dns', { isValidIpLiteral }, ['parseCustomDnsUrl']);
const shared = loadRecovered('shared/system-doh', secure, ['parseSystemDohUrl', 'buildXrayLocalDohServerUrl', 'normalizeSystemDohLocalAddress', 'SYSTEM_DOH_HEALTH_DOMAIN']);
const { buildSystemDohXrayConfig } = loadRecovered('electron/ipc/system-doh-manager', shared, ['buildSystemDohXrayConfig']);
const { queryDnsServer } = loadRecovered('electron/ipc/system-doh-service-manager', {
  createSocket, promisify: value => value, execFile() {},
}, ['queryDnsServer']);

function answer(query) {
  let end = 12;
  while (end < query.length && query[end]) end += 1 + query[end];
  end += 5;
  const header = Buffer.from(query.subarray(0, end));
  header.writeUInt16BE(0x8180, 2); header.writeUInt16BE(1, 6);
  header.writeUInt16BE(0, 8); header.writeUInt16BE(0, 10);
  const type = query.readUInt16BE(end - 4);
  const address = type === 28 ? Buffer.from('20010db8000000000000000000000001', 'hex') : Buffer.from([192, 0, 2, 10]);
  const record = Buffer.from([0xc0, 0x0c, 0, type, 0, 1, 0, 0, 0, 60, 0, address.length]);
  const result = Buffer.concat([header, record, address]);
  const prefix = Buffer.alloc(2); prefix.writeUInt16BE(result.length);
  return Buffer.concat([prefix, result]);
}

test('installed Xray validates production config and survives bounded local TCP upstream faults', {
  skip: !binary || !work ? 'Set LAGOM_XRAY_TEST_BINARY and LAGOM_DNS_TEST_WORK to an installed runtime and this task work directory.' : false,
  timeout: 25000,
}, async t => {
  await fs.mkdir(work, { recursive: true });
  const directory = await fs.mkdtemp(path.join(work, 'xray-dns-'));
  const sockets = new Set();
  let mode = 'healthy', upstreamQueries = 0;
  const upstream = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 2 && pending.length >= 2 + pending.readUInt16BE(0)) {
        const size = pending.readUInt16BE(0), query = pending.subarray(2, size + 2);
        pending = pending.subarray(size + 2); upstreamQueries++;
        if (mode === 'reset') { socket.destroy(); return; }
        socket.write(answer(query));
      }
    });
  });
  await new Promise((resolve, reject) => { upstream.once('error', reject); upstream.listen(0, '127.0.0.1', resolve); });
  t.after(() => { for (const socket of sockets) socket.destroy(); upstream.close(); });
  const portSelector = createServer();
  await new Promise(resolve => portSelector.listen(0, '127.0.0.1', resolve));
  const localPort = portSelector.address().port;
  await new Promise(resolve => portSelector.close(resolve));
  assert.ok(localPort > 1024);
  const generated = buildSystemDohXrayConfig({ url: 'https://resolver.example/dns-query', localAddress: '127.0.0.1', localPort, bootstrapHosts: { 'resolver.example': ['192.0.2.53'] } });
  const productionPath = path.join(directory, 'production.json');
  await fs.writeFile(productionPath, generated);
  const checked = spawnSync(binary, ['run', '-test', '-c', productionPath], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  // Exercise the same DNS inbound/outbound/cache with a localhost TCP stub.
  // The production HTTPS config above is validated separately; no CA trust,
  // adapter, service, port 53 or external network configuration is changed.
  const localConfig = JSON.parse(generated);
  localConfig.dns.servers = [{ address: `tcp://127.0.0.1:${upstream.address().port}`, timeoutMs: 300 }];
  localConfig.dns.hosts = { [shared.SYSTEM_DOH_HEALTH_DOMAIN]: ['127.0.0.1'] };
  const configPath = path.join(directory, 'localhost.json');
  await fs.writeFile(configPath, JSON.stringify(localConfig));
  const child = spawn(binary, ['run', '-c', configPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-8192); });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill(); await exited;
    }
  });
  let ready = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await queryDnsServer('127.0.0.1', localPort, 'ready.example').catch(() => false)) { ready = true; break; }
  }
  assert.equal(ready, true, diagnostics);
  assert.equal(await queryDnsServer('::1', localPort, 'ipv6-listener.example'), true);
  const latency = [];
  for (let batch = 0; batch < 8; batch++) {
    await Promise.all(Array.from({ length: 16 }, async (_, index) => {
      const start = performance.now();
      assert.equal(await queryDnsServer('127.0.0.1', localPort, `load-${batch}-${index}.example`), true);
      latency.push(performance.now() - start);
    }));
  }
  const cached = upstreamQueries;
  assert.equal(await queryDnsServer('127.0.0.1', localPort, 'ready.example'), true);
  assert.equal(upstreamQueries, cached, 'cache avoids another upstream lookup');
  mode = 'reset';
  const beforeHealth = upstreamQueries;
  assert.equal(await queryDnsServer('127.0.0.1', localPort, shared.SYSTEM_DOH_HEALTH_DOMAIN), true);
  assert.equal(upstreamQueries, beforeHealth, 'local liveness remains independent of upstream failure');
  await assert.rejects(queryDnsServer('127.0.0.1', localPort, 'fault.example'));
  mode = 'healthy';
  assert.equal(await queryDnsServer('127.0.0.1', localPort, 'recovery.example'), true, diagnostics);
  assert.equal(child.exitCode, null);
  latency.sort((a, b) => a - b);
  const version = spawnSync(binary, ['version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).stdout.split(/\r?\n/)[0];
  t.diagnostic(JSON.stringify({ version, successfulLoadQueries: 128, concurrency: 16, upstreamQueries,
    p50Ms: Number(latency[Math.floor(latency.length * .50)].toFixed(2)),
    p95Ms: Number(latency[Math.floor(latency.length * .95)].toFixed(2)),
    maxMs: Number(latency.at(-1).toFixed(2)), productionConfigValidated: true, externalNetworkUsed: false }));
});
