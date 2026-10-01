// Audit-only runner. It never changes installed services, DNS, routes or proxy settings.
// Run: node --expose-gc <this-file> --work <this-task-work-directory>
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dgram from 'node:dgram';
import {isIP} from 'node:net';
import {performance, monitorEventLoopDelay} from 'node:perf_hooks';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const workFlag = process.argv.indexOf('--work');
assert(workFlag > 0 && process.argv[workFlag + 1], 'Explicit own --work path is required.');
const work = path.resolve(process.argv[workFlag + 1]);
assert(!process.env.SHIELD_BASELINE, 'This audit requires maintained sources; SHIELD_BASELINE must be unset.');
await fs.mkdir(work, {recursive: true});
process.chdir(project);
const require = createRequire(path.join(project, 'package.json'));
const {Agent, fetch: realFetch} = require('undici');
const {loadRecovered} = await import(pathToFileURL(path.join(project, 'tests/load-recovered.mjs')));
const logger = {debug() {}, info() {}, warn() {}, error() {}};
const sourceModules = [
  'electron/ipc/safe-network', 'electron/ipc/handlers-vpn', 'electron/ipc/route-probe',
  'electron/ipc/first-success', 'electron/ipc/vpn-reconnect-supervisor',
  'electron/ipc/gravityless-dns-manager', 'electron/ipc/network-combinator-manager',
  'electron/ipc/config-builder', 'shared/dns-controller',
];
const sourceSha256 = {};
for (const module of sourceModules) sourceSha256[module] = createHash('sha256').update(await fs.readFile(path.join(project, `src/recovered/${module}.js`))).digest('hex');
const result = {
  schemaVersion: 1, startedAt: new Date().toISOString(), sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: project, encoding: 'utf8'}).trim(),
  node: process.version, platform: process.platform, sourceSha256,
  boundaries: {windowsMutation: false, externalNetworkRequests: 0, maxWorkers: 16, sockets: 'own loopback only', tlsTrust: 'own one-day lab CA; no rejectUnauthorized bypass', forceGcForSnapshots: typeof global.gc === 'function', virtualTime: false},
  phases: [], findings: [], failures: [],
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const quantile = (values, ratio) => [...values].sort((a,b) => a-b)[Math.min(values.length-1, Math.floor(values.length*ratio))] ?? null;
const summary = values => ({count: values.length, p50: quantile(values, .5), p95: quantile(values, .95), max: values.length ? Math.max(...values) : null});
const resourceSnapshot = async label => {
  global.gc?.(); await delay(20);
  const memory = process.memoryUsage();
  const handles = {};
  // Diagnostic-only Node API; it does not count every timer or native OS handle.
  for (const handle of process._getActiveHandles()) handles[handle.constructor.name] = (handles[handle.constructor.name] ?? 0) + 1;
  return {label, ...memory, diagnosticActiveHandles: handles};
};
async function pool(count, fn, workers = 16) {
  let next = 0;
  await Promise.all(Array.from({length: Math.min(count, workers)}, async () => {
    while (next < count) {const index = next++; await fn(index);}
  }));
}
const safe = loadRecovered('electron/ipc/safe-network', {fetch: realFetch, Error}, ['fetchWithRetry', 'fetchTextWithRetry', 'readResponseTextWithLimit', 'getNetworkErrorDetails']);
const route = loadRecovered('electron/ipc/route-probe', {isIP}, ['extractRouteProbeIp', 'buildRouteProbeResult']);
const first = loadRecovered('electron/ipc/first-success', {}, ['firstSuccessful', 'isFirstSuccessfulCancellation']);
const vpn = extra => loadRecovered('electron/ipc/handlers-vpn', {
  process: {env: {}}, logger, app: {getVersion: () => '3.8.0'}, http, tls, performance,
  extractRouteProbeIp: route.extractRouteProbeIp, readResponseTextWithLimit: safe.readResponseTextWithLimit,
  isFirstSuccessfulCancellation: first.isFirstSuccessfulCancellation, ...extra,
}, ['fetchRouteProbeIp', 'openRouteProbeTls', 'measureRouteLatency', 'measureDownloadEndpoint', 'measureUploadEndpoint']);
const routeProbeApi = vpn();

