import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { loadRecovered, sourceFor } from './load-recovered.mjs';

const redaction = loadRecovered('electron/ipc/diagnostics-redaction', { createHash, Error },
  ['redactDiagnosticText', 'redactDiagnosticObject', 'isDiagnosticSecretKey', 'isDiagnosticUrlKey', 'diagnosticCorrelationId']);
const secret = 'DIAGNOSTIC_SECRET_7c311e';
const url = `https://user:pass@private.invalid:8443/dns-query/${secret}?token=${secret}`;
const noSecret = value => assert.ok(!JSON.stringify(value).includes(secret));
function loggerApi(extra = {}) {
  const lines = [];
  const log = { hooks: [], transports: { file: {}, console: () => {} }, info: (...v) => lines.push(v), warn: (...v) => lines.push(v), debug: (...v) => lines.push(v), error: (...v) => lines.push(v) };
  return { ...loadRecovered('electron/ipc/logger', { ...redaction, log, Error, fs, path, process, randomUUID, ...extra }, ['redactLogValue', 'formatRuntimeLogEvent', 'logger', 'configureLoggerPaths']), log, lines };
}
function healthApi(extra = {}) {
  const source = sourceFor('electron/ipc/handlers-health');
  const context = vm.createContext({ ...redaction, Error, path, promises, Buffer, createHash,
    app: { isPackaged: false }, process: { env: {} }, log: { transports: { file: { getFile: () => ({ path: path.resolve('main.log') }) } } }, ...extra });
  vm.runInContext(source.slice(source.indexOf('function getLogFilePath$1()'), source.indexOf('async function exportDiagnosticsBundle(')) +
    '\nglobalThis.api={captureDiagnosticLogTail, diagnosticLogInventory, exportDiagnosticLogInventory};', context);
  return context.api;
}
async function fixture(t) {
  const dir = await promises.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP || os.tmpdir(), 'diagnostic-hardening-'));
  t.after(() => promises.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('distinct request UUIDs remain distinct and retries correlate after diagnostic redaction', () => {
  const a = randomUUID(), b = randomUUID();
  const first = redaction.redactDiagnosticText(`requestId=${a}`);
  assert.equal(first, redaction.redactDiagnosticText(`requestId=${a}`));
  assert.notEqual(first, redaction.redactDiagnosticText(`requestId=${b}`));
  assert.ok(!first.includes(a));
  assert.match(first, /id-[a-f0-9]{24}/);
});

test('nested exception causes preserve stage/code while private URL and raw commands disappear', () => {
  const api = loggerApi();
  const inner = Object.assign(new Error(`TLS fail ${url}`), { code: 'TLS_TIMEOUT' });
  const outer = new Error(`DoH fail ${url}`, { cause: inner });
  const input = { stage: 'doh-preflight', error: outer, commandLine: `xray ${secret}`, rawPayload: secret };
  const safe = api.redactLogValue(input);
  noSecret(safe);
  assert.equal(safe.error.cause.code, 'TLS_TIMEOUT');
  assert.match(safe.error.cause.message, /TLS fail/);
  assert.equal(input.error, outer);
  const cycle = {}; cycle.cause = cycle;
  noSecret(redaction.redactDiagnosticObject({ error: outer, cycle }));
});

test('actual hook records UTC/offset/session/sequence without breaking runtime event JSON', () => {
  const api = loggerApi();
  const run = () => api.log.hooks[0]({ data: [api.formatRuntimeLogEvent({ timestamp: 'fixture', lifecycle: 'degraded', level: 'warn', error: url })] });
  const a = run().data[0], b = run().data[0];
  const context = JSON.parse(a.slice('[context] '.length, a.indexOf(' [runtime-event]')));
  const contextB = JSON.parse(b.slice('[context] '.length, b.indexOf(' [runtime-event]')));
  assert.match(context.timestampUtc, /Z$/);
  assert.equal(context.pid, process.pid);
  assert.equal(context.sessionId, contextB.sessionId);
  assert.equal(contextB.sequence, context.sequence + 1);
  noSecret(JSON.parse(a.slice(a.indexOf('[runtime-event]') + '[runtime-event]'.length)));
});

test('actual GUI rotation keeps exactly three previous segments and preserves UTF-8', async t => {
  const dir = await fixture(t), target = path.join(dir, 'main.log');
  const api = loggerApi();
  for (let index = 0; index < 7; index++) {
    await promises.writeFile(target, `событие-${index}`, 'utf8');
    api.log.transports.file.archiveLogFn({ toString: () => target, crop: () => assert.fail('Unexpected crop') });
  }
  assert.deepEqual((await promises.readdir(dir)).sort(), ['main.old.log', 'main.old.log.1', 'main.old.log.2']);
  assert.equal(await promises.readFile(path.join(dir, 'main.old.log.2'), 'utf8'), 'событие-4');
});

test('fixed archive inventory includes Core/Xray/GUI/TG/Zapret/VPN rotations without recursive discovery', () => {
  const root = path.resolve('fixed-fixture');
  const api = healthApi({ app: { isPackaged: true }, process: { env: { ProgramData: root } } });
  const rows = api.diagnosticLogInventory({ systemDohManager: { workDir: path.join(root, 'SystemDoH') },
    zapretManager: { workDir: path.join(root, 'Zapret') }, telegramProxyManager: { appDataDir: path.join(root, 'TelegramProxy') } });
  assert.ok(rows.some(row => row.source === 'core' && row.target.endsWith('service.log.3')));
  assert.ok(rows.some(row => row.entry === 'system-doh-runtime.log.redacted.txt'));
  for (const source of ['gui', 'core', 'system-doh', 'zapret', 'telegram', 'vpn']) assert.ok(rows.some(row => row.source === source));
  assert.ok(rows.length < 65);
  assert.equal(new Set(rows.map(row => row.entry)).size, rows.length);
  assert.ok(rows.reduce((n, row) => n + row.maxBytes, 0) <= 8 * 1024 * 1024);
});

test('bounded UTF-8 log tail redacts private URL, orphan PEM and reports truncation/hash', async t => {
  const dir = await fixture(t), target = path.join(dir, 'runtime.log');
  await promises.writeFile(target, `${'ж'.repeat(8000)}\n${secret}\n-----END PRIVATE KEY-----\nE_TIMEOUT ${url}\n`, 'utf8');
  const result = await healthApi().captureDiagnosticLogTail({ target, source: 'system-doh', entry: 'runtime.txt', maxBytes: 1024 });
  noSecret(result);
  assert.equal(result.metadata.state, 'captured');
  assert.equal(result.metadata.truncated, true);
  assert.ok(result.metadata.capturedBytes <= 1024);
  assert.match(result.text, /E_TIMEOUT/);
  assert.equal(result.metadata.redactedSha256, createHash('sha256').update(result.text).digest('hex'));
  assert.equal(await promises.readFile(target, 'utf8').then(v => v.includes(secret)), true);
});

test('missing/read errors and binary/reparse targets are explicit, not healthy empty logs', async t => {
  const dir = await fixture(t), target = path.join(dir, 'missing.log');
  const api = healthApi();
  const missing = await api.captureDiagnosticLogTail({ target, source: 'core', entry: 'core.txt', maxBytes: 128 });
  assert.equal(missing.metadata.state, 'missing');
  const directory = await api.captureDiagnosticLogTail({ target: dir, source: 'core', entry: 'core.txt', maxBytes: 128 });
  assert.equal(directory.metadata.state, 'read-error');
  assert.equal(directory.metadata.errorCode, 'LOG_PATH_UNTRUSTED');
  await promises.writeFile(target, Buffer.from([0, 1, 2, 3]));
  const binary = await api.captureDiagnosticLogTail({ target, source: 'core', entry: 'core.txt', maxBytes: 128 });
  assert.equal(binary.metadata.errorCode, 'LOG_ENCODING_UNSUPPORTED');
});

test('safe bundle inventory emits captured rotations plus an explicit missing-source manifest', async t => {
  const dir = await fixture(t), work = path.join(dir, 'export');
  await promises.mkdir(work);
  await promises.writeFile(path.join(dir, 'main.log'), `днс ошибка ${url}`, 'utf8');
  await promises.writeFile(path.join(dir, 'main.old.log'), `предыдущая ${url}`, 'utf8');
  const api = healthApi({ log: { transports: { file: { getFile: () => ({ path: path.join(dir, 'main.log') }) } } } });
  await api.exportDiagnosticLogInventory({ systemDohManager: {}, zapretManager: {}, telegramProxyManager: {} }, work);
  const manifest = JSON.parse(await promises.readFile(path.join(work, 'diagnostic-capture-manifest.json'), 'utf8'));
  assert.equal(manifest.logs.filter(row => row.state === 'captured').length, 2);
  assert.equal(manifest.logs.filter(row => row.state === 'missing').length, 2);
  for (const name of await promises.readdir(work)) noSecret(await promises.readFile(path.join(work, name), 'utf8'));
});
