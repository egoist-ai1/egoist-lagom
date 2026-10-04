import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { loadRecovered, sourceFor } from './load-recovered.mjs';

const redaction = loadRecovered('electron/ipc/diagnostics-redaction', {}, ['redactUrl', 'redactDiagnosticText', 'redactDiagnosticObject', 'isDiagnosticSecretKey', 'isDiagnosticUrlKey']);
const sentinels = ['PATH_SENTINEL_58f3','QUERY_SENTINEL_7ab2','USER_SENTINEL_4aa1','PASS_SENTINEL_cfb3','HASH_SENTINEL_9371','PEM_SENTINEL_7914','URI_SENTINEL_dc66','ASSIGN_SENTINEL_8539'];
const url = `https://${sentinels[2]}:${sentinels[3]}@dns.example.invalid:8443/dns-query/${sentinels[0]}?token=${sentinels[1]}#${sentinels[4]}`;
const assertNoSentinels = value => {
  for (const sentinel of sentinels) assert.equal(String(value).includes(sentinel), false, `Secret ${sentinel} must be absent`);
};
const corpus = {
  settings: { customDnsUrl: url, systemDohUrl:`https://dns.example.invalid/${sentinels[0]}` },
  nested: [{ endpoint:url, message:`DNS E_TIMEOUT ${url}`, apiKey:sentinels[5], privateKey:sentinels[5], metadata:{password:sentinels[3]} }],
  wireguard:`[Interface]\nPrivateKey = "${sentinels[5]}"\nEndpoint = vpn.example.invalid:51820`,
  log:`DNS E_TIMEOUT ${url}\ntg-ws-proxy.exe --host 127.0.0.1 --port 1443 --secret ${sentinels[7]}\nsecret="${sentinels[7]}"\nAuthorization: Bearer ${sentinels[3]}\nCookie: own=${sentinels[2]}\nvless://${sentinels[6]}@vpn.example.invalid:443/path\n-----BEGIN PRIVATE KEY-----\n${sentinels[5]}\n-----END PRIVATE KEY-----`,
};

test('R09: secret DNS path is hidden in diagnostic text and nested objects; operational data stays unchanged', () => {
  const original = JSON.stringify(corpus);
  const text = redaction.redactDiagnosticText(corpus.log);
  const safe = JSON.stringify(redaction.redactDiagnosticObject(corpus));
  assertNoSentinels(text);
  assertNoSentinels(safe);
  assert.match(text, /dns\.example\.invalid:8443/);
  assert.match(text, /E_TIMEOUT/);
  assert.equal(JSON.stringify(corpus), original);
  assert.equal(corpus.settings.customDnsUrl, url);
  const status = redaction.redactDiagnosticObject({security:{type:'dns',error:'E_TIMEOUT',host:'dns.example.invalid'}});
  assert.equal(status.security.type, 'dns', 'Useful security status must not be mistaken for an URI field');
});

test('R09: URL path, query, hash, percent-encoded and non-HTTP DNS credentials are concealed', () => {
  for (const value of [
    `https://dns.example.invalid/${sentinels[0]}`,
    `https://dns.example.invalid/%50ATH_SENTINEL_58f3`,
    `https://dns.example.invalid/dns-query?key=${sentinels[1]}`,
    `https://dns.example.invalid/dns-query#${sentinels[4]}`,
    `tls://${sentinels[2]}:${sentinels[3]}@dns.example.invalid:853/${sentinels[0]}`,
    `quic://dns.example.invalid:853/${sentinels[0]}`,
    `https://dns.example.invalid\\/${sentinels[0]}`,
    `https:\\/\\/dns.example.invalid\\/${sentinels[0]}`,
    `https://[malformed/${sentinels[0]}`,
  ]) {
    const safe = redaction.redactDiagnosticText(value);
    assertNoSentinels(safe);
    assert.equal(safe.includes('%50ATH_SENTINEL_58f3'), false);
  }
  assert.equal(redaction.redactUrl('https://cloudflare-dns.com/dns-query'), 'https://cloudflare-dns.com/dns-query');
});

