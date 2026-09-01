// 「今天还没记账」「午餐还没记录」 — the nudges that keep the log honest.
//
// A DIFFERENT ANIMAL FROM A REMINDER, and worth saying why it isn't just one.
// A reminder fires because a time arrived. A nudge fires because a time arrived
// AND something still hasn't been written down — it is a question about the
// data, not about the calendar. Modelling it as a reminder would mean an alarm
// that goes off at 21:00 telling you to log dinner you logged at 19:00, which is
// exactly the kind of notification that teaches you to swipe them all away.
//
// HOW IT AVOIDS THAT, WITHOUT ANY NEW MACHINERY
// The condition is evaluated when the feed is BUILT, and the feed is rebuilt on
// every data change and every app resume (App.jsx). So:
//
//   · nothing logged  → the nudge is in the feed → the OS holds the alarm
//   · you log dinner  → the feed is rebuilt without it → notify.js sees a
//                       pending alarm not in the desired set → cancels it
//
// That is the same content-derived diff that already makes editing a reminder
// work. No "cancel this specific notification" call, no bookkeeping, no way for
// the two to get out of step. The whole feature is a predicate.
//
// WHY THE HORIZON IS THREE DAYS AND NOT SIXTY
// A nudge is a claim about whether something is logged, and nothing can be
// known about a day that hasn't happened. Sixty days of "you haven't logged
// lunch" would also be 240 alarms against a 48-alarm budget, starving every
// real reminder. Three days is enough slack for a phone left untouched over a
// weekend, and today's is re-evaluated every time the app opens.
//
// Pure — `scripts/test-nudges.mjs` runs it in Node with hand-built days.

import { todayStr, shiftDate, toHHMM } from './datetime.js';
import { occurrenceAt } from './reminders.js';

/**
 * The nudges that exist, in the order they read on a settings screen.
 *
 * `check` answers "is this already satisfied for that date?" — true means say
 * nothing. Each one is deliberately cheap and total: it is called once per
 * nudge per day of the horizon, on every feed build, on every keystroke that
 * changes a meal.
 */
export const NUDGE_KINDS = [
  {
    id: 'breakfast',
    label: '早餐没记录',
    emoji: '🍳',
    defaultTime: '10:00',
    // Off by default. Three meal nudges a day is a lot of phone, and this is
    // the meal people most often skip on purpose.
    defaultOn: false,
    title: '早餐还没记录',
    body: '今天的早餐还没写进饮食里。',
    route: '/diet',
    satisfied: (ctx, date) => hasMeal(ctx, date, 'Breakfast'),
  },
  {
    id: 'lunch',
    label: '午餐没记录',
    emoji: '🍜',
    // After the lunch window has closed (DietModule treats <15:00 as lunch),
    // so it can never fire while you are still eating.
    defaultTime: '14:30',
    defaultOn: true,
    title: '午餐还没记录',
    body: '今天的午餐还没写进饮食里。',
    route: '/diet',
    satisfied: (ctx, date) => hasMeal(ctx, date, 'Lunch'),
  },
  {
    id: 'dinner',
    label: '晚餐没记录',
    emoji: '🍚',
    defaultTime: '20:30',
    defaultOn: true,
    title: '晚餐还没记录',
    body: '今天的晚餐还没写进饮食里。',
    route: '/diet',
    satisfied: (ctx, date) => hasMeal(ctx, date, 'Dinner'),
  },
  {
    id: 'money',
    label: '今天没记账',
    emoji: '💰',
    // Late enough that a normal day's spending has happened, early enough to
    // still do something about it.
    defaultTime: '21:30',
    defaultOn: true,
    title: '今天还没记账',
    body: '今天一笔都没记。',
    route: '/money',
    satisfied: (ctx, date) => countExpenses(ctx, date) > 0 && pendingReview(ctx) === 0,
    /**
     * The money nudge says something different when the auto-capture queue has
     * unconfirmed payments in it.
     *
     * THIS IS AS CLOSE AS THE APP CAN HONESTLY GET to 「有新的通知进来了」. The
     * TNG listener is native and queues while the WebView is asleep; the JS that
     * would post a notification is not running at the moment a payment lands, so
     * there is no way to announce it as it happens (and keeping the app alive to
     * try was tried and abandoned — see MILESTONES). What it CAN do is tell you
     * at a fixed time each day that captures are sitting there waiting.
     */
    describe: (ctx, date) => {
      const waiting = pendingReview(ctx);
      if (waiting > 0) {
        return {
          title: '有待确认的支付',
          body: countExpenses(ctx, date) > 0
            ? `自动记录到 ${waiting} 笔，还没确认。`
            : `自动记录到 ${waiting} 笔，还没确认；今天也还没手动记账。`,
        };
      }
      return null;
    },
  },
];

