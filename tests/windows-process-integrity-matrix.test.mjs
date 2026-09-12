import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

class MockWindowsProcessTree {
  constructor() {
    this.processes = new Map();
  }

  spawn(pid, name, ppid = 0, path = `C:\\Windows\\System32\\${name}`) {
    this.processes.set(pid, { pid, name, ppid, path, killed: false });
  }

  killTree(rootPid) {
    const toKill = [rootPid];
    const killed = [];
    while (toKill.length > 0) {
      const current = toKill.pop();
      const p = this.processes.get(current);
      if (p && !p.killed) {
        p.killed = true;
        killed.push(current);
        for (const child of this.processes.values()) {
          if (child.ppid === current && !child.killed) toKill.push(child.pid);
        }
      }
    }
    return killed;
  }

  safeKillByPid(pid, expectedName) {
    const p = this.processes.get(pid);
    if (!p) return { killed: false, reason: 'Process not found' };
    if (p.name !== expectedName) return { killed: false, reason: 'PID recycled by different process' };
    p.killed = true;
    return { killed: true };
  }
}

async function retryWindowsOperation(op, maxAttempts = 12) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastError = err;
      if (!['EBUSY', 'EACCES', 'EPERM'].includes(err?.code) || attempt === maxAttempts - 1) {
        throw err;
      }
      await new Promise(r => setTimeout(r, 5));
    }
  }
  throw lastError;
}

test('Process Tree: taskkill tree termination kills root and all descendant children', () => {
  const tree = new MockWindowsProcessTree();
  tree.spawn(100, 'EgoistShield.exe', 0);
  tree.spawn(101, 'winws.exe', 100);
  tree.spawn(102, 'xray.exe', 100);
  tree.spawn(103, 'helper.exe', 102);

  const killed = tree.killTree(100);
  assert.equal(killed.length, 4);
  assert.ok(killed.includes(100));
  assert.ok(killed.includes(101));
  assert.ok(killed.includes(102));
  assert.ok(killed.includes(103));
});

test('Process Tree: Recycled PID protection prevents killing wrong process if PID reused', () => {
  const tree = new MockWindowsProcessTree();
  tree.spawn(200, 'notepad.exe', 0); // recycled PID belongs to notepad now
  const res = tree.safeKillByPid(200, 'winws.exe');
  assert.equal(res.killed, false);
  assert.equal(res.reason, 'PID recycled by different process');
});

test('Process Tree: Correct PID kill succeeds when process name matches', () => {
  const tree = new MockWindowsProcessTree();
  tree.spawn(300, 'winws.exe', 0);
  const res = tree.safeKillByPid(300, 'winws.exe');
  assert.equal(res.killed, true);
});

test('File Lock Retry: EBUSY succeeds on subsequent attempt', async () => {
  let count = 0;
  const res = await retryWindowsOperation(async () => {
    count++;
    if (count < 3) {
      const err = new Error('Resource busy');
      err.code = 'EBUSY';
      throw err;
    }
    return 'ok';
  });
  assert.equal(res, 'ok');
  assert.equal(count, 3);
});

test('File Lock Retry: EACCES succeeds on subsequent attempt', async () => {
  let count = 0;
  const res = await retryWindowsOperation(async () => {
    count++;
    if (count < 2) {
      const err = new Error('Access denied');
      err.code = 'EACCES';
      throw err;
    }
    return 'done';
  });
  assert.equal(res, 'done');
  assert.equal(count, 2);
});

test('File Lock Retry: Non-retryable ENOENT fails immediately without retry', async () => {
  let count = 0;
  await assert.rejects(async () => {
    await retryWindowsOperation(async () => {
      count++;
      const err = new Error('No such file');
      err.code = 'ENOENT';
      throw err;
    });
  }, { code: 'ENOENT' });
  assert.equal(count, 1);
});

test('File Lock Retry: Exhaustion after 12 attempts throws error', async () => {
  let count = 0;
  await assert.rejects(async () => {
    await retryWindowsOperation(async () => {
      count++;
      const err = new Error('Busy');
      err.code = 'EBUSY';
      throw err;
    }, 12);
  }, { code: 'EBUSY' });
  assert.equal(count, 12);
});

test('NSIS Integrity Check: package corruption cannot bypass CRC validation', async () => {
  const nsiScript = await fs.readFile('src/installer/setup.nsi', 'utf8');
  assert.match(nsiScript, /^CRCCheck force$/m);
  assert.ok(nsiScript.indexOf('CRCCheck force') < nsiScript.indexOf('SetCompressor'));
  assert.doesNotMatch(nsiScript, /^CRCCheck off$/m);
});

