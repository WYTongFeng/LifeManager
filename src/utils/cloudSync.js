// Cloud sync between phone and PC, on Firebase (Firestore + Google sign-in).
//
// SHAPE — see SCHEMA.md. Unbounded record collections sync per document;
// small bounded values sync as one document each.
//
// TWO CLOCKS, NEVER ONE — the bug that made the phone permanently blind
// `at` is the EVENT time: when the meal was eaten, when the payment happened.
// It is always in the past and it never moves (see `touchedAt` in syncModel).
// `syncedAt` is when the document was UPLOADED. They are different clocks and
// they must not be compared to each other.
//
// The pull used to filter on the event time — `where('at', '>', lastSyncedAt)`
// — against a single watermark that BOTH directions wrote. So the moment a
// device pushed anything, its watermark jumped to "now", and Firestore then
// filtered out every record from the other device, because an expense that
// happened yesterday has an `at` of yesterday. The phone auto-pushes 2.5s
// after sign-in (see `attachAuthListener`), so it locked itself out of the
// PC's data before the user could touch anything, forever, with no error.
// Edits were doubly invisible: an edit bumps `updatedAt` and deliberately
// leaves `at` alone, so the query could not see one at all.
//
// Now: every document carries `syncedAt`, pulls filter on THAT, and push and
// pull keep separate watermarks (`sync:lastPushedAt` / `sync:lastPulledAt`),
// so neither direction can blind the other.
//
// STAYING INSIDE THE FREE TIER
// Spark allows ~50k reads and 20k writes a day. The thing that would blow that
// is re-reading everything on every launch: a year of records is a few thousand
// documents, and ten launches across two devices would be tens of thousands of
// reads. So:
//   * Pulls are incremental — `where('syncedAt', '>', lastPulledAt)`.
//   * Change detection is a listener on ONE marker document, not on the
//     collections, so an idle app costs nothing.
//   * Firestore's local cache serves repeat reads without billing them.
//   * Meta documents are fingerprinted and skipped when unchanged.
// Normal use lands around 0.2% of the free allowance. The one-time schema
// migration below re-reads and re-writes everything once per device, which for
// this app's data volume is a rounding error against the daily allowance.
//
// CONFLICTS
// Per record, last write wins, compared on `touchedAt` (the later of `at` and
// `updatedAt`). Whole-device clobbering is avoided because merges happen record
// by record rather than by replacing a single blob — two devices editing
// different records both survive. Meta documents have no per-record fallback,
// so they are merged field-wise on the way up and guarded by
// `hasUnpushedMetaChanges` on the way down. Remote changes are still never
// applied without the user asking, and the export file in backup.js remains the
// real safety net.
//
// DELETES
// A local delete leaves nothing to push, so `syncModel` keeps the set of ids
// last seen in the cloud and treats a disappearance as an explicit delete. The
// cloud copy is soft-deleted (`deleted: true`) so other devices can see it;
// tombstones are a few bytes each.

import {
  RECORD_COLLECTIONS, DAILY_STATS, DAILY_STATS_LOCAL_KEY, META_DOCS,
  readLocal, writeLocal, diffCollection, setSyncedIds, getSyncedIds,
  mergeRemoteRecords, readMetaDoc, writeMetaDoc, fingerprint,
  hasUnpushedMetaChanges, metaFingerprintKey,
} from './syncModel.js';
import { CHANGE_EVENT } from './storage.js';

const PREFIX = 'lifemanager:';
const PUSH_DEBOUNCE_MS = 2500;
const BATCH_LIMIT = 400;   // Firestore's hard cap is 500 ops per batch.

/**
 * Bumped when what we write to Firestore changes shape in a way that documents
 * already in the cloud can't satisfy. Each direction then heals itself exactly
 * once: the next push re-uploads everything, the next pull reads whole
 * collections instead of a filtered slice. Both are cheap here — the entire
 * dataset is a few hundred documents — and both are idempotent, so a failure
 * mid-way just means it runs again next time.
 *
 * v2 — every document carries `syncedAt`. Documents written by v1 have no such
 * field, and a Firestore inequality filter silently EXCLUDES documents missing
 * the field, so the first v2 pull must be unfiltered or it would find nothing.
 */
