// 体重记录 — body weight over time.
//
// WHAT WAS MISSING
// The app knew exactly one thing about body weight: `bodyWeightKg`, a single
// number in settings. It is load-bearing — calcBMR, the MET calorie formulas
// and every strength-set estimate read it — but it has no memory. Overwrite it
// and the previous value is gone. So the app could tell you what you weigh and
// could never tell you whether that is going anywhere, which is the only
// question anybody actually asks about their weight.
//
// This adds the log WITHOUT touching `bodyWeightKg`. That key stays exactly
// what it is (the current weight, the input to every calorie calculation) and
// keeps being written the same way; the log is appended alongside it. Nothing
// downstream of `bodyWeightKg` changes behaviour, which is the whole point —
// this is a new reading, not a new source of truth for old maths.
//
// THE HONESTY RULE
// An entry means "he stood on a scale and it said this". It does NOT mean "the
// app saved a settings screen". Saving the body-profile modal to correct your
// HEIGHT must not deposit a weigh-in for today at the weight you already had:
// the app would then be able to draw a flat line across a fortnight nobody
// measured, and report "体重没变" as if it were an observation. So an unchanged
// number records nothing — see `recordWeight`.

import { num } from './num.js';
import { getTodayString } from './storage.js';

/**
 * How many readings to keep.
 *
 * `weightLog` lives in a META_DOCS document, and that list is explicitly for
 * values that "cannot grow without bound" (syncModel.js) — a Firestore document
 * is capped at 1 MiB. A reading is ~55 bytes, so this cap is ~55 KB and roughly
 * three years of weighing yourself every single day. Oldest go first.
 */
export const MAX_ENTRIES = 1000;

const round1 = (n) => Math.round(n * 10) / 10;

/** Sorted oldest-first, garbage rows dropped. The shape everything else assumes. */
export function normalizeWeightLog(log) {
  if (!Array.isArray(log)) return [];
  return log
    .filter((w) => w && typeof w.date === 'string' && num(w.kg) > 0)
    .map((w) => ({ date: w.date, kg: round1(num(w.kg)), at: num(w.at) || 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The most recent reading, or null. */
export function latestWeight(log) {
  const list = normalizeWeightLog(log);
  return list.length ? list[list.length - 1] : null;
}

/**
 * Record a weigh-in, returning a NEW log.
 *
 * Two things it deliberately does not do:
 *
 *   · **An unchanged number records nothing.** If the latest reading is already
 *     66.6 and 66.6 comes in again, no entry is added. Otherwise every save of
 *     the body-profile modal — opened to fix a height, a birth year, anything —
 *     would fabricate a weigh-in, and a fabricated reading is indistinguishable
 *     from a real one the moment it is stored.
 *   · **It never writes two readings for one date.** Weighing again on the same
 *     day replaces that day's entry rather than appending; the later reading is
 *     that day's reading, and a day with two values makes "start → end" ambiguous.
 */
export function recordWeight(log, { kg, date = getTodayString(), at = Date.now() } = {}) {
  const value = round1(num(kg));
  if (!(value > 0)) return normalizeWeightLog(log);

  const list = normalizeWeightLog(log);
  const latest = list.length ? list[list.length - 1] : null;

  // Same number as the latest reading: nothing was measured, so nothing is
  // recorded. See the honesty rule above. (When that latest reading IS today's,
  // this is also just a no-op edit — same value, same date, nothing to change.)
  if (latest && latest.kg === value) return list;

  const withoutToday = list.filter((w) => w.date !== date);
  const next = [...withoutToday, { date, kg: value, at: num(at) }]
    .sort((a, b) => a.date.localeCompare(b.date));

  return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
}

/** Delete one date's reading. */
export function removeWeight(log, date) {
  return normalizeWeightLog(log).filter((w) => w.date !== date);
}

/**
 * The last `limit` readings, newest last — the shape a line chart wants.
 * `label` is MM-DD, matching the per-exercise trend chart already in the app.
 */
export function weightSeries(log, limit = 12) {
  return normalizeWeightLog(log)
    .slice(-limit)
    .map((w) => ({ date: w.date, label: w.date.slice(5), kg: w.kg }));
}

/**
 * Change over the last `days` days, measured between the readings that actually
 * exist — null when there are not two of them to measure between.
 *
 * Returns null rather than 0 for the same reason `computeWeekReview` does:
 * "no change" and "we never checked" look identical as a number and are
 * completely different as a statement.
 */
export function weightChangeOver(log, days = 30, now = new Date()) {
  const list = normalizeWeightLog(log);
  if (list.length < 2) return null;

  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  from.setDate(from.getDate() - days);
  const cutoff = getTodayString(from);

  const recent = list.filter((w) => w.date >= cutoff);
  if (recent.length === 0) return null;

  // THE BASELINE RULE, used identically by computeWeekReview's body section.
  //
  // Prefer the window's OWN first reading, and reach outside it only when the
  // window cannot stand on its own (a single weigh-in in it). Reaching outside
  // by default is what the first version did, and it silently mislabels the
  // period: a reading from 36 days ago as the baseline for a figure called
  // "30-day change" makes the number span 36 days while the label says 30.
  //
  // When it DOES fall back, `startDate` comes back with it, so the screen can
  // name the real date instead of implying the full window.
  const prior = list.filter((w) => w.date < cutoff).pop() ?? null;
  const start = recent.length >= 2 ? recent[0] : (prior ?? recent[0]);
  const end = recent[recent.length - 1];
  if (start === end) return null;

  return {
    startKg: start.kg, startDate: start.date,
    endKg: end.kg, endDate: end.date,
    changeKg: round1(end.kg - start.kg),
  };
}
