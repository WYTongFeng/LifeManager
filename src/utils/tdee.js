// 自适应 TDEE —— 用真实体重趋势 + 真实摄入，校准公式估出来的消耗。
//
// WHAT WAS WRONG WITH THE OLD NUMBER
// calories.js computes a target open-loop: BMR × activity factor + today's
// logged workout + a goal offset. Every input is an estimate and nothing ever
// checks the result against reality. Mifflin-St Jeor is ±10-15% for an
// individual; the activity factor is a three-way guess; the MET figures for a
// gym session are population averages. Stack them and the "budget" can be 300
// kcal off in either direction, forever, with no way to find out.
//
// The app already stores the two series that CAN find out: `weightLog`
// (bodyWeight.js) and dated meal records. Energy balance says that over a long
// enough window,
//
//     average intake - average expenditure = weight change × 7700 / days
//
// so expenditure can be solved for. That is what this file does.
//
// THREE NUMBERS, AND THEY ARE NOT THE SAME NUMBER
//
//   formulaTDEE   BMR × NEAT factor + the window's average daily exercise burn
//   actualTDEE    average intake + the deficit implied by the weight trend
//   effectiveTDEE a confidence-weighted blend of the two
//
// The exercise term in `formulaTDEE` is the part that is easy to get wrong.
// This app's ACTIVITY_LEVELS are deliberately NEAT-only (see calories.js) —
// exercise is measured separately and added per day. But `actualTDEE`, derived
// from body weight, inevitably INCLUDES whatever training happened. Blending a
// no-exercise number with an all-in number understates expenditure by roughly
// the average daily training burn, every single day, and always downwards.
// So the exercise average is added to the formula side first, and only then
// are the two blended.
//
// WHY NOT DISCOUNT THE LOGGED EXERCISE BURN
// A common suggestion is to trust gym calorie estimates at 60-80%. Not done
// here, for two reasons. It would change every other burn figure in the app
// (today's total, the week review, the text export) for a reason that belongs
// only inside this blend; and it double-corrects — if the METs run hot, the
// weight trend already says so and `actualTDEE` lands below `formulaTDEE`.
// Let the calibration absorb the error instead of guessing at it twice.
//
// THE FAILURE MODE THIS FILE IS MOST CAREFUL ABOUT
// Under-logged food. A day with no meals recorded is not a day of fasting, and
// a day with one 250 kcal entry is not a 250 kcal day. Averaging those in drags
// `actualTDEE` down, which lowers the recommended target, which is the one
// direction a diet tool must never be casually wrong in. So only days that look
// completely logged count toward the average, and the fraction of the window
// they cover gates how much the adaptive number is allowed to move anything.

import { num, sumBy } from './num.js';
import { getTodayString } from './storage.js';
import { normalizeWeightLog } from './bodyWeight.js';
import { ACTIVITY_LEVELS, DEFAULT_ACTIVITY, DIET_GOALS, DEFAULT_GOAL } from './calories.js';

/** Energy in a kilogram of body mass. The standard figure for fat tissue. */
export const KCAL_PER_KG = 7700;

/** How far back to look. Four weeks: long enough for a trend, short enough to still be current. */
export const WINDOW_DAYS = 28;

/** Weigh-ins must span at least this many days before a trend means anything. */
export const MIN_TREND_SPAN_DAYS = 10;

/**
 * A trend whose newest reading is older than this is stale, and stops driving
 * anything. Four tidy weeks of weigh-ins that stopped three weeks ago describe
 * a body that no longer exists; the honest answer there is to fall back to the
 * formula and say the scale has gone quiet, not to keep quoting an old slope
 * with a confident face.
 */
export const MAX_STALE_DAYS = 10;

/** At least this many readings, however they are spaced. Two points is a line, not a trend. */
export const MIN_WEIGH_INS = 3;

/**
 * Below this, a day's food log is treated as PARTIAL rather than as a real
 * low-calorie day. Nobody who is logging properly eats 500 kcal; somebody who
 * logged breakfast and then went out does.
 */
export const MIN_PLAUSIBLE_KCAL = 800;

