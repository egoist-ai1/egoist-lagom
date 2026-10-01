import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { z } from 'zod';
import { isIP } from 'node:net';
import { loadRecovered } from './load-recovered.mjs';

const compact = fs.readFileSync(new URL('../src/brand/CompactRuby.jsx', import.meta.url), 'utf8');
const renderer = fs.readFileSync(new URL('../src/recovered/renderer.js', import.meta.url), 'utf8');
function extract(source, name) {
  const match = new RegExp(`(?:^|\n)((?:async )?function ${name}\\()`).exec(source);
  assert.ok(match, `Real production helper ${name} exists`);
  const start = match.index + (source[match.index] === '\n' ? 1 : 0);
  const next = /\n(?:async )?function /.exec(source.slice(start + match[1].length));
  assert.ok(next, `Production boundary ${name} exists`);
  return source.slice(start, start + match[1].length + next.index);
}
const bindingNames = ['rubyVpnSettingsPatch', 'rubyVpnRuleTarget', 'rubyVpnRuleChange', 'rubyNetworkWriteOutcome', 'rubyVpnRuleCommand', 'rubyServerPage'];
const ui = vm.runInNewContext(bindingNames.map(name => extract(compact, name)).join('\n') + '\n' + extract(renderer, 'rubySettingsOutcome') + '\n({' + bindingNames.join(',') + '})', { URL, Z: (_name, method, ...args) => method(...args) });
const plain = value => JSON.parse(JSON.stringify(value));
const schema = loadRecovered('electron/ipc/ipc-schemas', { z, isIP }, ['AppSettingsSchema', 'DomainRuleSchema', 'ProcessRuleSchema', 'RulesPatchInputSchema']);
const settings = { routeMode: 'global', dnsMode: 'auto', useTunMode: false, customDnsUrl: '' };
const state = (revision = 8) => ({ stateRevision: revision, settings, nodes: [], domainRules: [], processRules: [] });

test('UI settings values satisfy actual production schema and save only changed keys', () => {
  for (const routeMode of ['global', 'selected']) for (const dnsMode of ['auto', 'secure', 'system', 'custom']) {
    const draft = { ...settings, routeMode, dnsMode, customDnsUrl: 'https://resolver.example:8443/dns-query?client=one' };
    const patch = plain(ui.rubyVpnSettingsPatch(draft, settings));
    schema.AppSettingsSchema.partial().strict().parse(patch);
    assert.ok(!('autoStart' in patch));
    assert.ok(!('nodes' in patch));
    assert.equal('useTunMode' in patch, false);
    if (dnsMode === 'custom') assert.equal(patch.customDnsUrl, draft.customDnsUrl);
  }
  for (const routeMode of ['rules', 'bypass', 'smart', null]) assert.throws(() => ui.rubyVpnSettingsPatch({ ...settings, routeMode }, settings), /маршрутизации/);
  for (const dnsMode of ['tls', 'plain', null]) assert.throws(() => ui.rubyVpnSettingsPatch({ ...settings, dnsMode }, settings), /DNS/);
  assert.deepEqual(plain(ui.rubyVpnSettingsPatch(settings, settings)), {});
});

test('custom VPN DNS preserves the HTTPS port and query and rejects unsupported or ambiguous inputs', () => {
  for (const customDnsUrl of ['', 'dns.example', 'tls://dns.example', 'http://dns.example/dns-query', 'https://user:secret@dns.example/dns-query', 'https://dns.example/dns-query#fragment', 'https://dns.example\\other/dns-query', 'https://dns.exa\u200bmple/dns-query', 'https://dns.example/dns\n-query']) {
    assert.throws(() => ui.rubyVpnSettingsPatch({ ...settings, dnsMode: 'custom', customDnsUrl }, settings), /HTTPS|DoH/);
  }
  const value = 'https://dns.example:8443/dns-query?client=private';
  assert.equal(ui.rubyVpnSettingsPatch({ ...settings, dnsMode: 'custom', customDnsUrl: value }, settings).customDnsUrl, value);
});

test('plain domains and process basenames meet the real rule schema without accepting paths, URL or IP rules', () => {
  assert.equal(ui.rubyVpnRuleTarget('domain', 'EXAMPLE.org.'), 'example.org');
  assert.equal(ui.rubyVpnRuleTarget('domain', 'пример.рф'), 'xn--e1afmkfd.xn--p1ai');
  for (const domain of ['https://example.org', 'example.org/path', '*.example.org', 'full:example.org', '127.0.0.1', 'localhost', 'bad_.example', 'x'.repeat(64) + '.org']) assert.throws(() => ui.rubyVpnRuleTarget('domain', domain));
  for (const process of ['browser', 'C:\\Apps\\browser.exe', '/bin/browser', '*.exe', 'browser.exe\u200b', 'browser.exe\n', 'browser.exe.', '']) assert.throws(() => ui.rubyVpnRuleTarget('process', process));
  const process = ui.rubyVpnRuleTarget('process', ' LagomVpnProbe.exe ');
  assert.equal(process, 'LagomVpnProbe.exe');
  schema.ProcessRuleSchema.parse({ id: 'process-rule', process, mode: 'vpn' });
  schema.DomainRuleSchema.parse({ id: 'domain-rule', domain: ui.rubyVpnRuleTarget('domain', 'example.org'), mode: 'direct' });
});

