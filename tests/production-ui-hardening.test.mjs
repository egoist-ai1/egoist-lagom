import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const widget = await fs.readFile(new URL('../src/brand/ShieldWidget.jsx', import.meta.url), 'utf8');
const compact = await fs.readFile(new URL('../src/brand/CompactRuby.jsx', import.meta.url), 'utf8');
const renderer = await fs.readFile(new URL('../src/recovered/renderer.js', import.meta.url), 'utf8');
function extract(source, name) {
  const functionStart = source.indexOf(`function ${name}(`);
  const start = source.slice(functionStart - 6, functionStart) === 'async ' ? functionStart - 6 : functionStart;
  const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start, `Production helper ${name} exists`);
  return source.slice(start, end);
}
const observation = vm.runInNewContext(widget.slice(0, widget.indexOf('function ShieldWidget(')) + '\n({rubyObserveStatus,rubyStatusKnown,rubyTelegramReady,rubyDnsReady,rubyZapretReady})');
const selection = vm.runInNewContext(extract(renderer, 'rubyResolveSubscription') + '\nrubyResolveSubscription');

test('failed component reads retain previous facts as stale and cannot confirm current readiness', () => {
  for (const ready of [observation.rubyDnsReady, observation.rubyTelegramReady, observation.rubyZapretReady]) {
    const previous = {running:true, serviceRunning:true, runtimeReady:true, verified:true, listenerReady:true};
    const first = observation.rubyObserveStatus({status:'fulfilled', value:previous}, null, 4, 100);
    assert.equal(ready(first), true);
    const stale = observation.rubyObserveStatus({status:'rejected', reason:new Error('Core unavailable')}, first, 5, 200);
    assert.equal(stale.running, true, 'Last observation is preserved for diagnosis');
    assert.equal(stale.uiObservation.lastConfirmedAt, 100);
    assert.equal(stale.uiObservation.generation, 5);
    assert.equal(stale.uiObservation.stale, true);
    assert.equal(stale.uiObservation.error, 'Core unavailable');
    assert.equal(observation.rubyStatusKnown(stale), false);
    assert.equal(ready(stale), false, 'A failed refresh never paints cached success');
    const current = observation.rubyObserveStatus({status:'fulfilled', value:{running:false}}, stale, 6, 300);
    assert.equal(observation.rubyStatusKnown(current), true);
    assert.equal(current.uiObservation.stale, false);
    assert.equal(current.uiObservation.lastConfirmedAt, 300);
  }
});

test('missing first result has unknown observation and no invented false running fact', () => {
  for (const result of [{status:'fulfilled', value:undefined}, {status:'rejected', reason:new Error('Denied')}]) {
    const current = observation.rubyObserveStatus(result, null, 1, 100);
    assert.equal(current.running, undefined);
    assert.equal(current.uiObservation.known, false);
    assert.equal(current.uiObservation.stale, false);
    assert.equal(current.uiObservation.lastConfirmedAt, null);
  }
});

test('unknown shield component cannot be replaced by an enabled future preference', () => {
  const observed=vm.runInNewContext(extract(widget,'rubyShieldObservedState')+'\nrubyShieldObservedState');
  for(const status of [null,{}, {statusError:'Core unavailable',dnsRunning:true}]) assert.equal(observed(status,'dnsRunning'),null);
  assert.equal(observed({dnsRunning:false},'dnsRunning'),false);
  assert.equal(observed({dnsRunning:true},'dnsRunning'),true);
});

test('subscription target is selected by stable ID and falls back to active node ownership', () => {
  const state = {subscriptions:[{id:'A', name:'First'}, {id:'B', name:'Second'}], nodes:[{id:'nB', subscriptionId:'B'}], activeNodeId:'nB'};
  assert.equal(selection(state, null).id, 'B');
  assert.equal(selection(state, 'A').id, 'A');
  assert.equal(selection(state, 'gone').id, 'B');
  assert.equal(selection({subscriptions:[], nodes:[]}, 'gone'), null);
});