const SYNC_SCHEMA_VERSION = 2;

let sdk = null;
let unsubscribeMarker = null;
let pushTimer = null;
let authListenerAttached = false;
const listeners = new Set();

let state = {
  available: false,
  status: 'off',        // off | signed-out | ready | pushing | pulling | error
  user: null,
  lastSyncedAt: null,
  remoteNewer: null,
  error: null,
  // What the last push/pull actually did, so a button press always says
  // something. "立即上传" used to be able to upload nothing and report nothing,
  // which is indistinguishable from being broken — and it WAS broken.
  lastResult: null,     // { kind: 'push'|'pull', count: number, at: number }
};

function emit() {
  const snapshot = { ...state };
  listeners.forEach(fn => fn(snapshot));
}

export function subscribe(fn) {
  listeners.add(fn);
  fn({ ...state });
  return () => listeners.delete(fn);
}

export function getState() {
  return { ...state };
}

function setState(patch) {
  state = { ...state, ...patch };
  emit();
}

export function getDeviceId() {
  let id = readLocal('deviceId', null);
  if (!id) {
    id = `${navigator.platform || 'device'}-${Math.random().toString(36).slice(2, 8)}`;
    writeLocal('deviceId', id);
  }
  return id;
}

/**
 * Separate watermarks per direction.
 *
 * They answer different questions — "which of my local edits has the cloud
 * seen?" and "which cloud documents have I read?" — and a single shared value
 * cannot answer both. Sharing one is what let a push silently cancel every
 * future pull; see the header.
 *
 * Named under `sync:` so backup.js's SKIP_PREFIXES leaves them out of an export
 * automatically: importing another device's sync position is the same class of
 * bug as importing its `deviceId`.
 */
const getLastPushedAt = () => Number(readLocal('sync:lastPushedAt', 0)) || 0;
const getLastPulledAt = () => Number(readLocal('sync:lastPulledAt', 0)) || 0;
const getPushVersion = () => Number(readLocal('sync:pushVersion', 0)) || 0;
const getPullVersion = () => Number(readLocal('sync:pullVersion', 0)) || 0;

/** Displayed as 上次同步 — the last time either direction succeeded. */
const getLastSyncedAt = () => Number(readLocal('lastSyncedAt', 0)) || 0;

function setLastSyncedAt(ms) {
  writeLocal('lastSyncedAt', ms);
  setState({ lastSyncedAt: ms });
}

export function isSyncEnabled() {
  return localStorage.getItem(PREFIX + 'cloudSyncEnabled') === 'true';
}

function setSyncEnabled(on) {
  localStorage.setItem(PREFIX + 'cloudSyncEnabled', String(on));
}

// ~555 KB of SDK; only users who switch sync on ever download it.
async function loadSdk() {
  if (sdk) return sdk;

  const { isFirebaseConfigured, getFirebaseConfig } = await import('./firebaseConfig');
  if (!isFirebaseConfigured()) throw new Error('NOT_CONFIGURED');

  const [app, auth, firestore] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
  ]);

  const instance = app.getApps().length ? app.getApp() : app.initializeApp(getFirebaseConfig());

  // Persistent cache: repeat reads are served locally and aren't billed, and
  // the app keeps working offline. Falls back if the browser refuses it.
  let db;
  try {
    db = firestore.initializeFirestore(instance, {
      localCache: firestore.persistentLocalCache({
        tabManager: firestore.persistentMultipleTabManager(),
      }),
    });
  } catch {
    db = firestore.getFirestore(instance);
  }

  sdk = { app: instance, auth: auth.getAuth(instance), db, ...auth, ...firestore };
  return sdk;
}

/**
 * Wire `onAuthStateChanged` exactly once per page load.
 *
 * THE BUG THIS FIXES
 * `init()` used to be the only place this was attached, and it returns early
 * when sync is switched off — which is the state of every device that has
 * never signed in. So on a fresh install the very first sign-in succeeded at
 * Firebase and then landed nowhere: no listener meant `state.user` stayed
 * null, which meant `watchMarker()` and `schedulePush()` never ran and the
 * CHANGE_EVENT handler (which tests `state.user`) ignored every edit. The UI
 * still showed the signed-out button. Sync only came alive after a reload,
 * because by then `cloudSyncEnabled` was true and `init()` no longer bailed.
 *
 * The redirect sign-in path accidentally hid this — it navigates away and
 * reloads — so it only ever bit the popup path, i.e. every desktop sign-in.
 * Every entry point that can authenticate now calls this first.
 */