test('R09: quoted assignments, nested secret objects and incomplete or long PEM blocks do not reveal material', () => {
  for (const value of [
    `privateKey = '${sentinels[5]}'`,
    `"access_token":"${sentinels[7]}"`,
    `secret="${sentinels[7]}`,
    `-----BEGIN PRIVATE KEY-----\n${sentinels[5]}`,
    `-----BEGIN PRIVATE KEY-----\n${'x'.repeat(9000)}${sentinels[5]}\n-----END PRIVATE KEY-----`,
    `trojan://${sentinels[6]}@vpn.example.invalid:443`,
  ]) assertNoSentinels(redaction.redactDiagnosticText(value));
  assertNoSentinels(JSON.stringify(redaction.redactDiagnosticObject({api_key:{nested:sentinels[5]}, endpoint:url})));
});

test('R09: actual electron-log hook sanitizes object keys, errors, deep and circular input without changing it', () => {
  const log = {hooks:[],transports:{file:{},console:{}}};
  loadRecovered('electron/ipc/logger', {...redaction, log, Error}, ['redactLogValue']);
  assert.equal(log.hooks.length, 1);
  const cycle = {message:url};
  cycle.self = cycle;
  const repeated = {message:`E_TIMEOUT ${url}`};
  const input = {apiKey:sentinels[5],settings:corpus.settings,error:new Error(`E_TIMEOUT ${url}`),
    deep:{a:{b:{c:{url,secret:sentinels[7]}}}},cycle,repeated:[repeated,repeated]};
  const message = {data:[input]};
  const safe = log.hooks[0](message);
  const text = JSON.stringify(safe);
  assertNoSentinels(text);
  assert.match(text, /E_TIMEOUT/);
  assert.match(text, /dns\.example\.invalid/);
  assert.match(text, /<depth-limit>/);
  assert.match(text, /<circular>/);
  assert.equal(safe.data[0].repeated[0].message, safe.data[0].repeated[1].message);
  assert.equal(input.apiKey, sentinels[5]);
  assert.equal(input.settings.customDnsUrl, url);
  assert.equal(cycle.self, cycle);
});

