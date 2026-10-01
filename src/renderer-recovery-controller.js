// Per-window recovery uses monotonic time so wall-clock corrections cannot suppress it.
export class RendererRecoveryController {
  constructor({ reload, canReload = () => true, onResult = () => {}, now = () => performance.now(),
    schedule = setTimeout, cancel = clearTimeout, burstLimit = 3, burstWindowMs = 60_000 }) {
    this.reload = reload;
    this.canReload = canReload;
    this.onResult = onResult;
    this.now = now;
    this.schedule = schedule;
    this.cancel = cancel;
    this.burstLimit = burstLimit;
    this.burstWindowMs = burstWindowMs;
    this.attempts = [];
    this.pending = null;
    this.healthy = null;
    this.disposed = false;
  }

  failed(reason) {
    if (this.disposed || !['crashed', 'killed', 'oom'].includes(reason) || !this.canReload()) return false;
    if (this.healthy !== null) this.cancel(this.healthy);
    this.healthy = null;
    if (this.pending !== null) return true;
    const current = this.now();
    this.attempts = this.attempts.filter(attempt => current - attempt < this.burstWindowMs);
    const throttled = this.attempts.length >= this.burstLimit;
    const delay = throttled
      ? Math.max(1_000, this.burstWindowMs - (current - this.attempts[0]))
      : Math.max(reason === 'oom' ? 5_000 : 300, [300, 1_500, 5_000][this.attempts.length] ?? 5_000);
    this.onResult({ phase: throttled ? 'cooldown' : 'scheduled', reason, delay });
    this.pending = this.schedule(() => {
      this.pending = null;
      if (this.disposed || !this.canReload()) return;
      this.attempts.push(this.now());
      try { this.reload(); }
      catch (error) { this.onResult({ phase: 'reload-failed', reason, error }); }
    }, delay);
    this.pending?.unref?.();
    return true;
  }

  loaded() {
    if (this.disposed) return;
    if (this.healthy !== null) this.cancel(this.healthy);
    this.healthy = this.schedule(() => {
      this.healthy = null;
      this.attempts = [];
    }, this.burstWindowMs);
    this.healthy?.unref?.();
  }

  dispose() {
    this.disposed = true;
    if (this.pending !== null) this.cancel(this.pending);
    if (this.healthy !== null) this.cancel(this.healthy);
    this.pending = this.healthy = null;
  }
}