async function attachAuthListener(s) {
  if (authListenerAttached) return;
  authListenerAttached = true;
  s.onAuthStateChanged(s.auth, (user) => {
    if (user) {
      setState({
        // photoURL powers the account avatar in Header/Dashboard — the app
        // recognising who's signed in, not just a manually typed name. Both
        // it and displayName are null for an email/password account; the
        // avatar already falls back to the first letter of the email.
        user: { uid: user.uid, email: user.email, name: user.displayName, photoURL: user.photoURL },
        status: 'ready', error: null,
      });
      watchMarker();
      schedulePush();   // flush anything edited while offline
    } else {
      setState({ user: null, status: 'signed-out' });
      stopWatching();
    }
  });
}

export async function init() {
  const { isFirebaseConfigured } = await import('./firebaseConfig');
  if (!isFirebaseConfigured()) {
    setState({ available: false, status: 'off' });
    return;
  }
  setState({ available: true, lastSyncedAt: getLastSyncedAt() });

  if (!isSyncEnabled()) {
    setState({ status: 'off' });
    return;
  }

  try {
    await attachAuthListener(await loadSdk());
  } catch (e) {
    setState({ status: 'error', error: describeError(e) });
  }
}

/**
 * Email + password sign-in — the primary path, and the only one that works on
 * the phone.
 *
 * WHY GOOGLE SIGN-IN CANNOT WORK IN THE APK
 * Two independent blockers, either one fatal:
 *   1. Google refuses to serve its OAuth consent screen inside an embedded
 *      WebView (`disallowed_useragent`). That is a deliberate anti-phishing
 *      policy, not a bug, and no Capacitor flag turns it off — so
 *      `signInWithPopup` is dead on Android.
 *   2. The popup-blocked fallback, `signInWithRedirect`, then fails for a
 *      separate reason: the Capacitor shell runs on `https://localhost`, a
 *      different origin from the Firebase `authDomain` the redirect returns
 *      through, so the credential never makes it back into the app.
 * Fixing that properly would mean a native Google-auth Capacitor plugin plus
 * SHA-1 fingerprint registration — a lot of moving parts for a single-user app.
 *
 * Email/password is a plain HTTPS call to Firebase's identity endpoint. No
 * browser handoff, no second origin, nothing to mismatch — it behaves
 * identically in the WebView and on the desktop.
 *
 * Everything downstream is unaffected: the sync engine and `firestore.rules`
 * only ever ask for `auth.currentUser.uid`, which an email/password account
 * has in exactly the same shape as a Google one.
 */
export async function signInWithEmail(email, password) {
  const s = await loadSdk();
  await attachAuthListener(s);
  try {
    await s.signInWithEmailAndPassword(s.auth, email.trim(), password);
    setSyncEnabled(true);
  } catch (e) {
    setState({ status: 'error', error: describeError(e) });
    throw e;
  }
}

/** Create the account. Firebase enforces one account per email address, so a
 *  second device must sign in, not register again — the error text says so. */
export async function registerWithEmail(email, password) {
  const s = await loadSdk();
  await attachAuthListener(s);
  try {
    await s.createUserWithEmailAndPassword(s.auth, email.trim(), password);
    setSyncEnabled(true);
  } catch (e) {
    setState({ status: 'error', error: describeError(e) });
    throw e;
  }
}

/** A forgotten password would otherwise strand the account permanently —
 *  there is no other way back into a uid, and the uid is where the data is. */
export async function sendPasswordReset(email) {
  const s = await loadSdk();
  try {
    await s.sendPasswordResetEmail(s.auth, email.trim());
  } catch (e) {
    setState({ status: 'error', error: describeError(e) });
    throw e;
  }
}

/** Kept for the desktop, where the OAuth flow genuinely works. Hidden on
 *  native by the UI, since neither path above can succeed there. */
