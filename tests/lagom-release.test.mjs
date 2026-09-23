import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { sourceFor, loadRecovered } from './load-recovered.mjs';

test('rebranding keeps the established user settings directory', () => {
  const source = sourceFor('electron/main');
  const start = source.indexOf('var appPathConfig =');
  const end = source.indexOf('configureLoggerPaths', start);
  const paths = { appData: 'C:\\Users\\Test\\AppData\\Roaming', userData: 'C:\\Users\\Test\\AppData\\Roaming\\egoist-lagom-desktop' };
  const context = vm.createContext({ path: path.win32, runtimeEnvironment: 'production', process: { pid: 123 },
    app: { getPath: key => paths[key], setPath: (key, value) => { paths[key] = value; } },
    buildAppPathConfig: options => ({ userDataDir: options.defaultUserDataDir, sessionDataDir: null }) });
  vm.runInContext(source.slice(start, end), context);
  assert.equal(paths.userData, 'C:\\Users\\Test\\AppData\\Roaming\\Egoist Shield');
});

test('release manifest accepts only the versioned Shield installer at the canonical repository', () => {
  const { validateManifest } = loadRecovered('electron/ipc/release-trust', {}, ['validateManifest']);
  const manifest = { schemaVersion: 2, channel: 'stable', version: '3.7.2', tag: 'v3.7.2', installerName: 'EgoistShield-Setup-3.7.2.exe',
    canonicalDownloadUrl: 'https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.7.2/EgoistShield-Setup-3.7.2.exe',
    size: 194000000, sha256: 'a'.repeat(64), sha512: 'b'.repeat(128), githubDigest: 'sha256:' + 'a'.repeat(64),
    minimumAppVersion: '3.7.2', keyId: 'release-2026-09', authenticodeStatus: 'not-signed', licenseVersion: '1.0', publishedAt: '2026-09-12T00:00:00Z' };
  assert.equal(validateManifest({ ...manifest }).installerName, manifest.installerName);
  assert.throws(() => validateManifest({ ...manifest, installerName: 'Egoist-Lagom-Setup.exe', canonicalDownloadUrl: manifest.canonicalDownloadUrl.replace(manifest.installerName, 'Egoist-Lagom-Setup.exe') }));
  for (const url of [manifest.canonicalDownloadUrl.replace('egoist-ai1', 'another-owner'), manifest.canonicalDownloadUrl + '?file=other', manifest.canonicalDownloadUrl.replace('https:', 'http:')]) {
    assert.throws(() => validateManifest({ ...manifest, canonicalDownloadUrl: url }));
  }
});

