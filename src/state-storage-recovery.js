/** Storage reads coalesce; only explicit retries reload disk, with bounded automatic backoff. */
export function createStorageRecovery({ read, retry, onSnapshot, schedule = setTimeout, cancel = clearTimeout }) {
  const delays = [5000, 15000, 30000, 60000];
  let disposed = false, inFlight = null, retryInFlight = false, queuedRetry = null;
  let timer = null, attempt = 0, last = null;
  const emit = snapshot => {
    if (disposed) return snapshot;
    if (Number.isSafeInteger(last?.storage?.sequence) && Number.isSafeInteger(snapshot.storage?.sequence) && snapshot.storage.sequence < last.storage.sequence) return last;
    last = snapshot;
    onSnapshot(snapshot);
    if (snapshot.storage?.writable) {
      if (timer !== null) cancel(timer);
      timer = null; attempt = 0;
    } else if (timer === null && !retryInFlight) {
      timer = schedule(() => { timer = null; void run(true); }, delays[Math.min(attempt++, delays.length - 1)]);
    }
    return snapshot;
  };
  function run(force) {
    if (disposed) return Promise.resolve(last);
    if (inFlight) {
      if (!force || retryInFlight) return inFlight;
      // A manual retry joins a pending cheap snapshot read, then reloads once.
      if (!queuedRetry) queuedRetry = inFlight.then(() => { queuedRetry = null; return run(true); });
      return queuedRetry;
    }
    if (force && timer !== null) { cancel(timer); timer = null; }
    retryInFlight = force;
    if (force && last) onSnapshot({ ...last, storage:{...last.storage,retrying:true} });
    inFlight = Promise.resolve().then(force ? retry : read).then(snapshot => {
      if (!snapshot || typeof snapshot.storage?.writable !== 'boolean') throw new Error('Invalid storage snapshot');
      return emit({ ...snapshot, storage:{...snapshot.storage,retrying:false} });
    }).catch(error => emit({
      state:last?.state ?? null,
      storage:{...last?.storage,status:'unavailable',writable:false,checkedAt:new Date().toISOString(),retrying:false,
        error:'STATE_STORAGE_UNAVAILABLE',systemCode:typeof error?.code==='string'?error.code:null}
    })).finally(() => {
      inFlight = null; retryInFlight = false;
      if (!disposed && last?.storage?.writable === false && timer === null) {
        timer = schedule(() => { timer = null; void run(true); }, delays[Math.min(attempt++, delays.length - 1)]);
      }
    });
    return inFlight;
  }
  return { read:() => run(false), retry:() => run(true), observe:storage => emit({state:last?.state ?? null,storage}), dispose() {
    disposed = true; if(timer !== null) cancel(timer); timer = null;
  } };
}