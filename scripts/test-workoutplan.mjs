// The strength session as a plan: an order, a total the ROUTINE states, and
// always an answer to "what do I do now".

import {
  TOTAL_SETS_TARGET, distributeSets, normalizeRoutineSets, buildPlan,
  planProgress, reorderExercises, lastSetFor, suggestRoutine,
  routineTotalSets, estimateRoutineMinutes, countSets, restSecFor,
} from '../src/utils/workoutPlan.js';
import { GYM_ROUTINES, HOME_ROUTINES } from '../src/utils/workoutRoutines.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// --- the 13-set split ------------------------------------------------------
check('13 sets over 4 exercises, compound first', distributeSets(4), [4, 3, 3, 3]);
check('13 over 3', distributeSets(3), [5, 4, 4]);
check('13 over 5', distributeSets(5), [3, 3, 3, 2, 2]);
check('13 over 1', distributeSets(1), [13]);
check('13 over 6', distributeSets(6), [3, 2, 2, 2, 2, 2]);
check('no exercises, no sets', distributeSets(0), []);

for (const n of [1, 2, 3, 4, 5, 6, 7, 13]) {
  const sum = distributeSets(n).reduce((a, b) => a + b, 0);
  if (sum !== TOTAL_SETS_TARGET) { fail++; console.log(`FAIL  ${n} exercises sum to ${sum}, not 13`); }
}
check('every split sums to exactly 13', true, true);

// --- normalizing a routine -------------------------------------------------
const legacy = { id: 1, name: '腿日', exercises: ['深蹲', '腿举', '提踵'] };
const normalized = normalizeRoutineSets(legacy);
check('bare strings become objects with targets',
  normalized.exercises.map(e => [e.name, e.targetSets]), [['深蹲', 5], ['腿举', 4], ['提踵', 4]]);

const shortRoutine = { id: 2, name: 'HIIT', exercises: [
  { name: '开合跳', targetSets: 3 }, { name: '波比跳', targetSets: 3 },
  { name: '平板支撑', targetSets: 3 }, { name: '登山者', targetSets: 3 },
]};
// A routine that states its own sets keeps every one of them, whatever they
// total. This is the behaviour that had to change: the old rule forced 13, so a
// 12-set routine was silently topped up and the user's real 20-set chest day
// was silently cut down.
check('a 12-set routine keeps its 12 sets',
  normalizeRoutineSets(shortRoutine).exercises.map(e => e.targetSets), [3, 3, 3, 3]);

const deliberate = { id: 3, name: '腿', exercises: [
  { name: '深蹲', targetSets: 6 }, { name: '腿举', targetSets: 5 }, { name: '提踵', targetSets: 2 },
]};
check('a hand-weighted routine is left alone',
  normalizeRoutineSets(deliberate).exercises.map(e => e.targetSets), [6, 5, 2]);

// Adding one exercise to an existing routine must not renumber the others.
const halfEdited = { id: 4, name: '胸', exercises: [
  { name: '卧推', targetSets: 4 }, { name: '飞鸟', targetSets: 4 }, { name: '新动作' },
]};
check('a blank target is filled without touching the stated ones',
  normalizeRoutineSets(halfEdited).exercises.map(e => e.targetSets), [4, 4, 4]);

// --- the real programme survives a round trip ------------------------------
//
// The whole point of the change: these are the user's own numbers, and
// normalizing must return them unchanged.
check('gym block set totals', GYM_ROUTINES.map(routineTotalSets), [20, 18, 15, 19]);
check('home block set totals', HOME_ROUTINES.map(routineTotalSets), [20, 18, 15, 19]);
check('normalizing the real routines changes nothing',
  GYM_ROUTINES.map(r => routineTotalSets(normalizeRoutineSets(r))), [20, 18, 15, 19]);
check('every gym block pairs with a home block of the same number',
  HOME_ROUTINES.map(r => r.block), GYM_ROUTINES.map(r => r.block));

// Rest times are the plan's, not a flat 60 — this is what makes it fit in 50
// minutes, and what the timer reads.
check('incline press rests 75s', restSecFor(GYM_ROUTINES[0].exercises[0]), 75);
check('the finisher rests 45s', restSecFor(GYM_ROUTINES[0].exercises[4]), 45);
check('barbell row rests 90s', restSecFor(GYM_ROUTINES[1].exercises[1]), 90);
check('an exercise with no rest set falls back to 60',
  restSecFor({ name: '随便' }), 60);

// Every block lands in the 30-50 minute window it was designed around.
const inRange = GYM_ROUTINES.every(r => {
  const m = estimateRoutineMinutes(r);
  return m >= 30 && m <= 50;
});
check('every block estimates to a 30-50 minute session', inRange, true);

