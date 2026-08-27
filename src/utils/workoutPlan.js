// Today's strength session as a PLAN, not a pile of controls.
//
// WHAT WAS WRONG
// The strength screen showed the routine picker, the rest timer, the exercise
// list and the logging form all at once, with no notion of "where am I". A set
// was something you typed into a form; nothing told you which exercise was
// next, how many sets were left, or when you were done. The rest timer sat at
// the top whether or not you were training — and it sat on the CARDIO screen
// too, where a between-sets countdown means nothing at all.
//
// So this file gives a session the one thing it was missing: a position.
//
//   plan      — the exercises, in order, each with a target and what's done
//   progress  — sets done vs the day's target, and which exercise is current
//
// THE DAY'S TOTAL IS THE ROUTINE'S OWN
// It used to be a fixed 13 for every routine, which was fine while the routines
// were this app's invention and gave a session an end to reach. It is wrong now
// that the routines are the user's real programme: those days are 15 to 20
// sets, and forcing 13 meant the app showed him a workout he does not do. Each
// routine states its own sets; 13 survives only as the fallback for a
// hand-typed routine that states nothing. See DEFAULT_SETS_TARGET.
//
// Order is editable — swapping two exercises mid-session is normal — but the
// plan always states what's current and what's next, so reordering changes the
// suggestion rather than removing it.

/**
 * Sets to hand out when a routine doesn't say — a user typing four exercise
 * names into 「新菜单」 has stated no set counts, and blank targets would give a
 * plan with no end at all.
 *
 * WHAT THIS USED TO BE
 * `TOTAL_SETS_TARGET = 13`, enforced on every routine on every read. That was
 * right when the app's routines were the app's invention. It stopped being
 * right the moment the user's real programme arrived: his chest day is 5
 * exercises x 4 sets = 20, his leg day is 15, and `normalizeRoutineSets` was
 * rewriting all four of them down to 13 the instant they were loaded — the
 * app disagreeing with the training plan and winning.
 *
 * So a routine that states its own sets keeps them. This number only fills a
 * gap; it is not a ceiling, and nothing enforces it after creation.
 */
export const DEFAULT_SETS_TARGET = 13;

/** @deprecated Old name for DEFAULT_SETS_TARGET — no longer a global cap. */
export const TOTAL_SETS_TARGET = DEFAULT_SETS_TARGET;

/** Rest between sets when an exercise doesn't specify one. */
export const DEFAULT_REST_SEC = 60;

/** How long a set of `reps` takes at a controlled tempo. */
export const SECONDS_PER_REP = 4;

/** Rest after this set, in seconds — the exercise's own, or the fallback. */
export function restSecFor(exercise) {
  const rest = Number(exercise?.restSec);
  return Number.isFinite(rest) && rest > 0 ? rest : DEFAULT_REST_SEC;
}

/** Working sets this routine asks for. Its own sum, not a global constant. */
export function routineTotalSets(routine) {
  return (routine?.exercises ?? [])
    .reduce((sum, ex) => sum + (Number(ex?.targetSets) || 0), 0);
}

/**
 * Roughly how long this routine takes, in minutes: every set's work time plus
 * its rest, plus a warm-up, plus a minute to change station between exercises.
 *
 * Derived rather than typed so editing a routine can't leave a stale "45 分钟"
 * label sitting next to a session that now has six exercises in it.
 */
export function estimateRoutineMinutes(routine, { warmupMin = 3, switchMin = 1 } = {}) {
  const exercises = routine?.exercises ?? [];
  if (exercises.length === 0) return 0;
  const seconds = exercises.reduce((total, ex) => {
    const sets = Number(ex.targetSets) || 0;
    const work = ex.mode === 'time'
      ? (Number(ex.holdSec) || 45)
      : (Number(ex.reps) || 12) * SECONDS_PER_REP;
    // The last set's rest is real too — you still stand there before walking
    // to the next machine, and the plan's own timings were written that way.
    return total + sets * (work + restSecFor(ex));
  }, 0);
  return Math.round(warmupMin + seconds / 60 + (exercises.length - 1) * switchMin);
}

/**
 * Split `total` sets across `count` exercises, biggest share first.
 *
 * Front-loaded on purpose: the first exercise in a routine is the compound
 * lift (bench, squat, row) and deserves the extra set far more than the last
 * one, which is nearly always an isolation finisher. An even split would put
 * the spare set on calf raises.
 */
export function distributeSets(count, total = DEFAULT_SETS_TARGET) {
  if (!count || count < 1) return [];
  const base = Math.floor(total / count);
  let spare = total - base * count;
  return Array.from({ length: count }, () => {
    const extra = spare > 0 ? 1 : 0;
    spare -= extra;
    return base + extra;
  });
}