export async function signIn() {
  const s = await loadSdk();
  await attachAuthListener(s);
  const provider = new s.GoogleAuthProvider();
  try {
    await s.signInWithPopup(s.auth, provider);
    setSyncEnabled(true);
  } catch (e) {
    // Installed PWAs, Android WebViews and some in-app browsers block popups.
    if (/popup|blocked|closed|cancelled/i.test(e?.code || e?.message || '')) {
      setSyncEnabled(true);
      await s.signInWithRedirect(s.auth, provider);
      return;
    }
    setState({ status: 'error', error: describeError(e) });
    throw e;
  }
}

export async function signOutAndStop() {
  setSyncEnabled(false);
  stopWatching();
  if (sdk) await sdk.signOut(sdk.auth);
  setState({ user: null, status: 'off', remoteNewer: null });
}

const userPath = (s, ...rest) => s.doc(s.db, 'users', s.auth.currentUser.uid, ...rest);
const collPath = (s, name) => s.collection(s.db, 'users', s.auth.currentUser.uid, name);
const markerRef = (s) => userPath(s, 'meta', 'syncState');

function stopWatching() {
  if (unsubscribeMarker) { unsubscribeMarker(); unsubscribeMarker = null; }
}

/**
 * Watch one marker document rather than the collections.
 *
 * Listening to every collection would bill a read per changed document even
 * when the user never opens the app. One marker costs one read per remote
 * change, and the actual data is fetched only if the user chooses to pull.
 *
 * The marker keeps a LAST-PUSH TIME PER DEVICE, not just the last writer.
 * With a single `deviceId` field, whoever pushed most recently owned the
 * marker: the phone pushing after the PC made the marker say "phone", the
 * phone read its own id, concluded "that was me, nothing to fetch" — and the
 * PC's changes, which it had still never pulled, disappeared from the UI
 * along with the only button that could have fetched them. A map means each
 * device is compared against what IT has pulled.
 */
async function watchMarker() {
  const s = await loadSdk();
  stopWatching();
  unsubscribeMarker = s.onSnapshot(markerRef(s), (snap) => {
    if (!snap.exists()) { setState({ remoteNewer: null }); return; }
    const d = snap.data() || {};
    const mine = getDeviceId();
    const pulled = getLastPulledAt();

    let newest = 0;
    let from = null;
    for (const [id, ms] of Object.entries(d.devices || {})) {
      if (id === mine) continue;
      const t = Number(ms) || 0;
      if (t > newest) { newest = t; from = id; }
    }
    // Markers written by an older build have no `devices` map, only the single
    // pair — still worth honouring until that device pushes again.
    if (!newest && d.deviceId && d.deviceId !== mine) {
      newest = Number(d.updatedAtMs) || 0;
      from = d.deviceId;
    }

    setState({
      remoteNewer: newest > pulled ? { updatedAt: newest, deviceId: from || 'another device' } : null,
    });
  }, (e) => setState({ status: 'error', error: describeError(e) }));
}

/**
 * Has the cloud lost a key this device still holds?
 *
 * The signature of the old replace-not-merge bug: `meta/accounts` sitting there
 * with its `accounts` field gone, because some device that didn't have one
 * uploaded an empty document over it. Only a device that still holds the key
 * can put it back, and it won't try on its own — its fingerprint never changed.
 */
async function cloudMetaMissingKeys(s, name, data) {
  const snap = await s.getDoc(userPath(s, 'meta', name));
  if (!snap.exists()) return true;
  const cloud = snap.data() || {};
  return Object.keys(data).some(k => !(k in cloud));
}

async function commitInChunks(s, ops) {
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = s.writeBatch(s.db);
    for (const op of ops.slice(i, i + BATCH_LIMIT)) op(batch);
    await batch.commit();
  }
}

/**
 * Upload everything changed since the last successful push.
 *
 * `force` re-uploads everything regardless of what this device thinks the
 * cloud already has. It exists because "用这台覆盖" and the schema migration
 * both need it — and because it was ALREADY BEING PASSED by SyncPanel, to a
 * function that took no arguments at all, so both buttons had been doing a
 * plain incremental push since the day they were written.
 */
