import {
  normalizeSpecialDay, nextDate, daysUntil, describeCountdown, occurrenceNumber,
  sortUpcoming, remindOffsetDays, notificationsFor, describeMonthDay,
  DEFAULT_EMOJI, DEFAULT_REMIND_TIME,
} from '../src/utils/specialDays.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

const TODAY = '2026-08-26';
const NOW = new Date(2026, 7, 26, 10, 0).getTime();

// --- normalize --------------------------------------------------------------
check('a bare object gets every field filled in',
  normalizeSpecialDay({ id: 1, title: '生日', date: '2000-09-05' }),
  {
    id: 1, title: '生日', emoji: DEFAULT_EMOJI, date: '2000-09-05', yearly: true,
    remind: 'none', remindTime: DEFAULT_REMIND_TIME, at: 0, updatedAt: 0,
  });
check('yearly is the default and only false when said so', normalizeSpecialDay({}).yearly, true);
check('...and false when it is', normalizeSpecialDay({ yearly: false }).yearly, false);
check('an unknown remind option falls back to none', normalizeSpecialDay({ remind: 'someday' }).remind, 'none');

// --- next occurrence ---------------------------------------------------------
const birthday = { id: 1, title: '朋友生日', emoji: '🎂', date: '2000-09-05' };
check('a yearly date later this year lands this year', nextDate(birthday, TODAY), '2026-09-05');
check('...and the countdown counts days', daysUntil(birthday, TODAY), 10);

const passed = { id: 2, title: '毕业', date: '2024-06-01' };
check('a yearly date already gone rolls to next year', nextDate(passed, TODAY), '2027-06-01');

// A birthday is not over at 00:01 on the day.
const todayIs = { id: 3, title: '今天', date: '1999-08-26' };
check('today counts as the next occurrence', nextDate(todayIs, TODAY), '2026-08-26');
check('...at zero days out', daysUntil(todayIs, TODAY), 0);

const oneOff = { id: 4, title: '搬家', date: '2026-11-01', yearly: false };
check('a one-off in the future stands', nextDate(oneOff, TODAY), '2026-11-01');
check('a one-off in the past is over for good', nextDate({ ...oneOff, date: '2026-01-01' }, TODAY), null);
check('...and has no countdown', daysUntil({ ...oneOff, date: '2026-01-01' }, TODAY), null);

// Three years in four have no 29 February. Skipping the birthday entirely for
// those three is worse than being one day early.
const leapling = { id: 5, title: '闰年生日', date: '2004-02-29' };
check('Feb 29 clamps to Feb 28 in a common year', nextDate(leapling, '2027-01-01'), '2027-02-28');
check('...and is itself in a leap year', nextDate(leapling, '2028-01-01'), '2028-02-29');

// --- wording -----------------------------------------------------------------
check('the day itself reads as 就是今天', describeCountdown(todayIs, TODAY), '就是今天');
check('tomorrow reads as 明天', describeCountdown({ date: '2020-08-27' }, TODAY), '明天');
check('the day after reads as 后天', describeCountdown({ date: '2020-08-28' }, TODAY), '后天');
check('further out counts the days', describeCountdown(birthday, TODAY), '还有 10 天');
check('a finished one-off says so', describeCountdown({ date: '2026-01-01', yearly: false }, TODAY), '已经过了');

// --- which one is it -----------------------------------------------------------
check('a 2000 birthday turns 26 in 2026', occurrenceNumber(birthday, TODAY), 26);
check('a 2024 date reaches its 3rd in 2027', occurrenceNumber(passed, TODAY), 3);
// Inventing a "0th anniversary" is worse than saying nothing at all.
check('a date first happening this year has no count yet',
  occurrenceNumber({ date: '2026-09-05' }, TODAY), null);
check('a one-off has no count', occurrenceNumber(oneOff, TODAY), null);

// --- sorting -------------------------------------------------------------------
check('soonest first, expired last',
  sortUpcoming([passed, birthday, { ...oneOff, date: '2026-01-01' }, todayIs], TODAY).map(s => s.id),
  [3, 1, 2, 4]);

// --- notification moments --------------------------------------------------------
check('不提醒 schedules nothing', notificationsFor({ ...birthday, remind: 'none' }, { now: NOW }), []);
check('an offset of null means no reminder', remindOffsetDays('none'), null);
check('提前 1 星期 is 7 days', remindOffsetDays('week'), 7);

const sameDay = notificationsFor({ ...birthday, remind: 'same' }, { now: NOW });
check('当天 fires on the day itself', sameDay.map(o => o.date), ['2026-09-05']);
check('...at the reminder time', new Date(sameDay[0].at).getHours(), 9);
check('...on that same date', new Date(sameDay[0].at).getDate(), 5);

const dayBefore = notificationsFor({ ...birthday, remind: 'day' }, { now: NOW });
check('提前 1 天 fires the day before', new Date(dayBefore[0].at).getDate(), 4);

const weekBefore = notificationsFor({ ...birthday, remind: 'week' }, { now: NOW });
check('提前 1 星期 fires a week before', new Date(weekBefore[0].at).getDate(), 29);
check('...in the previous month', new Date(weekBefore[0].at).getMonth() + 1, 8);

// THE CASE THAT MADE notificationsFor LOOK TWO YEARS AHEAD: on 3 Sep, the
// "1 week before" moment for a 5 Sep birthday was 29 Aug — already gone. Taking
// this year's occurrence and stopping would schedule nothing, this year and
// every year after, because the app is opened inside that window every time.
const LATE = new Date(2026, 8, 3, 10, 0).getTime();
const late = notificationsFor({ ...birthday, remind: 'week' }, { now: LATE, horizonDays: 400 });
check('a warning whose moment has passed skips to next year', late.map(o => o.date), ['2027-09-05']);
check('...rather than silently scheduling nothing', late.length, 1);
check('and outside the horizon it simply waits for a later app open',
  notificationsFor({ ...birthday, remind: 'week' }, { now: LATE, horizonDays: 60 }), []);

// A one-off whose warning has passed really is finished — there is no next year.
check('a one-off with a passed warning has nothing left',
  notificationsFor({ id: 9, date: '2026-08-27', yearly: false, remind: 'week' }, { now: NOW }), []);

// --- the date badge -------------------------------------------------------------
// Named describeMonthDay, not describeDate: datetime.js exports a describeDate
// that means something else entirely, and they are one import apart.
check('the badge shows the next occurrence, no year', describeMonthDay(birthday, TODAY), '9月5日');
check('a finished one-off has no date to show',
  describeMonthDay({ date: '2026-01-01', yearly: false }, TODAY), '—');

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
