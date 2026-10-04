import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { loadRecovered } from './load-recovered.mjs';

const require = createRequire(import.meta.url);
const Logger = require(path.join(path.dirname(require.resolve('electron-log/package.json')), 'src/core/Logger.js'));
const redaction = loadRecovered('electron/ipc/diagnostics-redaction', { createHash, Error },
  ['redactDiagnosticText', 'redactDiagnosticObject', 'isDiagnosticSecretKey', 'isDiagnosticUrlKey']);
const secret = 'LOGGER_TRANSPORT_SECRET_fixture';
function fixture() {
  const captures = { console: [], file: [] }, seen = [];
  const factory = name => () => Object.assign(message => captures[name].push(message), { level: 'info' });
  const log = new Logger({ logId: `audit-${randomUUID()}`, transportFactories: { console: factory('console'), file: factory('file') } });
  log.hooks.push(message => { seen.push({ message, originalData: message.data }); return message; });
  loadRecovered('electron/ipc/logger', { ...redaction, log, Error, fs, path, process, randomUUID }, ['logger']);
  return { log, captures, seen };
}
function contextOf(message) {
  const prefix = '[context] ';
  const end = message.indexOf('} ') + 1;
  assert.equal((message.match(/\[context\]/g) || []).length, 1);
  return JSON.parse(message.slice(prefix.length, end));
}

test('actual electron-log transports share one redacted context without mutating the normalized message', () => {
  const { log, captures, seen } = fixture();
  const value = new Error(`TLS fail https://private.invalid/dns-query/${secret}?token=${secret}`);
  log.info('same-event', { value, token: secret });
  assert.equal(captures.console.length, 1);
  assert.equal(captures.file.length, 1);
  assert.equal(seen.length, 2, 'actual Logger calls hooks separately for its two transports');
  assert.equal(seen[0].message, seen[1].message, 'the library reuses its normalized message');
  assert.equal(seen[0].message.data, seen[0].originalData, 'the product hook leaves library input intact');
  assert.equal(seen[1].originalData, seen[0].originalData);
  assert.equal(seen[0].message.data[0], 'same-event');
  assert.equal(seen[0].message.data[1].value, value);
  assert.equal(seen[0].message.data[1].token, secret);
  assert.deepEqual(captures.console[0].data, captures.file[0].data);
  assert.deepEqual(contextOf(captures.console[0].data[0]), contextOf(captures.file[0].data[0]));
  assert.ok(!JSON.stringify(captures.file[0]).includes(secret));
});

test('actual multi-transport logger allocates a new sequence for each event, including object-first messages', () => {
  const { log, captures } = fixture();
  log.info('first'); log.info('second'); log.info({ token: secret, event: 'third' });
  const first = contextOf(captures.file[0].data[0]);
  const second = contextOf(captures.file[1].data[0]);
  const objectContext = JSON.parse(captures.file[2].data.at(-1).slice('[context] '.length));
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(second.sequence, first.sequence + 1);
  assert.equal(objectContext.sequence, second.sequence + 1);
  assert.deepEqual(captures.console[2].data, captures.file[2].data);
  assert.ok(!JSON.stringify(captures.file[2]).includes(secret));
});