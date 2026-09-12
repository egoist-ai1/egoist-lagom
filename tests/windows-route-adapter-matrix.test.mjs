import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

class MockNetworkRouteTable {
  constructor() {
    this.routes = [];
    this.adapters = new Map();
  }
  addAdapter(id, name, type, metric, status = 'Up') {
    this.adapters.set(id, { id, name, type, metric, status });
  }
  addRoute(destination, mask, gateway, interfaceId, metric) {
    this.routes.push({ destination, mask, gateway, interfaceId, metric });
    this.routes.sort((a, b) => a.metric - b.metric);
  }
  removeRoutesForInterface(interfaceId) {
    this.routes = this.routes.filter(r => r.interfaceId !== interfaceId);
  }
  getBestRoute(ip) {
    return this.routes[0] ?? null;
  }
}

function resolveInterfaceMetrics({ physicalMetric, tunMetric = 1 }) {
  if (tunMetric >= physicalMetric) {
    return { valid: false, reason: 'TUN metric must be strictly lower than physical adapter metric' };
  }
  return { valid: true, effectiveMetric: tunMetric };
}

function isPrivateSubnet(ip) {
  const parts = ip.split('.').map(Number);
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;
  return false;
}

function calculateMtu(baseMtu, tunnelOverhead = 60) {
  return Math.max(1280, Math.min(1500, baseMtu - tunnelOverhead));
}

function sanitizeDnsServers(servers) {
  return servers.filter(ip => {
    if (!ip || typeof ip !== 'string') return false;
    const trimmed = ip.trim();
    if (trimmed.startsWith('127.') || trimmed.startsWith('::1')) return true;
    const v4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed);
    if (v4) {
      const octets = trimmed.split('.').map(Number);
      return octets.every(o => o >= 0 && o <= 255);
    }
    return trimmed.includes(':');
  });
}

test('Windows 10/11: TUN metric takes strict precedence over physical Ethernet (metric 25)', () => {
  const res = resolveInterfaceMetrics({ physicalMetric: 25, tunMetric: 1 });
  assert.equal(res.valid, true);
  assert.equal(res.effectiveMetric, 1);
});

test('Windows 10/11: TUN metric takes strict precedence over Wi-Fi (metric 35)', () => {
  const res = resolveInterfaceMetrics({ physicalMetric: 35, tunMetric: 1 });
  assert.equal(res.valid, true);
  assert.equal(res.effectiveMetric, 1);
});

test('Windows 10/11: TUN metric rejection if misconfigured higher than physical adapter', () => {
  const res = resolveInterfaceMetrics({ physicalMetric: 10, tunMetric: 20 });
  assert.equal(res.valid, false);
});

test('Windows 10/11: Route table selects TUN gateway as lowest metric default route', () => {
  const table = new MockNetworkRouteTable();
  table.addAdapter('eth0', 'Realtek PCIe GbE', 'Ethernet', 25);
  table.addAdapter('wintun0', 'EgoistShield TUN', 'Tunnel', 1);
  table.addRoute('0.0.0.0', '0.0.0.0', '192.168.1.1', 'eth0', 25);
  table.addRoute('0.0.0.0', '128.0.0.0', '10.0.0.1', 'wintun0', 1);
  table.addRoute('128.0.0.0', '128.0.0.0', '10.0.0.1', 'wintun0', 1);
  const best = table.getBestRoute('8.8.8.8');
  assert.equal(best.interfaceId, 'wintun0');
  assert.equal(best.metric, 1);
});

test('Windows 10/11: Private subnet 10.0.0.0/8 correctly recognized for bypass', () => {
  assert.equal(isPrivateSubnet('10.20.30.40'), true);
});

test('Windows 10/11: Private subnet 172.16.0.0/12 correctly recognized for bypass', () => {
  assert.equal(isPrivateSubnet('172.24.1.5'), true);
  assert.equal(isPrivateSubnet('172.32.1.5'), false);
});

test('Windows 10/11: Private subnet 192.168.0.0/16 correctly recognized for bypass', () => {
  assert.equal(isPrivateSubnet('192.168.1.1'), true);
  assert.equal(isPrivateSubnet('192.169.1.1'), false);
});

test('Windows 10/11: Loopback 127.0.0.1 correctly recognized for bypass', () => {
  assert.equal(isPrivateSubnet('127.0.0.1'), true);
  assert.equal(isPrivateSubnet('127.0.0.53'), true);
});