test('quick DPI start preserves installed service mode and confirms post-command readiness', async () => {
  const source = extract(compact, 'rubyStartZapret');
  const calls = [];
  const start = vm.runInNewContext(source + '\nrubyStartZapret', {
    Z: (_name, method, ...args) => method(...args),
    rubyRequireOk: result => {if(result?.ok === false) throw new Error(result.error); return result;},
    rubyStatusKnown: observation.rubyStatusKnown,
    rubyZapretReady: observation.rubyZapretReady,
  });
  const api = {zapret:{
    status:async () => {calls.push('status'); return {serviceInstalled:true, serviceRunning:calls.includes('service'), runtimeReady:calls.includes('service'), currentProfile:'stable'};},
    startService:async profile => {calls.push('service'); assert.equal(profile, 'stable'); return {ok:true};},
    startStandalone:async () => {calls.push('standalone'); return {ok:true};},
  }};
  await start(api, 'stable');
  assert.deepEqual(calls, ['status', 'service', 'status']);
  calls.length = 0;
  api.zapret.status = async () => ({serviceInstalled:true, serviceRunning:true, runtimeReady:false, lastError:'Process missing'});
  await assert.rejects(start(api, 'stable'), /Process missing|не подтверд/);
});

test('mini separates actual DNS and Telegram switches from on-connect preferences', () => {
  assert.ok(!widget.includes('aria-checked={dnsRunning || (!running && dnsEnabled)}'));
  assert.ok(!widget.includes('aria-checked={telegramRunning || (!running && telegramEnabled)}'));
  assert.ok(widget.includes('aria-checked={dnsRunning === true}'));
  assert.ok(widget.includes('aria-checked={telegramRunning === true}'));
  assert.ok(widget.includes('При подключении профиля'));
  assert.ok(widget.includes('checked={dnsEnabled}'));
  assert.ok(widget.includes('checked={telegramEnabled}'));
});

test('renderer uses narrow mutation APIs and applies only the latest status generation', () => {
  assert.ok(!renderer.includes('Z(`state.set`'));
  assert.ok(!compact.includes("Z('state.set'"));
  assert.ok(renderer.includes('state.patchSettings'));
  assert.ok(renderer.includes('node.setFavorite'));
  assert.ok(renderer.includes('subscription.deleteById'));
  assert.ok(renderer.includes('generation !== readGeneration.current'));
});

test('settings conflicts retain fresh backend state and provide a concrete retry explanation', () => {
  const result=vm.runInNewContext(extract(renderer,'rubySettingsOutcome')+'\nrubySettingsOutcome');
  const latest={stateRevision:8,settings:{autoStart:false}};
  const conflict=result({ok:false,conflict:true,state:latest,error:'STATE_REVISION_CONFLICT'});
  assert.equal(conflict.state,latest);
  assert.equal(conflict.ok,false);
  assert.match(conflict.error,/актуальные значения/);
  assert.match(conflict.error,/повторите/);
  const failed=result({ok:false,conflict:false,state:latest,error:'STATE_WRITE_FAILED'});
  assert.match(failed.error,/не применено/);
});

test('DNS hostname alias declares the actual HTTPS DoH transport', () => {
  const parser=vm.runInNewContext(['jm','Mm','Nm'].map(name=>extract(renderer,name)).join('\n')+'\njm',{URL,zf:{provider:'Gravityless DNS'}});
  const value=parser('example-token.dns.gravityless.space');
  assert.equal(value.protocol,'DoH');
  assert.equal(value.inputAlias,'Gravityless hostname → HTTPS DoH');
  assert.equal(value.dohUrl,'https://dns.gravityless.space:8443/dns-query/example-token');
  assert.equal(parser('resolver.example'),null,'Unsupported generic DoT hostnames do not appear supported');
});

test('large server lists retain every stable ID in bounded pages and clamp removed pages', () => {
  const page=vm.runInNewContext(extract(compact,'rubyServerPage')+'\nrubyServerPage');
  for(const count of [0,60,500,2000]){
    const nodes=Array.from({length:count},(_,index)=>({id:'n'+index}));
    const first=page(nodes,0),seen=[];
    for(let index=0;index<first.pages;index++){
      const current=page(nodes,index);
      assert.ok(current.rows.length<=60);
      seen.push(...current.rows.map(node=>node.id));
    }
    assert.deepEqual(seen,nodes.map(node=>node.id));
    assert.equal(new Set(seen).size,count);
    assert.equal(page(nodes,999).page,first.pages-1);
    assert.equal(page(nodes,-1).page,0);
  }
});