// Whole-body budgets, retry allowlists, abortable backoff and loser cancellation.
{
  const started = performance.now(), sockets = new Set(), requestsByPath = {}, retryIds = new Map(), timers = new Set();
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    requestsByPath[url.pathname] = (requestsByPath[url.pathname] ?? 0) + 1;
    if (url.pathname === '/retry') {
      const seen = retryIds.get(url.search) ?? 0; retryIds.set(url.search, seen + 1);
      if (!seen) {response.writeHead(503, {'retry-after': '0'}); response.end('retry'); return;}
    }
    if (url.pathname === '/neverretry' || url.pathname === '/backoff') {response.writeHead(503, {'retry-after': '1'}); response.end('retry'); return;}
    response.writeHead(200, {'content-type': 'text/plain', 'connection': 'keep-alive'});
    if (url.pathname === '/stall') {response.flushHeaders(); return;}
    if (url.pathname === '/oversize') {response.end(Buffer.alloc(65537, 97)); return;}
    if (url.pathname === '/stream') {
      response.write('ip='); const timer = setTimeout(() => {timers.delete(timer); response.end('203.0.113.1\n');}, 20);
      timers.add(timer); return;
    }
    response.end('ip=203.0.113.1\n');
  });
  server.on('connection', socket => {sockets.add(socket); socket.on('close', () => sockets.delete(socket));});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const agent = new Agent({connections: 16, pipelining: 1, connect: {timeout: 500}});
  const latencies = {}, samples = [], errors = [];
  let completed = 0, rejectedAsExpected = 0, peakRss = process.memoryUsage().rss;
  const eventLoop = monitorEventLoopDelay({resolution: 10}); eventLoop.enable();
  const sampler = setInterval(() => {peakRss = Math.max(peakRss, process.memoryUsage().rss);}, 25); sampler.unref();
  const requestOptions = {fetchImpl: realFetch, dispatcher: agent, timeoutMs: 220, retries: 0};
  try {
    // Warm up pools, VM source functions and V8 before comparative idle snapshots.
    await pool(64, index => safe.fetchTextWithRetry(`${base}/ok?w=${index}`, requestOptions));
    samples.push({...await resourceSnapshot('after warmup'), serverSockets: sockets.size});
    for (let batch = 0; batch < 12; batch++) {
      await pool(128, async index => {
        const id = batch*128 + index, mode = id % 8, begin = performance.now();
        const controller = new AbortController(); let timer;
        try {
          if (mode === 0 || mode === 1) {
            const answer = await safe.fetchTextWithRetry(`${base}/${mode ? 'stream' : 'ok'}?id=${id}`, requestOptions);
            assert.equal(answer.text, 'ip=203.0.113.1\n');
          } else if (mode === 2) {
            await assert.rejects(safe.fetchTextWithRetry(`${base}/oversize?id=${id}`, {...requestOptions, maxBytes: 16384}), error => error.name === 'ResponseTooLargeError'); rejectedAsExpected++;
          } else if (mode === 3) {
            await assert.rejects(safe.fetchTextWithRetry(`${base}/stall?id=${id}`, requestOptions), error => error.name === 'AbortError'); rejectedAsExpected++;
          } else if (mode === 4) {
            const answer = await safe.fetchTextWithRetry(`${base}/retry?id=${id}`, {...requestOptions, retries: 1, retryBaseDelayMs: 1});
            assert.equal(answer.attempts, 2); assert.equal(answer.text, 'ip=203.0.113.1\n');
          } else if (mode === 5) {
            await assert.rejects(safe.fetchTextWithRetry(`${base}/neverretry?id=${id}`, {...requestOptions, retries: 4, retryOnStatuses: []}), error => error.status === 503); rejectedAsExpected++;
          } else if (mode === 6) {
            timer = setTimeout(() => controller.abort(), 35);
            await assert.rejects(safe.fetchTextWithRetry(`${base}/backoff?id=${id}`, {...requestOptions, retries: 2, signal: controller.signal}), error => error.name === 'AbortError'); rejectedAsExpected++;
          } else {
            const value = await first.firstSuccessful(['stall', 'ok', 'stall'].map((kind, n) => async signal => {
              const ip = await routeProbeApi.fetchRouteProbeIp('lab', consume => safe.fetchWithRetry(`${base}/${kind}?id=${id}-${n}`, {...requestOptions, signal}, consume));
              if (!ip) throw new Error('invalid lab IP'); return ip;
            }));
            assert.equal(value, '203.0.113.1');
          }
          completed++;
        } catch (error) {errors.push({id, mode, error: error.message});}
        finally {clearTimeout(timer);(latencies[mode] ??= []).push(performance.now()-begin);}
      });
      await delay(40);
      samples.push({...await resourceSnapshot(`after batch ${batch+1}`), serverSockets: sockets.size});
    }
    assert.equal(requestsByPath['/neverretry'], 192); assert.equal(requestsByPath['/backoff'], 192);
    assert.equal(requestsByPath['/retry'], 384);
    result.phases.push({id: 'http', kind: 'actual loopback HTTP', plannedOperations: 1536, completed, rejectedAsExpected, requestCount: Object.values(requestsByPath).reduce((a,b)=>a+b,0), requestsByPath, errors, durationMs: performance.now()-started,
      latencyByScenarioMs: Object.fromEntries(Object.entries(latencies).map(([key, values]) => [key, summary(values)])),
      scenarioMap: ['ok', 'delayed stream', 'size rejection', 'whole body timeout', '503 then success', '503 retry forbidden', 'caller abort in 1s backoff', 'fast IP wins; two stalled losers cancelled'],
      eventLoopDelayMs: {p95: eventLoop.percentile(95)/1e6, max: eventLoop.max/1e6}, peakRss, samples});
    if (errors.length) result.failures.push({phase: 'http', count: errors.length});
  } finally {
    clearInterval(sampler); eventLoop.disable(); for (const timer of timers) clearTimeout(timer);
    await agent.destroy(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); await delay(20);
    result.phases.at(-1).ownServerSocketsAfterClose = sockets.size;
  }
}