/**
 * Give every exercise in a routine a usable target, WITHOUT changing one that
 * already has a real number.
 *
 * Applied on read rather than as a stored migration, same convention as
 * normalizeExercise: a routine saved by an older build, or restored from a
 * months-old backup, has to end up on the same plan as a fresh one.
 *
 * The old version of this function forced every routine's sets to sum to 13,
 * which meant a 20-set chest day was silently rewritten to 13 on load and the
 * user could never see his own programme in his own app. Now: sets are only
 * invented where none were stated. A string-only routine (`['卧推', '划船']`,
 * the pre-targets storage shape) gets a split; a routine that states 4/4/4/4/4
 * keeps 4/4/4/4/4.
 */
export function normalizeRoutineSets(routine, total = DEFAULT_SETS_TARGET) {
  const exercises = (routine?.exercises ?? []).map(ex =>
    (typeof ex === 'string' ? { name: ex, targetSets: null } : ex));
  if (exercises.length === 0) return { ...routine, exercises: [] };

  const stated = exercises.filter(ex => (Number(ex.targetSets) || 0) > 0).length;
  // Everything already says what it wants: leave it completely alone.
  if (stated === exercises.length) return { ...routine, exercises };

  // Nothing says anything: split the fallback across them, front-loaded.
  if (stated === 0) {
    const shares = distributeSets(exercises.length, total);
    return {
      ...routine,
      exercises: exercises.map((ex, i) => ({ ...ex, targetSets: shares[i] })),
    };
  }

  // Mixed — a routine half-edited by hand, or one exercise added to a stock
  // routine. Fill only the blanks, at the average of what's already stated, so
  // adding an exercise never renumbers the ones that were already right.
  const statedTotal = exercises.reduce((sum, ex) => sum + (Number(ex.targetSets) || 0), 0);
  const fill = Math.max(1, Math.round(statedTotal / stated));
  return {
    ...routine,
    exercises: exercises.map(ex =>
      ((Number(ex.targetSets) || 0) > 0 ? ex : { ...ex, targetSets: fill })),
  };
}

/**
 * Today's plan for one routine: every exercise with its target, what's been
 * done, and whether it's finished.
 *
 * @param {object} routine        already normalized
 * @param {Array}  todaysWorkouts today's logged records (strength and cardio)
 */
export function buildPlan(routine, todaysWorkouts = []) {
  const done = new Map();
  for (const w of todaysWorkouts) {
    if (w.type === 'cardio' || !w.exercise) continue;
    done.set(w.exercise, (done.get(w.exercise) ?? 0) + 1);
  }

  // "I already did this whole block today" — logged in one tap, no per-exercise
  // detail. Without this the plan screen kept showing 0/20 and a 开始训练
  // button immediately after being told the session was finished, which is the
  // app arguing with the user about whether he went to the gym.
  //
  // Matched on block where both sides have one, so quick-logging 板块 3 at home
  // still closes 板块 3 in the gym. `viaSession` is carried out so the screen
  // can say WHERE the tick came from rather than implying four logged sets of
  // incline press that never existed.
  const viaSession = todaysWorkouts.some(w => w.type === 'session' && (
    (w.routineBlock != null && routine?.block != null)
      ? w.routineBlock === routine.block
      : w.routineName === routine?.name));

  return (routine?.exercises ?? []).map((ex, index) => {
    const target = Number(ex.targetSets) || 0;
    const logged = done.get(ex.name) ?? 0;
    const doneSets = viaSession ? Math.max(logged, target) : logged;
    return {
      index,
      name: ex.name,
      // Carried through so the session screen never has to reach back into the
      // routine to answer "how long do I rest" or "is this a hold or reps" —
      // the plan row IS what that screen renders.
      en: ex.en ?? null,
      note: ex.note ?? null,
      mode: ex.mode === 'time' ? 'time' : 'reps',
      holdSec: Number(ex.holdSec) || null,
      reps: Number(ex.reps) || null,
      restSec: restSecFor(ex),
      targetSets: target,
      doneSets,
      loggedSets: logged,
      viaSession,
      remaining: Math.max(0, target - doneSets),
      isDone: target > 0 && doneSets >= target,
    };
  });
}

/**
 * Where you are in the session.
 *
 * `currentIndex` is the first exercise still owing sets — that's the
 * suggestion, not a lock. Tapping another exercise moves you there and the
 * plan follows; the point is that there is always an answer to "what now",
 * which is exactly what the old screen never had.
 */
export function planProgress(plan, total = DEFAULT_SETS_TARGET) {
  const doneSets = plan.reduce((sum, p) => sum + p.doneSets, 0);
  const targetSets = plan.reduce((sum, p) => sum + p.targetSets, 0) || total;
  const firstUnfinished = plan.findIndex(p => !p.isDone);
  // Every exercise met its target: stay on the last one rather than falling
  // off the end, so extra sets have somewhere to go.
  const currentIndex = firstUnfinished === -1 ? Math.max(0, plan.length - 1) : firstUnfinished;

  return {
    doneSets,
    targetSets,
    // True when the day was closed by a one-tap whole-session record rather
    // than by individually logged sets — the screen words itself differently.
    viaSession: plan.length > 0 && plan.every(p => p.viaSession),
    remaining: Math.max(0, targetSets - doneSets),
    pct: targetSets > 0 ? Math.min(100, (doneSets / targetSets) * 100) : 0,
    currentIndex,
    current: plan[currentIndex] ?? null,
    // What to line up next. Skips anything already finished — being told to do
    // an exercise you've completed is worse than being told nothing.
    next: plan.slice(currentIndex + 1).find(p => !p.isDone)
      ?? plan.slice(0, currentIndex).find(p => !p.isDone)
      ?? null,
    isComplete: plan.length > 0 && plan.every(p => p.isDone),
  };
}

