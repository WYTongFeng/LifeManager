// 本周回顾 — what actually happened this week, across food, training, money
// and body weight, computed from the RAW records rather than from `history`.
//
// WHY RAW RECORDS AND NOT `history`
// The first version of this file summed `dailyStats` (the per-day archive
// App.jsx writes at the midnight rollover). That was fine for the three numbers
// it had, and it is the wrong source for this one: a dailyStats row carries
// `totalCalories` but NOT protein, and nothing at all about body weight. The
// raw `meals`/`workouts`/`expenses` arrays carry every field, are never pruned
// (M13), and are fully synced — so a week from four months ago answers exactly
// as well as this one. `history` stays what it is: the XP ledger and the 7-day
// chart's source.
//
// THE PART THAT IS EASY TO GET WRONG
// Comparing this week against last week is only honest if both windows are the
// same LENGTH. On a Tuesday, this week has had two days to spend money in and
// last week had seven, so "you spent RM180 less than last week" would be a
// statement about it being Tuesday. cycle.js already argued this out for the
// monthly comparison (`grossSpentByDayIndex`, M23); `computeWeekComparison`
// below applies the same rule here — the previous week is clamped to the same
// number of elapsed days before anything is subtracted.
//
// Deliberately a plain Monday-start calendar week, NOT the money cycle from
// cycle.js. The cycle is specifically about money-cycle budgeting (resets on
// the 1st); "how was my week" is a different, more familiar question with
// its own normal calendar shape — conflating the two would make neither
// answer the question it's actually for.

import { getTodayString } from './storage.js';
import { num, sumBy } from './num.js';
import { isDailySpend } from './accounts.js';
import { countSets } from './workoutPlan.js';

/**
 * The Monday-start week containing `now`, optionally shifted by whole weeks.
 * `end` is exclusive, matching the convention used throughout this app
 * (see cycle.js's `isInCycle`).
 */
