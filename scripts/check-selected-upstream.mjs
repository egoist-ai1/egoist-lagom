import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { ProxyAgent, fetch } from 'undici';
import { loadRecovered } from '../tests/load-recovered.mjs';

const reportPath = process.argv[3] || 'recovery/evidence/selected-upstream-xray.json';
const probeRoot = path.resolve('.local');
const xray = path.resolve('recovery/official-app/resources/runtime/xray/xray.exe');

function errorCode(error) {
  return String(error?.cause?.code || error?.code || error?.name || 'probe_failed');
}

function assertProbeDir(dir) {
  const root = path.resolve(probeRoot);
  const resolved = path.resolve(dir);
  if (path.dirname(resolved) !== root || !path.basename(resolved).startsWith('upstream-probe-')) {
    throw new Error('Invalid probe temporary directory');
  }
  return resolved;
}

async function reserveLoopbackPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  const exited = await Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    new Promise(resolve => setTimeout(() => resolve(false), 5000))
  ]);
  if (!exited && child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);
  }
}

async function probeCandidate(node, index, state, ConfigBuilder, dir) {
  const started = Date.now();
  let child;
  let dispatcher;
  const errors = [];
  let runtimeLog = '';
  try {
    const port = await reserveLoopbackPort();
    const config = path.join(dir, `candidate-${index}.json`);
    const configData = JSON.parse(ConfigBuilder.buildXray(node, [], {
      ...state.settings,
      useTunMode: false,
      routeMode: 'global',
      dnsMode: 'secure'
    }, port, await reserveLoopbackPort(), await reserveLoopbackPort()));
    configData.log = { loglevel: 'info' };
    await fs.writeFile(config, JSON.stringify(configData));
    let launchError = null;
    child = spawn(xray, ['run', '-c', config], { windowsHide: true, stdio: ['ignore','pipe','pipe'], env:{...process.env,XRAY_LOCATION_ASSET:path.dirname(xray)} });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { runtimeLog = (runtimeLog + data.toString()).slice(-60000); });
    child.once('error', error => { launchError = errorCode(error); });
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (launchError || child.exitCode !== null) {
      errors.push(launchError || 'runtime_exited');
      return { protocol: node.protocol, index, ok: false, errors, ms: Date.now() - started };
    }
    dispatcher = new ProxyAgent(`http://127.0.0.1:${port}`);
    const outcomes = await Promise.all([
      'https://api.ipify.org?format=json',
      'https://ipwho.is/?fields=ip,success'
    ].map(async url => {
      try {
        const response = await fetch(url, { dispatcher, signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        return response.ok && Boolean(net.isIP(data.ip));
      } catch (error) {
        errors.push(errorCode(error));
        return false;
      }
    }));
    const ok = outcomes.some(Boolean);
    if (!ok && errors.length === 0) errors.push('invalid_egress_response');
    return { protocol: node.protocol, index, ok, errors, ms: Date.now() - started };
  } catch (error) {
    errors.push(errorCode(error));
    return { protocol: node.protocol, index, ok: false, errors, ms: Date.now() - started };
  } finally {
    await dispatcher?.destroy();
    await stopChild(child);
    const privateValues = [node.server, node.name, node.id, ...Object.values(node.metadata || {})].filter(value => typeof value === 'string' && value.length > 4);
    for (const value of privateValues) runtimeLog = runtimeLog.replaceAll(value, '[redacted]');
    runtimeLog = runtimeLog.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]');
    await fs.writeFile(`recovery/evidence/upstream-${index}-runtime.log`, runtimeLog);
  }
}

async function run() {
  const state = JSON.parse(await fs.readFile(process.argv[2] || path.join(process.env.APPDATA, 'Egoist Shield/egoistshield-state.json'), 'utf8'));
  const selectedIndex = state.nodes.findIndex(node => node.id === state.activeNodeId);
  const selected = state.nodes[selectedIndex];
  if (!selected || selected.protocol !== 'vless') throw new Error('Selected VLESS upstream is unavailable');
  const candidates = [];
  const endpoints = new Set();
  const add = (node, index) => {
    if (!node || node.protocol !== 'vless' || candidates.length === 3) return;
    const endpoint = `${String(node.server ?? '').trim().toLowerCase()}\u0000${String(node.port ?? '')}`;
    if (endpoints.has(endpoint)) return;
    endpoints.add(endpoint);
    candidates.push({ node, index });
  };
  add(selected, selectedIndex);
  state.nodes.forEach((node, index) => add(node, index));

  await fs.mkdir(probeRoot, { recursive: true });
  await fs.mkdir(path.resolve('recovery/evidence'), { recursive: true });
  const dir = assertProbeDir(await fs.mkdtemp(path.join(probeRoot, 'upstream-probe-')));
  try {
    const { ConfigBuilder } = loadRecovered('electron/ipc/config-builder', {}, ['ConfigBuilder']);
    const results = [];
    for (const candidate of candidates) {
      const result = await probeCandidate(candidate.node, candidate.index, state, ConfigBuilder, dir);
      results.push(result);
      if (result.ok) break;
    }
    return results;
  } finally {
    await fs.rm(assertProbeDir(dir), { recursive: true, force: true });
  }
}

const report = await run().catch(error => [{ protocol: 'vless', index: -1, ok: false, errors: [errorCode(error)], ms: 0 }]);
await fs.mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
