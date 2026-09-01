// The dashboard's view of what's coming up.
//
// WHAT MOVED, AND WHY
// This file used to own `buildFeed` and `occurrenceId` as well, with the two
// notification sources INLINED — a hand-written loop for reminders and another
// for special days. Both are now in notifications.js, because a merge function
// that names its sources has to be edited every time one is added, and there
// are five of them now.
//
// What is left here is the part that was always view logic rather than
// notification logic: the dashboard's UP NEXT card wants at most three rows,
// one per source, mixing things that notify with things that don't. That is a
// different question from "what alarms should the OS hold", and the difference
// is the whole reason `upcomingSpecialDays` exists — see its comment.
//
// Pure — `now` is an argument, nothing here touches storage or Capacitor.

import { describeWhen } from './reminders.js';
import {
  nextDate, daysUntil, describeCountdown, normalizeSpecialDays,
} from './specialDays.js';
import { todayStr } from './datetime.js';
import { buildFeed } from './notifications.js';

/** Local midnight at the start of a YYYY-MM-DD. Never Date.parse — that's UTC. */
function midnightOf(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/**
 * Special days that are coming up, WHETHER OR NOT they notify.
 *
 * `buildFeed` is driven by notifications, because that is what the scheduler
 * needs — and a special day set to 不提醒 produces none at all. But "what's
 * coming up" and "what will ping me" are different questions, and a birthday
 * you chose not to be pinged about is still coming up. So the dashboard reads
 * this instead of filtering the notification feed.
 */
export function upcomingSpecialDays(specialDays, { now = Date.now(), withinDays = 60, limit = 5 } = {}) {
  const today = todayStr(new Date(now));
  return normalizeSpecialDays(specialDays)
    .map(s => ({ s, days: daysUntil(s, today), date: nextDate(s, today) }))
    .filter(x => x.days != null && x.days <= withinDays)
    .sort((a, b) => a.days - b.days)
    .slice(0, limit)
    .map(({ s, days, date }) => ({
      source: 'special',
      sourceId: s.id,
      title: s.title || '特别的日子',
      emoji: s.emoji,
      date,
      days,
      // Sorted against reminders below on a common scale. Midnight, because a
      // whole-day event has no clock time and putting it at 09:00 would push it
      // behind a breakfast reminder on the same day for no reason.
      sortAt: midnightOf(date),
      when: `${Number(date.split('-')[1])}月${Number(date.split('-')[2])}日`,
      detail: describeCountdown(s, today),
      route: `/special/${s.id}`,
    }));
}

/**
 * The dashboard's compact list: the soonest few things of either kind.
 *
 * At most one row per source item, so a daily reminder can't take all three
 * slots — 「倒垃圾, 倒垃圾, 倒垃圾」 is a worse card than no card.
 *
 * Deliberately still only reminders and special days, not the full five-source
 * feed. The card is three rows on the densest screen in the app; adding
 * supplement doses and bill warnings to it would turn a glance into a list, and
 * the notification centre is now the place that shows everything.
 */
export function upNextRows({ reminders = [], specialDays = [], now = Date.now(), limit = 3 } = {}) {
  const seen = new Set();
  const rows = [];

  const feed = buildFeed({
    reminders, specialDays: [], now, horizonDays: 60, perReminderLimit: 1,
    // Only the two always-on sources are wanted here, and both ignore settings.
    settings: null,
  });

  for (const it of feed) {
    if (it.source !== 'reminder') continue;
    if (seen.has(it.sourceId)) continue;
    seen.add(it.sourceId);
    rows.push({
      source: 'reminder',
      sourceId: it.sourceId,
      title: it.title,
      emoji: '🔔',
      date: it.date,
      sortAt: it.at,
      when: describeWhen(it.at, now),
      detail: '',
      route: it.route,
    });
  }

  rows.push(...upcomingSpecialDays(specialDays, { now, withinDays: 60, limit }));

  return rows.sort((a, b) => a.sortAt - b.sortAt).slice(0, limit);
}

// Re-exported so `buildFeed` and the feed's identity function have exactly one
// definition, in notifications.js, while the handful of existing importers of
// this path keep working. Not a compatibility shim to be removed later — the
// dashboard genuinely needs the feed, and importing it through the module it
// already imports is one import instead of two.
export { buildFeed, occurrenceId } from './notifications.js';
