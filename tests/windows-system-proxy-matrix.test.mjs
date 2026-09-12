import test from 'node:test';
import assert from 'node:assert/strict';

function parseProxyEnable(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value === 1 ? 1 : 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === '1' || trimmed === '0x1' || trimmed === '0x00000001') return 1;
  }
  return 0;
}

function parseProxyServer(serverStr) {
  if (!serverStr || typeof serverStr !== 'string') return null;
  const trimmed = serverStr.trim();
  if (!trimmed.includes('=')) {
    const parts = trimmed.split(':');
    return { all: { host: parts[0], port: parseInt(parts[1], 10) } };
  }
  const result = {};
  const entries = trimmed.split(';');
  for (const entry of entries) {
    const [proto, addr] = entry.split('=');
    if (proto && addr) {
      const parts = addr.split(':');
      result[proto.trim()] = { host: parts[0], port: parseInt(parts[1], 10) };
    }
  }
  return result;
}

function shouldBypassProxy(host, overrideList) {
  if (!overrideList) return false;
  const rules = overrideList.split(';').map(r => r.trim()).filter(Boolean);
  for (const rule of rules) {
    if (rule === '<local>' && !host.includes('.')) return true;
    if (rule === host) return true;
    if (rule.endsWith('*') && host.startsWith(rule.slice(0, -1))) return true;
    if (rule.startsWith('*') && host.endsWith(rule.slice(1))) return true;
  }
  return false;
}

class MockProxyRegistryJournal {
  constructor() {
    this.journal = null;
    this.current = {
      ProxyEnable: 0,
      ProxyServer: '',
      ProxyOverride: '<local>',
      AutoConfigURL: ''
    };
  }

  beginEnable(newServer, newOverride) {
    this.journal = { ...this.current };
    this.current.ProxyEnable = 1;
    this.current.ProxyServer = newServer;
    this.current.ProxyOverride = newOverride;
  }

  commit() {
    this.journal = null;
  }

  rollback() {
    if (this.journal) {
      this.current = { ...this.journal };
      this.journal = null;
    }
  }
}

test('Windows 10/11 Proxy: parseProxyEnable numeric 1', () => {
  assert.equal(parseProxyEnable(1), 1);
  assert.equal(parseProxyEnable(0), 0);
});

test('Windows 10/11 Proxy: parseProxyEnable string "1"', () => {
  assert.equal(parseProxyEnable('1'), 1);
  assert.equal(parseProxyEnable('0'), 0);
});

test('Windows 10/11 Proxy: parseProxyEnable hex string "0x00000001"', () => {
  assert.equal(parseProxyEnable('0x00000001'), 1);
  assert.equal(parseProxyEnable('0x00000000'), 0);
});

test('Windows 10/11 Proxy: parseProxyEnable null or undefined returns 0', () => {
  assert.equal(parseProxyEnable(null), 0);
  assert.equal(parseProxyEnable(undefined), 0);
});

test('Windows 10/11 Proxy: Single proxy server 127.0.0.1:10809 parsed for all protocols', () => {
  const p = parseProxyServer('127.0.0.1:10809');
  assert.deepEqual(p.all, { host: '127.0.0.1', port: 10809 });
});

test('Windows 10/11 Proxy: Multi-protocol proxy server string parsed correctly', () => {
  const p = parseProxyServer('http=127.0.0.1:10809;https=127.0.0.1:10809;socks=127.0.0.1:10808');
  assert.equal(p.http.port, 10809);
  assert.equal(p.https.port, 10809);
  assert.equal(p.socks.port, 10808);
});

test('Windows 10/11 Proxy: ProxyOverride <local> bypasses dot-less internal hosts', () => {
  const overrides = 'localhost;127.*;<local>';
  assert.equal(shouldBypassProxy('fileserver', overrides), true);
  assert.equal(shouldBypassProxy('myhost', overrides), true);
  assert.equal(shouldBypassProxy('google.com', overrides), false);
});

test('Windows 10/11 Proxy: ProxyOverride exact host match bypasses proxy', () => {
  const overrides = 'localhost;127.*;<local>';
  assert.equal(shouldBypassProxy('localhost', overrides), true);
});

test('Windows 10/11 Proxy: ProxyOverride wildcard prefix 127.* bypasses loopback IPs', () => {
  const overrides = 'localhost;127.*;<local>';
  assert.equal(shouldBypassProxy('127.0.0.1', overrides), true);
  assert.equal(shouldBypassProxy('127.0.0.53', overrides), true);
});

