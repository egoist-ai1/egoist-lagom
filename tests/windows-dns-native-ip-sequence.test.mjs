import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

// Inert regression only. No acceptance script import, native DNS, SCM or registry API.
// Address-only fixture from c710 CI 37269318900 attempt 1, original 12-row inventory:
// windows-dns-native-acceptance.json SHA-256 a96aaf054b55943b355f4b54b416d8eba70598f4b9681235cbc03f94cb4802a0.
const baselineAddresses = ["1.0.0.1", "1.1.1.1", "149.112.112.112", "2001:4860:4860::8844", "2001:4860:4860::8888", "2606:4700:4700::1001", "2606:4700:4700::1111", "2620:fe::9", "2620:fe::fe", "8.8.4.4", "8.8.8.8", "9.9.9.9"];
const shell = process.env.LAGOM_TEST_POWERSHELL || process.env.LAGOM_WINDOWS_POWERSHELL ||
  path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const declaredTemp = process.env.LAGOM_TEST_TEMP;
const quote = value => "'" + value.replaceAll("'", "''") + "'";

test('actual DNS IP helper preserves whole-address keys for policy, guardian and foreign rows', {
  skip: process.platform !== 'win32' || !declaredTemp, timeout: 20000
}, t => {
  assert.ok(path.isAbsolute(declaredTemp), 'LAGOM_TEST_TEMP must name an existing absolute private directory');
  const base = fs.realpathSync(declaredTemp);
  assert.ok(fs.statSync(base).isDirectory());
  const fixture = fs.mkdtempSync(path.join(base, 'lagom-dns-ip-sequence-'));
  t.after(() => {
    const resolved = path.resolve(fixture), relative = path.relative(base, resolved);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    assert.match(path.basename(resolved), /^lagom-dns-ip-sequence-/);
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const source = path.resolve('tests/windows-dns-native-acceptance.ps1');
  const fixtureJson = path.join(fixture, 'addresses.json');
  fs.writeFileSync(fixtureJson, JSON.stringify(baselineAddresses));
  const script = path.join(fixture, 'inert-ip-contract.ps1');
  const command = String.raw`
$ErrorActionPreference='Stop';Set-StrictMode -Version 2.0
$sourceText=[IO.File]::ReadAllText(${quote(source)},[Text.Encoding]::UTF8)
$start=$sourceText.IndexOf('function ConvertTo-DnsIpSequence',[StringComparison]::Ordinal)
$end=$sourceText.IndexOf('function Get-DnsNativeProvider',$start,[StringComparison]::Ordinal)
if($start -lt 0 -or $end -le $start){throw 'Exact IP helper source span missing.'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($sourceText.Substring($start,$end-$start),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'IP helper AST has syntax errors.'}
foreach($name in @('ConvertTo-DnsIpSequence','Test-DnsSameSequence')){
  $fn=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true)
  if(-not $fn){throw 'Required exact helper AST missing.'}
  . ([scriptblock]::Create($fn.Extent.Text))
}
$addresses=([IO.File]::ReadAllText(${quote(fixtureJson)},[Text.Encoding]::UTF8))|ConvertFrom-Json
$rows=@();foreach($address in $addresses){$rows+=[pscustomobject]@{id=$rows.Count;serverAddress=[string]$address}}
if($rows.Count -ne 12){throw 'Pinned fixture row count changed.'}
$targets=@('1.1.1.1','1.0.0.1')
$counts=@();$ordinal=0
foreach($target in $targets){
  $matches=@($rows|Where-Object {(ConvertTo-DnsIpSequence @($_.serverAddress))[0] -ceq (ConvertTo-DnsIpSequence @($target))[0]})
  if($matches.Count -ne 1 -or $matches[0].serverAddress -cne $target){throw ('Provider ordinal '+$ordinal+' expected one exact IP row; actual count='+$matches.Count)}
  $counts+=$matches.Count;$ordinal++
}
foreach($pair in @(@{name='ipv4';rows=@('1.2.3.4','1.2.3.5')},@{name='ipv6';rows=@('2001:db8::1','2001:db8::2')})){
  foreach($target in $pair.rows){
    $matches=@($pair.rows|Where-Object {(ConvertTo-DnsIpSequence @($_))[0] -ceq (ConvertTo-DnsIpSequence @($target))[0]})
    if($matches.Count -ne 1 -or $matches[0] -cne $target){throw ($pair.name+' same-prefix addresses collided.')}
  }
}
foreach($case in @(@{name='empty';items=@();expected=''},@{name='single';items=@('1.2.3.4');expected='1.2.3.4'},@{name='multiple';items=@('1.2.3.4','1.2.3.5');expected='1.2.3.4,1.2.3.5'},@{name='ipv6';items=@('2001:0DB8:0:0:0:0:0:1','2001:db8::2');expected='2001:db8::1,2001:db8::2'})){
  $value=ConvertTo-DnsIpSequence $case.items
  if($value -isnot [array] -or $value.Count -ne $case.items.Count -or ($value -join ',') -cne $case.expected -or @($value|Where-Object {$_ -is [array]}).Count){throw ($case.name+' IP sequence is not the expected flat array.')}
}
if(-not (Test-DnsSameSequence @() @()) -or -not (Test-DnsSameSequence @('2001:db8::1') @('2001:0DB8:0:0:0:0:0:1')) -or (Test-DnsSameSequence @('1.2.3.4','1.2.3.5') @('1.2.3.5','1.2.3.4'))){throw 'Existing sequence comparison semantics changed.'}
foreach($invalid in @(@{items=@('invalid-address')},@{items=@('1.2.3.4','invalid-address')})){
  $refused=$false;try{[void](ConvertTo-DnsIpSequence $invalid.items)}catch{$refused=$true}
  if(-not $refused){throw 'Invalid address failed open.'}
}
$allowed=ConvertTo-DnsIpSequence $targets
$foreign=@($rows|Where-Object {(ConvertTo-DnsIpSequence @($_.serverAddress))[0] -notin $allowed})
$selected=@($rows|Where-Object {(ConvertTo-DnsIpSequence @($_.serverAddress))[0] -in $allowed})
$expectedForeign=@($rows|Where-Object {$_.serverAddress -notin $targets})
if($selected.Count -ne 2 -or $foreign.Count -ne 10 -or ($foreign.id -join ',') -cne ($expectedForeign.id -join ',')){throw 'Owned/foreign row identity or order changed.'}
# Same expression as guardian baseline lookup: one target, exact identity, foreign rows untouched.
foreach($target in $targets){$baseline=@($rows|Where-Object {(ConvertTo-DnsIpSequence @($_.serverAddress))[0] -ceq (ConvertTo-DnsIpSequence @($target))[0]});if($baseline.Count -ne 1 -or $baseline[0].serverAddress -cne $target){throw 'Guardian baseline is ambiguous or foreign.'}}
[pscustomobject]@{ok=$true;providerCounts=$counts;foreignCount=$foreign.Count;preflightSelectedCount=$selected.Count;sourceAstOnly=$true;nativeDnsCalls=0;networkCalls=0;restoreExecuted=$false}|ConvertTo-Json -Compress
`;
  fs.writeFileSync(script, String.fromCharCode(0xfeff) + command, 'utf8'); // Windows PowerShell 5 decodes UTF-8 via BOM.
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
    encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 512 * 1024
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const proof = JSON.parse(result.stdout);
  assert.deepEqual(proof.providerCounts, [1, 1]);
  assert.equal(proof.foreignCount, 10);
  assert.equal(proof.preflightSelectedCount, 2);
  assert.equal(proof.sourceAstOnly, true);
  assert.equal(proof.nativeDnsCalls, 0);
  assert.equal(proof.networkCalls, 0);
  assert.equal(proof.restoreExecuted, false);
});
