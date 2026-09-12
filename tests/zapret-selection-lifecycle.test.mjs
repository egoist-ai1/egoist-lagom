import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { loadRecovered } from './load-recovered.mjs';

function fixture(bindings = {}) {
  const api = loadRecovered('electron/ipc/zapret-manager', {
    path: path.win32, promisify: fn => fn,
    execFile: async () => { throw new Error('Unexpected host command'); },
    spawn: () => { throw new Error('Unexpected host process'); },
    package_default: { version: '3.6.1' }, AbortController, createHash,
    os: { networkInterfaces: () => ({}) },
    logger: { info() {}, warn() {} }, sleep: async () => {},
    resolveWindowsExecutable: name => name,
    psQuote: value => `'${value.replaceAll("'", "''")}'`,
    parseCurlStatusCode: stdout => Number(stdout) || null,
    normalizeCurlProbeError: error => error || 'No response',
    ...bindings,
  }, ['ZapretManager', 'runWithBoundedConcurrency', 'orderZapretProfilesForAutoSelect']);
  const manager = new api.ZapretManager('resources', 'app', 'user', 'C:\\Shield\\zapret');
  return { ...api, manager };
}

function sweepFixture() {
  const { manager } = fixture();
  const events = [];
  let active = null;
  manager.resetOwnedRuntimeBeforeAutoSelect = async () => events.push('prepare');
  manager.ensureProvisioned = async () => {};
  manager.listProfiles = async () => ['General', 'Other'].map(name => ({ name, fileName: name + '.bat' }));
  manager.readAutoSelectMemory = async () => null;
  manager.writeAutoSelectMemory = async () => events.push('remember');
  manager.startProbeStandalone = async name => {
    assert.equal(active, null, 'two candidates cannot overlap');
    active = name;
    events.push('start:' + name);
  };
  manager.listIntegratedWinwsProcesses = async () => active ? [{ pid: 123 }] : [];
  manager.stopProbeStandalone = async () => { events.push('stop:' + active); active = null; };
  manager.probeZapretTargets = async () => ({
    healthy: true, confident: true, averagePingMs: 10,
    targets: ['DiscordMain', 'DiscordGateway', 'YouTubeWeb', 'YouTubeImage'].map(key => ({ key, ok: true, pingMs: 10 })),
  });
  return { manager, events };
}

test('HTTP errors cannot pass endpoint checks; curl ignores inherited proxies and config', async () => {
  for (const code of [200, 204, 403, 404, 429, 503]) {
    const { manager } = fixture({ execFile: async (_exe, args, options) => {
      assert.equal(args[0], '-q');
      assert.equal(args[args.indexOf('--noproxy') + 1], '*');
      assert.ok(options.timeout <= 9000);
      assert.ok(args.includes('--max-redirs'));
      return { stdout: String(code), stderr: '' };
    } });
    const result = await manager.probeCurlHeadUrl('https://example.test', 4000, 'HTTP', []);
    assert.equal(result.ok, code < 400, String(code));
  }
});

test('image/CDN and DNS reachability alone cannot produce a usable profile', () => {
  const { manager } = fixture();
  assert.equal(manager.isZapretProbeHealthy([
    { key: 'DiscordCDN', ok: true }, { key: 'YouTubeImage', ok: true }, { key: 'GoogleDNS8888', ok: true },
  ]), false);
  const keys = ['DiscordMain', 'DiscordGateway', 'YouTubeWeb', 'YouTubeImage'];
  assert.equal(manager.isZapretProbeHealthy(keys.map(key => ({ key, ok: true }))), true);
  for (const absent of keys) assert.equal(manager.isZapretProbeHealthy(keys.filter(key => key !== absent).map(key => ({ key, ok: true }))), false);
});

