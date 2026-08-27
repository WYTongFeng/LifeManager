// Backup / restore for everything the app stores.
//
// All data lives in localStorage, which dies with the browser profile — clear
// your browsing data, switch browsers, or get a new phone and it's gone. This
// file is the escape hatch: one JSON document holding the whole app state.
//
// It has three jobs:
//   1. Insurance — a copy that survives the browser.
//   2. Manual sync — export on the PC, import on the phone. Works today, with
//      no account, no server and no network.
//   3. Migration format — whatever cloud sync gets built later reads and writes
//      this same shape, so nothing done here is throwaway.
//
// Keys are discovered by prefix rather than hardcoded, so a feature added later
// is backed up automatically instead of being silently left out of the file.

const PREFIX = 'lifemanager:';

export const BACKUP_VERSION = 1;

// Housekeeping about THIS INSTALL, not user data. Skipped in both directions:
// they never enter a backup file, and `restoreBackup`'s wipe leaves them alone,
// so a device keeps its own identity and its own sync position across a restore.
//
// THE BUG THAT PUT `deviceId` ON THIS LIST
// Export on the PC, import on the phone — which is exactly what the import
// button is FOR, and what SETUP.md tells you to do — used to copy the PC's
// `deviceId` onto the phone. Cloud sync then had two devices claiming the same
// id, and `watchMarker()` in cloudSync.js skips a remote change whose
// `deviceId` matches its own ("that was me"). So each device permanently
// ignored the other's pushes: no 「云端有较新的资料」 prompt, ever, on either
// side. Sync looked connected and did nothing, which is the worst way for it to
// fail — the export nag in the header goes quiet because a backup did happen,
// and the two devices drift apart in silence.
//
// `lastSyncedAt`, `cloudSyncEnabled` and the `sync:*` bookkeeping are here for
// the same class of reason: they describe how far THIS device has got with the
// cloud, so importing another device's copy makes the next push diff against
// the wrong baseline (skipping records it thinks are already uploaded) — or
// switches sync off on a device that was signed in.
const SKIP_KEYS = ['demoHistoryPurged', 'deviceId', 'lastSyncedAt', 'cloudSyncEnabled'];

// `sync:ids:<collection>` and `sync:fp:<meta>` — dynamic names, so matched by
// prefix rather than listed.
const SKIP_PREFIXES = ['sync:'];

function isSkipped(shortKey) {
  return SKIP_KEYS.includes(shortKey) || SKIP_PREFIXES.some(p => shortKey.startsWith(p));
}

function appKeys() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const full = localStorage.key(i);
    if (!full || !full.startsWith(PREFIX)) continue;
    const short = full.slice(PREFIX.length);
    if (isSkipped(short)) continue;
    out.push(short);
  }
  return out.sort();
}

/** Gather all app data into a plain, versioned object. */
export function buildBackup() {
  const data = {};
  for (const key of appKeys()) {
    try {
      data[key] = JSON.parse(localStorage.getItem(PREFIX + key));
    } catch {
      // A value that isn't valid JSON is preserved as the raw string rather
      // than dropped — losing it silently would be worse than an odd entry.
      data[key] = localStorage.getItem(PREFIX + key);
    }
  }

  return {
    app: 'lifemanager',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

/** A short human summary of what's inside, so the UI can show what's at stake. */
export function summarise(backup) {
  const d = backup?.data ?? {};
  const count = (v) => (Array.isArray(v) ? v.length : 0);
  return {
    accounts: count(d.accounts),
    debts: count(d.debts),
    expenses: count(d.expenses),
    meals: count(d.meals),
    workouts: count(d.workouts),
    historyDays: count(d.history),
  };
}

export function backupFilename(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `lifemanager-${y}${m}${d}-${hh}${mm}.json`;
}

/** Trigger a file download of the current state. Works on desktop and Android. */
export function downloadBackup() {
  const backup = buildBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = backupFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick so the download has taken the reference first.
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  localStorage.setItem(PREFIX + 'lastBackupAt', JSON.stringify(new Date().toISOString()));
  return summarise(backup);
}

/**
 * Validate a parsed backup file without writing anything.
 * @returns {{ok: true, backup: object} | {ok: false, error: string}}
 */
export function validateBackup(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, error: '这个档案不是有效的 JSON，可能不是备份档或已经损坏。' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: '档案内容不是备份格式。' };
  }
  if (parsed.app !== 'lifemanager') {
    return { ok: false, error: '这不是 LifeManager 的备份档。' };
  }
  if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    return { ok: false, error: '备份档里没有资料区块。' };
  }
  if (typeof parsed.version !== 'number') {
    return { ok: false, error: '备份档缺少版本号，无法安全还原。' };
  }
  if (parsed.version > BACKUP_VERSION) {
    return {
      ok: false,
      error: `这个备份档是较新版本（v${parsed.version}），目前的 app 只读到 v${BACKUP_VERSION}。请先更新 app。`,
    };
  }

  return { ok: true, backup: parsed };
}

/**
 * Overwrite local data with a validated backup.
 *
 * REPLACES rather than merges: two devices editing the same day would need
 * conflict resolution to merge safely, and a wrong merge silently corrupts
 * financial records. Replace is predictable — the caller is responsible for
 * warning the user, and for exporting the current state first.
 */
export function restoreBackup(backup) {
  for (const key of appKeys()) {
    localStorage.removeItem(PREFIX + key);
  }
  for (const [key, value] of Object.entries(backup.data)) {
    // Also filters an OLD backup file, written before these keys were skipped —
    // those still carry a `deviceId` and a `lastSyncedAt` in them.
    if (isSkipped(key)) continue;
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  }
  return summarise(backup);
}

/** Days since the last export, or null if never backed up. */
export function daysSinceBackup() {
  try {
    const raw = localStorage.getItem(PREFIX + 'lastBackupAt');
    if (!raw) return null;
    const then = new Date(JSON.parse(raw));
    if (Number.isNaN(then.getTime())) return null;
    return Math.floor((Date.now() - then.getTime()) / 86400000);
  } catch {
    return null;
  }
}
