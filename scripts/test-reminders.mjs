import {
  normalizeReminder, nextOccurrences, nextOccurrence, isOverdue,
  describeRepeat, describeWhen, occurrenceAt, anchorWeekday, DEFAULT_TIME,
  anchorDateForWeekday, anchorDateForMonthDay,
} from '../src/utils/reminders.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// A fixed clock, so the calendar below is deterministic: Wed 26 Aug 2026, 10:00.
const NOW = new Date(2026, 7, 26, 10, 0).getTime();
const dates = (r, opts) => nextOccurrences(r, { now: NOW, ...opts }).map(o => o.date);

// --- normalize --------------------------------------------------------------
check('a bare object gets every field filled in',
  normalizeReminder({ id: 1, title: '交作业', startDate: '2026-08-27' }),
  {
    id: 1, title: '交作业', note: '', time: DEFAULT_TIME, startDate: '2026-08-27',
    repeat: 'once', enabled: true, done: false, at: 0, updatedAt: 0,
  });
check('an unknown repeat falls back to once', normalizeReminder({ repeat: 'fortnightly' }).repeat, 'once');
check('an old 12-hour time is read as 24-hour', normalizeReminder({ time: '8:05 PM' }).time, '20:05');
check('enabled is only false when explicitly turned off', normalizeReminder({}).enabled, true);
check('...and false when it is', normalizeReminder({ enabled: false }).enabled, false);
check('garbage in, null out', normalizeReminder(null), null);

// --- one-off ----------------------------------------------------------------
const tomorrow = { id: 1, title: '交文件', startDate: '2026-08-27', time: '20:00', repeat: 'once' };
check('a one-off in the future fires once', dates(tomorrow), ['2026-08-27']);
check('a one-off in the past never fires again', dates({ ...tomorrow, startDate: '2026-08-20' }), []);
check('a one-off already ticked off does not fire', dates({ ...tomorrow, done: true }), []);
check('a disabled reminder does not fire', dates({ ...tomorrow, enabled: false }), []);

// The bug this pins down: comparing DATES rather than timestamps leaves a
// reminder set for 08:00 sitting in "coming up" all afternoon.
check('an occurrence earlier today has already gone by',
  dates({ ...tomorrow, startDate: '2026-08-26', time: '08:00' }), []);
check('...but one later today has not',
  dates({ ...tomorrow, startDate: '2026-08-26', time: '18:00' }), ['2026-08-26']);

// --- daily ------------------------------------------------------------------
const daily = { id: 2, title: '吃药', startDate: '2026-01-01', time: '18:00', repeat: 'daily' };
check('daily starts today when the time is still ahead',
  dates(daily, { horizonDays: 3 }), ['2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29']);
check('daily skips today once the time has passed',
  dates({ ...daily, time: '07:00' }, { horizonDays: 2 }),
  ['2026-08-27', '2026-08-28']);
check('a daily reminder that has not started yet waits',
  dates({ ...daily, startDate: '2026-09-01' }, { horizonDays: 8 }),
  ['2026-09-01', '2026-09-02', '2026-09-03']);
check('limit caps a daily reminder', dates(daily, { horizonDays: 60, limit: 3 }).length, 3);

// --- weekly -----------------------------------------------------------------
// 2026-08-24 is a Monday; asserted rather than assumed, since every date below
// depends on it.
check('the anchor weekday comes from startDate',
  anchorWeekday({ startDate: '2026-08-24' }), 1);

const weekly = { id: 3, title: '洗衣服', startDate: '2026-08-24', time: '19:00', repeat: 'weekly' };
check('weekly lands on the anchor weekday and strides by 7',
  dates(weekly, { horizonDays: 21 }), ['2026-08-31', '2026-09-07', '2026-09-14']);
check('weekly can fire later today when today IS the day',
  dates({ ...weekly, startDate: '2026-08-19' }, { horizonDays: 8 }),
  ['2026-08-26', '2026-09-02']);

// --- monthly ----------------------------------------------------------------
const monthly = { id: 4, title: '看财务', startDate: '2026-01-10', time: '21:00', repeat: 'monthly' };
check('monthly skips this month once its day has passed',
  dates(monthly, { horizonDays: 40 }), ['2026-09-10']);

// The 31st is the whole reason clamping exists. Measured from the ANCHOR every
// time — 31 → Feb 28 → Mar 31, never drifting down to the 28th and staying there.
const endOfMonth = { id: 5, title: '交租', startDate: '2027-01-31', time: '09:00', repeat: 'monthly' };
check('the 31st clamps to the last day of a short month, then springs back',
  nextOccurrences(endOfMonth, { now: new Date(2027, 0, 15, 10, 0).getTime(), horizonDays: 90 })
    .map(o => o.date),
  ['2027-01-31', '2027-02-28', '2027-03-31']);
