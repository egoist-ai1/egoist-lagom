import test from 'node:test';
import assert from 'node:assert/strict';

function decodeBase64Safe(input) {
  let str = input.replace(/\s+/g, '');
  while (str.length % 4 !== 0) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

function parseVlessUri(uri) {
  if (!uri.startsWith('vless://')) return null;
  const url = new URL(uri);
  const uuid = url.username;
  const host = url.hostname;
  const port = parseInt(url.port || '443', 10);
  const params = Object.fromEntries(url.searchParams.entries());
  const name = decodeURIComponent(url.hash.replace(/^#/, ''));
  return { protocol: 'vless', uuid, host, port, params, name };
}

function parseTrojanUri(uri) {
  if (!uri.startsWith('trojan://')) return null;
  const url = new URL(uri);
  const password = url.username;
  const host = url.hostname;
  const port = parseInt(url.port || '443', 10);
  const params = Object.fromEntries(url.searchParams.entries());
  const name = decodeURIComponent(url.hash.replace(/^#/, ''));
  return { protocol: 'trojan', password, host, port, params, name };
}

function buildNodeFingerprint(node) {
  return `${node.protocol}://${node.host}:${node.port}/${node.uuid || node.password || ''}`;
}

function redactUrlForLog(rawUrl) {
  return rawUrl.replace(/(:\/\/)[^@]+(@)/, '$1***$2')
               .replace(/(\/sub\/)[^/]+(\/info)/, '$1***$2');
}

function parseRetryAfter(headerValue) {
  if (!headerValue) return 0;
  const num = parseInt(headerValue, 10);
  if (!isNaN(num)) return num * 1000;
  const date = Date.parse(headerValue);
  if (!isNaN(date)) return Math.max(0, date - Date.now());
  return 0;
}

test('Subscription: Parse VLESS Reality XHTTP URI', () => {
  const uri = 'vless://a1b2c3d4-e5f6-7890-abcd-ef1234567890@fr1.example.com:443?security=reality&sni=yahoo.com&fp=chrome&pbk=fakePubkey12345&type=xhttp&path=%2Fstream#France%2001';
  const node = parseVlessUri(uri);
  assert.equal(node.protocol, 'vless');
  assert.equal(node.uuid, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  assert.equal(node.host, 'fr1.example.com');
  assert.equal(node.port, 443);
  assert.equal(node.params.security, 'reality');
  assert.equal(node.params.type, 'xhttp');
  assert.equal(node.name, 'France 01');
});

test('Subscription: Parse VLESS WebSocket TLS URI', () => {
  const uri = 'vless://uuid-ws-node@de1.example.com:443?security=tls&type=ws&path=%2Fws#Germany%20WS';
  const node = parseVlessUri(uri);
  assert.equal(node.params.type, 'ws');
  assert.equal(node.params.security, 'tls');
  assert.equal(node.name, 'Germany WS');
});

test('Subscription: Parse Trojan URI with SNI', () => {
  const uri = 'trojan://superSecretPass@nl1.example.com:443?sni=nl1.example.com#Netherlands';
  const node = parseTrojanUri(uri);
  assert.equal(node.protocol, 'trojan');
  assert.equal(node.password, 'superSecretPass');
  assert.equal(node.host, 'nl1.example.com');
  assert.equal(node.name, 'Netherlands');
});

test('Subscription: Unicode Russian server name correctly decoded from hash', () => {
  const uri = 'vless://uuid@us1.example.com:443#%D0%A1%D0%A8%D0%90%2001';
  const node = parseVlessUri(uri);
  assert.equal(node.name, 'США 01');
});

test('Subscription: Safe base64 decoding with missing padding', () => {
  // "hello world" in base64 without padding: "aGVsbG8gd29ybGQ" (length 15)
  const unpadded = 'aGVsbG8gd29ybGQ';
  const decoded = decodeBase64Safe(unpadded);
  assert.equal(decoded, 'hello world');
});

test('Subscription: Safe base64 decoding with whitespace and newlines', () => {
  const multiline = 'aGVsb\r\nG8gd\n29yb\tGQ=';
  const decoded = decodeBase64Safe(multiline);
  assert.equal(decoded, 'hello world');
});

test('Subscription: Node fingerprint matches identical endpoints', () => {
  const n1 = { protocol: 'vless', host: 'srv.com', port: 443, uuid: 'u1', name: 'Server 1' };
  const n2 = { protocol: 'vless', host: 'srv.com', port: 443, uuid: 'u1', name: 'Different Name' };
  assert.equal(buildNodeFingerprint(n1), buildNodeFingerprint(n2));
});

test('Subscription: Node fingerprint distinguishes different UUIDs', () => {
  const n1 = { protocol: 'vless', host: 'srv.com', port: 443, uuid: 'u1' };
  const n2 = { protocol: 'vless', host: 'srv.com', port: 443, uuid: 'u2' };
  assert.notEqual(buildNodeFingerprint(n1), buildNodeFingerprint(n2));
});

test('Subscription: Deduplication removes identical nodes while preserving order', () => {
  const nodes = [
    { id: '1', host: 'a.com', port: 443, protocol: 'vless', uuid: 'u1' },
    { id: '2', host: 'b.com', port: 443, protocol: 'vless', uuid: 'u2' },
    { id: '3', host: 'a.com', port: 443, protocol: 'vless', uuid: 'u1' }
  ];
  const seen = new Set();
  const unique = nodes.filter(n => {
    const fp = buildNodeFingerprint(n);
    if (seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });
  assert.equal(unique.length, 2);
  assert.equal(unique[0].id, '1');
  assert.equal(unique[1].id, '2');
});

test('Subscription: URL redaction masks secret subscription key in path', () => {
  const raw = 'https://durev-keys.com/sub/JBlU_-KfoqrQP6DZI1puUU/info';
  const redacted = redactUrlForLog(raw);
  assert.equal(redacted, 'https://durev-keys.com/sub/***/info');
  assert.ok(!redacted.includes('JBlU'));
});

test('Subscription: URL redaction masks credentials in node URL', () => {
  const raw = 'trojan://myPassword@srv.com:443#Name';
  const redacted = redactUrlForLog(raw);
  assert.equal(redacted, 'trojan://***@srv.com:443#Name');
  assert.ok(!redacted.includes('myPassword'));
});

test('Subscription: Retry-After integer seconds parsed to milliseconds', () => {
  assert.equal(parseRetryAfter('15'), 15000);
});

test('Subscription: Retry-After missing header returns 0', () => {
  assert.equal(parseRetryAfter(null), 0);
  assert.equal(parseRetryAfter(''), 0);
});

test('Subscription: IPv6 server address bracket format parsed correctly', () => {
  const uri = 'vless://uuid@[2606:4700::1]:443#IPv6Node';
  const node = parseVlessUri(uri);
  assert.equal(node.host, '[2606:4700::1]');
  assert.equal(node.port, 443);
});

test('Subscription: Public key length check passes for 43 char base64url Reality key', () => {
  const pbk = 'sOmEPubl1cK3yValUe_wIth-43CharacteRs1234567';
  assert.ok(pbk.length >= 43 && pbk.length <= 44);
});

test('Subscription: Short ID (sid) hex validation', () => {
  const validSid = '0123456789abcdef';
  const invalidSid = 'xyz123';
  assert.equal(/^[0-9a-fA-F]+$/.test(validSid), true);
  assert.equal(/^[0-9a-fA-F]+$/.test(invalidSid), false);
});

test('Subscription: Reject expired subscription placeholder', () => {
  function isPlaceholder(text) {
    const lower = text.toLowerCase();
    return lower.includes('подписка закончилась') || lower.includes('subscription expired') || lower.includes('account suspended');
  }
  assert.equal(isPlaceholder('Уведомление: Ваша подписка закончилась. Оплатите продление.'), true);
  assert.equal(isPlaceholder('vless://uuid@host:443#Node'), false);
});

test('Subscription: Identity preservation keeps user-edited alias across refreshes', () => {
  const existing = [{ fingerprint: 'fp1', customName: 'Мой любимый сервер' }];
  const refreshed = [{ fingerprint: 'fp1', defaultName: 'Server 01' }];
  const merged = refreshed.map(r => {
    const match = existing.find(e => e.fingerprint === r.fingerprint);
    return { ...r, displayName: match?.customName ?? r.defaultName };
  });
  assert.equal(merged[0].displayName, 'Мой любимый сервер');
});

test('Subscription: Empty input produces zero nodes without exception', () => {
  function parseAll(text) {
    if (!text || !text.trim()) return [];
    return text.split('\n').map(parseVlessUri).filter(Boolean);
  }
  assert.deepEqual(parseAll(''), []);
  assert.deepEqual(parseAll('   \n  '), []);
});

test('Subscription: Mixed protocol batch parsing separates VLESS and Trojan nodes', () => {
  const lines = [
    'vless://u1@h1.com:443#VLESS1',
    'trojan://p1@h2.com:443#Trojan1',
    '# Comment line',
    'vless://u2@h3.com:443#VLESS2'
  ];
  const parsed = lines.map(line => parseVlessUri(line) || parseTrojanUri(line)).filter(Boolean);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].protocol, 'vless');
  assert.equal(parsed[1].protocol, 'trojan');
  assert.equal(parsed[2].protocol, 'vless');
});