export async function pushNow({ force = false } = {}) {
  if (!isSyncEnabled()) return 0;
  const s = await loadSdk();
  if (!s.auth.currentUser) return 0;

  // A device still on the old schema has documents in the cloud with no
  // `syncedAt`, which no other device's incremental pull can ever see. One
  // full push fixes that permanently.
  const full = force || getPushVersion() < SYNC_SCHEMA_VERSION;

  setState({ status: 'pushing', error: null });
  try {
    // -1, not 0: `touchedAt` returns 0 for a record carrying neither `at` nor
    // `updatedAt`, and `> 0` would quietly leave those behind on a full push —
    // which for the migration means they'd never get a `syncedAt` and would
    // stay invisible to every incremental pull after it.
    const since = full ? -1 : getLastPushedAt();
    const now = Date.now();
    const device = getDeviceId();
    const ops = [];
    // Local bookkeeping that claims something reached the cloud. It must not
    // run until the write actually lands, or a failed push leaves this device
    // believing it uploaded records and settings it never sent.
    const afterCommit = [];
    let touched = 0;

    // Record collections: changed documents and tombstones for local deletes.
    for (const name of RECORD_COLLECTIONS) {
      const { upserts, deletes, allIds } = diffCollection(name, since);
      for (const rec of upserts) {
        ops.push(b => b.set(s.doc(collPath(s, name), String(rec.id)),
          { ...rec, at: rec.at ?? now, syncedAt: now, deleted: false }));
      }
      for (const id of deletes) {
        ops.push(b => b.set(s.doc(collPath(s, name), String(id)),
          { id, deleted: true, at: now, syncedAt: now }));
      }
      touched += upserts.length + deletes.length;
      afterCommit.push(() => setSyncedIds(name, allIds));
    }

    // Daily summaries, keyed by date so a re-run overwrites instead of duplicating.
    const history = readLocal(DAILY_STATS_LOCAL_KEY, []);
    const previousDays = full ? new Set() : getSyncedIds(DAILY_STATS);
    const dayIds = new Set();
    for (const day of Array.isArray(history) ? history : []) {
      if (!day?.date) continue;
      dayIds.add(day.date);
      if (!previousDays.has(day.date)) {
        ops.push(b => b.set(s.doc(collPath(s, DAILY_STATS), day.date),
          { ...day, at: now, syncedAt: now }));
        touched++;
      }
    }
    afterCommit.push(() => setSyncedIds(DAILY_STATS, dayIds));

    // Meta documents, skipped when their contents haven't changed.
    //
    // MERGED, NEVER REPLACED. `readMetaDoc` returns only the keys this device
    // actually has, and a plain `set()` replaces the whole document — so a
    // phone that had never opened the accounts screen pushed `meta/accounts`
    // as {} and DELETED the PC's accounts from the cloud. The PC then never
    // re-sent them, because its own fingerprint hadn't changed, and the data
    // was stranded on one device with sync reporting success.
    for (const name of Object.keys(META_DOCS)) {
      const data = readMetaDoc(name);
      if (!Object.keys(data).length) continue;   // nothing here to send
      const print = fingerprint(data);
      if (readLocal(metaFingerprintKey(name), null) === print && !force) {
        // Unchanged here since the last push. The schema migration does NOT
        // resend it anyway: nothing filters meta documents on `syncedAt`, so
        // there is nothing about them to migrate — and a blanket resend would
        // hand whichever device happens to launch last the power to overwrite
        // the other's settings with an older copy. The one thing worth sending
        // unasked is a repair.
        if (!full) continue;
        if (!await cloudMetaMissingKeys(s, name, data)) continue;
      }
      ops.push(b => b.set(userPath(s, 'meta', name),
        { ...data, at: now, syncedAt: now }, { merge: true }));
      afterCommit.push(() => writeLocal(metaFingerprintKey(name), print));
      touched++;
    }

    if (touched > 0) {
      // Merged, so this device's entry lands beside the other's instead of
      // replacing it — a marker that only remembers the last writer is how the
      // 「云端有较新的资料」 prompt used to vanish the moment this device pushed.
      ops.push(b => b.set(markerRef(s),
        { updatedAtMs: now, deviceId: device, devices: { [device]: now } }, { merge: true }));
      await commitInChunks(s, ops);
    }
    afterCommit.forEach(fn => fn());

    // Recorded even when nothing moved: the version stamp is what stops the
    // next push re-uploading everything again, and a push that found nothing
    // to send is still a push that succeeded.
    writeLocal('sync:lastPushedAt', now);
    writeLocal('sync:pushVersion', SYNC_SCHEMA_VERSION);
    setLastSyncedAt(now);
    setState({ status: 'ready', lastResult: { kind: 'push', count: touched, at: now } });
    return touched;
  } catch (e) {
    setState({ status: 'error', error: describeError(e) });
    return 0;
  }
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushNow(); }, PUSH_DEBOUNCE_MS);
}

