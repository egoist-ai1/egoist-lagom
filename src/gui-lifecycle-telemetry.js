import { performance } from 'node:perf_hooks';

const phases = new Set([
  'window-close', 'window-state-persisted', 'close-to-tray', 'window-closed',
  'window-all-closed', 'before-quit', 'shutdown-start', 'shutdown-step-start',
  'shutdown-step-end', 'shutdown-timeout', 'shutdown-outcome', 'shutdown-finally',
  'quit-requested', 'will-quit',
]);
const steps = new Set(['vpn-runtime', 'zapret-policy', 'telegram-proxy']);

// Diagnostic only: bounded asynchronous stderr writes; no files, timers or await.
// Caps are per process lifetime. Suppressed records never imply a missing event.
export function createGuiLifecycleTelemetry(options = {}) {
  let pid, now, stderr, startedAt, unavailable = false;
  try {
    pid = options.pid ?? process.pid;
    now = options.now ?? (() => performance.now());
    stderr = options.stderr ?? process.stderr;
    if (!Number.isSafeInteger(pid) || pid <= 0 || typeof now !== 'function' ||
        typeof stderr?.write !== 'function' || typeof stderr?.on !== 'function') return () => false;
    startedAt = now();
    if (!Number.isFinite(startedAt)) return () => false;
    // A pipe may fail asynchronously after write returns. Diagnostic failures
    // must never become an unhandled stream error or change shutdown behavior.
    stderr.on('error', () => { unavailable = true; });
  } catch { return () => false; }
  let records = 0, bytes = 0, lastElapsed = 0;
  const occurrences = new Map();
  return (phase, step = null, ok = null) => {
    try {
      if (unavailable || !phases.has(phase) || step !== null && !steps.has(step) ||
          ok !== null && typeof ok !== 'boolean') return false;
      const stepPhase = phase === 'shutdown-step-start' || phase === 'shutdown-step-end';
      const outcomePhase = phase === 'shutdown-timeout' || phase === 'shutdown-outcome';
      if (stepPhase && step === null || !stepPhase && !outcomePhase && step !== null ||
          phase === 'shutdown-step-start' && ok !== null ||
          (phase === 'shutdown-step-end' || outcomePhase) && typeof ok !== 'boolean' ||
          !stepPhase && !outcomePhase && ok !== null) return false;
      const key = phase + ':' + (step ?? 'none');
      const seen = occurrences.get(key) ?? 0;
      if (records >= 96 || seen >= 4) return false;
      const current = now();
      if (!Number.isFinite(current) || current < startedAt) return false;
      const elapsedMs = Math.max(lastElapsed, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(current - startedAt)));
      const line = '[lagom-lifecycle] ' + JSON.stringify({ schemaVersion: 1, pid, phase, elapsedMs, step, ok }) + '\n';
      // All values that can reach the record are fixed ASCII or finite scalars.
      if (line.length > 256 || bytes + line.length > 16384) return false;
      occurrences.set(key, seen + 1); records++; bytes += line.length; lastElapsed = elapsedMs;
      stderr.write(line, error => { if (error) unavailable = true; });
      return !unavailable;
    } catch { unavailable = true; return false; }
  };
}
