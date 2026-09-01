// What syncs where, and how local changes are detected.
//
// Split out from cloudSync.js so the decisions are testable without Firebase,
// and so the schema (SCHEMA.md) has one place in code that mirrors it.

const PREFIX = 'lifemanager:';

/**
 * Unbounded, per-document collections.
 *
 * These MUST NOT live inside a single document: Firestore caps a document at
 * 1 MiB, and roughly 20 records a day at ~150 bytes each reaches that inside a
 * year. As collections they also allow date-range queries and let one edit
 * write one document instead of rewriting everything.
 */
// `chats` was here until the in-app AI Coach was removed (it called Gemini on
// prepaid credits that ran out). Nothing writes that key any more, so syncing
// it would only shuttle a dead conversation between devices forever. Old
// `chats/{id}` documents already in Firestore are simply left where they are —
// deleting a user's data to tidy up a schema is not this layer's call.
//
// `supplementLog` is here rather than in a meta doc for the same 1 MiB reason:
// six supplements taken daily is ~2,200 rows a year, and it is append-only, so
// it is exactly the growth curve this split exists to handle.
export const RECORD_COLLECTIONS = ['meals', 'workouts', 'expenses', 'notes', 'supplementLog'];

/** Daily summaries, keyed by their own date so a re-run overwrites. */
export const DAILY_STATS = 'dailyStats';

/** The local key that feeds the DAILY_STATS collection — see cloudSync.js. */
export const DAILY_STATS_LOCAL_KEY = 'history';

/**
 * Small, bounded values that are always read together. One document each is
 * cheaper than one read per item, and none of them can grow without bound.
 */
export const META_DOCS = {
  settings: ['calorieLimit', 'macroTargets', 'dailyBudget', 'userName', 'clipboardWatchEnabled', 'bodyWeightKg', 'weightUnit', 'ageYears', 'heightCm', 'sex', 'activityLevel', 'dietGoal', 'autoCalorieTarget', 'workoutPlace'],
  merchants: ['merchantCategories'],
  accounts: ['accounts'],
  debts: ['debts', 'debtPlan'],
  routines: ['routines'],
  gamification: ['archivedXp', 'lastSeenLevel'],
  // Added after the fact — these three keys (M16's payday router, M20's
  // impulse sandbox) existed in localStorage for a while before anyone
  // noticed they were never added here, so a signed-in second device would
  // silently never see them. There is no schema/migration system forcing a
  // new key to be registered with sync — this list IS the registration, and
  // it's opt-in by construction. See SCHEMA.md.
  payday: ['incomeSources', 'allocations'],
  impulse: ['pendingRequests'],
  // Body-weight readings over time. Its OWN document rather than a field on
  // `settings`, for two reasons: it is the only value here that grows (capped
  // at MAX_ENTRIES in bodyWeight.js precisely so this document stays bounded),
  // and a meta doc is pushed whole — filing it under `settings` would rewrite
  // the entire weigh-in history every time the calorie limit changed.
  // `bodyWeightKg` stays in `settings` where it has always been: it is the
  // current weight that every calorie formula reads, not the history.
  body: ['weightLog'],
  // The Life Hub's three lists. THREE DOCUMENTS, not one: a meta doc is pushed
  // and pulled whole, so putting them together would mean editing a reminder on
  // the phone and a note category on the PC could clobber each other. Each is
  // small and bounded — a person has tens of reminders, not thousands.
  //
  // `notes` themselves are NOT here: they are unbounded and belong in
  // RECORD_COLLECTIONS above, for exactly the 1 MiB reason in its comment. Only
  // the category list, which is a handful of labels, lives in a meta doc.
  notesMeta: ['noteCategories'],
  reminders: ['reminders'],
  specialDays: ['specialDays'],
  // The user's own spending/income categories: additions, renames, and which
  // built-ins they've hidden. Its own document for the same reason as
  // `notesMeta` — small, bounded (a handful of labels), and edited on one
  // device at a time, so pushing it whole is safe.
  //
  // The BUILT-IN lists are not here and never will be: they ship in the code
  // (moneyCategories.js), so syncing them would upload a copy of the app's own
  // constants and let an old device's stale copy overwrite a newer one's.
  // Only the user's deltas travel.
  moneyCategories: ['moneyCategoryPrefs'],
  // The supplement shelf: a handful of products, edited on one device at a
  // time, so pushing it whole is safe. The TAKEN LOG is not here — it grows
  // without bound and lives in RECORD_COLLECTIONS above.
  //
  // `supplementsSeeded` travels WITH the list, deliberately. The seed only runs
  // when the list is empty and the flag is false; if the flag were device-local,
  // a second phone signing in before its first pull would seed its own copy of
  // the same six bottles and the merge would leave twelve. Carried together,
  // pulling the list also pulls the fact that seeding already happened.
  supplements: ['supplements', 'supplementsSeeded'],
  // Which sources may notify, the nudge times, the bill lead time. Its own
  // document rather than a field on `settings`: it is written by one screen
  // that has nothing to do with calorie targets, and a meta doc is pushed
  // whole — filing it under `settings` would rewrite the diet profile every
  // time a notification switch was flipped.
  notifications: ['notificationSettings'],
};