/** Fraction of the window that must be properly logged before adapting at all. */
export const MIN_COVERAGE = 0.5;

/**
 * How far the blended answer may sit from the formula baseline, as a fraction.
 *
 * This replaces the usual "move at most ±75 kcal per update" rule, which needs
 * a stored previous value — and a stored number drifts out of step with the
 * data that produced it, syncs between devices, and goes stale while the app
 * sits in the background for days (see the notes in storage.js). Everything
 * here is a pure function of the log, so it recomputes identically anywhere,
 * and slowness comes from the 28-day window instead of from memory.
 */
export const MAX_DEVIATION = 0.25;

/** A reading this far off the fitted line is treated as water weight, not signal. */
export const OUTLIER_KG = 1.5;

/** Sensible weekly loss, as a fraction of body weight. */
export const LOSS_RATE_MIN = 0.005;
export const LOSS_RATE_MAX = 0.0075;

const round = (n, step = 1) => Math.round(n / step) * step;

/** YYYY-MM-DD `days` before `from`. */
export function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return getTodayString(dt);
}

/** Whole days between two YYYY-MM-DD strings. */
export function daysBetween(from, to) {
  const [ay, am, ad] = from.split('-').map(Number);
  const [by, bm, bd] = to.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
}

/**
 * kcal per calendar date from dated meal records.
 *
 * Only dates that actually have records appear — a date with no meals is
 * absent, NOT zero, because "did not eat" and "did not write it down" are
 * different statements and only one of them is ever true here.
 */
