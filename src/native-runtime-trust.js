import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const runtimeNames = new Set(['xray', 'sing-box']);

function verifierEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment))
    if (/^(DOTNET_|COMPLUS_|CORECLR_|COR_|NODE_|OPENSSL_)/i.test(key)) delete environment[key];
  return environment;
}

// Resolve the loaded Windows KnownDLLs, not caller-controlled SystemRoot/PATH.
// The diagnostic object is transient: no report, environment, or stack is saved.
export function deriveWindowsSystemDirectory(sharedObjects) {
  if (!Array.isArray(sharedObjects)) throw new Error('Windows KnownDLL identity is unavailable.');
  const modules = sharedObjects.filter(value => typeof value === 'string' && /\\(?:ntdll|kernel32|kernelbase)\.dll$/i.test(value));
  const names = new Set(modules.map(value => path.win32.basename(value).toLowerCase()));
  const roots = new Set(modules.map(value => path.win32.dirname(value).toLowerCase()));
  if (names.size !== 3 || roots.size !== 1 || modules.length !== 3 || !path.win32.isAbsolute(modules[0]) || path.win32.basename([...roots][0]) !== 'system32')
    throw new Error('Loaded Windows KnownDLL paths disagree; privilege verification is unavailable.');
  return path.win32.dirname(modules[0]);
}

function windowsSystemDirectory() {
  if (process.platform !== 'win32' || typeof process.report?.getReport !== 'function') throw new Error('Windows privilege verification is unavailable.');
  const report = process.report;
  const excludeEnv = report.excludeEnv, excludeNetwork = report.excludeNetwork;
  try {
    report.excludeEnv = true; report.excludeNetwork = true;
    return deriveWindowsSystemDirectory(report.getReport().sharedObjects);
  } finally { report.excludeEnv = excludeEnv; report.excludeNetwork = excludeNetwork; }
}

const tokenProbe = String.raw`
  $taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  try {
    $taskPrincipal = New-Object Security.Principal.WindowsPrincipal($taskIdentity)
    [Console]::Out.WriteLine((@{ok=$true;isAdmin=$taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)} | ConvertTo-Json -Compress))
  } finally { $taskIdentity.Dispose() }
`;