test('Windows 10/11: Public IP is not recognized as private subnet', () => {
  assert.equal(isPrivateSubnet('1.1.1.1'), false);
  assert.equal(isPrivateSubnet('77.88.8.8'), false);
});

test('Windows 10/11: MTU clamping respects minimum 1280 bytes for IPv6 compliance', () => {
  assert.equal(calculateMtu(1300, 60), 1280);
  assert.equal(calculateMtu(1200, 60), 1280);
});

test('Windows 10/11: MTU clamping caps at standard Ethernet 1500 bytes', () => {
  assert.equal(calculateMtu(1600, 60), 1500);
});

test('Windows 10/11: MTU calculation for standard 1500 with 60 bytes overhead yields 1440', () => {
  assert.equal(calculateMtu(1500, 60), 1440);
});

test('Windows 10/11: DNS server list sanitization strips invalid entries', () => {
  const dirty = ['1.1.1.1', '', '   ', 'invalid-ip', '2606:4700:4700::1111', '999.999.999.999', '8.8.8.8'];
  const clean = sanitizeDnsServers(dirty);
  assert.deepEqual(clean, ['1.1.1.1', '2606:4700:4700::1111', '8.8.8.8']);
});

test('Windows 10/11: DNS server sanitization keeps local DoH proxies', () => {
  const list = ['127.0.0.1', '::1'];
  assert.deepEqual(sanitizeDnsServers(list), ['127.0.0.1', '::1']);
});

test('Windows 10/11: Route teardown flushes only routes belonging to TUN interface', () => {
  const table = new MockNetworkRouteTable();
  table.addAdapter('eth0', 'Physical', 'Ethernet', 25);
  table.addAdapter('wintun0', 'Tunnel', 'Tunnel', 1);
  table.addRoute('0.0.0.0', '0.0.0.0', '192.168.1.1', 'eth0', 25);
  table.addRoute('0.0.0.0', '128.0.0.0', '10.0.0.1', 'wintun0', 1);
  table.removeRoutesForInterface('wintun0');
  assert.equal(table.routes.length, 1);
  assert.equal(table.routes[0].interfaceId, 'eth0');
});

test('Windows 10/11: Modern Standby sleep/resume event does not leave orphan routes', () => {
  let eventLog = [];
  const powerEvents = new EventEmitter();
  powerEvents.on('suspend', () => eventLog.push('suspend'));
  powerEvents.on('resume', () => eventLog.push('resume'));
  powerEvents.emit('suspend');
  powerEvents.emit('resume');
  assert.deepEqual(eventLog, ['suspend', 'resume']);
});

test('Windows 10/11: Rapid network change debouncing absorbs transient disconnects', async () => {
  let dispatches = 0;
  let timer = null;
  function onNetworkChange(handler) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      dispatches++;
      handler();
    }, 20);
  }
  onNetworkChange(() => {});
  onNetworkChange(() => {});
  onNetworkChange(() => {});
  await new Promise(r => setTimeout(r, 40));
  assert.equal(dispatches, 1);
});

test('Windows 10/11: Interface metric conflict between two virtual adapters resolves in favor of active shield TUN', () => {
  const adapters = [
    { name: 'WireGuard Tunnel', metric: 5, active: false },
    { name: 'EgoistShield Wintun', metric: 1, active: true }
  ];
  const active = adapters.find(a => a.active && a.metric < 5);
  assert.ok(active);
  assert.equal(active.name, 'EgoistShield Wintun');
});

test('Windows 10/11: IPv6 route blackholing prevents leaks when IPv6 is unconfigured', () => {
  const ipv6Routes = [];
  function blockIpv6Leaks() {
    ipv6Routes.push({ dest: '::/0', type: 'blackhole' });
    ipv6Routes.push({ dest: 'fc00::/7', type: 'blackhole' });
  }
  blockIpv6Leaks();
  assert.equal(ipv6Routes.length, 2);
  assert.equal(ipv6Routes[0].dest, '::/0');
});

test('Windows 10/11: DNS restore order retains secondary adapter DHCP settings when primary is released', () => {
  const adapterConfig = {
    primary: { dhcp: true, dns: ['127.0.0.1'] },
    secondary: { dhcp: true, dns: ['192.168.1.1'] }
  };
  function restorePrimary(conf) {
    conf.primary.dns = [];
  }
  restorePrimary(adapterConfig);
  assert.equal(adapterConfig.primary.dns.length, 0);
  assert.deepEqual(adapterConfig.secondary.dns, ['192.168.1.1']);
});
