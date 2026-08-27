import {
  getWeek, dateAtDayIndex, daysElapsedIn,
  computeWeekReview, computeWeekComparison, hasData, pickWeekHighlights, comparableDomains,
} from '../src/utils/weekStats.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// 2026-08-14 is a Friday.
const friday = new Date(2026, 7, 14);

// --- getWeek -----------------------------------------------------------
const thisWeek = getWeek(friday, 0);
check('current week starts on Monday', thisWeek.start, '2026-08-10');
check('current week end is exclusive, the following Monday', thisWeek.end, '2026-08-17');

const lastWeek = getWeek(friday, -1);
check('offset -1 is exactly 7 days earlier', lastWeek.start, '2026-08-03');
check('offset -1 end matches this week\'s start', lastWeek.end, thisWeek.start);

const nextWeek = getWeek(friday, 1);
check('offset +1 is exactly 7 days later', nextWeek.start, '2026-08-17');

// A Monday and a Sunday should land in the SAME week as each other.
const monday = new Date(2026, 7, 10);
const sunday = new Date(2026, 7, 16);
check('Monday itself starts its own week', getWeek(monday, 0).start, '2026-08-10');
check('the Sunday six days later is still in that same week', getWeek(sunday, 0).start, '2026-08-10');

// Year rollover: 2026-01-01 is a Thursday, so its week starts in December 2025.
const newYearsDay = new Date(2026, 0, 1);
check('a week can start in the previous year', getWeek(newYearsDay, 0).start, '2025-12-29');

// --- dateAtDayIndex ------------------------------------------------------
check('day index 0 is the week start', dateAtDayIndex(thisWeek, 0), '2026-08-10');
check('day index 4 is the Friday', dateAtDayIndex(thisWeek, 4), '2026-08-14');
check('day index 6 is the last day, not the exclusive end', dateAtDayIndex(thisWeek, 6), '2026-08-16');
// Month boundary: 2026-07-27 is a Monday, so index 6 crosses into August.
check('an index can cross a month boundary',
  dateAtDayIndex(getWeek(new Date(2026, 6, 27), 0), 6), '2026-08-02');

// --- daysElapsedIn -------------------------------------------------------
check('Friday is the 5th day of its week', daysElapsedIn(thisWeek, '2026-08-14'), 5);
check('the Monday itself is day 1', daysElapsedIn(thisWeek, '2026-08-10'), 1);
check('a finished week has had all 7 days', daysElapsedIn(lastWeek, '2026-08-14'), 7);
check('a future week has had none', daysElapsedIn(nextWeek, '2026-08-14'), 0);
check('no "today" at all means treat the week as whole', daysElapsedIn(thisWeek, null), 7);

// --- computeWeekReview: 饮食 ---------------------------------------------
//
// Three logged days inside the week, one meal outside it. The average must be
// over the days ACTUALLY LOGGED (3), never over the seven days of the week —
// dividing 5,700 kcal by 7 would report 814 kcal/day for someone eating 1,900.
const meals = [
  { date: '2026-08-09', calories: 9999, protein: 999 },        // Sunday, prior week
  { date: '2026-08-10', calories: 1000, protein: 50 },
  { date: '2026-08-10', calories: 900, protein: 40 },
  { date: '2026-08-12', calories: 1900, protein: 100 },
  { date: '2026-08-14', calories: 1900, protein: 90 },
  { date: '2026-08-20', calories: 9999, protein: 999 },        // next week
];

const nutritionOnly = computeWeekReview({ meals, week: thisWeek });
check('only this week\'s meals are counted', nutritionOnly.nutrition.totalCalories, 5700);
check('days logged counts distinct dates, not records', nutritionOnly.nutrition.daysLogged, 3);
check('meals logged counts records', nutritionOnly.nutrition.mealsLogged, 4);
check('avg calories divides by days LOGGED, not by 7', nutritionOnly.nutrition.avgCalories, 1900);
check('avg protein divides by days LOGGED too', nutritionOnly.nutrition.avgProtein, 93);

const noMeals = computeWeekReview({ meals: [], week: thisWeek });
check('no meals means no average, not zero', noMeals.nutrition.avgCalories, null);
check('no meals means no protein average either', noMeals.nutrition.avgProtein, null);

// A record with a missing/garbage number must cost one row, not the whole total.
const dirty = computeWeekReview({
  meals: [{ date: '2026-08-10', calories: 500 }, { date: '2026-08-10', calories: undefined }],
  week: thisWeek,
});
check('a record with no calories does not NaN the total', dirty.nutrition.totalCalories, 500);

