// The notification core: the source registry, the settings gate, the merge,
// and the notification centre's buckets.
//
// The properties worth guarding here are the ones that were BROKEN or absent
// before this file's subject existed:
//   · a new source must be off until switched on (an upgrade must not buzz)
//   · switching a source off must remove it from the feed, because that — not a
//     cancel call — is how its alarms get cancelled
//   · every item must carry a route, because the payload used to be written and
//     never read
//   · supplements at the same time must be ONE notification, not four

import {
  SOURCES, SOURCE_IDS, sourceMeta, switchableSources, occurrenceId,
  normalizeNotificationSettings, sourceEnabled, buildFeed, centerGroups,
  attentionCount,
} from '../src/utils/notifications.js';
import { buildSeedSupplements } from '../src/utils/supplementSeeds.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// Wed 2 Sep 2026, 10:00.
const NOW = new Date(2026, 8, 2, 10, 0).getTime();
const TODAY = '2026-09-02';

const reminders = [
  { id: 11, title: '交文件', startDate: '2026-09-03', time: '20:00', repeat: 'once' },
  { id: 12, title: '吃药', startDate: '2026-01-01', time: '18:00', repeat: 'daily' },
];
const specialDays = [
  { id: 21, title: '朋友生日', emoji: '🎂', date: '2000-09-05', remind: 'day', remindTime: '09:00' },
];
const allocations = [
  { id: 31, label: 'Astro', amount: 89, frequency: 'monthly', dueDay: 15 },
];
const nudgeContext = { meals: [], expenses: [], reviewQueueCount: 0 };

// Four supplements, three of them sharing 09:00 — the grouping case.
const supplements = [
  { id: 41, name: '鱼油', form: 'softgel', unitsPerDose: 1, perUnit: { epa: 185 }, times: ['09:00'], remindEnabled: true },
  { id: 42, name: '综合维他命', form: 'tablet', unitsPerDose: 1, perUnit: { vitaminC: 50 }, times: ['09:00'], remindEnabled: true },
  { id: 43, name: '肌酸', form: 'spoon', unitsPerDose: 1, perUnit: { creatine: 2.5 }, times: ['09:00'], remindEnabled: true },
  { id: 44, name: '钙镁锌铜', form: 'caplet', unitsPerDose: 3, perUnit: { zinc: 5 }, times: ['21:00'], remindEnabled: true },
];

const ON = {
  supplements: { enabled: true, lowStock: true },
  bills: { enabled: true, daysBefore: 2, time: '09:00' },
};

// --- the registry -----------------------------------------------------------
check('every source has a unique id prefix',
  new Set(SOURCE_IDS.map(id => SOURCES[id].prefix)).size, SOURCE_IDS.length);
check('every source declares a route', SOURCE_IDS.every(id => SOURCES[id].route.startsWith('/')), true);
check('every source has a colour and an emoji',
  SOURCE_IDS.every(id => SOURCES[id].color && SOURCES[id].emoji), true);
check('an unknown source still resolves rather than throwing', sourceMeta('nope').label, 'nope');
// A switch that cannot be switched is worse than no switch.
check('only the non-always-on sources get a toggle',
  switchableSources().map(s => s.id), ['supplement', 'bill', 'nudge']);

// --- ids --------------------------------------------------------------------
const id = occurrenceId('r', 11, '2026-09-03');
check('an id is a positive 31-bit int', id > 0 && id < 0x7fffffff && Number.isInteger(id), true);
check('the same occurrence always gets the same id', occurrenceId('r', 11, '2026-09-03'), id);
// Without the prefix, a reminder and a supplement sharing an id number would
// cancel each other in the OS.
check('sources never collide on the same entity', occurrenceId('p', 11, '2026-09-03') !== id, true);

