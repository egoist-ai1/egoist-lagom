// Explicit native acceptance: copies the authenticated runtime into task-owned
// work and launches only its own short-lived children. No installed app is used.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createPackage, getRawHeader } from '@electron/asar';
import { rcedit } from 'rcedit';
import { verifyPinnedElectronRuntime } from '../scripts/electron-runtime.mjs';
import { hardenElectronFuses, readElectronFuses } from '../scripts/electron-fuses.mjs';

const root = path.resolve(import.meta.dirname, '..');
const workArgument = process.argv.indexOf('--work');
const work = workArgument >= 0 && process.argv[workArgument + 1];
const probeArgument = process.argv.indexOf('--argument-probe');
const argumentProbe = probeArgument >= 0 && process.argv[probeArgument + 1];
if (process.platform !== 'win32' || !work || !path.isAbsolute(work)) throw new Error('Use --work <absolute task work directory> on Windows.');
const python = process.env.SHIELD_PYTHON || 'python';
const directory = await fs.mkdtemp(path.join(work, 'ni-'));
const payload = path.join(directory, 'payload');
const application = path.join(directory, 'app');
const results = { schemaVersion: 1, startedAt: new Date().toISOString(), sourceRoot: root, scope: 'Authenticated copied Electron PE; own harmless scripts/processes/files only; no SCM/DNS/Tasks/registry or installed GUI.', cases: [] };
const children = new Set();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const exists = file => fs.stat(file).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error));
const sha = file => fs.readFile(file).then(bytes => createHash('sha256').update(bytes).digest('hex'));

async function run(executable, args, environment, during) {
  const inherited = { ...process.env };
  for (const key of Object.keys(inherited)) if (/^(NODE_|ELECTRON_RUN_AS_NODE$)/i.test(key)) delete inherited[key];
  const child = spawn(executable, args, { windowsHide: true, cwd: payload, env: { ...inherited, TEMP: directory, TMP: directory, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', bytes => { stdout = (stdout + bytes.toString()).slice(-32768); });
  child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-32768); });
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 10000);
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, timedOut, stdout, stderr }));
  });
  try {
    if (during) await during(child);
    return await result;
  } finally { clearTimeout(timer); children.delete(child); }
}

async function check(name, action) {
  const started = performance.now();
  try {
    const observations = await action();
    const value = { name, passed: true, elapsedMs: Math.round(performance.now() - started), ...observations };
    results.cases.push(value); console.log(JSON.stringify(value));
  } catch (error) {
    const value = { name, passed: false, elapsedMs: Math.round(performance.now() - started), error: error.message };
    results.cases.push(value); console.log(JSON.stringify(value)); throw error;
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function connectable(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false));
    socket.setTimeout(80, () => finish(false));
  });
}

function nativeArgumentPolicy(child) {
  if (!argumentProbe || !path.isAbsolute(argumentProbe)) throw new Error('Use --argument-probe <own compiled runtime-identity-production.exe> for real GUI argument acceptance.');
  const dotnetRoot = process.env.SHIELD_DOTNET ? path.dirname(process.env.SHIELD_DOTNET) : path.join(root, '.tools/dotnet-10.0.401');
  const result = spawnSync(argumentProbe, ['--probe-argv', String(child.pid)], { windowsHide: true, encoding: 'utf8', timeout: 3000, env: { ...process.env, DOTNET_ROOT: dotnetRoot } });
  if (result.error || !result.stdout) throw new Error('Native argument policy probe failed: ' + (result.error?.message || result.stderr));
  return { ...JSON.parse(result.stdout.trim()), exitCode: result.status };
}

async function cdpEvaluate(url, expression) {
  const socket = new WebSocket(url);
  try {
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(new Error('Own CDP socket failed')), { once: true }); });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Own CDP expression exceeded its budget.')), 2000);
      socket.addEventListener('message', event => { const value = JSON.parse(String(event.data)); if (value.id === 1) { clearTimeout(timer); value.error ? reject(new Error(value.error.message)) : resolve(value.result); } });
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
  } finally { socket.close(); }
}

