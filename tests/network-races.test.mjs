import assert from 'node:assert/strict';
import test from 'node:test';
import * as crypto from 'node:crypto';
import { loadRecovered } from './load-recovered.mjs';

const subscriptionUtilsFetches = [];
const parserUtils = loadRecovered('electron/ipc/parsers/parser-utils', {
  randomUUID: crypto.randomUUID,
  normalizeDisplayText: value => String(value ?? '')
}, ['buildNodeFingerprint']);
const subscriptionUtils = loadRecovered('electron/ipc/subscription-utils', {
  buildNodeFingerprint: parserUtils.buildNodeFingerprint,
  randomUUID: crypto.randomUUID,
  createHash: crypto.createHash,
  hostname: () => 'test-host',
  promisify: () => () => {},
  execFile: () => {},
  redactUrlForLog: value => value,
  log: { info() {}, warn() {}, error() {} },
  fetchTextWithRetry: async (_url, options) => {
    subscriptionUtilsFetches.push(options);
    return {
      response: { headers: { get: () => null } },
      text: 'vless://uuid@example.test:443',
      attempts: 1,
      elapsedMs: 1
    };
  },
  parseNodesFromText: () => ({ nodes: [{}], issues: [] }),
  isLikelyUnsupportedPlaceholderText: () => false,
  getNetworkErrorDetails: () => ({ kind: 'network', message: 'test' })
}, ['preserveNodeIdentities', 'uniqueNodes', 'readUrlText']);
const importUtils = loadRecovered('electron/ipc/handlers-import', {
  crypto,
  promisify: () => () => {},
  execFile: () => {},
  buildNodeFingerprint: parserUtils.buildNodeFingerprint,
  preserveNodeIdentities: subscriptionUtils.preserveNodeIdentities,
  uniqueNodes: subscriptionUtils.uniqueNodes
}, ['mergeImportResults', 'mergeSubscriptionRefresh']);

function node(id, server, subscriptionId = 'sub-1', name = server) {
  return {
    id,
    name,
    protocol: 'vless',
    server,
    port: 443,
    subscriptionId,
    metadata: { id: `uuid-${server}` }
  };
}

test('network mutations wait for a steady VPN traffic route, while VPN disconnect can release its own proxy', async () => {
  const { NetworkCombinatorManager } = loadRecovered('electron/ipc/network-combinator-manager', {
    buildNetworkCombinatorInspection: ({ modules, admin }) => ({
      modules,
      admin,
      activeLocks: [...new Set(modules.flatMap(item => item.ownedLocks ?? []))],
      activeMutations: []
    }),
    buildNetworkCombinatorPlan: () => ({})
  }, ['NetworkCombinatorManager']);
  let vpnActive = true;
  const manager = new NetworkCombinatorManager({
    isElevated: async () => true,
    moduleInspectors: {
      vpn: async () => ({
        ownedLocks: vpnActive ? ['traffic-route', 'system-proxy'] : [],
        activeMutations: vpnActive ? ['runtime:xray'] : []
      })
    }
  });
  let dnsCalled = false;
  await assert.rejects(
    manager.runCoordinatedMutation({
      module: 'dns', action: 'apply', requiredLocks: ['dns'], conflictsWith: ['traffic-route'], waitTimeoutMs: 35
    }, async () => { dnsCalled = true; }),
    /Timed out waiting for a safe network mutation slot/
  );
  assert.equal(dnsCalled, false);

  let disconnected = false;
  const result = await manager.runCoordinatedMutation({
    module: 'vpn', action: 'disconnect', requiredLocks: ['traffic-route'], conflictsWith: ['packet-interception'], waitTimeoutMs: 100
  }, async () => {
    disconnected = true;
    vpnActive = false;
    return 'disconnected';
  });
  assert.equal(disconnected, true);
  assert.equal(result, 'disconnected');
});

test('refresh merge keeps a user deletion and explicit deselection made while the request was pending', () => {
  const subscription = { id: 'sub-1', url: 'https://example.test/sub', name: 'Original', enabled: true };
  const startedNode = node('node-a', 'a.example');
  const started = { subscriptions: [subscription], nodes: [startedNode], activeNodeId: 'node-a' };
  const latest = { subscriptions: [], nodes: [], activeNodeId: null };
  const incoming = node('fresh-id', 'a.example', undefined, 'Fresh');
  const merged = importUtils.mergeSubscriptionRefresh(latest, started, subscription, [incoming], { name: 'Remote' });
  assert.deepEqual(JSON.parse(JSON.stringify(merged.next)), latest);
  assert.equal(merged.added, 0);
});

test('import merge does not resurrect a subscription deleted while its network fetch was pending', () => {
  const subscription = { id: 'sub-1', url: 'https://example.test/sub', name: 'Original', enabled: true };
  const startedNode = node('node-a', 'a.example');
  const started = { subscriptions: [subscription], nodes: [startedNode], activeNodeId: 'node-a' };
  const latest = { subscriptions: [], nodes: [], activeNodeId: null };
  const imported = { ...node('fresh-id', 'b.example'), sourceSubscriptionUrl: subscription.url };
  const merged = importUtils.mergeImportResults(latest, [imported], [], [subscription], started);
  assert.deepEqual(JSON.parse(JSON.stringify(merged.next)), latest);
  assert.equal(merged.result.added, 0);
  assert.equal(merged.result.subscriptionsAdded, 0);
});

test('subscription requests omit HWID unless the user opted in', async () => {
  subscriptionUtilsFetches.length = 0;
  await subscriptionUtils.readUrlText('https://example.test/sub', 'egoistshield', false);
  assert.equal(subscriptionUtilsFetches.length, 1);
  assert.equal('X-HWID' in subscriptionUtilsFetches[0].headers, false);
  await subscriptionUtils.readUrlText('https://example.test/sub', 'egoistshield', true);
  assert.equal(subscriptionUtilsFetches.length, 2);
  assert.match(subscriptionUtilsFetches[1].headers['X-HWID'], /^[0-9a-f-]{16,}$/i);
});
