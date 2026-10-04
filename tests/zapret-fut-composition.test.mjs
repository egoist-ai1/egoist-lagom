import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import { loadRecovered } from './load-recovered.mjs';

const runtime = 'C:\\Профили Lagom\\Runtime Zapret';
const lists = path.win32.join(runtime, 'core', 'lists');
function api(bindings = {}) {
  return loadRecovered('electron/ipc/zapret-manager', {
    path: path.win32, isIP, promisify: fn => fn, execFile: () => {},
    package_default: { version: '3.8.0' }, ...bindings,
  }, ['ZapretManager', 'applyZapretProfileExclusions', 'splitWindowsCommandLine']);
}
const { applyZapretProfileExclusions: compose, splitWindowsCommandLine: split } = api();
const hostlist = name => '--hostlist=' + path.win32.join(lists, name);
const managed = hostlist('list-egoist-discord.txt');
const eligible = ['--filter-tcp=80,443', managed, '--dpi-desync=hostfakesplit',
  '--dpi-desync-repeats=4', '--dpi-desync-fooling=ts,md5sig', '--dpi-desync-hostfakesplit-mod=host=ozon.ru'];
const render = args => args.map(arg => /\s/.test(arg) ? '"' + arg + '"' : arg).join(' ');
const domains = args => [...args].filter(arg => arg.startsWith('--hostlist-domains='));
function strategies(command) {
  const result = [[]];
  for (const arg of split(command)) {
    if (arg === '--new') result.push([]);
    else result.at(-1).push(arg);
  }
  return result.map(args => [...args]);
}

for (const includeExclusions of [true, false]) {
  test(`managed Discord hostfakesplit includes FUT during ${includeExclusions ? 'fresh composition' : 'installed refresh'}`, () => {
    const result = [...split(compose(render(eligible), lists, includeExclusions))];
    assert.deepEqual(domains(result), ['--hostlist-domains=fut.gg']);
    for (const argument of eligible) assert.ok(result.includes(argument), argument);
    assert.equal(result.filter(arg => arg.startsWith('--ipset-exclude=')).length, includeExclusions ? 2 : 0);
    assert.equal(result.filter(arg => arg.startsWith('--hostlist-exclude=')).length, includeExclusions ? 2 : 0);
  });
}

test('FUT composition remains idempotent and preserves additional user exclusions', () => {
  const extra = ['--hostlist-exclude=C:\\Чужие списки\\keep.txt', '--ipset-exclude=C:\\Чужие списки\\keep-ip.txt'];
  const first = compose(render([...eligible, ...extra]), lists);
  const twice = compose(first, lists);
  assert.deepEqual([...split(twice)], [...split(first)]);
  assert.deepEqual(domains(split(twice)), ['--hostlist-domains=fut.gg']);
  for (const argument of extra) assert.ok(split(twice).includes(argument));
  for (const name of ['list-exclude.txt', 'list-exclude-user.txt'])
    assert.equal(split(twice).filter(arg => arg === '--hostlist-exclude=' + path.win32.join(lists, name)).length, 1);
  for (const name of ['ipset-exclude.txt', 'ipset-exclude-user.txt'])
    assert.equal(split(twice).filter(arg => arg === '--ipset-exclude=' + path.win32.join(lists, name)).length, 1);
});

for (const existing of ['example.org', 'fut.gg', 'fut.gg,example.org', '']) {
  test(`existing hostlist-domains "${existing}" is preserved without broadening user intent`, () => {
    const input = [...eligible, '--hostlist-domains=' + existing];
    const result = [...split(compose(render(input), lists))];
    assert.deepEqual(domains(result), ['--hostlist-domains=' + existing]);
  });
}

const excluded = [
  ['custom directory with same basename', eligible.map(arg => arg === managed ? '--hostlist=C:\\Custom\\list-egoist-discord.txt' : arg)],
  ['adjacent directory with same basename', eligible.map(arg => arg === managed ? '--hostlist=' + path.win32.join(runtime, 'lists', 'list-egoist-discord.txt') : arg)],
  ['managed general hostlist', eligible.map(arg => arg === managed ? hostlist('list-general.txt') : arg)],
  ['Google hostlist', eligible.map(arg => arg === managed ? hostlist('list-google.txt') : arg)],
  ['different TLS desync', eligible.map(arg => arg === '--dpi-desync=hostfakesplit' ? '--dpi-desync=fakemultidisorder' : arg)],
  ['combined desync', eligible.map(arg => arg === '--dpi-desync=hostfakesplit' ? '--dpi-desync=fake,hostfakesplit' : arg)],
  ['TCP 443 only', eligible.map(arg => arg === '--filter-tcp=80,443' ? '--filter-tcp=443' : arg)],
  ['TCP other ports', eligible.map(arg => arg === '--filter-tcp=80,443' ? '--filter-tcp=80,443,2053' : arg)],
  ['UDP strategy', eligible.map(arg => arg === '--filter-tcp=80,443' ? '--filter-udp=443' : arg)],
  ['IP-only strategy', eligible.filter(arg => arg !== managed).concat('--ipset=C:\\Custom\\ipset.txt')],
  ['Discord STUN', ['--filter-udp=50000-50100', '--filter-l7=discord,stun', '--dpi-desync=fake']],
];
for (const [name, input] of excluded) {
  test(`FUT does not extend ${name}`, () => {
    const result = [...split(compose(render(input), lists, false))];
    assert.deepEqual(domains(result), []);
    assert.ok(!result.includes('--hostlist-domains=fut.gg'));
    for (const argument of input) assert.ok(result.includes(argument), argument);
  });
}

test('strategies cannot borrow eligibility from neighboring segments', () => {
  const input = render(['--filter-tcp=80,443', managed, '--dpi-desync=fake'])
    + ' --new ' + render(['--filter-tcp=80,443', '--dpi-desync=hostfakesplit'])
    + ' --new ' + render(eligible);
  const result = strategies(compose(input, lists, false));
  assert.deepEqual(result.map(domains), [[], [], ['--hostlist-domains=fut.gg']]);
});

test('bundled EGOIST MIX gains FUT only on the existing managed Discord strategy', async () => {
  const source = fs.readFileSync('src/zapret/general (EGOIST MIX).bat', 'utf8');
  const { ZapretManager } = api({ promises: { readFile: async () => source } });
  const manager = new ZapretManager('resources', 'app', 'user', runtime);
  manager.readGameFilterMode = async () => 'disabled';
  const result = strategies((await manager.buildServiceCommand('selected', [{ name: 'selected', fileName: 'selected.bat' }])).args);
  const matching = result.filter(args => domains(args).includes('--hostlist-domains=fut.gg'));
  assert.equal(matching.length, 1);
  assert.ok(matching[0].includes(managed));
  assert.ok(matching[0].includes('--filter-tcp=80,443'));
  assert.ok(matching[0].includes('--dpi-desync=hostfakesplit'));
  const again = strategies(compose(result.map(render).join(' --new '), lists));
  assert.deepEqual(again, result);
});
