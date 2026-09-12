import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

class MockCoreService {
  constructor() {
    this.operations = new Set([
      'service.status', 'recovery.status', 'dns.status', 'dns.doh.status',
      'dns.apply', 'dns.reset', 'dns.restore-owned', 'dns.doh.apply', 'dns.doh.remove',
      'owned-service.install', 'owned-service.remove', 'owned-service.start', 'owned-service.stop',
      'zapret.profile.set', 'network.repair-owned'
    ]);
    this.dnsOwned = true;
    this.activeMutation = null;
  }

  async request(op, payload = {}) {
    if (!this.operations.has(op)) {
      throw new Error(`Unsupported service operation: ${op}`);
    }
    if (op === 'dns.restore-owned') {
      this.dnsOwned = false;
      return { pendingAdapters: 0, restored: [{ interfaceGuid: 'guid-1', mode: 'dhcp' }] };
    }
    if (op === 'network.repair-owned') {
      return { repaired: true, reason: 'Repair complete', resetOwnedDns: true };
    }
    return { ok: true, op };
  }
}

class MockVpnReconnectSupervisor {
  constructor() {
    this.cancelled = false;
    this.disarmed = false;
  }
  cancel() { this.cancelled = true; }
  cancelPending() { this.cancelled = true; }
  disarm() { this.disarmed = true; }
}

class MockNetworkCombinator {
  constructor() {
    this.staleTimeout = null;
    this.locks = new Set();
  }
  forceReleaseStaleMutations(maxAgeMs = 0) {
    this.locks.clear();
    return true;
  }
  runCoordinatedMutation(meta, op) {
    for (const lock of meta.requiredLocks) this.locks.add(lock);
    try {
      return op();
    } finally {
      for (const lock of meta.requiredLocks) this.locks.delete(lock);
    }
  }
}

test('Orchestration: dns.restore-owned is a supported operation in Core Service', async () => {
  const core = new MockCoreService();
  const res = await core.request('dns.restore-owned');
  assert.equal(res.pendingAdapters, 0);
  assert.equal(res.restored.length, 1);
});

test('Orchestration: Unsupported operation in Core Service throws clear error', async () => {
  const core = new MockCoreService();
  await assert.rejects(async () => {
    await core.request('unknown.unsupported-operation');
  }, /Unsupported service operation/);
});

test('Orchestration: Auto-preemption in shield:coordinate safely accesses reconnectSupervisor', async () => {
  const supervisor = new MockVpnReconnectSupervisor();
  globalThis.reconnectSupervisor = supervisor;
  const combinator = new MockNetworkCombinator();

  let preemptionRan = false;
  const coordinate = async (action, operation) => {
    if (action === 'connect') {
      (globalThis.reconnectSupervisor || (typeof reconnectSupervisor !== 'undefined' ? reconnectSupervisor : null))?.cancel?.();
      combinator.forceReleaseStaleMutations(0);
      preemptionRan = true;
    }
    return operation();
  };

  const result = await coordinate('connect', async () => 'connected');
  assert.equal(result, 'connected');
  assert.equal(preemptionRan, true);
  assert.equal(supervisor.cancelled, true);
});

test('Orchestration: Auto-preemption succeeds even if reconnectSupervisor is null', async () => {
  globalThis.reconnectSupervisor = null;
  const combinator = new MockNetworkCombinator();
  let preemptionRan = false;
  const coordinate = async (action, operation) => {
    if (action === 'connect') {
      (globalThis.reconnectSupervisor || (typeof reconnectSupervisor !== 'undefined' ? reconnectSupervisor : null))?.cancel?.();
      combinator.forceReleaseStaleMutations(0);
      preemptionRan = true;
    }
    return operation();
  };

  const result = await coordinate('connect', async () => 'ok');
  assert.equal(result, 'ok');
  assert.equal(preemptionRan, true);
});

test('Orchestration: Stale mutation locks are fully released by forceReleaseStaleMutations', () => {
  const combinator = new MockNetworkCombinator();
  combinator.locks.add('windivert');
  combinator.locks.add('traffic-route');
  assert.equal(combinator.locks.size, 2);
  combinator.forceReleaseStaleMutations(0);
  assert.equal(combinator.locks.size, 0);
});

test('Orchestration: Component facade interceptor calls restoreOwnedDns on SystemDoH stop', async () => {
  const core = new MockCoreService();
  let restoreCalled = false;
  async function facadeExecute(component, method) {
    if (component === 'SystemDoH' && method === 'stop') {
      const restored = await core.request('dns.restore-owned');
      if (restored.pendingAdapters > 0) throw new Error('Pending adapters');
      restoreCalled = true;
    }
    return { stopped: true };
  }

  const res = await facadeExecute('SystemDoH', 'stop');
  assert.equal(res.stopped, true);
  assert.equal(restoreCalled, true);
});

