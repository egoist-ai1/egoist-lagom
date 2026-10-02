import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { loadRecovered } from './load-recovered.mjs';

function api(bindings = {}) {
  return loadRecovered('electron/ipc/zapret-manager', {
    path: path.win32, isIP, promisify: fn => fn, execFile: () => {},
    package_default: { version: '3.8.0' }, ...bindings,
  }, ['ZapretManager', 'applyZapretProfileExclusions', 'splitWindowsCommandLine', 'applyZapretDnsTransportExclusions']);
}
const sdk = api();
const listDir = String.raw`C:\Профили Lagom\core\lists`;
const included = '--hostlist=' + path.win32.join(listDir, 'list-egoist-sites.txt');
function groups(command) {
  const result = [[]];
  for (const argument of sdk.splitWindowsCommandLine(command)) {
    if (argument === '--new') result.push([]);
    else result.at(-1).push(argument);
  }
  return result;
}

test('named sites join existing general hostname strategies once without expanding packet or UDP media scope', () => {
  const source = String.raw`--wf-tcp=80,443,8443 --wf-udp=443,19294-19344,50000-50100 --filter-tcp=443 --hostlist="C:\Профили Lagom\core\lists\list-general.txt" --hostlist="C:\Профили Lagom\core\lists\list-general-user.txt" --dpi-desync=fake --new --filter-udp=443 --hostlist="C:\Профили Lagom\core\lists\list-general-user.txt" --dpi-desync=fake --new --filter-udp=19294-19344,50000-50100 --filter-l7=discord,stun --dpi-desync=fake --new --filter-tcp=8443 --hostlist-domains=discord.media --dpi-desync=multisplit --new --filter-tcp=443 --hostlist="C:\Other\list-general.txt" --dpi-desync=fake`;
  const output = sdk.applyZapretProfileExclusions(source, listDir);
  const strategies = groups(output);
  assert.equal(strategies[0].filter(value => value === included).length, 1);
  assert.equal(strategies[1].filter(value => value === included).length, 1);
  for (const strategy of strategies.slice(2)) assert.ok(!strategy.includes(included));
  assert.ok(!strategies[2].some(value => value.startsWith('--hostlist')));
  assert.ok(strategies[0].includes('--wf-tcp=80,443,8443'));
  assert.ok(strategies[0].includes('--wf-udp=443,19294-19344,50000-50100'));
  assert.deepEqual([...sdk.splitWindowsCommandLine(sdk.applyZapretProfileExclusions(output, listDir))], [...sdk.splitWindowsCommandLine(output)]);
});

test('new hostname coverage preserves exact full DNS AND guard including both IPv4/IPv6 directions', () => {
  const source = String.raw`--wf-tcp=443,8443 --filter-tcp=443 --hostlist="C:\Профили Lagom\core\lists\list-general.txt" --dpi-desync=fake`;
  const overlay = sdk.applyZapretProfileExclusions(source, listDir);
  assert.ok(groups(overlay)[0].includes(included));
  const guarded = sdk.applyZapretDnsTransportExclusions(overlay, [{ address: '192.0.2.10', port: 8443 }, { address: '2001:db8::10', port: 443 }], 'tcp and (tcp.DstPort == 443 or tcp.SrcPort == 443 or tcp.DstPort == 8443 or tcp.SrcPort == 8443)');
  const raw = [...sdk.splitWindowsCommandLine(guarded)].filter(value => value.startsWith('--wf-raw='));
  assert.equal(raw.length, 1);
  assert.match(raw[0], /^--wf-raw=\(tcp and .*\) and /);
  assert.match(raw[0], /ip.DstAddr != 192.0.2.10 or tcp.DstPort != 8443/);
  assert.match(raw[0], /ip.SrcAddr != 192.0.2.10 or tcp.SrcPort != 8443/);
  assert.match(raw[0], /ipv6.DstAddr != 2001:db8::10 or tcp.DstPort != 443/);
  assert.match(raw[0], /ipv6.SrcAddr != 2001:db8::10 or tcp.SrcPort != 443/);
});