test('server search reaches later pages with Cyrillic, address and protocol without changing original list', () => {
  const search=vm.runInNewContext(extract(compact,'rubyFilterServers')+'\nrubyFilterServers');
  const nodes=[{id:'A',name:'Франкфурт',country:'ГЕРМАНИЯ',server:'192.0.2.20',protocol:'vless'},{id:'B',name:'Последний сервер',country:'Япония',server:'192.0.2.99',protocol:'trojan'}];
  assert.equal(search(nodes,' германия ')[0].id,'A');
  assert.equal(search(nodes,'192.0.2.99')[0].id,'B');
  assert.equal(search(nodes,'TROJAN')[0].id,'B');
  assert.equal(search(nodes,'ничего').length,0);
  assert.equal(search(nodes,''),nodes);
  assert.equal(nodes.length,2);
});

test('background VPN acknowledges commands only after fresh process and startup readback', async () => {
  const source=[extract(compact,'rubyBackgroundVpnKnown'),extract(compact,'rubyBackgroundVpnOwnsRoute'),extract(compact,'rubyRequireOk'),extract(compact,'rubyBackgroundVpnCommand')].join('\n');
  const command=vm.runInNewContext(source+'\nrubyBackgroundVpnCommand',{rubyStatusKnown:observation.rubyStatusKnown,Z:(_name,method,...args)=>method(...args)});
  const calls=[];
  let status={serviceInstalled:false,serviceState:'not-installed',backgroundEnabled:false,running:false};
  const api={vpn:{serviceStatus:async()=>{calls.push('read');return status},serviceInstall:async input=>{calls.push(input);return {ok:true}},serviceStart:async()=>({ok:true}),serviceStop:async()=>({ok:true}),serviceRemove:async()=>({ok:true})}};
  await assert.rejects(command(api,'serviceInstall','B'),/не подтвердила/);
  assert.deepEqual(calls,['B','read']);
  status={serviceInstalled:true,serviceState:'running',backgroundEnabled:true,running:true};
  assert.equal((await command(api,'serviceInstall','B')).running,true);
  await assert.rejects(command(api,'serviceStop'),/не подтвердила/);
  status={serviceInstalled:true,serviceState:'unknown',backgroundEnabled:true,running:null};
  await assert.rejects(command(api,'serviceStart'),/не подтверждено/);
  status={serviceInstalled:true,serviceState:'stopped',backgroundEnabled:false,running:false};
  assert.equal((await command(api,'serviceStop')).backgroundEnabled,false);
  await assert.rejects(command(api,'serviceRemove'),/не подтвердила/);
  status={serviceInstalled:false,serviceState:'not-installed',backgroundEnabled:false,running:false};
  assert.equal((await command(api,'serviceRemove')).serviceInstalled,false);
  api.vpn.serviceInstall=async()=>({ok:false,error:'Unsupported Kill Switch'});
  await assert.rejects(command(api,'serviceInstall','B'),/Unsupported Kill Switch/);
});

test('a running DNS process without a confirmed DNS response remains unready', () => {
  assert.equal(observation.rubyDnsReady({running:true}),false);
  assert.equal(observation.rubyDnsReady({running:true,verified:false,resolutionVerified:false}),false);
  assert.equal(observation.rubyDnsReady({running:true,resolutionVerified:true,resolverIdentityVerified:null}),true);
  assert.equal(observation.rubyDnsReady({running:false,verified:true}),false);
  assert.equal(observation.rubyDnsReady({running:true,verified:true,statusError:'SCM state unknown'}),false);
});

test('DoH UI rejects unsupported DoT and malformed input and preserves the real HTTPS port and query', () => {
  const parser=vm.runInNewContext(['jm','Mm','Nm'].map(name=>extract(renderer,name)).join('\n')+'\njm',{URL,zf:{provider:'Gravityless DNS'}});
  for(const input of ['tls://dns.example','dns.example','https://user:password@dns.example/dns-query','https://dns.example/\nquery','<https://dns.example/dns-query>','https://dns.example\\other/dns-query','https://dns.exa\u200bmple/dns-query'])assert.equal(parser(input),null,input);
  const parsed=parser('https://dns.example:8443/dns-query?client=private');
  assert.equal(parsed.protocol,'DoH');
  assert.equal(parsed.dohUrl,'https://dns.example:8443/dns-query?client=private');
  assert.equal(parsed.displayEndpoint,'dns.example:8443/dns-query?client=private');
  assert.equal(parsed.upstream,'dns.example:8443');
});
