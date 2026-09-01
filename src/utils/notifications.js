// The notification core: what can notify, what it says, and where tapping it
// goes. One layer above `notify.js`, which only knows how to talk to Android.
//
//     module          reminders / special days / supplements / bills / nudges
//        ↓            each adapted below into ONE item shape
//   this file         buildFeed(): merge, filter by settings, sort, de-duplicate
//        ↓
//     notify.js       diff against what the OS already holds, schedule/cancel
//        ↓
//   system alarm  →   tap  →  useNotificationTaps  →  navigate(item.route)
//
// WHY THIS FILE EXISTS AT ALL
// `buildFeed` used to live in upNext.js with the two sources INLINED — it
// imported reminders.js and specialDays.js and had a hand-written loop for
// each. That was fine for exactly as long as there were two. Adding a third
// meant editing the merge function, and a fourth meant editing it again, so
// every new notifying module was a change to shared code that every existing
// one depends on. The adapters below are the fix: a source is a function that
// returns items, and the merge does not know or care which sources exist.
//
// WHAT AN ITEM IS
// Everything below produces the same record, and it carries enough to be acted
// on without going back to the module that made it:
//
//   notifId     31-bit int, DERIVED FROM CONTENT (see occurrenceId)
//   source      which module — keys the colour, the icon and the settings switch
//   type        the sub-kind within that module ('due', 'lowstock', 'lunch'…)
//   sourceId    the entity it is about, or null for something like a nudge
//   title/body  exactly what the OS will show
//   emoji       for the in-app list, where an icon font would be heavier
//   at / date   when it fires
//   route       where a tap lands — the deep link, and the thing that was
//               scheduled-but-never-read before this file existed
//   recurrence  human text, or null when it happens once
//   done        whether the thing behind it is already dealt with
//
// SETTINGS ARE CHECKED HERE, NOT IN THE MODULES. A source switched off produces
// no items, so it is absent from the feed, so notify.js's diff cancels whatever
// it was already holding. Switching a source off therefore un-schedules it with
// no cancel call anywhere — the same mechanism that makes an edit work.

import { num } from './num.js';
import { todayStr, shiftDate, toHHMM } from './datetime.js';
import {
  nextOccurrences, describeRepeat, normalizeReminders, isOverdue,
} from './reminders.js';
import {
  notificationsFor, daysUntil, normalizeSpecialDays,
} from './specialDays.js';
import {
  normalizeSupplements, isScheduledOn, pendingTimes, isLowStock,
  describeDose, dosesRemaining, formMeta,
} from './supplements.js';
import { normalizeAllocation, dueDatesBetween, resolveAmount } from './recurring.js';
import { nudgeOccurrences, outstandingNudges, normalizeNudgeSettings, NUDGE_KINDS } from './nudges.js';

// --------------------------------------------------------------------------
// Identity
// --------------------------------------------------------------------------

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
 * THE CONTENT IS PART OF THE KEY, not just source+id+date. That is what makes
 * an EDIT work: rename a reminder and it hashes to a new id, so the stale alarm
 * falls out of the desired set and is cancelled while the new text is
 * scheduled. Keyed on identity alone, the OS would keep holding the old wording
 * and fire it — the edit would appear to save and then be silently ignored.
 *
 * FNV-1a, masked to 31 bits so it is always positive.
 *
 * Lives here rather than in upNext.js (where it started) because every adapter
 * below needs it and upNext.js is now just the dashboard's view of this file.
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

// --------------------------------------------------------------------------
// The source registry
// --------------------------------------------------------------------------

/**
 * Every module that is allowed to notify, and how it presents.
 *
 * `prefix` is the first component of every notification id from that source. It
 * MUST be unique and MUST stay stable: two sources sharing a prefix could hash
 * to the same int and cancel each other's alarms in the OS, and changing one
 * orphans every alarm already scheduled under the old value (they are cancelled
 * on the next sync, so it is survivable — but it is a needless round of churn).
 *
 * `route` is the deep-link destination. Before this registry existed, every
 * scheduled notification carried `extra: {kind, sourceId, date}` that NOTHING
 * read — see the comment it replaced in notify.js. This is what makes a tap go
 * somewhere.
 */