// --- counting sets across three record shapes ------------------------------
check('a plain set counts as one', countSets([{ type: 'strength' }]), 1);
check('cardio counts as none', countSets([{ type: 'cardio', durationMin: 30 }]), 0);
check('a whole session counts as the sets it planned',
  countSets([{ type: 'session', setsPlanned: 20 }]), 20);
check('mixed day', countSets([
  { type: 'strength' }, { type: 'strength' },
  { type: 'cardio' }, { type: 'session', setsPlanned: 18 },
]), 20);
check('a legacy record with no type counts as a set', countSets([{ exercise: '卧推' }]), 1);
check('nothing logged is zero, not NaN', countSets([]), 0);

// --- the plan --------------------------------------------------------------
const routine = normalizeRoutineSets({
  id: 1, name: '胸 & 三头',
  exercises: ['卧推', '上斜哑铃卧推', '三头下压', '夹胸飞鸟'],
});
check('four exercises, 4/3/3/3', routine.exercises.map(e => e.targetSets), [4, 3, 3, 3]);

const today = [
  { type: 'strength', exercise: '卧推', at: 1 },
  { type: 'strength', exercise: '卧推', at: 2 },
  { type: 'cardio', activity: '跑步', at: 3 },      // must not count as a set
  { type: 'strength', exercise: '三头下压', at: 4 },
];
const plan = buildPlan(routine, today);
check('done sets counted per exercise', plan.map(p => p.doneSets), [2, 0, 1, 0]);
check('cardio never counts as a strength set',
  plan.reduce((s, p) => s + p.doneSets, 0), 3);
check('remaining per exercise', plan.map(p => p.remaining), [2, 3, 2, 3]);
check('nothing finished yet', plan.map(p => p.isDone), [false, false, false, false]);

const prog = planProgress(plan);
check('3 of 13 done', [prog.doneSets, prog.targetSets], [3, 13]);
check('10 still to go', prog.remaining, 10);
check('current is the first exercise still owing sets', prog.current.name, '卧推');
check('next skips nothing yet', prog.next.name, '上斜哑铃卧推');
check('not complete', prog.isComplete, false);

// Once an exercise meets its target, "current" moves on by itself.
const benchDone = buildPlan(routine, [
  ...Array.from({ length: 4 }, (_, i) => ({ type: 'strength', exercise: '卧推', at: i })),
]);
const prog2 = planProgress(benchDone);
check('a finished exercise is marked done', benchDone[0].isDone, true);
check('current moves to the next unfinished one', prog2.current.name, '上斜哑铃卧推');

// "Next" must never point at something already finished — being told to do an
// exercise you've completed is worse than being told nothing.
const middleDone = buildPlan(routine, [
  ...Array.from({ length: 3 }, (_, i) => ({ type: 'strength', exercise: '上斜哑铃卧推', at: i })),
]);
const prog3 = planProgress(middleDone);
check('current is still the unfinished first exercise', prog3.current.name, '卧推');
check('next skips the finished middle exercise', prog3.next.name, '三头下压');

// --- a complete session ----------------------------------------------------
const everything = routine.exercises.flatMap(ex =>
  Array.from({ length: ex.targetSets }, (_, i) => ({ type: 'strength', exercise: ex.name, at: i })));
const full = planProgress(buildPlan(routine, everything));
check('13 sets logged means complete', full.isComplete, true);
check('13 of 13', [full.doneSets, full.targetSets], [13, 13]);
check('100%', Math.round(full.pct), 100);
check('nothing left', full.remaining, 0);
check('current stays on the last exercise, so extra sets have somewhere to go',
  full.current.name, '夹胸飞鸟');
check('and there is no next', full.next, null);

// An empty routine must not throw or claim to be complete.
const empty = planProgress(buildPlan({ exercises: [] }, []));
check('an empty routine is not "complete"', empty.isComplete, false);
check('and reports the day target rather than 0', empty.targetSets, 13);

// --- reordering ------------------------------------------------------------
const ex = routine.exercises;
check('move down swaps with the one below',
  reorderExercises(ex, 0, 1).map(e => e.name)[0], '上斜哑铃卧推');
check('move up at the top is a no-op', reorderExercises(ex, 0, -1), ex);
check('move down at the bottom is a no-op', reorderExercises(ex, 3, 1), ex);
check('reorder does not mutate the original', ex.map(e => e.name)[0], '卧推');

// Reordering changes what's suggested, not whether anything is.
const reordered = { ...routine, exercises: reorderExercises(ex, 0, 1) };
check('after a swap, current follows the new order',
  planProgress(buildPlan(reordered, [])).current.name, '上斜哑铃卧推');