// --- computeWeekReview: 训练 ---------------------------------------------
//
// The critical case: a whole session logged in ONE tap (type: 'session') is a
// training DAY and is worth the sets it planned. Counting records would make a
// 20-set chest day score 1 while three lazy sets score 3.
const workouts = [
  { date: '2026-08-08', type: 'session', setsPlanned: 20, durationMin: 60 },  // prior week
  { date: '2026-08-10', type: 'session', setsPlanned: 20, durationMin: 55, calories: 300 },
  { date: '2026-08-12', type: 'strength', exercise: '卧推', weightKg: 45, reps: 8, calories: 10 },
  { date: '2026-08-12', type: 'strength', exercise: '卧推', weightKg: 45, reps: 8, calories: 10 },
  { date: '2026-08-12', type: 'strength', exercise: '卧推', weightKg: 47.5, reps: 7, calories: 10 },
  { date: '2026-08-13', type: 'cardio', activity: '跑步', durationMin: 30, calories: 250 },
];

const t = computeWeekReview({ workouts, week: thisWeek }).training;
check('days trained counts distinct dates across all workout types', t.daysTrained, 3);
check('strength days exclude the cardio-only day', t.strengthDays, 2);
check('cardio sessions are counted separately', t.cardioSessions, 1);
check('a one-tap session is worth its planned sets, and cardio worth none', t.totalSets, 23);
check('minutes sum across session and cardio', t.minutes, 85);
check('workout calories sum across every type', t.calories, 580);

// --- computeWeekReview: 消费 ---------------------------------------------
//
// Must use accounts.js's isDailySpend: expense + refund only. A transfer, an
// arriving allowance, a rent bill and a debt repayment are all real records
// with real amounts and NONE of them is this week's spending.
const expenses = [
  { date: '2026-08-09', amount: 500 },                              // prior week
  { date: '2026-08-10', amount: 50 },                               // expense
  { date: '2026-08-11', amount: 30 },                               // expense
  { date: '2026-08-11', amount: -10 },                              // refund, nets off
  { date: '2026-08-12', amount: -1200, isMoneyIn: true },           // allowance arriving
  { date: '2026-08-12', amount: 200, isAccountTransfer: true },     // own money moving
  { date: '2026-08-13', amount: 450, allocationId: 'rent' },        // fixed bill
  { date: '2026-08-13', amount: 300, repaysDebtId: 'ptptn' },       // debt repayment
];

const m = computeWeekReview({ expenses, week: thisWeek }).money;
check('spend is expenses net of refunds, and nothing else', m.totalSpend, 70);
check('only expense/refund records are counted as entries', m.entries, 3);

// --- computeWeekReview: 体重 ---------------------------------------------
//
// One weigh-in this week, with a reading from before it. The change must be
// measured against the PRIOR reading — comparing the single reading against
// itself would report "no change" for a week in which the weight moved.
const weightLog = [
  { date: '2026-08-06', kg: 67.0 },
  { date: '2026-08-13', kg: 66.6 },
];
const b1 = computeWeekReview({ weightLog, week: thisWeek }).body;
check('a single weigh-in is measured against the last prior reading', b1.startKg, 67);
check('the week ends at its last reading', b1.endKg, 66.6);
check('the change is against the prior reading, not zero', b1.changeKg, -0.4);

// Two readings inside the week and nothing before: use the week's own first.
const b2 = computeWeekReview({
  weightLog: [{ date: '2026-08-10', kg: 67.2 }, { date: '2026-08-15', kg: 66.8 }],
  week: thisWeek,
}).body;
check('with no prior reading, two in-week readings still give a change', b2.changeKg, -0.4);

// A week that CAN stand on its own must not reach outside itself: measuring
// from 2026-08-01 would make "this week's change" cover three weeks.
const b2b = computeWeekReview({
  weightLog: [
    { date: '2026-08-01', kg: 69.0 },
    { date: '2026-08-10', kg: 67.2 },
    { date: '2026-08-15', kg: 66.8 },
  ],
  week: thisWeek,
}).body;
check('two in-week readings are preferred over an older baseline', b2b.startKg, 67.2);
check('...so the change covers the week, not the month', b2b.changeKg, -0.4);

// One reading, nothing before it: there is genuinely nothing to compare to.
const b3 = computeWeekReview({ weightLog: [{ date: '2026-08-13', kg: 66.6 }], week: thisWeek }).body;
check('one reading and no history means no change figure', b3.changeKg, null);
check('...but the reading itself is still reported', b3.latestKg, 66.6);
check('no readings at all', computeWeekReview({ weightLog: [], week: thisWeek }).body.changeKg, null);

