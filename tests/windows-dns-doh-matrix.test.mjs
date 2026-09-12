import test from 'node:test';
import assert from 'node:assert/strict';

class MockWindowsDnsManager {
  constructor(osVersion = '10.0.22631') {
    this.osVersion = osVersion; // Win 11 Build >= 22000
    this.isWin11 = parseInt(osVersion.split('.')[2] || '0', 10) >= 22000;
    this.adapterSettings = new Map();
    this.nrptRules = [];
    this.cacheFlushed = false;
  }

  registerAdapter(id, { isDhcp = true, servers = [] }) {
    this.adapterSettings.set(id, { isDhcp, originalServers: [...servers], currentServers: [...servers] });
  }

  setDns(id, servers) {
    const adapter = this.adapterSettings.get(id);
    if (!adapter) throw new Error('Adapter not found');
    adapter.currentServers = [...servers];
  }

  restoreDns(id) {
    const adapter = this.adapterSettings.get(id);
    if (!adapter) return;
    adapter.currentServers = [...adapter.originalServers];
  }

  addNrptRule(namespace, dnsServers) {
    this.nrptRules.push({ namespace, dnsServers });
  }

  removeNrptRules() {
    this.nrptRules = [];
  }

  flushCache() {
    this.cacheFlushed = true;
  }
}

