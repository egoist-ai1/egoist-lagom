import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { acceptanceEnvironmentErrors } from './windows-production-acceptance.mjs';

export const dnsProviders = Object.freeze({
  Cloudflare: Object.freeze({ url: 'https://cloudflare-dns.com/dns-query', ipv4: ['1.1.1.1', '1.0.0.1'], ipv6: ['2606:4700:4700::1111', '2606:4700:4700::1001'] }),
  Quad9: Object.freeze({ url: 'https://dns.quad9.net/dns-query', ipv4: ['9.9.9.9', '149.112.112.112'], ipv6: ['2620:fe::fe', '2620:fe::9'] }),
});

export function createProbeQuery(name, id = randomBytes(2).readUInt16BE()) {
  assert.match(name, /^[a-z0-9.-]+\.$/);
  const question = Buffer.concat(name.slice(0, -1).split('.').map(label => {
    assert.ok(label.length > 0 && label.length <= 63);
    return Buffer.concat([Buffer.from([label.length]), Buffer.from(label, 'ascii')]);
  }).concat([Buffer.from([0, 0, 1, 0, 1])]));
  const header = Buffer.alloc(12); header.writeUInt16BE(id, 0); header.writeUInt16BE(0x100, 2); header.writeUInt16BE(1, 4);
  return Buffer.concat([header, question]);
}

export function verifyProbeReply(reply, query) {
  assert.ok(reply.length >= query.length && reply.length <= 65535, 'DNS reply size');
  assert.equal(reply.readUInt16BE(), query.readUInt16BE(), 'DNS transaction ID');
  assert.equal(reply.readUInt16BE(2) & 0x820f, 0x8000, 'DNS response/TC/rcode');
  assert.equal(reply.readUInt16BE(4), 1, 'DNS question count');
  assert.ok(reply.readUInt16BE(6) > 0, 'DNS answer count');
  assert.ok(reply.subarray(12, query.length).equals(query.subarray(12)), 'DNS question identity');
}

async function preflightAddress(provider, address) {
  const url = new URL(provider.url); const query = createProbeQuery('example.com.');
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'POST', agent: false, servername: url.hostname, rejectUnauthorized: true,
      lookup: (host, options, callback) => {
        if (host !== url.hostname) return callback(new Error('Unexpected TLS bootstrap host.'));
        const row = { address, family: address.includes(':') ? 6 : 4 };
        if (options.all) callback(null, [row]); else callback(null, address, row.family);
      },
      headers: { accept: 'application/dns-message', 'content-type': 'application/dns-message', 'content-length': query.length },
    }, response => {
      const chunks = []; let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; if (bytes > 65535) request.destroy(new Error('DNS body bound exceeded.')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => {
        try {
          assert.equal(response.statusCode, 200); assert.match(response.headers['content-type'] ?? '', /^application\/dns-message(?:;|$)/i);
          assert.equal(request.socket?.authorized, true, 'TLS certificate'); verifyProbeReply(Buffer.concat(chunks), query);
          resolve({ address, ok: true, tlsAuthorized: true, responseBytes: bytes });
        } catch (error) { reject(error); }
      });
    });
    const deadline = setTimeout(() => request.destroy(new Error('Provider TLS/DNS preflight exceeded 6 seconds.')), 6000);
    request.on('close', () => clearTimeout(deadline)); request.on('error', reject); request.end(query);
  });
}

