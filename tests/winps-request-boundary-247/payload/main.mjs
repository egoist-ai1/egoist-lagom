import {app} from 'electron';
import fs from 'node:fs/promises';
import {mkdirSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {deriveWindowsSystemDirectory} from './frozen-native-runtime-trust.mjs';

const SOURCE = '247cb3c8f3a171202613b5b679ebab400f040ca7';
const modes = new Set(['clr', 'pipeline', 'parameter', 'pipeline-progress-silent', 'security', 'full-bootstrap', 'pipeline-qualified', 'parameter-unqualified', 'full-bootstrap-qualified-pipeline', 'full-bootstrap-qualified-parameter', 'full-bootstrap-qualified-modules']);
const phases = new Set(['command-start','before-base64','base64-decoded','utf8-decoded','before-clr-compare','before-json','before-security-import','security-imported','request-decoded','result-flushed','probe-exception','protected-root','inventory-open','inventory-valid','code-validation','code-validated']);
const began = performance.now();
const ms = () => Math.round(performance.now() - began);
let mode = '', windowsCreated = 0;
const readyAtEntry = app.isReady();
app.on('browser-window-created', () => { windowsCreated++; });
function emit(stage, data = {}) {
  const value = {schemaVersion:1, sourceCommit:SOURCE, mode, stage, elapsedMs:ms(), readyAtEntry, ready:app.isReady(), packaged:app.isPackaged, defaultApp:process.defaultApp === true, windowsCreated, ...data};
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 8192) { app.exit(65); return; }
  return new Promise(resolve => process.stdout.write(text + '\n', resolve));
}
function systemDirectory() {
  const report = process.report;
  if (process.platform !== 'win32' || typeof report?.getReport !== 'function') throw Error('KnownDLL unavailable');
  const savedEnv = report.excludeEnv, savedNetwork = report.excludeNetwork;
  try {
    report.excludeEnv = true; report.excludeNetwork = true;
    return deriveWindowsSystemDirectory(report.getReport().sharedObjects);
  } finally { report.excludeEnv = savedEnv; report.excludeNetwork = savedNetwork; }
}
function childEnvironment(system) {
  const environment = {...process.env};
  for (const key of Object.keys(environment))
    if (/^(DOTNET_|COMPLUS_|CORECLR_|COR_|NODE_|OPENSSL_)/i.test(key)) delete environment[key];
  for (const key of Object.keys(environment))
    if (/^(PATH|SYSTEMROOT|WINDIR|PSMODULEPATH)$/i.test(key)) delete environment[key];
  environment.PATH = system + ';' + path.win32.dirname(system);
  environment.SystemRoot = path.win32.dirname(system);
  environment.PSModulePath = path.win32.join(system, 'WindowsPowerShell', 'v1.0', 'Modules');
  return environment;
}
async function measure() {
  const system = systemDirectory();
  const executable = path.win32.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const stat = await fs.lstat(executable);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Known OS file unavailable');
  const request64 = Buffer.from(JSON.stringify({resourcesPath:'C:\\Program Files\\EgoistShield\\resources'}), 'utf8').toString('base64');
  const template = await fs.readFile(fileURLToPath(new URL('./case-' + mode + '.ps1', import.meta.url)), 'utf8');
  if (!template.includes('__REQUEST64__') || template.length > (mode.startsWith('full-bootstrap') ? 16384 : 8192)) throw Error('Case input unavailable');
  const command = template.replaceAll('__REQUEST64__', request64);
  const environment = childEnvironment(system);
  const present = name => Object.keys(environment).some(key => key.toUpperCase() === name);
  emit('measurement-start', {readyBeforeCheck:app.isReady(), knownDllIdentity:true, requestEmbedded:true, responseBudgetMs:30000, releaseKillBudgetMs:3000, modulePathFixed:true, commandUtf16Bytes:Buffer.byteLength(command,'utf16le'), encodedCommandCharacters:Buffer.from(command,'utf16le').toString('base64').length, requestUtf8Bytes:Buffer.from(request64,'base64').length,
    systemDrivePresent:present('SYSTEMDRIVE'), processorArchitecturePresent:present('PROCESSOR_ARCHITECTURE'), processorArchiteW6432Present:present('PROCESSOR_ARCHITEW6432'), numberOfProcessorsPresent:present('NUMBER_OF_PROCESSORS')});
  const start = performance.now();
  const child = spawn(executable, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')], {
    windowsHide:true, stdio:['pipe','pipe','pipe'], cwd:system, env:environment
  });
  let output = '', stderrLine = '', stderrBytes = 0, stderrPhase = null;
  let exitObserved = false, exitCode = null, closeObserved = false, clixmlObserved = false, preparingModulesProgressObserved = false;
  let stages = [], metadata = {}, stdoutLimit = false, markerBytes = 0;
  child.once('exit', code => { exitObserved = true; exitCode = Number.isInteger(code) ? code : null; });
  const closed = new Promise(resolve => child.once('close', () => { closeObserved = true; resolve(true); }));
  child.stdin.on('error', () => {});
  function stderrLineSeen(line) {
    if (line.includes('#< CLIXML')) clixmlObserved = true;
    if (line.includes('Preparing modules for first use')) preparingModulesProgressObserved = true;
    for (const match of line.matchAll(/EGOIST_(?:BOUNDARY|TRUST)_PHASE:([a-z-]+)/g)) {
      if (!phases.has(match[1])) continue;
      stderrPhase = match[1]; markerBytes += Buffer.byteLength(match[0]);
      if (stages.length < 32) stages.push({phase:match[1], elapsedMs:Math.round(performance.now() - start)});
    }
    const match = line.match(/EGOIST_BOUNDARY_META:(\{[^\r\n]{1,512}\})/);
    if (!match) return;
    try {
      const value = JSON.parse(match[1]);
      if (value.schemaVersion !== 1) return;
      for (const name of ['byteCount','charCount','errorCategory','hresult','innerHresult'])
        if (value[name] === null && name === 'innerHresult') metadata[name] = null;
        else if (Number.isInteger(value[name]) && value[name] >= -2147483648 && value[name] <= 2147483647) metadata[name] = value[name];
    } catch { }
  }
  child.stderr.on('data', chunk => {
    stderrBytes = Math.min(2147483647, stderrBytes + chunk.length);
    if (stderrBytes > 16384) return;
    stderrLine += chunk.toString('utf8');
    while (stderrLine.includes('\n')) {
      const at = stderrLine.indexOf('\n'), line = stderrLine.slice(0, at);
      stderrLine = stderrLine.slice(at + 1);
      if (line.length <= 2048) stderrLineSeen(line);
    }
    if (stderrLine.length > 2048) stderrLine = '';
  });
  const outcome = await new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({...value, outcomeElapsedMs:Math.round(performance.now() - start), responseBytes:Buffer.byteLength(output), exitObservedAtOutcome:exitObserved, exitCodeAtOutcome:exitCode, lastPhaseAtOutcome:stderrPhase,
        stdinEndedBeforeOutcome:child.stdin.writableEnded, spawnObserved:Number.isInteger(child.pid)});
    };
    const timer = setTimeout(() => finish({code:'TIMEOUT', requestMatched:false, responseValid:false}), 30000);
    child.once('error', () => finish({code:'SPAWN_FAILED', requestMatched:false, responseValid:false}));
    child.once('close', () => finish({code:'NO_RESPONSE', requestMatched:false, responseValid:false}));
    child.stdout.on('data', chunk => {
      if (stdoutLimit) return;
      output += chunk.toString('utf8');
      if (Buffer.byteLength(output) > 16384) {
        stdoutLimit = true; output = output.slice(0, 16384);
        finish({code:'RESPONSE_LIMIT', requestMatched:false, responseValid:false}); return;
      }
      if (!output.includes('\n')) return;
      try {
        const value = JSON.parse(output.slice(0, output.indexOf('\n')));
        if (mode.startsWith('full-bootstrap')) {
          if (typeof value.ok !== 'boolean' || Object.keys(value).length !== 2 ||
              (value.ok ? typeof value.helperPath !== 'string' : typeof value.error !== 'string')) throw Error('Original full response schema');
          finish({code:value.ok ? 'FULL_READ_RESULT' : 'FULL_REJECTED', requestMatched:false, responseValid:true});
        } else {
          if (typeof value.ok !== 'boolean' || typeof value.requestMatched !== 'boolean' || Object.keys(value).length !== 2) throw Error('Fixed schema');
          finish({code:value.ok && value.requestMatched ? 'PASS' : 'PS_EXCEPTION', requestMatched:value.requestMatched, responseValid:true});
        }
      } catch { finish({code:'INVALID_RESPONSE', requestMatched:false, responseValid:false}); }
    });
  });
  child.stdin.end();
  const killTimer = setTimeout(() => { if (!exitObserved) child.kill(); }, 3000);
  const drain = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 5000);
    closed.then(value => { clearTimeout(timer); resolve(value); });
  });
  clearTimeout(killTimer);
  if (stderrLine.length <= 2048 && stderrLine) stderrLineSeen(stderrLine);
  await emit('measurement-result', {...outcome, stages, metadata, responseBytes:outcome.responseBytes, stderrBytes, markerBytes, clixmlObserved, preparingModulesProgressObserved, exitObserved, exitCode, closeObserved,
    lastPhase:stderrPhase, streamCloseWithinBudget:drain, stdinDeliberatelyOpen:true, stdinReleasedAfterOutcome:true, childPid:Number.isInteger(child.pid) ? child.pid : null,
    protectedBootstrapReached:mode.startsWith('full-bootstrap') && stages.some(step => step.phase === 'request-decoded'), measurementComplete:drain, rawStdoutPersisted:false, rawStderrPersisted:false, readyAfterCheck:app.isReady()});
  return drain;
}