const protectedVerifierProbe = String.raw`
  $taskRoot = [IO.Path]::GetFullPath((Join-Path $taskRequest.resourcesPath '..')).TrimEnd('\')
  $taskProgramRoots = @([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles),[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)) | Where-Object {$_}
  $taskTrustedRoot = $taskProgramRoots | Where-Object {$taskRoot.StartsWith($_.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)} | Select-Object -First 1
  if (-not $taskTrustedRoot) {throw 'Native verifier is outside the Windows Program Files root.'}
  $taskTrustedSids = @('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  $taskMutableRights = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  function Assert-TaskProtectedPath([string]$taskCandidate) {
    $taskCurrent = [IO.Path]::GetFullPath($taskCandidate)
    if (-not $taskCurrent.StartsWith($taskRoot+'\',[StringComparison]::OrdinalIgnoreCase) -and -not $taskCurrent.Equals($taskRoot,[StringComparison]::OrdinalIgnoreCase)) {throw 'Protected verifier path escaped installation.'}
    while ($true) {
      if (([IO.File]::GetAttributes($taskCurrent) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {throw 'Protected verifier path contains a reparse point.'}
      $taskSecurity = if ([IO.Directory]::Exists($taskCurrent)) {[IO.Directory]::GetAccessControl($taskCurrent)} else {[IO.File]::GetAccessControl($taskCurrent)}
      $taskOwner = $taskSecurity.GetOwner([Security.Principal.SecurityIdentifier]).Value
      if ($taskOwner -notin $taskTrustedSids) {throw 'Protected verifier path has an untrusted owner.'}
      foreach ($taskRule in $taskSecurity.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        if ($taskRule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and ($taskRule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and ($taskRule.FileSystemRights -band $taskMutableRights) -ne 0 -and $taskRule.IdentityReference.Value -notin $taskTrustedSids) {throw 'A non-administrator can modify the native verifier path.'}
      }
      if ($taskCurrent.Equals($taskTrustedRoot.TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)) {break}
      $taskCurrent = [IO.Path]::GetDirectoryName($taskCurrent)
      if (-not $taskCurrent) {throw 'Protected verifier parent chain is incomplete.'}
    }
  }
  $taskHeldFiles = New-Object 'System.Collections.Generic.List[IO.FileStream]'
  try {
    $taskInventoryPath = Join-Path $taskRoot 'resources\worker-host-integrity.json'
    Assert-TaskProtectedPath $taskInventoryPath
    $taskInventoryStream = [IO.File]::Open($taskInventoryPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $taskHeldFiles.Add($taskInventoryStream)
    if ($taskInventoryStream.Length -gt 1048576) {throw 'Native verifier inventory exceeds its limit.'}
    $taskInventoryReader = New-Object IO.StreamReader($taskInventoryStream,[Text.Encoding]::UTF8,$true,4096,$true)
    try {$taskInventory = $taskInventoryReader.ReadToEnd() | ConvertFrom-Json} finally {$taskInventoryReader.Dispose()}
    if ($taskInventory.schemaVersion -ne 1 -or $taskInventory.owner -ne 'EgoistShield') {throw 'Native verifier inventory identity is invalid.'}
    $taskHelperRelative = 'resources/core-service/win-x64/EgoistShield.Service.exe'
    $taskHelper = Join-Path $taskRoot $taskHelperRelative
    $taskHelperFolder = [IO.Path]::GetDirectoryName($taskHelper)
    $taskCodeFiles = @($taskHelper) + @([IO.Directory]::GetFiles($taskHelperFolder) | Where-Object {[IO.Path]::GetExtension($_).Equals('.dll',[StringComparison]::OrdinalIgnoreCase)})
    foreach ($taskCodeFile in $taskCodeFiles) {
      Assert-TaskProtectedPath $taskCodeFile
      $taskRelative = $taskCodeFile.Substring($taskRoot.Length+1).Replace('\','/')
      $taskPins = @($taskInventory.files | Where-Object {$_.path -ceq $taskRelative -and 'cli' -in $_.roles})
      if ($taskPins.Count -ne 1 -or $taskPins[0].sha256 -notmatch '^[a-fA-F0-9]{64}$' -or $taskPins[0].bytes -le 0) {throw 'Native verifier code is absent or ambiguous in its inventory.'}
      $taskCodeStream = [IO.File]::Open($taskCodeFile,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
      $taskHeldFiles.Add($taskCodeStream)
      $taskHasher = [Security.Cryptography.SHA256]::Create()
      try {$taskHash = -join ($taskHasher.ComputeHash($taskCodeStream) | ForEach-Object {$_.ToString('x2')})} finally {$taskHasher.Dispose()}
      if ($taskCodeStream.Length -ne $taskPins[0].bytes -or $taskHash -cne $taskPins[0].sha256.ToLowerInvariant()) {throw 'Native verifier bytes differ from its authenticated inventory.'}
    }
    [Console]::Out.WriteLine((@{ok=$true;helperPath=$taskHelper} | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
    $null = [Console]::In.ReadLine()
  } finally {foreach ($taskFile in $taskHeldFiles) {$taskFile.Dispose()}}
`;