function address(buffer, offset, v6) {
  if (!v6) return [...buffer.subarray(offset, offset + 4)].join('.');
  return Array.from({ length: 8 }, (_, i) => buffer.readUInt16BE(offset + i * 2).toString(16)).join(':');
}
export function normalizedIp(ip) {
  if (!ip.includes(':')) return ip;
  const pieces = ip.toLowerCase().split('::'); assert.ok(pieces.length <= 2);
  const left = pieces[0] ? pieces[0].split(':') : []; const right = pieces.length === 2 && pieces[1] ? pieces[1].split(':') : [];
  const expanded = pieces.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  assert.equal(expanded.length, 8); return expanded.map(value => parseInt(value, 16).toString(16)).join(':');
}
function decodePacket(bytes, linkType) {
  let at = 0;
  if (linkType === 1) {
    if (bytes.length < 14) return null; let ether = bytes.readUInt16BE(12); at = 14;
    for (let tag = 0; [0x8100, 0x88a8].includes(ether) && tag < 2; tag++) { if (bytes.length < at + 4) return null; ether = bytes.readUInt16BE(at + 2); at += 4; }
    if (![0x800, 0x86dd].includes(ether)) return null;
  } else assert.ok([101, 228, 229].includes(linkType), 'Unsupported capture link type');
  if (bytes.length < at + 20) return null;
  const version = bytes[at] >>> 4; let protocol, src, dst;
  if (version === 4) {
    const size = (bytes[at] & 15) * 4; if (size < 20 || bytes.length < at + size || bytes.readUInt16BE(at + 6) & 0x1fff) return null;
    protocol = bytes[at + 9]; src = address(bytes, at + 12, false); dst = address(bytes, at + 16, false); at += size;
  } else if (version === 6) {
    if (bytes.length < at + 40) return null; protocol = bytes[at + 6]; src = address(bytes, at + 8, true); dst = address(bytes, at + 24, true); at += 40;
    // Unknown extension layouts are evidence failure, never counted as TLS.
    if (![6, 17].includes(protocol)) return null;
  } else return null;
  if (![6, 17].includes(protocol) || bytes.length < at + (protocol === 6 ? 20 : 8)) return null;
  const srcPort = bytes.readUInt16BE(at), dstPort = bytes.readUInt16BE(at + 2); const offset = protocol === 6 ? (bytes[at + 12] >>> 4) * 4 : 8;
  if (offset < (protocol === 6 ? 20 : 8) || bytes.length < at + offset) return null;
  return { src, dst, srcPort, dstPort, protocol, data: bytes.subarray(at + offset) };
}