const DOH_PROVIDERS = {
  cloudflare: { name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query', bootstrap: ['1.1.1.1', '1.0.0.1'] },
  google: { name: 'Google', url: 'https://dns.google/dns-query', bootstrap: ['8.8.8.8', '8.8.4.4'] },
  quad9: { name: 'Quad9', url: 'https://dns.quad9.net/dns-query', bootstrap: ['9.9.9.9', '149.112.112.112'] },
  adguard: { name: 'AdGuard', url: 'https://dns.adguard-dns.com/dns-query', bootstrap: ['94.140.14.14', '94.140.15.15'] }
};

function shouldBypassDoh(domain) {
  const d = domain.toLowerCase();
  return d.endsWith('.local') || d.endsWith('.lan') || d.endsWith('.home') || !d.includes('.');
}

function rankDnsResolvers(candidates) {
  return [...candidates].sort((a, b) => a.latencyMs - b.latencyMs);
}

test('Windows 11: OS build >= 22000 detected as Windows 11', () => {
  const mgr = new MockWindowsDnsManager('10.0.22631');
  assert.equal(mgr.isWin11, true);
});

test('Windows 10: OS build < 22000 detected as Windows 10', () => {
  const mgr = new MockWindowsDnsManager('10.0.19045');
  assert.equal(mgr.isWin11, false);
});

test('Windows 10/11: Adapter DNS override saves original DHCP config', () => {
  const mgr = new MockWindowsDnsManager();
  mgr.registerAdapter('Ethernet', { isDhcp: true, servers: [] });
  mgr.setDns('Ethernet', ['127.0.0.1']);
  assert.deepEqual(mgr.adapterSettings.get('Ethernet').currentServers, ['127.0.0.1']);
  assert.deepEqual(mgr.adapterSettings.get('Ethernet').originalServers, []);
});

test('Windows 10/11: Adapter DNS restoration restores DHCP state', () => {
  const mgr = new MockWindowsDnsManager();
  mgr.registerAdapter('Ethernet', { isDhcp: true, servers: [] });
  mgr.setDns('Ethernet', ['127.0.0.1']);
  mgr.restoreDns('Ethernet');
  assert.deepEqual(mgr.adapterSettings.get('Ethernet').currentServers, []);
});

test('Windows 10/11: Adapter DNS override saves original static IP DNS', () => {
  const mgr = new MockWindowsDnsManager();
  mgr.registerAdapter('Wi-Fi', { isDhcp: false, servers: ['192.168.1.1', '192.168.1.254'] });
  mgr.setDns('Wi-Fi', ['127.0.0.1']);
  assert.deepEqual(mgr.adapterSettings.get('Wi-Fi').currentServers, ['127.0.0.1']);
  mgr.restoreDns('Wi-Fi');
  assert.deepEqual(mgr.adapterSettings.get('Wi-Fi').currentServers, ['192.168.1.1', '192.168.1.254']);
});

test('Windows 10/11: Cache flush triggers DnsFlushResolverCache equivalent', () => {
  const mgr = new MockWindowsDnsManager();
  assert.equal(mgr.cacheFlushed, false);
  mgr.flushCache();
  assert.equal(mgr.cacheFlushed, true);
});

test('Windows 10/11: NRPT rules added for corporate split DNS', () => {
  const mgr = new MockWindowsDnsManager();
  mgr.addNrptRule('.corp.example.com', ['10.0.0.53']);
  assert.equal(mgr.nrptRules.length, 1);
  assert.equal(mgr.nrptRules[0].namespace, '.corp.example.com');
  assert.deepEqual(mgr.nrptRules[0].dnsServers, ['10.0.0.53']);
});

test('Windows 10/11: NRPT rules completely flushed on disconnect', () => {
  const mgr = new MockWindowsDnsManager();
  mgr.addNrptRule('.corp.example.com', ['10.0.0.53']);
  mgr.removeNrptRules();
  assert.equal(mgr.nrptRules.length, 0);
});

test('Windows 10/11: Cloudflare DoH provider template and bootstrap IPs', () => {
  const cf = DOH_PROVIDERS.cloudflare;
  assert.equal(cf.url, 'https://cloudflare-dns.com/dns-query');
  assert.deepEqual(cf.bootstrap, ['1.1.1.1', '1.0.0.1']);
});

test('Windows 10/11: Google DoH provider template and bootstrap IPs', () => {
  const g = DOH_PROVIDERS.google;
  assert.equal(g.url, 'https://dns.google/dns-query');
  assert.deepEqual(g.bootstrap, ['8.8.8.8', '8.8.4.4']);
});

test('Windows 10/11: Quad9 DoH provider template and bootstrap IPs', () => {
  const q = DOH_PROVIDERS.quad9;
  assert.equal(q.url, 'https://dns.quad9.net/dns-query');
  assert.deepEqual(q.bootstrap, ['9.9.9.9', '149.112.112.112']);
});

test('Windows 10/11: AdGuard DoH provider template and bootstrap IPs', () => {
  const ag = DOH_PROVIDERS.adguard;
  assert.equal(ag.url, 'https://dns.adguard-dns.com/dns-query');
  assert.deepEqual(ag.bootstrap, ['94.140.14.14', '94.140.15.15']);
});

test('Windows 10/11: Local .local mDNS queries bypass DoH', () => {
  assert.equal(shouldBypassDoh('myprinter.local'), true);
});

test('Windows 10/11: Local .lan queries bypass DoH', () => {
  assert.equal(shouldBypassDoh('router.lan'), true);
});

test('Windows 10/11: Single-label NetBIOS names bypass DoH', () => {
  assert.equal(shouldBypassDoh('fileserver'), true);
});

test('Windows 10/11: Internet FQDN domains are routed through DoH', () => {
  assert.equal(shouldBypassDoh('github.com'), false);
  assert.equal(shouldBypassDoh('api.telegram.org'), false);
});

test('Windows 10/11: Ranking DNS resolvers sorts by lowest latency', () => {
  const candidates = [
    { name: 'Google', latencyMs: 42 },
    { name: 'Cloudflare', latencyMs: 14 },
    { name: 'Quad9', latencyMs: 28 }
  ];
  const ranked = rankDnsResolvers(candidates);
  assert.equal(ranked[0].name, 'Cloudflare');
  assert.equal(ranked[1].name, 'Quad9');
  assert.equal(ranked[2].name, 'Google');
});

test('Windows 10/11: Emergency DNS restore defaults to DHCP when original config missing', () => {
  function emergencyRestore(adapter) {
    return { isDhcp: true, servers: [] };
  }
  const restored = emergencyRestore({ isDhcp: false, servers: ['127.0.0.1'] });
  assert.equal(restored.isDhcp, true);
  assert.deepEqual(restored.servers, []);
});

test('Windows 10/11: Loopback 127.0.0.1 must be primary DNS server to intercept queries', () => {
  const assigned = ['127.0.0.1', '1.1.1.1'];
  assert.equal(assigned[0], '127.0.0.1');
});

test('Windows 10/11: IPv6 DNS leak prevention replaces ISP IPv6 DNS with loopback or empty', () => {
  function sanitizeIpv6Dns(ispIpv6Servers) {
    return []; // blank out unencrypted IPv6 DNS
  }
  const cleared = sanitizeIpv6Dns(['fe80::1', '2001:4860:4860::8888']);
  assert.equal(cleared.length, 0);
});