export function dailyIntake(meals = [], { from, to } = {}) {
  const byDate = new Map();
  for (const m of meals) {
    const date = m?.date;
    if (!date) continue;
    if (from && date < from) continue;
    if (to && date > to) continue;
    const row = byDate.get(date) ?? { date, kcal: 0, entries: 0 };
    row.kcal += num(m.calories);
    row.entries += 1;
    byDate.set(date, row);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Average daily intake over the window, and how much of the window it covers.
 *
 * `avgKcal` divides by PLAUSIBLE days, not by calendar days — the same rule
 * weekStats.js uses for its weekly averages, and for the same reason: dividing
 * three logged days across a week reports an 800 kcal/day habit for someone
 * eating 1,900. The cost of that choice is an assumption, stated out loud
 * everywhere this number is shown: the days that were not logged looked roughly
 * like the days that were. `coverage` is how much that assumption is being
 * asked to carry.
 */
export function intakeStats(meals = [], { from, to } = {}) {
  const days = dailyIntake(meals, { from, to });
  const plausible = days.filter((d) => d.kcal >= MIN_PLAUSIBLE_KCAL);
  const windowDays = Math.max(1, daysBetween(from, to) + 1);

  // COVERAGE IS MEASURED FROM THE FIRST DAY THERE IS ANY LOG, not from the
  // start of the window. Somebody who started using this a fortnight ago and
  // has logged every single day since is not half-covered — but dividing by a
  // fixed 28 says he is, and would hold a diligent new user at low confidence
  // for weeks for no reason. Anchoring on his own first entry separates "new
  // and thorough" from "been here a month and stopped", which is the
  // distinction that actually matters.
  const spanDays = days.length
    ? Math.max(1, daysBetween(days[0].date, to) + 1)
    : windowDays;

  return {
    windowDays,
    spanDays,
    loggedDays: days.length,
    plausibleDays: plausible.length,
    partialDays: days.length - plausible.length,
    coverage: plausible.length / spanDays,
    avgKcal: plausible.length ? Math.round(sumBy(plausible, (d) => d.kcal) / plausible.length) : null,
    days,
  };
}

/** Least-squares slope of kg against day index. Returns null when undefined. */
function fitSlope(points) {
  const n = points.length;
  if (n < 2) return null;
  const meanT = points.reduce((s, p) => s + p.t, 0) / n;
  const meanKg = points.reduce((s, p) => s + p.kg, 0) / n;
  let numer = 0;
  let denom = 0;
  for (const p of points) {
    numer += (p.t - meanT) * (p.kg - meanKg);
    denom += (p.t - meanT) ** 2;
  }
  if (denom === 0) return null;
  const slope = numer / denom;
  return { slope, intercept: meanKg - slope * meanT };
}

/**
 * Weight trend over the window, as kg per day.
 *
 * A LINE FITTED TO EVERY READING, not the difference between two 7-day block
 * averages. The block method is the textbook one and it assumes daily weigh-ins:
 * it needs readings inside BOTH blocks, and returns nothing at all when a week
 * happens to contain none. This app's weigh-ins are neither daily nor evenly
 * spaced — `recordWeight` only fires when the number CHANGES, and it is entered
 * through a settings modal nobody opens every morning — so a fit over whatever
 * readings exist is both more robust and more honest about irregular spacing.
 *
 * One round of outlier rejection: a reading more than OUTLIER_KG off the line
 * is almost always water (a salty dinner, a bad night, training inflammation),
 * and a single one of those inside a fortnight can double or erase an apparent
 * trend. It is dropped from the FIT only — never from the log, which is a record
 * of what the scale said.
 */
export function weightTrend(weightLog = [], { from, to } = {}) {
  const all = normalizeWeightLog(weightLog);
  const inWindow = all.filter((w) => (!from || w.date >= from) && (!to || w.date <= to));
  if (inWindow.length < MIN_WEIGH_INS) {
    return { ok: false, reason: 'few-weigh-ins', weighIns: inWindow.length, spanDays: 0 };
  }

  const base = inWindow[0].date;
  let points = inWindow.map((w) => ({ t: daysBetween(base, w.date), kg: w.kg, date: w.date }));
  const spanDays = points[points.length - 1].t;
  if (spanDays < MIN_TREND_SPAN_DAYS) {
    return { ok: false, reason: 'short-span', weighIns: points.length, spanDays };
  }

  // How long this trend has been under observation, counted to TODAY rather
  // than to the last reading. That is what the confidence ladder should be
  // reading: needing a weigh-in on both the first and the twenty-eighth day of
  // the window to call four weeks "four weeks" is a rule nobody's actual
  // weighing habit would ever satisfy.
  const observedDays = Math.max(1, daysBetween(base, to) + 1);
  const staleDays = daysBetween(points[points.length - 1].date, to);
  if (staleDays > MAX_STALE_DAYS) {
    return { ok: false, reason: 'stale-weigh-in', weighIns: points.length, spanDays, staleDays };
  }

  let fit = fitSlope(points);
  if (!fit) return { ok: false, reason: 'flat-dates', weighIns: points.length, spanDays };

  // Drop the single worst outlier, once, and only when enough points remain
  // for the refit to still be a fit rather than a line through two survivors.
  let dropped = null;
  if (points.length >= 4) {
    let worst = null;
    for (const p of points) {
      const resid = Math.abs(p.kg - (fit.intercept + fit.slope * p.t));
      if (resid > OUTLIER_KG && (!worst || resid > worst.resid)) worst = { ...p, resid };
    }
    if (worst) {
      const kept = points.filter((p) => p.date !== worst.date);
      const refit = fitSlope(kept);
      if (refit) {
        points = kept;
        fit = refit;
        dropped = { date: worst.date, kg: worst.kg };
      }
    }
  }

  return {
    ok: true,
    weighIns: points.length,
    spanDays,
    observedDays,
    staleDays,
    slopeKgPerDay: fit.slope,
    weeklyKg: Math.round(fit.slope * 7 * 100) / 100,
    startKg: Math.round((fit.intercept) * 10) / 10,
    endKg: Math.round((fit.intercept + fit.slope * spanDays) * 10) / 10,
    firstDate: points[0].date,
    lastDate: points[points.length - 1].date,
    dropped,
  };
}

/**
 * Average daily exercise burn across the window.
 *
 * Divided by CALENDAR days, not by training days: this is the exercise
 * component of an average day, and rest days are part of the average. A
 * workout whose calories are null (no body weight on file) contributes nothing
 * rather than NaN — see num.js.
 */
export function avgDailyBurn(workouts = [], { from, to } = {}) {
  const windowDays = Math.max(1, daysBetween(from, to) + 1);
  const inWindow = workouts.filter((w) => w?.date && (!from || w.date >= from) && (!to || w.date <= to));
  return Math.round(sumBy(inWindow, (w) => w.calories) / windowDays);
}

/**
 * How much the real data is allowed to move the answer, 0 to 0.6.
 *
 * Two gates multiplied, because they fail for different reasons and both
 * matter. Days of data buys weight on the usual ladder; logging coverage scales
 * it down, so four tidy weeks of weigh-ins cannot buy confidence that the food
 * log has not earned. Nothing here can reach 1.0 — the intake figure is a
 * self-reported number with real error in it, and letting it fully override the
 * physiology would be trusting the least reliable input the most.
 */
export function adaptiveWeight({ observedDays, coverage }) {
  const byDays =
    observedDays >= 28 ? 0.6
    : observedDays >= 14 ? 0.4
    : observedDays >= MIN_TREND_SPAN_DAYS ? 0.2
    : 0;
  if (byDays === 0) return 0;
  if (coverage < MIN_COVERAGE) return 0;
  // 0.5 coverage -> half weight, 1.0 -> full. Linear between.
  const byCoverage = Math.min(1, (coverage - MIN_COVERAGE) / (1 - MIN_COVERAGE) * 0.5 + 0.5);
  return Math.round(byDays * byCoverage * 100) / 100;
}

/** Words for the weight, for a screen that has to say how sure it is. */
export function confidenceOf(weight) {
  if (weight <= 0) return 'none';
  if (weight < 0.3) return 'low';
  if (weight < 0.55) return 'medium';
  return 'high';
}

/** Sensible weekly loss for a body weight — a range, not a single number. */
export function recommendedWeeklyLoss(weightKg) {
  if (!weightKg) return null;
  return {
    minKg: Math.round(weightKg * LOSS_RATE_MIN * 100) / 100,
    maxKg: Math.round(weightKg * LOSS_RATE_MAX * 100) / 100,
  };
}

/**
 * How long to the target weight at the CURRENT trend.
 *
 * Returns null when the trend is flat or going the wrong way, rather than a
 * negative or enormous number of weeks. "At this rate you will never get there"
 * is information; "-14 weeks" is a bug wearing a number's clothes.
 */
export function projectGoal({ currentKg, targetKg, weeklyKg, todayStr = getTodayString() }) {
  if (!currentKg || !targetKg || weeklyKg == null) return null;
  const remainingKg = Math.round((currentKg - targetKg) * 10) / 10;
  if (Math.abs(remainingKg) < 0.1) return { remainingKg: 0, reached: true, weeks: 0, etaDate: todayStr };
  // Losing needs a negative trend, gaining needs a positive one.
  const goingRightWay = remainingKg > 0 ? weeklyKg < -0.02 : weeklyKg > 0.02;
  if (!goingRightWay) return { remainingKg, reached: false, weeks: null, etaDate: null };
  const weeks = Math.abs(remainingKg / weeklyKg);
  if (!Number.isFinite(weeks) || weeks > 260) return { remainingKg, reached: false, weeks: null, etaDate: null };
  return {
    remainingKg,
    reached: false,
    weeks: Math.round(weeks * 10) / 10,
    etaDate: shiftDate(todayStr, Math.round(weeks * 7)),
  };
}

/**
 * The whole engine.
 *
 * Everything is derived; nothing is stored. Feed it the same logs on another
 * device and it produces the same answer, which is the property a slowly
 * self-adjusting number most needs and the one a cached value cannot have.
 *
 * @returns an object that always has `formulaTDEE` and `effectiveTDEE` (or
 *   nulls when body stats are missing), plus every intermediate figure the UI
 *   needs to explain itself and `reason` for why it is not adapting yet.
 */
export function computeTdee({
  weightLog = [],
  meals = [],
  workouts = [],
  bmr = null,
  activityLevel = DEFAULT_ACTIVITY,
  goal = DEFAULT_GOAL,
  currentWeightKg = null,
  targetWeightKg = null,
  todayStr = getTodayString(),
  windowDays = WINDOW_DAYS,
} = {}) {
  const from = shiftDate(todayStr, -(windowDays - 1));
  const to = todayStr;

  const intake = intakeStats(meals, { from, to });
  const trend = weightTrend(weightLog, { from, to });
  const exerciseAvg = avgDailyBurn(workouts, { from, to });

  const factor = (ACTIVITY_LEVELS[activityLevel] ?? ACTIVITY_LEVELS[DEFAULT_ACTIVITY]).factor;
  // The comparable formula figure: resting × daily-life activity, PLUS the
  // window's average training burn, because the number it will be blended
  // against contains training whether we like it or not.
  const formulaTDEE = bmr == null ? null : Math.round(bmr * factor + exerciseAvg);

  // Solve the energy balance for expenditure. A negative slope (losing weight)
  // means the deficit was real, so expenditure was ABOVE intake.
  const actualTDEE =
    trend.ok && intake.avgKcal != null
      ? Math.round(intake.avgKcal - trend.slopeKgPerDay * KCAL_PER_KG)
      : null;

  const weight = trend.ok && intake.avgKcal != null
    ? adaptiveWeight({ observedDays: trend.observedDays, coverage: intake.coverage })
    : 0;

  let effectiveTDEE = formulaTDEE;
  let clamped = false;
  if (formulaTDEE != null && actualTDEE != null && weight > 0) {
    const blended = formulaTDEE * (1 - weight) + actualTDEE * weight;
    const lo = formulaTDEE * (1 - MAX_DEVIATION);
    const hi = formulaTDEE * (1 + MAX_DEVIATION);
    const bounded = Math.min(hi, Math.max(lo, blended));
    clamped = bounded !== blended;
    // To the nearest 10 kcal: a number that is honestly ±150 should not print
    // a units digit, and rounding kills the jitter that would otherwise make it
    // look like it moves every day.
    effectiveTDEE = round(bounded, 10);
  }

  // Ordered so the message names the thing the user can actually fix, and so a
  // log full of half-days does not get reported as no log at all — he wrote
  // something down every day; the entries just never add up to a day's food.
  const reason =
    bmr == null ? 'no-body-profile'
    : !trend.ok ? trend.reason
    : intake.loggedDays === 0 ? 'no-food-log'
    : intake.avgKcal == null ? 'thin-food-log'
    : intake.coverage < MIN_COVERAGE ? 'thin-food-log'
    : weight === 0 ? 'short-span'
    : null;

  const goalOffset = (DIET_GOALS[goal] ?? DIET_GOALS[DEFAULT_GOAL]).offset;
  // TDEE and target are different questions and this is where they stop being
  // the same variable: expenditure is a measurement, the target is a decision.
  const targetCalories = effectiveTDEE == null ? null : Math.round(effectiveTDEE + goalOffset);

  const weightNow = currentWeightKg ?? (trend.ok ? trend.endKg : null);

  return {
    windowDays,
    from,
    to,

    formulaTDEE,
    actualTDEE,
    effectiveTDEE,
    targetCalories,

    adaptiveWeight: weight,
    confidence: confidenceOf(weight),
    clamped,
    reason,

    avgIntake: intake.avgKcal,
    loggedDays: intake.loggedDays,
    plausibleDays: intake.plausibleDays,
    partialDays: intake.partialDays,
    coverage: Math.round(intake.coverage * 100) / 100,
    avgExerciseBurn: exerciseAvg,

    trend,
    weeklyKg: trend.ok ? trend.weeklyKg : null,
    currentWeightKg: weightNow,

    // What the current habit actually produces, as opposed to what the target
    // asks for — the question "am I losing weight at what I'm eating now".
    dailyDeficit: effectiveTDEE != null && intake.avgKcal != null ? effectiveTDEE - intake.avgKcal : null,
    projectedWeeklyKg:
      effectiveTDEE != null && intake.avgKcal != null
        ? Math.round(((intake.avgKcal - effectiveTDEE) * 7 / KCAL_PER_KG) * 100) / 100
        : null,

    recommendedLoss: recommendedWeeklyLoss(weightNow),
    goalProjection: projectGoal({
      currentKg: weightNow,
      targetKg: targetWeightKg,
      weeklyKg: trend.ok ? trend.weeklyKg : null,
      todayStr,
    }),
  };
}
