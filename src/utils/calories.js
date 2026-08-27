// Shared energy maths for the diet <-> sports pair.
//
// These formulas used to live inside SportsModule.jsx, where the diet side
// couldn't reach them — which is why the calorie target was a hand-typed 2100
// that ignored the BMR and workout burn this app already computes. One source
// of truth now, imported by both modules.
//
// House rule inherited from SportsModule: every function returns null rather
// than a plausible-looking stand-in when an input is missing. A made-up
// "average adult" number reads exactly like a real one on screen, and the user
// can't tell which they're looking at.

/**
 * Mifflin-St Jeor resting metabolic rate — calories burned lying still for 24h.
 * Needs all four inputs; there is no sensible default for any of them.
 */
export function calcBMR({ weightKg, heightCm, age, sex }) {
  if (!weightKg || !heightCm || !age || !sex) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round(base + (sex === 'female' ? -161 : 5));
}

/**
 * Daily-life activity on top of resting burn, DELIBERATELY excluding logged
 * workouts.
 *
 * The textbook Harris-Benedict multipliers (1.375 "light exercise 1-3x/week",
 * 1.55 "moderate 3-5x/week", ...) already bake gym sessions into the factor.
 * Using those here would double-count, because this app measures the actual
 * session with MET formulas and adds it separately — and a measured number
 * beats a guessed one. So these are re-scoped to non-exercise movement only
 * (NEAT), and the labels say so.
 */
export const ACTIVITY_LEVELS = {
  sedentary: { factor: 1.2, label: '久坐', hint: '上课/办公，整天坐着' },
  light: { factor: 1.35, label: '轻度活动', hint: '常走动、站着、通勤走路' },
  moderate: { factor: 1.5, label: '中度活动', hint: '体力工作，整天在动' },
};

export const DEFAULT_ACTIVITY = 'sedentary';

/**
 * Goal offsets. -500/day is the standard ~0.5kg/week deficit; +300 is a lean
 * bulk. Deliberately modest — aggressive deficits are what make people quit.
 */
export const DIET_GOALS = {
  cut: { offset: -500, label: '减脂', hint: '每天 -500 kcal ≈ 每周 -0.5kg' },
  maintain: { offset: 0, label: '维持', hint: '吃多少烧多少' },
  bulk: { offset: 300, label: '增肌', hint: '每天 +300 kcal，缓慢增重' },
};

export const DEFAULT_GOAL = 'maintain';

/**
 * What the user can eat today = resting burn x daily-activity factor
 *                             + calories actually logged in the gym today
 *                             + goal offset.
 *
 * Returns null when BMR is unknown, so the caller keeps the manual target
 * instead of showing an invented budget.
 */
export function calcCalorieTarget({ bmr, activityLevel, goal, workoutCalories = 0 }) {
  if (bmr == null) return null;
  const factor = (ACTIVITY_LEVELS[activityLevel] ?? ACTIVITY_LEVELS[DEFAULT_ACTIVITY]).factor;
  const offset = (DIET_GOALS[goal] ?? DIET_GOALS[DEFAULT_GOAL]).offset;
  return Math.round(bmr * factor + workoutCalories + offset);
}

/**
 * Energy in vs energy out for today. `burn` here is the same base+workout
 * figure the target is built from (minus the goal offset), so "net 0" means
 * "you ate exactly your maintenance," not "you ate exactly your target."
 */
export function calcEnergyBalance({ bmr, activityLevel, intake, workoutCalories = 0 }) {
  if (bmr == null) return null;
  const factor = (ACTIVITY_LEVELS[activityLevel] ?? ACTIVITY_LEVELS[DEFAULT_ACTIVITY]).factor;
  const burn = Math.round(bmr * factor + workoutCalories);
  return { burn, intake, net: intake - burn };
}

/**
 * Macro split from a calorie target: protein anchored to body weight (the one
 * macro with a hard floor for keeping muscle), fat at 25% of energy, carbs
 * taking whatever is left. Returns null without a body weight, since the
 * protein number is meaningless without it.
 */
export function suggestMacros({ calorieTarget, weightKg, goal }) {
  if (!calorieTarget || !weightKg) return null;
  const proteinPerKg = goal === 'cut' ? 2.0 : goal === 'bulk' ? 1.8 : 1.6;
  const protein = Math.round(weightKg * proteinPerKg);
  const fat = Math.round((calorieTarget * 0.25) / 9);
  const carbs = Math.max(0, Math.round((calorieTarget - protein * 4 - fat * 9) / 4));
  return { protein, carbs, fat };
}

// --- exercise burn -----------------------------------------------------------
//
// These lived inside SportsModule.jsx, where nothing else could reach them —
// same reason calcBMR moved here. The text export and the diet screen both need
// to state a day's burn, and three copies of a MET formula would drift.

/** METs by how hard a strength set is, relative to body weight. */
export const STRENGTH_MET = { light: 3.5, moderate: 5.0, vigorous: 6.0 };