// Real TLS sockets, with an explicitly trusted own lab certificate.
{
  const started = performance.now(), sockets = new Set();
  const cert = await fs.readFile(path.join(work, 'lab.crt')), key = await fs.readFile(path.join(work, 'lab.key'));
  const httpsServer = https.createServer({cert,key}, (request,response) => {
    request.resume(); request.on('end', () => {
      if (request.url === '/stall') {response.writeHead(200); response.flushHeaders();}
      else if (request.url === '/chunked') {response.writeHead(200); for (let i=0;i<10;i++) response.write(Buffer.alloc(100,97)); response.end();}
      else response.end(Buffer.alloc(2048,97));
    });
  });
  httpsServer.on('connection', socket => {sockets.add(socket); socket.on('close',()=>sockets.delete(socket));});
  await new Promise(resolve => httpsServer.listen(0, '127.0.0.1', resolve));
  const labTls = {...tls, connect: (options,callback) => tls.connect({...options, host: options.host === 'localhost' ? '127.0.0.1' : options.host, ca: cert}, callback)};
  const api = vpn({tls:labTls}), endpoint = {name:'own TLS lab',host:'localhost',port:httpsServer.address().port,path:'/',bytes:1024};
  let completed=0,cancelled=0; const errors=[], samples=[];
  try {
    for(let batch=0;batch<8;batch++){
      await pool(32,async index=>{
        const controller=new AbortController();let timer;
        try{
          const mode=index%4;
          if(mode===0){assert.equal((await api.measureDownloadEndpoint(endpoint,null,0,controller.signal)).bytes,1024);}
          else if(mode===1){assert.equal((await api.measureUploadEndpoint(endpoint,null,controller.signal)).uploadBytes,1024);}
          else if(mode===2){assert((await api.measureRouteLatency(endpoint,null,controller.signal))>0);}
          else{timer=setTimeout(()=>controller.abort(),35);await assert.rejects(api.measureDownloadEndpoint({...endpoint,path:'/stall'},null,0,controller.signal),error=>error.name==='SpeedtestCancelledError');cancelled++;}
          completed++;
        }catch(error){errors.push({batch,index,error:error.message});}finally{clearTimeout(timer);}
      },8);
      await delay(40);samples.push({...await resourceSnapshot(`TLS batch ${batch+1}`),serverSockets:sockets.size});
    }
    const chunked = await api.measureDownloadEndpoint({...endpoint,path:'/chunked',bytes:1024*1024},null,0);
    result.findings.push({id:'NET-05',evidenceStatus:'reproduced-real-loopback-TLS',observed:chunked.bytes,expectedPayloadBytes:1000,detail:'Raw HTTP chunk framing is counted as downloaded payload.'});
    result.phases.push({id:'tls',kind:'actual loopback TLS HTTP',plannedOperations:256,completed,cancelled,errors,durationMs:performance.now()-started,samples});
    if(errors.length)result.failures.push({phase:'tls',count:errors.length});
  }finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>httpsServer.close(resolve));await delay(20);result.phases.at(-1).ownServerSocketsAfterClose=sockets.size;}
}

