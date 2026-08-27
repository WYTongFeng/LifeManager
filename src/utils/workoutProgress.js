// 训练进度 — "am I actually getting stronger", answered from records that
// exist rather than records we wish existed.
//
// THE CONSTRAINT THAT SHAPES THIS WHOLE FILE
// Most training days are logged in ONE TAP: `{ type: 'session', routineBlock,
// setsPlanned, durationMin }` — phone in the locker, own timer, and at the end
// a single fact worth keeping, "我今天做了板块 1". Those records carry no
// exercise, no weight and no reps. A per-exercise strength screen built on
// set-by-set logging would therefore be EMPTY on most days, and would quietly
// stop working for the person it was built for.
//
// So this file has two tiers, and the first one is the one that always works:
//
//   1. blockHistory()      — which 板块 got done, how often, how long ago.
//                            Reads whole-session records and set-by-set days
//                            identically, because both carry `routineBlock`.
//   2. exerciseProgress()  — per-exercise weight/rep progression. Real strength
//                            data, available only for days logged set-by-set,
//                            and honest about being unavailable otherwise.
//
// Tier 1 is not a consolation prize for tier 2. "Did I train the whole split or
// keep skipping legs" is a better question than "did my bench go up 2.5kg",
// because the split is the thing that is actually being followed or not.

import { num, sumBy } from './num.js';
import { getTodayString } from './storage.js';

/** Cardio and one-tap sessions carry no sets — only real logged sets do. */
const isLoggedSet = (w) => w?.type !== 'cardio' && w?.type !== 'session';

/** A hold (plank, wall sit) has seconds, not reps — weight progression is meaningless. */
const isHold = (w) => w?.mode === 'time' || num(w?.holdSec) > 0;

/**
 * Days on which each 板块 was trained, newest first.
 *
 * Keyed on `routineBlock` when the record has one and falling back to
 * `routineName`, because that is exactly what the rotation does (see
 * suggestRoutine) — a routine can be renamed or switched between gym and home
 * and still be the same day of the split.
 *
 * @param {object[]} workouts  ALL workouts
 * @param {object}   opts
 * @param {number}   opts.days  window to count within, default 28 (4 weeks)
 */
export function blockHistory(workouts = [], { days = 28, now = new Date() } = {}) {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  from.setDate(from.getDate() - (days - 1));
  const cutoff = getTodayString(from);
  const today = getTodayString(now);

  // One entry per BLOCK PER DAY. Twenty logged sets of chest is one chest day,
  // and counting records would rank a meticulously logged day four times above
  // an identical day logged in one tap.
  const seen = new Map();
  for (const w of workouts) {
    if (!w?.date || w.type === 'cardio') continue;
    const key = w.routineBlock ?? w.routineName ?? null;
    if (key == null) continue;
    const entry = seen.get(key) ?? { key, name: w.routineName ?? String(key), dates: new Set() };
    // Keep the most RECENT name for a block — a renamed routine should show
    // under its current name, not whatever it was called three weeks ago.
    if (!entry.latestDate || w.date >= entry.latestDate) {
      entry.latestDate = w.date;
      entry.name = w.routineName ?? entry.name;
    }
    entry.dates.add(w.date);
    seen.set(key, entry);
  }

  return [...seen.values()]
    .map((e) => {
      const all = [...e.dates].sort((a, b) => b.localeCompare(a));
      const inWindow = all.filter((d) => d >= cutoff);
      return {
        key: e.key,
        name: e.name,
        // Sessions inside the window — the figure the screen actually shows.
        count: inWindow.length,
        lastDate: all[0] ?? null,
        // Null, not a large number, when it was never trained at all: "never"
        // and "999 days ago" are different statements.
        daysSince: all[0] ? daysBetween(all[0], today) : null,
        dates: all,
      };
    })
    .sort((a, b) => {
      // Most neglected first — the point of this list is to show the gap.
      if (a.daysSince == null) return 1;
      if (b.daysSince == null) return -1;
      return b.daysSince - a.daysSince;
    });
}