test('desktop updater hands verified Setup to the protected branded installer', () => {
  const source = sourceFor('electron/ipc/desktop-updater');
  const { buildProtectedUpdaterLaunch } = loadRecovered('electron/ipc/desktop-updater', { path: path.win32 }, ['buildProtectedUpdaterLaunch']);
  const candidate = { version: '3.7.6', assetName: 'EgoistShield-Setup-3.7.6.exe', size: 194000000, sha256: 'a'.repeat(64) };
  const root = 'C:\\Users\\Test\\AppData\\Roaming\\Egoist Shield';
  const launch = buildProtectedUpdaterLaunch(candidate, { resourcesPath: 'C:\\Program Files\\EgoistShield\\resources' }, path.win32.join(root, 'updates', candidate.assetName));
  assert.equal(launch.manifest.installer.path, `updates/${candidate.assetName}`);
  assert.equal(launch.manifest.installer.sha256, candidate.sha256.toUpperCase());
  assert.equal(launch.manifestPath, path.win32.join(root, 'updates', 'package-integrity.json'));
  assert.equal(launch.helperPath, 'C:\\Program Files\\EgoistShield\\resources\\installer\\invoke-final-silent-reinstall.ps1');
  assert.match(source, /"-InstallerUiPath", launch\.uiPath[\s\S]*?"-HandoffSignalPath", launch\.signalPath/);
  assert.doesNotMatch(source, /spawn\(finalPath,\s*\[\s*"\/S"/);
});

test('a public release older than the installed app does not require a missing versioned asset', async () => {
  let trustCalls = 0;
  const { DesktopUpdater } = loadRecovered('electron/ipc/desktop-updater', {
    async fetchLatestGitHubRelease() { return { tag_name: 'v3.7.1', draft: false, prerelease: false }; },
    normalizeVersionTag: tag => tag.slice(1),
    compareLooseVersions: (left, right) => Number(left.split('.').at(-1)) - Number(right.split('.').at(-1)),
    async verifyRemoteReleaseTrust() { trustCalls += 1; throw new Error('should not verify an older asset'); }
  }, ['DesktopUpdater']);
  const updater = new DesktopUpdater({ currentVersion: '3.7.6' });
  const resolved = await updater.resolveTrustedCandidate();
  assert.equal(resolved.candidate, null);
  assert.equal(resolved.publicVersion, '3.7.1');
  assert.equal(trustCalls, 0);
});

test('enabled background updater installs an available trusted release and restarts only after dispatch', async () => {
  const source = sourceFor('electron/main');
  const start = source.indexOf('async function runBackgroundUpdateCheck() {');
  const end = source.indexOf('function setupAutoUpdater()', start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const context = vm.createContext({
    autoUpdateEnabled: true,
    desktopUpdater: {
      installPromise: null,
      async check() { calls.push('check'); return { ok: true, phase: 'available', latestVersion: '3.7.7' }; },
      async checkAndInstall() { calls.push('install'); return { ok: true, phase: 'restarting' }; }
    },
    toPublicUpdateResult: value => value,
    emitUpdateResult: result => calls.push(result.phase),
    Notification: { isSupported: () => false },
    globalStateStore: null,
    scheduleDeferredStartup: callback => { calls.push('scheduled'); callback(); },
    app: { quit: () => calls.push('quit') },
    logger: { warn() {}, info() {} },
    isQuitting: false
  });
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.check = runBackgroundUpdateCheck;`, context);
  await context.check();
  assert.deepEqual(calls, ['check', 'available', 'install', 'restarting', 'scheduled', 'quit']);
  assert.equal(context.isQuitting, true);
});

test('automatic component updater coordinates Flowseal and Telegram Proxy and reports partial outcomes', async () => {
  const source = sourceFor('electron/main');
  const start = source.indexOf('var componentUpdateInFlight = false;');
  const end = source.indexOf('function setupManagedComponentUpdateChecks()', start);
  assert.ok(start >= 0 && end > start);
  const progress = [], actions = [];
  const context = vm.createContext({
    autoUpdateEnabled: true,
    desktopUpdater: { installPromise: null },
    mainWindow: { webContents: { send: (_channel, value) => progress.push(value) } },
    Notification: { isSupported: () => false },
    globalStateStore: null,
    globalRuntimeManager: { async status() { return { connected: false }; } },
    globalZapretManager: {
      async status() { return { updateChecksEnabled: true }; },
      async checkForUpdates() { return { updateAvailable: true, latestVersion: '1.10.3', releaseVerified: true }; },
      async installCoreUpdate() { actions.push('flowseal'); return { coreVersion: '1.10.3' }; }
    },
    globalTelegramProxyManager: {
      async shouldCheckUpdates() { return true; },
      async checkForUpdates() { return { updateAvailable: true, controlledInstallAllowed: true, latestVersion: '1.10.4' }; },
      async installUpdate() { actions.push('telegram'); throw new Error('runtime rejected'); }
    },
    globalNetworkCombinatorManager: { async runCoordinatedMutation(intent, operation) { actions.push(intent.module); return operation(); } },
    logger: { warn() {}, info() {} }
  });
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.run = checkManagedComponentUpdates;`, context);
  await context.run();
  assert.deepEqual(actions, ['zapret', 'flowseal', 'telegram-proxy', 'telegram']);
  assert.equal(progress.at(-1).phase, 'failed');
  assert.match(progress.at(-1).message, /Flowseal Core 1\.10\.3: обновлён и проверен/);
  assert.match(progress.at(-1).message, /Telegram Proxy: не обновлён/);
  context.autoUpdateEnabled = false;
  const previousActions = actions.length;
  await context.run();
  assert.equal(actions.length, previousActions, 'Disabled global auto-update must not mutate components');
});
