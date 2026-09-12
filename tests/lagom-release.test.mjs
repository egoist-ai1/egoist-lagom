import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('release manifest accepts the branded installer only at the canonical repository', () => {
  const { validateManifest } = loadRecovered('electron/ipc/release-trust', {}, ['validateManifest']);
  const manifest = { schemaVersion: 2, channel: 'stable', version: '3.7.1', tag: 'v3.7.1', installerName: 'Egoist-Lagom-Setup.exe',
    canonicalDownloadUrl: 'https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.7.1/Egoist-Lagom-Setup.exe',
    size: 194000000, sha256: 'a'.repeat(64), sha512: 'b'.repeat(128), githubDigest: 'sha256:' + 'a'.repeat(64),
    minimumAppVersion: '3.7.1', keyId: 'release-2026-09', authenticodeStatus: 'not-signed', licenseVersion: '1.0', publishedAt: '2026-09-12T00:00:00Z' };
  assert.equal(validateManifest({ ...manifest }).installerName, manifest.installerName);
  for (const url of [manifest.canonicalDownloadUrl.replace('egoist-ai1', 'another-owner'), manifest.canonicalDownloadUrl + '?file=other', manifest.canonicalDownloadUrl.replace('https:', 'http:')]) {
    assert.throws(() => validateManifest({ ...manifest, canonicalDownloadUrl: url }));
  }
});

test('built renderer fallback version matches the packaged application version', () => {
  const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  const renderer = fs.readFileSync('.vite/renderer/main_window/assets/index-Eaqlb9_F.js', 'utf8');
  assert.ok(renderer.includes(`Qf="${version}"`) || renderer.includes(`Qf='${version}'`));
  assert.doesNotMatch(renderer, /Qf=["']3\.7\.0["']/);
});