export const SOURCES = {
  reminder: {
    id: 'reminder', prefix: 'r',
    label: '提醒', emoji: '🔔',
    color: 'var(--color-remind)', soft: 'var(--color-remind-soft)',
    route: '/reminders',
    // A reminder is the reason the notification system exists; switching it
    // off would leave the module with nothing to do, so it has no switch.
    alwaysOn: true,
  },
  special: {
    id: 'special', prefix: 's',
    label: '特别的日子', emoji: '⭐',
    color: 'var(--color-special)', soft: 'var(--color-special-soft)',
    route: '/special',
    alwaysOn: true,
  },
  supplement: {
    id: 'supplement', prefix: 'p',
    label: '补充剂', emoji: '💊',
    color: 'var(--color-diet)', soft: 'var(--color-diet-soft)',
    route: '/diet/supplements',
  },
  bill: {
    id: 'bill', prefix: 'b',
    label: '账单到期', emoji: '💳',
    color: 'var(--color-money)', soft: 'var(--color-money-soft)',
    route: '/money/cycle',
  },
  nudge: {
    id: 'nudge', prefix: 'n',
    label: '记录提醒', emoji: '📋',
    color: 'var(--accent)', soft: 'var(--accent-soft)',
    route: '/dashboard',
  },
};

export const SOURCE_IDS = Object.keys(SOURCES);

export function sourceMeta(id) {
  return SOURCES[id] ?? {
    id: String(id), prefix: 'x', label: String(id), emoji: '🔔',
    color: 'var(--text-muted)', soft: 'var(--bg-input)', route: '/dashboard',
  };
}

// --------------------------------------------------------------------------
// Settings
// --------------------------------------------------------------------------

/** How many days before a bill lands to say something. */
export const DEFAULT_BILL_DAYS_BEFORE = 2;
export const DEFAULT_BILL_TIME = '09:00';

/**
 * Fill in every notification setting, on READ.
 *
 * MUST name every field — built object-by-object, so anything unnamed is
 * dropped on every read. Same trap as every other normalizer in this codebase.
 *
 * Defaults are deliberately conservative: the two sources that already existed
 * stay on, and everything added since is OFF until switched on. A version
 * upgrade that starts notifying about things the user never asked for is the
 * fastest way to have all notifications turned off at the OS level.
 */
export function normalizeNotificationSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    // The master switch. Off means the OS holds nothing at all — see
    // `cancelAllScheduled` in notify.js, which this finally gives a caller.
    enabled: s.enabled !== false,
    supplements: {
      enabled: Boolean(s.supplements?.enabled),
      // Stock warnings are a separate switch from dose reminders: wanting to be
      // told when the bottle is nearly empty is not the same as wanting a ping
      // every morning.
      lowStock: Boolean(s.supplements?.lowStock),
    },
    bills: {
      enabled: Boolean(s.bills?.enabled),
      daysBefore: s.bills?.daysBefore != null
        ? Math.max(0, Math.min(14, num(s.bills.daysBefore)))
        : DEFAULT_BILL_DAYS_BEFORE,
      time: toHHMM(s.bills?.time) ?? DEFAULT_BILL_TIME,
    },
    nudges: normalizeNudgeSettings(s.nudges),
  };
}

/** Is this source allowed to produce anything right now? */
export function sourceEnabled(settings, sourceId) {
  const s = normalizeNotificationSettings(settings);
  if (!s.enabled) return false;
  if (sourceMeta(sourceId).alwaysOn) return true;
  if (sourceId === 'supplement') return s.supplements.enabled || s.supplements.lowStock;
  if (sourceId === 'bill') return s.bills.enabled;
  if (sourceId === 'nudge') return Object.values(s.nudges).some(n => n.enabled);
  return false;
}

/**
 * Which sources the user can actually switch, for the settings screen.
 *
 * Excludes the always-on ones. A toggle that cannot be turned off is worse than
 * no toggle: it invites the one action it will not perform.
 */
export function switchableSources() {
  return SOURCE_IDS.filter(id => !SOURCES[id].alwaysOn).map(id => SOURCES[id]);
}

// --------------------------------------------------------------------------
// Adapters — one per source, all returning the same item shape
// --------------------------------------------------------------------------