/**
 * Persisted keys that are DELIBERATELY device-local, never synced — with a
 * reason for each, so leaving a key out of `META_DOCS`/`RECORD_COLLECTIONS`
 * always reads as a decision, never an oversight. `test-sync-completeness.mjs`
 * scans every `usePersistentState`/`useLiveJSON` call site in `src` and fails
 * if it finds a key that's in neither this list nor the synced ones — that's
 * the exact failure mode that let `incomeSources`/`allocations`/
 * `pendingRequests` go unsynced for several milestones (see MILESTONES.md M27).
 */
export const LOCAL_ONLY_KEYS = {
  lastActiveDate: 'the day-rollover cursor — each device rolls over on its own local midnight, syncing it would let one device\'s clock reset another\'s',
  tngReviewQueue: 'Android-only notification review queue — only the phone with the native listener ever has anything in it',
  tngCaptureLog: 'raw notification text captured by the listener on THIS phone, kept only to answer "did anything arrive, and how was it read" — device-local by nature (only the phone running the listener has any), and syncing raw notification bodies would move message contents to a device that has no use for them',
  clipboardLastSeen: 'raw clipboard text, kept only to detect a NEW copy on this device — a device\'s OS clipboard is inherently local, syncing this would leak whatever unrelated text either device last had copied',
  updateLastCheckedAt: 'when THIS device last asked the server for a version manifest — a throttle, and each device throttles on its own clock',
  updateLastResult: 'the cached answer to that check — meaningless on another device, which may be on a different version entirely',
  updateDismissedVersion: 'the version THIS device said "later" to — dismissing an update on the laptop must not silence it on the phone, which is the device that actually needs it',
  loginGateSeen: 'whether THIS device has already dismissed the first-launch login prompt — a fresh install on a second device should still get to see it once, syncing it would silently skip that',
};