async function probeWindows(script, request = {}) {
  const systemDirectory = windowsSystemDirectory();
  // Windows services its own executable through WinSxS hardlinks. This narrow
  // exception applies only to the OS executable below the loaded KnownDLL root.
  const executable = await ordinaryFile(path.win32.join(systemDirectory, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), { allowSystemHardLinks: true });
  const request64 = Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
  const command = `$ErrorActionPreference='Stop';try {$taskRequest=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${request64}')) | ConvertFrom-Json;${script}} catch {[Console]::Out.WriteLine((@{ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress));exit 1}`;
  const environment = verifierEnvironment();
  for (const key of Object.keys(environment)) if (/^(PATH|SYSTEMROOT|WINDIR|PSMODULEPATH)$/i.test(key)) delete environment[key];
  environment.PATH = systemDirectory + ';' + path.win32.dirname(systemDirectory);
  environment.SystemRoot = path.win32.dirname(systemDirectory);
  environment.PSModulePath = path.win32.join(systemDirectory, 'WindowsPowerShell', 'v1.0', 'Modules');
  const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd: systemDirectory, env: environment
  });
  child.stderr.on('data', () => {}); child.stdin.on('error', () => {});
  let released = false;
  const release = () => {
    if (released) return;
    released = true; child.stdin.end();
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 3000);
    timer.unref(); child.once('close', () => clearTimeout(timer));
  };
  try {
    const value = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => { cleanup(); reject(new Error('Windows trust probe exceeded its 30 second budget.')); }, 30000);
      const cleanup = () => { clearTimeout(timer); child.stdout.off('data', onData); child.off('error', onError); child.off('close', onExit); };
      const onError = error => { cleanup(); reject(error); };
      const onExit = () => { cleanup(); reject(new Error('Windows trust probe stopped without a verified result.')); };
      const onData = chunk => {
        output += chunk.toString('utf8');
        if (Buffer.byteLength(output) > 16384) { cleanup(); reject(new Error('Windows trust probe response exceeded its limit.')); return; }
        if (!output.includes('\n')) return;
        cleanup();
        try { const value = JSON.parse(output.slice(0, output.indexOf('\n'))); if (value.ok !== true) throw new Error(value.error || 'Windows trust probe rejected this operation.'); resolve(value); }
        catch (error) { reject(error); }
      };
      child.stdout.on('data', onData); child.once('error', onError); child.once('close', onExit);
    });
    child.stdout.resume();
    return { value, release, child, systemDirectory };
  } catch (error) { release(); throw error; }
}

export async function checkNativeExecutionPrivilege() {
  const probe = await probeWindows(tokenProbe);
  try {
    if (typeof probe.value.isAdmin !== 'boolean') throw new Error('Windows privilege result is invalid; token state remains unknown.');
    return probe.value.isAdmin;
  } finally { probe.release(); }
}

