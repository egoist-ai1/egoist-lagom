import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { loadRecovered } from './load-recovered.mjs';

const login = loadRecovered('electron/ipc/login-item-settings', { path, promisify, execFile },
  ['buildWindowsLoginItemSettings', 'syncWindowsLoginItemSettings']);

test('Windows GUI startup follows only the explicit autoStart preference', () => {
  for (const autoStart of [false, true]) for (const autoConnect of [false, true]) {
    const settings = { autoStart, autoConnect, startMinimized: true };
    const actual = login.buildWindowsLoginItemSettings(settings, 'C:\\Program Files\\EgoistShield\\EgoistShield.exe');
    assert.equal(actual.openAtLogin, autoStart, JSON.stringify(settings));
    assert.deepEqual(Array.from(actual.args), ['--background', '--minimized']);
  }
});

test('enabling automatic connection cannot silently register a GUI login item', () => {
  const writes = [];
  const app = { setLoginItemSettings: value => writes.push(value),
    getLoginItemSettings: () => ({ openAtLogin: writes.at(-1).openAtLogin }) };
  const settings = { autoStart: false, autoConnect: true };
  assert.equal(login.syncWindowsLoginItemSettings({ app, settings, platform: 'win32', executablePath: 'C:\\App.exe' }), true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].openAtLogin, false);
  assert.deepEqual(settings, { autoStart: false, autoConnect: true });
});
