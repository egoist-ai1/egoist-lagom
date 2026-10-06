import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { createDpiScope, compileDpiScope, assertDpiPreview, dpiPackets } from './windows-dpi-native-acceptance.mjs';

const root = path.resolve(import.meta.dirname, '..');
const helper = path.join(root, 'tests/windows-dpi-native-acceptance.mjs');
const script = path.join(root, 'tests/windows-dpi-native-acceptance.ps1');
const workDir = 'C:\\ProgramData\\EgoistShield\\Runtime\\Zapret';
const quoted = value => "'" + value.replaceAll("'", "''") + "'";
const scoped = compileDpiScope(createDpiScope(49191), workDir, root);

test('actual production compiler preserves the single held-port raw kernel scope', () => {
  assert.equal(scoped.argv.filter(argument => argument.startsWith('--wf-raw=')).length, 1);
  assert.equal(scoped.argv.find(argument => argument.startsWith('--wf-raw=')), '--wf-raw=' + scoped.kernel);
  assert.equal(scoped.argv.find(argument => argument.startsWith('--filter-tcp=')), '--filter-tcp=49191');
  assert.ok(!scoped.argv.some(argument => /--wf-udp|--wf-raw-part|--new|--hostlist|--filter-udp|@/.test(argument)));
  assert.equal(scoped.argv.filter(argument => argument.startsWith('--ipset-exclude=')).length, 2);
  assertDpiPreview('winws.exe ' + scoped.args, scoped, root);
});

test('production preview/runtime argv rejects broadening, injected flags and foreign executable', () => {
  const valid = 'winws.exe ' + scoped.args;
  for (const unsafe of [
    valid + ' --wf-udp=443', valid + ' --wf-raw=true', valid.replace('49191', '443'),
    valid.replace('!impostor', 'impostor'), valid + ' --wf-raw-part=@C:\\foreign-filter.txt',
    valid + ' --new --filter-tcp=443', 'cmd.exe /c ' + valid, valid + '\nsc.exe start foreign',
  ]) assert.throws(() => assertDpiPreview(unsafe, scoped, root));
  const expected = path.win32.join(workDir, 'core', 'bin', 'winws.exe');
  assertDpiPreview('"' + expected + '" ' + scoped.args, scoped, root, expected);
  assert.throws(() => assertDpiPreview('"C:\\foreign\\winws.exe" ' + scoped.args, scoped, root, expected));
});

test('scope rejects invalid ports; packet negatives include host-control traffic', () => {
  for (const port of [0, 443, 49151, 65536, 50000.5, NaN, '49191']) assert.throws(() => createDpiScope(port));
  assert.equal(createDpiScope(49152).port, 49152);
  assert.equal(createDpiScope(65535).port, 65535);
  const packets = dpiPackets(49191);
  assert.equal(packets.filter(item => item.expected).length, 2);
  for (const name of ['https-control', 'dns-control', 'physical-remote', 'different-local-address', 'impostor', 'ipv6'])
    assert.equal(packets.find(item => item.name === name).expected, false, name);
  // Input fixtures only. Native CI calls pinned real HelperEvalFilter;
  // no invented local predicate substitutes for real filter evaluation.
  assert.equal(Buffer.from(packets[0].packet, 'base64').readUInt16BE(22), 49191);
});

test('actual own fixture holds its port, verifies 20 nonces and retires after stdin closes', { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, [helper, 'Fixture'], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const input = createInterface({ input: child.stdout });
  const lines = input[Symbol.asyncIterator]();
  let stderr = ''; child.stderr.on('data', data => { stderr += data; });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const deadline = async promise => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Owned fixture deadline')), 6000); timer.unref(); })]);
  try {
    const ready = JSON.parse((await deadline(lines.next())).value);
    assert.equal(ready.processId, child.pid);
    assert.ok(ready.port >= 49152 && ready.port <= 65535);
    for (let index = 0; index < 20; index++) {
      const nonce = randomBytes(24).toString('hex'), id = 'unit-' + index;
      child.stdin.write(JSON.stringify({ operation: 'probe', nonce, id }) + '\n');
      const reply = JSON.parse((await deadline(lines.next())).value);
      assert.deepEqual(reply, { id, ok: true, nonce, port: ready.port });
    }
    const net = await import('node:net');
    const competitor = net.createServer();
    const collision = await new Promise(resolve => { competitor.once('error', resolve); competitor.listen({ host: '127.0.0.1', port: ready.port, exclusive: true }, () => resolve(null)); });
    competitor.close();
    assert.equal(collision?.code, 'EADDRINUSE');
    child.stdin.end();
    assert.deepEqual(await deadline(exit), { code: 0, signal: null }, stderr);
  } finally {
    input.close();
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await deadline(exit); }
  }
});

