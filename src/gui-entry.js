import { app } from 'electron';
import path from 'node:path';
import { isTrustedGuiLaunchArguments } from './gui-launch-policy.js';
import { checkProtectedGuiPrivilege, requestProtectedGuiElevation } from './native-runtime-trust.js';

// This entry completes admission before loading any recovered module initializer,
// state store, log writer or single-instance lock.
let startMain = true;
let exitCode = 0;
if (app.isPackaged && process.platform === 'win32') {
  startMain = false;
  try {
    const arguments_ = process.argv.slice(1);
    if (!isTrustedGuiLaunchArguments(arguments_) || path.basename(process.execPath).toLowerCase() !== 'egoistshield.exe')
      throw new Error('Unsupported production GUI startup.');
    const privilege = await checkProtectedGuiPrivilege(process.resourcesPath);
    if (privilege.admitted) startMain = true;
    else if (privilege.canRequestElevation) {
      const outcome = await requestProtectedGuiElevation(process.resourcesPath, arguments_);
      exitCode = outcome.cancelled ? 0 : outcome.ok ? 0 : 64;
    } else exitCode = 64;
  } catch {
    console.error('Egoist Lagom could not confirm administrator startup.');
    exitCode = 64;
  }
}
if (startMain) await import('./main-internal.js');
else app.exit(exitCode);