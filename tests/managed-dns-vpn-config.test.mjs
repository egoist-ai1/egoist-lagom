import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ URL, Buffer });
for (const name of ['shared/system-dns', 'shared/secure-dns', 'electron/ipc/config-builder']) {
  vm.runInContext(fs.readFileSync(`src/recovered/${name}.js`, 'utf8'), context);
}
const builder = context.ConfigBuilder;
const base = { dnsMode: 'auto', routeMode: 'global', useTunMode: false, systemDohEnabled: false, systemDohLocalAddress: '', systemDnsServers: '', customDnsUrl: '' };
const node = { protocol: 'socks', server: 'vpn.example', port: 1080, metadata: {} };
const plain = value => JSON.parse(JSON.stringify(value));
const sing = (settings = {}, domains = [], processes = []) => JSON.parse(builder.buildSingBox(node, domains, processes, { ...base, ...settings }, 10809));
const xray = (settings = {}, domains = [], processes = []) => JSON.parse(builder.buildXray(node, domains, { ...base, ...settings }, 10809, 10808, 10085, processes));
const loopback = { systemDohEnabled: true, systemDohLocalAddress: '127.0.0.1' };

for (const address of ['127.0.0.1', '127.0.0.2', '127.255.255.254']) {
  test(`managed sing-box loopback ${address} carries every resolver through the local DNS only`, () => {
    const config = sing({ ...loopback, systemDohLocalAddress: address });
    assert.equal(config.dns.servers.length, 1);
    const server = config.dns.servers[0];
    assert.equal(server.type, 'udp'); assert.equal(server.server, address); assert.equal(server.server_port, 53);
    assert.equal(config.dns.final, server.tag);
    assert.equal(config.outbounds[0].domain_resolver.server, server.tag);
    assert.equal(config.route.default_domain_resolver.server, server.tag);
    assert.deepEqual(config.outbounds.find(o => o.tag === server.detour), { type: 'direct', tag: server.detour, inet4_bind_address: '127.0.0.1' });
    assert.equal(JSON.stringify(config.dns).includes('8.8.8.8'), false);
    assert.equal(JSON.stringify(config.dns).includes('1.1.1.1'), false);
  });
}

test('native managed DNS with an empty local address uses OS DNS in both non-TUN runtimes', () => {
  const settings = { systemDohEnabled: true, systemDohLocalAddress: '' };
  const config = sing(settings);
  assert.deepEqual(config.dns.servers, [{ tag: config.dns.final, type: 'local' }]);
  assert.equal(config.outbounds.some(o => o.inet4_bind_address === '127.0.0.1'), false);
  assert.deepEqual(xray(settings).dns.servers, ['localhost']);
  assert.equal(config.dns.servers.some(s => s.server === '127.0.0.1'), false);
});

test('native sing-box TUN protects the verified native resolver IPs before user routing', () => {
  const config = sing({ systemDohEnabled: true, useTunMode: true, systemDnsServers: '192.0.2.53, 2001:db8::53' }, [{ domain: 'resolver.example', mode: 'vpn' }]);
  const protection = config.route.rules.find(r => r.ip_cidr?.includes('192.0.2.53/32'));
  assert.equal(protection.outbound, 'direct');
  assert.deepEqual(protection.ip_cidr, ['192.0.2.53/32', '2001:db8::53/128']);
  const tun = config.inbounds.find(i => i.type === 'tun');
  assert.ok(tun.route_exclude_address.includes('192.0.2.53/32'));
  assert.ok(tun.route_exclude_address.includes('2001:db8::53/128'));
  assert.ok(config.route.rules.indexOf(protection) < config.route.rules.findIndex(r => r.domain_suffix));
  assert.equal(config.route.rules.some(r => r.process_name?.includes('svchost.exe')), false);
});

test('native TUN without verified resolver IPs aborts before generating routes', () => {
  for (const servers of ['', 'resolver.example', '192.0.2.53/32', '127.0.0.1', '0.0.0.0', '::']) {
    assert.throws(() => sing({ systemDohEnabled: true, useTunMode: true, systemDnsServers: servers }), /DNS|DoH|TUN/);
  }
});