test('ownership requires exact executable identity, not a command-line reference or neighbouring folder', async () => {
  const { manager } = fixture();
  const own = { pid: 10, executablePath: 'c:\\shield\\ZAPRET\\core\\bin\\winws.exe' };
  manager.listWinwsProcesses = async () => [own,
    { pid: 11, executablePath: 'C:\\other\\winws.exe', commandLine: 'C:\\Shield\\zapret' },
    { pid: 12, executablePath: 'C:\\Shield\\zapret-copy\\core\\bin\\winws.exe' },
    { pid: 13, commandLine: 'C:\\Shield\\zapret\\core\\bin\\winws.exe' },
  ];
  assert.deepEqual(Array.from(await manager.listIntegratedWinwsProcesses()), [own]);
});

test('standalone cleanup ignores a recycled PID in its saved state', async () => {
  const { manager } = fixture();
  manager.queryService = async () => ({ running: false });
  manager.readStandaloneState = async () => ({ pid: 9876 });
  manager.listIntegratedWinwsProcesses = async () => [];
  let cleared = false;
  manager.clearStandaloneState = async () => { cleared = true; };
  manager.execPowerShell = async () => { throw new Error('Must not kill a stale saved PID'); };
  await manager.stopStandaloneInternal(true);
  assert.equal(cleared, true);
});

test('an unkillable owned process aborts cleanup without clearing recovery state', async () => {
  const { manager } = fixture();
  manager.listIntegratedWinwsProcesses = async () => [{ pid: 123 }];
  const commands = [];
  manager.execPowerShell = async command => commands.push(command);
  await assert.rejects(manager.stopOwnedWinwsProcesses(0), /Новый кандидат не запущен/);
  assert.match(commands[0], /ExecutablePath -ieq/);
  assert.doesNotMatch(commands[0], /taskkill|\/IM|\/T/);
});

test('external conflict detection rejects without deleting a host service', async () => {
  const { manager } = fixture();
  manager.queryService = async name => ({ running: name === 'GoodbyeDPI' });
  manager.execSc = async () => { throw new Error('Must not change external services'); };
  await assert.rejects(manager.resetOwnedRuntimeBeforeAutoSelect(), /GoodbyeDPI/);
  await manager.cleanupDriverServicesIfSafe();
});

test('unavailable process inventory is a failure, not evidence that all processes stopped', async () => {
  const { manager } = fixture();
  manager.execPowerShell = async () => { throw new Error('CIM access denied'); };
  await assert.rejects(manager.listWinwsProcesses(), /CIM access denied/);
});

test('auto-select stops its candidate before completion and reports a truthful early exit', async () => {
  const { manager, events } = sweepFixture();
  const progress = [];
  const result = await manager.autoSelectBestProfile(event => progress.push(event));
  assert.equal(result.bestProfile, 'General');
  assert.equal(result.earlyExit, true);
  assert.equal(result.videoPlaybackVerified, false);
  assert.equal(result.totalProfiles, 2);
  assert.equal(result.testedProfiles.length, 1);
  assert.ok(events.indexOf('stop:General') < events.indexOf('remember'));
  assert.equal(progress.at(-1).phase, 'complete');
  assert.equal(progress.at(-1).earlyExit, true);
  assert.equal(manager.autoSelectController, null);
});

test('auto-select does not advance or save a winner after cleanup failure', async () => {
  const { manager, events } = sweepFixture();
  manager.stopProbeStandalone = async () => { throw new Error('owned process still running'); };
  await assert.rejects(manager.autoSelectBestProfile(), /owned process still running/);
  assert.deepEqual(events, ['prepare', 'start:General']);
  assert.equal(manager.autoSelectController, null);
  assert.equal(manager.probeProfiles, null);
});

test('cancel during a pending start never launches another candidate or retains a winner', async () => {
  const { manager, events } = sweepFixture();
  const start = manager.startProbeStandalone;
  manager.startProbeStandalone = async name => { await manager.cancelAutoSelect(); await start(name); };
  const result = await manager.autoSelectBestProfile();
  assert.equal(result.cancelled, true);
  assert.equal(result.completed, false);
  assert.equal(result.bestProfile, null);
  assert.equal(events.includes('start:Other'), false);
  assert.equal(events.includes('stop:General'), true);
  assert.equal(events.includes('remember'), false);
});

