import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const project = fileURLToPath(new URL('../', import.meta.url));
const fixtureScript = fileURLToPath(new URL('./installer-native-module-boundary.ps1', import.meta.url));
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

test('real WinPS5 entrypoint bootstraps repair inherited module discovery without dispatching installer operations',
  { skip: process.platform !== 'win32', timeout: 90_000 }, async () => {
    const parentEnvironment = { ...process.env };
    const base = process.env.LAGOM_TEST_TEMP;
    assert.ok(base && path.isAbsolute(base), 'Set task-owned LAGOM_TEST_TEMP.');
    const work = await fs.mkdtemp(path.join(base, 'installer-module-boundary-'));
    const shadowModules = path.join(work, 'incompatible-modules');
    await fs.mkdir(shadowModules);
    for (const [name, exportField, command] of [
      ['Microsoft.PowerShell.Security', 'CmdletsToExport', 'Get-Acl'],
      ['Microsoft.PowerShell.Utility', 'FunctionsToExport', 'Get-FileHash'],
    ]) {
      const directory = path.join(shadowModules, name);
      await fs.mkdir(directory);
      await fs.writeFile(path.join(directory, name + '.psd1'),
        "@{\nModuleVersion='99.0.0'\nPowerShellVersion='99.0'\n" + exportField + "=@('" + command + "')\n}\n", 'utf8');
    }
    const requestedModulePath = shadowModules + path.delimiter + path.join(path.dirname(powershell), 'Modules');
    const fixture = path.join(work, 'обычный файл [module boundary].txt');
    const bytes = Buffer.from('Ordinary task-owned module fixture.\r\nКириллица, пробелы и [скобки].\r\n', 'utf8');
    await fs.writeFile(fixture, bytes);
    const expectedHash = createHash('sha256').update(bytes).digest('hex');
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'));
    const env = { ...inherited, PSModulePath: requestedModulePath, TEMP: work, TMP: work };
    const cases = [
      { label: 'control', scenario: 'control', exitCode: 1 },
      { label: 'owned-cleanup', scenario: 'production', source: 'src/installer/owned-cleanup.ps1', exitCode: 0 },
      { label: 'reinstall-worker', scenario: 'production', source: 'scripts/invoke-final-silent-reinstall.ps1', exitCode: 0 },
    ];
    const receipts = [];
    try {
      for (const item of cases) {
        const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', fixtureScript, '-FixturePath', fixture, '-InheritedModulePath', requestedModulePath, '-OwnModuleDirectory', shadowModules, '-Scenario', item.scenario];
        if (item.source) args.push('-SourcePath', path.join(project, item.source));
        let actual;
        try {
          const result = await execute(powershell, args, { env, windowsHide: true, timeout: 25_000, maxBuffer: 128 * 1024 });
          actual = { ...result, exitCode: 0 };
        } catch (error) {
          assert.equal(error.killed, false, item.label + ': bounded child timed out');
          assert.equal(error.signal, null, item.label + ': unexpected child signal');
          assert.equal(typeof error.code, 'number', item.label + ': native process could not launch');
          actual = { stdout: error.stdout ?? '', stderr: error.stderr ?? '', exitCode: error.code };
        }
        await fs.writeFile(path.join(work, item.label + '.stdout.json'), actual.stdout, 'utf8');
        await fs.writeFile(path.join(work, item.label + '.stderr.txt'), actual.stderr, 'utf8');
        assert.equal(actual.stderr.trim(), '', item.label + ': unexpected stderr');
        const receipt = JSON.parse(actual.stdout.trim());
        receipts.push({ label: item.label, exitCode: actual.exitCode, ...receipt });

        assert.equal(actual.exitCode, item.exitCode, item.label + ': actual native exit code');
        assert.equal(receipt.kind, 'installer-native-module-boundary');
        assert.equal(receipt.psEdition, 'Desktop');
        assert.match(receipt.psVersion, /^5\./);
        assert.equal(receipt.commandsChecked, 2);
        assert.equal(receipt.modulePathContainsOwnDirectory, true, item.label + ': child did not receive own module directory');
        assert.equal(receipt.modulePathOwnDirectoryFirst, true, item.label + ': incompatible own modules must resolve first');
        assert.match(receipt.modulePathSha256, /^[a-f0-9]{64}$/);
        if (item.scenario === 'control') {
          assert.equal(receipt.sourceStatementsExecuted, 0);
          assert.equal(receipt.failureCount, 2);
          for (const command of [receipt.acl, receipt.hash]) {
            assert.equal(command.ok, false);
            assert.equal(command.errorClass, 'System.Management.Automation.CommandNotFoundException');
            assert.match(command.errorId, /CouldNotAutoloadMatchingModule|CommandNotFoundException/);
          }
        } else {
          assert.equal(receipt.sourceStatementsExecuted, 1);
          assert.equal(receipt.failureCount, 0);
          assert.equal(receipt.acl.ok, true);
          assert.equal(receipt.acl.ownerPresent, true);
          assert.equal(receipt.hash.ok, true);
          assert.equal(receipt.hash.sha256, expectedHash);
        }
        assert.deepEqual(await fs.readFile(fixture), bytes, item.label + ': fixture bytes changed');
        assert.deepEqual({ ...process.env }, parentEnvironment, item.label + ': parent environment changed');
      }
      await fs.writeFile(path.join(work, 'native-module-boundary-receipt.json'),
        JSON.stringify({ schemaVersion: 1, cases: receipts, parentEnvironmentUnchanged: true, fixtureBytesStable: true }, null, 2), 'utf8');
    } finally {
      assert.deepEqual({ ...process.env }, parentEnvironment, 'Parent environment changed');
    }
  });
