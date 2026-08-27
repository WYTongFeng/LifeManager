import {
  blockHistory, daysBetween, exerciseSessions, exerciseProgress,
  trackedExercises, loggingMix, totalVolume,
} from '../src/utils/workoutProgress.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

const now = new Date(2026, 7, 25); // 2026-08-25

// --- daysBetween ---------------------------------------------------------
check('days between two dates', daysBetween('2026-08-20', '2026-08-25'), 5);
check('same day is zero', daysBetween('2026-08-25', '2026-08-25'), 0);
check('across a month boundary', daysBetween('2026-07-30', '2026-08-02'), 3);
// Built from parts, not `new Date(str)` — a UTC-parsed string is a day out west of UTC.
check('across a year boundary', daysBetween('2025-12-30', '2026-01-02'), 3);

// --- blockHistory --------------------------------------------------------
//
// THE CASE THIS FILE EXISTS FOR: a one-tap whole-session record and a day
// logged set-by-set must count EXACTLY the same. Block 1 below is logged in one
// tap; block 2 is logged as four separate sets on one day.
const workouts = [
  { date: '2026-08-24', type: 'session', routineBlock: 1, routineName: '板块 1 · 胸 + 三头', setsPlanned: 20 },
  { date: '2026-08-25', type: 'strength', routineBlock: 2, routineName: '板块 2 · 背 + 二头', exercise: '划船', weightKg: 50, reps: 10 },
  { date: '2026-08-25', type: 'strength', routineBlock: 2, routineName: '板块 2 · 背 + 二头', exercise: '划船', weightKg: 50, reps: 9 },
  { date: '2026-08-25', type: 'strength', routineBlock: 2, routineName: '板块 2 · 背 + 二头', exercise: '引体', weightKg: 0, reps: 8 },
  { date: '2026-08-25', type: 'strength', routineBlock: 2, routineName: '板块 2 · 背 + 二头', exercise: '引体', weightKg: 0, reps: 7 },
  { date: '2026-08-17', type: 'session', routineBlock: 1, routineName: '板块 1 · 胸 + 三头', setsPlanned: 20 },
  { date: '2026-08-18', type: 'session', routineBlock: 3, routineName: '板块 3 · 腿', setsPlanned: 15 },
  { date: '2026-08-20', type: 'cardio', activity: '跑步', durationMin: 30 },
];

const blocks = blockHistory(workouts, { days: 28, now });
check('every block that was trained appears once', blocks.length, 3);
check('a one-tap session and a set-by-set day both count as ONE session',
  blocks.find(b => b.key === 1).count, 2);
check('...and four logged sets on one day are still one session',
  blocks.find(b => b.key === 2).count, 1);
check('cardio does not create a block', blocks.some(b => b.name === '跑步'), false);
check('last trained date is tracked', blocks.find(b => b.key === 2).lastDate, '2026-08-25');
check('days since is measured from today', blocks.find(b => b.key === 2).daysSince, 0);
check('the neglected block reports its real gap', blocks.find(b => b.key === 3).daysSince, 7);
// Most neglected first — the whole point is to surface the block being skipped.
check('the list leads with the most neglected block', blocks[0].key, 3);

// A block trained only OUTSIDE the window still reports its true lastDate,
// but counts zero inside the window.
const oldBlocks = blockHistory(workouts, { days: 3, now });
check('a 3-day window excludes older sessions from the count',
  oldBlocks.find(b => b.key === 3).count, 0);
check('...while still remembering when it was last done',
  oldBlocks.find(b => b.key === 3).lastDate, '2026-08-18');

// Renamed routine: the CURRENT name wins.
const renamed = blockHistory([
  { date: '2026-08-10', type: 'session', routineBlock: 1, routineName: '旧名字' },
  { date: '2026-08-24', type: 'session', routineBlock: 1, routineName: '新名字' },
], { days: 28, now });
check('a renamed routine shows under its most recent name', renamed[0].name, '新名字');

