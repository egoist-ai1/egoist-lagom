import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ProxyAgent, fetch } from 'undici';
import { loadRecovered } from '../tests/load-recovered.mjs';

const inputPath = assertRecoveryPath(process.argv[2] || 'recovery/vpn-lab/refreshed-state.json', 'vpn-lab');
const reportPath = assertRecoveryPath(process.argv[3] || 'recovery/evidence/refreshed-upstream-diagnostic.json', 'evidence');
const xrayPath = path.resolve('recovery/official-app/resources/runtime/xray/xray.exe');
const probeRoot = path.resolve('.local');
const MAX_CANDIDATES = 3;
const XRAY_PORT_TIMEOUT_MS = 3000;
const XRAY_EGRESS_TIMEOUT_MS = 15000;
const EGRESS_ENDPOINTS = [
  'https://api.ipify.org?format=json',
  'https://cloudflare.com/cdn-cgi/trace',
  'https://1.1.1.1/cdn-cgi/trace',
  'https://ipwho.is/?fields=ip,success'
];

function assertRecoveryPath(value, expectedDirectory) {
  const root = path.resolve('recovery', expectedDirectory);
  const resolved = path.resolve(value);
  if (path.dirname(resolved) !== root) throw new Error(`Output must stay in recovery/${expectedDirectory}`);
  return resolved;
}

function errorCode(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
  if (typeof error?.code === 'number') return error?.name || 'probe_failed';
  return String(error?.cause?.code || error?.code || error?.name || 'probe_failed');
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  const exited = await Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    new Promise(resolve => setTimeout(() => resolve(false), 1000))
  ]);
  if (!exited && child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 1000))
    ]);
  }
}

function uniqueRepresentativeCandidates(state) {
  const nodes = Array.isArray(state.nodes) ? state.nodes : [];
  const activeIndex = nodes.findIndex(node => node?.id === state.activeNodeId);
  const candidates = [];
  const endpoints = new Set();
  const add = (node, index) => {
    if (!node || node.protocol !== 'vless' || candidates.length >= MAX_CANDIDATES) return;
    const endpoint = `${String(node.server ?? '').trim().toLowerCase()}\0${String(node.port ?? '')}`;
    if (!endpoint.trim() || endpoints.has(endpoint)) return;
    endpoints.add(endpoint);
    candidates.push({ node, index });
  };
  add(nodes[activeIndex], activeIndex);
  const activeTransport = String(nodes[activeIndex]?.metadata?.type ?? '').toLowerCase();
  if (activeTransport !== 'xhttp') add(nodes.find(node => String(node?.metadata?.type ?? '').toLowerCase() === 'xhttp'), nodes.findIndex(node => String(node?.metadata?.type ?? '').toLowerCase() === 'xhttp'));
  for (let index = 0; index < nodes.length && candidates.length < 2; index += 1) {
    if (String(nodes[index]?.metadata?.type ?? '').toLowerCase() === 'xhttp') add(nodes[index], index);
  }
  for (let index = 0; index < nodes.length && candidates.length < MAX_CANDIDATES; index += 1) {
    if (String(nodes[index]?.metadata?.type ?? '').toLowerCase() === 'ws') add(nodes[index], index);
  }
  return candidates;
}

function runtimeSignals(output) {
  const normalized = output.toLowerCase();
  const signals = [];
  if (/failed to (query|resolve)|(?:dns|resolve|lookup)[^\r\n]*(?:failed|timeout)|(?:failed|timeout)[^\r\n]*(?:dns|resolve|lookup)|no such host/.test(normalized)) signals.push('dns_failure');
  else if (/dns|resolve|lookup/.test(normalized)) signals.push('dns_activity');
  if (/timeout|timed out|deadline exceeded/.test(normalized)) signals.push('timeout');
  if (/reality|tls|handshake|certificate/.test(normalized)) signals.push('tls_or_reality');
  if (/authentication|invalid user|unauthorized/.test(normalized)) signals.push('authentication');
  return signals;
}