test('a process that exits during HTTPS checks cannot be selected', async () => {
  const { manager } = sweepFixture();
  manager.listIntegratedWinwsProcesses = async () => [];
  const result = await manager.autoSelectBestProfile();
  assert.equal(result.bestProfile, null);
  assert.equal(result.results.length, 2);
  assert.ok(result.results.every(row => row.result === 'error'));
});

test('renderer callback and memory read failures cannot leave the selection lock stuck', async () => {
  const { manager } = sweepFixture();
  await manager.autoSelectBestProfile(() => { throw new Error('renderer destroyed'); });
  assert.equal(manager.autoSelectController, null);
  manager.readAutoSelectMemory = async () => { throw new Error('memory unreadable'); };
  await assert.rejects(manager.autoSelectBestProfile(), /memory unreadable/);
  assert.equal(manager.autoSelectController, null);
  assert.equal(manager.probeProfiles, null);
});

test('endpoint probe concurrency is bounded and preserves input order', async () => {
  const { runWithBoundedConcurrency } = fixture();
  let active = 0, maximum = 0;
  const output = await runWithBoundedConcurrency(Array.from({ length: 35 }, (_, i) => i), 8, async value => {
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, value % 3));
    active--;
    return value;
  });
  assert.equal(maximum, 8);
  assert.deepEqual(Array.from(output), Array.from({ length: 35 }, (_, i) => i));
});

test('spawn error is consumed and rejected, without an unhandled EventEmitter error', async () => {
  const child = new EventEmitter();
  const { manager } = fixture({
    spawn: () => { queueMicrotask(() => child.emit('error', new Error('driver executable missing'))); return child; },
    splitWindowsCommandLine: () => [],
  });
  manager.listIntegratedWinwsProcesses = async () => [];
  manager.buildServiceCommand = async () => ({ profile: { name: 'General' }, args: '', winwsPath: 'mock.exe' });
  manager.writeStandaloneState = async () => {};
  await assert.rejects(manager.startProbeStandalone('General'), /driver executable missing/);
});

test('explicit disconnect disables autostart while internal suspension preserves startup policy', async () => {
  const { manager } = fixture();
  const commands = [];
  manager.queryService = async () => ({ installed: true, running: false });
  manager.execSc = async args => commands.push(Array.from(args));
  manager.stopOwnedWinwsProcesses = async () => {};
  manager.status = async () => ({ serviceRunning: false });
  await manager.stopServiceInternal(true);
  assert.deepEqual(commands, []);
  await manager.stopService();
  assert.deepEqual(commands, [['config', 'EgoistShieldZapret', 'start=', 'disabled']]);
});

test('starting a service enables autostart and requires its winws child before reporting success', async () => {
  for (const childAlive of [true, false]) {
    const { manager } = fixture();
    const events = [];
    manager.ensureProvisioned = async () => {};
    manager.assertNoExternalConflict = async () => {};
    manager.queryService = async () => ({ installed: true, running: false });
    manager.prepareStandaloneForServiceStart = async () => async () => events.push('restore');
    manager.stopStaleWinwsBeforeServiceStart = async () => {};
    manager.execSc = async args => events.push(Array.from(args).join(' '));
    manager.startWrappedService = async () => events.push('start');
    manager.waitForServiceState = async () => events.push('scm-running');
    manager.waitForIntegratedWinwsStart = async () => childAlive;
    manager.stopServiceInternal = async () => events.push('stop');
    manager.stopOwnedWinwsProcesses = async () => events.push('cleanup');
    manager.status = async () => ({ serviceRunning: true, winwsRunning: true });
    if (childAlive) {
      assert.equal((await manager.startService()).winwsRunning, true);
      assert.equal(events.includes('stop'), false);
    } else {
      await assert.rejects(manager.startService(), /winws.exe не работает/);
      assert.ok(events.includes('config EgoistShieldZapret start= disabled'));
      assert.ok(events.includes('stop'));
      assert.ok(events.includes('cleanup'));
    }
    assert.ok(events.indexOf('config EgoistShieldZapret start= auto') < events.indexOf('start'));
  }
});