try {
  const runtime = await verifyPinnedElectronRuntime(root, { python });
  results.runtime = { version: runtime.version, archive: runtime.archive, files: runtime.files.length };
  await fs.cp(runtime.runtimePath, payload, { recursive: true });
  const upstream = path.join(payload, 'electron.exe');
  const gui = path.join(payload, 'EgoistShield.exe'), worker = path.join(payload, 'EgoistShield.Worker.exe');
  await fs.rename(upstream, gui); await fs.copyFile(gui, worker);
  results.upstreamFuses = readElectronFuses(await fs.readFile(gui)).wire;
  await fs.mkdir(application);
  await fs.writeFile(path.join(application, 'package.json'), JSON.stringify({ name: 'lagom-native-identity-acceptance', version: '1.0.0', main: 'main.cjs' }));
  await fs.writeFile(path.join(application, 'main.cjs'), `const {app,BrowserWindow}=require('electron');const fs=require('node:fs');app.setPath('userData',process.env.IDENTITY_USER_DATA);app.whenReady().then(()=>{fs.writeFileSync(process.env.IDENTITY_AUTHENTIC_MARKER,'authenticated-asar');if(process.env.IDENTITY_CDP_FIXTURE){const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.loadURL('data:text/html,<!doctype html><title>Own identity fixture</title>');}setTimeout(()=>app.exit(0),process.env.IDENTITY_CDP_FIXTURE?3000:700);});`);
  const archive = path.join(payload, 'resources', 'app.asar');
  await createPackage(application, archive);
  const header = createHash('sha256').update(getRawHeader(archive).headerString).digest('hex');
  results.asarHeaderSha256 = header;
  const attacker = path.join(directory, 'attacker.cjs');
  await fs.writeFile(attacker, `require('node:fs').writeFileSync(process.env.IDENTITY_ATTACK_MARKER,'outside-code-executed');process.exit(0);`);
  const attackDirectory = path.join(directory, 'untrusted-app');
  await fs.mkdir(attackDirectory);
  await fs.writeFile(path.join(attackDirectory, 'package.json'), JSON.stringify({ name: 'untrusted-outside-application', main: 'main.cjs' }));
  await fs.copyFile(attacker, path.join(attackDirectory, 'main.cjs'));
  let sequence = 0;
  function environment(extra = {}) {
    const id = String(++sequence);
    return { IDENTITY_USER_DATA: path.join(directory, 'ud' + id), IDENTITY_AUTHENTIC_MARKER: path.join(directory, 'auth' + id), IDENTITY_ATTACK_MARKER: path.join(directory, 'attack' + id), ...extra };
  }
  await check('baseline GUI identity accepts arbitrary Node script through ELECTRON_RUN_AS_NODE', async () => {
    const env = environment({ ELECTRON_RUN_AS_NODE: '1' });
    const child = await run(gui, [attacker], env);
    assert.equal(child.code, 0); assert.equal(await exists(env.IDENTITY_ATTACK_MARKER), true);
    return { attackExecuted: true, code: child.code, fuseWire: results.upstreamFuses };
  });
  for (const file of [gui, worker]) {
    await rcedit(file, { 'requested-execution-level': 'asInvoker' });
    const embedded = spawnSync(python, [path.join(root, 'scripts/embed-asar-integrity.py'), '--executable', file, '--header-sha256', header], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
    if (embedded.error || embedded.status !== 0) throw new Error('Actual PE ASAR resource embedding failed: ' + (embedded.error?.message || embedded.stderr));
    results[path.basename(file) + 'Resource'] = JSON.parse(embedded.stdout);
  }
  results.guiFuses = await hardenElectronFuses(gui, 'gui');
  results.workerFuses = await hardenElectronFuses(worker, 'worker');
  const guiCases = [
    ['hardened GUI ignores ELECTRON_RUN_AS_NODE and outside script', [attacker], { ELECTRON_RUN_AS_NODE: '1' }, false],
    ['hardened GUI ignores NODE_OPTIONS require injection', [], { NODE_OPTIONS: '--require=' + attacker }, true],
    ['hardened GUI rejects --app external directory code', ['--app=' + attackDirectory], {}, false],
    ['hardened GUI rejects explicit external script application', [attacker], {}, false],
  ];
  for (const [name, args, extra, authenticRequired] of guiCases) await check(name, async () => {
    const env = environment(extra); const child = await run(gui, ['--noerrdialogs', ...args], env);
    assert.equal(await exists(env.IDENTITY_ATTACK_MARKER), false, 'Code outside authenticated ASAR executed under GUI identity.');
    assert.equal(child.timedOut, false, 'Copied GUI exceeded the native test budget.');
    const authenticExecuted = await exists(env.IDENTITY_AUTHENTIC_MARKER);
    if (authenticRequired) assert.equal(authenticExecuted, true, child.stderr);
    return { attackExecuted: false, authenticExecuted, code: child.code, stderr: child.stderr.slice(-1000) };
  });
  for (const flag of ['--inspect', '--inspect-brk']) await check('hardened GUI disables Node ' + flag, async () => {
    const port = await freePort(); const env = environment(); let acceptedConnections = 0, probes = 0;
    const child = await run(gui, ['--noerrdialogs', flag + '=127.0.0.1:' + port], env, async process => {
      for (let i = 0; i < 30 && process.exitCode === null; i++) { probes++; if (await connectable(port)) acceptedConnections++; await pause(50); }
    });
    assert.equal(acceptedConnections, 0, 'Node inspector port was reachable.');
    assert.equal(await exists(env.IDENTITY_AUTHENTIC_MARKER), true, child.stderr);
    assert.equal(child.timedOut, false);
    return { acceptedConnections, probes, authenticExecuted: true, code: child.code };
  });
  await check('hardened worker keeps Node capability on separate executable identity and ignores NODE_OPTIONS', async () => {
    const script = path.join(directory, 'worker-probe.cjs');
    await fs.writeFile(script, `const fs=require('node:fs');const {pathToFileURL}=require('node:url');(async()=>{const trust=await import(${JSON.stringify(pathToFileURL(path.join(root, 'src/native-runtime-trust.js')).href)});process.report.excludeEnv=true;process.report.excludeNetwork=true;const systemDirectory=trust.deriveWindowsSystemDirectory(process.report.getReport().sharedObjects);console.log(JSON.stringify({node:process.versions.node,electron:process.versions.electron,systemDirectory,isAdmin:await trust.checkNativeExecutionPrivilege()}));})();`);
    const env = environment({ ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require=' + attacker }); const child = await run(worker, [script], env);
    assert.equal(child.code, 0, child.stderr); assert.equal(await exists(env.IDENTITY_ATTACK_MARKER), false);
    const nativeProbe = JSON.parse(child.stdout.trim()); assert.equal(typeof nativeProbe.isAdmin, 'boolean'); assert.match(nativeProbe.systemDirectory, /\\system32$/i);
    results.nativeTokenProbe = nativeProbe;
    return { nativeProbe, attackExecuted: false, code: child.code };
  });
  await check('native Core GUI policy accepts actual copied normal main process', async () => {
    const env = environment(); let policy;
    const child = await run(gui, [], env, async process => { policy = nativeArgumentPolicy(process); });
    assert.equal(policy.allowed, true, JSON.stringify(policy)); assert.equal(await exists(env.IDENTITY_AUTHENTIC_MARKER), true, child.stderr);
    return { policy, authenticExecuted: true, code: child.code };
  });
  await check('Chromium CDP still evaluates renderer JavaScript, but native Core launch policy rejects the same actual GUI process', async () => {
    const port = await freePort(); const env = environment({ IDENTITY_CDP_FIXTURE: '1' }); let policy, evaluation;
    const child = await run(gui, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port], env, async process => {
      policy = nativeArgumentPolicy(process);
      let target;
      for (let index = 0; index < 50 && !target && process.exitCode === null; index++) {
        try {
          const response = await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(300) });
          target = (await response.json()).find(value => value.type === 'page' && value.title === 'Own identity fixture');
        } catch {}
        if (!target) await pause(30);
      }
      assert.ok(target, 'Own copied GUI CDP renderer was not discoverable.');
      evaluation = await cdpEvaluate(target.webSocketDebuggerUrl, 'globalThis.__identityRemoteScript = 42; globalThis.__identityRemoteScript');
    });
    assert.equal(evaluation.result.value, 42); assert.equal(policy.allowed, false); assert.equal(policy.exitCode, 2);
    return { cdpRendererCodeExecuted: true, nativeCoreMainPolicyDenied: true, policy, code: child.code };
  });
  await check('hardened GUI terminates when ASAR header changes', async () => {
    const validBytes = await fs.readFile(archive);
    try {
      await fs.copyFile(attacker, path.join(application, 'main.cjs')); await createPackage(application, archive);
      assert.notEqual(createHash('sha256').update(getRawHeader(archive).headerString).digest('hex'), header);
      const env = environment(); const child = await run(gui, ['--noerrdialogs'], env);
      assert.equal(await exists(env.IDENTITY_ATTACK_MARKER), false); assert.equal(await exists(env.IDENTITY_AUTHENTIC_MARKER), false);
      assert.notEqual(child.code, 0); assert.equal(child.timedOut, false);
      return { attackExecuted: false, authenticExecuted: false, code: child.code, stderr: child.stderr.slice(-1000) };
    } finally { await fs.writeFile(archive, validBytes); }
  });
  results.guiSha256 = await sha(gui); results.workerSha256 = await sha(worker);
} catch (error) { results.error = error.message; process.exitCode = 1; }
finally {
  for (const child of children) if (child.exitCode === null) child.kill();
  results.completedAt = new Date().toISOString(); results.passed = results.cases.every(value => value.passed) && !results.error;
  await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log('EVIDENCE=' + path.join(directory, 'results.json'));
}
