import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const { ShieldConnectionController } = await import(process.env.LAGOM_SHIELD_CONTROLLER_TEST_SOURCE ? pathToFileURL(process.env.LAGOM_SHIELD_CONTROLLER_TEST_SOURCE).href : new URL('../src/shield-connection-controller.js', import.meta.url));
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
function fixture({dns=true,verified=dns,configured=dns,addons=false}={}) {
  const calls=[], state={dns,verified,configured,prefEnabled:configured,provider:'https://selected.example/dns-query',zapret:addons,telegram:addons};
  const deps={
    coordinate:async(_action,operation)=>operation(),
    dns:{ status:async()=>({running:state.dns&&state.verified,verified:state.verified,enabled:state.configured,serviceInstalled:state.configured,serviceRunning:state.dns,serviceState:state.dns?'running':state.configured?'stopped':'not-installed',healthState:state.dns?(state.verified?'ready':'degraded'):'stopped'}),
      stopAndRemove:async()=>{calls.push('dns-remove');state.dns=false;state.configured=false;return {ok:true};} },
    applyDns:async()=>{calls.push('dns-apply');state.dns=true;state.verified=true;state.configured=true;state.prefEnabled=true;return {ok:true};},
    resetDns:async()=>{calls.push('dns-reset');state.dns=false;state.verified=false;state.configured=false;state.prefEnabled=false;return {ok:true};},
    zapret:{status:async()=>{calls.push('zapret-status');return {serviceRunning:state.zapret,runtimeReady:state.zapret,serviceProfile:state.zapret?'verified-profile':null};},
      autoSelectBestProfile:async()=>{calls.push('select');return {completed:true,bestProfile:'verified-profile'};},
      installService:async()=>{calls.push('zapret-install');state.zapret=true;},startService:async()=>{calls.push('zapret-start');state.zapret=true;},
      stopService:async()=>{calls.push('zapret-stop');state.zapret=false;},stopStandalone:async()=>{calls.push('zapret-stop-standalone');},cancelAutoSelect:async()=>{calls.push('cancel');} },
    telegramProxy:{status:async()=>({running:state.telegram,serviceRunning:state.telegram,runtimeReady:state.telegram,listenerReady:state.telegram}),
      installService:async()=>{calls.push('tg-install');state.telegram=true;return {serviceRunning:true,runtimeReady:true,listenerReady:true};},
      startService:async()=>{calls.push('tg-start');state.telegram=true;},stopService:async()=>{calls.push('tg-stop');state.telegram=false;return {running:false,serviceRunning:false};},openConnectionLink:async()=>{} },
    saveConnected:async()=>{calls.push('save-profile');},
  };
  return {deps,state,calls,controller:new ShieldConnectionController(deps)};
}
const assertPreserved=f=>{assert.equal(f.state.dns,true);assert.equal(f.state.prefEnabled,true);assert.equal(f.state.provider,'https://selected.example/dns-query');assert.equal(f.calls.includes('dns-reset'),false);assert.equal(f.calls.includes('dns-remove'),false);};

test('profile disconnect stops only addons and leaves verified DNS foundation/settings intact',async()=>{
  const f=fixture({addons:true});assert.equal((await f.controller.disconnect()).ok,true);assertPreserved(f);
  const s=await f.controller.status();assert.equal(s.running,false);assert.equal(s.dnsRunning,true);assert.equal(s.telegramRunning,false);assert.equal(s.phase,'idle');
});

test('initial foundation is established before addon status, selection and startup',async()=>{
  const f=fixture({dns:false,configured:false});assert.equal((await f.controller.connect()).ok,true);assertPreserved(f);
  assert.ok(f.calls.indexOf('dns-apply')<f.calls.indexOf('zapret-status'),'Even addon observation failure cannot preempt requested foundational DNS setup');
  assert.ok(f.calls.indexOf('dns-apply')<f.calls.indexOf('select'));
});

test('Telegram failure rolls back new addons but preserves newly established DNS foundation',async()=>{
  const f=fixture({dns:false,configured:false});f.deps.telegramProxy.installService=async()=>{f.calls.push('tg-install');f.state.telegram=true;throw new Error('TG addon failure');};
  assert.equal((await f.controller.connect()).ok,false);assertPreserved(f);assert.equal(f.state.telegram,false);assert.equal(f.state.zapret,false);
});

