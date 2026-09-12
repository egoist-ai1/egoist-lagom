import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net, { createConnection, createServer } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { loadRecovered } from './load-recovered.mjs';

function waitForLine(stream, expected, getStderr) {
  stream.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let buffered = '';
    const onData = chunk => {
      buffered += chunk;
      const newline = buffered.indexOf('\n');
      if (newline < 0) return;
      cleanup();
      const line = buffered.slice(0, newline).trim();
      if (line === expected) resolve();
      else reject(new Error(`Expected helper output ${expected}, received ${line || '<empty>'}. ${getStderr()}`));
    };
    const onEnd = () => {
      cleanup();
      reject(new Error(`Pipe helper exited before ${expected}. ${getStderr()}`));
    };
    const cleanup = () => {
      stream.off('data', onData);
      stream.off('end', onEnd);
    };
    stream.on('data', onData);
    stream.on('end', onEnd);
  });
}

test('Core service exchange waits for a legitimate busy pipe instance', {
  skip: process.platform !== 'win32',
  timeout: 15_000,
}, async t => {
  const pipeName = `EgoistShield.ConnectBudget.${randomUUID()}`;
  const pipePath = `\\\\.\\pipe\\${pipeName}`;
  const helperScript = `
$ProgressPreference = 'SilentlyContinue'
$server = [System.IO.Pipes.NamedPipeServerStream]::new(
  '${pipeName}',
  [System.IO.Pipes.PipeDirection]::InOut,
  1,
  [System.IO.Pipes.PipeTransmissionMode]::Byte,
  [System.IO.Pipes.PipeOptions]::Asynchronous)
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
$server.WaitForConnection()
Start-Sleep -Milliseconds 2400
$server.Disconnect()
$server.WaitForConnection()
$reader = [System.IO.StreamReader]::new($server, [System.Text.Encoding]::UTF8, $false, 1024, $true)
$null = $reader.ReadLine()
$writer = [System.IO.StreamWriter]::new($server, [System.Text.UTF8Encoding]::new($false), 1024, $true)
$writer.NewLine = "\n"
$writer.AutoFlush = $true
$writer.WriteLine('{"ok":true,"late":true}')
$server.Dispose()
`;
  const encoded = Buffer.from(helperScript, 'utf16le').toString('base64');
  const helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let helperStderr = '';
  helper.stderr.setEncoding('utf8');
  helper.stderr.on('data', chunk => { helperStderr += chunk; });
  const blocker = new net.Socket();
  blocker.on('error', () => {});
  t.after(() => {
    blocker.destroy();
    if (helper.exitCode === null) helper.kill();
  });

  await waitForLine(helper.stdout, 'READY', () => helperStderr);
  await new Promise((resolve, reject) => {
    blocker.once('connect', resolve);
    blocker.once('error', reject);
    blocker.connect(pipePath);
  });

  const { CoreServiceClient } = loadRecovered('electron/ipc/port-utils', {
    createConnection,
    createServer,
    execFile,
    fs,
    net,
    path,
    process,
    promisify,
    randomUUID,
  }, ['CoreServiceClient']);
  const client = new CoreServiceClient(pipePath);
  const startedAt = Date.now();
  const response = await client.exchange('{"operation":"test"}\n', 8_000);
  const elapsedMs = Date.now() - startedAt;

  assert.equal(response.ok, true);
  assert.equal(response.late, true);
  assert.ok(elapsedMs >= 2_000, `connection unexpectedly completed after ${elapsedMs} ms`);
  assert.ok(elapsedMs < 8_000, `connection exceeded its request deadline after ${elapsedMs} ms`);
  blocker.destroy();
  const exitCode = helper.exitCode === null
    ? await new Promise(resolve => helper.once('exit', resolve))
    : helper.exitCode;
  assert.equal(exitCode, 0, helperStderr);
});
