// 自适应 TDEE — the engine that calibrates a formula estimate against what the
// scale and the food log actually did. See src/utils/tdee.js.
//
// The cases at the bottom are the ones that decide whether this is safe to put
// in front of somebody: thin logging, a sparse weigh-in history, one salty
// dinner, and a week where nothing was written down at all.

import {
  KCAL_PER_KG, MIN_PLAUSIBLE_KCAL, MIN_COVERAGE, MAX_DEVIATION,
  shiftDate, daysBetween, dailyIntake, intakeStats, weightTrend, avgDailyBurn,
  adaptiveWeight, confidenceOf, recommendedWeeklyLoss, projectGoal, computeTdee,
} from '../src/utils/tdee.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const near = (name, got, want, tol) => {
  const ok = got != null && Math.abs(got - want) <= tol;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${got}\n      want ${want} ±${tol}`);
};

const TODAY = '2026-09-22';
const ago = (n) => shiftDate(TODAY, -n);

/** `days` of meals ending today, `kcal` each, as one record per day. */
const mealDays = (days, kcal, { skip = () => false, startAgo = null } = {}) => {
  const out = [];
  const first = startAgo ?? days - 1;
  for (let i = first; i >= 0; i--) {
    if (skip(i)) continue;
    out.push({ id: `m${i}`, date: ago(i), calories: typeof kcal === 'function' ? kcal(i) : kcal });
  }
  return out;
};

/** A weigh-in every `every` days over `days`, losing `weeklyKg` per week. */
const weighIns = (days, startKg, weeklyKg, { every = 2, jitter = () => 0 } = {}) => {
  const out = [];
  for (let i = days - 1; i >= 0; i -= every) {
    const elapsed = days - 1 - i;
    const kg = startKg + (weeklyKg / 7) * elapsed + jitter(i);
    out.push({ date: ago(i), kg: Math.round(kg * 10) / 10, at: 0 });
  }
  return out;
};

// --- date helpers ----------------------------------------------------------
check('daysBetween counts whole days', daysBetween('2026-09-01', '2026-09-22'), 21);
check('daysBetween is zero for the same day', daysBetween('2026-09-22', '2026-09-22'), 0);
check('shiftDate walks backwards across a month', shiftDate('2026-09-02', -5), '2026-08-28');
check('shiftDate walks forwards', shiftDate('2026-09-30', 2), '2026-10-02');

// --- intake ----------------------------------------------------------------
const twoDays = [
  { date: '2026-09-21', calories: 600 },
  { date: '2026-09-21', calories: 900 },
  { date: '2026-09-22', calories: 1700 },
];
check('meals on the same date add up',
  dailyIntake(twoDays).map((d) => [d.date, d.kcal]),
  [['2026-09-21', 1500], ['2026-09-22', 1700]]);
check('a window excludes what falls outside it',
  dailyIntake(twoDays, { from: '2026-09-22', to: '2026-09-22' }).length, 1);

const thin = intakeStats([
  { date: ago(3), calories: 1900 },
  { date: ago(2), calories: 300 },   // logged breakfast then gave up
  { date: ago(1), calories: 2100 },
], { from: ago(13), to: TODAY });
check('a 300 kcal day counts as partial, not as a diet day', thin.plausibleDays, 2);
check('...and is reported as partial', thin.partialDays, 1);
check('the average uses only the days that look complete', thin.avgKcal, 2000);
check('coverage runs from the first entry to today, not from the window edge',
  thin.coverage, 0.5);

check('no food log at all averages null rather than zero',
  intakeStats([], { from: ago(13), to: TODAY }).avgKcal, null);

// --- weight trend ----------------------------------------------------------
const t1 = weightTrend(weighIns(28, 66.0, -0.35), { from: ago(27), to: TODAY });
check('a clean 4-week log produces a trend', t1.ok, true);
near('...and recovers the weekly rate', t1.weeklyKg, -0.35, 0.05);

check('two weigh-ins are not a trend',
  weightTrend([{ date: ago(20), kg: 66 }, { date: ago(1), kg: 65 }], { from: ago(27), to: TODAY }).reason,
  'few-weigh-ins');
check('three weigh-ins inside one week are not a trend either',
  weightTrend([
    { date: ago(5), kg: 66.0 }, { date: ago(3), kg: 65.8 }, { date: ago(1), kg: 65.9 },
  ], { from: ago(27), to: TODAY }).reason,
  'short-span');

// Case F — one salty dinner in the middle of a clean run.
const withSpike = weighIns(28, 66.0, -0.35).map((w, i) =>
  (i === 6 ? { ...w, kg: Math.round((w.kg + 1.9) * 10) / 10 } : w));
const tSpike = weightTrend(withSpike, { from: ago(27), to: TODAY });
check('the outlier is dropped from the fit', Boolean(tSpike.dropped), true);
near('...and the trend survives it', tSpike.weeklyKg, -0.35, 0.08);
check('...but it is named, not silently deleted', typeof tSpike.dropped.date, 'string');

// A trend nobody has updated in three weeks is not today's trend.
const stale = weightTrend(
  [{ date: ago(27), kg: 66.4 }, { date: ago(21), kg: 66.1 }, { date: ago(15), kg: 65.8 }],
  { from: ago(27), to: TODAY });
check('a trend whose last reading is a fortnight old is stale', stale.reason, 'stale-weigh-in');
check('...and says how stale', stale.staleDays, 15);

// Coverage is anchored on the first entry, so two diligent weeks read as two
// diligent weeks rather than as half of a month.
const fresh = intakeStats(mealDays(14, 1900), { from: ago(27), to: TODAY });
check('a fortnight logged every day is fully covered', fresh.coverage, 1);
const lapsed = intakeStats(mealDays(28, 1900, { skip: (i) => i < 14 }), { from: ago(27), to: TODAY });
check('...but a fortnight logged then abandoned is half covered', lapsed.coverage, 0.5);

// Case D — sparse, irregular weigh-ins. The block-average method returns
// nothing here; a fitted line does not.
const sparse = [
  { date: ago(26), kg: 66.4 },
  { date: ago(19), kg: 66.1 },
  { date: ago(6), kg: 65.4 },
  { date: ago(1), kg: 65.2 },
];
const tSparse = weightTrend(sparse, { from: ago(27), to: TODAY });
check('four readings across four weeks still give a trend', tSparse.ok, true);
near('...at roughly the right rate', tSparse.weeklyKg, -0.33, 0.12);

// --- exercise average ------------------------------------------------------
check('exercise is averaged over calendar days, not training days',
  avgDailyBurn(
    [{ date: ago(1), calories: 300 }, { date: ago(3), calories: 400 }],
    { from: ago(13), to: TODAY }),
  50);
check('a workout with null calories contributes nothing, not NaN',
  avgDailyBurn([{ date: ago(1), calories: null }], { from: ago(6), to: TODAY }), 0);

// --- weighting -------------------------------------------------------------
check('under ten days of span buys nothing', adaptiveWeight({ observedDays: 9, coverage: 1 }), 0);
check('thin logging buys nothing however long the span',
  adaptiveWeight({ observedDays: 28, coverage: 0.4 }), 0);
check('four clean weeks reach the ceiling', adaptiveWeight({ observedDays: 28, coverage: 1 }), 0.6);
check('half-covered logging halves the weight',
  adaptiveWeight({ observedDays: 28, coverage: MIN_COVERAGE }), 0.3);
check('the ladder never reaches 1.0',
  adaptiveWeight({ observedDays: 400, coverage: 1 }) < 1, true);
check('confidence words follow the weight',
  [confidenceOf(0), confidenceOf(0.2), confidenceOf(0.4), confidenceOf(0.6)],
  ['none', 'low', 'medium', 'high']);

// --- rates and projections -------------------------------------------------
check('recommended loss is a range around half a percent',
  recommendedWeeklyLoss(65), { minKg: 0.33, maxKg: 0.49 });
check('no body weight, no recommendation', recommendedWeeklyLoss(null), null);

check('a goal at the current rate gets a date',
  projectGoal({ currentKg: 65, targetKg: 63, weeklyKg: -0.4, todayStr: TODAY }).weeks, 5);
check('...and the date is that many weeks out',
  projectGoal({ currentKg: 65, targetKg: 63, weeklyKg: -0.4, todayStr: TODAY }).etaDate, '2026-10-27');
check('a flat trend gets no completion date',
  projectGoal({ currentKg: 65, targetKg: 63, weeklyKg: 0, todayStr: TODAY }).weeks, null);
check('gaining while trying to lose gets no completion date',
  projectGoal({ currentKg: 65, targetKg: 63, weeklyKg: 0.3, todayStr: TODAY }).weeks, null);
check('already there is reported as reached',
  projectGoal({ currentKg: 63, targetKg: 63, weeklyKg: -0.4, todayStr: TODAY }).reached, true);
check('no target weight, no projection',
  projectGoal({ currentKg: 65, targetKg: null, weeklyKg: -0.4 }), null);

// --- the worked example from the brief -------------------------------------
//
// 1800 kcal/day, 0.7 kg over 14 days -> 385 kcal/day deficit -> TDEE 2185.
const worked = computeTdee({
  weightLog: weighIns(14, 66.0, -0.35, { every: 1 }),
  meals: mealDays(14, 1800),
  workouts: [],
  bmr: 1550,
  activityLevel: 'sedentary',
  todayStr: TODAY,
});
near('the brief\'s worked example lands where the brief says', worked.actualTDEE, 2185, 15);
check('...and it is a 14-day span, so the weight is 0.4', worked.adaptiveWeight, 0.4);
check('...reported as medium confidence', worked.confidence, 'medium');

// --- THE BLEND BUG THE BRIEF HAD -------------------------------------------
//
// The formula side must contain the same exercise the weight trend already
// contains. If it does not, every blended answer is short by roughly the
// average daily training burn — always downwards, which in a diet tool means
// recommending less food than the person actually needs.
const training = Array.from({ length: 16 }, (_, i) => ({ date: ago(i * 1.75 | 0), calories: 350 }));
const withGym = computeTdee({
  weightLog: weighIns(28, 66.0, -0.35),
  meals: mealDays(28, 2000),
  workouts: training,
  bmr: 1550,
  activityLevel: 'sedentary',
  todayStr: TODAY,
});
check('the formula side includes the window\'s average training burn',
  withGym.formulaTDEE, Math.round(1550 * 1.2) + withGym.avgExerciseBurn);
check('...so it is not the bare BMR × factor', withGym.formulaTDEE > Math.round(1550 * 1.2), true);

// --- Case A: steady loss ---------------------------------------------------
const caseA = computeTdee({
  weightLog: weighIns(28, 66.0, -0.4),
  meals: mealDays(28, 1850),
  workouts: [],
  bmr: 1550,
  activityLevel: 'light',
  goal: 'cut',
  todayStr: TODAY,
});
check('A: four clean weeks adapt at full weight', caseA.adaptiveWeight, 0.6);
near('A: actual TDEE is intake plus the implied deficit', caseA.actualTDEE, 1850 + 440, 30);
check('A: the effective number sits between formula and actual',
  caseA.effectiveTDEE >= Math.min(caseA.formulaTDEE, caseA.actualTDEE)
  && caseA.effectiveTDEE <= Math.max(caseA.formulaTDEE, caseA.actualTDEE), true);
check('A: the target is the TDEE minus the cut offset, not the formula',
  caseA.targetCalories, caseA.effectiveTDEE - 500);
check('A: nothing to explain away', caseA.reason, null);

// --- Case B: weight flat ---------------------------------------------------
const caseB = computeTdee({
  weightLog: weighIns(28, 65.5, 0),
  meals: mealDays(28, 2100),
  workouts: [],
  bmr: 1550,
  activityLevel: 'light',
  todayStr: TODAY,
});
near('B: a flat scale says TDEE equals intake', caseB.actualTDEE, 2100, 25);
check('B: the weekly projection is about zero', Math.abs(caseB.projectedWeeklyKg) < 0.1, true);

// --- Case C: implausibly fast loss is clamped ------------------------------
const caseC = computeTdee({
  weightLog: weighIns(28, 70.0, -1.6),
  meals: mealDays(28, 1500),
  workouts: [],
  bmr: 1550,
  activityLevel: 'sedentary',
  todayStr: TODAY,
});
check('C: a runaway actual figure is clamped', caseC.clamped, true);
check('C: ...to within the deviation band',
  caseC.effectiveTDEE <= Math.round(caseC.formulaTDEE * (1 + MAX_DEVIATION) / 10) * 10, true);

// --- Case E: thin food logging must not move anything ----------------------
const caseE = computeTdee({
  weightLog: weighIns(28, 66.0, -0.35),
  meals: mealDays(28, 1800, { skip: (i) => i % 3 !== 0 }),   // ~1 day in 3
  workouts: [],
  bmr: 1550,
  activityLevel: 'light',
  todayStr: TODAY,
});
check('E: a third of the days logged is not enough to adapt', caseE.adaptiveWeight, 0);
check('E: ...and it says why', caseE.reason, 'thin-food-log');
check('E: ...so the answer is still the formula', caseE.effectiveTDEE, caseE.formulaTDEE);
check('E: ...and confidence says none', caseE.confidence, 'none');

// A log full of 400 kcal "days" must be read as partial logging, not as a
// starvation diet that would push TDEE through the floor.
const caseE2 = computeTdee({
  weightLog: weighIns(28, 66.0, -0.35),
  meals: mealDays(28, 400),
  workouts: [],
  bmr: 1550,
  activityLevel: 'light',
  todayStr: TODAY,
});
check('E2: every day under the plausible floor counts as no coverage', caseE2.adaptiveWeight, 0);
check('E2: ...reported as a thin log, not believed', caseE2.reason, 'thin-food-log');

// --- Case D: no weight data at all -----------------------------------------
const caseD = computeTdee({
  weightLog: [],
  meals: mealDays(28, 1900),
  workouts: [],
  bmr: 1550,
  activityLevel: 'light',
  todayStr: TODAY,
});
check('D: no weigh-ins, no adaptation', caseD.adaptiveWeight, 0);
check('D: ...and it names the missing input', caseD.reason, 'few-weigh-ins');
check('D: the formula answer still works', caseD.formulaTDEE, Math.round(1550 * 1.35));

// --- Cases G and H: a rest day and a big training day ----------------------
//
// The point of the window average: what the target says must not lurch because
// of what happened in the last 24 hours.
const base = {
  weightLog: weighIns(28, 66.0, -0.35),
  meals: mealDays(28, 1900),
  bmr: 1550,
  activityLevel: 'light',
  goal: 'cut',
  todayStr: TODAY,
};
const restDay = computeTdee({ ...base, workouts: [{ date: ago(3), calories: 400 }] });
const bigDay = computeTdee({
  ...base,
  workouts: [{ date: ago(3), calories: 400 }, { date: TODAY, calories: 900 }],
});
check('G/H: one big session moves the daily target by less than 50 kcal',
  Math.abs(bigDay.targetCalories - restDay.targetCalories) < 50, true);
check('G/H: ...because it is a window average, and it moved a little',
  bigDay.effectiveTDEE >= restDay.effectiveTDEE, true);

// --- missing body profile --------------------------------------------------
const noProfile = computeTdee({ ...base, workouts: [], bmr: null });
check('no BMR, no numbers invented', [noProfile.formulaTDEE, noProfile.effectiveTDEE, noProfile.targetCalories],
  [null, null, null]);
check('...and it says what is missing', noProfile.reason, 'no-body-profile');

// --- the constants are what the comments claim -----------------------------
check('a kilo is 7700 kcal', KCAL_PER_KG, 7700);
check('the plausible floor is 800', MIN_PLAUSIBLE_KCAL, 800);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
