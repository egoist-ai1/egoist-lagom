import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadRecovered } from './load-recovered.mjs';

const { parseZapretWinwsArgs, applyZapretPlaceholders, splitWindowsCommandLine, orderZapretProfilesForAutoSelect, ZapretManager } =
  loadRecovered('electron/ipc/zapret-manager', { path, promisify: fn => fn, execFile: () => {}, package_default: { version: '3.7.3' }, promises: { readFile: async () => { throw new Error('absent'); } } },
    ['parseZapretWinwsArgs', 'applyZapretPlaceholders', 'splitWindowsCommandLine', 'orderZapretProfilesForAutoSelect', 'ZapretManager']);

test('tested Discord/YouTube hybrid uses a bundled hostlist and is first in auto-select order', () => {
  const name = 'general (EGOIST MIX)';
  const profile = fs.readFileSync('src/zapret/general (EGOIST MIX).bat', 'utf8');
  const list = fs.readFileSync('src/zapret/list-egoist-discord.txt', 'utf8').split(/\r?\n/).filter(Boolean);
  assert.ok(list.includes('discord.com'));
  assert.ok(list.includes('discordapp.com'));
  assert.ok(!list.includes('youtube.com'));
  assert.equal((profile.match(/list-egoist-discord\.txt/g) ?? []).length, 1);
  assert.ok(profile.indexOf('list-egoist-discord.txt') < profile.indexOf('list-google.txt'));
  assert.ok(!profile.includes('C:\\Users\\'));
  const args = splitWindowsCommandLine(applyZapretPlaceholders(parseZapretWinwsArgs(profile), {
    BIN: 'C:\\Shield\\bin\\', LISTS: 'C:\\Shield\\lists\\',
    GameFilter: '12', GameFilterTCP: '12', GameFilterUDP: '12',
  }));
  assert.ok(args.includes('--hostlist=C:\\Shield\\lists\\list-egoist-discord.txt'));
  assert.ok(args.some(arg => arg.startsWith('--dpi-desync=hostfakesplit')));
  assert.equal(args.filter(arg => arg === '--hostlist-domains=discord.media').length, 1);
  const voiceIndex = args.indexOf('--hostlist-domains=discord.media');
  assert.ok(voiceIndex > 0);
  assert.ok(args.slice(voiceIndex, voiceIndex + 6).includes('--dpi-desync=multisplit'));
  assert.ok(args.some(arg => arg.includes('tls_clienthello_www_google_com.bin')));
  const ordered = orderZapretProfilesForAutoSelect([{ name, fileName: `${name}.bat` }, { name: 'General', fileName: 'general.bat' }], null);
  assert.equal(ordered[0].name, name);
});

test('GameFilter defaults to narrow Discord and YouTube ports when no user flag exists', async () => {
  const manager = new ZapretManager('resources', 'app', 'user', 'C:\\Shield\\Zapret');
  assert.equal(await manager.readGameFilterMode(), 'disabled');
});
