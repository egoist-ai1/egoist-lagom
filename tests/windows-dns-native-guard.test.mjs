import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dnsProviders, createProbeQuery, verifyProbeReply, analyzeCapture, normalizedIp } from './windows-dns-native-acceptance.mjs';

// Inert protocol bytes test the evidence parser. They are never native DNS proof.
const startedAtUtc = '2026-10-01T01:00:00.000Z', finishedAtUtc = '2026-10-01T01:00:01.000Z';
const options = { servers: ['1.1.1.1'], names: ['lagom-0123456789abcdef0123.example.com.'], startedAtUtc, finishedAtUtc };
function packet(outgoing, data = Buffer.from([23, 3, 3, 0, 10, ...Array(10).fill(42)]), port = 443, server = [1, 1, 1, 1]) {
  const buffer = Buffer.alloc(14 + 20 + 20 + data.length); buffer.writeUInt16BE(0x800, 12); buffer[14] = 0x45; buffer[23] = 6;
  Buffer.from(outgoing ? [10, 1, 2, 3] : server).copy(buffer, 26); Buffer.from(outgoing ? server : [10, 1, 2, 3]).copy(buffer, 30);
  buffer.writeUInt16BE(outgoing ? 45678 : port, 34); buffer.writeUInt16BE(outgoing ? port : 45678, 36); buffer[46] = 0x50; data.copy(buffer, 54); return buffer;
}
function capture(packets, { link = 1, stamp = Date.parse(startedAtUtc) + 500, big = false } = {}) {
  const blocks = []; const put16 = (b, v, o) => big ? b.writeUInt16BE(v, o) : b.writeUInt16LE(v, o); const put32 = (b, v, o) => big ? b.writeUInt32BE(v, o) : b.writeUInt32LE(v, o);
  const block = (type, length) => { const b = Buffer.alloc(length); put32(b, type, 0); put32(b, length, 4); put32(b, length, length - 4); return b; };
  const header = block(0x0a0d0d0a, 28); put32(header, 0x1a2b3c4d, 8); put16(header, 1, 12); header.fill(255, 16, 24); blocks.push(header);
  const iface = block(1, 20); put16(iface, link, 8); put32(iface, 256, 12); blocks.push(iface);
  for (const bytes of packets) {
    const b = block(6, 32 + Math.ceil(bytes.length / 4) * 4); const ticks = BigInt(stamp) * 1000n;
    put32(b, Number(ticks >> 32n), 12); put32(b, Number(ticks & 0xffffffffn), 16); put32(b, bytes.length, 20); put32(b, bytes.length, 24); bytes.copy(b, 28); blocks.push(b);
  }
  return Buffer.concat(blocks);
}

test('DNS provider contract is pinned to HTTPS URLs and documented v4/v6 pairs', () => {
  assert.equal(dnsProviders.Cloudflare.url, 'https://cloudflare-dns.com/dns-query');
  assert.deepEqual(dnsProviders.Quad9.ipv4, ['9.9.9.9', '149.112.112.112']);
  assert.equal(normalizedIp('2606:4700:4700::1111'), '2606:4700:4700:0:0:0:0:1111');
  assert.equal(normalizedIp('2620:fe:0:0:0:0:0:9'), normalizedIp('2620:fe::9'));
});
test('independent DNS wire preflight accepts matching positive reply and rejects incorrect protocol replies', () => {
  const query = createProbeQuery('example.com.', 123); const reply = Buffer.concat([Buffer.from(query), Buffer.alloc(16)]);
  reply.writeUInt16BE(0x8180, 2); reply.writeUInt16BE(1, 6); verifyProbeReply(reply, query);
  for (const [offset, value] of [[0, 124], [2, 0x8380], [2, 0x8183], [6, 0], [4, 2]]) {
    const wrong = Buffer.from(reply); wrong.writeUInt16BE(value, offset); assert.throws(() => verifyProbeReply(wrong, query));
  }
  const wrongQuestion = Buffer.from(reply); wrongQuestion[13] = 42; assert.throws(() => verifyProbeReply(wrongQuestion, query));
  assert.throws(() => createProbeQuery('https://wrong/')); assert.throws(() => verifyProbeReply(Buffer.alloc(65536), query));
});
test('packet parser requires bidirectional TLS at actual approved resolver in the query window', () => {
  for (const big of [false, true]) {
    const proof = analyzeCapture(capture([packet(true), packet(false)], { big }), options);
    assert.equal(proof.ok, true); assert.equal(proof.bidirectional.length, 1); assert.equal(proof.clearProbePackets, 0);
    assert.match(proof.claim, /not decrypted/);
  }
});
test('TCP443 without TLS, one direction, unrelated provider, or unrelated time cannot prove encrypted DNS', () => {
  for (const bytes of [capture([packet(true)]), capture([packet(true, Buffer.alloc(0)), packet(false, Buffer.alloc(0))]),
    capture([packet(true, undefined, 443, [8, 8, 8, 8]), packet(false, undefined, 443, [8, 8, 8, 8])]),
    capture([packet(true), packet(false)], { stamp: Date.parse(startedAtUtc) - 5000 })]) assert.equal(analyzeCapture(bytes, options).ok, false);
});
test('a matching plaintext TCP DNS probe makes TLS evidence fail', () => {
  const question = createProbeQuery(options.names[0], 456); const length = Buffer.alloc(2); length.writeUInt16BE(question.length);
  const proof = analyzeCapture(capture([packet(true), packet(false), packet(true, Buffer.concat([length, question]), 53)]), options);
  assert.equal(proof.ok, false); assert.equal(proof.clearProbePackets, 1);
});
test('truncated blocks, unsupported links and oversized snapshots fail closed', () => {
  const valid = capture([packet(true), packet(false)]);
  assert.throws(() => analyzeCapture(valid.subarray(0, valid.length - 1), options));
  assert.equal(analyzeCapture(capture([packet(true), packet(false)], { link: 999 }), options).ok, false);
  assert.throws(() => analyzeCapture(capture([packet(true, Buffer.alloc(257))]), options));
});