const powershell = process.env.LAGOM_TEST_POWERSHELL7 || 'pwsh.exe';
const ownTemp = process.env.LAGOM_TEST_TEMP || path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'lagom-dpi-guard-' + process.pid);
function runPowerShell(code) {
  return execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], {
    cwd: root, windowsHide: true, timeout: 30000, encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'false', LAGOM_TEST_TEMP: ownTemp },
  });
}
test('PS7 C# compiles without DLL/driver open; owned child identity, deadline and retirement guards discriminate', { skip: process.platform !== 'win32', timeout: 40000 }, () => {
  fs.mkdirSync(ownTemp, { recursive: true });
  const code = [
    "$ErrorActionPreference='Stop'",
    '. ' + quoted(script) + ' -LibraryOnly',
    'Initialize-DpiNativeTypes',
    '$script:Work=' + quoted(ownTemp) + ';$env:GITHUB_WORKSPACE=' + quoted(root),
    '$script:DpiClock=[Diagnostics.Stopwatch]::StartNew();$script:DpiBudget=30',
    '$child=Start-DpiChild ' + quoted(process.execPath) + ' @(' + quoted(helper) + ",'Fixture') 'own guard fixture'",
    '$cases=@()',
    'try {',
    '$ready=Read-DpiLine $child 8',
    'if($ready.processId -ne $child.process.Id){throw "Own readiness identity mismatch"}',
    '[void](Assert-DpiHeldProcess $child);$cases+="held-path-and-birth"',
    '$born=$child.birthTicks;$child.birthTicks--;$denied=$false;try{[void](Assert-DpiHeldProcess $child)}catch{$denied=$true};$child.birthTicks=$born;if(-not $denied){throw "Wrong birth admitted"};$cases+="wrong-birth-denied"',
    '$image=$child.executable;$child.executable="C:\\foreign\\node.exe";$denied=$false;try{[void](Assert-DpiHeldProcess $child)}catch{$denied=$true};$child.executable=$image;if(-not $denied){throw "Foreign image admitted"};$cases+="wrong-image-denied"',
    '$script:DpiBudget=0;$denied=$false;try{Assert-DpiDeadline}catch{$denied=$true};$script:DpiBudget=30;if(-not $denied){throw "Expired admission accepted"};$cases+="deadline-denied"',
    '}finally{Stop-DpiOwnedChild $child}',
    '$cases+="actual-owned-retirement"',
    '[ordered]@{ok=$true;nativeActions=0;cases=$cases;driverOpenInvoked=$false;dllLoaded=$false} | ConvertTo-Json -Compress',
  ].join('\n');
  const receipt = JSON.parse(runPowerShell(code).trim());
  assert.equal(receipt.ok, true);
  assert.equal(receipt.nativeActions, 0);
  assert.equal(receipt.cases.length, 5);
});
test('native entry refuses unsupported environment before file/native action; pure supported-host contract is explicit', { skip: process.platform !== 'win32' }, () => {
  const code = [
    "$ErrorActionPreference='Stop'",
    '. ' + quoted(script) + ' -LibraryOnly',
    "$environment=@{GITHUB_ACTIONS='true';CI='true';RUNNER_ENVIRONMENT='github-hosted';RUNNER_OS='Windows';GITHUB_REPOSITORY='egoist-ai1/egoist-lagom';GITHUB_RUN_ID='12';GITHUB_RUN_ATTEMPT='1';GITHUB_SHA=('a'*40)}",
    'if(@(Get-DpiEnvironmentErrors $environment $true $true 7 $true).Count){throw "Supported host contract rejected"}',
    '$environment.RUNNER_ENVIRONMENT="self-hosted";if(@(Get-DpiEnvironmentErrors $environment $true $true 7 $true).Count -ne 1){throw "Self-hosted admitted"}',
    'if(@(Get-DpiEnvironmentErrors $environment $false $true 5 $false).Count -lt 4){throw "Privilege/runtime guard missing"}',
    '$denied=$false;try{Invoke-DpiAcceptance}catch{if($_.Exception.Message -notmatch "host guard refused"){throw};$denied=$true}',
    'if(-not $denied){throw "Unsupported native entry accepted"}',
    '[ordered]@{ok=$true;nativeActions=0;fileMutations=0} | ConvertTo-Json -Compress',
  ].join('\n');
  assert.deepEqual(JSON.parse(runPowerShell(code).trim()), { ok: true, nativeActions: 0, fileMutations: 0 });
});