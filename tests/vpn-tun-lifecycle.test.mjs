import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';
import { loadRecovered, officialBaselineAvailable } from './load-recovered.mjs';

class RuntimeInstaller {
  constructor() {}
}

class KillSwitch {
  isActive() { return false; }
}

function loadVpnRuntimeManager({ baseline = false, platform = process.platform, bindings = {} } = {}) {
  const previousBaseline = process.env.SHIELD_BASELINE;
  if (baseline) process.env.SHIELD_BASELINE = '1';
  else delete process.env.SHIELD_BASELINE;
  try {
    const runtimeProcess = { env: process.env, platform, execPath: process.execPath };
    return loadRecovered('electron/ipc/vpn-manager', {
      EventEmitter,
      promisify,
      execFile: () => {},
      RuntimeInstaller,
      KillSwitch,
      path,
      promises: fs,
      process: runtimeProcess,
      formatRuntimeLogEvent: (event) => JSON.stringify(event),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      XRAY_NATIVE_TUN_MIN_VERSION: 'v26.5.3',
      XRAY_PLAN: { exeName: 'xray.exe' },
      readVersionFile: async () => null,
      compareLooseVersions: () => 0,
      ...bindings
    }, ['VpnRuntimeManager']).VpnRuntimeManager;
  } finally {
    if (previousBaseline === undefined) delete process.env.SHIELD_BASELINE;
    else process.env.SHIELD_BASELINE = previousBaseline;
  }
}

function installActiveSession(manager, { useTunMode, generation = 1 } = {}) {
  const session = {
    process: { exitCode: null, killed: false, pid: null },
    processGeneration: generation,
    startedAt: '2026-09-08T12:00:00.000Z',
    proxyPort: 10809,
    socksPort: 10808,
    apiPort: 10085,
    configPath: null,
    nodeId: 'previous-node',
    activeRuntimePath: 'mock',
    runtimeKind: 'xray',
    processRulesApplied: false
  };
  manager.applyActiveSession(session);
  manager.lastSettings = { useTunMode };
  manager.status = async () => ({ connected: manager.getActiveSession() !== null });
  return session;
}

function preparedConnection() {
  return { session: { processGeneration: 2 } };
}

async function runReplacement(VpnRuntimeManager, options = {}) {
  const manager = new VpnRuntimeManager('.', '.');
  const events = [];
  const previousSession = installActiveSession(manager, {
    useTunMode: options.previousTun ?? true
  });
  manager.flushRetiringSessions = async () => events.push('flush');
  manager.terminateSession = async (session, cleanup) => events.push({ type: 'terminate', generation: session.processGeneration, cleanup });
  let prepareAttempts = 0;
  manager.prepareConnection = async () => {
    const previousStillActive = manager.getActiveSession()?.processGeneration === previousSession.processGeneration;
    events.push({ type: 'prepare', previousStillActive, attempt: ++prepareAttempts });
    if (options.requireNoActiveBeforePrepare && previousStillActive) {
      throw new Error('old active TUN was still present during preparation');
    }
    if (options.retryableTunRouteFailure && (prepareAttempts === 1 || options.alwaysFailRoute)) return {
      retryableTunRouteInitializationFailure: true,
      details: 'proxy/tun: unable to set routes > Element not found.'
    };
    if (options.failPrepare) return null;
    return preparedConnection();
  };
  manager.activatePreparedConnection = async (_prepared, previous) => {
    if (_prepared.retryableTunRouteInitializationFailure) throw new Error('route initialization failure was not retried');
    events.push({ type: 'activate', previous });
    return manager.status();
  };
  manager.releaseNetworkOwnershipAfterLoss = async () => events.push('release-network-ownership');
  manager.setFailure = (reason, details) => events.push({ type: 'failure', reason, details });
  const result = await manager._connect({ id: 'next-node', protocol: 'vless' }, [], [], {
    useTunMode: options.nextTun ?? true
  });
  return { events, previousSession, result };
}

test('serializes a previous TUN session before preparing its replacement (baseline fails)', async () => {
  if (officialBaselineAvailable()) {
    const BaselineVpnRuntimeManager = loadVpnRuntimeManager({ baseline: true });
    await assert.rejects(
      runReplacement(BaselineVpnRuntimeManager, { requireNoActiveBeforePrepare: true }),
      /old active TUN was still present during preparation/
    );
  }

  const VpnRuntimeManager = loadVpnRuntimeManager();
  const { events, previousSession } = await runReplacement(VpnRuntimeManager, { requireNoActiveBeforePrepare: true });
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [
    'flush',
    {
      type: 'terminate',
      generation: previousSession.processGeneration,
      cleanup: { disableSystemProxy: false, clearKillSwitch: false }
    },
    { type: 'prepare', previousStillActive: false, attempt: 1 },
    { type: 'activate', previous: null }
  ]);
});

