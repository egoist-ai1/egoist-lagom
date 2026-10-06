const workerResources = __dirname;
const workerProductRoot = path.join(process.env.ProgramData, 'EgoistShield');
const workerUserData = path.join(workerProductRoot, 'Service', 'ComponentWorker');
const workerManagers = {
  SystemDoH: new SystemDohManager(workerResources, path.join(workerResources, 'app.asar'), workerUserData, path.join(workerProductRoot, 'Runtime', 'SystemDoH')),
  Zapret: new ZapretManager(workerResources, path.join(workerResources, 'app.asar'), workerUserData, path.join(workerProductRoot, 'Runtime', 'Zapret')),
  TelegramProxy: new TelegramProxyManager(workerResources, path.join(workerResources, 'app.asar'), workerUserData, path.join(workerProductRoot, 'Runtime', 'TelegramProxy')),
  Vpn: new VpnServiceManager(workerResources, path.join(workerResources, 'app.asar'), workerUserData, path.join(workerProductRoot, 'Runtime', 'Vpn')),
};
let workerProgress = null;
let workerQueue = Promise.resolve();
let workerBuffer = '';
async function executeWorkerRequest(request) {
  const value = validateComponentRequest(request);
  if (value.method === 'autoSelectProgress') return workerProgress;
  if (value.method === 'autoSelectBestProfile') {
    workerProgress = null;
    return workerManagers.Zapret.autoSelectBestProfile(progress => { workerProgress = progress; }, value.args[0]);
  }
  const result = await workerManagers[value.component][value.method](...value.args);
  if (value.component === 'SystemDoH' && !value.query && ['apply', 'restart', 'recover', 'refreshBootstrap', 'stop', 'stopAndRemove'].includes(value.method) &&
      typeof workerManagers.Zapret.refreshSystemDohTransportProtection === 'function') {
    try {
      const transportIsolation = await workerManagers.Zapret.refreshSystemDohTransportProtection();
      if (result && typeof result === 'object' && !Array.isArray(result)) return { ...result, transportIsolation };
    } catch (error) {
      const message = redactDiagnosticText(error instanceof Error ? error.message : String(error));
      log.warn('Zapret DNS transport isolation update deferred; DNS result preserved.', message);
      if (result && typeof result === 'object' && !Array.isArray(result)) return { ...result, transportIsolation: { ok: false, deferred: true, error: message } };
    }
  }
  return result;
}
// Only public classifications, numeric counters and bounded execution codes leave the worker.
function compactWorkerNativeQueryDiagnostic(value) {
  const kinds = ['exit', 'spawn', 'terminated', 'output-limit', 'unknown', 'invalid-json', 'invalid-response', 'invalid-snapshot'];
  if (!value || typeof value !== 'object' || !kinds.includes(value.kind)) return undefined;
  const result = { kind: value.kind };
  const codes = ['ENOENT', 'EACCES', 'EPERM', 'EINVAL', 'EAGAIN', 'ENOMEM', 'ENOTDIR', 'EISDIR', 'ENOSYS', 'UNKNOWN', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'unknown'];
  if (Number.isInteger(value.code) && value.code >= -2147483648 && value.code <= 4294967295 || codes.includes(value.code)) result.code = value.code;
  if (typeof value.killed === 'boolean') result.killed = value.killed;
  if (value.signal === null || ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGBREAK', 'SIGABRT', 'SIGSEGV', 'SIGILL', 'SIGFPE', 'unknown'].includes(value.signal)) result.signal = value.signal;
  for (const key of ['elapsedMs', 'timeoutMs', 'stdoutBytes', 'stderrBytes']) {
    if (value[key] === null || Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key];
  }
  return result;
}
function replyWorker(request) {
  return executeWorkerRequest(request).then(result => ({
    id: request.id,
    requestId: request.requestId ?? null,
    ok: true,
    result: request.component === 'Zapret' && request.method === 'autoSelectBestProfile'
      ? compactAutoSelectResult(result)
      : result ?? null
  }), error => {
    const errorCode = request?.component === 'Vpn' && ['VPN_SERVICE_VALIDATION_FAILED', 'VPN_SERVICE_ROLLBACK_VERIFIED', 'VPN_SERVICE_ROLLBACK_UNKNOWN'].includes(error?.code) ? error.code : undefined;
    const queryDiagnostic = request?.component === 'Zapret' ? compactWorkerNativeQueryDiagnostic(error?.nativeQueryDiagnostic) : undefined;
    return { id: request?.id ?? '', requestId: request?.requestId ?? null, ok: false, error: redactDiagnosticText(error.message), ...(errorCode ? { errorCode } : {}), ...(queryDiagnostic ? { nativeQueryDiagnostic: queryDiagnostic } : {}) };
  }).then(result => {
    const line = JSON.stringify(result);
    if (Buffer.byteLength(line) > 3.5 * 1024 * 1024) process.stdout.write(JSON.stringify({ id: request.id, ok: false, error: 'Component response exceeds 3.5 MiB' }) + '\n');
    else process.stdout.write(line + '\n');
  });
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  workerBuffer += chunk;
  if (Buffer.byteLength(workerBuffer) > 65536) { process.exitCode = 2; process.stdin.destroy(); return; }
  let newline;
  while ((newline = workerBuffer.indexOf('\n')) >= 0) {
    const line = workerBuffer.slice(0, newline); workerBuffer = workerBuffer.slice(newline + 1);
    let request;
    try { request = JSON.parse(line); validateComponentRequest(request); }
    catch (error) { process.stdout.write(JSON.stringify({ id: typeof request?.id === 'string' ? request.id.slice(0, 128) : '', ok: false, error: error.message }) + '\n'); continue; }
    if (request.query) void replyWorker(request);
    else workerQueue = workerQueue.then(() => replyWorker(request));
  }
});
process.stdin.on('end', () => {
  void workerManagers.Zapret.cancelAutoSelect().catch(() => {});
  void workerQueue.finally(() => process.exit(0));
});
