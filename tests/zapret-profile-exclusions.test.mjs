import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import { loadRecovered } from './load-recovered.mjs';

const workDir = 'C:\\Профили Lagom\\Runtime Zapret';
function api(bindings = {}) {
  return loadRecovered('electron/ipc/zapret-manager', {
    path: path.win32, isIP, promisify: fn => fn, execFile: () => {},
    package_default: { version: '3.8.0' }, ...bindings,
  }, ['ZapretManager', 'normalizeZapretNetworkEntries', 'normalizeZapretDomainEntries', 'splitWindowsCommandLine', 'parseZapretWinwsArgs', 'applyZapretPlaceholders']);
}
const { normalizeZapretNetworkEntries, normalizeZapretDomainEntries, splitWindowsCommandLine, parseZapretWinwsArgs, applyZapretPlaceholders } = api();
function segments(args) {
  const result = [[]];
  for (const arg of splitWindowsCommandLine(args)) {
    if (arg === '--new') result.push([]);
    else result.at(-1).push(arg);
  }
  return result;
}
async function command(source, mode = 'disabled') {
  const { ZapretManager } = api({ promises: { readFile: async () => source } });
  const manager = new ZapretManager('resources', 'app', 'user', workDir);
  manager.readGameFilterMode = async () => mode;
  return (await manager.buildServiceCommand('selected', [{ name: 'selected', fileName: 'selected.bat' }])).args;
}
const listDir = path.win32.join(workDir, 'core', 'lists');
const ipExcludes = ['ipset-exclude.txt', 'ipset-exclude-user.txt'].map(name => '--ipset-exclude=' + path.win32.join(listDir, name));
const hostExcludes = ['list-exclude.txt', 'list-exclude-user.txt'].map(name => '--hostlist-exclude=' + path.win32.join(listDir, name));

test('IP/CIDR validator rejects malformed addresses and out-of-family prefixes before persistence', () => {
  for (const entry of ['999.999.999.999/99', 'deadbeef', '1.2.3.4/33', '2001:db8::1/129', ':::', '1.2.3.4/-1', '1.2.3.4/1/2', 'fe80::1%12']) {
    assert.throws(() => normalizeZapretNetworkEntries([entry], '203.0.113.113/32'), /Некорректные IP\/CIDR/, entry);
  }
  const valid = ['192.0.2.1', '0.0.0.0/0', '192.0.2.0/32', '2001:DB8::/0', '::1/128'];
  assert.deepEqual([...normalizeZapretNetworkEntries(valid, '203.0.113.113/32')], valid.map(value => value.toLowerCase()));
});

test('domain validator enforces the full DNS name limit as well as label validity', () => {
  const valid = [63, 63, 63, 61].map(size => 'a'.repeat(size)).join('.');
  assert.equal(valid.length, 253);
  assert.equal(normalizeZapretDomainEntries([valid], 'domain.example.abc').length, 1);
  assert.throws(() => normalizeZapretDomainEntries([valid + 'a'], 'domain.example.abc'), /Некорректные домены/);
});

test('every bundled strategy respects IP exclusions and hostname strategies respect domain exclusions', async () => {
  const files = fs.readdirSync('resources/runtime/zapret/core').filter(name => /^general.*\.bat$/i.test(name));
  assert.ok(files.length >= 22);
  files.push('EGOIST MIX');
  for (const file of files) {
    const source = fs.readFileSync(file === 'EGOIST MIX' ? 'src/zapret/general (EGOIST MIX).bat' : path.join('resources/runtime/zapret/core', file), 'utf8');
    for (const mode of ['disabled', 'all', 'tcp', 'udp']) {
      const args = await command(source, mode);
      const original = segments(applyZapretPlaceholders(parseZapretWinwsArgs(source), { BIN: path.win32.join(workDir, 'core', 'bin') + '\\', LISTS: listDir + '\\', GameFilter: '12', GameFilterTCP: '12', GameFilterUDP: '12' }));
      for (const [index, strategy] of segments(args).entries()) {
        for (const exclude of ipExcludes) assert.equal(strategy.filter(arg => arg === exclude).length, 1, `${file}/${mode}/${index}: ${exclude}`);
        const hasHostname = strategy.some(arg => /^--hostlist(?:-domains|-auto)?=/.test(arg));
        if (hasHostname) for (const exclude of hostExcludes) assert.equal(strategy.filter(arg => arg === exclude).length, 1, `${file}/${mode}/${index}: ${exclude}`);
        else assert.deepEqual(strategy.filter(arg => /^--hostlist-exclude=/.test(arg)), original[index].filter(arg => /^--hostlist-exclude=/.test(arg)), `${file}/${mode}/${index}: preserve existing hostname-less scope without adding a host filter`);
      }
    }
  }
});

