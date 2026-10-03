import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const run = promisify(execFile);
const script = fileURLToPath(new URL('./installer-managed-compiler-references.ps1', import.meta.url));
const sites = ['heartbeat', 'proxy', 'restart-manager', 'worker-input', 'gui-identity', 'file-locks'];

function workRoot() {
  if (process.env.EGOISTSHIELD_TEST_WORK_ROOT) return path.resolve(process.env.EGOISTSHIELD_TEST_WORK_ROOT);
  const pointerPath = path.join(os.homedir(), '.codex', 'brain-pointer.json');
  if (!fs.existsSync(pointerPath)) return os.tmpdir();
  assert.ok(process.env.CODEX_THREAD_ID, 'Brain fixtures require the actual current task ID');
  const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
  const result = JSON.parse(fs.readFileSync(path.join(pointer.chat_runtime, 'tasks', process.env.CODEX_THREAD_ID, 'checkpoint.json'), 'utf8'));
  assert.equal(result.task_id, process.env.CODEX_THREAD_ID);
  return path.join(pointer.chat_runtime, 'tasks', result.task_id, 'work');
}

function nativePlugin() {
  if (process.env.EGOISTSHIELD_TEST_NSIS_SYSTEM_DLL) return path.resolve(process.env.EGOISTSHIELD_TEST_NSIS_SYSTEM_DLL);
  const cache = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'nsis-3.0.4.1');
  assert.ok(fs.existsSync(cache), 'Install the official electron-builder NSIS 3.0.4.1 plugin or supply EGOISTSHIELD_TEST_NSIS_SYSTEM_DLL');
  const candidates = fs.readdirSync(cache, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(cache, entry.name, 'Plugins', 'x86-unicode', 'System.dll'))
    .filter(candidate => fs.existsSync(candidate));
  assert.equal(candidates.length, 1, 'Select one exact official NSIS System.dll explicitly if multiple cache plugins exist');
  return candidates[0];
}

test('all six actual installer C# statements compile with native NSIS System.dll in cwd', { skip: process.platform !== 'win32', timeout: 120_000 }, async () => {
  const native5 = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  assert.ok(fs.existsSync(native5), 'Native Windows PowerShell 5.1 is required');
  const parent = fs.realpathSync(workRoot());
  const directory = fs.mkdtempSync(path.join(parent, 'lagom-managed-compiler-references-'));
  // PowerShell validates a GUID-shaped parent; rename only this freshly created fixture.
  const fixture = path.join(parent, `lagom-managed-compiler-references-${crypto.randomUUID()}`);
  fs.renameSync(directory, fixture);
  const dll = nativePlugin();
  const results = [];
  try {
    for (const site of sites) {
      const cwd = path.join(fixture, site);
      fs.mkdirSync(path.join(cwd, 'compiler'), { recursive: true });
      const { stdout, stderr } = await run(native5, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-TestDirectory', cwd, '-NativeSystemDll', dll, '-Site', site], {
        cwd,
        windowsHide: true,
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          PSModulePath: path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
          TEMP: path.join(cwd, 'compiler'),
          TMP: path.join(cwd, 'compiler'),
        },
      });
      assert.equal(stderr.trim(), '', `${site}: unexpected compiler stderr`);
      const result = JSON.parse(stdout.trim());
      assert.equal(result.site, site);
      assert.match(result.nativeVersion, /^5\.1\./);
      assert.equal(result.compiled, true);
      assert.equal(result.compilationOutputCount, 0);
      assert.equal(result.nativePluginMetadataRejected, true);
      assert.equal(result.heldPluginUnchanged, true);
      assert.equal(result.originalPluginUnchanged, true);
      assert.equal(result.cwdUnchanged, true);
      assert.equal(result.sourceUnchanged, true);
      assert.equal(result.operationalCalls, 0);
      assert.equal(result.executionScope, 'actual Add-Type AST statement only');
      assert.equal(result.references.length, 3);
      assert.match(result.nsisSha256, /^[a-f0-9]{64}$/);
      if (results.length) assert.equal(result.nsisSha256, results[0].nsisSha256);
      results.push(result);
    }
    console.log(JSON.stringify({ native5Processes: results.length, results }));
  } finally {
    const actual = fs.realpathSync(fixture);
    assert.equal(path.dirname(actual).toLowerCase(), parent.toLowerCase());
    assert.match(path.basename(actual), /^lagom-managed-compiler-references-[a-f0-9-]{36}$/);
    fs.rmSync(actual, { recursive: true, force: false });
  }
});
