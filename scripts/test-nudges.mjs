// The logging nudges: "今天还没记账", "午餐还没记录".
//
// The property that matters most is a NEGATIVE one — a nudge must never fire
// for something already logged. That is not enforced by a cancel call anywhere;
// it falls out of the predicate being re-evaluated on every feed build (see the
// header of nudges.js). So most of what is checked here is absence.

import {
  NUDGE_KINDS, normalizeNudgeSettings, nudgeOccurrences, outstandingNudges,
  NUDGE_HORIZON_DAYS, nudgeMeta,
} from '../src/utils/nudges.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// Wed 2 Sep 2026, 12:00 — before lunch's 14:30 and dinner's 20:30.
const NOON = new Date(2026, 8, 2, 12, 0).getTime();
const LATE = new Date(2026, 8, 2, 22, 0).getTime();   // after every nudge time
const TODAY = '2026-09-02';

const meal = (category, date = TODAY) => ({ date, category, calories: 500 });
const spend = (date = TODAY) => ({ date, amount: 12 });
const kinds = (list) => list.filter(n => n.date === TODAY).map(n => n.kind).sort();

// --- settings ------------------------------------------------------------------
const defaults = normalizeNudgeSettings(null);
check('the three the user asked for are on by default',
  Object.entries(defaults).filter(([, v]) => v.enabled).map(([k]) => k).sort(),
  ['dinner', 'lunch', 'money']);
// Three meal nudges a day is a lot of phone, and breakfast is the one most
// often skipped on purpose.
check('breakfast is off by default', defaults.breakfast.enabled, false);
check('each has a default time', defaults.lunch.time, '14:30');
check('a stored time survives normalization',
  normalizeNudgeSettings({ lunch: { enabled: true, time: '13:00' } }).lunch.time, '13:00');
check('a garbage time falls back to the default',
  normalizeNudgeSettings({ lunch: { time: 'nonsense' } }).lunch.time, '14:30');
// An id removed from the code must not leave an orphan switch behind.
check('an unknown nudge id is discarded',
  'gymTime' in normalizeNudgeSettings({ gymTime: { enabled: true } }), false);
check('every kind declares a route to open', NUDGE_KINDS.every(k => k.route?.startsWith('/')), true);

// --- the negative property ------------------------------------------------------
const nothingLogged = { meals: [], expenses: [], reviewQueueCount: 0 };

check('with nothing logged, today gets all three',
  kinds(nudgeOccurrences({ settings: defaults, context: nothingLogged, now: NOON })),
  ['dinner', 'lunch', 'money']);

check('logging lunch removes the lunch nudge',
  kinds(nudgeOccurrences({
    settings: defaults, context: { ...nothingLogged, meals: [meal('Lunch')] }, now: NOON,
  })),
  ['dinner', 'money']);

check('logging an expense removes the money nudge',
  kinds(nudgeOccurrences({
    settings: defaults, context: { ...nothingLogged, expenses: [spend()] }, now: NOON,
  })),
  ['dinner', 'lunch']);

check('logging everything leaves nothing to say today',
  kinds(nudgeOccurrences({
    settings: defaults,
    context: { meals: [meal('Lunch'), meal('Dinner')], expenses: [spend()], reviewQueueCount: 0 },
    now: NOON,
  })),
  []);

// The wrong meal is not the right meal.
check('breakfast does not satisfy the lunch nudge',
  kinds(nudgeOccurrences({
    settings: defaults, context: { ...nothingLogged, meals: [meal('Breakfast')] }, now: NOON,
  })),
  ['dinner', 'lunch', 'money']);

// Yesterday's dinner is not today's.
check('yesterday\'s meal does not satisfy today',
  kinds(nudgeOccurrences({
    settings: defaults, context: { ...nothingLogged, meals: [meal('Lunch', '2026-09-01')] }, now: NOON,
  })),
  ['dinner', 'lunch', 'money']);