function item(fields) {
  return {
    notifId: fields.notifId,
    source: fields.source,
    type: fields.type ?? 'due',
    sourceId: fields.sourceId ?? null,
    title: fields.title,
    body: fields.body,
    emoji: fields.emoji ?? sourceMeta(fields.source).emoji,
    at: fields.at,
    date: fields.date,
    route: fields.route ?? sourceMeta(fields.source).route,
    recurrence: fields.recurrence ?? null,
    done: Boolean(fields.done),
  };
}

function reminderItems({ reminders, now, horizonDays, perReminderLimit }) {
  const out = [];
  for (const r of normalizeReminders(reminders)) {
    for (const o of nextOccurrences(r, { now, horizonDays, limit: perReminderLimit })) {
      const title = r.title || '提醒';
      // The note if there is one, otherwise say what kind of repeat this is — a
      // bare 「提醒」 second line tells you nothing the title didn't.
      const body = r.note?.trim() || describeRepeat(r);
      out.push(item({
        notifId: occurrenceId(SOURCES.reminder.prefix, r.id, `${o.date}|${o.time}|${title}|${body}`),
        source: 'reminder',
        sourceId: r.id,
        title, body,
        at: o.at, date: o.date,
        route: `/reminders/${r.id}`,
        recurrence: r.repeat === 'once' ? null : describeRepeat(r),
      }));
    }
  }
  return out;
}

function specialItems({ specialDays, now, horizonDays }) {
  const out = [];
  for (const s of normalizeSpecialDays(specialDays)) {
    for (const o of notificationsFor(s, { now, horizonDays })) {
      const days = daysUntil(s, todayStr(new Date(o.at)));
      const title = `${s.emoji} ${s.title || '特别的日子'}`;
      // Counted from the day the notification LANDS, not from today — a
      // 1-week-before alert saying 「还有 30 天」 because it was scheduled a
      // month ago is worse than useless.
      const body = days === 0 ? '就是今天' : days === 1 ? '就是明天' : `还有 ${days} 天`;
      out.push(item({
        notifId: occurrenceId(SOURCES.special.prefix, s.id, `${o.date}|${o.at}|${title}|${body}`),
        source: 'special',
        sourceId: s.id,
        title, body, emoji: s.emoji,
        at: o.at, date: o.date,
        route: `/special/${s.id}`,
        recurrence: s.yearly ? '每年' : null,
      }));
    }
  }
  return out;
}

/**
 * Supplements, GROUPED BY TIME.
 *
 * Four products at 09:00 is ONE notification, not four. The brief asked for it
 * and it is also the difference between a feature that survives a week and one
 * that gets silenced: four buzzes sixty seconds apart is indistinguishable from
 * spam even when every one of them is individually correct.
 *
 * Grouping happens at the source, not at the OS, because the OS has no idea
 * these are related — and because the grouped notification's TEXT has to name
 * the products, which only this layer knows.
 */