// --- prefill from last time ------------------------------------------------
const history = [
  { type: 'strength', exercise: '卧推', weightKg: 60, reps: 10, at: 100, date: '2026-08-15' },
  { type: 'strength', exercise: '卧推', weightKg: 65, reps: 8, at: 200, date: '2026-08-17' },
  { type: 'strength', exercise: '深蹲', weightKg: 80, reps: 5, at: 300, date: '2026-08-17' },
];
check('prefills the most recent set for that exercise',
  lastSetFor(history, '卧推'), { weightKg: 65, reps: 8, holdSec: 0, date: '2026-08-17' });
// A hold carries seconds, never reps — nothing may read "45" as forty-five reps.
check('a hold prefills its seconds, not reps',
  lastSetFor([{ type: 'strength', exercise: '靠墙静蹲', holdSec: 45, at: 1, date: '2026-08-20' }], '靠墙静蹲'),
  { weightKg: 0, reps: 0, holdSec: 45, date: '2026-08-20' });
check('a never-logged exercise has no prefill', lastSetFor(history, '面拉'), null);
check('cardio is never mistaken for a set',
  lastSetFor([{ type: 'cardio', activity: '跑步', at: 999 }], '跑步'), null);

// --- a whole session logged in one tap closes the day ----------------------
//
// The failure this guards against: quick-log "I did 板块 1", then the plan
// screen still says 0/20 and offers to start the workout. The app arguing with
// the user about whether he went to the gym.
const block1 = { block: 1, name: '板块 1 · 胸 + 三头', exercises: [
  { name: '上斜哑铃卧推', targetSets: 4 }, { name: '推胸机', targetSets: 4 },
]};
const sessionPlan = buildPlan(block1, [{ type: 'session', routineBlock: 1, setsPlanned: 8 }]);
check('a session record marks every exercise done', sessionPlan.map(p => p.isDone), [true, true]);
check('...without pretending the sets were individually logged',
  sessionPlan.map(p => p.loggedSets), [0, 0]);
check('...and the progress says the day is complete',
  planProgress(sessionPlan).isComplete, true);
check('...and says it came from a whole-session record',
  planProgress(sessionPlan).viaSession, true);

// The home version of the same block closes the gym version, and vice versa —
// that is what training block 1 at home actually means.
const homeBlock1 = { block: 1, name: '板块 1 · 胸 + 三头（徒手）', exercises: [{ name: '俯卧撑', targetSets: 4 }] };
check('a session logged at home closes the same block in the gym',
  buildPlan(homeBlock1, [{ type: 'session', routineBlock: 1 }])[0].isDone, true);
check('a session for a DIFFERENT block leaves this one open',
  buildPlan(block1, [{ type: 'session', routineBlock: 3 }])[0].isDone, false);

// Individually logged sets still work exactly as before.
const perSet = buildPlan(block1, [
  { type: 'strength', exercise: '上斜哑铃卧推' }, { type: 'strength', exercise: '上斜哑铃卧推' },
]);
check('logged sets still count one by one', perSet.map(p => p.doneSets), [2, 0]);
check('...and that is not flagged as a whole-session day',
  planProgress(perSet).viaSession, false);

// --- routine rotation ------------------------------------------------------
const routines = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
check('no history starts at the first routine',
  suggestRoutine(routines, [], '2026-08-19').routine.name, 'A');
check('after A, suggest B',
  suggestRoutine(routines, [{ date: '2026-08-18', routineName: 'A', at: 1, type: 'strength' }], '2026-08-19').routine.name, 'B');
check('after the last one, wrap around to the first',
  suggestRoutine(routines, [{ date: '2026-08-18', routineName: 'C', at: 1, type: 'strength' }], '2026-08-19').routine.name, 'A');
check('a session already started today wins over the rotation',
  suggestRoutine(routines, [
    { date: '2026-08-18', routineName: 'A', at: 1, type: 'strength' },
    { date: '2026-08-19', routineName: 'C', at: 2, type: 'strength' },
  ], '2026-08-19').routine.name, 'C');
check('and says so, so the UI can explain itself',
  suggestRoutine(routines, [{ date: '2026-08-19', routineName: 'C', at: 2, type: 'strength' }], '2026-08-19').reason,
  'in-progress');
check("today's CARDIO does not pin the strength routine",
  suggestRoutine(routines, [
    { date: '2026-08-18', routineName: 'A', at: 1, type: 'strength' },
    { date: '2026-08-19', type: 'cardio', activity: '跑步', at: 5 },
  ], '2026-08-19').routine.name, 'B');
check('no routines at all is handled', suggestRoutine([], [], '2026-08-19').routine, null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