test('invalid explicit managed DNS addresses abort instead of falling through to a public resolver', () => {
  for (const address of ['1.1.1.1', '127.0.0.999', '127.00.0.1', 'localhost', '::1', '127.0.0.1:53']) {
    assert.throws(() => sing({ ...loopback, systemDohLocalAddress: address }), /DNS|loopback/);
    assert.throws(() => xray({ ...loopback, systemDohLocalAddress: address }), /DNS|loopback/);
  }
});

test('disabled non-TUN behavior and its chosen custom DNS remain unchanged', () => {
  const config = sing({ systemDohLocalAddress: 'invalid-ignored-when-disabled' });
  assert.deepEqual(config.dns.servers.map(s => s.server), ['1.1.1.1', '8.8.8.8', '1.1.1.1']);
  assert.equal(config.dns.final, 'proxy-dns');
  assert.equal(config.route.rules.some(r => r.process_name), false);
  assert.equal(xray().dns, undefined);
  const custom = sing({ dnsMode: 'custom', customDnsUrl: 'https://custom.example:8443/dns-query/fixture' });
  assert.equal(custom.dns.servers[0].server, 'custom.example'); assert.equal(custom.dns.servers[0].server_port, 8443);
});

test('TUN protects managed DNS and Telegram runtime processes before user rules', () => {
  const processes = [{ process: 'EgoistShield.Service.exe', mode: 'block' }, { process: 'xray-system-doh.exe', mode: 'vpn' }, { process: 'egoistshield-tg-ws-proxy.exe', mode: 'block' }];
  const config = sing({ ...loopback, useTunMode: true }, [], processes);
  const bypass = config.route.rules[0];
  assert.equal(bypass.outbound, 'direct');
  assert.ok(bypass.process_name.includes('EgoistShield.Service.exe'), 'fresh same-provider Core probes must bypass the TUN route');
  assert.ok(config.route.rules.findIndex(r=>r.process_name?.includes('EgoistShield.Service.exe')&&r.action==='reject') > 0, 'user block cannot supersede owned recovery control');
  assert.ok(bypass.process_name.includes('xray-system-doh.exe'));
  assert.ok(bypass.process_name.includes('egoistshield-tg-ws-proxy.exe'));
  assert.ok(bypass.process_name.includes('TgWsProxy_windows_7_64bit.exe'));
  assert.ok(config.route.rules.findIndex(r => r.action === 'hijack-dns') > 0);
  assert.deepEqual(config.inbounds.find(i => i.type === 'tun').route_exclude_address, ['127.0.0.0/8', '::1/128']);
  const disabled = sing({ useTunMode: true });
  assert.ok(disabled.route.rules[0].process_name.includes('egoistshield-tg-ws-proxy.exe'));
  assert.equal(disabled.route.rules[0].process_name.includes('xray-system-doh.exe'), false);
  const xc = xray({ ...loopback, useTunMode: true }, [], processes);
  assert.equal(xc.routing.rules[0].inboundTag[0], 'api');
  assert.equal(xc.routing.rules[1].process.includes('xray-system-doh.exe'), true);
  assert.equal(xc.routing.rules[1].outboundTag, 'direct');
  assert.ok(xc.routing.rules[1].process.includes('EgoistShield.Service.exe'));
  assert.ok(xc.routing.rules.findIndex(r=>r.process?.includes('EgoistShield.Service.exe')&&r.outboundTag==='block') > 1);
});

test('Xray loopback DNS has an explicit direct routing tag and no public fallback', () => {
  const config = xray(loopback);
  assert.deepEqual(config.dns.servers, [{ address: '127.0.0.1', port: 53, skipFallback: true }]);
  assert.equal(config.dns.disableFallback, true);
  assert.equal(config.routing.rules.find(r => r.inboundTag?.includes(config.dns.tag)).outboundTag, 'direct');
  assert.equal(config.routing.domainStrategy, 'IPOnDemand');
});

test('managed native Xray TUN refuses an unverified OS bootstrap bypass', () => {
  assert.throws(() => xray({ systemDohEnabled: true, useTunMode: true, systemDnsServers: '192.0.2.53' }), /TUN|sing-box/);
});