/**
 * Move one exercise up or down. Pure — returns a new exercises array, or the
 * original when the move would fall off either end.
 */
export function reorderExercises(exercises, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= exercises.length) return exercises;
  const next = [...exercises];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * The weight and reps to prefill for an exercise: whatever was logged for it
 * last, so a session starts from where the previous one ended.
 *
 * Every alternative here is worse. A hardcoded 60kg/10 is wrong for every
 * exercise except one and silently teaches the user to ignore the field;
 * blank means typing two numbers before every set; the last set of the SAME
 * day is right during a session but wrong at the start of the next one, when
 * the day's records are empty. So: today's last set if there is one, else the
 * most recent set on any earlier day.
 */
export function lastSetFor(allWorkouts, exerciseName) {
  const prior = allWorkouts
    .filter(w => w.type !== 'cardio' && w.exercise === exerciseName)
    .sort((a, b) => (b.at ?? b.id ?? 0) - (a.at ?? a.id ?? 0));
  const last = prior[0];
  if (!last) return null;
  return {
    weightKg: Number(last.weightKg) || 0,
    reps: Number(last.reps) || 0,
    // Holds carry seconds instead of reps — see `mode: 'time'` in
    // workoutRoutines.js. Kept as its own field rather than reusing `reps`
    // so nothing can quietly read "45" and render it as forty-five repetitions.
    holdSec: Number(last.holdSec) || 0,
    date: last.date ?? null,
  };
}

/**
 * Which routine to train today, and why.
 *
 * Rotation: find the most recent PRIOR day a routine was logged and suggest
 * the next one in the list, so "chest & triceps" naturally leads to "back &
 * biceps" without the user having to remember. If today already has sets
 * logged, that routine wins — reopening the app mid-session must not switch
 * what you're halfway through.
 */
export function suggestRoutine(routines, allWorkouts, todayStr) {
  if (!routines?.length) return { routine: null, reason: 'none', priorName: null };

  // The most recent strength record wins for "what am I mid-way through",
  // matched on block first so a session started in one place and continued in
  // the other doesn't reset. Falls back to the name for records logged before
  // blocks existed.
  const matches = (routine, record) =>
    (record.routineBlock != null && routine.block != null
      ? routine.block === record.routineBlock
      : routine.name === record.routineName);

  const todays = allWorkouts.find(w => w.date === todayStr && w.type !== 'cardio' && w.routineName);
  if (todays) {
    const inProgress = routines.find(r => matches(r, todays));
    if (inProgress) return { routine: inProgress, reason: 'in-progress', priorName: null };
  }

  const prior = allWorkouts
    .filter(w => w.date && w.date !== todayStr && w.routineName && w.type !== 'cardio')
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0] ?? null;
  const priorName = prior?.routineName ?? null;

  // Matching on the BLOCK, not the routine object, is what lets the two places
  // share one rotation: doing 板块 2 徒手 at home on Tuesday still means 板块 3
  // is what's next when you're back in the gym on Wednesday. Matching on name
  // would have restarted the cycle at 板块 1 every time the place changed.
  const idx = prior ? routines.findIndex(r => matches(r, prior)) : -1;
  if (idx === -1) return { routine: routines[0], reason: 'first', priorName };
  return { routine: routines[(idx + 1) % routines.length], reason: 'rotation', priorName };
}

/**
 * How many working sets a list of records represents.
 *
 * Three kinds of record live in the same array and only one of them is a set:
 *   'cardio'   a run — no sets at all
 *   'session'  a whole workout logged in one go — worth the sets it planned
 *   'strength' one actual set
 *
 * `workouts.length` was standing in for this in four places, which was already
 * wrong (it counted cardio) and became visibly wrong once whole sessions could
 * be logged: a 20-set chest day recorded in one tap would have shown up as
 * "1 组" everywhere, and the streak would have treated it as a day barely
 * trained.
 */
export function countSets(workouts = []) {
  return workouts.reduce((total, w) => {
    if (w?.type === 'cardio') return total;
    if (w?.type === 'session') return total + (Number(w.setsPlanned) || 0);
    return total + 1;
  }, 0);
}

/** True if this record is one logged set (not cardio, not a whole session). */
export function isStrengthSet(w) {
  return w?.type !== 'cardio' && w?.type !== 'session';
}