test('cancel during addon strategy selection preserves newly established DNS foundation',async()=>{
  const f=fixture({dns:false,configured:false});const selection=deferred();let selecting=false;
  f.deps.zapret.autoSelectBestProfile=()=>{selecting=true;return selection.promise;};
  const pending=f.controller.connect();while(!selecting)await new Promise(resolve=>setImmediate(resolve));await f.controller.cancel();selection.resolve({completed:true,bestProfile:'verified-profile'});
  assert.equal((await pending).cancelled,true);assertPreserved(f);assert.equal(f.state.zapret,false);assert.equal(f.calls.includes('save-profile'),false);
});

test('profile option DNS=false never disables an already active foundation',async()=>{
  const f=fixture();assert.equal((await f.controller.connect({dnsEnabled:false})).ok,true);assertPreserved(f);assert.equal(f.calls.includes('dns-apply'),false);
  assert.equal((await f.controller.disconnect()).ok,true);assertPreserved(f);
});

test('configured stopped foundation blocks selection without deleting its resolver or saved intent',async()=>{
  const f=fixture({dns:false,configured:true,verified:false});const result=await f.controller.connect({dnsEnabled:false});
  assert.equal(result.ok,false);assert.equal(f.state.configured,true);assert.equal(f.state.prefEnabled,true);assert.equal(f.calls.includes('dns-remove'),false);assert.equal(f.calls.includes('select'),false);
});

test('configured degraded DNS is preserved and blocks addon selection with a bounded visible error',async()=>{
  const f=fixture({dns:true,configured:true,verified:false});const result=await f.controller.connect();assert.equal(result.ok,false);
  assertPreserved(f);assert.equal(f.calls.includes('dns-apply'),false);assert.equal(f.calls.includes('select'),false);assert.match(result.message,/DNS/);
});

test('failed partial foundation activation retains its owned candidate and never starts addons',async()=>{
  const f=fixture({dns:false,configured:false});f.deps.applyDns=async()=>{f.calls.push('dns-apply');f.state.dns=true;f.state.configured=true;throw new Error('Candidate readiness pending');};
  const result=await f.controller.connect();assert.equal(result.ok,false);assert.equal(f.state.dns,true);assert.equal(f.state.configured,true);assert.equal(f.state.prefEnabled,false,'Unverified initial adapter enrollment is not fabricated');
  assert.equal(f.calls.includes('dns-reset'),false);assert.equal(f.calls.includes('dns-remove'),false);assert.equal(f.calls.includes('select'),false);assert.equal(f.calls.includes('zapret-install'),false);
});

test('addon preflight failure after initial DNS setup preserves the foundation',async()=>{
  const f=fixture({dns:false,configured:false});f.deps.zapret.status=async()=>{f.calls.push('zapret-status');throw new Error('Addon owner unavailable');};
  const result=await f.controller.connect();assert.equal(result.ok,false);assertPreserved(f);assert.equal(f.calls.includes('select'),false);
});

test('failed addon stop cannot roll back or reset DNS foundation',async()=>{
  const f=fixture({addons:true});f.deps.telegramProxy.stopService=async()=>({running:true,serviceRunning:true});
  assert.equal((await f.controller.disconnect()).ok,false);assertPreserved(f);assert.equal(f.state.zapret,true);
});


for (const health of ['degraded','unknown']) test(`profile disconnect leaves ${health} owned DNS and settings untouched`,async()=>{
  const f=fixture({addons:true,verified:false});if(health==='unknown')f.deps.dns.status=async()=>{throw new Error('DNS observation unknown');};
  assert.equal((await f.controller.disconnect()).ok,true);assertPreserved(f);assert.equal(f.state.zapret,false);assert.equal(f.state.telegram,false);
});

test('cancel during first DNS activation preserves the accepted foundation and prevents addon startup',async()=>{
  const f=fixture({dns:false,configured:false});const applied=deferred();let starting=false;
  f.deps.applyDns=async()=>{starting=true;f.calls.push('dns-apply');await applied.promise;f.state.dns=true;f.state.verified=true;f.state.configured=true;f.state.prefEnabled=true;return {ok:true};};
  const pending=f.controller.connect();while(!starting)await new Promise(resolve=>setImmediate(resolve));await f.controller.cancel();applied.resolve();
  assert.equal((await pending).cancelled,true);assertPreserved(f);assert.equal(f.calls.includes('zapret-status'),false);assert.equal(f.calls.includes('select'),false);
});

