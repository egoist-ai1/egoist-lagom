import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

const modules = [
  'shared/display-text',
  'electron/ipc/parsers/parser-utils',
  'electron/ipc/parsers/uri-parsers',
  'electron/ipc/parsers/clash-parser',
  'electron/ipc/parsers/json-parser',
  'electron/ipc/node-parser'
];
const source = modules.map(name => fs.readFileSync(`src/recovered/${name}.js`, 'utf8')).join('\n');
const context = vm.createContext({
  Buffer, URL, URLSearchParams, TextDecoder, randomUUID, parse: parseYaml,
  log: { info() {}, warn() {}, error() {} }
});
vm.runInContext(`${source}\nglobalThis.productionParser = parseNodesFromText;`, context);
const parseNodes = context.productionParser;

test('production importer reads supported URI protocols and preserves transport options', () => {
  const vmess = Buffer.from(JSON.stringify({ v: '2', ps: 'VMess', add: 'vm.example', port: '443', id: '11111111-1111-1111-1111-111111111111', net: 'ws', path: '/ws', tls: 'tls' })).toString('base64');
  const uris = [
    'vless://11111111-1111-1111-1111-111111111111@v.example:443?security=reality&type=xhttp&sni=example.com#VLESS',
    `vmess://${vmess}`,
    'trojan://password@t.example:443?sni=t.example#Trojan',
    'ss://aes-256-gcm:password@s.example:8388#SS',
    'socks5://user:password@p.example:1080#SOCKS',
    'https://user:password@h.example:443#HTTP',
    'hy2://password@y.example:443?sni=y.example#Hysteria',
    'tuic://11111111-1111-1111-1111-111111111111:password@u.example:443#TUIC',
    'wg://privatekey@w.example:51820?peer_public_key=publickey#WireGuard'
  ];
  const result = parseNodes(uris.join('\n'));
  assert.equal(result.nodes.length, uris.length, result.issues.join('; '));
  assert.deepEqual(new Set(result.nodes.map(node => node.protocol)), new Set(['vless', 'vmess', 'trojan', 'shadowsocks', 'socks', 'http', 'hysteria2', 'tuic', 'wireguard']));
  assert.equal(result.nodes.find(node => node.protocol === 'vless').metadata.type, 'xhttp');
});

test('production importer reads base64 subscriptions and Clash YAML without invented nodes', () => {
  const uri = 'vless://11111111-1111-1111-1111-111111111111@base.example:443?security=tls&type=ws#Base64';
  const encoded = Buffer.from(`${uri}\n`, 'utf8').toString('base64');
  assert.equal(parseNodes(encoded).nodes[0]?.server, 'base.example');
  const clash = 'proxies:\n  - name: Clash WS\n    type: vmess\n    server: clash.example\n    port: 443\n    uuid: 11111111-1111-1111-1111-111111111111\n    alterId: 0\n    cipher: auto\n    network: ws\n    ws-opts:\n      path: /edge\n      headers:\n        Host: edge.example\n';
  const parsed = parseNodes(clash);
  assert.equal(parsed.nodes.length, 1, parsed.issues.join('; '));
  assert.equal(parsed.nodes[0].metadata.path, '/edge');
  assert.equal(parsed.nodes[0].metadata.host, 'edge.example');
  const unsupported = parseNodes('ssr://unsupported');
  assert.equal(unsupported.nodes.length, 0);
  assert.match(unsupported.issues.join(' '), /не поддерживается/i);
});