check('...and finds Feb 29 in a leap year',
  nextOccurrences(endOfMonth, { now: new Date(2028, 0, 15, 10, 0).getTime(), horizonDays: 50 })
    .map(o => o.date),
  ['2028-01-31', '2028-02-29']);

// --- yearly -----------------------------------------------------------------
const yearly = { id: 6, title: '续保险', startDate: '2020-12-25', time: '10:00', repeat: 'yearly' };
check('yearly is invisible outside the horizon', dates(yearly, { horizonDays: 60 }), []);
check('yearly appears once it comes into range', dates(yearly, { horizonDays: 200 }), ['2026-12-25']);
check('yearly rolls to next year once this year has gone',
  nextOccurrences(yearly, { now: new Date(2026, 11, 26, 10, 0).getTime(), horizonDays: 400 })
    .map(o => o.date),
  ['2027-12-25']);

// --- nextOccurrence / overdue ------------------------------------------------
check('nextOccurrence returns just the first', nextOccurrence(daily, { now: NOW })?.date, '2026-08-26');
check('nextOccurrence is null when nothing is coming', nextOccurrence(yearly, { now: NOW, horizonDays: 30 }), null);

check('a passed one-off is overdue', isOverdue({ ...tomorrow, startDate: '2026-08-25' }, NOW), true);
check('a future one-off is not', isOverdue(tomorrow, NOW), false);
check('a ticked-off one-off is not overdue', isOverdue({ ...tomorrow, startDate: '2026-08-25', done: true }, NOW), false);
// Otherwise every repeating reminder shows permanent red text nobody can clear.
check('a repeating reminder is never overdue', isOverdue({ ...daily, time: '07:00' }, NOW), false);

// --- wording -----------------------------------------------------------------
check('a weekly repeat reads as a weekday', describeRepeat(weekly), '每星期一 · 19:00');
check('a monthly repeat names the day of the month', describeRepeat(monthly), '每个月 10 号 · 21:00');
check('a yearly repeat names the date', describeRepeat(yearly), '每年 12月25 日 · 10:00');
check('a daily repeat just says every day', describeRepeat(daily), '每天 · 18:00');
check('a one-off states its date', describeRepeat(tomorrow), '2026-08-27 · 20:00');

check('today reads as 今天', describeWhen(occurrenceAt('2026-08-26', '18:00'), NOW), '今天 18:00');
check('tomorrow reads as 明天', describeWhen(occurrenceAt('2026-08-27', '08:30'), NOW), '明天 08:30');
check('the day after reads as 后天', describeWhen(occurrenceAt('2026-08-28', '08:30'), NOW), '后天 08:30');
check('anything further out reads as a date', describeWhen(occurrenceAt('2026-09-05', '09:00'), NOW), '9月5日 09:00');

// --- the clock -----------------------------------------------------------------
// Built from parts, never Date.parse, so a UTC offset can't move the day.
check('occurrenceAt is local, not UTC',
  new Date(occurrenceAt('2026-08-26', '00:30')).getDate(), 26);
check('a missing time falls back to the default',
  occurrenceAt('2026-08-26', null), occurrenceAt('2026-08-26', DEFAULT_TIME));

// --- turning a form choice into an anchor date --------------------------------
// The form offers weekday buttons and a day-of-month number; the model stores
// only startDate. These are the bridge between the two.
check('picking a weekday finds the next one', anchorDateForWeekday(1, '2026-08-26'), '2026-08-31');
check('...and today counts when today IS that weekday', anchorDateForWeekday(3, '2026-08-26'), '2026-08-26');

check('picking a later day this month stays this month', anchorDateForMonthDay(30, '2026-08-26'), '2026-08-30');
check('picking an earlier day rolls to next month', anchorDateForMonthDay(5, '2026-08-26'), '2026-09-05');
// THE TRAP: clamping HERE would store 2027-02-28 and make 28 the anchor
// forever, so "every month on the 31st" silently becomes "every month on the
// 28th". It has to skip to a month that actually has a 31st instead.
check('the 31st skips February rather than clamping into it',
  anchorDateForMonthDay(31, '2027-02-01'), '2027-03-31');
check('...so the anchor it stores still says 31',
  Number(anchorDateForMonthDay(31, '2027-02-01').split('-')[2]), 31);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
