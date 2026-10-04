import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);

test('cleanup refuses a missing, damaged or incomplete required helper before continuing', {skip:process.platform !== 'win32'}, async () => {
  const source = await fs.readFile(path.resolve('src/installer/owned-cleanup.ps1'), 'utf8');
  const boundary = source.indexOf('\n$ErrorActionPreference = "Continue"');
  assert.ok(boundary > 0, 'Isolate the actual import statements before any cleanup initialization.');
  const prefix = source.slice(0, boundary).replace(/^\uFEFF/, '');
  const helper = await fs.readFile(path.resolve('src/installer/service-maintenance.ps1'), 'utf8');
  const boot = await fs.readFile(path.resolve('src/installer/maintenance-boot-recovery.ps1'), 'utf8');
  const startup = await fs.readFile(path.resolve('src/installer/gui-login-startup.ps1'), 'utf8');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lagom-import-gate-'));
  try {
    const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const cases = [['service-missing', null, boot], ['service-damaged', 'function broken {', boot],
      ['service-incomplete', 'function Invoke-InstallerSc {}', boot], ['boot-missing', helper, null],
      ['boot-damaged', helper, 'function broken {'], ['boot-incomplete', helper, 'function Register-InstallerMaintenanceBootRecovery {}'],
      ['valid', helper, boot]];
    for (const [name, content, bootContent] of cases) {
      const fixture = path.join(dir, name);
      await fs.mkdir(fixture);
      const script = path.join(fixture, 'import.ps1');
      const marker = path.join(fixture, 'continued.txt');
      await fs.writeFile(path.join(fixture, 'gui-login-startup.ps1'), '\uFEFF' + startup.replace(/^\uFEFF/,''));
      await fs.writeFile(script, '\uFEFF' + prefix + '\n[IO.File]::WriteAllText($env:LAGOM_IMPORT_MARKER, "continued")\n');
      if (content !== null) await fs.writeFile(path.join(fixture, 'service-maintenance.ps1'), '\uFEFF' + content.replace(/^\uFEFF/,''));
      if (bootContent !== null) await fs.writeFile(path.join(fixture, 'maintenance-boot-recovery.ps1'), '\uFEFF' + bootContent.replace(/^\uFEFF/,''));
      let result;
      try {
        result = await exec(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
          env:{...process.env, LAGOM_IMPORT_MARKER:marker}, windowsHide:true, timeout:15000,
        });
      } catch (error) { result = error; }
      const reached = await fs.stat(marker).then(() => true, () => false);
      if (name === 'valid') {
        assert.equal(result.code, undefined, result.stderr);
        assert.equal(reached, true, 'The complete production helper imports normally.');
      } else {
        assert.equal(result.code, 1, `Import ${name} must terminate before cleanup initialization: ${result.stderr}`);
        assert.equal(reached, false, `Import ${name} must not continue into cleanup.`);
      }
    }
  } finally {
    assert.equal(await fs.realpath(dir), dir);
    await fs.rm(dir, {recursive:true, force:true});
  }
});