/** Whole days between two YYYY-MM-DD strings, built from parts (never UTC-parsed). */
export function daysBetween(from, to) {
  const [ay, am, ad] = from.split('-').map(Number);
  const [by, bm, bd] = to.split('-').map(Number);
  const a = new Date(ay, am - 1, ad);
  const b = new Date(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}

/**
 * One row per DAY this exercise was trained, oldest first.
 *
 * A day, not a set. Three sets of bench on Monday are one data point about
 * Monday's bench, and treating them as three would make a day with more sets
 * look like faster progress.
 *
 * `topKg` is the heaviest set of the day and `repsAtTop` the best reps AT that
 * weight. The top set — not the average — because an average moves when you add
 * a warm-up or a back-off set, which is not a strength change.
 */
export function exerciseSessions(workouts = [], exerciseName) {
  if (!exerciseName) return [];
  const byDate = new Map();

  for (const w of workouts) {
    if (!isLoggedSet(w) || w.exercise !== exerciseName || !w.date) continue;
    const row = byDate.get(w.date) ?? {
      date: w.date, sets: 0, topKg: 0, repsAtTop: 0, volume: 0, holdSec: 0, hold: false,
    };
    row.sets += 1;

    if (isHold(w)) {
      row.hold = true;
      row.holdSec = Math.max(row.holdSec, num(w.holdSec));
    } else {
      const kg = num(w.weightKg);
      const reps = num(w.reps);
      // Volume is the honest "how much work" figure, and it needs both numbers.
      // A hold contributes none rather than a misleading zero-weight product.
      row.volume += kg * reps;
      if (kg > row.topKg) {
        row.topKg = kg;
        row.repsAtTop = reps;
      } else if (kg === row.topKg && reps > row.repsAtTop) {
        row.repsAtTop = reps;
      }
    }
    byDate.set(w.date, row);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Is this exercise moving?
 *
 * Compares the LATEST session against the one before it, and reports a verdict
 * only when the comparison is meaningful:
 *
 *   'up'        heavier top set than last time
 *   'reps'      same top weight, more reps at it — real progress, and the thing
 *               a weight-only view misses entirely
 *   'repsDown'  same top weight, FEWER reps at it. The mirror of 'reps', and it
 *               has to exist for the same reason: if 45kg x 9 after 45kg x 7 is
 *               progress, then 27.5kg x 10 after 27.5kg x 12 is not "持平".
 *               Calling that unchanged is a true-sounding statement about a
 *               number that moved.
 *   'down'      lighter top set (a deload, a bad day, or a genuine regression —
 *               this does not guess which, it just reports it)
 *   'same'      identical weight AND reps
 *   null        fewer than two sessions, so there is nothing to compare
 */
export function exerciseProgress(workouts = [], exerciseName) {
  const sessions = exerciseSessions(workouts, exerciseName);
  if (sessions.length === 0) return null;

  const latest = sessions[sessions.length - 1];
  const previous = sessions.length >= 2 ? sessions[sessions.length - 2] : null;

  let verdict = null;
  let deltaKg = null;
  let deltaReps = null;
  if (previous && !latest.hold && !previous.hold) {
    deltaKg = Math.round((latest.topKg - previous.topKg) * 10) / 10;
    deltaReps = latest.repsAtTop - previous.repsAtTop;
    if (deltaKg > 0) verdict = 'up';
    else if (deltaKg < 0) verdict = 'down';
    else if (deltaReps > 0) verdict = 'reps';
    else if (deltaReps < 0) verdict = 'repsDown';
    else verdict = 'same';
  }

  return {
    name: exerciseName,
    sessions,
    sessionCount: sessions.length,
    latest,
    previous,
    verdict,
    deltaKg,
    deltaReps,
    // The all-time heaviest set, which is NOT necessarily the latest one —
    // that difference is the whole point of showing both.
    bestKg: sessions.reduce((max, s) => Math.max(max, s.topKg), 0),
    hold: latest.hold,
  };
}

/**
 * Exercises worth putting on a progress screen, best-progressing first.
 *
 * `minSessions` defaults to 2 because one session is a record, not a trend, and
 * a list of exercises that all say "还没有对比" is a list worth nothing.
 */
export function trackedExercises(workouts = [], { minSessions = 2, limit = 12 } = {}) {
  const names = new Set();
  for (const w of workouts) {
    if (isLoggedSet(w) && w.exercise) names.add(w.exercise);
  }

  return [...names]
    .map((name) => exerciseProgress(workouts, name))
    .filter((p) => p && p.sessionCount >= minSessions)
    // Most recently trained first: what you did this week is what you want to
    // see, not whatever happens to sort alphabetically.
    .sort((a, b) => b.latest.date.localeCompare(a.latest.date))
    .slice(0, limit);
}

/**
 * How much of the training in a window was logged set-by-set.
 *
 * Exists so a screen can say WHY it has little per-exercise data instead of
 * just looking broken — "6 of your 8 sessions were logged in one tap" is an
 * explanation; an empty list is a bug report.
 */
export function loggingMix(workouts = [], { days = 28, now = new Date() } = {}) {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  from.setDate(from.getDate() - (days - 1));
  const cutoff = getTodayString(from);

  const detailed = new Set();
  const quick = new Set();
  for (const w of workouts) {
    if (!w?.date || w.date < cutoff || w.type === 'cardio') continue;
    if (w.type === 'session') quick.add(w.date);
    else if (isLoggedSet(w)) detailed.add(w.date);
  }
  // A day with both a one-tap record and logged sets counts as detailed — it
  // has real set data, which is what the caller is asking about.
  for (const d of detailed) quick.delete(d);

  return { detailedDays: detailed.size, quickDays: quick.size, totalDays: detailed.size + quick.size };
}

/** Total tonnage in a window — sets x reps x weight. Cardio and holds contribute none. */
export function totalVolume(workouts = [], { from = null, to = null } = {}) {
  return sumBy(
    workouts.filter((w) =>
      isLoggedSet(w) && !isHold(w) &&
      (!from || w.date >= from) && (!to || w.date <= to)),
    (w) => num(w.weightKg) * num(w.reps)
  );
}
