// Workout consistency — "did I train today" turned into something visible,
// not just buried in the general History browser (M17).
//
// `history` holds archived PAST days (dailyStats, each with a `totalSets`
// count) — today itself hasn't been archived yet (that only happens at the
// midnight rollover, see App.jsx), so today's count has to come from the
// live, unarchived workouts array instead and is passed in separately.

import { getTodayString } from './storage.js';

const trainedOn = (stats) => Number(stats?.totalSets) > 0;

/**
 * Current consecutive-day streak, counting backward from yesterday, plus
 * today if it already has a set logged.
 *
 * Today deliberately does NOT break the streak just for being empty so far —
 * it's still in progress. A day is only counted against you once it's
 * actually over and had nothing logged (i.e. from tomorrow onward, it reads
 * as a zero-day in `history`, same as M22's honesty-pass backfill).
 *
 * @param {object[]} history   dailyStats records — {date, totalSets, ...}
 * @param {number}   todaySets sets logged today, from the live (unarchived) array
 * @param {Date}     now
 */
export function computeWorkoutStreak(history = [], todaySets = 0, now = new Date()) {
  const byDate = new Map(history.map(d => [d.date, d]));
  let streak = todaySets > 0 ? 1 : 0;

  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  cursor.setDate(cursor.getDate() - 1); // start at yesterday

  for (;;) {
    const day = byDate.get(getTodayString(cursor));
    if (!trainedOn(day)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

/**
 * The last `days` calendar days (oldest first, today last), each flagged
 * whether it had a workout — feeds a small "did I train" strip.
 */
export function recentTrainingDays(history = [], todaySets = 0, now = new Date(), days = 7) {
  const byDate = new Map(history.map(d => [d.date, d]));
  const out = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - i);
    const isToday = i === 0;
    const sets = isToday ? todaySets : Number(byDate.get(getTodayString(d))?.totalSets ?? 0);
    out.push({ date: getTodayString(d), trained: sets > 0, sets, isToday });
  }

  return out;
}