// A routine with no block at all falls back to its name.
const noBlock = blockHistory([
  { date: '2026-08-24', type: 'session', routineName: '自订菜单' },
], { days: 28, now });
check('a routine without a block key falls back to its name', noBlock[0].key, '自订菜单');

// --- exerciseSessions ----------------------------------------------------
//
// One row per DAY. The top set is the day's number, and reps at that top weight
// carry alongside it — 45kg x 9 is progress over 45kg x 8 and a weight-only
// view cannot see it.
const bench = [
  { date: '2026-08-01', type: 'strength', exercise: '卧推', weightKg: 40, reps: 8 },
  { date: '2026-08-01', type: 'strength', exercise: '卧推', weightKg: 40, reps: 7 },
  { date: '2026-08-01', type: 'strength', exercise: '卧推', weightKg: 30, reps: 12 }, // back-off set
  { date: '2026-08-08', type: 'strength', exercise: '卧推', weightKg: 42.5, reps: 8 },
  { date: '2026-08-15', type: 'strength', exercise: '卧推', weightKg: 45, reps: 7 },
  { date: '2026-08-22', type: 'strength', exercise: '卧推', weightKg: 45, reps: 9 },
  { date: '2026-08-22', type: 'session', routineBlock: 1, setsPlanned: 20 },   // must be ignored
  { date: '2026-08-22', type: 'cardio', activity: '跑步', durationMin: 20 },   // must be ignored
];

const s = exerciseSessions(bench, '卧推');
check('one row per day, not per set', s.length, 4);
check('three sets on one day are one data point', s[0].sets, 3);
check('the day\'s number is the TOP set, not the average', s[0].topKg, 40);
check('a back-off set does not drag the top set down', s[0].topKg, 40);
check('reps are the best reps AT the top weight', s[0].repsAtTop, 8);
check('volume counts every rep-mode set', s[0].volume, 40 * 8 + 40 * 7 + 30 * 12);
check('rows come back oldest first', s.map(r => r.date), ['2026-08-01', '2026-08-08', '2026-08-15', '2026-08-22']);
check('a one-tap session contributes nothing to an exercise', s[3].sets, 1);
check('an unknown exercise has no sessions', exerciseSessions(bench, '深蹲'), []);
check('no exercise name means no sessions', exerciseSessions(bench, null), []);

// --- exerciseProgress ----------------------------------------------------
const p = exerciseProgress(bench, '卧推');
check('four sessions are counted', p.sessionCount, 4);
check('the best ever is reported', p.bestKg, 45);
// SAME weight, MORE reps — the case a weight-only view reports as "no change".
check('same weight with more reps reads as progress', p.verdict, 'reps');
check('...with the rep delta named', p.deltaReps, 2);
check('...and no weight change claimed', p.deltaKg, 0);

const heavier = exerciseProgress([...bench,
  { date: '2026-08-29', type: 'strength', exercise: '卧推', weightKg: 47.5, reps: 8 }], '卧推');
check('a heavier top set reads as up', heavier.verdict, 'up');
check('...with the weight delta named', heavier.deltaKg, 2.5);

const lighter = exerciseProgress([...bench,
  { date: '2026-08-29', type: 'strength', exercise: '卧推', weightKg: 40, reps: 12 }], '卧推');
check('a lighter top set reads as down, whatever the reps', lighter.verdict, 'down');

const flat = exerciseProgress([
  { date: '2026-08-01', type: 'strength', exercise: '划船', weightKg: 50, reps: 10 },
  { date: '2026-08-08', type: 'strength', exercise: '划船', weightKg: 50, reps: 10 },
], '划船');
check('identical sessions read as same', flat.verdict, 'same');

