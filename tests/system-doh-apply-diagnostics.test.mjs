import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { sourceFor } from './load-recovered.mjs';

const source = sourceFor('electron/ipc/handlers-system');
const plain = value => JSON.parse(JSON.stringify(value));
const secret = 'PRIVATE_CREDENTIAL_HTTPS_AND_DNS_GRAPH';
function fixture(options = {}) {
  const effects = [], logs = [], handlers = new Map();
  const control = { now: 1000, ...options };
  const ready = { nativeManaged: true, running: true, verified: true, localAddress: '1.1.1.1' };
  const status = { ...ready, fixture: 'unchanged-return-contract' };
  const broker = {
    async request(operation, payload) {
      effects.push(operation);
      assert.equal(operation, 'hello'); assert.deepEqual(plain(payload), {});
      if (control.helloError) throw control.helloError;
      return { protocolVersion: 1, clientPid: 731, identityProbe: false, developmentOverride: false };
    }
  };
  const manager = {
    async apply() { effects.push('manager-apply'); control.now += 37; if (control.managerError) throw control.managerError; return control.started ?? ready; },
    async status() { effects.push('manager-status'); control.now += 11; if (control.statusError) throw control.statusError; return control.final ?? status; }
  };
  const store = {
    get: () => ({ settings: { systemDnsServers: '', systemDohEnabled: false, systemDohLocalAddress: '' } }),
    async patchSettings(patch) {
      effects.push('persist-settings'); control.now += 19;
      if (control.persistError) return { ok: false, error: control.persistError };
      return { ok: true, state: { settings: plain(patch) } };
    }
  };
  const logger = { debug() {}, info() {}, error() {}, warn(...args) {
    assert.equal(args[0], '[system-doh-apply-diagnostic]');
    assert.equal(args.length, 2); assert.equal(typeof args[1], 'string');
    if (control.loggerThrows) throw new Error(secret);
    assert.ok(args[1].length < 1024);
    logs.push(JSON.parse(args[1]));
  }};
  const context = vm.createContext({
    logger, Error, JSON, process: { platform: 'win32', pid: 731, env: { NODE_ENV: 'production' } },
    Date: class extends Date { static now() { if (control.clockThrows) throw new Error(secret); return control.now; } },
    promisify: value => value,
    execFile: async (_executable, args, invocationOptions) => {
      effects.push('rollback-snapshot');
      assert.deepEqual(plain(invocationOptions), { timeout: 15000, maxBuffer: 1048576, windowsHide: true });
      assert.deepEqual(plain(args.slice(0, 3)), ['-NoProfile', '-NonInteractive', '-Command']);
      assert.match(args[3], /Get-DnsClientServerAddress/);
      control.now += control.snapshotError ? 15000 : 13;
      if (control.snapshotError) throw control.snapshotError;
      return { stdout: control.snapshotText ?? '[{"InterfaceAlias":"Inert fixture","InterfaceIndex":7,"AddressFamily":2,"ServerAddresses":["192.0.2.53"]}]' };
    },
    CoreServiceClient: class {},
    path: { join: () => '<inert first-run marker>' }, app: { isPackaged: true, getPath: () => '<inert userData>' }, ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    getSystemDohServiceBroker: () => control.noBroker ? null : broker,
    SystemDohUrlInputSchema: { parse: value => { if (control.parseError) throw control.parseError; return value; } },
    isGravitylessLoopbackDnsRequest: () => false,
    createAdapterDnsRollbackSnapshot: (rows, reason) => ({ records: rows.length, reason }),
    resolveWindowsExecutable: value => value,
    SYSTEM_DOH_VERIFICATION_DOMAINS: ['fixture.invalid'],
    ShieldConnectionController: class {},
    runtime: { on() {} }, manager, store,
    coordinator: { async runCoordinatedMutation(intent, operation) {
      effects.push('coordinate');
      assert.equal(intent.module, 'dns'); assert.equal(intent.action, 'system-doh-apply');
      if (control.coordinateError) throw control.coordinateError;
      return operation();
    }}
  });
  vm.runInContext(source, context, { timeout: 1000 });
  vm.runInContext('registerSystemHandlers({window:{},stateStore:store,runtimeManager:runtime,systemDohManager:manager,networkCombinatorManager:coordinator});', context, { timeout: 1000 });
  return { effects, logs, status, invoke: () => handlers.get('system-doh:apply')({}, 'https://fixture.invalid/dns-query') };
}
function diagnostic(f, phase) {
  assert.equal(f.logs.length, 1);
  const row = f.logs[0];
  assert.deepEqual(Object.keys(row).sort(), ['action','cause','elapsedMs','error','outcome','phase','schemaVersion']);
  assert.equal(row.schemaVersion, 1); assert.equal(row.action, 'system-doh-apply'); assert.equal(row.phase, phase);
  assert.ok(Number.isInteger(row.elapsedMs) && row.elapsedMs >= 0);
  assert.equal(JSON.stringify(row).includes(secret), false);
  return row;
}
test('real handler captures hidden snapshot timeout cause before mapping and never applies', {timeout:5000}, async () => {
  const child = Object.assign(new Error(secret), { code: 'ETIMEDOUT', killed: true, signal: 'SIGTERM', stdout: secret, stderr: secret });
  const f = fixture({ snapshotError: child });
  const result = await f.invoke();
  assert.equal(result.ok, false); assert.match(result.message, /15 секунд/); assert.equal(result.status, f.status);
  assert.deepEqual(f.effects, ['coordinate','hello','rollback-snapshot','manager-status']);
  const row = diagnostic(f, 'rollback-snapshot');
  assert.equal(row.elapsedMs, 15000); assert.equal(row.error.name, 'Error');
  assert.deepEqual(row.cause, { name:'Error',code:'ETIMEDOUT',killed:true,signal:'SIGTERM' });
});
test('real snapshot JSON parser failure retains its refusal and phase', {timeout:5000}, async () => {
  const f = fixture({ snapshotText: '{ invalid-json' });
  const result = await f.invoke();
  assert.equal(result.ok, false); assert.equal(result.status, f.status);
  assert.deepEqual(f.effects, ['coordinate','hello','rollback-snapshot','manager-status']);
  assert.equal(diagnostic(f, 'rollback-snapshot').error.name, 'SyntaxError');
});
test('manager failure records only one classified cause and leaves caller result unchanged', {timeout:5000}, async () => {
  const grandchild = Object.assign(new Error(secret), { code: 'EACCES', config: secret });
  const cause = Object.assign(new Error(secret, { cause: grandchild }), { code:'ECONNRESET',killed:false,signal:null });
  const original = Object.assign(new Error(secret, { cause }), { code:'OPERATION_FAILED',request:secret });
  const f = fixture({ managerError: original });
  const result = await f.invoke();
  assert.equal(result.ok, false); assert.equal(result.message, secret); assert.equal(result.status, f.status);
  assert.equal(f.effects.includes('persist-settings'), false);
  const row = diagnostic(f, 'manager-apply');
  assert.equal(row.error.code, 'OPERATION_FAILED'); assert.equal(row.cause.code, 'ECONNRESET');
  assert.deepEqual(Object.keys(row.cause).sort(), ['code','killed','name','signal']);
});
test('failed started status and failed final status have distinct real phases', {timeout:5000}, async () => {
  const first = fixture({ started:{nativeManaged:true,localAddress:'1.1.1.1',running:false,verified:false} });
  assert.equal((await first.invoke()).ok, false);
  assert.equal(diagnostic(first, 'verify-started-status').error.name, 'Error');
  const last = fixture({ final:{...{nativeManaged:true,localAddress:'1.1.1.1'},running:false,verified:false} });
  assert.equal((await last.invoke()).ok, false);
  diagnostic(last, 'verify-final-status');
  assert.equal(first.effects.includes('persist-settings'), false); assert.equal(last.effects.includes('persist-settings'), false);
});
test('settings refusal retains error/result and reports persist boundary only', {timeout:5000}, async () => {
  const f = fixture({ persistError: secret });
  const result = await f.invoke();
  assert.equal(result.ok, false); assert.equal(result.message, secret); assert.equal(result.status, f.status);
  diagnostic(f, 'persist-settings');
  assert.equal(f.effects.filter(x=>x==='persist-settings').length, 1);
});
test('coordination refusal preserves NETWORK_BUSY and reports original safe metadata before mapping', {timeout:5000}, async () => {
  const f = fixture({ coordinateError:Object.assign(new Error('Timed out inspecting network owners before mutation: '+secret),{code:'ETIMEDOUT',killed:true,signal:'SIGTERM'}) });
  const result = await f.invoke();
  assert.equal(result.ok, false); assert.equal(result.retryable, true); assert.equal(result.code, 'NETWORK_BUSY'); assert.equal(result.status, null);
  assert.deepEqual(f.effects, ['coordinate']);
  assert.equal(diagnostic(f, 'coordinate').error.code, 'ETIMEDOUT');
});
test('access-return refusal never starts snapshot/manager and discloses no rejected hello', {timeout:5000}, async () => {
  const f = fixture({ helloError:Object.assign(new Error(secret),{code:'CLIENT_NOT_AUTHORIZED'}) });
  const result = await f.invoke();
  assert.equal(result.ok, false); assert.ok(result.message.includes(secret)); assert.equal(result.status, null);
  assert.deepEqual(f.effects, ['coordinate','hello']);
  const row = diagnostic(f, 'access-hello'); assert.equal(row.outcome, 'access-refused');
  assert.deepEqual(row.error, {name:'Error',code:'CLIENT_NOT_AUTHORIZED',killed:null,signal:null});
  const missing=fixture({noBroker:true}); assert.equal((await missing.invoke()).ok,false);
  assert.deepEqual(missing.effects,['coordinate']);
  assert.deepEqual(diagnostic(missing,'access-hello').error,{name:null,code:null,killed:null,signal:null});
});
test('unknown metadata is classified and Error/cause getters are never evaluated', {timeout:5000}, async () => {
  let getters = 0;
  const original = new Error(secret);
  Object.defineProperty(original, 'name', { value:secret });
  Object.defineProperty(original, 'code', { value:secret });
  Object.defineProperty(original, 'signal', { value:secret });
  Object.defineProperty(original, 'killed', { get(){getters++;return secret;} });
  Object.defineProperty(original, 'cause', { get(){getters++;return {credentials:secret};} });
  const f = fixture({ managerError: original });
  assert.equal((await f.invoke()).message, secret);
  const row = diagnostic(f, 'manager-apply');
  assert.deepEqual(row.error, {name:'OtherError',code:'OTHER',killed:null,signal:'OTHER'}); assert.equal(row.cause,null); assert.equal(getters,0);
});
test('logger failure preserves exact existing snapshot refusal and manager-status callback', {timeout:5000}, async () => {
  const child = Object.assign(new Error(secret), {killed:true,code:9,signal:'SIGTERM'});
  const ordinary = fixture({snapshotError:child});
  const failingLogger = fixture({snapshotError:child,loggerThrows:true});
  assert.deepEqual(plain(await failingLogger.invoke()), plain(await ordinary.invoke()));
  assert.deepEqual(failingLogger.effects, ordinary.effects); assert.equal(failingLogger.logs.length,0);
});
test('successful real handler keeps original callback order and emits no failure diagnostic', {timeout:5000}, async () => {
  const f = fixture();
  const result = await f.invoke();
  assert.equal(result.ok,true); assert.equal(result.status,f.status);
  assert.deepEqual(plain(result.rollbackSnapshot), {records:1,reason:'system-doh-apply'});
  assert.deepEqual(f.effects,['coordinate','hello','rollback-snapshot','manager-apply','manager-status','persist-settings']);
  assert.equal(f.logs.length,0);
});

test('throwing telemetry clock preserves the original successful result and callback order', {timeout:5000}, async () => {
  const ordinary = fixture();
  const throwingClock = fixture({clockThrows:true});
  assert.deepEqual(plain(await throwingClock.invoke()), plain(await ordinary.invoke()));
  assert.deepEqual(throwingClock.effects, ordinary.effects);
  assert.equal(throwingClock.logs.length,0);
});
test('unavailable diagnostic timing emits null and never masks the original failure', {timeout:5000}, async () => {
  const error=Object.assign(new Error(secret),{code:'ETIMEDOUT',killed:true,signal:'SIGTERM'});
  const ordinary=fixture({snapshotError:error});
  const throwingClock=fixture({snapshotError:error,clockThrows:true});
  assert.deepEqual(plain(await throwingClock.invoke()),plain(await ordinary.invoke()));
  assert.deepEqual(throwingClock.effects,ordinary.effects);
  assert.equal(throwingClock.logs.length,1);
  assert.equal(throwingClock.logs[0].phase,'rollback-snapshot');
  assert.equal(throwingClock.logs[0].elapsedMs,null);
  assert.equal(throwingClock.logs[0].cause.killed,true);
});