test('composition is idempotent and preserves quoted arguments, extra exclusions, and strategy scope', async () => {
  const source = String.raw`start "zapret" "%BIN%winws.exe" --wf-tcp=443 --filter-tcp=443 --hostlist-domains=discord.media --ipset-exclude="%LISTS%ipset-exclude-user.txt" --hostlist-exclude="C:\Чужой список\keep.txt" --dpi-desync-fake-tls="%BIN%fake name.bin" --new --filter-udp=50000-50100 --filter-l7=discord,stun --dpi-desync=fake`;
  const first = await command(source);
  const second = await command('start "zapret" "%BIN%winws.exe" ' + first);
  assert.deepEqual([...splitWindowsCommandLine(second)], [...splitWindowsCommandLine(first)]);
  const [tls, udp] = segments(first);
  assert.ok(tls.includes('--hostlist-exclude=C:\\Чужой список\\keep.txt'));
  assert.ok(tls.includes('--dpi-desync-fake-tls=' + path.win32.join(workDir, 'core', 'bin', 'fake name.bin')));
  assert.ok(udp.includes('--filter-l7=discord,stun'));
  assert.ok(!udp.some(arg => arg.startsWith('--hostlist')));
});

function gameFixture(active = 'service', initial = 'disabled\n') {
  let flag = initial;
  let service = active === 'service';
  let standalone = active === 'standalone';
  const events = [];
  const { ZapretManager } = api({ promises: {
    readFile: async () => { if (flag === null) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return flag; },
    mkdir: async () => {}, writeFile: async (_file, value) => { events.push('write:' + value.trim()); flag = value; },
    unlink: async () => { events.push('remove-flag'); flag = null; },
  } });
  const manager = new ZapretManager('resources', 'app', 'user', workDir);
  manager.ensureProvisioned = async () => {};
  manager.status = async options => {
    assert.equal(options?.force, true, 'runtime readback must bypass cache');
    events.push('status');
    return { serviceRunning: service, standaloneRunning: standalone, serviceReady: service, runtimeReady: service || standalone,
      serviceState: service ? 'RUNNING' : 'STOPPED', serviceProfile: 'Selected', standaloneProfile: 'Selected', currentProfile: 'Selected',
      gameFilterMode: (flag ?? 'disabled').trim(), lastError: null };
  };
  manager.setServiceProfile = async profile => { events.push('service:' + profile); service = true; return manager.status({ force: true }); };
  manager.startService = async () => { events.push('start-service'); service = true; return manager.status({ force: true }); };
  manager.restartStandalone = async profile => { events.push('standalone:' + profile); standalone = true; return manager.status({ force: true }); };
  return { manager, events, flag: () => flag, setStopped: () => { service = false; standalone = false; } };
}

for (const active of ['service', 'standalone']) test(`GameFilter reapplies and verifies the same running ${active} profile`, async () => {
  const fixture = gameFixture(active);
  const result = await fixture.manager.setGameFilterMode('all');
  assert.equal(result.gameFilterMode, 'all');
  assert.ok(fixture.events.includes(`${active}:Selected`));
  assert.equal(fixture.events.at(-1), 'status');
});

test('GameFilter does not start stopped runtime or restart a no-op mode', async () => {
  const stopped = gameFixture('stopped');
  const result = await stopped.manager.setGameFilterMode('udp');
  assert.equal(result.serviceRunning, false);
  assert.equal(result.standaloneRunning, false);
  assert.ok(!stopped.events.some(event => /^(service|standalone|start-service):?/.test(event)));
  const noop = gameFixture('service', 'all\n');
  await noop.manager.setGameFilterMode('all');
  assert.ok(!noop.events.some(event => /^(write|service|standalone):/.test(event)));
});