export function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeLocal(key, value) {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

/**
 * Ids last known to be in the cloud, per collection.
 *
 * Needed because a local delete is just "the item is no longer in the array" —
 * there's nothing to push. Comparing the current ids against this set is what
 * turns a disappearance into an explicit delete instead of the record silently
 * coming back on the next pull. Storing ids only keeps it tiny.
 */
function syncedIdsKey(collection) {
  return `sync:ids:${collection}`;
}

export function getSyncedIds(collection) {
  return new Set(readLocal(syncedIdsKey(collection), []));
}

export function setSyncedIds(collection, ids) {
  writeLocal(syncedIdsKey(collection), [...ids]);
}

/**
 * When a record was last CHANGED, for sync purposes.
 *
 * `at` is the event timestamp — when the meal was eaten, when the payment
 * happened — and several things depend on it staying that: `movementSince()` in
 * accounts.js decides whether an expense falls after an account's reconcile
 * watermark by comparing `e.at ?? e.id` against `openingAt`, and migrate.js
 * treats `id` as the original timestamp. Bumping `at` on an edit would
 * therefore move an old expense across a watermark and silently subtract it
 * from a balance that had already accounted for it.
 *
 * So an edit stamps a SEPARATE `updatedAt`, and sync reads the later of the two.
 *
 * THE BUG THIS FIXES
 * Sync's change detection was `(r.at ?? 0) > since`, and no edit path anywhere
 * in the app ever touched `at`. So a record was pushed exactly once, when it was
 * created, and every subsequent edit was invisible to sync: correct a merchant
 * name, fix a calorie count or an amount on the phone, and the PC kept the
 * original forever — with no error and nothing to notice. The unit test even
 * encoded the intended behaviour ("only the edited record is sent") by hand-
 * bumping `at`, which the app itself never did.
 */
export function touchedAt(record) {
  const at = Number(record?.at) || 0;
  const updated = Number(record?.updatedAt) || 0;
  return Math.max(at, updated);
}

/**
 * Work out what to send for one collection.
 *
 * @param {string} collection
 * @param {number} since  push records touched after this epoch-ms
 * @returns {{upserts: object[], deletes: (string|number)[], allIds: Set}}
 */
export function diffCollection(collection, since) {
  const items = readLocal(collection, []);
  const list = Array.isArray(items) ? items : [];

  const allIds = new Set(list.map(r => r.id).filter(id => id != null));
  const previous = getSyncedIds(collection);

  // Anything that was in the cloud and is no longer here was deleted locally.
  const deletes = [...previous].filter(id => !allIds.has(id));

  const upserts = list.filter(r => {
    if (r.id == null) return false;
    // Never synced before, or touched since the last push.
    if (!previous.has(r.id)) return true;
    return touchedAt(r) > since;
  });

  return { upserts, deletes, allIds };
}

/**
 * Key-order-independent comparison, so a record that came back from Firestore
 * with its fields in a different order isn't mistaken for an edit. Only the
 * change COUNT depends on this — and the count decides whether a pull reloads
 * the page and what it reports having done, so a full re-pull of unchanged
 * data has to be able to say "nothing changed" honestly.
 */
function sameRecord(a, b) {
  if (!a || !b) return false;
  const stable = (o) => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
  return stable(a) === stable(b);
}

/** Merge records pulled from the cloud into the local array, by id. */
export function mergeRemoteRecords(collection, remote) {
  const local = readLocal(collection, []);
  const byId = new Map((Array.isArray(local) ? local : []).map(r => [r.id, r]));

  let changed = 0;
  for (const doc of remote) {
    if (doc.deleted) {
      if (byId.delete(doc.id)) changed++;
      continue;
    }
    const existing = byId.get(doc.id);
    if (sameRecord(existing, doc)) continue;
    // Last write wins per record, compared on when each side was last CHANGED —
    // not on `at`, which is the event time and stays put across edits. Comparing
    // `at` meant an edit made on the other device lost to the local copy of the
    // same record, since both carry the identical original `at`.
    if (!existing || touchedAt(doc) >= touchedAt(existing)) {
      byId.set(doc.id, doc);
      changed++;
    }
  }

  if (changed > 0) {
    // Ordered by event time, not by last edit — the list is a chronological log
    // and fixing a typo should not move an entry to the bottom of it.
    const merged = [...byId.values()].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    writeLocal(collection, merged);
  }
  return changed;
}

/** Gather one meta document's worth of local values. */
export function readMetaDoc(name) {
  const out = {};
  for (const key of META_DOCS[name]) {
    const value = readLocal(key, undefined);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Apply a meta document pulled from the cloud. */
export function writeMetaDoc(name, data) {
  let changed = 0;
  for (const key of META_DOCS[name]) {
    if (data && Object.prototype.hasOwnProperty.call(data, key)) {
      writeLocal(key, data[key]);
      changed++;
    }
  }
  return changed;
}

/** Where the fingerprint of a meta doc's last pushed state is kept. */
export const metaFingerprintKey = (name) => `sync:fp:${name}`;

/**
 * Does this device hold edits to a meta document that the cloud hasn't got yet?
 *
 * Meta documents are whole values, not per-id records, so a pull has no
 * per-record merge to fall back on — applying the cloud copy blindly would
 * throw away anything edited here since the last push. The fingerprint answers
 * it exactly: it was written at push time, so if it still matches, nothing has
 * been touched since and the cloud copy is safe to take.
 *
 * A device that has never pushed this document has nothing of its own to
 * protect, and must take the cloud copy — that is the case of a fresh phone
 * signing in for the first time, which is precisely when it needs to.
 */
export function hasUnpushedMetaChanges(name) {
  const lastPushed = readLocal(metaFingerprintKey(name), null);
  if (lastPushed === null) return false;
  return lastPushed !== fingerprint(readMetaDoc(name));
}

/** Cheap change detector for meta docs, so unchanged ones aren't rewritten. */
export function fingerprint(value) {
  const json = JSON.stringify(value ?? null);
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    hash = (hash * 31 + json.charCodeAt(i)) | 0;
  }
  return `${json.length}:${hash}`;
}