/** Sync bookkeeping doesn't belong in the record itself once it's home. */
function stripSyncFields(doc) {
  // eslint-disable-next-line no-unused-vars
  const { syncedAt, ...rest } = doc;
  return rest;
}

/**
 * Download everything uploaded since the last pull and merge it in.
 * Caller confirms with the user first.
 *
 * `force` ignores this device's pull watermark and re-reads whole collections.
 * Nothing is lost by doing so — the merge is per record and per id — it just
 * costs a read per document, which is why it isn't the default.
 */
export async function pullNow({ force = false } = {}) {
  const s = await loadSdk();
  if (!s.auth.currentUser) return 0;

  // Documents written before v2 carry no `syncedAt`, and Firestore drops
  // documents missing the filtered field — so a filtered query would report a
  // confident, wrong "nothing new". The first pull after the upgrade reads
  // everything instead.
  const full = force || getPullVersion() < SYNC_SCHEMA_VERSION || getLastPulledAt() === 0;

  setState({ status: 'pulling', error: null });
  try {
    const since = getLastPulledAt();
    const now = Date.now();
    let changed = 0;

    // Incremental: documents this device has already read are never re-read.
    const sliceOf = (name) => (full
      ? collPath(s, name)
      : s.query(collPath(s, name), s.where('syncedAt', '>', since)));

    for (const name of RECORD_COLLECTIONS) {
      const snap = await s.getDocs(sliceOf(name));
      const docs = snap.docs.map(d => stripSyncFields(d.data()));
      if (docs.length) {
        changed += mergeRemoteRecords(name, docs);
        setSyncedIds(name, new Set(readLocal(name, []).map(r => r.id)));
      }
    }

    const daySnap = await s.getDocs(sliceOf(DAILY_STATS));
    if (!daySnap.empty) {
      const byDay = (a, b) => a.date.localeCompare(b.date);
      const local = readLocal(DAILY_STATS_LOCAL_KEY, []);
      const list = (Array.isArray(local) ? local : []).slice().sort(byDay);
      const byDate = new Map(list.map(d => [d.date, d]));
      for (const d of daySnap.docs) {
        // eslint-disable-next-line no-unused-vars
        const { at, ...rest } = stripSyncFields(d.data());
        byDate.set(rest.date, rest);
      }
      // Compared, not assumed: a re-read of days this device already has must
      // count as nothing changed, or a full re-sync would claim it loaded
      // hundreds of days and reload the page for no reason.
      const merged = [...byDate.values()].sort(byDay);
      if (fingerprint(merged) !== fingerprint(list)) {
        writeLocal(DAILY_STATS_LOCAL_KEY, merged);
        changed += daySnap.size;
      }
    }

    // Meta documents are whole-value, so there is no per-record merge to fall
    // back on: applying one blindly would overwrite local edits this device
    // hasn't uploaded yet. The fingerprint says whether that's the case —
    // matching means nothing has been touched here since the last push, so the
    // cloud copy is safe to take.
    for (const name of Object.keys(META_DOCS)) {
      if (hasUnpushedMetaChanges(name)) continue;   // ours is newer; the next push sends it
      const snap = await s.getDoc(userPath(s, 'meta', name));
      if (!snap.exists()) continue;
      const before = fingerprint(readMetaDoc(name));
      // eslint-disable-next-line no-unused-vars
      const { at, syncedAt, ...data } = snap.data();
      writeMetaDoc(name, data);
      const after = fingerprint(readMetaDoc(name));
      if (after !== before) changed++;   // one document, one item
      writeLocal(metaFingerprintKey(name), after);
    }

    writeLocal('sync:lastPulledAt', now);
    writeLocal('sync:pullVersion', SYNC_SCHEMA_VERSION);
    setLastSyncedAt(now);
    setState({ status: 'ready', remoteNewer: null, lastResult: { kind: 'pull', count: changed, at: now } });

    if (changed > 0) {
      // Every module reads localStorage through useState initialisers, so a
      // reload is the only way to make merged data take effect.
      window.location.reload();
    }
    return changed;
  } catch (e) {
    setState({ status: 'error', error: describeError(e) });
    return 0;
  }
}