test('rule editing, deleting and ordering target stable IDs, preserve other rows, and reject stale or duplicate targets', () => {
  const rows = [{ id: 'first', process: 'first.exe', mode: 'vpn' }, { id: 'last', process: 'last.exe', mode: 'direct' }];
  const updated = ui.rubyVpnRuleChange(rows, 'process', 'edit', { id: 'last', process: 'new.exe', mode: 'block' });
  assert.equal(updated[0], rows[0]);
  assert.equal(rows[1].process, 'last.exe', 'No optimistic mutation of the observed snapshot');
  assert.deepEqual(plain(updated[1]), { id: 'last', process: 'new.exe', mode: 'block' });
  assert.deepEqual(plain(ui.rubyVpnRuleChange(rows, 'process', 'remove', { id: 'last' })), [rows[0]]);
  assert.deepEqual(ui.rubyVpnRuleChange(rows, 'process', 'up', rows[1]).map(rule => rule.id).join(','), 'last,first');
  assert.throws(() => ui.rubyVpnRuleChange(rows, 'process', 'edit', { id: 'removed', process: 'new.exe', mode: 'vpn' }), /удалено/);
  assert.throws(() => ui.rubyVpnRuleChange(rows, 'process', 'add', { id: 'new', process: 'FIRST.EXE', mode: 'block' }), /уже есть/);
  assert.throws(() => ui.rubyVpnRuleChange(rows, 'process', 'add', { id: 'new', process: 'new.exe', mode: 'allow' }), /действие/);
  const full = Array.from({ length: 256 }, (_, index) => ({ id: String(index), process: `p${index}.exe`, mode: 'vpn' }));
  assert.throws(() => ui.rubyVpnRuleChange(full, 'process', 'add', { id: 'new', process: 'new.exe', mode: 'vpn' }), /256/);
  for (let page = 0; page < 11; page++) assert.ok(ui.rubyServerPage(full, page, 24).rows.length <= 24);
});

test('real rule action performs a fresh read and only one narrow CAS mutation, preserving the other rule array', async () => {
  const fresh = state(); fresh.domainRules = [{ id: 'domain', domain: 'example.org', mode: 'direct' }];
  const calls = [];
  const api = { state: { get: async () => { calls.push('get'); return fresh; }, patchRules: async (patch, revision) => {
    calls.push('patch');
    schema.RulesPatchInputSchema.parse({ patch, expectedRevision: revision });
    assert.equal(revision, 8);
    assert.deepEqual(Object.keys(patch), ['processRules']);
    assert.deepEqual(plain(patch.processRules), [{ id: 'process', process: 'LagomVpnProbe.exe', mode: 'vpn' }]);
    return { ok: true, state: { ...fresh, ...patch, stateRevision: 9 }, revision: 9 };
  } } };
  const result = await ui.rubyVpnRuleCommand(api, 'process', 'add', { id: 'process', process: 'LagomVpnProbe.exe', mode: 'vpn' }, 8);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['get', 'patch']);
  assert.equal(result.state.domainRules, fresh.domainRules);
  assert.equal(fresh.processRules.length, 0);
});

test('stale revision and failed or malformed writes cannot report saved success or trigger a retry overwrite', async () => {
  let mutations = 0;
  const fresh = state(9);
  const api = { state: { get: async () => fresh, patchRules: async () => { mutations++; } } };
  const result = await ui.rubyVpnRuleCommand(api, 'process', 'add', { id: 'process', process: 'probe.exe', mode: 'vpn' }, 8);
  assert.equal(result.ok, false); assert.equal(result.conflict, true); assert.equal(result.state, fresh); assert.equal(mutations, 0);
  assert.match(result.message, /актуальные значения/);
  for (const response of [undefined, true, {}, { ok: true }, { ok: true, state: { stateRevision: 9 } }, { ok: false, error: 'STATE_WRITE_FAILED', state: fresh }]) assert.equal(ui.rubyNetworkWriteOutcome(response).ok, false);
  api.state.get = async () => { throw new Error('Core unavailable'); };
  await assert.rejects(ui.rubyVpnRuleCommand(api, 'process', 'add', { id: 'process', process: 'probe.exe', mode: 'vpn' }, 9), /Core unavailable/);
  assert.equal(mutations, 0);
});

test('routing controls have visible names, use native modal focus, and require a separate background snapshot apply', () => {
  for (const label of ['Режим маршрутизации VPN', 'DNS соединения VPN', 'Процесс для правила VPN', 'Добавить правило процесса VPN', 'Сохранить настройки VPN', 'Применить сервер и правила']) assert.ok(compact.includes(label));
  assert.ok(compact.includes('<dialog className="ruby-rule-dialog"'));
  assert.ok(compact.includes('dialog.current?.showModal()'));
  assert.ok(compact.includes('aria-labelledby={labelId}'));
  assert.ok(compact.includes('onKeyDown={keepFocus}'));
  assert.ok(compact.includes('<div className="ruby-activity-region">'));
  assert.ok(compact.includes('Сохранение не меняет уже работающее соединение.'));
  assert.ok(compact.includes('Этот режим не подтверждает шифрование или отсутствие утечек.'));
  assert.ok(!compact.includes("Z('state.set'"));
  assert.ok(renderer.includes('(0, V.jsx)(RubyNetworkSettings, { runAction: e2, snapshot: t2 })'));
});