/**
 * Standing between sets. Not zero, and not nothing: twenty rest periods of
 * 60-90 seconds is twenty-plus minutes of a fifty-minute session.
 */
export const REST_MET = 2.5;

/** kcal burned in `minutes` at `met`, for someone weighing `bodyWeightKg`. */
export function metCalories(met, minutes, bodyWeightKg) {
  if (!met || !minutes || !bodyWeightKg) return 0;
  return (met * 3.5 * bodyWeightKg / 200) * minutes;
}

/**
 * One strength set, INCLUDING the rest that follows it.
 *
 * THE BUG THIS FIXES
 * The old version counted only the reps: `reps x 4 seconds` at a working MET,
 * and nothing else. A real session of this user's programme is 20 sets of 12
 * reps — 16 minutes of lifting spread across 45-50 minutes in the gym — so the
 * app credited him for 16 minutes and silently threw away the other 30. Every
 * "today's burn" figure, and the diet screen's calorie target that is built on
 * top of it, was low by roughly 40%.
 *
 * Rest is now counted at REST_MET, which is what standing around holding a
 * water bottle actually costs. The set's own rest time comes from the exercise
 * (75s after incline press, 45s after a pushdown) so the sum over a routine
 * lands close to its real wall-clock length rather than a made-up flat rate.
 *
 * Returns null (not 0) when body weight is unknown — a made-up number reads
 * exactly like a real one on screen, and the user can't tell which.
 */
export function strengthSetCalories({ weightKg = 0, reps = 0, holdSec = 0, restSec = 60, bodyWeightKg }) {
  const workSec = holdSec > 0 ? holdSec : reps * 4;
  if (workSec <= 0) return 0;
  if (!bodyWeightKg || bodyWeightKg <= 0) return null;

  // A hold (wall sit, plank) is graded on time under tension rather than load —
  // there is no external weight to compare against body weight.
  const ratio = bodyWeightKg > 0 ? weightKg / bodyWeightKg : 0;
  const met = holdSec > 0
    ? STRENGTH_MET.moderate
    : ratio > 0.75 ? STRENGTH_MET.vigorous
    : ratio > 0.3 ? STRENGTH_MET.moderate
    : STRENGTH_MET.light;

  const work = metCalories(met, workSec / 60, bodyWeightKg);
  const rest = metCalories(REST_MET, Math.max(0, restSec) / 60, bodyWeightKg);
  return Math.max(1, Math.round(work + rest));
}

/**
 * How hard the whole session was, for the "I just did it, log it" path.
 *
 * These are SESSION AVERAGES — lifting and resting already blended — so they
 * sit below the working METs above rather than matching them. Chosen so that
 * logging a session whole lands within ~15% of logging the same session set by
 * set (a 47-minute, 20-set day at moderate: ~219 vs ~193 kcal at 70kg). The two
 * paths can't agree exactly, because the per-set path has no way to know about
 * the warm-up and the walk between machines, but they must not disagree enough
 * that switching how you log changes what the week looks like.
 */
export const SESSION_INTENSITY = {
  light: { met: 3.0, label: '轻松', hint: '小重量、休息很长' },
  moderate: { met: 3.8, label: '正常', hint: '照计划走，喘但能讲话' },
  hard: { met: 4.8, label: '很拼', hint: '大重量、休息压很短' },
};

export const DEFAULT_INTENSITY = 'moderate';

/**
 * A whole strength session logged in one go, from its wall-clock length.
 *
 * Deliberately a different formula from summing `strengthSetCalories` over the
 * sets: this path has the one number the per-set path has to reconstruct — how
 * long you were actually there — so it uses it directly. The MET is a
 * session-average that already blends lifting and resting, which is why it sits
 * between the working and rest values above rather than matching either.
 */
export function sessionCalories({ durationMin, intensity = DEFAULT_INTENSITY, bodyWeightKg }) {
  if (!durationMin || durationMin <= 0) return 0;
  if (!bodyWeightKg || bodyWeightKg <= 0) return null;
  const met = (SESSION_INTENSITY[intensity] ?? SESSION_INTENSITY[DEFAULT_INTENSITY]).met;
  return Math.round(metCalories(met, durationMin, bodyWeightKg));
}

/**
 * Resting calories burned SO FAR today, not for the full 24 hours.
 *
 * The overview used to add a whole day's BMR to whatever had been logged,
 * at any hour — so at 8am it claimed a full day's resting burn had already
 * happened, and "today's total burn" was a number that could only ever be too
 * high. Pro-rated by how much of the day has actually passed instead.
 *
 * The DIET target is a different question and correctly still uses the full
 * day's BMR: it's budgeting for a whole day, not reporting on a partial one.
 */
export function restingBurnSoFar(bmr, now = new Date()) {
  if (bmr == null) return null;
  const minutesElapsed = now.getHours() * 60 + now.getMinutes();
  return Math.round((bmr / 1440) * minutesElapsed);
}
