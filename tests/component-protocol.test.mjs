import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { z } from 'zod';
import { spawn } from 'node:child_process';
const context = vm.createContext({ z, URL, TelegramProxyConfigSchema: z.object({ port: z.number().int().min(1).max(65535) }).strict(), ZapretProfileInputSchema: z.string().min(1), ZapretUserListsInputSchema: z.object({}), ZapretGameFilterModeSchema: z.enum(['disabled','all','tcp','udp']), ZapretIpsetModeSchema: z.enum(['loaded','none','any']), ZapretCoreVersionInputSchema: z.string().regex(/^v?\d+(?:\.\d+){1,3}[a-z]?$/i) });
vm.runInContext(fs.readFileSync('src/component-protocol.js', 'utf8') + '\nglobalThis.validate = validateComponentRequest;', context);
const request = (component, method, args = [], query = false) => context.validate({ id: 'test', component, method, args, query });

test('broker rejects arbitrary method, inherited property and command arguments', () => {
  for (const method of ['constructor', '__proto__', 'execPowerShell', 'launchConsoleCommand', 'removeExistingDirectories']) assert.throws(() => request('Zapret', method));
  assert.throws(() => request('Zapret', 'startService', ['powershell.exe']));
  assert.throws(() => request('Zapret', 'startStandalone', ['../other.exe']));
  assert.throws(() => request('TelegramProxy', 'saveConfig', [{ port: 9050, command: 'calc' }]));
});
test('query endpoint cannot invoke mutations and optional arguments are accepted', () => {
  assert.throws(() => request('Zapret', 'startService', [], true));
  assert.throws(() => request('Zapret', 'listProfiles', [], true));
  assert.equal(request('TelegramProxy', 'status', [], true).method, 'status');
  assert.equal(request('Zapret', 'cancelAutoSelect', [], true).method, 'cancelAutoSelect');
});
test('DoH accepts HTTPS and loopback addresses only', () => {
  request('SystemDoH', 'apply', ['https://dns.google/dns-query']);
  assert.equal(request('SystemDoH', 'apply', ['https://dns.google/dns-query', '']).args[1], undefined);
  assert.throws(() => request('SystemDoH', 'apply', ['http://dns.google/dns-query']));
  assert.throws(() => request('SystemDoH', 'apply', ['https://dns.google/dns-query', '0.0.0.0']));
});
test('auto-select accepts only a Discord voice endpoint from the interactive desktop', () => {
  const target = { key: 'DiscordVoiceControl', label: 'Discord Voice TCP', url: 'https://c-waw03-80dae1ab.discord.media:2083/', voiceControl: true };
  assert.equal(request('Zapret', 'autoSelectBestProfile', [target]).args[0].url, target.url);
  assert.equal(request('Zapret', 'autoSelectBestProfile', [null]).args[0], undefined);
  for (const url of ['https://example.com:2083/', 'http://c-waw03.discord.media:2083/', 'https://c-waw03.discord.media:443/', 'https://c-waw03.discord.media:2083/a']) {
    assert.throws(() => request('Zapret', 'autoSelectBestProfile', [{ ...target, url }]));
  }
});
test('desktop facade passes its fresh Discord voice target to the Core worker', async () => {
  const calls = [];
  const target = { key: 'DiscordVoiceControl', label: 'Discord Voice TCP', url: 'https://c-waw03.discord.media:2083/', voiceControl: true };
  const sandbox = vm.createContext({ componentOperations: () => ({ Zapret: { autoSelectBestProfile: true } }), COMPONENT_QUERIES: new Set(), setInterval, clearInterval });
  vm.runInContext(fs.readFileSync('src/component-facade.js', 'utf8') + '\nglobalThis.wrap = useComponentService;', sandbox);
  const manager = { async readRecentDiscordVoiceControlTarget() { return target; } };
  const coreService = { async request(action, request) { calls.push({ action, request }); return { completed: true }; } };
  const facade = sandbox.wrap(manager, 'Zapret', coreService);
  await facade.autoSelectBestProfile(() => {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'component.execute');
  assert.equal(calls[0].request.args[0].url, target.url);
});
test('built worker rejects malformed requests without performing system operations', async () => {
  const child = spawn(process.execPath, ['.vite/build/component-worker.cjs'], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(JSON.stringify({ id: 'invalid-method', component: 'Zapret', method: 'execPowerShell', args: ['Get-Process'], query: false }) + '\n');
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  assert.equal(code, 0, stderr);
  const result = JSON.parse(stdout.trim());
  assert.equal(result.id, 'invalid-method');
  assert.equal(result.ok, false);
  assert.match(result.error, /Unsupported component operation/);
});
