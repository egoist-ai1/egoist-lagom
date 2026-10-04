import { app } from 'electron';
import path from 'node:path';
import { isTrustedGuiLaunchArguments } from './gui-launch-policy.js';
import { checkProtectedGuiPrivilege, requestProtectedGuiElevation } from './native-runtime-trust.js';

// This entry completes admission before loading any recovered module initializer,
// state store, log writer or single-instance lock.
let startMain = true;
let exitCode = 0;
let admissionStage = 'arguments';
const admissionStarted = Date.now();
if (app.isPackaged && process.platform === 'win32') {
  startMain = false;
  try {
    const arguments_ = process.argv.slice(1);
    if (!isTrustedGuiLaunchArguments(arguments_) || path.basename(process.execPath).toLowerCase() !== 'egoistshield.exe')
      throw new Error('Unsupported production GUI startup.');
    admissionStage = 'privilege';
    const privilege = await checkProtectedGuiPrivilege(process.resourcesPath);
    if (privilege.admitted) startMain = true;
    else if (privilege.canRequestElevation) {
      admissionStage = 'elevation';
      const outcome = await requestProtectedGuiElevation(process.resourcesPath, arguments_);
      exitCode = outcome.cancelled ? 0 : outcome.ok ? 0 : 64;
    } else exitCode = 64;
  } catch (error) {
    const knownCodes = new Set(['WINDOWS_TRUST_TIMEOUT', 'WINDOWS_TRUST_NO_RESPONSE', 'WINDOWS_TRUST_RESPONSE_LIMIT', 'WINDOWS_TRUST_REJECTED', 'WINDOWS_TRUST_INVALID_RESPONSE', 'GUI_TOKEN_STREAM_TIMEOUT', 'GUI_TOKEN_PROCESS_TIMEOUT', 'GUI_TOKEN_RESPONSE_LIMIT', 'GUI_TOKEN_UNVERIFIED', 'GUI_TOKEN_INVALID_RESPONSE']);
    const diagnostic = { stage: admissionStage, code: knownCodes.has(error?.code) ? error.code : 'GUI_ADMISSION_UNVERIFIED', elapsedMs: Date.now() - admissionStarted };
    const observation = error?.observation;
    if (Number.isInteger(observation?.responseBytes) && observation.responseBytes >= 0 && observation.responseBytes <= 16384) diagnostic.responseBytes = observation.responseBytes;
    if (typeof observation?.exitObserved === 'boolean') diagnostic.exitObserved = observation.exitObserved;
    if (observation?.exitCode === null || (Number.isInteger(observation?.exitCode) && observation.exitCode >= -2147483648 && observation.exitCode <= 4294967295)) diagnostic.exitCode = observation.exitCode;
    if (observation?.nativeCode === 'GUI_PRIVILEGE_UNVERIFIED') diagnostic.nativeCode = observation.nativeCode;
    // Fixed schema only: no raw exception message, paths, environment or stack.
    console.error('Egoist Lagom could not confirm administrator startup.', JSON.stringify(diagnostic));
    exitCode = 64;
  }
}
if (startMain) await import('./main-internal.js');
else app.exit(exitCode);