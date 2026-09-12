const AUTO_SELECT_RESULT_TEXT_LIMIT = 512;
const AUTO_SELECT_RESULT_MAX_BYTES = 220 * 1024;

function compactText(value, limit = AUTO_SELECT_RESULT_TEXT_LIMIT) {
  if (value == null) return value;
  const text = String(value);
  if (Buffer.byteLength(JSON.stringify(text), 'utf8') <= limit) return text;
  const characters = Array.from(text);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${characters.slice(0, middle).join('')}…`;
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= limit) low = middle;
    else high = middle - 1;
  }
  return `${characters.slice(0, low).join('')}…`;
}

function compactAutoSelectTarget(target) {
  if (!target || typeof target !== 'object') return null;
  return {
    key: compactText(target.key, 48),
    label: compactText(target.label ?? target.name, 64),
    // The renderer uses url as a human-readable endpoint when host is absent.
    url: compactText(target.url ?? target.endpoint ?? target.host, 96),
    ok: target.ok === true,
    pingMs: Number.isFinite(target.pingMs) ? target.pingMs : null,
    error: target.ok === true ? null : compactText(target.error, 96)
  };
}

function compactAutoSelectRow(row) {
  if (!row || typeof row !== 'object') return null;
  const compact = {};
  for (const key of [
    'id', 'configId', 'configName', 'name', 'result', 'testedAt',
    'verification', 'error'
  ]) {
    if (row[key] != null) compact[key] = key === 'error' ? compactText(row[key]) : compactText(row[key], 256);
  }
  for (const key of ['pingMs']) {
    if (Number.isFinite(row[key])) compact[key] = row[key];
  }
  if (typeof row.confident === 'boolean') compact.confident = row.confident;
  if (typeof row.videoPlaybackVerified === 'boolean') compact.videoPlaybackVerified = row.videoPlaybackVerified;
  const targets = Array.isArray(row.targets) ? row.targets : [];
  compact.targets = targets.map(compactAutoSelectTarget).filter(Boolean);
  compact.totalTargets = Number.isFinite(row.totalTargets) ? row.totalTargets : targets.length;
  compact.passedTargets = Number.isFinite(row.passedTargets) ? row.passedTargets : targets.filter(target => target?.ok === true).length;
  compact.targetsOmitted = Math.max(0, compact.totalTargets - compact.targets.length);
  return compact;
}

function selectTargetPreview(targets, limit) {
  if (targets.length <= limit) return targets;
  if (limit <= 0) return targets.find(target => target.ok === true) ? [targets.find(target => target.ok === true)] : [];
  const preview = targets.slice(0, limit);
  if (!preview.some(target => target.ok === true)) {
    const successful = targets.find(target => target.ok === true);
    if (successful) preview[preview.length - 1] = successful;
  }
  return preview;
}

function trimRowTargets(row, limit) {
  const targets = selectTargetPreview(row.targets, limit);
  return { ...row, targets, targetsOmitted: Math.max(0, row.totalTargets - targets.length) };
}

function compactStringArray(value, maxItems = 64, maxLength = 128) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map(item => compactText(item, maxLength)).filter(item => item != null && item !== '');
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * Keep the completed auto-select response below the legacy Core IPC envelope
 * limit. Probe progress still contains the full checks while the final result
 * retains only the fields the UI and history need. This protects older service
 * builds and future transports from a large stderr/checks payload.
 */
export function compactAutoSelectResult(result) {
  if (!result || typeof result !== 'object') return result;
  // Copy only the stable result contract. The worker may receive diagnostic
  // fields from a newer component; spreading them here could reintroduce an
  // unbounded IPC envelope without helping the renderer.
  const compact = {
    completed: result.completed === true,
    cancelled: result.cancelled === true,
    bestProfile: compactText(result.bestProfile, 256),
    goodProfiles: compactStringArray(result.goodProfiles),
    badProfiles: compactStringArray(result.badProfiles),
    testedProfiles: compactStringArray(result.testedProfiles),
    summary: compactText(result.summary, 512),
    detail: compactText(result.detail, 2048),
    confidence: compactText(result.confidence, 64),
    earlyExit: result.earlyExit === true,
    rememberedProfile: compactText(result.rememberedProfile, 256),
    usedRememberedProfile: result.usedRememberedProfile === true,
    verification: compactText(result.verification, 64),
    videoPlaybackVerified: result.videoPlaybackVerified === true
  };
  for (const key of ['totalProfiles', 'bestPassedTargets', 'bestTotalTargets']) {
    if (Number.isFinite(result[key])) compact[key] = result[key];
  }
  if (Number.isFinite(result.bestPingMs)) compact.bestPingMs = result.bestPingMs;
  const rows = Array.isArray(result.results)
    ? result.results
    : Array.isArray(result.testResults) ? result.testResults : [];
  const compactRows = rows.slice(0, 64).map(compactAutoSelectRow).filter(Boolean).map(row => trimRowTargets(row, 8));
  const setRows = nextRows => {
    compact.results = nextRows;
  };
  setRows(compactRows);
  if (byteLength(compact) > AUTO_SELECT_RESULT_MAX_BYTES) {
    // Keep the first few targets for a useful history preview. Every row still
    // retains passed/total counters, result and the short error summary.
    for (const limit of [8, 4, 2, 1, 0]) {
      setRows(compactRows.map(row => trimRowTargets(row, limit)));
      if (byteLength(compact) <= AUTO_SELECT_RESULT_MAX_BYTES) break;
    }
  }
  if (byteLength(compact) > AUTO_SELECT_RESULT_MAX_BYTES) {
    compact.goodProfiles = compact.goodProfiles.slice(0, 32);
    compact.badProfiles = compact.badProfiles.slice(0, 32);
    compact.testedProfiles = compact.testedProfiles.slice(0, 32);
    compact.summary = compactText(compact.summary, 256);
    compact.detail = compactText(compact.detail, 512);
  }
  // The fields above are bounded, so this final branch is only a guard against
  // a future contract edit accidentally removing one of those bounds.
  if (byteLength(compact) > AUTO_SELECT_RESULT_MAX_BYTES) {
    compact.goodProfiles = [];
    compact.badProfiles = [];
    compact.testedProfiles = [];
    compact.summary = compactText(compact.summary, 128);
    compact.detail = compactText(compact.detail, 256);
    setRows(compactRows.map(row => trimRowTargets(row, 0)));
  }
  return compact;
}