// Real UDP response parsing. The negative lab is not a simulation of installed DoH.
{
  const started=performance.now(), api=loadRecovered('electron/ipc/gravityless-dns-manager',{promisify:fn=>fn,execFile(){},dgram},['queryDnsARecord']);
  const server=dgram.createSocket('udp4');let mode='valid',requests=0;
  server.on('message',(query,remote)=>{
    requests++;
    if(mode==='valid'){
      const answer=Buffer.from([0xc0,0x0c,0,1,0,1,0,0,0,30,0,4,203,0,113,53]);
      const reply=Buffer.concat([query,answer]);reply.writeUInt16BE(0x8180,2);reply.writeUInt16BE(1,6);server.send(reply,remote.port,remote.address);
    }else{const reply=Buffer.alloc(12);reply.writeUInt16BE(query.readUInt16BE(0),0);reply.writeUInt16BE(0x8180,2);reply.writeUInt16BE(1,6);server.send(reply,remote.port,remote.address);}
  });
  await new Promise(resolve=>server.bind(0,'127.0.0.1',resolve));let validAccepted=0,truncatedAccepted=0;
  try{
    await pool(128,async()=>{if(await api.queryDnsARecord('example.com','127.0.0.1',server.address().port,500))validAccepted++;});
    mode='header-only';await pool(32,async()=>{if(await api.queryDnsARecord('example.com','127.0.0.1',server.address().port,500))truncatedAccepted++;});
    result.phases.push({id:'udp',kind:'actual loopback UDP DNS',requests,validAccepted,expectedValid:128,truncatedAccepted,expectedTruncatedAccepted:0,durationMs:performance.now()-started});
    result.findings.push({id:'NET-01',evidenceStatus:'reproduced-real-loopback-UDP',observedAccepted:truncatedAccepted,outOf:32,expected:0,replyBytes:12,actualAnswerRecords:0});
  }finally{await new Promise(resolve=>server.close(resolve));}
}

// Real FS callbacks under the actual coordinator, with controlled inspector inputs.
{
  const started=performance.now(),shared=loadRecovered('shared/dns-controller',{},['buildNetworkCombinatorInspection']);
  const {NetworkCombinatorManager}=loadRecovered('electron/ipc/network-combinator-manager',shared,['NetworkCombinatorManager']);
  const manager=new NetworkCombinatorManager({isElevated:async()=>false,getProductVersion:()=> '3.8.0',moduleInspectors:{}});
  const dir=path.join(work,'coordinator-files');await fs.mkdir(dir,{recursive:true});
  const active=new Map(),peaks=new Map(), errors=[];let completed=0,intendedFaults=0;
  await pool(384,async index=>{
    const lock=`lab-${index%4}`;
    try{
      await manager.runCoordinatedMutation({module:'updates',action:'lab-only-write',requiredLocks:[lock],waitTimeoutMs:10000},async()=>{
        const count=(active.get(lock)??0)+1;active.set(lock,count);peaks.set(lock,Math.max(peaks.get(lock)??0,count));assert.equal(count,1);
        try{await fs.writeFile(path.join(dir,`${index}.json`),JSON.stringify({index}));const observed=JSON.parse(await fs.readFile(path.join(dir,`${index}.json`)));assert.equal(observed.index,index);if(index%7===0)throw new Error('intended lab fault');}
        finally{active.set(lock,active.get(lock)-1);}
      });completed++;
    }catch(error){if(error.message==='intended lab fault')intendedFaults++;else errors.push({index,error:error.message});}
  });
  result.phases.push({id:'coordinator',kind:'actual coordinator + own real filesystem; inspectors deliberately controlled lab',plannedOperations:384,completed,intendedFaults,errors,durationMs:performance.now()-started,peakConcurrentPerLock:Object.fromEntries(peaks),activeAfter:manager.activeCoordinatedMutations.size,waitersAfter:manager.mutationReleaseWaiters.size,outstandingAfter:manager.outstandingCoordinatedMutations,idleAfter:manager.isMutationIdle()});
  if(errors.length||manager.activeCoordinatedMutations.size||manager.mutationReleaseWaiters.size||!manager.isMutationIdle())result.failures.push({phase:'coordinator',count:errors.length});
}