const handlers = await fs.readFile(process.env.LAGOM_SHIELD_DNS_HANDLER_TEST_SOURCE || new URL('../src/recovered/electron/ipc/handlers-system.js',import.meta.url),'utf8');
const applyStart = handlers.indexOf('applyDns: async () => {',handlers.indexOf('const shield = new ShieldConnectionController('));
const applyEndMarker = handlers.indexOf('resetDns: async () => {',applyStart);
const applyEnd = applyEndMarker < 0 ? handlers.length : applyEndMarker;
assert.ok(applyStart>=0 && applyEnd>applyStart,'Actual Shield applyDns handler boundary exists');
const applyBody=handlers.slice(applyStart,applyEnd).trim().replace(/,$/,'');
function applyFixture(url,status={running:true,verified:true,localAddress:'127.0.0.1',nativeManaged:false}) {
  const calls=[],settings={systemDohUrl:url,systemDohLocalAddress:'127.0.0.1',systemDohEnabled:false};
  const apply=vm.runInNewContext('({'+applyBody+'}).applyDns',{
    stateStore:{get:()=>({settings})},
    systemDohManager:{apply:async(...args)=>{calls.push(['apply',...args]);return status;}},
    setSystemDnsThroughCurrentOwner:async(...args)=>{calls.push(['dns-owner',...args]);},localSystemDohServers:()=>['127.0.0.1','::1'],SYSTEM_DOH_VERIFICATION_DOMAINS:['example.com'],
    patchSettingsWithLoginItemSync:async patch=>{calls.push(['settings',patch]);Object.assign(settings,patch);},
  });
  return {calls,settings,apply};
}

test('actual Shield DNS handler rejects missing saved operator before any manager or DNS call',async()=>{
  const f=applyFixture('');await assert.rejects(f.apply(),/выбранный HTTPS-адрес/);assert.deepEqual(f.calls,[]);assert.equal(f.settings.systemDohEnabled,false);
});

test('actual Shield DNS handler keeps the selected operator and persists enabled only after verified enrollment',async()=>{
  const url='https://selected.example:8443/dns-query';const f=applyFixture(url);assert.equal((await f.apply()).ok,true);
  assert.equal(f.calls[0][0],'apply');assert.equal(f.calls[0][1],url);assert.equal(f.calls[1][0],'dns-owner');assert.equal(f.calls[2][0],'settings');
  assert.equal(f.settings.systemDohUrl,url);assert.equal(f.settings.systemDohEnabled,true);
});

test('actual Shield DNS handler does not enroll an unverified initial candidate or replace its selected operator',async()=>{
  const url='https://selected.example/dns-query';const f=applyFixture(url,{running:false,verified:false,serviceRunning:true,serviceInstalled:true,localAddress:'127.0.0.1'});
  await assert.rejects(f.apply(),/не прошёл проверку/);assert.equal(f.calls.length,1);assert.equal(f.calls[0][1],url);assert.equal(f.settings.systemDohEnabled,false);
});


test('a running resolver with omitted verification cannot be reported as a ready foundation',async()=>{
  const f=fixture();f.deps.dns.status=async()=>({running:true,serviceRunning:true,enabled:true,healthState:'ready'});
  const observed=await f.controller.status();assert.equal(observed.dnsRunning,false);assert.equal(observed.dnsHealthState,'degraded');
  assert.equal((await f.controller.connect()).ok,false);assertPreserved(f);assert.equal(f.calls.includes('select'),false);
});


const { prepareZapretProbeDns }=process.env.LAGOM_ZAPRET_DNS_PREPARE_TEST_SOURCE
  ? {prepareZapretProbeDns:vm.runInNewContext((await fs.readFile(process.env.LAGOM_ZAPRET_DNS_PREPARE_TEST_SOURCE,'utf8'))+'\n;prepareZapretProbeDns')}
  : await import('./load-recovered.mjs').then(({loadRecovered})=>loadRecovered('electron/ipc/handlers-zapret',{},['prepareZapretProbeDns']));
for (const mode of ['direct','shield']) test(`${mode} preparation preserves stopped owned URL even without enabled flag`,async()=>{
  let removed=false;
  const status={running:false,serviceRunning:false,serviceState:'stopped',currentUrl:'https://selected.example/dns-query'};
  const dns={status:async()=>status,stopAndRemove:async()=>{removed=true;}};
  await assert.rejects(mode==='direct'?prepareZapretProbeDns(dns):new ShieldConnectionController({dns}).prepareDnsForAutoSelect(status),/DNS/);
  assert.equal(removed,false);assert.equal(status.currentUrl,'https://selected.example/dns-query');
});