try {
  const args = process.argv.slice(1);
  if (args.length !== 4 || args[0] !== '--case' || !modes.has(args[1]) || args[2] !== '--work' || !path.isAbsolute(args[3]) || !app.isPackaged || process.defaultApp === true || process.versions.electron !== '44.5.1') throw Error('Fixed invocation guard');
  mode = args[1];
  const work = path.resolve(args[3]), stat = lstatSync(work);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(process.env.TEMP || '') !== work || path.resolve(process.env.TMP || '') !== work) throw Error('Owned work guard');
  const profile = path.join(work, 'owned-profile');
  mkdirSync(profile, {recursive:false});
  for (const name of ['appData','userData','sessionData','logs','crashDumps']) {
    const directory = path.join(profile, name); mkdirSync(directory, {recursive:false}); app.setPath(name, directory);
  }
  app.setName('Lagom WinPS boundary diagnostic');
  emit('entry', {ownedProfile:true, scopeInstalledResourcesRead:mode.startsWith('full-bootstrap'), coreInvoked:false});
  const complete = await measure();
  app.exit(complete && windowsCreated === 0 ? 0 : 64);
} catch (error) {
  await emit('setup-failed', {code:'SETUP_FAILED', errorHresult:Number.isInteger(error?.hresult) ? error.hresult : null, measurementComplete:false});
  app.exit(64);
}