export async function checkProtectedGuiPrivilege(resourcesPath) {
  const resources = path.resolve(resourcesPath);
  const proof = await probeWindows(protectedVerifierProbe, { resourcesPath: resources });
  try {
    const expected = path.join(resources, 'core-service', 'win-x64', 'EgoistShield.Service.exe');
    if (path.resolve(proof.value.helperPath).toLowerCase() !== expected.toLowerCase()) throw new Error('GUI privilege helper identity mismatch.');
    const child = spawn(expected, ['--gui-startup-privilege'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: path.dirname(expected), env: verifierEnvironment() });
    return await new Promise((resolve, reject) => {
      let output = '', expired = false;
      const timer = setTimeout(() => { expired = true; child.kill(); reject(new Error('GUI token inspection exceeded its budget.')); }, 30000);
      child.stdout.on('data', bytes => {
        if (expired) return;
        if (Buffer.byteLength(output) + bytes.length > 16384) { expired = true; clearTimeout(timer); child.kill(); reject(new Error('GUI token result exceeded its limit.')); return; }
        output += bytes.toString('utf8');
      });
      child.stderr.on('data', () => {});
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => {
        clearTimeout(timer);
        if (expired) return;
        try {
          const value = JSON.parse(output);
          if (code !== 0 || value.ok !== true || typeof value.admitted !== 'boolean' || typeof value.canRequestElevation !== 'boolean') throw new Error('GUI token could not be verified.');
          resolve({ admitted: value.admitted, canRequestElevation: value.canRequestElevation });
        } catch (error) { reject(error); }
      });
    });
  } finally { proof.release(); }
}
export async function requestProtectedGuiElevation(resourcesPath, arguments_) {
  const allowed = new Set(['--background', '--minimized']);
  if (!Array.isArray(arguments_) || arguments_.length > 2 || new Set(arguments_).size !== arguments_.length || arguments_.some(value => !allowed.has(value)))
    throw new Error('Unsupported GUI elevation arguments.');
  const resources = path.resolve(resourcesPath);
  const proof = await probeWindows(protectedVerifierProbe, { resourcesPath: resources });
  try {
    const expected = path.join(resources, 'core-service', 'win-x64', 'EgoistShield.Service.exe');
    if (path.resolve(proof.value.helperPath).toLowerCase() !== expected.toLowerCase()) throw new Error('GUI launcher identity mismatch.');
    const child = spawn(expected, ['--launch-elevated-gui', ...arguments_], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: path.dirname(expected), env: verifierEnvironment()
    });
    const result = await new Promise((resolve, reject) => {
      let output = '', expired = false;
      const timer = setTimeout(() => { expired = true; child.kill(); reject(new Error('GUI elevation exceeded its startup budget.')); }, 120000);
      child.stdout.on('data', bytes => {
        if (expired) return;
        if (Buffer.byteLength(output) + bytes.length > 16384) { expired = true; clearTimeout(timer); child.kill(); reject(new Error('GUI elevation result exceeded its limit.')); return; }
        output += bytes.toString('utf8');
      });
      child.stderr.on('data', () => {});
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => {
        clearTimeout(timer);
        if (expired) return;
        try {
          const value = JSON.parse(output);
          if (code === 0 && value.ok === true && ['started', 'elevated-launcher-completed'].includes(value.phase)) resolve({ ok: true, cancelled: false });
          else if (code === 2 && value.ok === false && value.cancelled === true && value.code === 'UAC_CANCELLED') resolve({ ok: false, cancelled: true });
          else reject(new Error('Protected GUI launcher rejected startup.'));
        } catch (error) { reject(error); }
      });
    });
    return result;
  } finally { proof.release(); }
}
async function ordinaryFile(file, { allowSystemHardLinks = false } = {}) {
  const absolute = path.resolve(file);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of path.relative(root, absolute).split(path.sep)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || (current === absolute && (!stat.isFile() || (!allowSystemHardLinks && stat.nlink !== 1))))
      throw new Error('Runtime должен быть обычным файлом без ссылок и перенаправления каталогов.');
  }
  return absolute;
}

async function installedVerifier(resourcesPath) {
  if (process.platform !== 'win32') throw new Error('Привилегированная проверка runtime поддерживается только в Windows.');
  const resources = path.resolve(resourcesPath);
  if (path.basename(resources).toLowerCase() !== 'resources') throw new Error('Нативный проверяющий хост должен находиться в установленном пакете.');
  return ordinaryFile(path.join(resources, 'core-service', 'win-x64', 'EgoistShield.Service.exe'));
}

export async function prepareRuntimeInstallRoot({ appRoot, userDataDir, runtimeKind }) {
  if (!runtimeNames.has(runtimeKind)) throw new Error('Неизвестный runtime.');
  if (await checkNativeExecutionPrivilege()) throw new Error('Обновление пользовательских runtime выполняется в обычном режиме приложения. Для привилегированного режима используйте проверенный встроенный runtime из установщика.');
  return { runtimeRoot: path.join(path.resolve(userDataDir), 'runtime'), privileged: false };
}