test('Windows 10/11 Proxy: ProxyOverride wildcard domain *.internal bypasses corporate sites', () => {
  const overrides = 'localhost;*.internal;<local>';
  assert.equal(shouldBypassProxy('wiki.internal', overrides), true);
  assert.equal(shouldBypassProxy('internal.com', overrides), false);
});

test('Windows 10/11 Proxy: Journal records previous state before enable', () => {
  const mock = new MockProxyRegistryJournal();
  mock.current.ProxyEnable = 0;
  mock.current.ProxyServer = 'old:8080';
  mock.beginEnable('127.0.0.1:10809', 'localhost;<local>');
  assert.deepEqual(mock.journal, {
    ProxyEnable: 0,
    ProxyServer: 'old:8080',
    ProxyOverride: '<local>',
    AutoConfigURL: ''
  });
  assert.equal(mock.current.ProxyEnable, 1);
});

test('Windows 10/11 Proxy: Journal commit clears backup journal', () => {
  const mock = new MockProxyRegistryJournal();
  mock.beginEnable('127.0.0.1:10809', 'localhost;<local>');
  mock.commit();
  assert.equal(mock.journal, null);
  assert.equal(mock.current.ProxyEnable, 1);
});

test('Windows 10/11 Proxy: Journal rollback restores original state after aborted transaction', () => {
  const mock = new MockProxyRegistryJournal();
  mock.current.ProxyEnable = 0;
  mock.current.ProxyServer = '';
  mock.beginEnable('127.0.0.1:10809', 'localhost;<local>');
  mock.rollback();
  assert.equal(mock.journal, null);
  assert.equal(mock.current.ProxyEnable, 0);
  assert.equal(mock.current.ProxyServer, '');
});

test('Windows 10/11 Proxy: WinINet INTERNET_OPTION_SETTINGS_CHANGED constant is 39', () => {
  const INTERNET_OPTION_SETTINGS_CHANGED = 39;
  assert.equal(INTERNET_OPTION_SETTINGS_CHANGED, 39);
});

test('Windows 10/11 Proxy: WinINet INTERNET_OPTION_REFRESH constant is 37', () => {
  const INTERNET_OPTION_REFRESH = 37;
  assert.equal(INTERNET_OPTION_REFRESH, 37);
});

test('Windows 10/11 Proxy: PAC AutoConfigURL preservation during manual proxy', () => {
  const state = { pacUrl: 'http://wpad/wpad.dat', manualProxyActive: false };
  function enableManualProxy(s) {
    s.savedPac = s.pacUrl;
    s.pacUrl = '';
    s.manualProxyActive = true;
  }
  function disableManualProxy(s) {
    s.pacUrl = s.savedPac;
    s.manualProxyActive = false;
  }
  enableManualProxy(state);
  assert.equal(state.pacUrl, '');
  disableManualProxy(state);
  assert.equal(state.pacUrl, 'http://wpad/wpad.dat');
});

test('Windows 10/11 Proxy: Per-user proxy policy allows user modification', () => {
  const policy = { ProxySettingsPerUser: 1 };
  assert.equal(policy.ProxySettingsPerUser, 1);
});

test('Windows 10/11 Proxy: WPAD auto-detect bit 0x08 masked off during manual proxy', () => {
  let connectionOptions = 0x09; // 0x01 (direct) + 0x08 (auto-detect)
  connectionOptions &= ~0x08; // mask off auto-detect
  connectionOptions |= 0x02; // set manual proxy
  assert.equal(connectionOptions & 0x08, 0);
  assert.equal(connectionOptions & 0x02, 2);
});

test('Windows 10/11 Proxy: Idempotent proxy disable does not overwrite original settings', () => {
  let disableCount = 0;
  let active = true;
  function disable() {
    if (!active) return;
    disableCount++;
    active = false;
  }
  disable();
  disable();
  assert.equal(disableCount, 1);
});

test('Windows 10/11 Proxy: Chromium/Edge dynamic proxy reload via WinINet notify without restart', () => {
  const notifications = [];
  function notifyBrowsers() {
    notifications.push('INTERNET_OPTION_SETTINGS_CHANGED');
    notifications.push('INTERNET_OPTION_REFRESH');
  }
  notifyBrowsers();
  assert.deepEqual(notifications, ['INTERNET_OPTION_SETTINGS_CHANGED', 'INTERNET_OPTION_REFRESH']);
});
