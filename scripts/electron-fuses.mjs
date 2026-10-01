import fs from 'node:fs/promises';

// Electron's versioned public fuse wire; reject schema changes rather than
// silently shipping a newly introduced capability with its default enabled.
const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
export const productionGuiFuses = '000011011';
export const productionWorkerFuses = '100011011';

export function readElectronFuses(bytes) {
  const offset = bytes.indexOf(sentinel);
  if (offset < 0 || bytes.indexOf(sentinel, offset + 1) >= 0) throw new Error('Electron fuse sentinel must occur exactly once.');
  const header = offset + sentinel.length;
  const version = bytes[header], count = bytes[header + 1];
  if (version !== 1 || count !== 9 || header + 2 + count > bytes.length) throw new Error('Unsupported Electron fuse schema; review the pinned runtime before packaging.');
  const wire = bytes.subarray(header + 2, header + 2 + count).toString('ascii');
  if (!/^[01r]{9}$/.test(wire)) throw new Error('Malformed Electron fuse wire.');
  return { version, count, wire, offset: header + 2 };
}

export async function hardenElectronFuses(executable, role) {
  const stat = await fs.lstat(executable);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Fuse editing requires an ordinary unlinked PE file.');
  const bytes = await fs.readFile(executable);
  const before = readElectronFuses(bytes);
  const wire = role === 'gui' ? productionGuiFuses : role === 'worker' ? productionWorkerFuses : null;
  if (!wire) throw new Error('Unknown Electron executable role.');
  if (before.wire.includes('r')) throw new Error('Pinned Electron removed a configured fuse; review the policy.');
  bytes.write(wire, before.offset, 'ascii');
  await fs.writeFile(executable, bytes);
  const after = readElectronFuses(await fs.readFile(executable));
  if (after.wire !== wire) throw new Error('Electron fuse readback mismatch.');
  return { role, version: after.version, count: after.count, before: before.wire, wire: after.wire };
}