export const NUDGE_IDS = NUDGE_KINDS.map(n => n.id);

export function nudgeMeta(id) {
  return NUDGE_KINDS.find(n => n.id === id) ?? null;
}

/** How far ahead nudges are scheduled. See the header for why it isn't 60. */
export const NUDGE_HORIZON_DAYS = 3;

function hasMeal(ctx, date, category) {
  return (ctx?.meals ?? []).some(
    m => (m?.date ?? null) === date && m?.category === category
  );
}

function countExpenses(ctx, date) {
  return (ctx?.expenses ?? []).filter(e => (e?.date ?? null) === date).length;
}

function pendingReview(ctx) {
  return Number(ctx?.reviewQueueCount) || 0;
}

/**
 * Fill in every nudge setting, on READ.
 *
 * Same field-by-field rule as every other normalizer here: an unnamed field is
 * dropped on every read. Unknown ids are discarded rather than carried, so a
 * nudge removed from the code above can't leave an orphan switch behind.
 */
export function normalizeNudgeSettings(raw) {
  const out = {};
  for (const kind of NUDGE_KINDS) {
    const stored = raw && typeof raw === 'object' ? raw[kind.id] : null;
    out[kind.id] = {
      enabled: stored?.enabled != null ? Boolean(stored.enabled) : kind.defaultOn,
      time: toHHMM(stored?.time) ?? kind.defaultTime,
    };
  }
  return out;
}

/**
 * Every nudge that should fire between now and the horizon.
 *
 * @param {object}   opts
 * @param {object}   opts.settings  normalized nudge settings
 * @param {object}   opts.context   { meals, expenses, reviewQueueCount }
 * @param {number}   opts.now       epoch ms
 * @returns {{kind: string, date: string, at: number, title: string, body: string, emoji: string, route: string}[]}
 */
export function nudgeOccurrences({ settings, context = {}, now = Date.now(), horizonDays = NUDGE_HORIZON_DAYS } = {}) {
  const config = normalizeNudgeSettings(settings);
  const today = todayStr(new Date(now));
  const out = [];

  for (let offset = 0; offset < Math.max(1, horizonDays); offset++) {
    const date = shiftDate(today, offset);
    for (const kind of NUDGE_KINDS) {
      const conf = config[kind.id];
      if (!conf.enabled) continue;

      // Only TODAY can be satisfied — nothing is logged for a day that hasn't
      // started, so a future nudge is always scheduled and then cancelled on
      // the day if it turns out to be unnecessary. See the header.
      if (date === today && kind.satisfied(context, date)) continue;

      const at = occurrenceAt(date, conf.time);
      if (at == null || at <= now) continue;

      // A nudge whose wording depends on the data — currently only 记账, which
      // says something different when captures are waiting.
      const override = date === today && kind.describe ? kind.describe(context, date) : null;

      out.push({
        kind: kind.id,
        date,
        at,
        title: override?.title ?? kind.title,
        body: override?.body ?? kind.body,
        emoji: kind.emoji,
        route: kind.route,
      });
    }
  }

  return out.sort((a, b) => a.at - b.at);
}

/**
 * What is outstanding RIGHT NOW, for the notification centre.
 *
 * Not the same question as `nudgeOccurrences`, which is about alarms still
 * ahead: by 22:00 the dinner nudge's moment has passed, the OS has already said
 * it, and the thing is still not logged. That belongs under 需要注意 on the
 * centre screen, and would be invisible if the screen only read the alarm feed.
 */
export function outstandingNudges({ settings, context = {}, now = Date.now() } = {}) {
  const config = normalizeNudgeSettings(settings);
  const today = todayStr(new Date(now));
  const out = [];

  for (const kind of NUDGE_KINDS) {
    const conf = config[kind.id];
    if (!conf.enabled) continue;
    if (kind.satisfied(context, today)) continue;
    const at = occurrenceAt(today, conf.time);
    // Only once its moment has actually arrived. Before that it is simply
    // "later today", which the 接下来 section already covers.
    if (at == null || at > now) continue;
    const override = kind.describe ? kind.describe(context, today) : null;
    out.push({
      kind: kind.id,
      date: today,
      at,
      title: override?.title ?? kind.title,
      body: override?.body ?? kind.body,
      emoji: kind.emoji,
      route: kind.route,
    });
  }

  return out.sort((a, b) => a.at - b.at);
}
