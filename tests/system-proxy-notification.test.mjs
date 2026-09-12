import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadRecovered } from './load-recovered.mjs';

const HELPER_PATH = path.join('C:', 'EgoistShield', 'resources', 'core-service', 'win-x64', 'EgoistShield.Service.exe');

function loadNotifier({ helperExists = true, helperResult, helperError } = {}) {
  const calls = [];
  const warnings = [];
  const { notifySystemProxyChanged } = loadRecovered('electron/ipc/system-proxy', {
    process: { platform: 'win32', resourcesPath: path.join('C:', 'EgoistShield', 'resources') },
    path,
    fs: { existsSync: candidate => helperExists && candidate === HELPER_PATH },
    fs$1: {},
    logger: { warn: (...args) => warnings.push(args), error() {} },
    resolveWindowsExecutable: name => `Windows/${name}`,
    execFile: async (executable, args, options) => {
      calls.push({ executable, args, options });
      if (helperError) throw helperError;
      if (executable === HELPER_PATH) return { stdout: JSON.stringify(helperResult ?? { ok: true }) };
      return { stdout: '' };
    },
    promisify: fn => fn,
  }, ['notifySystemProxyChanged']);
  return { notifySystemProxyChanged, calls, warnings };
}

test('packaged system-proxy notification uses the native helper without compiling PowerShell', async () => {
  const { notifySystemProxyChanged, calls } = loadNotifier();

  assert.equal(await notifySystemProxyChanged(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, HELPER_PATH);
  assert.equal(Array.from(calls[0].args).join(','), '--notify-system-proxy');
  assert.equal(calls[0].options.timeout, 20_000);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.maxBuffer, 128 * 1024);
  assert.equal(calls[0].options.encoding, 'utf8');
});

test('packaged helper reports a false notification result without falling back to PowerShell', async () => {
  const { notifySystemProxyChanged, calls, warnings } = loadNotifier({ helperResult: { ok: false, code: 'REFRESH_FAILED', message: 'WinINet failed' } });

  assert.equal(await notifySystemProxyChanged(), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, HELPER_PATH);
  assert.equal(warnings.length, 1);
});

test('packaged helper exit failure returns false without running a PowerShell compilation fallback', async () => {
  const error = Object.assign(new Error('native helper failed'), { code: 2, stdout: '{"ok":false}' });
  const { notifySystemProxyChanged, calls } = loadNotifier({ helperError: error });

  assert.equal(await notifySystemProxyChanged(), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, HELPER_PATH);
});

test('a missing bundled helper retains the development PowerShell fallback', async () => {
  const { notifySystemProxyChanged, calls } = loadNotifier({ helperExists: false });

  assert.equal(await notifySystemProxyChanged(), true);
  assert.equal(calls[0].executable, 'Windows/powershell.exe');
  assert.match(calls[0].args.at(-1), /Add-Type/);
});

test('native service CLI exposes the bounded system-proxy notification command', () => {
  const program = fs.readFileSync('src/service/EgoistShield.Service/Program.cs', 'utf8');
  const notifier = fs.readFileSync('src/service/EgoistShield.Service/SystemProxyNotifier.cs', 'utf8');

  assert.match(program, /--notify-system-proxy/);
  assert.match(program, /SystemProxyNotifier\.Notify\(\)/);
  assert.match(notifier, /InternetSetOption\(IntPtr\.Zero, InternetOptionSettingsChanged/);
  assert.match(notifier, /InternetSetOption\(IntPtr\.Zero, InternetOptionRefresh/);
});