// --- computeWeekComparison: the partial-week clamp -----------------------
//
// THE TEST THIS FILE EXISTS FOR. On the Wednesday of a week, comparing against
// last week must compare against last week's FIRST THREE DAYS. Without the
// clamp, last week gets seven days of spending and this week gets three, and
// the app reports a saving that is really just the calendar.
const wednesday = '2026-08-12';
const spendBothWeeks = [
  // Last week: RM30 in its first 3 days, RM300 more in its last 4.
  { date: '2026-08-03', amount: 10 },
  { date: '2026-08-05', amount: 20 },
  { date: '2026-08-07', amount: 300 },
  // This week, through Wednesday: RM40.
  { date: '2026-08-10', amount: 40 },
  // Later in this week — must NOT count while we are only on Wednesday.
  { date: '2026-08-15', amount: 999 },
];

const cmp = computeWeekComparison({ expenses: spendBothWeeks, week: thisWeek, todayStr: wednesday });
check('a mid-week comparison knows how many days have elapsed', cmp.elapsed, 3);
check('and flags itself as partial', cmp.partial, true);
check('the current week stops at today, ignoring later records', cmp.current.money.totalSpend, 40);
check('the previous week is clamped to the SAME 3 days', cmp.previous.money.totalSpend, 30);

// The same data on the Sunday: both weeks are whole, so the RM300 counts.
const wholeCmp = computeWeekComparison({ expenses: spendBothWeeks, week: thisWeek, todayStr: '2026-08-16' });
check('on the last day of the week nothing is clamped', wholeCmp.partial, false);
check('a whole week sees the whole previous week', wholeCmp.previous.money.totalSpend, 330);
check('and the whole current week', wholeCmp.current.money.totalSpend, 1039);

// A week entirely in the past is never clamped, whatever today is.
const pastCmp = computeWeekComparison({ expenses: spendBothWeeks, week: lastWeek, todayStr: '2026-08-14' });
check('a finished week is not partial', pastCmp.partial, false);
check('a finished week counts all of itself', pastCmp.current.money.totalSpend, 330);

// --- hasData -------------------------------------------------------------
check('an empty week has no data', hasData(computeWeekReview({ week: thisWeek })), false);
check('one meal is enough to count as data',
  hasData(computeWeekReview({ meals: [{ date: '2026-08-10', calories: 100 }], week: thisWeek })), true);
check('a weigh-in alone counts as data',
  hasData(computeWeekReview({ weightLog: [{ date: '2026-08-10', kg: 67 }], week: thisWeek })), true);

// --- pickWeekHighlights --------------------------------------------------
//
// Every rule must be able to DECLINE. A line the data does not support is worse
// than no line, because it reads exactly like one that is true.
const emptyCmp = computeWeekComparison({ week: thisWeek, todayStr: '2026-08-14' });
check('an empty week produces no claims at all',
  pickWeekHighlights(emptyCmp, { macroTargets: { protein: 100 } }).length, 0);

// ...but a week you trained in and logged no food in is a real finding: the
// silence is about the food log, not about the week.
const trainedNoFoodCmp = computeWeekComparison({ workouts, week: thisWeek, todayStr: '2026-08-14' });
check('no food logged in a week that had training IS worth saying',
  pickWeekHighlights(trainedNoFoodCmp, {})[0],
  { text: '这周还没记录任何饮食', kind: 'info' });

// Protein against a target the user actually set.
const proteinCmp = computeWeekComparison({ meals, week: thisWeek, todayStr: '2026-08-16' });
check('protein is reported against the target, with the shortfall named',
  pickWeekHighlights(proteinCmp, { macroTargets: { protein: 100 } })[0],
  { text: '蛋白平均 93g/天，离 100g 还差 7g', kind: 'warn' });
check('with no target set, no protein line is invented',
  pickWeekHighlights(proteinCmp, { macroTargets: null }).some(h => h.text.includes('蛋白')), false);
check('hitting the target reads as good',
  pickWeekHighlights(proteinCmp, { macroTargets: { protein: 90 } })[0].kind, 'good');

// The thin-data caveat comes first and qualifies everything under it.
const thinCmp = computeWeekComparison({
  meals: [{ date: '2026-08-10', calories: 1900, protein: 120 }],
  week: thisWeek, todayStr: '2026-08-14',
});
const thin = pickWeekHighlights(thinCmp, { macroTargets: { protein: 100 } });
check('one logged day out of five earns a caveat, stated first',
  thin[0], { text: '这周只有 1 天记录了饮食，下面的平均只代表这 1 天', kind: 'warn' });
check('the average is still shown, after the caveat', thin[1].text.includes('蛋白平均 120g/天'), true);

// Early in the week there is not yet enough missing to complain about.
const mondayCmp = computeWeekComparison({ meals: [], week: thisWeek, todayStr: '2026-08-10' });
check('on the Monday, an unlogged day is not yet a finding',
  pickWeekHighlights(mondayCmp, {}).some(h => h.text.includes('还没记录')), false);

