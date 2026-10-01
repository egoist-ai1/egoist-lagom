import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

test('installer restores secret component directories before copying and requires observed owned VPN readiness', { skip: process.platform !== 'win32', timeout: 25000 }, () => {
  const shell=process.env.LAGOM_WINDOWS_POWERSHELL || path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const result=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tests/installer-vpn-preservation.ps1'),'-TempRoot',process.env.LAGOM_TEST_TEMP || os.tmpdir()],{windowsHide:true,encoding:'utf8',timeout:20000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  const receipt=JSON.parse(result.stdout);
  assert.equal(receipt.passes,17);
  assert.equal(receipt.nativeAclChanges,0);
  assert.equal(receipt.serviceMutations,0);
  assert.equal(receipt.mockedAclBoundary,true);
  assert.equal(receipt.mockedNativeStatusBoundary,true);
  assert.equal(receipt.mockedScmBoundary,true);
  assert.equal(receipt.ownDedicatedDirectoryRemoved,true);
});