export function analyzeCapture(buffer, options) {
  assert.ok(buffer.length > 28 && buffer.length <= 8 * 1024 * 1024, 'Capture bound');
  const allowed = new Set(options.servers.map(normalizedIp)); const interfaces = []; const flows = new Map();
  let little = true, section = false, packets = 0, knownPackets = 0, clearProbePackets = 0, unsupported = 0;
  const start = Date.parse(options.startedAtUtc) - 250, end = Date.parse(options.finishedAtUtc) + 250;
  assert.ok(Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start < 45000);
  for (let offset = 0; offset < buffer.length;) {
    assert.ok(offset + 12 <= buffer.length, 'Truncated pcapng block');
    if (buffer.readUInt32LE(offset) === 0x0a0d0d0a) { little = buffer.readUInt32LE(offset + 8) === 0x1a2b3c4d; section = true; interfaces.length = 0; }
    assert.ok(section, 'Missing capture section'); const read16 = at => little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at); const read32 = at => little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at);
    const type = read32(offset), length = read32(offset + 4); assert.ok(length >= 12 && length % 4 === 0 && offset + length <= buffer.length && read32(offset + length - 4) === length, 'Invalid pcapng block');
    if (type === 1) {
      assert.ok(length >= 20); const info = { link: read16(offset + 8), resolution: 1e6 };
      for (let at = offset + 16; at + 4 <= offset + length - 4;) { const code = read16(at), size = read16(at + 2); if (!code) break; assert.ok(at + 4 + size <= offset + length - 4); if (code === 9 && size === 1) info.resolution = buffer[at + 4] & 128 ? 2 ** (buffer[at + 4] & 127) : 10 ** buffer[at + 4]; at += 4 + Math.ceil(size / 4) * 4; }
      interfaces.push(info);
    } else if (type === 6) {
      assert.ok(length >= 32); const info = interfaces[read32(offset + 8)]; assert.ok(info, 'Unknown capture interface');
      const captured = read32(offset + 20); assert.ok(captured <= 256 && offset + 28 + captured <= offset + length - 4, 'Packet snapshot bound');
      const stamp = (read32(offset + 12) * 2 ** 32 + read32(offset + 16)) / info.resolution * 1000; packets++;
      if (stamp >= start && stamp <= end) {
        let packet; try { packet = decodePacket(buffer.subarray(offset + 28, offset + 28 + captured), info.link); } catch { unsupported++; }
        if (packet && (allowed.has(normalizedIp(packet.src)) || allowed.has(normalizedIp(packet.dst)))) {
          knownPackets++; const outgoing = allowed.has(normalizedIp(packet.dst)); const server = outgoing ? packet.dst : packet.src;
          if (packet.srcPort === 53 || packet.dstPort === 53) {
            let data = packet.data; if (packet.protocol === 6) data = data.subarray(2);
            if (options.names.some(name => data.includes(createProbeQuery(name, 0).subarray(12)))) clearProbePackets++;
          }
          if (packet.protocol === 6 && (packet.srcPort === 443 || packet.dstPort === 443) && packet.data.length >= 5 && packet.data[0] === 23 && packet.data[1] === 3 && packet.data[2] >= 1 && packet.data[2] <= 4) {
            const client = outgoing ? packet.src : packet.dst, port = outgoing ? packet.srcPort : packet.dstPort;
            const key = normalizedIp(server) + '/' + normalizedIp(client) + '/' + port; const flow = flows.get(key) ?? { server, client, port, outgoingTlsRecords: 0, incomingTlsRecords: 0 };
            flow[outgoing ? 'outgoingTlsRecords' : 'incomingTlsRecords']++; flows.set(key, flow);
          }
        }
      }
    }
    offset += length;
  }
  const bidirectional = [...flows.values()].filter(flow => flow.outgoingTlsRecords && flow.incomingTlsRecords);
  return { ok: knownPackets > 0 && bidirectional.length > 0 && clearProbePackets === 0 && unsupported === 0, packets, knownPackets, clearProbePackets, unsupported, bidirectional,
    claim: 'Observed provider TLS application records during forced Windows DNS queries and no matching plaintext probe question. TLS payload is not decrypted; Windows DNS policy/API evidence is separate.' };
}

async function main() {
  const errors = acceptanceEnvironmentErrors(process.env); if (process.platform !== 'win32' || errors.length) throw new Error('Hosted DNS helper guard refused before operation: ' + errors.join(', '));
  const [command, input] = process.argv.slice(2); assert.ok(['preflight', 'capture'].includes(command));
  const root = path.resolve(process.env.RUNNER_TEMP, `lagom-native-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`, 'dns-native');
  assert.ok(path.resolve(input).startsWith(root + path.sep)); const options = JSON.parse(await fs.readFile(input, 'utf8'));
  assert.ok(path.resolve(options.output).startsWith(root + path.sep)); assert.equal(options.sourceCommit, process.env.GITHUB_SHA);
  let result;
  if (command === 'preflight') {
    const provider = dnsProviders[options.provider]; assert.ok(provider); const expected = [...provider.ipv4, ...(options.ipv6 ? provider.ipv6 : [])];
    result = { ok: true, provider: options.provider, url: provider.url, servers: expected, records: [] };
    for (const server of expected) result.records.push(await preflightAddress(provider, server));
  } else {
    assert.ok(path.resolve(options.capture).startsWith(root + path.sep)); result = analyzeCapture(await fs.readFile(options.capture), options);
    if (!result.ok) { await fs.writeFile(options.output, JSON.stringify(result, null, 2) + '\n'); throw new Error('Native DNS transport evidence failed or remains unknown.'); }
  }
  await fs.writeFile(options.output, JSON.stringify(result, null, 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