test('provisioning refreshes its owned named-site list and preserves all user lists', async t => {
  const root = process.env.LAGOM_TEST_TEMP;
  assert.ok(root && path.isAbsolute(root), 'Set LAGOM_TEST_TEMP to the absolute task work directory.');
  await fs.mkdir(root, { recursive: true });
  const work = await fs.mkdtemp(path.join(root, 'named-sites-'));
  t.after(() => fs.rm(work, { recursive: true, force: true }));
  const lists = path.join(work, 'core', 'lists');
  await fs.mkdir(lists, { recursive: true });
  const userBytes = 'user.example.org\r\n';
  await fs.writeFile(path.join(lists, 'list-general-user.txt'), userBytes);
  await fs.writeFile(path.join(lists, 'list-egoist-sites.txt'), 'obsolete.example\n');
  const { ZapretManager } = api({ path, promises: fs });
  const manager = new ZapretManager('resources', 'app', 'user', work);
  await manager.ensureUserLists();
  const content = await fs.readFile(path.join(lists, 'list-egoist-sites.txt'), 'utf8');
  assert.equal(content, 'instagram.com\ncdninstagram.com\nx.com\ntwitter.com\ntwimg.com\nt.co\nfut.gg\n');
  assert.equal(await fs.readFile(path.join(lists, 'list-general-user.txt'), 'utf8'), userBytes);
  await manager.ensureUserLists();
  assert.equal(await fs.readFile(path.join(lists, 'list-egoist-sites.txt'), 'utf8'), content);
  assert.equal(await fs.readFile(path.join(lists, 'list-general-user.txt'), 'utf8'), userBytes);
});

test('unavailable optional Instagram, X and FUT.gg sites cannot reject or rerank the default auto-select profile', async () => {
  const expectedUrls = [
    'https://discord.com', 'https://discord.com/api/v10/gateway',
    'https://cdn.discordapp.com/embed/avatars/0.png', 'https://www.youtube.com',
    'https://youtu.be', 'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg',
  ];
  async function select(optionalAvailable) {
    const calls = [];
    const { ZapretManager } = api({
      createHash, os: { networkInterfaces: () => ({}) }, sleep: async () => {},
      logger: { warn() {}, info() {} }, resolveWindowsExecutable: name => name,
      parseCurlStatusCode: text => Number(text) || null, normalizeCurlProbeError: value => String(value),
      execFile: async (_exe, args) => {
        const url = args.at(-1); calls.push(url);
        if (!expectedUrls.includes(url) && !optionalAvailable) throw new Error('optional site unavailable');
        return { stdout: '200', stderr: '' };
      },
    });
    const manager = new ZapretManager('resources', 'app', 'user', 'C:\\Shield\\zapret');
    let active = false;
    manager.captureAutoSelectActiveMode = async () => null;
    manager.resetOwnedRuntimeBeforeAutoSelect = async () => {};
    manager.ensureProvisioned = async () => {};
    manager.listProfiles = async () => [{ name: 'General', fileName: 'general.bat' }];
    manager.readAutoSelectMemory = async () => null;
    manager.writeAutoSelectMemory = async () => {};
    manager.readRecentDiscordVoiceControlTarget = async () => null;
    manager.startProbeStandalone = async () => { active = true; };
    manager.stopProbeStandalone = async () => { active = false; };
    manager.listIntegratedWinwsProcesses = async () => active ? [{ pid: 123 }] : [];
    const result = await manager.autoSelectBestProfile();
    assert.deepEqual([...new Set(calls)].sort(), [...expectedUrls].sort());
    assert.equal(calls.length, 12, 'Only six original targets in each of two passes.');
    assert.equal(result.bestProfile, 'General');
    assert.equal(result.results[0].result, 'success');
    assert.equal(result.results[0].passedTargets, 6);
    assert.equal(result.results[0].totalTargets, 6);
    assert.equal(result.voiceMediaVerified, false);
    return result.bestProfile;
  }
  assert.equal(await select(false), await select(true));
});