export function getWeek(now = new Date(), offsetWeeks = 0) {
  const ref = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = ref.getDay(); // 0=Sun..6=Sat
  const diffToMonday = (day + 6) % 7;
  const start = new Date(ref);
  start.setDate(start.getDate() - diffToMonday + offsetWeeks * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  return { start: getTodayString(start), end: getTodayString(end), startDate: start, endDate: end };
}

/**
 * `week.start` plus `index` days, as a date string.
 *
 * Built by hand from the parts rather than `new Date(week.start)` — the string
 * form is parsed as UTC midnight while getDate() reads it back in local time,
 * so west of UTC it lands a day early. The same trap Dashboard's day pills hit.
 */
export function dateAtDayIndex(week, index) {
  const [y, m, d] = week.start.split('-').map(Number);
  const at = new Date(y, m - 1, d);
  at.setDate(at.getDate() + index);
  return getTodayString(at);
}

/**
 * How many days of this week have actually happened, 0–7.
 *
 * A week in the past has had all seven; the current week has had as many as
 * today's position in it; a week in the future has had none. This is what makes
 * "average per day" and the week-vs-week comparison mean anything.
 */
export function daysElapsedIn(week, todayStr = null) {
  if (!todayStr) return 7;
  if (todayStr >= week.end) return 7;
  if (todayStr < week.start) return 0;
  for (let i = 0; i < 7; i++) {
    if (dateAtDayIndex(week, i) === todayStr) return i + 1;
  }
  return 7;
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Everything that happened inside one week window.
 *
 * @param {object}   p
 * @param {object[]} p.meals       ALL meals, any date — {date, calories, protein, ...}
 * @param {object[]} p.workouts    ALL workouts — strength sets, whole sessions, cardio
 * @param {object[]} p.expenses    ALL expenses
 * @param {object[]} p.weightLog   body-weight readings — {date, kg}
 * @param {object}   p.week        from getWeek()
 * @param {string|null} p.throughDate  inclusive upper bound INSIDE the week, so a
 *                                     partial week can be measured fairly against
 *                                     the same slice of another week. null = whole week.
 */
export function computeWeekReview({
  meals = [], workouts = [], expenses = [], weightLog = [], week, throughDate = null,
} = {}) {
  const inWindow = (date) =>
    typeof date === 'string' &&
    date >= week.start && date < week.end &&
    (!throughDate || date <= throughDate);

  // --- 饮食 ---------------------------------------------------------------
  //
  // Averages are per day LOGGED, not per day of the week. Dividing three logged
  // days across seven would report an 800 kcal/day average for someone eating
  // 1,900 — a true division producing a false statement, which is the exact
  // failure mode this app keeps running into. `daysLogged` ships alongside so
  // the screen can say what the average is actually an average OF.
  const weekMeals = meals.filter((m) => inWindow(m?.date));
  const mealDays = new Set(weekMeals.map((m) => m.date));
  const totalCalories = sumBy(weekMeals, (m) => m.calories);
  const totalProtein = sumBy(weekMeals, (m) => m.protein);
  const nutritionDays = mealDays.size;

  const nutrition = {
    daysLogged: nutritionDays,
    mealsLogged: weekMeals.length,
    totalCalories,
    totalProtein,
    avgCalories: nutritionDays ? Math.round(totalCalories / nutritionDays) : null,
    avgProtein: nutritionDays ? Math.round(totalProtein / nutritionDays) : null,
  };

  // --- 训练 ---------------------------------------------------------------
  //
  // Counted in DAYS, not records. "3 sessions" is the fact worth knowing, and
  // it has to be true whether those days were logged set-by-set (20 records) or
  // in one tap (1 record) — see workoutPlan.countSets for the same argument
  // about sets. Cardio is counted separately rather than folded in: a 30-minute
  // run is a real session but it is not a strength day.
  const weekWorkouts = workouts.filter((w) => inWindow(w?.date));
  const strengthWorkouts = weekWorkouts.filter((w) => w?.type !== 'cardio');
  const cardioWorkouts = weekWorkouts.filter((w) => w?.type === 'cardio');

  const training = {
    daysTrained: new Set(weekWorkouts.map((w) => w.date)).size,
    strengthDays: new Set(strengthWorkouts.map((w) => w.date)).size,
    cardioSessions: cardioWorkouts.length,
    totalSets: countSets(weekWorkouts),
    minutes: sumBy(weekWorkouts, (w) => w.durationMin),
    calories: sumBy(weekWorkouts, (w) => w.calories),
  };

  // --- 消费 ---------------------------------------------------------------
  //
  // `isDailySpend` from accounts.js, NOT a filter written here. That predicate
  // is the single place that knows a transfer isn't spending and an arriving
  // allowance isn't negative spending; re-deriving it locally is how this app
  // ended up with two screens disagreeing about the same month (M51). Nothing
  // in this file touches the cycle, the spendable figure, or net worth.
  const weekExpenses = expenses.filter((e) => inWindow(e?.date)).filter(isDailySpend);
  const money = {
    totalSpend: sumBy(weekExpenses, (e) => e.amount),
    entries: weekExpenses.length,
  };

  // --- 体重 ---------------------------------------------------------------
  //
  // THE BASELINE RULE, shared with bodyWeight.weightChangeOver.
  //
  // Prefer the week's OWN first reading; reach back to the last reading before
  // the week only when the week cannot stand on its own. Weighing in exactly
  // once, on Thursday, would otherwise compare that reading against itself and
  // report "no change" for a week in which the weight plainly moved — so the
  // fallback matters. But making the fallback the DEFAULT is the opposite
  // error: a week with two of its own readings would get its change measured
  // from some date before it, and the figure would silently cover more than the
  // week it is labelled with.
  const sorted = [...weightLog]
    .filter((w) => typeof w?.date === 'string' && num(w?.kg) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const inWeek = sorted.filter((w) => inWindow(w.date));
  const prior = sorted.filter((w) => w.date < week.start).pop() ?? null;

  const endKg = inWeek.length ? round1(num(inWeek[inWeek.length - 1].kg)) : null;
  const startKg = inWeek.length >= 2
    ? round1(num(inWeek[0].kg))
    : (prior ? round1(num(prior.kg)) : null);

  const body = {
    readings: inWeek.length,
    startKg,
    endKg,
    // Null, not 0, when there is nothing to compare against — "0.0kg change"
    // and "we don't know" are different statements and only one of them is true.
    changeKg: startKg != null && endKg != null ? round1(endKg - startKg) : null,
    latestKg: endKg ?? (prior ? round1(num(prior.kg)) : null),
  };

  return { week, throughDate, nutrition, training, money, body };
}

/**
 * This week and the comparable slice of last week, in one call.
 *
 * The clamping is done HERE rather than left to the caller precisely because
 * getting it wrong is invisible: both numbers are real, the subtraction is
 * correct, and the sentence it produces is still false.
 */
export function computeWeekComparison({
  meals = [], workouts = [], expenses = [], weightLog = [], week, todayStr = null,
} = {}) {
  const elapsed = daysElapsedIn(week, todayStr);
  const partial = elapsed > 0 && elapsed < 7;

  const previousWeek = getWeek(week.startDate, -1);
  const data = { meals, workouts, expenses, weightLog };

  return {
    elapsed,
    partial,
    current: computeWeekReview({
      ...data, week,
      throughDate: partial ? dateAtDayIndex(week, elapsed - 1) : null,
    }),
    previous: computeWeekReview({
      ...data, week: previousWeek,
      throughDate: partial ? dateAtDayIndex(previousWeek, elapsed - 1) : null,
    }),
  };
}

/**
 * Which domains of `previous` can honestly be compared against — checked one at
 * a time, never as a single "does this week have anything" flag.
 *
 * THE BUG THIS FIXES, WHICH WAS LIVE
 * The gate used to be `hasData(previous)`: true if the previous week held
 * anything in ANY domain. A week containing one stray weigh-in and nothing else
 * therefore counted as comparable for training and money too, and the review
 * announced 「训练 3 天，比上周多 3 天」 and 「花了 RM261，比上周多 RM261」 — both
 * arithmetically true against zero, and both reading as a dramatic improvement
 * when the real story was that the previous week simply had not been logged.
 *
 * A domain with no records last week cannot tell you whether nothing happened
 * or nothing was written down. Those are different facts and the app does not
 * know which it has, so it says nothing.
 */
export function comparableDomains(previous) {
  return {
    nutrition: (previous?.nutrition?.daysLogged ?? 0) > 0,
    training: (previous?.training?.daysTrained ?? 0) > 0,
    money: (previous?.money?.entries ?? 0) > 0,
  };
}

/** Did this window hold anything at all? Used for empty states, NOT for comparisons. */
export function hasData(review) {
  return Boolean(
    review &&
    (review.nutrition.daysLogged > 0 ||
      review.training.daysTrained > 0 ||
      review.money.entries > 0 ||
      review.body.readings > 0)
  );
}

// --- 这周值得知道的几句话 ------------------------------------------------------
//
// A screen full of numbers is not an insight, and the app already has plenty of
// screens full of numbers. These are the two or three SENTENCES worth reading,
// picked by rule — deterministically, in the app, with no model involved.
//
// WHY NOT AI
// Two reasons, in order. Cost: this runs on every open of the week card, and
// the Gemini budget is a hard 40 calls a day shared with the food estimator.
// Correctness: an arithmetic comparison is not something to ask a model to do —
// aiCoach.js's own system prompt says NEVER invent a number, and the way to
// honour that is to hand it numbers rather than ask it to derive them. The
// model's job is interpretation, and it gets this same structured summary to
// interpret (see aiCoach.js).
//
// EVERY RULE BELOW CAN DECLINE TO FIRE. That is the point. "Your consistency
// improved significantly" off the back of two logged days is exactly the
// failure this is built to avoid, so each rule states the data it needs and
// produces nothing when it isn't there.

/** Rounded to 1dp, without a trailing ".0" — 0.4 not 0.40, 1 not 1.0. */
const kg = (n) => String(Math.round(Math.abs(n) * 10) / 10);
const rm = (n) => Math.abs(n).toFixed(2);

/**
 * Up to `max` short factual lines about the week.
 *
 * @param {object} comparison  from computeWeekComparison()
 * @param {object} opts
 * @param {object} opts.macroTargets  {protein, carbs, fat} — the user's own targets
 * @param {string} opts.dietGoal      'cut' | 'maintain' | 'bulk', for reading a
 *                                    weight change as intended or not. Without it
 *                                    a change is reported and NOT judged.
 * @returns {{text: string, kind: 'good'|'warn'|'info'}[]}
 */
export function pickWeekHighlights(comparison, { macroTargets = null, dietGoal = null, max = 3 } = {}) {
  if (!comparison?.current) return [];
  const { current, previous, partial, elapsed } = comparison;
  // A week with nothing logged at all gets an empty state, not findings. The
  // rules below are about a week that HAPPENED; "还没记录饮食" is a useful
  // finding on a week you trained and spent in, and pure noise sitting under a
  // card that is already telling you the week is blank.
  if (!hasData(current)) return [];
  const out = [];
  // Per domain, never one flag for the lot — see comparableDomains.
  const can = comparableDomains(previous);
  // Named for what it actually is. When the current week is only three days
  // old, `previous` is the FIRST THREE DAYS of last week, not last week — and
  // a line that says "比上周少 RM42" while meaning that would be a lie by label.
  const vsLabel = partial ? '比上周同期' : '比上周';

  // 1. How much the rest of this is worth. Deliberately first: it qualifies
  //    every average below it, and an average of two days presented without
  //    that caveat is the kind of true-but-misleading number this app has
  //    been bitten by before.
  const { daysLogged } = current.nutrition;
  if (elapsed >= 4 && daysLogged === 0) {
    out.push({ text: '这周还没记录任何饮食', kind: 'info' });
  } else if (elapsed >= 4 && daysLogged <= 2) {
    out.push({ text: `这周只有 ${daysLogged} 天记录了饮食，下面的平均只代表这 ${daysLogged} 天`, kind: 'warn' });
  }

  // 2. 蛋白 vs the user's own target. Only against a target he actually set —
  //    inventing "you should eat 100g" would be advice, not a reading.
  const target = num(macroTargets?.protein);
  const avgProtein = current.nutrition.avgProtein;
  if (avgProtein != null && target > 0) {
    const short = target - avgProtein;
    out.push(short > 0
      ? { text: `蛋白平均 ${avgProtein}g/天，离 ${target}g 还差 ${short}g`, kind: 'warn' }
      : { text: `蛋白平均 ${avgProtein}g/天，达标了（目标 ${target}g）`, kind: 'good' });
  }

  // 3. The cross-domain sentence — weight moving, with training as its context.
  //    A weight change on its own is a number; a weight change next to how much
  //    you trained is the thing actually worth reading.
  //
  //    Under 0.2kg is not reported at all: that is water, not progress, and
  //    dressing it up as either would make the line noise.
  const change = current.body.changeKg;
  if (change != null && Math.abs(change) >= 0.2) {
    const dropped = change < 0;
    const trained = current.training.daysTrained;
    const context = trained >= 2 ? `，这周训练 ${trained} 天` : '';
    // Judged only when the goal says which direction was wanted.
    const intended = dietGoal === 'cut' ? dropped : dietGoal === 'bulk' ? !dropped : null;
    out.push({
      text: `体重 ${kg(current.body.startKg)} → ${kg(current.body.endKg)}kg（${dropped ? '-' : '+'}${kg(change)}）${context}`,
      kind: intended === true ? 'good' : intended === false ? 'warn' : 'info',
    });
  }

  // 4. Training frequency, against the comparable slice of last week.
  if (can.training) {
    const now = current.training.daysTrained;
    const then = previous.training.daysTrained;
    if (now !== then) {
      out.push(now > then
        ? { text: `训练 ${now} 天，${vsLabel}多 ${now - then} 天`, kind: 'good' }
        : { text: `训练 ${now} 天，${vsLabel}少 ${then - now} 天`, kind: 'warn' });
    } else if (now > 0) {
      out.push({ text: `训练 ${now} 天，和上周同期一样`, kind: 'info' });
    }
  }

  // 5. Spending, same comparison. Sub-RM1 differences are skipped — a line
  //    reporting that you spent 40 sen more than last week is not information.
  if (can.money) {
    const diff = current.money.totalSpend - previous.money.totalSpend;
    if (Math.abs(diff) >= 1) {
      out.push(diff > 0
        ? { text: `花了 RM${rm(current.money.totalSpend)}，${vsLabel}多 RM${rm(diff)}`, kind: 'warn' }
        : { text: `花了 RM${rm(current.money.totalSpend)}，${vsLabel}少 RM${rm(diff)}`, kind: 'good' });
    }
  }

  return out.slice(0, max);
}