function extractEgressIp(body) {
  if (body && typeof body === 'object' && typeof body.ip === 'string' && net.isIP(body.ip.trim())) return body.ip.trim();
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  const match = text.match(/(?:^|[\r\n"\s])ip(?:=|"\s*:\s*")([0-9a-f:.]+)/i);
  return match && net.isIP(match[1]) ? match[1] : null;
}

async function probeEgress(dispatcher) {
  const errors = [];
  for (const endpoint of EGRESS_ENDPOINTS) try {
    const response = await fetch(endpoint, { dispatcher, signal: AbortSignal.timeout(XRAY_EGRESS_TIMEOUT_MS) });
    if (!response.ok) { errors.push(`${endpoint}:http_${response.status}`); continue; }
    const type = response.headers.get('content-type') || '';
    const body = type.includes('json') ? await response.json() : await response.text();
    const ip = extractEgressIp(body);
    if (ip) return { egress: true, ip, endpoint, errors };
    errors.push(`${endpoint}:invalid_ip`);
  } catch (error) {
    errors.push(`${endpoint}:${errorCode(error)}`);
  }
  return { egress: false, ip: null, endpoint: null, errors };
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise(resolve => {
      const socket = net.createConnection({ host: '127.0.0.1', port, timeout: 500 });
      const finish = value => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(value);
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.once('timeout', () => finish(false));
    });
    if (connected) return true;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return false;
}

async function probeXray(node, ConfigBuilder) {
  let child;
  let dispatcher;
  let output = '';
  const dir = await fs.mkdtemp(path.join(probeRoot, 'upstream-diagnostic-'));
  try {
    const proxyPort = await reserveLoopbackPort();
    const config = JSON.parse(ConfigBuilder.buildXray(node, [], {
      useTunMode: false,
      routeMode: 'global',
      dnsMode: 'secure'
    }, proxyPort, await reserveLoopbackPort(), await reserveLoopbackPort()));
    config.log = { loglevel: 'info' };
    const configPath = path.join(dir, 'candidate.json');
    await fs.writeFile(configPath, JSON.stringify(config));
    child = spawn(xrayPath, ['run', '-c', configPath], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, XRAY_LOCATION_ASSET: path.dirname(xrayPath) }
    });
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', data => {
      output = `${output}${data.toString('utf8')}`.slice(-16000);
    });
    const started = await waitForPort(proxyPort, XRAY_PORT_TIMEOUT_MS);
    if (!started || child.exitCode !== null) return { started, egress: false, failure: child.exitCode === null ? 'local_port_unreachable' : 'runtime_exited', signals: runtimeSignals(output) };
    dispatcher = new ProxyAgent({
      uri: `http://127.0.0.1:${proxyPort}`,
      connectTimeout: XRAY_EGRESS_TIMEOUT_MS,
      requestTls: { rejectUnauthorized: false, timeout: XRAY_EGRESS_TIMEOUT_MS }
    });
    const egress = await probeEgress(dispatcher);
    return { started: true, egress: egress.egress, ip: egress.ip, endpoint: egress.endpoint, failure: egress.egress ? null : 'egress_unconfirmed', errors: egress.errors, signals: runtimeSignals(output) };
  } catch (error) {
    return { started: child?.exitCode === null, egress: false, status: null, failure: errorCode(error), signals: runtimeSignals(output) };
  } finally {
    await dispatcher?.destroy();
    await stopChild(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function run() {
  const state = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const { ConfigBuilder } = loadRecovered('electron/ipc/config-builder', {}, ['ConfigBuilder']);
  const candidates = uniqueRepresentativeCandidates(state);
  const candidatesWithResults = candidates.map(({ node }) => {
    const transport = String(node.metadata?.type ?? 'unknown').toLowerCase();
    const row = {
      metadata: {
        type: transport,
        security: String(node.metadata?.security ?? 'unknown').toLowerCase(),
        mode: 'secure_global'
      },
      xray: { attempted: false, started: false, egress: false, status: null, failure: 'not_attempted', signals: [] }
    };
    return { node, row };
  });
  for (const candidate of candidatesWithResults) {
    candidate.row.xray = { attempted: true, ...await probeXray(candidate.node, ConfigBuilder) };
  }
  const results = candidatesWithResults.map(candidate => candidate.row);
  return {
    schema: 1,
    candidateCount: results.length,
    results
  };
}

await fs.mkdir(path.dirname(reportPath), { recursive: true });
const report = await run().catch(error => ({ schema: 1, candidateCount: 0, error: errorCode(error), results: [] }));
await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