function supplementItems({ supplements, supplementLog, now, horizonDays, settings }) {
  const s = normalizeNotificationSettings(settings);
  const list = normalizeSupplements(supplements).filter(x => x.active && x.remindEnabled);
  const out = [];
  const today = todayStr(new Date(now));

  if (s.supplements.enabled) {
    // Same three-day reasoning as nudges: whether a dose has been taken is a
    // fact about a day, and a 60-day window of "did you take this" would be 240
    // alarms nobody can answer yet. Today's is re-evaluated on every app open,
    // and ticking one off cancels its alarm through the ordinary diff.
    for (let offset = 0; offset < Math.min(horizonDays, 3); offset++) {
      const date = shiftDate(today, offset);
      const byTime = new Map();

      for (const sup of list) {
        if (!isScheduledOn(sup, date)) continue;
        // For today, only the times not already ticked off. For a future day
        // nothing is ticked, so every scheduled time counts.
        const times = date === today ? pendingTimes(sup, supplementLog, date) : sup.times;
        for (const time of times) {
          const group = byTime.get(time) ?? [];
          group.push(sup);
          byTime.set(time, group);
        }
      }

      for (const [time, group] of byTime) {
        const at = occurrenceAtLocal(date, time);
        if (at == null || at <= now) continue;
        const names = group.map(g => g.name).filter(Boolean);
        const single = group.length === 1;
        const title = single ? group[0].name : '补充剂';
        const body = single
          ? `${describeDose(group[0])} · 到时间了`
          : `${group.length} 个补充剂到时间了：${names.join('、')}`;
        out.push(item({
          notifId: occurrenceId(SOURCES.supplement.prefix, `dose|${time}`, `${date}|${names.join(',')}`),
          source: 'supplement',
          type: 'dose',
          // A group is about several things, so it points at the list rather
          // than at one of them; a single one goes straight to its card.
          sourceId: single ? group[0].id : null,
          title, body,
          at, date,
          route: single ? `/diet/supplements/${group[0].id}` : '/diet/supplements',
          recurrence: '每天',
        }));
      }
    }
  }

  // Stock warnings are not scheduled against a clock — they are true or not
  // true right now. Fired once, at tomorrow's first dose time, so it lands at a
  // moment the bottle is in your hand rather than at 3am.
  if (s.supplements.lowStock) {
    for (const sup of normalizeSupplements(supplements).filter(x => x.active)) {
      if (!isLowStock(sup)) continue;
      const left = dosesRemaining(sup);
      const date = shiftDate(today, 1);
      const at = occurrenceAtLocal(date, sup.times[0] ?? '09:00');
      if (at == null || at <= now) continue;
      out.push(item({
        notifId: occurrenceId(SOURCES.supplement.prefix, `low|${sup.id}`, `${date}|${left}`),
        source: 'supplement',
        type: 'lowstock',
        sourceId: sup.id,
        title: `${sup.name} 快没了`,
        body: `大概还够 ${left} 次（剩 ${sup.remainingQuantity} ${formMeta(sup.form).unit}）。`,
        at, date,
        route: `/diet/supplements/${sup.id}`,
      }));
    }
  }

  return out;
}

/**
 * Recurring bills, N days before they leave the account.
 *
 * The dates were ALREADY being computed — `dueDatesBetween` has existed in
 * recurring.js since the money overhaul and CycleView displays the result. The
 * only thing missing was anyone saying it out loud, which is why this adapter
 * is fifteen lines and not a feature.
 */
function billItems({ allocations, cycle, now, horizonDays, settings }) {
  const s = normalizeNotificationSettings(settings);
  if (!s.bills.enabled) return [];
  const today = todayStr(new Date(now));
  const until = shiftDate(today, horizonDays);
  const out = [];

  for (const raw of (Array.isArray(allocations) ? allocations : [])) {
    const a = normalizeAllocation(raw);
    if (!a.id) continue;
    const amount = cycle ? resolveAmount(a, cycle) : num(a.amount) || num(a.estimate);
    for (const due of dueDatesBetween(a, today, until)) {
      const warnDate = shiftDate(due, -s.bills.daysBefore);
      const at = occurrenceAtLocal(warnDate, s.bills.time);
      if (at == null || at <= now) continue;
      const when = s.bills.daysBefore === 0 ? '今天扣'
        : s.bills.daysBefore === 1 ? '明天扣'
          : `${s.bills.daysBefore} 天后扣`;
      out.push(item({
        notifId: occurrenceId(SOURCES.bill.prefix, a.id, `${due}|${amount}`),
        source: 'bill',
        sourceId: a.id,
        title: `${a.label} · RM ${amount.toFixed(2)}`,
        body: `${when}（${Number(due.split('-')[1])}月${Number(due.split('-')[2])}日）。`,
        at, date: warnDate,
        recurrence: null,
      }));
    }
  }
  return out;
}

function nudgeItems({ nudgeContext, now, settings }) {
  // NO CONTEXT MEANS NO CLAIM. A nudge asserts that something is not logged,
  // and a caller that didn't supply the day's meals and expenses has told us
  // nothing about whether it is. Treating a missing context as an empty one
  // would make every caller who only wanted reminders — the dashboard card,
  // any test — silently generate "you haven't logged lunch" out of thin air.
  if (!nudgeContext) return [];
  const s = normalizeNotificationSettings(settings);
  return nudgeOccurrences({ settings: s.nudges, context: nudgeContext, now }).map(n =>
    item({
      notifId: occurrenceId(SOURCES.nudge.prefix, n.kind, `${n.date}|${n.title}|${n.body}`),
      source: 'nudge',
      type: n.kind,
      sourceId: null,
      title: n.title,
      body: n.body,
      emoji: n.emoji,
      at: n.at,
      date: n.date,
      route: n.route,
      recurrence: '每天',
    })
  );
}

