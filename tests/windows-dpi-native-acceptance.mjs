import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

// Scope is an acceptance fixture, not a replacement implementation of Zapret.
export function createDpiScope(port) {
  if (!Number.isInteger(port) || port < 49152 || port > 65535) throw new Error('An exclusive high fixture port is required.');
  const kernel = `outbound and loopback and ip and tcp and !impostor and ip.SrcAddr == 127.0.0.1 and ip.DstAddr == 127.0.0.1 and (tcp.SrcPort == ${port} or tcp.DstPort == ${port})`;
  const profile = `@echo off\n"%BIN%winws.exe" --wf-tcp=${port} --wf-raw="${kernel}" --filter-tcp=${port} --dpi-desync=multisplit --dpi-desync-split-pos=2\n`;
  return { port, kernel, profile };
}
function productionCompiler(root) {
  const context = vm.createContext({ path, Buffer, promisify: value => value,
    execFile: async () => { throw new Error('OS execution forbidden in scope compilation'); },
    package_default: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')),
    process: { platform: 'win32', env: {}, pid: 1 } });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/recovered/electron/ipc/zapret-manager.js'), 'utf8') +
    '\n;globalThis.api={parseZapretWinwsArgs,applyZapretPlaceholders,applyZapretProfileExclusions,applyZapretDnsTransportExclusions,splitWindowsCommandLine};', context);
  return context.api;
}
export function compileDpiScope(scope, workDir, root = process.cwd()) {
  const api = productionCompiler(root);
  const args = api.applyZapretDnsTransportExclusions(api.applyZapretProfileExclusions(
    api.applyZapretPlaceholders(api.parseZapretWinwsArgs(scope.profile), {
      BIN: path.win32.join(workDir, 'core', 'bin') + '\\', LISTS: path.win32.join(workDir, 'core', 'lists') + '\\',
      GameFilterTCP: '', GameFilterUDP: '', GameFilter: '',
    }), path.win32.join(workDir, 'core', 'lists')), []);
  return { ...scope, args, argv: Array.from(api.splitWindowsCommandLine(args)) };
}
export function assertDpiPreview(preview, expected, root = process.cwd(), executable = null) {
  if (typeof preview !== 'string' || preview.length > 30000 || /[\r\n\0]/.test(preview)) throw new Error('Invalid production command preview.');
  const actual = Array.from(productionCompiler(root).splitWindowsCommandLine(preview));
  const image = actual.shift();
  const validImage = executable ? path.win32.normalize(image).toLowerCase() === path.win32.normalize(executable).toLowerCase() : image === 'winws.exe';
  if (!validImage || JSON.stringify(actual) !== JSON.stringify(expected.argv)) throw new Error('Production command exceeds the sealed fixture scope.');
  return true;
}
export function dpiPackets(port) {
  const packet = (sourcePort, destinationPort, { source = [127, 0, 0, 1], destination = [127, 0, 0, 1], protocol = 6, loopback = true, outbound = true, impostor = false, ipv6 = false } = {}) => {
    const bytes = Buffer.alloc(ipv6 ? 60 : 40);
    if (!ipv6) {
      bytes[0] = 0x45; bytes.writeUInt16BE(bytes.length, 2); bytes[8] = 64; bytes[9] = protocol;
      bytes.set(source, 12); bytes.set(destination, 16); bytes.writeUInt16BE(sourcePort, 20); bytes.writeUInt16BE(destinationPort, 22); bytes[32] = 0x50;
    } else {
      bytes[0] = 0x60; bytes.writeUInt16BE(20, 4); bytes[6] = 6; bytes[7] = 64; bytes[23] = 1; bytes[39] = 1;
      bytes.writeUInt16BE(sourcePort, 40); bytes.writeUInt16BE(destinationPort, 42); bytes[52] = 0x50;
    }
    return { packet: bytes.toString('base64'), flags: (outbound ? 1 << 17 : 0) | (loopback ? 1 << 18 : 0) | (impostor ? 1 << 19 : 0) | (ipv6 ? 1 << 20 : 0) };
  };
  return [
    { name: 'own-request', expected: true, ...packet(port - 1, port) },
    { name: 'own-response', expected: true, ...packet(port, port - 1) },
    { name: 'adjacent-port', expected: false, ...packet(port - 1, port - 2) },
    { name: 'https-control', expected: false, ...packet(port - 1, 443) },
    { name: 'dns-control', expected: false, ...packet(port - 1, 53, { protocol: 17 }) },
    { name: 'physical-remote', expected: false, ...packet(port - 1, port, { loopback: false, destination: [192, 0, 2, 1] }) },
    { name: 'different-local-address', expected: false, ...packet(port - 1, port, { destination: [127, 0, 0, 2] }) },
    { name: 'inbound', expected: false, ...packet(port - 1, port, { outbound: false }) },
    { name: 'impostor', expected: false, ...packet(port - 1, port, { impostor: true }) },
    { name: 'ipv6', expected: false, ...packet(port - 1, port, { ipv6: true }) },
  ];
}
async function fixture() {
  const secret = randomBytes(24).toString('hex');
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET' || !/^\/probe\/[a-f0-9]{48}$/.test(request.url || '') || request.headers['x-lagom-fixture'] !== secret) {
      response.writeHead(403); response.end(); return;
    }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ nonce: request.url.slice(7), secret, remote: request.socket.remoteAddress }));
  });
  server.maxConnections = 4; server.requestTimeout = 5000; server.headersTimeout = 5000;
  // Keep the socket held for the entire sealed profile lifetime. No port handoff.
  for (let port = 49152 + randomBytes(2).readUInt16LE() % 12000; port <= 65535; port++) {
    try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port, exclusive: true }, () => { server.removeListener('error', reject); resolve(); }); }); break; }
    catch (error) { if (!['EADDRINUSE', 'EACCES'].includes(error.code)) throw error; }
  }
  if (!server.listening) throw new Error('No exclusive fixture port.');
  process.stdout.write(JSON.stringify({ ready: true, port: server.address().port, processId: process.pid }) + '\n');
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (line.length > 1024) throw new Error('Fixture request bound exceeded.');
    const request = JSON.parse(line);
    if (request.operation === 'stop') break;
    if (request.operation !== 'probe' || !/^[a-f0-9]{48}$/.test(request.nonce || '')) throw new Error('Invalid fixture operation.');
    const reply = await fetch(`http://127.0.0.1:${server.address().port}/probe/${request.nonce}`, {
      headers: { 'x-lagom-fixture': secret }, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    const data = await reply.json();
    if (!reply.ok || data.nonce !== request.nonce || data.secret !== secret || data.remote !== '127.0.0.1') throw new Error('Actual loopback nonce probe failed.');
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, nonce: data.nonce, port: server.address().port }) + '\n');
  }
  await new Promise(resolve => server.close(resolve));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv[2] === 'Fixture') await fixture();
  else if (process.argv[2] === 'Scope') {
    const scope = compileDpiScope(createDpiScope(Number(process.argv[3])), process.argv[4]);
    process.stdout.write(JSON.stringify({ ...scope, packets: dpiPackets(scope.port) }));
  } else if (process.argv[2] === 'Verify') {
    const input = fs.readFileSync(0, 'utf8');
    if (input.length > 65536) throw new Error('Scope input bound exceeded.');
    const value = JSON.parse(input);
    assertDpiPreview(value.preview, value.expected, process.cwd(), value.executable);
    process.stdout.write(JSON.stringify({ ok: true }));
  } else throw new Error('Explicit Fixture, Scope or Verify mode required.');
}
