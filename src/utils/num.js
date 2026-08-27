// Numeric coercion for anything that gets summed and then SHOWN or STORED.
//
// THE FAILURE THIS PREVENTS
// Every total in this app is a plain `reduce((s, x) => s + x.field, 0)`. That is
// the right shape — it's why a refund's negative amount nets correctly
// everywhere without each call site knowing refunds exist — but it has one
// property that matters a lot here: a single record with a missing or
// non-numeric field turns the WHOLE total into NaN, not just its own
// contribution. One bad row and the screen reads "RM NaN".
//
// That would be survivable if it were only a display glitch. It isn't: App.jsx's
// midnight rollover summarises the day into `history`, and history is never
// recomputed (see the comment on totalExpense there). So a NaN that exists for
// one render gets written into the permanent record, poisons the XP/Level maths
// that sums history, and there is no way back short of editing localStorage by
// hand.
//
// A bad record can arrive from: a hand-edited or partially-filled form, a
// backup file written by an older build, a cloud merge from a device running a
// different version, or a field this app hasn't invented yet. None of those are
// exotic, and all of them should cost exactly one wrong row — not the total.

/** A finite number, or 0. Never NaN, never Infinity, never a string. */
export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Sum a field across a list, immune to a bad row.
 *
 * @param {Array} list
 * @param {(item: any) => any} pick  defaults to the item itself
 */
export function sumBy(list, pick = (x) => x) {
  if (!Array.isArray(list)) return 0;
  return list.reduce((total, item) => total + num(pick(item)), 0);
}

/**
 * Monotonically unique record id.
 *
 * Ids are `Date.now()` throughout this app, and that doubles as the record's
 * timestamp — `migrate.js` relies on it, and `movementSince` in accounts.js
 * falls back to `e.at ?? e.id`. So the value has to stay an epoch-ms number.
 *
 * The problem with calling `Date.now()` directly is that two records created in
 * the same millisecond get the SAME id, and every id-keyed operation in the app
 * then treats them as one record: editing one edits both, deleting one deletes
 * both, and cloud sync (`b.set(doc(coll, String(rec.id)))`) writes them to the
 * same Firestore document so one silently overwrites the other. `makeTransfer`
 * already works around this by hand with `at + 1`; this generalises that so
 * nothing else has to remember.
 *
 * Same millisecond -> previous + 1. The drift is at most a few ms and only
 * lasts until the clock catches up, so the id remains a usable timestamp.
 */
let lastId = 0;
export function newId() {
  const now = Date.now();
  lastId = now > lastId ? now : lastId + 1;
  return lastId;
}