// --- settings default to silence ---------------------------------------------
const defaults = normalizeNotificationSettings(null);
check('the master switch is on', defaults.enabled, true);
// AN UPGRADE MUST NOT START BUZZING. Everything added after reminders and
// special days is off until switched on.
check('supplements are off by default', defaults.supplements.enabled, false);
check('low stock is a separate switch, also off', defaults.supplements.lowStock, false);
check('bills are off by default', defaults.bills.enabled, false);
check('the bill lead time has a default', defaults.bills.daysBefore, 2);
check('an absurd lead time is clamped',
  normalizeNotificationSettings({ bills: { daysBefore: 900 } }).bills.daysBefore, 14);
check('a negative one too',
  normalizeNotificationSettings({ bills: { daysBefore: -5 } }).bills.daysBefore, 0);

check('reminders are always enabled', sourceEnabled(defaults, 'reminder'), true);
check('special days too', sourceEnabled(defaults, 'special'), true);
check('supplements are not', sourceEnabled(defaults, 'supplement'), false);
// The master switch overrides everything, including the always-on sources.
check('the master switch silences even reminders',
  sourceEnabled({ ...defaults, enabled: false }, 'reminder'), false);

// --- the merge -----------------------------------------------------------------
const base = { reminders, specialDays, supplements, allocations, nudgeContext, now: NOW, horizonDays: 60 };

const quiet = buildFeed({ ...base, settings: defaults });
// The logging nudges are the ONE new source that defaults on, because they were
// asked for by name. Supplements and bills stay silent until switched on.
check('with default settings, supplements and bills stay silent',
  [...new Set(quiet.map(f => f.source))].sort(), ['nudge', 'reminder', 'special']);
check('...and no context means not even the nudges',
  [...new Set(buildFeed({ ...base, nudgeContext: null, settings: defaults }).map(f => f.source))].sort(),
  ['reminder', 'special']);

const loud = buildFeed({ ...base, settings: { ...defaults, ...ON } });
check('switching the new sources on brings them in',
  [...new Set(loud.map(f => f.source))].sort(), ['bill', 'nudge', 'reminder', 'special', 'supplement']);

// THE CANCELLATION MECHANISM. There is no "cancel" call anywhere in this app —
// an item absent from the feed is one notify.js will cancel in the OS.
check('switching a source off removes it from the feed entirely',
  buildFeed({ ...base, settings: { ...defaults, ...ON, bills: { ...ON.bills, enabled: false } } })
    .some(f => f.source === 'bill'), false);
check('the master switch empties the feed',
  buildFeed({ ...base, settings: { ...defaults, ...ON, enabled: false } }), []);

check('the feed is in time order',
  loud.map(f => f.at).every((v, i, a) => i === 0 || a[i - 1] <= v), true);
// Every scheduled item must be able to open something. The payload existed for
// two versions with nothing reading it; `route` is what finished the job.
check('every item carries an in-app route',
  loud.every(f => typeof f.route === 'string' && f.route.startsWith('/')), true);
check('every item carries a title, a body and a real time',
  loud.every(f => f.title && f.body && Number.isFinite(f.at)), true);
check('a reminder deep-links to itself, not just to the list',
  loud.find(f => f.source === 'reminder').route, '/reminders/12');
check('a special day too', loud.find(f => f.source === 'special').route, '/special/21');

// --- supplement grouping ---------------------------------------------------------
// Three products at 09:00 is ONE notification. Four buzzes a minute apart is
// indistinguishable from spam even when every one is individually correct.
const supItems = loud.filter(f => f.source === 'supplement' && f.type === 'dose' && f.date === '2026-09-03');
check('one notification per TIME, not per supplement', supItems.length, 2);
const group = supItems.find(f => f.title === '补充剂');
check('the group names how many and which', group.body, '3 个补充剂到时间了：鱼油、综合维他命、肌酸');
check('a group points at the list, since it is about several things', group.route, '/diet/supplements');
const alone = supItems.find(f => f.title === '钙镁锌铜');
check('a lone supplement uses its own name instead of "补充剂"', Boolean(alone), true);
check('...and deep-links straight to its card', alone.route, '/diet/supplements/44');
// Same three-day reasoning as nudges: whether a dose was taken is a fact about
// a day, and 60 days of it would be hundreds of alarms nobody can answer yet.
check('supplement doses are scheduled three days out, not sixty',
  [...new Set(loud.filter(f => f.source === 'supplement' && f.type === 'dose').map(f => f.date))].length <= 3, true);
