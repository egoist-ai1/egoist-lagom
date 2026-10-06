import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { startNonceSocksFixture, selfTestSocksFixture } from './windows-vpn-production-acceptance.mjs';
const command = promisify(execFile), testsRoot = path.dirname(fileURLToPath(import.meta.url));

test('owned SOCKS control rejects forged identity, unknown operations and replay without changing availability', async () => {
  const protocol = await selfTestSocksFixture(); assert.equal(protocol.cases, 9); assert.equal(protocol.externalDial, false);
  const fixture = await startNonceSocksFixture(), nonce = randomBytes(24).toString('hex');
  try {
    const valid = { id: 1, operation: 'pause', nonce, instance: fixture.instance, processId: process.pid, port: fixture.port };
    for (const mismatch of [{ nonce: '0'.repeat(48) }, { instance: '0'.repeat(48) }, { processId: process.pid + 1 },
      { port: fixture.port + 1 }, { operation: 'stop-host-network' }, { id: 0 }, { unexpected: true }]) {
      assert.equal(fixture.control({ ...valid, ...mismatch }, nonce).ok, false);
      assert.equal(fixture.mode, 'available'); assert.equal(fixture.epoch, 0);
    }
    const competitor = createServer();
    const collision = await new Promise(resolve => { competitor.once('error', resolve); competitor.listen({ host: '127.0.0.1', port: fixture.port, exclusive: true }, () => resolve(null)); });
    competitor.close(); assert.equal(collision?.code, 'EADDRINUSE', 'Own fixture listener must remain exclusive');
    assert.equal(fixture.control(valid, nonce).ok, true); assert.equal(fixture.mode, 'paused');
    assert.equal(fixture.control(valid, nonce).ok, false); assert.equal(fixture.epoch, 1);
    assert.equal(fixture.control({ ...valid, id: 2, operation: 'resume' }, nonce).ok, true);
    assert.equal(fixture.mode, 'available'); assert.equal(fixture.epoch, 2);
  } finally { await fixture.close(); }
});

test('actual own loopback actor preserves held path/birth/port through controlled outage and drains normal retirement', {
  skip: process.platform !== 'win32', timeout: 140000,
}, async t => {
  const root = await fs.mkdtemp(path.join(process.env.SHIELD_TEST_WORK_ROOT || process.env.LAGOM_TEST_TEMP || os.tmpdir(), 'lagom-owned-upstream-'));
  const evidencePath = path.join(root, 'readonly-actor-receipt.json');
  const shell = process.env.LAGOM_TEST_POWERSHELL7 || 'pwsh.exe';
  const names = ['PSModulePath', 'SystemDrive', 'PATHEXT', 'TEMP', 'TMP'];
  const parentBefore = Object.fromEntries(names.map(name => [name, process.env[name]]));
  let result;
  try {
    result = await command(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(testsRoot, 'fixtures/vpn-owned-upstream-readonly.ps1'),
      '-TestsRoot', testsRoot, '-NodePath', process.execPath, '-WorkRoot', root, '-EvidencePath', evidencePath],
      { windowsHide: true, timeout: 120000, maxBuffer: 32768 });
  } catch (error) {
    // This is an own local actor request, never a repair/kill by process name.
    const options = JSON.parse(await fs.readFile(path.join(root, 'options.json'), 'utf8').catch(() => '{}'));
    if (options.workRoot === root && options.stopPath === path.join(root, 'stop.txt') && /^[a-f0-9]{48}$/.test(options.stopNonce || '')) {
      await fs.writeFile(options.stopPath, 'stop:' + options.stopNonce);
    }
    const receipt = JSON.parse(await fs.readFile(evidencePath, 'utf8').catch(() => '{}'));
    t.diagnostic(JSON.stringify({ stage: receipt.failure?.stage || 'outer-own-child-deadline', durationMs: receipt.durationMs, code: error.code, signal: error.signal }));
    assert.fail('Readonly own actor failed; stage/timing above. Forced retirement is never acceptance PASS.');
  }
  assert.equal(result.stderr, '');
  const receipt = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
  assert.equal(receipt.passed, true); assert.equal(receipt.nativeActions, 0); assert.equal(receipt.actualTunRuns, 0);
  assert.equal(receipt.nativeAcceptancePassed, false); assert.equal(receipt.externalDial, false);
  assert.equal(receipt.parentEnvironmentChanged, false); assert.equal(receipt.normalOwnRetirement, true);
  assert.equal(receipt.pendingOutputDrained, true); assert.equal(receipt.listenerAbsent, true);
  assert.equal(receipt.heldIdentity.unchangedPathBirth, true); assert.equal(receipt.heldIdentity.unchangedPort, true);
  assert.deepEqual(receipt.inertCases, ['birth', 'executable', 'listener-owner', 'primary-error-before-retirement']);
  assert.deepEqual(receipt.stages.filter(stage => stage.label).map(stage => stage.label), ['fresh-nonce-pass', 'peer-refused', 'fresh-nonce-pass']);
  assert.deepEqual(Object.fromEntries(names.map(name => [name, process.env[name]])), parentBefore);
  t.diagnostic(JSON.stringify({ kind: receipt.kind, durationMs: receipt.durationMs, phases: receipt.stages.filter(stage => stage.label), nativeActions: 0, nativeAcceptancePassed: false }));
  // Keep exact bytes/hash for source-bound CI evidence; no private installed data.
  const bytes = await fs.readFile(evidencePath); assert.match(createHash('sha256').update(bytes).digest('hex'), /^[a-f0-9]{64}$/);
});