check('a switched-off nudge produces nothing',
  kinds(nudgeOccurrences({
    settings: { ...defaults, lunch: { enabled: false, time: '14:30' } },
    context: nothingLogged, now: NOON,
  })),
  ['dinner', 'money']);

// --- timing ----------------------------------------------------------------------
// A moment that has already passed is not scheduled; the OS has either already
// said it or the app was closed. `outstandingNudges` is what covers that case.
check('a nudge whose time has passed is not scheduled again today',
  kinds(nudgeOccurrences({ settings: defaults, context: nothingLogged, now: LATE })),
  []);
check('...but it is still outstanding on the screen',
  outstandingNudges({ settings: defaults, context: nothingLogged, now: LATE }).map(n => n.kind).sort(),
  ['dinner', 'lunch', 'money']);
check('nothing is outstanding before its time arrives',
  outstandingNudges({ settings: defaults, context: nothingLogged, now: NOON }), []);
check('an outstanding nudge disappears once the thing is logged',
  outstandingNudges({
    settings: defaults,
    context: { meals: [meal('Lunch'), meal('Dinner')], expenses: [spend()], reviewQueueCount: 0 },
    now: LATE,
  }), []);

// --- the horizon -------------------------------------------------------------------
// Whether something is logged is a fact about a day, and nothing can be known
// about a day that hasn't happened. Sixty days of it would also be 240 alarms
// against a 48-alarm budget.
const ahead = nudgeOccurrences({ settings: defaults, context: nothingLogged, now: NOON });
check('the horizon is three days, not sixty',
  [...new Set(ahead.map(n => n.date))], ['2026-09-02', '2026-09-03', '2026-09-04']);
check('...which is what NUDGE_HORIZON_DAYS says', NUDGE_HORIZON_DAYS, 3);
// A future day is always scheduled — nothing is logged for it yet — and then
// cancelled on the day if it turns out to be unnecessary.
check('tomorrow is scheduled even though today is fully logged',
  nudgeOccurrences({
    settings: defaults,
    context: { meals: [meal('Lunch'), meal('Dinner')], expenses: [spend()], reviewQueueCount: 0 },
    now: NOON,
  }).every(n => n.date > TODAY), true);
check('everything is in time order',
  ahead.map(n => n.at).every((v, i, a) => i === 0 || a[i - 1] <= v), true);

// --- 「有新的通知进来了」 ------------------------------------------------------------
// The closest this app can honestly get: the native TNG listener queues while
// the WebView is asleep, so nothing can be announced as a payment lands. What
// CAN be said is that captures are sitting there unconfirmed.
const withQueue = { meals: [], expenses: [spend()], reviewQueueCount: 3 };
const queueNudge = nudgeOccurrences({ settings: defaults, context: withQueue, now: NOON })
  .find(n => n.kind === 'money' && n.date === TODAY);
check('an unconfirmed capture keeps the money nudge alive even after logging',
  Boolean(queueNudge), true);
check('...and it says how many are waiting', queueNudge.title, '有待确认的支付');
check('...counting them', queueNudge.body, '自动记录到 3 笔，还没确认。');
check('...and says both things when nothing was logged either',
  nudgeOccurrences({
    settings: defaults, context: { meals: [], expenses: [], reviewQueueCount: 2 }, now: NOON,
  }).find(n => n.kind === 'money' && n.date === TODAY).body,
  '自动记录到 2 笔，还没确认；今天也还没手动记账。');
// Filtered to TODAY on purpose: tomorrow's money nudge is always scheduled,
// because nothing is logged for a day that hasn't started. Asserting over the
// whole list would be asserting that the horizon doesn't exist.
check('an empty queue with an expense logged says nothing today',
  kinds(nudgeOccurrences({
    settings: defaults, context: { meals: [], expenses: [spend()], reviewQueueCount: 0 }, now: NOON,
  })).includes('money'), false);

check('nudgeMeta finds a kind', nudgeMeta('lunch').label, '午餐没记录');
check('...and returns null for one that does not exist', nudgeMeta('nope'), null);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