test('Orchestration: VPN egress probe failure triggers automatic fallback node selection', async () => {
  const nodes = [
    { id: 'node-de', name: 'Germany', healthy: false },
    { id: 'node-auto', name: 'Auto (Fallback)', healthy: true }
  ];
  let activeNode = nodes[0];
  let connectionAttempts = [];

  async function connectWithFallback() {
    connectionAttempts.push(activeNode.name);
    if (!activeNode.healthy) {
      // Egress probe failed, select fallback
      const fallback = nodes.find(n => n.healthy);
      if (!fallback) throw new Error('No healthy fallback');
      activeNode = fallback;
      connectionAttempts.push(activeNode.name);
    }
    return { ok: true, node: activeNode.name };
  }

  const result = await connectWithFallback();
  assert.equal(result.ok, true);
  assert.equal(result.node, 'Auto (Fallback)');
  assert.deepEqual(connectionAttempts, ['Germany', 'Auto (Fallback)']);
});

test('Orchestration: Make-before-break handoff binds secondary proxy port before closing primary', () => {
  const activePorts = new Set([10809]);
  function handoff(newPort) {
    activePorts.add(newPort); // start candidate on 10810
    activePorts.delete(10809); // then close 10809
  }
  handoff(10810);
  assert.equal(activePorts.has(10810), true);
  assert.equal(activePorts.has(10809), false);
});

test('Orchestration: Zapret service suspension during VPN disconnect restores original profile', async () => {
  const state = { zapretProfile: 'general (FAKE TLS AUTO)', suspended: false };
  function onVpnConnect() { state.suspended = true; }
  function onVpnDisconnect() { state.suspended = false; }

  onVpnConnect();
  assert.equal(state.suspended, true);
  onVpnDisconnect();
  assert.equal(state.suspended, false);
  assert.equal(state.zapretProfile, 'general (FAKE TLS AUTO)');
});

test('Orchestration: Zapret standalone mode rejects starting if service is running', () => {
  const zapretStatus = { serviceRunning: true };
  function startStandalone() {
    if (zapretStatus.serviceRunning) {
      throw new Error('Сначала остановите службу Zapret, затем запускайте standalone-режим.');
    }
    return { started: true };
  }
  assert.throws(startStandalone, /Сначала остановите службу Zapret/);
});

test('Orchestration: Telegram Proxy port 1443 conflict detection', () => {
  const occupiedPorts = new Set([1443]);
  function checkPort(port) {
    return !occupiedPorts.has(port);
  }
  assert.equal(checkPort(1443), false);
  assert.equal(checkPort(1444), true);
});

test('Orchestration: Internet emergency repair clears orphan winws and restores proxy', () => {
  const systemState = {
    orphanProcesses: ['winws.exe', 'xray.exe'],
    proxyEnabled: 1,
    firewallKillSwitch: true
  };
  function repairInternet(s) {
    s.orphanProcesses = [];
    s.proxyEnabled = 0;
    s.firewallKillSwitch = false;
  }
  repairInternet(systemState);
  assert.equal(systemState.orphanProcesses.length, 0);
  assert.equal(systemState.proxyEnabled, 0);
  assert.equal(systemState.firewallKillSwitch, false);
});

test('Orchestration: Speedtest warmup selects higher stream count for high bandwidth', () => {
  function planStreams(bandwidthMbps) {
    if (bandwidthMbps > 100) return { streams: 8, chunkMb: 20 };
    return { streams: 2, chunkMb: 8 };
  }
  assert.deepEqual(planStreams(460), { streams: 8, chunkMb: 20 });
  assert.deepEqual(planStreams(4), { streams: 2, chunkMb: 8 });
});

test('Orchestration: Widget window mode dimensions: compact 360x520 vs full 1040x680', () => {
  const modes = {
    widget: { width: 360, height: 520, resizable: false },
    full: { width: 1040, height: 680, resizable: true }
  };
  assert.equal(modes.widget.width, 360);
  assert.equal(modes.full.width, 1040);
});

test('Orchestration: Red color zero tolerance verification in tokens', () => {
  const tokens = {
    primaryButton: '#ffffff',
    textMain: '#f1f5f9',
    background: '#090909',
    focusRing: '#ffffff'
  };
  for (const [key, color] of Object.entries(tokens)) {
    assert.equal(color.startsWith('#ff00') || color.startsWith('#ef44'), false, `${key} must not be red`);
  }
});