// Weight + training, the cross-domain line.
const bodyCmp = computeWeekComparison({ weightLog, workouts, week: thisWeek, todayStr: '2026-08-16' });
const cut = pickWeekHighlights(bodyCmp, { dietGoal: 'cut' });
check('a weight drop while cutting reads as good, with training as context',
  cut.find(h => h.text.startsWith('体重')),
  { text: '体重 67 → 66.6kg（-0.4），这周训练 3 天', kind: 'good' });
check('the same drop while bulking reads as a warning',
  pickWeekHighlights(bodyCmp, { dietGoal: 'bulk' }).find(h => h.text.startsWith('体重')).kind, 'warn');
check('with no goal set, the change is reported but not judged',
  pickWeekHighlights(bodyCmp, {}).find(h => h.text.startsWith('体重')).kind, 'info');

// Noise floor: 100g is water, not progress.
const noiseCmp = computeWeekComparison({
  weightLog: [{ date: '2026-08-06', kg: 67.0 }, { date: '2026-08-13', kg: 66.9 }],
  week: thisWeek, todayStr: '2026-08-16',
});
check('a 0.1kg move is not reported as a change',
  pickWeekHighlights(noiseCmp, { dietGoal: 'cut' }).some(h => h.text.startsWith('体重')), false);

// Comparisons name the window they actually used.
const partialLabelCmp = computeWeekComparison({ expenses: spendBothWeeks, week: thisWeek, todayStr: wednesday });
check('a clamped comparison says "同期", not "上周"',
  partialLabelCmp.partial &&
  pickWeekHighlights(partialLabelCmp, {}).some(h => h.text.includes('比上周同期')), true);
check('a whole-week comparison says plainly "比上周"',
  pickWeekHighlights(wholeCmp, {}).some(h => h.text.includes('比上周多') || h.text.includes('比上周少')), true);

// Nothing to compare against.
const noPrevCmp = computeWeekComparison({
  expenses: [{ date: '2026-08-10', amount: 50 }], week: thisWeek, todayStr: '2026-08-16',
});
check('with no previous week logged, no comparison is claimed',
  pickWeekHighlights(noPrevCmp, {}).some(h => h.text.includes('比上周')), false);

// COMPARABILITY IS PER DOMAIN, and this is the case that proves it matters.
// Last week holds exactly one weigh-in and nothing else. A single "did last
// week have anything at all" flag reads that as comparable and produces
// 「训练 3 天，比上周多 3 天」 and 「花了 RM261，比上周多 RM261」 — both true
// against zero, and both describing a week that simply was not logged.
const strayWeighIn = computeWeekComparison({
  workouts: [{ date: '2026-08-10', type: 'session', setsPlanned: 20 }],
  expenses: [{ date: '2026-08-10', amount: 261 }],
  weightLog: [{ date: '2026-08-05', kg: 67 }],   // last week: this and nothing else
  week: thisWeek, todayStr: '2026-08-16',
});
check('last week held SOMETHING, so a naive gate would compare',
  hasData(strayWeighIn.previous), true);
check('...but training is not comparable against a week with no training',
  comparableDomains(strayWeighIn.previous).training, false);
check('...nor spending against a week with no spending',
  comparableDomains(strayWeighIn.previous).money, false);
check('so no training comparison is claimed',
  pickWeekHighlights(strayWeighIn, {}).some(h => h.text.includes('训练') && h.text.includes('比上周')), false);
check('and no spending comparison is claimed',
  pickWeekHighlights(strayWeighIn, {}).some(h => h.text.includes('花了')), false);

// One domain being comparable must not switch the others on.
const onlyMoneyLastWeek = computeWeekComparison({
  workouts: [{ date: '2026-08-10', type: 'session', setsPlanned: 20 }],
  expenses: [{ date: '2026-08-04', amount: 100 }, { date: '2026-08-10', amount: 50 }],
  week: thisWeek, todayStr: '2026-08-16',
});
check('spending IS comparable when last week had spending',
  comparableDomains(onlyMoneyLastWeek.previous).money, true);
check('...while training stays incomparable in the same week',
  comparableDomains(onlyMoneyLastWeek.previous).training, false);
check('so the spend line appears',
  pickWeekHighlights(onlyMoneyLastWeek, {}).some(h => h.text.includes('花了')), true);
check('and the training line does not',
  pickWeekHighlights(onlyMoneyLastWeek, {}).some(h => h.text.includes('训练') && h.text.includes('比上周')), false);

// Sub-ringgit differences are not information.
const centsCmp = computeWeekComparison({
  expenses: [{ date: '2026-08-03', amount: 50 }, { date: '2026-08-10', amount: 50.4 }],
  week: thisWeek, todayStr: '2026-08-16',
});
check('a 40-sen difference is not worth a line',
  pickWeekHighlights(centsCmp, {}).some(h => h.text.includes('花了')), false);

check('at most 3 lines are returned',
  pickWeekHighlights(bodyCmp, { macroTargets: { protein: 100 } }).length <= 3, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
