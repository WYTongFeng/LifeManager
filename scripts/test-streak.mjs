import { computeWorkoutStreak, recentTrainingDays } from '../src/utils/streak.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

const now = new Date(2026, 7, 14); // 2026-08-14, a Friday

// --- computeWorkoutStreak ---------------------------------------------------
check('no history, nothing today -> 0', computeWorkoutStreak([], 0, now), 0);
check('nothing in history, but trained today -> 1', computeWorkoutStreak([], 3, now), 1);

const threeInARow = [
  { date: '2026-08-11', totalSets: 4 },
  { date: '2026-08-12', totalSets: 2 },
  { date: '2026-08-13', totalSets: 5 },
];
check('3 consecutive past days + trained today -> 4', computeWorkoutStreak(threeInARow, 1, now), 4);
check('3 consecutive past days, NOT trained today yet -> streak still counts (today not over)',
  computeWorkoutStreak(threeInARow, 0, now), 3);

const brokenYesterday = [
  { date: '2026-08-11', totalSets: 4 },
  { date: '2026-08-12', totalSets: 0 }, // rest day breaks it
  { date: '2026-08-13', totalSets: 5 },
];
check('a zero-set day in between breaks the streak at that point',
  computeWorkoutStreak(brokenYesterday, 1, now), 2);

const missingDay = [
  { date: '2026-08-13', totalSets: 5 },
  // 2026-08-12 entirely absent from history
  { date: '2026-08-11', totalSets: 4 },
];
check('a day missing from history entirely counts as a break, same as a zero-day',
  computeWorkoutStreak(missingDay, 1, now), 2);

check('today alone, nothing before it -> 1', computeWorkoutStreak([], 2, now), 1);

// --- recentTrainingDays ------------------------------------------------------
const strip = recentTrainingDays(threeInARow, 2, now, 5);
check('strip has the requested number of days, oldest first', strip.map(d => d.date), [
  '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
]);
check('last entry is today, correctly flagged', strip.at(-1), { date: '2026-08-14', trained: true, sets: 2, isToday: true });
check('a day with no history entry reads as untrained, not an error',
  strip[0], { date: '2026-08-10', trained: false, sets: 0, isToday: false });
check('a real trained day from history is reflected correctly',
  strip[1], { date: '2026-08-11', trained: true, sets: 4, isToday: false });

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
