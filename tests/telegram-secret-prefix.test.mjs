import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { loadRecovered } from './load-recovered.mjs';

const { TelegramProxyConfigSchema } = loadRecovered('electron/ipc/ipc-schemas', { z, isIP }, ['TelegramProxyConfigSchema']);
let generated = 0;
const manager = loadRecovered('electron/ipc/telegram-proxy-manager', {
  promisify: () => () => { throw new Error('No native child is permitted in this secret contract test'); },
  execFile() {}, isIP,
  randomBytes(size) { generated += 1; return randomBytes(size); },
}, ['normalizeTelegramProxySecret', 'validateTelegramProxyConfig', 'buildTelegramProxyLink', 'buildTelegramProxyWebLink']);
const config = secret => ({ host: '127.0.0.1', port: 1445, secret, dcIp: [], verbose: false, bufKb: 256, poolSize: 8, logMaxMb: 5, checkUpdates: true });
const ordinary = 'ab' + '0'.repeat(30);
const leadingDd = 'dd' + '0'.repeat(30);

for (const [label, input, expected] of [
  ['raw leading dd', leadingDd, leadingDd],
  ['prefixed leading dd', 'dd' + leadingDd, leadingDd],
  ['raw all dd', 'd'.repeat(32), 'd'.repeat(32)],
  ['upper-case whitespace', '  ' + leadingDd.toUpperCase() + '  ', leadingDd],
  ['ordinary raw', ordinary, ordinary],
  ['ordinary prefixed', 'dd' + ordinary, ordinary],
]) {
  test(`${label}: schema, saved config and both links preserve the same 16-byte secret`, () => {
    const before = generated;
    const parsed = TelegramProxyConfigSchema.parse(config(input));
    const validated = manager.validateTelegramProxyConfig(parsed);
    assert.equal(validated.secret, expected);
    assert.equal(manager.normalizeTelegramProxySecret(input), expected);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assert.equal(new URL(manager.buildTelegramProxyLink(validated)).searchParams.get('secret'), 'dd' + expected);
      assert.equal(new URL(manager.buildTelegramProxyWebLink(validated)).searchParams.get('secret'), 'dd' + expected);
    }
    assert.equal(generated, before, 'Valid saved secrets must never be regenerated while constructing a link');
  });
}

test('malformed, truncated and overlong secret inputs are still refused before saving', () => {
  for (const invalid of ['', 'd'.repeat(30), 'd'.repeat(31), 'd'.repeat(33), 'ab' + '0'.repeat(32), 'dd' + 'g'.repeat(32), 'dd' + '0'.repeat(34)]) {
    assert.equal(TelegramProxyConfigSchema.safeParse(config(invalid)).success, false);
    assert.throws(() => manager.validateTelegramProxyConfig(config(invalid)), /Secret/);
  }
});
