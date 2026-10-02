import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const source = fs.readFileSync(process.env.LAGOM_FAST_RECOVERY_SOURCE || 'src/recovered/electron/ipc/system-doh-service-manager.js', 'utf8');
function fixture() {
  const native = [];
  const context = vm.createContext({ URL, Buffer, console, process, path, setTimeout, clearTimeout,
    promisify: value => value,
    execFile: async (...args) => { native.push(args); return { stdout: '', stderr: '' }; },
    resolveWindowsExecutable: name => name,
  });
  vm.runInContext(source + '\n;globalThis.exports={SystemDohManager,buildSystemDohServiceXml};', context);
  const manager = Object.create(context.exports.SystemDohManager.prototype);
  const sc = [];
  manager.execSc = async (...args) => { sc.push(args); };
  return { ...context.exports, manager, sc, native };
}

test('actual DNS XML requests immediate first restart and bounds repeat failures', () => {
  const { buildSystemDohServiceXml } = fixture();
  const xml = buildSystemDohServiceXml({ runtimePath: 'C:\\fixture\\xray.exe', configPath: 'C:\\fixture\\private & config.json', workingDirectory: 'C:\\fixture', serviceLogDirectory: 'C:\\fixture\\logs' });
  assert.deepEqual([...xml.matchAll(/<onfailure action="restart" delay="(\d+) sec"\/>/g)].map(x => Number(x[1])), [0, 1, 60]);
  assert.match(xml, /<resetfailure>1 hour<\/resetfailure>/);
  assert.match(xml, /<arguments>run -c &quot;C:\\fixture\\private &amp; config.json&quot;<\/arguments>/);
});

test('actual DNS install method writes matching SCM actions, dependencies and failure flag', async () => {
  const { manager, sc, native } = fixture();
  await manager.configureServiceAutostartRecovery();
  assert.deepEqual(JSON.parse(JSON.stringify(sc)), [
    [['config', 'EgoistShieldSystemDoH', 'start=', 'auto'], false],
    [['failure', 'EgoistShieldSystemDoH', 'reset=', '3600', 'actions=', 'restart/0/restart/1000/restart/60000'], false],
    [['config', 'EgoistShieldSystemDoH', 'depend=', 'Tcpip/Afd'], false],
    [['failureflag', 'EgoistShieldSystemDoH', '1'], false],
  ]);
  assert.equal(native.length, 1);
  assert.deepEqual(Array.from(native[0][1]), ['add', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\EgoistShieldSystemDoH', '/v', 'DelayedAutoStart', '/t', 'REG_DWORD', '/d', '0', '/f']);
});

test('failed SCM failure-policy command prevents later dependency/registry writes', async () => {
  const { manager, sc, native } = fixture();
  manager.execSc = async args => { sc.push(Array.from(args)); if (args[0] === 'failure') throw new Error('controlled denied'); };
  await assert.rejects(manager.configureServiceAutostartRecovery(), /controlled denied/);
  assert.equal(sc.length, 2);
  assert.equal(native.length, 0);
});