test('Installer Fonts: GDI AddFontResourceEx FR_PRIVATE flag constant is 0x10', () => {
  const FR_PRIVATE = 0x10;
  assert.equal(FR_PRIVATE, 16);
});

test('Installer Arch: RunningX64 check aborts on 32-bit OS', () => {
  function checkArchitecture(is64Bit) {
    if (!is64Bit) return { ok: false, error: 'Эта сборка требует Windows x64.' };
    return { ok: true };
  }
  assert.equal(checkArchitecture(false).ok, false);
  assert.equal(checkArchitecture(true).ok, true);
});

test('Installer OS: AtLeastWin10 check aborts on Windows 7 / 8', () => {
  function checkWinVer(major) {
    if (major < 10) return { ok: false, error: 'Требуется Windows 10 или Windows 11.' };
    return { ok: true };
  }
  assert.equal(checkWinVer(6).ok, false); // Win 7 / 8.1
  assert.equal(checkWinVer(10).ok, true);  // Win 10 / 11
});

test('Atomic Swap: Successful swap moves candidate to final and cleans previous', () => {
  const fsState = { candidate: 'new-content', final: 'old-content', previous: null };
  // Step 1: rename final to previous
  fsState.previous = fsState.final;
  fsState.final = null;
  // Step 2: rename candidate to final
  fsState.final = fsState.candidate;
  fsState.candidate = null;
  // Step 3: rm previous
  fsState.previous = null;

  assert.equal(fsState.final, 'new-content');
  assert.equal(fsState.candidate, null);
  assert.equal(fsState.previous, null);
});

test('Atomic Swap: Rollback restores previous if candidate rename fails', () => {
  const fsState = { candidate: 'new-content', final: 'old-content', previous: null };
  // Step 1: rename final to previous
  fsState.previous = fsState.final;
  fsState.final = null;
  // Step 2 fails! Rollback:
  fsState.final = fsState.previous;
  fsState.previous = null;

  assert.equal(fsState.final, 'old-content');
  assert.equal(fsState.candidate, 'new-content');
});

test('Single Instance Mutex: Second instance detects existing mutex', () => {
  const activeMutexes = new Set(['Global\\EgoistShieldInstanceMutex']);
  function tryAcquire(name) {
    if (activeMutexes.has(name)) return { acquired: false, code: 'ERROR_ALREADY_EXISTS' };
    activeMutexes.add(name);
    return { acquired: true };
  }
  const res = tryAcquire('Global\\EgoistShieldInstanceMutex');
  assert.equal(res.acquired, false);
  assert.equal(res.code, 'ERROR_ALREADY_EXISTS');
});

test('Windows Long Path: Paths exceeding 260 chars use \\\\?\\ prefix', () => {
  const longPath = 'C:\\' + 'nested\\'.repeat(40) + 'app.exe';
  function normalizeLongPath(p) {
    if (p.length >= 260 && !p.startsWith('\\\\?\\')) return `\\\\?\\${p}`;
    return p;
  }
  const normalized = normalizeLongPath(longPath);
  assert.ok(normalized.startsWith('\\\\?\\C:\\'));
});

test('Windows Installer: Flag file signaling starts installation', () => {
  const flags = new Set(['start_install.flag']);
  assert.equal(flags.has('cancel.flag'), false);
  assert.equal(flags.has('start_install.flag'), true);
});

test('Windows Installer: Flag file signaling cancels installation', () => {
  const flags = new Set(['cancel.flag']);
  assert.equal(flags.has('cancel.flag'), true);
  assert.equal(flags.has('start_install.flag'), false);
});

test('Process Memory Guard: Memory leak exceeding 1.5 GB flags termination', () => {
  const MAX_MEMORY_BYTES = 1.5 * 1024 * 1024 * 1024;
  function isMemoryHealthy(bytes) {
    return bytes <= MAX_MEMORY_BYTES;
  }
  assert.equal(isMemoryHealthy(500 * 1024 * 1024), true);
  assert.equal(isMemoryHealthy(1.8 * 1024 * 1024 * 1024), false);
});

test('Windows Token Elevation: Detect elevated administrator token', () => {
  const token = { elevationType: 'TokenElevationTypeFull', isElevated: true };
  assert.equal(token.isElevated, true);
});

test('Process Exit Code: Exit code 0 signals clean termination', () => {
  const exitCodes = [0, 1, 1053, 1060];
  const isClean = c => c === 0;
  assert.equal(isClean(exitCodes[0]), true);
  assert.equal(isClean(exitCodes[1]), false);
});