/** Local epoch ms for a YYYY-MM-DD + "HH:MM". Never Date.parse — that's UTC. */
function occurrenceAtLocal(dateStr, timeStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const hhmm = toHHMM(timeStr);
  if (!y || !m || !d || !hhmm) return null;
  const [hh, mi] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mi, 0, 0).getTime();
}

/** The adapters, in the order they are merged. Adding a source is one entry. */
const PROVIDERS = [
  { source: 'reminder',   build: reminderItems },
  { source: 'special',    build: specialItems },
  { source: 'supplement', build: supplementItems },
  { source: 'bill',       build: billItems },
  { source: 'nudge',      build: nudgeItems },
];

// --------------------------------------------------------------------------
// The feed
// --------------------------------------------------------------------------

/**
 * Everything due between `now` and the horizon, soonest first.
 *
 * ONE answer to "what is coming up", for both consumers: the dashboard card and
 * the OS scheduler. If each built its own list they would drift — the card
 * showing something the phone never announced, or the reverse.
 *
 * `perReminderLimit` stops one daily reminder filling the feed: a 60-day window
 * holds 60 of them, and 「吃药」×60 is neither a useful card nor worth 60 alarms.
 *
 * Never throws on a bad source. A single malformed record must cost its own
 * item, not the whole feed — losing every notification because one supplement
 * has a corrupt field is exactly the silent failure this app keeps designing
 * against.
 */
export function buildFeed({
  reminders = [], specialDays = [], supplements = [], supplementLog = [],
  allocations = [], cycle = null, nudgeContext = null, settings = null,
  now = Date.now(), horizonDays = 60, perReminderLimit = 4,
} = {}) {
  const resolved = normalizeNotificationSettings(settings);
  const ctx = {
    reminders, specialDays, supplements, supplementLog, allocations, cycle,
    nudgeContext, settings: resolved, now, horizonDays, perReminderLimit,
  };

  const out = [];
  for (const provider of PROVIDERS) {
    if (!sourceEnabled(resolved, provider.source)) continue;
    try {
      out.push(...provider.build(ctx));
    } catch (e) {
      console.warn(`notification source "${provider.source}" failed`, e);
    }
  }

  // Ties broken by id so the order is stable across renders — otherwise two
  // things at the same minute swap places on every re-render.
  return out
    .filter(x => Number.isFinite(x.at))
    .sort((a, b) => a.at - b.at || a.notifId - b.notifId);
}

// --------------------------------------------------------------------------
// The notification centre
// --------------------------------------------------------------------------

/**
 * The centre's three buckets.
 *
 * DERIVED, NOT STORED. There is no notification table, no read/unread flag and
 * no history — the brief said not to build a feed, and a stored copy would be a
 * second source of truth that goes stale the moment a reminder is edited on
 * another device. Everything here is computed from the same records the
 * scheduler reads, so the screen and the phone can never disagree.
 *
 * `attention` is the one bucket that does NOT come from the alarm feed: an
 * overdue reminder's moment has passed, so it has no future occurrence and is
 * absent from `buildFeed` by construction. That is correct for scheduling and
 * wrong for a screen answering "what do I need to do", which is the whole
 * reason those two lists are computed separately.
 */
