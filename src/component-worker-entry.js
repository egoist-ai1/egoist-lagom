const workerResources = __dirname;
const workerProductRoot = path.join(process.env.ProgramData, 'EgoistShield');
const workerUserData = path.join(workerProductRoot, 'Service', 'ComponentWorker');
const workerManagers = {
  SystemDoH: new SystemDohManager(workerResources, path.join(workerResources, 'app.asar'), workerUserData, path.join(workerProductRoot, 'Runtime', 'SystemDoH')),
  Zapret: new ZapretManager(workerResources, path.join(workerResources, 'app.asar'), workerUserData, path.join(workerProductRoot, 'Runtime', 'Zapret')),
  TelegramProxy: new TelegramProxyManager(workerResources, path.join(workerResources, 'app.asar'), workerUserData, path.join(workerProductRoot, 'Runtime', 'TelegramProxy')),
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
  return workerManagers[value.component][value.method](...value.args);
}
function replyWorker(request) {
  return executeWorkerRequest(request).then(result => ({
    id: request.id,
    ok: true,
    result: request.component === 'Zapret' && request.method === 'autoSelectBestProfile'
      ? compactAutoSelectResult(result)
      : result ?? null
  }), error => ({ id: request?.id ?? '', ok: false, error: redactDiagnosticText(error.message) })).then(result => {
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