test('R09: every entry of the actual locally exported ZIP omits the synthetic corpus', {skip:process.platform !== 'win32'}, async t => {
  const root = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP || os.tmpdir(), 'redaction-export-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  const logPath = path.join(root, 'main.log');
  await fs.writeFile(logPath, corpus.log, 'utf8');
  const dohRoot=path.join(root,'SystemDoH');
  await fs.mkdir(path.join(dohRoot,'service-logs'),{recursive:true});
  for(const name of ['egoistshield-system-doh-service.out.log','egoistshield-system-doh-service.0.out.log','egoistshield-system-doh-service.wrapper.log']) await fs.writeFile(path.join(dohRoot,'service-logs',name),'x'.repeat(110*1024)+'\n'+corpus.log,'utf8');
  const ps = process.env.LAGOM_TEST_POWERSHELL || path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const source = sourceFor('electron/ipc/handlers-health');
  const start = source.indexOf('function getLogFilePath$1()');
  const end = source.indexOf('async function buildPerformanceProfile(', start);
  assert.ok(start >= 0 && end > start, 'Actual archive export boundary is present');
  const context = vm.createContext({
    ...redaction, promises:fs, path, Date, Buffer,
    app:{getPath: () => root},
    log:{transports:{file:{getFile: () => ({path:logPath})}},warn(){}},
    shell:{showItemInFolder(){}, async openPath(){}},
    buildHealthReport:async () => ({components:[{detail:corpus.log}]}),
    readRecentRuntimeEvents$1:async () => [{message:corpus.log}],
    execFileAsync$14:promisify(execFile), resolveWindowsExecutable: () => ps,
  });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.exportBundle = exportDiagnosticsBundle;', context);
  const status = async () => ({running:false, diagnostic:corpus.log, url});
  const result = await context.exportBundle({
    stateStore:{get: () => ({nodes:[],subscriptions:[],processRules:[],domainRules:[],usageHistory:[],settings:corpus.settings})},
    runtimeManager:{status}, systemDohManager:{status,workDir:dohRoot}, zapretManager:{status}, telegramProxyManager:{status},
  });
  assert.equal(result.ok, true, result.message);
  const escaped = result.filePath.replace(/'/g, "''");
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead('${escaped}'); try { $rows=@($z.Entries | ForEach-Object { $r=[IO.StreamReader]::new($_.Open()); try { [pscustomobject]@{name=$_.FullName; text=$r.ReadToEnd()} } finally {$r.Dispose()} }); ConvertTo-Json -InputObject $rows -Depth 8 -Compress } finally {$z.Dispose()}`;
  const {stdout} = await promisify(execFile)(ps, ['-NoProfile','-NonInteractive','-Command',script], {windowsHide:true, maxBuffer:4*1024*1024, timeout:30000});
  const entries = JSON.parse(stdout.replace(/^\uFEFF/, ''));
  assert.equal(entries.length, 9);
  const capture = JSON.parse(entries.find(item => item.name === 'diagnostic-capture-manifest.json').text);
  assert.ok(capture.logs.some(item => item.entry === 'system-doh-runtime.log.redacted.txt' && item.state === 'missing'));
  assert.ok(capture.logs.some(item => item.entry === 'main.log.redacted.txt' && item.state === 'captured'));
  assert.deepEqual(entries.filter(item=>item.name.startsWith('system-doh-')).map(item=>item.name).sort(), ['system-doh-current.log.redacted.txt','system-doh-previous.log.redacted.txt','system-doh-wrapper.log.redacted.txt']);
  for(const entry of entries.filter(item=>item.name.startsWith('system-doh-'))) {assert.ok(entry.text.length<=96*1024);assert.match(entry.text,/redacted/);}
  for (const entry of entries) assertNoSentinels(entry.text);
  assert.match(entries.find(item => item.name === 'main.log.redacted.txt').text, /E_TIMEOUT/);
  assert.equal(await fs.readFile(logPath, 'utf8'), corpus.log, 'Source log is untouched');
});

test('R09: archive failure and unavailable-log catch messages redact URL credentials and paths', async t => {
  const root = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP || os.tmpdir(), 'redaction-error-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  const logPath = path.join(root, 'unavailable.log');
  await fs.writeFile(logPath, 'fixture', 'utf8');
  const source = sourceFor('electron/ipc/handlers-health');
  const start = source.indexOf('function getLogFilePath$1()');
  const end = source.indexOf('async function buildPerformanceProfile(', start);
  const context = vm.createContext({
    ...redaction, path, Date, Buffer,
    promises:{...fs,open:async (...args) => {
      const [file] = args;
      if (file === logPath) throw new Error(`E_LOG_UNAVAILABLE ${url}`);
      return fs.open(...args);
    }},
    app:{getPath: () => root},
    log:{transports:{file:{getFile: () => ({path:logPath})}},warn(){}},
    shell:{showItemInFolder(){},async openPath(){}},
    buildHealthReport:async () => ({}), readRecentRuntimeEvents$1:async () => [],
    execFileAsync$14:async () => {throw new Error(`E_EXPORT ${url}`);}, resolveWindowsExecutable: () => 'controlled fault',
  });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.exportBundle = exportDiagnosticsBundle;', context);
  const status = async () => ({running:false});
  const result = await context.exportBundle({
    stateStore:{get: () => ({nodes:[],subscriptions:[],processRules:[],domainRules:[],usageHistory:[],settings:{}})},
    runtimeManager:{status},systemDohManager:{status},zapretManager:{status},telegramProxyManager:{status},
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /E_EXPORT/);
  assertNoSentinels(result.message);
  const [directory] = await fs.readdir(path.join(root,'diagnostics'));
  const text = await fs.readFile(path.join(root,'diagnostics',directory,'main.log.redacted.txt'),'utf8');
  assert.match(text, /E_LOG_UNAVAILABLE/);
  assertNoSentinels(text);
});

test('runtime CLI credentials are hidden in wrapper text while ordinary options remain useful', () => {
  for (const flag of ['secret','token','password','api-key','access_token','private-key']) {
    for (const assignment of [`--${flag} ${sentinels[7]}`, `--${flag}="${sentinels[7]} with spaces"`, `"--${flag}" '${sentinels[7]}'`, `--${flag.toUpperCase()}\t${sentinels[7]}`]) {
      const input=`tg-ws-proxy.exe --host 127.0.0.1 --port 1443 ${assignment}`;
      const safe=redaction.redactDiagnosticText(input);assertNoSentinels(safe);assert.match(safe,/--host 127\.0\.0\.1 --port 1443/);assert.match(safe,/<redacted>/);assert.equal(redaction.redactDiagnosticText(safe),safe);
      assertNoSentinels(JSON.stringify(redaction.redactDiagnosticObject({tail:input})));
    }
  }
  assert.equal(redaction.redactDiagnosticText('--secret-file C:\\safe\\config.json --tokenizer regular'),'--secret-file C:\\safe\\config.json --tokenizer regular');
});