export function centerGroups({
  feed = [], reminders = [], supplements = [], supplementLog = [],
  nudgeContext = null, settings = null, liveAlerts = [], now = Date.now(),
} = {}) {
  const resolved = normalizeNotificationSettings(settings);
  const today = todayStr(new Date(now));
  const attention = [];

  // Live in-app conditions — over the calorie limit, over budget, rest done.
  // These used to live in an English-only dropdown in the header with no route
  // and no relationship to anything else that notifies.
  for (const a of liveAlerts) {
    attention.push({
      key: `live:${a.id}`,
      source: 'nudge',
      type: 'live',
      emoji: a.tone === 'bad' ? '🚨' : a.tone === 'warn' ? '⚠️' : '✅',
      title: a.text,
      body: '',
      route: a.route ?? '/dashboard',
      at: now,
      tone: a.tone,
    });
  }

  // One-off reminders whose time has been and gone without being ticked.
  for (const r of normalizeReminders(reminders)) {
    if (!isOverdue(r, now)) continue;
    attention.push({
      key: `reminder:${r.id}`,
      source: 'reminder',
      type: 'overdue',
      emoji: '🔔',
      title: r.title || '提醒',
      body: r.note?.trim() || '已经过期了',
      route: `/reminders/${r.id}`,
      at: now,
      tone: 'bad',
      // The centre can tick this off without opening the module — the one
      // action worth having here, because "I have already done that" is the
      // most common response to an overdue item.
      action: { kind: 'completeReminder', id: r.id },
    });
  }

  // Today's doses whose time has passed and that are still not ticked.
  if (resolved.supplements.enabled) {
    for (const sup of normalizeSupplements(supplements)) {
      if (!sup.active || !isScheduledOn(sup, today)) continue;
      for (const time of pendingTimes(sup, supplementLog, today)) {
        const at = occurrenceAtLocal(today, time);
        if (at == null || at > now) continue;
        attention.push({
          key: `supplement:${sup.id}:${time}`,
          source: 'supplement',
          type: 'missed',
          emoji: '💊',
          title: sup.name,
          body: `${time} 的 ${describeDose(sup)} 还没吃`,
          route: `/diet/supplements/${sup.id}`,
          at,
          tone: 'warn',
          action: { kind: 'takeSupplement', id: sup.id, time },
        });
      }
    }
  }

  // Low stock is a standing condition, so it belongs here whether or not the
  // OS notification for it is switched on — the screen is where you look.
  for (const sup of normalizeSupplements(supplements)) {
    if (!sup.active || !isLowStock(sup)) continue;
    attention.push({
      key: `supplement-low:${sup.id}`,
      source: 'supplement',
      type: 'lowstock',
      emoji: '📦',
      title: `${sup.name} 快没了`,
      body: `大概还够 ${dosesRemaining(sup)} 次`,
      route: `/diet/supplements/${sup.id}`,
      at: now,
      tone: 'warn',
    });
  }

  // Nudges whose moment has passed and that are still unsatisfied.
  for (const n of outstandingNudges({ settings: resolved.nudges, context: nudgeContext, now })) {
    attention.push({
      key: `nudge:${n.kind}`,
      source: 'nudge',
      type: n.kind,
      emoji: n.emoji,
      title: n.title,
      body: n.body,
      route: n.route,
      at: n.at,
      tone: 'warn',
    });
  }

  // The scheduled feed, split at the end of today.
  const rows = feed.map(f => ({
    key: `${f.source}:${f.notifId}`,
    source: f.source,
    type: f.type,
    emoji: f.emoji,
    title: f.title,
    body: f.body,
    route: f.route,
    at: f.at,
    recurrence: f.recurrence,
    tone: 'info',
  }));

  const todayRows = rows.filter(r => todayStr(new Date(r.at)) === today);
  const upcomingRows = rows.filter(r => todayStr(new Date(r.at)) !== today);

  // 接下来 is de-duplicated against EVERYTHING ABOVE IT, not just within itself.
  //
  // Everything daily — the three logging nudges, a supplement group, 吃药 —
  // has an occurrence today AND one tomorrow AND one the day after. Listed
  // plainly, three real things fill the screen with six or nine rows saying the
  // same words, and a list that repeats itself is one you stop reading. Each
  // row already carries 「每天」, which says the repeat far better than printing
  // it again under tomorrow's date.
  //
  // Attention rows count too: a supplement you missed this morning does not
  // also need a line at the bottom telling you the next one is tomorrow. It is
  // the same daily supplement, already on the screen, already in red.
  //
  // So 接下来 means "things not already accounted for above", and the soonest
  // instance of anything is the one kept.
  const seen = new Set([
    ...attention.map(r => `${r.source}:${r.title}`),
    ...todayRows.map(r => `${r.source}:${r.title}`),
  ]);

  return {
    attention: attention.sort((a, b) => b.at - a.at),
    today: todayRows,
    upcoming: upcomingRows.filter(r => {
      const key = `${r.source}:${r.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 12),
  };
}

/** The number on the bell. Only 需要注意 counts — an upcoming item is not a
 *  task, and a badge that is never zero is not a badge. */
export function attentionCount(groups) {
  return groups?.attention?.length ?? 0;
}

export { NUDGE_KINDS };
