// One merged feed of "what is coming up", from reminders and special days.
//
// It exists so there is exactly ONE answer to that question. The dashboard's
// UP NEXT card and the OS notification scheduler are the same question asked
// by two different consumers, and if each built its own list they would drift:
// the card would show something the phone never announced, or the other way
// round. Both read this.
//
// Pure — `now` is an argument, nothing here touches storage or Capacitor.

import {
  nextOccurrences, describeRepeat, describeWhen, normalizeReminders,
} from './reminders.js';
import {
  notificationsFor, nextDate, daysUntil, describeCountdown, normalizeSpecialDays,
} from './specialDays.js';
import { todayStr } from './datetime.js';

/**
 * A stable 31-bit id for one occurrence, derived from what it IS.
 *
 * Android notification ids are Java ints, so a millisecond timestamp won't fit
 * and a random id can't be recomputed. Deriving it from what the notification
 * says means the scheduler can compare against what the OS already holds and
 * act on the difference, instead of cancelling everything and re-scheduling on
 * every app open — which on a phone opened a dozen times a day is a lot of
 * alarm churn for no change.
 *
 * THE CONTENT IS PART OF THE KEY, not just kind+id+date. That is what makes an
 * EDIT work: rename a reminder and it hashes to a new id, so the stale alarm
 * falls out of the desired set and is cancelled while the new text is
 * scheduled. Keyed on identity alone, the OS would keep holding the old wording
 * and fire it — the edit would appear to save and then be silently ignored.
 *
 * FNV-1a, masked to 31 bits so it is always positive.
 */
export function occurrenceId(kind, sourceId, dateKey) {
  const s = `${kind}:${sourceId}:${dateKey}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 0x7fffffff;
}

/**
 * Everything due between `now` and the horizon, soonest first.
 *
 * `perReminderLimit` stops one daily reminder from filling the entire feed:
 * a 60-day window contains 60 of them, and "wake up" ×60 is not what the
 * dashboard's next-three should be showing, nor worth 60 OS alarms.
 *
 * @returns {{
 *   notifId: number, kind: 'reminder'|'special', sourceId: any,
 *   title: string, body: string, emoji: string, at: number, date: string,
 * }[]}
 */
export function buildFeed({
  reminders = [], specialDays = [], now = Date.now(),
  horizonDays = 60, perReminderLimit = 4,
} = {}) {
  const out = [];
  const today = todayStr(new Date(now));

  for (const raw of normalizeReminders(reminders)) {
    const occurrences = nextOccurrences(raw, { now, horizonDays, limit: perReminderLimit });
    for (const o of occurrences) {
      const title = raw.title || '提醒';
      // The note if there is one, otherwise say what kind of repeat this is — a
      // bare "提醒" notification with no second line tells you nothing you
      // didn't already know from the title.
      const body = raw.note?.trim() || describeRepeat(raw);
      out.push({
        notifId: occurrenceId('r', raw.id, `${o.date}|${o.time}|${title}|${body}`),
        kind: 'reminder',
        sourceId: raw.id,
        title,
        body,
        emoji: '🔔',
        at: o.at,
        date: o.date,
      });
    }
  }

  for (const raw of normalizeSpecialDays(specialDays)) {
    for (const o of notificationsFor(raw, { now, horizonDays })) {
      const days = daysUntil(raw, todayStr(new Date(o.at)));
      const title = `${raw.emoji} ${raw.title || '特别的日子'}`;
      // Counted from the day the notification LANDS, not from today — a
      // 1-week-before alert that says "还有 30 天" because it was scheduled a
      // month ago is worse than useless.
      const body = days === 0 ? '就是今天' : days === 1 ? '就是明天' : `还有 ${days} 天`;
      out.push({
        notifId: occurrenceId('s', raw.id, `${o.date}|${o.at}|${title}|${body}`),
        kind: 'special',
        sourceId: raw.id,
        title,
        body,
        emoji: raw.emoji,
        at: o.at,
        date: o.date,
      });
    }
  }

  // Ties broken by id so the order is stable across renders — otherwise two
  // things at the same minute swap places on every re-render.
  return out
    .sort((a, b) => a.at - b.at || a.notifId - b.notifId)
    .map(item => ({ ...item, today }));
}

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
      kind: 'special',
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
    }));
}

/**
 * The dashboard's compact list: the soonest few things of either kind.
 *
 * At most one row per source, so a daily reminder can't take all three slots —
 * "倒垃圾, 倒垃圾, 倒垃圾" is a worse card than no card.
 */
export function upNextRows({ reminders = [], specialDays = [], now = Date.now(), limit = 3 } = {}) {
  const seen = new Set();
  const rows = [];

  for (const item of buildFeed({ reminders, specialDays: [], now, horizonDays: 60, perReminderLimit: 1 })) {
    if (seen.has(item.sourceId)) continue;
    seen.add(item.sourceId);
    rows.push({
      kind: 'reminder',
      sourceId: item.sourceId,
      title: item.title,
      emoji: '🔔',
      date: item.date,
      sortAt: item.at,
      when: describeWhen(item.at, now),
      detail: '',
    });
  }

  rows.push(...upcomingSpecialDays(specialDays, { now, withinDays: 60, limit }));

  return rows.sort((a, b) => a.sortAt - b.sortAt).slice(0, limit);
}