export async function verifyNativeRuntimeForExecution({ runtimePath, runtimeKind, privileged = false, resourcesPath, appRoot }) {
  if (!runtimeNames.has(runtimeKind)) throw new Error('Неизвестный runtime.');
  const candidate = await ordinaryFile(runtimePath);
  if (!privileged) return { runtimePath: candidate, release() {}, watch() {}, systemDirectory: null };
  const resources = path.resolve(resourcesPath ?? appRoot);
  const expected = path.join(resources, 'runtime', runtimeKind, runtimeKind + '.exe');
  if (candidate.toLowerCase() !== expected.toLowerCase())
    throw new Error('Привилегированный запуск допускает только проверенный встроенный runtime. Пользовательские и custom runtime запускаются без повышения.');
  const helper = await installedVerifier(resources);
  const bootstrap = await probeWindows(protectedVerifierProbe, { resourcesPath: resources });
  if (path.resolve(bootstrap.value.helperPath).toLowerCase() !== helper.toLowerCase()) { bootstrap.release(); throw new Error('Protected verifier path readback mismatch.'); }
  const verifier = spawn(helper, ['--verify-native-runtime'], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd: path.dirname(helper),
    env: verifierEnvironment()
  });
  let released = false, watchedChild = null;
  const release = () => {
    if (released) return;
    released = true;
    bootstrap.release();
    verifier.stdin.end();
    const retirement = setTimeout(() => { if (verifier.exitCode === null) verifier.kill(); }, 3000);
    retirement.unref();
    verifier.once('close', () => clearTimeout(retirement));
  };
  // stderr is drained and never returned as a trusted protocol record.
  verifier.stderr.on('data', () => {});
  verifier.stdin.on('error', () => {});
  verifier.once('exit', () => {
    if (!released && watchedChild && watchedChild.exitCode === null && !watchedChild.killed) watchedChild.kill();
  });
  try {
    const result = await new Promise((resolve, reject) => {
      let data = '';
      const timer = setTimeout(() => { cleanup(); reject(new Error('Проверка защищённого runtime не завершилась за 30 секунд.')); }, 30000);
      const cleanup = () => { clearTimeout(timer); verifier.stdout.off('data', onData); verifier.off('error', onError); verifier.off('exit', onExit); };
      const onError = error => { cleanup(); reject(error); };
      const onExit = () => { cleanup(); reject(new Error('Нативный хост завершился до подтверждения runtime.')); };
      const onData = chunk => {
        data += chunk.toString('utf8');
        if (Buffer.byteLength(data) > 16384) { cleanup(); reject(new Error('Недопустимый ответ проверки runtime.')); return; }
        const newline = data.indexOf('\n');
        if (newline < 0) return;
        cleanup();
        try {
          const reply = JSON.parse(data.slice(0, newline));
          if (reply?.ok !== true || typeof reply.runtimePath !== 'string' || path.resolve(reply.runtimePath).toLowerCase() !== candidate.toLowerCase() ||
              typeof reply.systemDirectory !== 'string' || !path.isAbsolute(reply.systemDirectory))
            throw new Error(reply?.error || 'Нативный хост не подтвердил runtime.');
          if (verifier.exitCode !== null) throw new Error('Доверенная проверка runtime больше не удерживает файлы.');
          resolve(reply);
        } catch (error) { reject(error); }
      };
      verifier.stdout.on('data', onData);
      verifier.once('error', onError);
      verifier.once('exit', onExit);
      verifier.stdin.write(JSON.stringify({ runtimePath: candidate, runtimeKind }) + '\n');
    });
    bootstrap.release();
    return {
      runtimePath: candidate, systemDirectory: result.systemDirectory, release,
      watch(child) {
        if (released || verifier.exitCode !== null || verifier.killed) { release(); child.kill(); throw new Error('Удержание защищённого runtime потеряно до запуска.'); }
        watchedChild = child;
        child.once('error', release);
        child.once('exit', release);
      }
    };
  } catch (error) { release(); throw error; }
}

export function runtimeExecutionEnvironment(lease, inherited = process.env) {
  const environment = { ...inherited };
  if (lease.systemDirectory) {
    for (const key of Object.keys(environment))
      if (/^(PATH|SYSTEMROOT|WINDIR|PSMODULEPATH)$|^(NODE_|OPENSSL_|DOTNET_|COMPLUS_|CORECLR_|COR_)/i.test(key)) delete environment[key];
    environment.PATH = lease.systemDirectory + ';' + path.dirname(lease.systemDirectory);
    environment.SystemRoot = path.dirname(lease.systemDirectory);
  }
  return environment;
}
