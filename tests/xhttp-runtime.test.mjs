import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRecovered } from './load-recovered.mjs';

const { ConfigBuilder } = loadRecovered('electron/ipc/config-builder', {
  parseCustomDnsUrl: value => ({ url: value }),
}, ['ConfigBuilder']);
const { buildProtocolRuntimePlan } = loadRecovered('shared/protocol-matrix', {}, ['buildProtocolRuntimePlan']);

const xhttpNode = {
  id: 'xhttp-node',
  protocol: 'vless',
  server: '127.0.0.1',
  port: 443,
  metadata: {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'xhttp',
    security: 'reality',
    sni: 'example.com',
    pbk: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    sid: 'abcd',
    path: '/edge',
    host: 'cdn.example.com',
    mode: 'packet-up'
  }
};
const baseSettings = {
  dnsMode: 'system',
  customDnsUrl: '',
  routeMode: 'global',
  useTunMode: false
};

test('XHTTP VLESS remains an Xray config without invented Vision flow', () => {
  const config = JSON.parse(ConfigBuilder.buildXray(xhttpNode, [], baseSettings, 10809, 10808, 10085));
  const stream = config.outbounds.find(rule => rule.tag === 'proxy').streamSettings;
  const user = config.outbounds.find(rule => rule.tag === 'proxy').settings.vnext[0].users[0];
  assert.equal(stream.network, 'xhttp');
  assert.deepEqual(stream.xhttpSettings, { path: '/edge', host: 'cdn.example.com', mode: 'packet-up' });
  assert.equal(user.flow, undefined);
  assert.equal(stream.realitySettings.alpn, undefined);
  assert.equal(config.inbounds.some(inbound => inbound.protocol === 'tun'), false);
});

test('XHTTP and SplitHTTP keep their transport metadata and use the HTTP ALPN default', () => {
  for (const type of ['xhttp', 'splithttp']) {
    const node = structuredClone(xhttpNode);
    node.metadata.type = type;
    node.metadata.security = 'tls';
    delete node.metadata.mode;
    const config = JSON.parse(ConfigBuilder.buildXray(node, [], baseSettings, 10809, 10808, 10085));
    const stream = config.outbounds.find(rule => rule.tag === 'proxy').streamSettings;
    assert.equal(stream.network, type);
    assert.deepEqual(stream.xhttpSettings, { path: '/edge', host: 'cdn.example.com', mode: 'auto' });
    assert.deepEqual(stream.tlsSettings.alpn, ['h2', 'http/1.1']);
  }
});

test('sing-box rejects XHTTP instead of silently using another transport', () => {
  assert.throws(() => ConfigBuilder.buildSingBox(xhttpNode, [], [], baseSettings, 10809), /sing-box does not support xhttp transport; use Xray/);
});

test('XHTTP requires Xray even when TUN and learned health prefer sing-box', () => {
  const plan = buildProtocolRuntimePlan({
    protocol: 'vless',
    transportType: 'splithttp',
    useTunMode: true,
    processRuleCount: 2,
    learnedRuntimePreference: 'sing-box'
  });
  assert.equal(plan.preferredRuntime, 'xray');
  assert.equal(plan.fallbackRuntime, null);
  assert.equal(plan.reason, 'transport-required');
});

test('Xray TUN config applies process rules before domain rules', () => {
  const config = JSON.parse(ConfigBuilder.buildXray(
    xhttpNode,
    [{ domain: 'example.org', mode: 'vpn' }],
    { ...baseSettings, useTunMode: true },
    10809,
    10808,
    10085,
    [
      { process: 'vpn.exe', mode: 'vpn' },
      { process: 'blocked.exe', mode: 'block' },
      { process: 'direct.exe', mode: 'direct' }
    ]
  ));
  const tun = config.inbounds.find(inbound => inbound.protocol === 'tun');
  assert.deepEqual(tun.settings, {
    name: 'egoist-tun',
    mtu: 1500,
    gateway: ['172.19.0.1/30', 'fd00:198:18::1/126'],
    dns: ['1.1.1.1'],
    autoSystemRoutingTable: ['0.0.0.0/0', '::/0'],
    autoOutboundsInterface: 'auto'
  });
  assert.deepEqual(tun.sniffing, {
    enabled: true,
    destOverride: ['http', 'tls', 'quic'],
    routeOnly: true
  });
  const processRules = config.routing.rules.filter(rule => rule.process);
  assert.deepEqual(processRules, [
    { type: 'field', process: ['vpn.exe'], outboundTag: 'proxy' },
    { type: 'field', process: ['blocked.exe'], outboundTag: 'block' },
    { type: 'field', process: ['direct.exe'], outboundTag: 'direct' }
  ]);
  assert.ok(config.routing.rules.indexOf(processRules[0]) < config.routing.rules.findIndex(rule => rule.domain?.includes('example.org')));
});