// Exported so it can be unit-tested against fake error objects without
// needing the actual Firebase SDK loaded — see test-sync.mjs.
export function describeError(e) {
  const code = e?.code || '';
  if (e?.message === 'NOT_CONFIGURED') return '还没有设定 Firebase（见 .env.example）。';
  if (code.includes('permission-denied')) return '权限被拒 — 检查 Firestore 安全规则是否已部署。';
  if (code.includes('failed-precondition')) return 'Firestore 需要建立索引，错误讯息里会有一个连结，点开按建立。';
  // Spark (free) plan's daily read/write cap. Not a billing event — Spark has
  // no card attached, so exceeding it just refuses further requests for the
  // rest of the day (Firestore resets at midnight UTC). Nothing local is
  // lost; the next automatic push/pull picks up from lastSyncedAt once quota
  // is back, so this is worth naming plainly rather than showing a raw
  // "RESOURCE_EXHAUSTED" string.
  if (code.includes('resource-exhausted')) return '今天的 Firebase 免费额度用完了 — 不会扣钱，资料都还在这台装置。额度会在明天（UTC 午夜）重置，到时候会自动继续同步。';
  if (code.includes('unavailable') || code.includes('network')) return '连不上网络，资料仍安全存在这台装置。';
  if (code.includes('popup-closed')) return '登入视窗被关掉了。';

  // Email/password sign-in. Firebase deliberately returns one generic
  // `invalid-credential` for both a wrong password and an unknown email, so
  // an attacker can't probe which addresses have accounts — the message has
  // to cover both cases without guessing which one it was.
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return 'Email 或密码不对。第一次用的话要先注册，不是登入。';
  }
  // Also the exit from a Google-created account: Firebase keeps one account per
  // email address, so an email/password registration on an address that already
  // signed in with Google is refused — and "just sign in instead" would then
  // fail too, because that account has no password. A password reset adds one
  // to the SAME uid, which matters: the uid is the data path, so this keeps any
  // existing synced data instead of stranding it under an account nobody can
  // reach.
  if (code.includes('email-already-in-use')) {
    return '这个 email 已经注册过了 — 改用「登入」。如果之前是用 Google 登入的，先按「忘记密码」设一组密码，帐号和资料都还是同一个。';
  }
  if (code.includes('weak-password')) return '密码太短了，至少要 6 个字。';
  if (code.includes('invalid-email')) return 'Email 格式不对。';
  // Firebase throttles per IP after repeated failures; it clears by itself.
  if (code.includes('too-many-requests')) return '试太多次了，Firebase 暂时挡住这台装置。等几分钟再试，或用「忘记密码」。';
  if (code.includes('unauthorized-domain')) return '这个网址没有被授权 — 到 Firebase Console → Authentication → Settings 加入。';
  // Rules being deployed doesn't turn on a sign-in provider itself — that's a
  // separate switch per provider in the console, and until it's flipped every
  // attempt against that provider fails with this exact code.
  if (code.includes('operation-not-allowed')) return '还没有在 Firebase Console 打开这个登入方式 — 到 Authentication → Sign-in method，把 Email/Password 按 Enable。';
  return e?.message || '同步发生未知错误。';
}

if (typeof window !== 'undefined') {
  window.addEventListener(CHANGE_EVENT, () => {
    if (isSyncEnabled() && state.user) schedulePush();
  });
}