const shell = process.env.LAGOM_TEST_POWERSHELL || process.env.LAGOM_WINDOWS_POWERSHELL || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
function run(args) {
  const env = { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'self-hosted' };
  if (path.basename(shell).toLowerCase() === 'powershell.exe') for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
  return spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 15000 });
}
test('actual Run/GuardOnly/Guardian/Query invocation refuses physical non-hosted process before input or writes', { skip: process.platform !== 'win32' }, () => {
  for (const mode of ['Run', 'GuardOnly', 'EmergencyGuardian', 'QueryProbe']) {
    const result = run(['-File', path.resolve('tests/windows-dns-native-acceptance.ps1'), '-Mode', mode]);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /DNS native hosted guard refused before any write/); assert.match(result.stderr, /GITHUB_ACTIONS/);
  }
});
test('library import is inert and own native file/path boundary rejects reparse ancestors', { skip: process.platform !== 'win32' || !(process.env.LAGOM_TEST_TEMP || process.env.RUNNER_TEMP) }, () => {
  const work = path.resolve(process.env.LAGOM_TEST_TEMP || process.env.RUNNER_TEMP); assert.ok(fs.statSync(work).isDirectory());
  const fixture = path.join(work, 'lagom-dns-contract-' + randomUUID()); const source = path.resolve('tests/windows-dns-native-acceptance.ps1');
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const command = `
    $ErrorActionPreference='Stop';
    function Get-CimInstance { throw 'Unexpected native query at library import' }
    function Get-ScheduledTask { throw 'Unexpected Task query at library import' }
    function Set-DnsClientServerAddress { throw 'Unexpected DNS mutation' }
    function Stop-Service { throw 'Unexpected SCM mutation' }
    . ${quote(source)} -LibraryOnly;
    $fixture=${quote(fixture)};$owner=${quote(work)};
    [void](Assert-NativePathWithin $fixture $owner);[void][IO.Directory]::CreateDirectory($fixture);
    $target=Join-Path $fixture 'target';[void][IO.Directory]::CreateDirectory($target);
    $leaf=Join-Path $target 'plain [fixture].json';[IO.File]::WriteAllText($leaf,'{}');
    Assert-NativeOrdinaryPath $leaf -Leaf;
    $alias=Join-Path $fixture 'alias';New-Item -ItemType Junction -Path $alias -Target $target | Out-Null;
    try{
      $refused=$false;try{Assert-NativeOrdinaryPath (Join-Path $alias 'plain [fixture].json') -Leaf}catch{$refused=$true};if(-not $refused){throw 'Reparse path accepted'};
      foreach($bad in @($owner,($owner+'-foreign\\file'),(Join-Path $fixture '..\\..\\foreign'), 'relative.json')){$refused=$false;try{[void](Assert-NativePathWithin $bad $fixture)}catch{$refused=$true};if(-not $refused){throw 'Foreign path accepted'}};
      $v4=Get-DnsNativeProvider 'Cloudflare' $false;if($v4.servers.Count -ne 2 -or $v4.ipv6.Count -ne 0){throw 'Provider family contract changed'};
      $v6=Get-DnsNativeProvider 'Quad9' $true;if($v6.servers.Count -ne 4 -or -not (Test-DnsSameSequence @('2620:fe::9') @('2620:fe:0:0:0:0:0:9'))){throw 'IPv6 identity contract changed'};
      $astTokens=$null;$astErrors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile(${quote(source)},[ref]$astTokens,[ref]$astErrors);
      if($astErrors.Count){throw 'Actual DNS script syntax errors'};
      $types=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst] -and $node.Value.Contains('public static class LagomNativeDnsQuery')},$true));
      if($types.Count -ne 1){throw 'Actual native DNS query CSharp source is ambiguous'};
      $savedTemp=$env:TEMP;$savedTmp=$env:TMP;try{$env:TEMP=$fixture;$env:TMP=$fixture;Add-Type -TypeDefinition $types[0].Value -ErrorAction Stop}finally{$env:TEMP=$savedTemp;$env:TMP=$savedTmp};
      if(-not ('LagomNativeDnsQuery' -as [type])){throw 'Actual CSharp failed compilation'};
      @{groups=6;liveScmMutations=0;liveDnsMutations=0;liveTaskMutations=0;liveRegistryMutations=0;ownJunctionRefused=$true;actualQueryCSharpCompiled=$true;nativeQueryNotInvoked=$true}|ConvertTo-Json -Compress
    }finally{
      if((Get-Item -LiteralPath $alias -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){[IO.Directory]::Delete((Assert-NativePathWithin $alias $fixture),$false)};
      if(-not [IO.File]::Exists($leaf)){throw 'Own junction cleanup removed the target'};
      [IO.File]::Delete($leaf);[IO.Directory]::Delete($target,$false);[IO.Directory]::Delete($fixture,$false);
    }
  `;
  const result = run(['-Command', command]); assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  const receipt = JSON.parse(result.stdout); assert.equal(receipt.ownJunctionRefused, true);
  assert.equal(receipt.liveScmMutations + receipt.liveDnsMutations + receipt.liveTaskMutations + receipt.liveRegistryMutations, 0);
  assert.equal(fs.existsSync(fixture), false);
});