// THE MIRROR OF THE 'reps' CASE. If 45kg x 9 after 45kg x 7 is progress, then
// 27.5kg x 10 after 27.5kg x 12 is not "持平" — the reps moved, downward, and
// reporting that as unchanged is a true-sounding claim about a number that
// changed. Found by running the real screen, not by the tests above.
const repsDown = exerciseProgress([
  { date: '2026-08-01', type: 'strength', exercise: '下压', weightKg: 27.5, reps: 12 },
  { date: '2026-08-08', type: 'strength', exercise: '下压', weightKg: 27.5, reps: 10 },
], '下压');
check('same weight with FEWER reps is not 持平', repsDown.verdict, 'repsDown');
check('...and it is not "same" either', repsDown.verdict === 'same', false);
check('...with the rep loss named', repsDown.deltaReps, -2);
check('...and no weight change claimed', repsDown.deltaKg, 0);

const single = exerciseProgress([
  { date: '2026-08-01', type: 'strength', exercise: '深蹲', weightKg: 60, reps: 8 },
], '深蹲');
check('one session gives no verdict — there is nothing to compare', single.verdict, null);
check('...but the session itself is still reported', single.latest.topKg, 60);
check('an exercise never trained returns null', exerciseProgress(bench, '硬拉'), null);

// A hold (plank) has seconds, not weight — no weight verdict is invented.
const plank = exerciseProgress([
  { date: '2026-08-01', type: 'strength', exercise: '平板支撑', mode: 'time', holdSec: 45, weightKg: 0, reps: 0 },
  { date: '2026-08-08', type: 'strength', exercise: '平板支撑', mode: 'time', holdSec: 60, weightKg: 0, reps: 0 },
], '平板支撑');
check('a hold is flagged as one', plank.hold, true);
check('a hold gets no weight verdict', plank.verdict, null);
check('a hold contributes no volume', plank.latest.volume, 0);
check('...and its hold time is kept', plank.latest.holdSec, 60);

// --- trackedExercises ----------------------------------------------------
const tracked = trackedExercises(bench);
check('only exercises with 2+ sessions are tracked', tracked.length, 1);
check('...and it is the bench', tracked[0].name, '卧推');
check('a one-session exercise is excluded',
  trackedExercises([{ date: '2026-08-01', type: 'strength', exercise: '深蹲', weightKg: 60, reps: 8 }]).length, 0);
check('a workout list with only one-tap sessions tracks nothing',
  trackedExercises([{ date: '2026-08-24', type: 'session', routineBlock: 1, setsPlanned: 20 }]).length, 0);

// --- loggingMix ----------------------------------------------------------
//
// This is what lets a near-empty progress screen explain ITSELF rather than
// look broken.
const mix = loggingMix(workouts, { days: 28, now });
check('one-tap days are counted', mix.quickDays, 3);
check('set-by-set days are counted', mix.detailedDays, 1);
check('cardio is not a training-logging style', mix.totalDays, 4);

// A day with BOTH a one-tap record and logged sets has real set data.
const both = loggingMix([
  { date: '2026-08-24', type: 'session', routineBlock: 1, setsPlanned: 20 },
  { date: '2026-08-24', type: 'strength', exercise: '卧推', weightKg: 45, reps: 8 },
], { days: 28, now });
check('a day logged both ways counts as detailed', both.detailedDays, 1);
check('...and is not double-counted as quick', both.quickDays, 0);

// --- totalVolume ---------------------------------------------------------
check('volume is sets x reps x weight', totalVolume(bench), 40 * 8 + 40 * 7 + 30 * 12 + 42.5 * 8 + 45 * 7 + 45 * 9);
check('a date window is respected', totalVolume(bench, { from: '2026-08-22' }), 45 * 9);
check('holds and cardio contribute no volume', totalVolume([
  { date: '2026-08-01', type: 'strength', exercise: '平板支撑', mode: 'time', holdSec: 45 },
  { date: '2026-08-01', type: 'cardio', durationMin: 30 },
]), 0);
check('a set with a missing weight does not NaN the total', totalVolume([
  { date: '2026-08-01', type: 'strength', exercise: '卧推', reps: 8 },
  { date: '2026-08-01', type: 'strength', exercise: '卧推', weightKg: 40, reps: 8 },
]), 320);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
