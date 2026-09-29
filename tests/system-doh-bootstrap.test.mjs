import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRecovered} from './load-recovered.mjs';
const {isValidIpLiteral}=loadRecovered('shared/system-dns',{},['isValidIpLiteral']);
const {parseCustomDnsUrl}=loadRecovered('shared/secure-dns',{isValidIpLiteral},['parseCustomDnsUrl']);
const helpers=loadRecovered('shared/system-doh',{parseCustomDnsUrl},['buildXrayLocalDohServerUrl','normalizeSystemDohLocalAddress','parseSystemDohUrl','SYSTEM_DOH_HEALTH_DOMAIN']);
const {buildSystemDohXrayConfig}=loadRecovered('electron/ipc/system-doh-manager',helpers,['buildSystemDohXrayConfig']);
const {SYSTEM_DOH_VERIFICATION_DOMAINS}=loadRecovered('shared/system-doh',{parseCustomDnsUrl},['SYSTEM_DOH_VERIFICATION_DOMAINS']);
test('resolver health uses neutral domains independent of blocked applications',()=>{
  assert.deepEqual(Array.from(SYSTEM_DOH_VERIFICATION_DOMAINS),['example.com','www.microsoft.com','github.com']);
});
test('DoH bootstrap uses pinned addresses without returning to the OS resolver or DNS inbound',()=>{
  const config=JSON.parse(buildSystemDohXrayConfig({url:'https://resolver.example/profile?token=test',localAddress:'127.0.0.1',bootstrapHosts:{'resolver.example':['192.0.2.1']}}));
  assert.deepEqual(config.dns.servers,[
    {address:'https://resolver.example/profile?token=test',timeoutMs:2500},
  ]);
  assert.equal(config.dns.disableFallback,true);
  assert.equal(config.dns.enableParallelQuery,false);
  assert.equal(config.dns.serveStale,false);
  assert.equal(config.log.loglevel,'warning');
  assert.deepEqual(config.dns.hosts['resolver.example'],['192.0.2.1']);
  assert.deepEqual(config.dns.hosts['health.egoist.invalid'],['127.0.0.1']);
  assert.equal(config.dns.hosts['cloudflare-dns.com'],undefined);
  assert.equal(config.dns.hosts['dns.google'],undefined);
  const upstream=config.routing.rules.find(rule=>rule.inboundTag.includes(config.dns.tag));
  const outbound=config.outbounds.find(outbound=>outbound.tag===upstream?.outboundTag);
  assert.equal(outbound?.protocol,'freedom');
  assert.equal(outbound?.settings.domainStrategy,'ForceIPv4');
  assert.notEqual(config.dns.tag,'dns-in');
  assert.equal(config.routing.rules.find(rule=>rule.inboundTag.includes('dns-in')).outboundTag,'dns-out');
});