// A dose already ticked off must not be re-scheduled — and, when it was part of
// a group, the group must SHRINK rather than still naming it. Read at 08:00 so
// today's 09:00 slot is genuinely still ahead.
const EARLY = new Date(2026, 8, 2, 8, 0).getTime();
// Pinned to the 09:00 SLOT. Without the hour filter this would fall through to
// the unrelated 21:00 钙镁锌铜 item once the 09:00 group empties, and the last
// check below would silently be testing the wrong notification.
const todaysGroup = (log) => buildFeed({
  ...base, now: EARLY, settings: { ...defaults, ...ON }, supplementLog: log,
}).find(f => f.source === 'supplement' && f.type === 'dose'
  && f.date === TODAY && new Date(f.at).getHours() === 9);

check('before anything is ticked, all three are named',
  todaysGroup([]).body, '3 个补充剂到时间了：鱼油、综合维他命、肌酸');
check('ticking one off drops it out of the group',
  todaysGroup([{ id: 1, supplementId: 41, date: TODAY, time: '09:00', units: 1 }]).body,
  '2 个补充剂到时间了：综合维他命、肌酸');
// The wording collapses back to the plain single form rather than saying "1 个".
check('with only one left the group becomes that supplement',
  todaysGroup([
    { id: 1, supplementId: 41, date: TODAY, time: '09:00', units: 1 },
    { id: 2, supplementId: 42, date: TODAY, time: '09:00', units: 1 },
  ]).title, '肌酸');
check('ticking all three off leaves nothing scheduled for that slot',
  todaysGroup([
    { id: 1, supplementId: 41, date: TODAY, time: '09:00', units: 1 },
    { id: 2, supplementId: 42, date: TODAY, time: '09:00', units: 1 },
    { id: 3, supplementId: 43, date: TODAY, time: '09:00', units: 1 },
  ]), undefined);
check('a supplement with reminders off never appears',
  buildFeed({
    ...base, settings: { ...defaults, ...ON },
    supplements: supplements.map(s => ({ ...s, remindEnabled: false })),
  }).some(f => f.source === 'supplement' && f.type === 'dose'), false);

// --- bills ------------------------------------------------------------------------
const bill = loud.find(f => f.source === 'bill');
check('a bill warns before it lands, not on the day', bill.date, '2026-09-13');
check('...naming the amount', bill.title, 'Astro · RM 89.00');
check('...and saying when', bill.body, '2 天后扣（9月15日）。');
check('the lead time is honoured',
  buildFeed({ ...base, settings: { ...defaults, ...ON, bills: { ...ON.bills, daysBefore: 5 } } })
    .find(f => f.source === 'bill').date, '2026-09-10');

// --- robustness -------------------------------------------------------------------
// A single malformed record must cost its own item, not the whole feed. Losing
// every notification because one supplement has a corrupt field is exactly the
// silent failure this app keeps designing against.
check('a corrupt record does not empty the feed',
  buildFeed({ ...base, settings: { ...defaults, ...ON }, supplements: [null, 'x', { id: 1 }] })
    .some(f => f.source === 'reminder'), true);
check('an empty world produces an empty feed',
  buildFeed({ now: NOW, settings: defaults }), []);
// No context means no claim — see nudgeItems().
check('nudges stay silent when no context is supplied',
  buildFeed({ reminders, now: NOW, settings: defaults }).some(f => f.source === 'nudge'), false);

