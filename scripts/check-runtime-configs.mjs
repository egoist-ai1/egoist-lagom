import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { loadRecovered } from '../tests/load-recovered.mjs';

const { ConfigBuilder } = loadRecovered('electron/ipc/config-builder', {}, ['ConfigBuilder']);
if (!process.env.SHIELD_EVIDENCE_DIR || !path.isAbsolute(process.env.SHIELD_EVIDENCE_DIR)) throw new Error('Set SHIELD_EVIDENCE_DIR to an absolute task-owned evidence directory');
const root = path.join(process.env.SHIELD_EVIDENCE_DIR, 'configs');
await fs.mkdir(root, { recursive: true });
const runtime = path.resolve(process.argv[2] || 'recovery/component-candidates/sing-box-1.14.0-windows-amd64/sing-box-1.14.0-windows-amd64/sing-box.exe');
const settings = { useTunMode: false, routeMode: 'global', dnsMode: 'secure' };
const uuid = '9f16fd5e-88b1-4998-9b5b-f8e7d5bbbd85';
const nodes = ['vless','vmess','trojan','shadowsocks','socks','http','hysteria2','tuic','wireguard'].map(protocol => ({ id: 'test', name: 'Local configuration validation', protocol, server: '192.0.2.1', port: 443, metadata: { id: uuid, uuid, password: 'test-password', private_key: randomBytes(32).toString('base64'), peer_public_key: randomBytes(32).toString('base64') } }));
const results = [];
for (const node of nodes) for (const useTunMode of [false,true]) {
  const file = path.join(root, `${node.protocol}-${useTunMode ? 'tun' : 'proxy'}.json`);
  try {
    await fs.writeFile(file, ConfigBuilder.buildSingBox(node, [], [], { ...settings, useTunMode }, 19443));
    const checked = spawnSync(runtime, ['check', '-c', file], { windowsHide: true, timeout: 15000, encoding: 'utf8' });
    results.push({ protocol: node.protocol, useTunMode, exitCode: checked.status, output: checked.stdout + checked.stderr });
  } catch (error) { results.push({ protocol: node.protocol, useTunMode, error: error.message }); }
}
await fs.writeFile(path.join(root,'report.json'), JSON.stringify({ runtime, results }, null, 2));
console.log(JSON.stringify(results));
process.exitCode = results.some(result => result.exitCode !== 0) ? 1 : 0;