test('keeps make-before-break handoff for proxy sessions, including proxy to TUN', async () => {
  const VpnRuntimeManager = loadVpnRuntimeManager();
  const { events, previousSession } = await runReplacement(VpnRuntimeManager, {
    previousTun: false,
    nextTun: true
  });
  assert.equal(events.some((event) => event === 'flush' || event.type === 'terminate'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(events[0])), { type: 'prepare', previousStillActive: true, attempt: 1 });
  assert.equal(events[1].type, 'activate');
  assert.equal(events[1].previous.processGeneration, previousSession.processGeneration);
});

test('failed serial TUN replacement releases dead proxy ownership', async () => {
  const VpnRuntimeManager = loadVpnRuntimeManager();
  const { events } = await runReplacement(VpnRuntimeManager, { failPrepare: true });
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [
    'flush',
    {
      type: 'terminate',
      generation: 1,
      cleanup: { disableSystemProxy: false, clearKillSwitch: false }
    },
    { type: 'prepare', previousStillActive: false, attempt: 1 },
    'release-network-ownership'
  ]);
});

test('retries the recorded Windows Xray TUN route failure once after serial cleanup (baseline fails)', async () => {
  if (officialBaselineAvailable()) {
    const BaselineVpnRuntimeManager = loadVpnRuntimeManager({ baseline: true });
    await assert.rejects(
      runReplacement(BaselineVpnRuntimeManager, { retryableTunRouteFailure: true }),
      /route initialization failure was not retried/
    );
  }

  const VpnRuntimeManager = loadVpnRuntimeManager();
  const { events, previousSession } = await runReplacement(VpnRuntimeManager, { retryableTunRouteFailure: true });
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [
    'flush',
    {
      type: 'terminate',
      generation: previousSession.processGeneration,
      cleanup: { disableSystemProxy: false, clearKillSwitch: false }
    },
    { type: 'prepare', previousStillActive: false, attempt: 1 },
    { type: 'prepare', previousStillActive: false, attempt: 2 },
    { type: 'activate', previous: null }
  ]);
});

test('stops after the second TUN route failure and releases network ownership', async () => {
  const { events, result } = await runReplacement(loadVpnRuntimeManager(), {
    retryableTunRouteFailure: true,
    alwaysFailRoute: true
  });
  assert.equal(events.filter(event => event?.type === 'prepare').length, 2);
  assert.equal(events.some(event => event?.type === 'activate'), false);
  assert.equal(events.at(-2), 'release-network-ownership');
  assert.equal(events.at(-1).reason, 'runtime_start_failed');
  assert.equal(result.connected, false);
});

test('recognizes only the recorded Windows Xray TUN route initialization failure and skips generic fallback', async () => {
  let child;
  const VpnRuntimeManager = loadVpnRuntimeManager({
    platform: 'win32',
    bindings: {
      os: { tmpdir: () => '.' },
      randomUUID: () => 'route-startup-failure',
      findAvailablePort: async () => 20000,
      ConfigBuilder: { buildXray: () => '{}' },
      buildProtocolRuntimePlan: () => ({
        preferredRuntime: 'xray',
        fallbackRuntime: null,
        processRulesReason: 'test',
        visibleWarnings: []
      }),
      spawn: () => {
        child = new EventEmitter();
        child.pid = 200;
        child.exitCode = null;
        child.killed = false;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => { child.killed = true; child.exitCode ??= 1; };
        return child;
      },
      spawnSync: () => ({}),
      waitForPort: async () => {
        child.stderr.emit('data', Buffer.from('Failed to start: main: failed to create server > proxy/tun: unable to set routes > Element not found.'));
        child.exitCode = 1;
        child.emit('exit', 1, null);
        return false;
      },
      promises: {
        mkdir: async () => {},
        writeFile: async () => {},
        rm: async () => {},
        access: async () => {}
      }
    }
  });
  const manager = new VpnRuntimeManager('.', '.');
  const events = [];
  manager.isAdmin = async () => true;
  manager.resolveRuntimePath = async () => ({ runtimeKind: 'xray', runtimePath: 'xray.exe' });
  manager.resolveXrayTunRuntime = async (_configuredPath, runtime) => ({ ok: true, runtime });
  manager.terminateSession = async (_session, cleanup) => events.push({ type: 'terminate', cleanup });
  manager.prepareFallbackConnection = async () => {
    events.push('generic-fallback');
    return null;
  };
  manager.setFailure = () => events.push('failure');

  const result = await manager.prepareConnection({ id: 'xhttp-node', protocol: 'vless', metadata: { type: 'xhttp' } }, [], [], {
    useTunMode: true,
    routeMode: 'global',
    dnsMode: 'secure',
    runtimePath: ''
  });

  assert.equal(result.retryableTunRouteInitializationFailure, true);
  assert.match(result.details, /proxy\/tun: unable to set routes > Element not found/i);
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [{
    type: 'terminate',
    cleanup: { disableSystemProxy: false, clearKillSwitch: false }
  }]);
});
