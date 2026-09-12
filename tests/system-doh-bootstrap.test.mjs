import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRecovered} from './load-recovered.mjs';
const {isValidIpLiteral}=loadRecovered('shared/system-dns',{},['isValidIpLiteral']);
const {parseCustomDnsUrl}=loadRecovered('shared/secure-dns',{isValidIpLiteral},['parseCustomDnsUrl']);
const helpers=loadRecovered('shared/system-doh',{parseCustomDnsUrl},['buildXrayLocalDohServerUrl']);
const {buildSystemDohXrayConfig}=loadRecovered('electron/ipc/system-doh-manager',helpers,['buildSystemDohXrayConfig']);
test('DoH bootstrap uses pinned addresses without returning to the OS resolver or DNS inbound',()=>{
  const config=JSON.parse(buildSystemDohXrayConfig({url:'https://resolver.example/profile?token=test',localAddress:'127.0.0.1',bootstrapHosts:{'resolver.example':['192.0.2.1']}}));
  assert.equal(config.dns.servers.at(-1),'https://resolver.example/profile?token=test');
  assert.deepEqual(config.dns.hosts['resolver.example'],['192.0.2.1']);
  const upstream=config.routing.rules.find(rule=>rule.inboundTag.includes(config.dns.tag));
  const outbound=config.outbounds.find(outbound=>outbound.tag===upstream?.outboundTag);
  assert.equal(outbound?.protocol,'freedom');
  assert.equal(outbound?.settings.domainStrategy,'ForceIPv4');
  assert.notEqual(config.dns.tag,'dns-in');
  assert.equal(config.routing.rules.find(rule=>rule.inboundTag.includes('dns-in')).outboundTag,'dns-out');
});