// Pure config/generation invariants, explicitly separate from real OS/network work.
{
  const started=performance.now(),{ConfigBuilder}=loadRecovered('electron/ipc/config-builder',{},['ConfigBuilder']);
  const {VpnReconnectSupervisor,classifyReconnectFailure}=loadRecovered('electron/ipc/vpn-reconnect-supervisor',{},['VpnReconnectSupervisor','classifyReconnectFailure']);
  let configs=0,generations=0;const errors=[];
  for(let index=0;index<2500;index++){
    try{
      const node={protocol:index%2?'trojan':'vless',server:`node-${index}.cloudpath.live`,port:1024+index,metadata:{id:'11111111-1111-4111-8111-111111111111',password:`lab-password-${index}`,security:'tls',sni:`front-${index}.cloudpath.live`}};
      const settings={dnsMode:'system',routeMode:'global',useTunMode:false};
      const xray=JSON.parse(ConfigBuilder.buildXray(node,[],settings,10809,10808,10085)).outbounds[0];
      const sing=JSON.parse(ConfigBuilder.buildSingBox(node,[],[],settings,10809)).outbounds[0];
      const address=xray.settings.vnext?.[0]?.address??xray.settings.servers?.[0]?.address;
      assert.equal(address,node.server);assert.equal(xray.streamSettings.tlsSettings.serverName,node.metadata.sni);assert.equal(sing.server,node.server);assert.equal(sing.tls.server_name,node.metadata.sni);configs+=2;
    }catch(error){errors.push({index,kind:'config',error:error.message});}
  }
  for(let index=0;index<1000;index++){
    const supervisor=new VpnReconnectSupervisor({readEnabled:()=>true,getStatus:async()=>({connected:false,egressVerified:false}),reconnect:async()=>({connected:true,egressVerified:true})});
    const old=supervisor.beginManualConnect();supervisor.cancel('lab explicit disconnect');supervisor.recordConnectionResult({connected:true,egressVerified:true},old);
    assert.equal(supervisor.snapshot().armed,false);
    const current=supervisor.beginManualConnect();supervisor.recordConnectionResult({connected:true,egressVerified:true},old);assert.equal(supervisor.snapshot().phase,'reconnecting');
    supervisor.recordConnectionResult({connected:true,egressVerified:true},current);assert.equal(supervisor.snapshot().armed,true);supervisor.stop();generations++;
  }
  const ipv6=route.buildRouteProbeResult({directIp:'2001:db8:0:0:0:0:0:1',vpnIp:'2001:db8::1',mode:'system_proxy',expectedEndpoint:'127.0.0.1:10809',systemProxy:{enabled:true,ownedByApp:true,proxyServer:'127.0.0.1:10809'}});
  result.findings.push({id:'NET-02',evidenceStatus:'reproduced-source-function',actual:ipv6.verdict,egressChanged:ipv6.checks.find(check=>check.id==='egress-changed').status,semanticAddressEqual:true});
  const badReasons=['connect ECONNREFUSED 203.0.113.40:40123','connect ETIMEDOUT 203.0.113.40:40301'];
  result.findings.push({id:'NET-04',evidenceStatus:'reproduced-source-function',cases:badReasons.map(reason=>({reason,actual:classifyReconnectFailure(reason),expected:'network'}))});
  result.phases.push({id:'pure-invariants',kind:'actual pure source functions; no OS uptime implication',generatedConfigs:configs,generationScenarios:generations,errors,durationMs:performance.now()-started});
  if(errors.length)result.failures.push({phase:'pure-invariants',count:errors.length});
}

// Absolute-deadline gap before HTTP CONNECT finishes (actual own byte-drip server).
{
  const server=http.createServer(), sockets=new Set(), timers=new Set();
  server.on('connect',(_request,socket)=>{socket.write('HTTP/1.1 200 Connection Established\r\nX-Drip: ');const timer=setInterval(()=>socket.write('.'),10);timers.add(timer);socket.on('close',()=>{clearInterval(timer);timers.delete(timer);});});
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const controller=new AbortController(),started=performance.now();let settled=false;
  const pending=vpn().openRouteProbeTls({name:'own drip lab',host:'localhost',port:443},server.address().port,40,controller.signal).then(()=>{settled=true;return 'connected';},error=>{settled=true;return error.message;});
  try{await delay(190);const remainedPending=!settled,observedAtMs=performance.now()-started;controller.abort();const final=await pending;result.findings.push({id:'NET-03',evidenceStatus:'reproduced-real-loopback-CONNECT',inactivityTimeoutMs:40,observedAtMs,remainedPending,manualAbortResult:final,settledAtMs:performance.now()-started});}
  finally{controller.abort();for(const timer of timers)clearInterval(timer);for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
}
await delay(80);
result.finalResources=await resourceSnapshot('all own servers and dispatchers closed');
result.completedAt=new Date().toISOString();result.findingCount=result.findings.length;
result.successfulChecksDoNotEraseFindings=result.findings.length>0;
await fs.writeFile(path.join(work,'network-stress.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({sourceHead:result.sourceHead,phases:result.phases.map(({id,kind,completed,plannedOperations,durationMs,errors,generatedConfigs,generationScenarios})=>({id,kind,completed,plannedOperations,durationMs,errorCount:errors?.length,generatedConfigs,generationScenarios})),findings:result.findings,failures:result.failures},null,2));
process.exitCode=result.failures.length?1:0;