// --- the notification centre --------------------------------------------------------
const overdue = [{ id: 91, title: '过期了', startDate: '2026-09-01', time: '09:00', repeat: 'once' }];
const groups = centerGroups({
  feed: loud,
  reminders: overdue,
  supplements,
  supplementLog: [],
  nudgeContext,
  settings: { ...defaults, ...ON },
  liveAlerts: [{ id: 'budget', tone: 'bad', text: '今天超预算 RM 12.00', route: '/money' }],
  now: NOW,
});

// An overdue reminder has no FUTURE occurrence, so it is absent from the feed
// by construction — which is right for scheduling and wrong for a screen asking
// "what do I need to do". That is why the two are computed separately.
check('an overdue reminder reaches 需要注意 even though the feed has no room for it',
  groups.attention.some(r => r.title === '过期了'), true);
check('...and can be ticked off without leaving the screen',
  groups.attention.find(r => r.title === '过期了').action,
  { kind: 'completeReminder', id: 91 });
check('a live alert lands there too, with a route to open',
  groups.attention.find(r => r.key === 'live:budget').route, '/money');
check('every 需要注意 row can be opened',
  groups.attention.every(r => r.route.startsWith('/')), true);
check('今天 holds only things due today',
  groups.today.every(r => new Date(r.at).getDate() === 2), true);
check('接下来 holds only things that are not today',
  groups.upcoming.every(r => new Date(r.at).getDate() !== 2), true);
// A daily thing has an occurrence today AND tomorrow AND the day after. Listed
// plainly, three real items fill the screen with nine rows saying the same
// words, and a list that repeats itself is one you stop reading.
check('接下来 shows one row per source and title',
  groups.upcoming.length, new Set(groups.upcoming.map(r => `${r.source}:${r.title}`)).size);
check('...and never repeats something already listed under 今天',
  groups.upcoming.some(u => groups.today.some(t => t.source === u.source && t.title === u.title)),
  false);
// A supplement missed this morning does not also need a line at the bottom
// saying the next one is tomorrow — same daily item, already on screen in red.
check('...or under 需要注意',
  groups.upcoming.some(u => groups.attention.some(a => a.source === u.source && a.title === u.title)),
  false);
check('the badge counts 需要注意 only', attentionCount(groups), groups.attention.length);
check('...and is zero when there is nothing to act on',
  attentionCount(centerGroups({ feed: [], settings: defaults, now: NOW })), 0);

// A missed dose whose time has passed is a task; one still ahead is not.
const missed = centerGroups({
  feed: [], supplements, supplementLog: [], settings: { ...defaults, ...ON },
  now: new Date(2026, 8, 2, 12, 0).getTime(),
});
check('a dose whose time has passed shows as needing attention',
  missed.attention.filter(r => r.type === 'missed').map(r => r.title).sort(),
  ['综合维他命', '肌酸', '鱼油']);
check('...and can be taken from there',
  missed.attention.find(r => r.type === 'missed').action.kind, 'takeSupplement');
check('a dose still ahead is not yet a task',
  missed.attention.some(r => r.title === '钙镁锌铜' && r.type === 'missed'), false);

// Low stock is a standing condition, so the SCREEN shows it whether or not the
// OS notification for it is switched on — the screen is where you look.
const lowStock = centerGroups({
  feed: [],
  supplements: [{ id: 51, name: '鱼油', form: 'softgel', unitsPerDose: 1, remainingQuantity: 3, lowStockDoses: 7, times: ['09:00'] }],
  supplementLog: [], settings: defaults, now: NOW,
});
check('a nearly-empty bottle is flagged on screen even with its notification off',
  lowStock.attention.map(r => r.type), ['lowstock']);

// The real drawer, end to end.
const realFeed = buildFeed({
  supplements: buildSeedSupplements('2026-09-01'),
  settings: { ...defaults, supplements: { enabled: true, lowStock: false } },
  now: NOW, horizonDays: 60,
});
check('the seeded drawer schedules nothing until reminders are switched on per product',
  realFeed.length, 0);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