for (const active of ['service', 'standalone']) test(`GameFilter failure restores flag and active ${active} profile, preserving original error`, async () => {
  const fixture = gameFixture(active, null);
  const method = active === 'service' ? 'setServiceProfile' : 'restartStandalone';
  const normal = fixture.manager[method];
  let attempts = 0;
  fixture.manager[method] = async profile => {
    attempts += 1;
    if (attempts === 1) { fixture.setStopped(); throw new Error('synthetic apply failure'); }
    return normal(profile);
  };
  await assert.rejects(fixture.manager.setGameFilterMode('all'), /synthetic apply failure/);
  assert.equal(fixture.flag(), null, 'restore missing original flag');
  assert.ok(fixture.events.includes(`${active}:Selected`));
  assert.equal(fixture.events.at(-1), 'status', 'forced rollback readback');
  assert.match(fixture.manager.lastError, /synthetic apply failure/);
});

test('GameFilter reports failed rollback verification without losing the original apply error', async () => {
  const fixture = gameFixture('service');
  fixture.manager.setServiceProfile = async () => { fixture.setStopped(); throw new Error('synthetic profile failure'); };
  await assert.rejects(fixture.manager.setGameFilterMode('all'), /synthetic profile failure.*Восстановление/);
  assert.equal(fixture.flag(), 'disabled\n');
});

test('GameFilter unknown runtime state is rejected before writing the mode', async () => {
  const fixture = gameFixture('service');
  fixture.manager.status = async () => ({ serviceState: 'UNKNOWN', serviceRunning: false, standaloneRunning: false });
  await assert.rejects(fixture.manager.setGameFilterMode('all'), /состояние/);
  assert.equal(fixture.flag(), 'disabled\n');
});

test('invalid user list inputs are rejected before any user file write', async () => {
  const writes = [];
  const { ZapretManager } = api({ promises: { mkdir: async () => {}, writeFile: async file => writes.push(file) } });
  const manager = new ZapretManager('resources', 'app', 'user', workDir);
  manager.ensureProvisioned = async () => {};
  await assert.rejects(manager.saveUserLists({ generalDomains: [], includedCidrs: [], excludedDomains: [], excludedCidrs: ['1.2.3.4/33'] }), /Некорректные IP\/CIDR/);
  assert.deepEqual(writes, []);
});

test('failed GameFilter flag readback restores the flag without restarting untouched runtime', async () => {
  const fixture = gameFixture('service');
  fixture.manager.readGameFilterMode = async () => 'disabled';
  await assert.rejects(fixture.manager.setGameFilterMode('all'), /сохранение GameFilter/);
  assert.equal(fixture.flag(), 'disabled\n');
  assert.ok(!fixture.events.some(event => /^(service|standalone|start-service):?/.test(event)));
});

test('failed GameFilter runtime readback restores and verifies the original profile', async () => {
  const fixture = gameFixture('service');
  const normal = fixture.manager.setServiceProfile;
  let attempts = 0;
  fixture.manager.setServiceProfile = async profile => {
    attempts += 1;
    if (attempts === 1) fixture.setStopped();
    else return normal(profile);
    return fixture.manager.status({ force: true });
  };
  await assert.rejects(fixture.manager.setGameFilterMode('all'), /применение GameFilter/);
  assert.equal(attempts, 2);
  assert.equal(fixture.flag(), 'disabled\n');
  assert.equal(fixture.events.at(-1), 'status');
});

test('missing active GameFilter profile is rejected before mutating the flag', async () => {
  const fixture = gameFixture('service');
  const normal = fixture.manager.status;
  fixture.manager.status = async options => ({ ...await normal(options), serviceProfile: null, currentProfile: null });
  await assert.rejects(fixture.manager.setGameFilterMode('all'), /активный профиль/);
  assert.equal(fixture.flag(), 'disabled\n');
});
