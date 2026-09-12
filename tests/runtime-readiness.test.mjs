import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { loadRecovered } from './load-recovered.mjs';

test('runtime readiness stops polling when the child has already exited', async () => {
  let connections = 0;
  const { waitForPort } = loadRecovered('electron/ipc/port-utils', {
    process,
    promisify: fn => fn,
    execFile: () => {},
    createConnection: () => {
      connections++;
      const socket = new EventEmitter();
      socket.destroy = () => {};
      queueMicrotask(() => socket.emit('error', new Error('closed')));
      return socket;
    },
  }, ['waitForPort']);
  assert.equal(await waitForPort(10809, 250, () => true), false);
  assert.equal(connections, 0);
});
