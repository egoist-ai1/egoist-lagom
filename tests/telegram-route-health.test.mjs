import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRecovered } from './load-recovered.mjs';

const { summarizeTelegramProxyRouteHealth } = loadRecovered('shared/telegram-proxy-control', {}, ['summarizeTelegramProxyRouteHealth']);

test('recent CF handshake failures degrade health even when runtime stats say err=0', () => {
  const now = new Date(2026, 8, 22, 22, 28, 59).getTime();
  const lines = [
    '22:26:05  INFO  [127.0.0.1:55036] DC2 not in config -> fallback',
    "22:26:06  WARNING  [127.0.0.1:55036] DC2 CF proxy failed: WsHandshakeError('HTTP 503: HTTP/1.1 503 Service Unavailable')",
    '22:27:59  INFO  stats: total=280 active=5 ws=0 tcp_fb=0 cf=239 bad=0 masked=0 err=0 pool=n/a',
  ];
  const result = summarizeTelegramProxyRouteHealth(lines, now);
  assert.equal(result.state, 'degraded');
  assert.equal(result.recentHandshakeFailures, 1);
  assert.equal(result.recentFallbackAttempts, 1);
  assert.equal(result.errors, 1);
});

test('old failures do not keep a healthy route degraded', () => {
  const now = new Date(2026, 8, 22, 22, 28, 59).getTime();
  const result = summarizeTelegramProxyRouteHealth([
    "21:00:00  WARNING  DC2 CF proxy failed: WsHandshakeError('HTTP 503')",
    '22:27:59  INFO  stats: total=280 active=5 ws=0 tcp_fb=0 cf=239 bad=0 err=0',
  ], now);
  assert.equal(result.state, 'active');
  assert.equal(result.recentHandshakeFailures, 0);
});
