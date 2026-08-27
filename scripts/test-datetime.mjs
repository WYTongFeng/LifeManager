// Dates and clock times — the shapes that are actually in storage.

import {
  todayStr, nowTimeStr, shiftDate, daysBetween,
  toHHMM, timeToMinutes, sortByTime, describeDate,
} from '../src/utils/datetime.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// --- local dates, never UTC ------------------------------------------------
// toISOString().slice(0,10) is the trap this replaces: at 08:00 in Malaysia
// (UTC+8) it still returns YESTERDAY's date, so a morning coffee would be
// filed on the wrong day every single time.
check('a date is built from local parts', todayStr(new Date(2026, 7, 25, 0, 30)), '2026-08-25');
check('...still local at 23:59', todayStr(new Date(2026, 7, 25, 23, 59)), '2026-08-25');
check('single digits are padded', todayStr(new Date(2026, 0, 5)), '2026-01-05');

check('time is zero-padded 24h', nowTimeStr(new Date(2026, 7, 25, 9, 5)), '09:05');
check('...and midnight is 00:00', nowTimeStr(new Date(2026, 7, 25, 0, 0)), '00:00');

// --- shifting days ---------------------------------------------------------
check('yesterday', shiftDate('2026-08-25', -1), '2026-08-24');
check('across a month boundary', shiftDate('2026-09-01', -1), '2026-08-31');
check('across a year boundary', shiftDate('2026-01-01', -1), '2025-12-31');
check('a leap day exists in 2028', shiftDate('2028-02-28', 1), '2028-02-29');
check('forward a week', shiftDate('2026-08-25', 7), '2026-09-01');

check('days between', daysBetween('2026-08-10', '2026-08-25'), 15);
check('...is negative backwards', daysBetween('2026-08-25', '2026-08-10'), -15);
check('...and zero for the same day', daysBetween('2026-08-25', '2026-08-25'), 0);

// --- reading the times already in storage ----------------------------------
// Weeks of records were saved as en-US locale strings. They still have to sort
// and display correctly; rewriting real records to fix a display bug is not a
// trade worth making.
check('24h passes through', toHHMM('23:45'), '23:45');
check('a single-digit hour is padded', toHHMM('9:05'), '09:05');
check('legacy PM', toHHMM('11:45 PM'), '23:45');
check('legacy AM', toHHMM('08:12 AM'), '08:12');
check('legacy noon is 12, not 00', toHHMM('12:30 PM'), '12:30');
check('legacy midnight is 00, not 12', toHHMM('12:05 AM'), '00:05');
check('lowercase with dots', toHHMM('7:20 p.m.'), '19:20');
check('nothing readable is null, not a guess', toHHMM('later'), null);
check('missing is null', toHHMM(undefined), null);
check('a 25th hour is rejected', toHHMM('25:00'), null);

// --- sorting a day ---------------------------------------------------------
// The bug: "9:05 AM" sorts AFTER "10:30 PM" as plain text, so a day's list came
// out in whatever order the array happened to be in.
check('an unknown time sorts last, not to midnight',
  timeToMinutes(null) > timeToMinutes('23:59'), true);

const day = [
  { id: 'c', time: '10:30 PM' },
  { id: 'a', time: '9:05 AM' },
  { id: 'd', time: null, at: new Date(2026, 7, 25, 13, 0).getTime() },
  { id: 'b', time: '12:30 PM' },
];
check('a day sorts by real clock time, mixed formats and all',
  sortByTime(day).map(r => r.id), ['a', 'b', 'd', 'c']);
check('newest first is the exact reverse',
  sortByTime(day, { newestFirst: true }).map(r => r.id), ['c', 'd', 'b', 'a']);
check('sorting does not mutate the input', day.map(r => r.id), ['c', 'a', 'd', 'b']);
check('an empty day is empty, not a crash', sortByTime([]), []);

// --- how a day reads -------------------------------------------------------
const T = '2026-08-25';
check('today', describeDate('2026-08-25', T), '今天');
check('yesterday', describeDate('2026-08-24', T), '昨天');
check('the day before', describeDate('2026-08-23', T), '前天');
check('anything older gets a real date with its weekday',
  describeDate('2026-08-21', T), '8月21日（五）');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
