import React, { useState, useMemo, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import confetti from 'canvas-confetti';
import {
  Play, Pause, Dumbbell, Timer, Flame, CheckCircle, Clock, Trash2, Plus, X,
  Repeat, HeartPulse, Scale, Trophy, ArrowRight, ChevronLeft, Check, Copy,
} from '../utils/icons';
import { usePersistentState, getTodayString, useToday, useNowMinute } from '../utils/storage';
import { num, sumBy, newId } from '../utils/num';
import { computeWorkoutStreak } from '../utils/streak';
import { recordWeight, latestWeight } from '../utils/bodyWeight';
import WorkoutProgress from './WorkoutProgress';
import { blockHistory } from '../utils/workoutProgress';
import { kgToLbs, lbsToKg, formatWeight } from '../utils/units';
import {
  normalizeRoutineSets, buildPlan, planProgress,
  reorderExercises, lastSetFor, suggestRoutine, distributeSets,
  routineTotalSets, estimateRoutineMinutes, countSets,
} from '../utils/workoutPlan';
import {
  DEFAULT_ROUTINES, PLACES, WARMUP_MIN, SWITCH_LIMIT_SEC,
} from '../utils/workoutRoutines';
import {
  calcBMR, strengthSetCalories, sessionCalories, restingBurnSoFar,
  SESSION_INTENSITY, DEFAULT_INTENSITY,
} from '../utils/calories';
import { nowTimeStr } from '../utils/datetime';

// Recharts is ~400 KB — the biggest thing in the bundle by some margin, and it
// was being downloaded and parsed on every cold start for one small chart that
// only appears deep inside a training session, and only after the same exercise
// has been logged on two different days. Loaded on demand instead. See
// WeightTrendChart.jsx.
const WeightTrendChart = lazy(() => import('./WeightTrendChart'));

// Same modal the money side and 备份 use — it covers both reports.
//
// A plain import, not lazy(): App.jsx now imports it statically too (it is what
// the header's 问 AI button opens, since the in-app coach was removed), so it
// is in the main chunk regardless and a dynamic import here only makes the
// bundler warn that the split is ineffective.
import TextExportModal from './TextExportModal';

// The routines themselves now live in utils/workoutRoutines.js — the real
// 4-day split the user actually trains, in a gym version and a no-equipment
// version, rather than four days this file made up. Re-exported because
// App.jsx seeds storage from it on first run.
export { DEFAULT_ROUTINES };

// The no-equipment answer is no longer a per-exercise substitution table. It's
// a whole parallel set of four routines (place: 'home'), because "俯卧撑
// instead of 卧推" told you what to swap but not what the session then WAS —
// how many sets, how long to rest, whether you'd finished. Picking 徒手 now
// gives you a complete day, not a footnote on a day you can't do.

const CARDIO_COLOR = '#38bdf8';
const CARDIO_COLOR_SOFT = 'rgba(56, 189, 248, 0.12)';

// Most-used activities first — running, hill climbs, badminton, basketball —
// with a general grab-bag after. No LLM anywhere here on purpose: every
// number below is a fixed MET (Metabolic Equivalent) lookup, same spirit as
// the rest of the app avoiding API calls for things a table can answer.
const CARDIO_TYPES = ['跑步', '爬坡', '羽毛球', '篮球', '骑行', '游泳', '跳绳', '快走', '椭圆机', '其他'];

// Activities where a distance figure actually changes how hard the session
// was — badminton/basketball don't have a meaningful "distance covered".
const DISTANCE_RELEVANT = new Set(['跑步', '爬坡', '骑行', '游泳']);

// Standard MET figures (Compendium of Physical Activities ballpark values),
// not personalized beyond body weight — see cardioCalories() below for the
// formula these feed into.
const CARDIO_MET = {
  跑步: 8.3, 爬坡: 6.5, 羽毛球: 5.5, 篮球: 6.5,
  骑行: 6.8, 游泳: 7.0, 跳绳: 10.0, 快走: 3.8, 椭圆机: 5.0, 其他: 5.0,
};

// The cardio activities where pace changes the intensity enough to matter —
// a 5km/h jog and a 12km/h run are not the same effort, and the same is true
// for slow vs. fast cycling/swimming/hiking. These are exactly the four in
// DISTANCE_RELEVANT: the distance field only exists so this bracket lookup
// (Compendium of Physical Activities ballpark speed brackets) can replace the
// flat activity-level MET below when a distance was actually entered.
// Anything not listed here uses a flat MET; more precision than that isn't
// the point of a self-logged number.
const PACE_MET_TABLES = {
  跑步: [[8, 6.0], [9.5, 8.3], [11, 9.8], [12.5, 11.0], [14.5, 11.8], [Infinity, 12.8]],
  爬坡: [[3, 5.3], [4.5, 6.5], [6, 7.3], [Infinity, 8.0]],
  骑行: [[16, 4.0], [19, 6.8], [22.4, 8.0], [25.6, 10.0], [30, 12.0], [Infinity, 15.8]],
  游泳: [[2, 6.0], [3, 8.3], [4, 9.8], [Infinity, 11.0]],
};

function paceMET(activity, paceKmh) {
  const table = PACE_MET_TABLES[activity];
  if (!table || !paceKmh || !Number.isFinite(paceKmh)) return CARDIO_MET[activity] ?? CARDIO_MET.其他;
  const bracket = table.find(([limit]) => paceKmh < limit);
  return bracket ? bracket[1] : table[table.length - 1][1];
}

// calories/min = MET x 3.5 x bodyWeightKg / 200 — the standard MET formula.
// Returns null (not 0) when bodyWeightKg is unset — 0 kcal would read as a
// real computed answer instead of "we don't actually know yet," and this
// module never shows a number it didn't earn from something the user typed.
function cardioCalories({ activity, durationMin, distanceKm, bodyWeightKg }) {
  if (!durationMin || durationMin <= 0) return 0;
  if (!bodyWeightKg) return null;
  let met = CARDIO_MET[activity] ?? CARDIO_MET.其他;
  if (PACE_MET_TABLES[activity] && distanceKm > 0) {
    met = paceMET(activity, distanceKm / (durationMin / 60));
  }
  const kcalPerMin = (met * 3.5 * bodyWeightKg) / 200;
  return Math.round(kcalPerMin * durationMin);
}

// The strength-set formula moved to utils/calories.js as strengthSetCalories,
// and while it was moving it got the rest period it was always missing — the
// old version counted `reps x 4 seconds` and nothing else, so a 47-minute gym
// session was credited with about 16 minutes of burn. See that file.

// calcBMR now lives in utils/calories.js — the diet module needs the same
// formula to size its calorie target, and two copies would drift apart.
// Added to today's logged exercise calories it gives a full "today so far"
// total — the same Resting + Active split fitness trackers (Apple Health,
// Fitbit, etc.) show, at the cost of double-counting the resting burn during
// exercise minutes themselves, which is the industry-standard simplification.

// Heaviest weight ever logged for an exercise — a PR here means "beat your
// own best set," not an estimated 1RM formula, matching how directly every
// other number in this module already reads (no smoothing/estimation beyond
// what the user actually typed in).
function getPR(allWorkouts, exerciseName) {
  return allWorkouts
    .filter(w => w.type !== 'cardio' && w.exercise === exerciseName)
    .reduce((max, w) => Math.max(max, w.weightKg || 0), 0);
}

const formatClock = (secs) => {
  const mins = Math.floor(secs / 60);
  return `${String(mins).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
};

const fieldStyle = {
  width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
  color: 'white', marginTop: '4px', fontSize: '0.85rem',
};

/**
 * 健身 — three screens, not one screen with everything on it.
 *
 *   /sports                    overview: streak, week, two entry cards
 *   /sports/strength           TODAY'S PLAN: which routine, which order, 13 sets
 *   /sports/strength/session   TRAINING: one exercise at a time, rest timer here
 *   /sports/cardio             cardio: a stopwatch that fills the duration
 *   /sports/progress           progress: 板块 rotation, then per-exercise trends
 *
 * WHY IT'S SPLIT THIS WAY
 * Everything used to live on one screen — routine picker, rest timer, exercise
 * list and logging form, all visible whether or not you were training. The
 * rest timer was rendered on the cardio screen too, where a between-sets
 * countdown means nothing at all.
 *
 * A workout has phases, and the screen now has the same phases: decide what
 * you're doing, then do it. The rest timer belongs to the second phase only,
 * which is why it lives inside the session and nowhere else.
 */
export default function SportsModule({ workouts, setWorkouts, timer, history = [], allWorkouts = [] }) {
  const {
    restSeconds, setRestSeconds, timerRunning, setTimerRunning,
    stopwatchSeconds, sessionActive, startRestTimer, resetSession,
    cardioSeconds, cardioRunning, startCardioTimer, pauseCardioTimer, resetCardioTimer,
  } = timer;

  // Needed to turn "60kg x 10" or "20 min running" into an actual calorie
  // number instead of a made-up flat rate — see the formulas above. Age,
  // height and sex only feed calcBMR() (resting calories); they don't touch
  // any of the exercise-calorie math, which stays weight-only by design.
  const [bodyWeightKg, setBodyWeightKg] = usePersistentState('bodyWeightKg', null);
  // The HISTORY of that number, added alongside it rather than replacing it.
  // `bodyWeightKg` stays the single current weight every calorie formula reads;
  // this is the log that makes 体重趋势 answerable at all. See bodyWeight.js.
  const [weightLog, setWeightLog] = usePersistentState('weightLog', []);
  const lastWeighIn = useMemo(() => latestWeight(weightLog), [weightLog]);
  const weighInCount = weightLog?.length ?? 0;
  const [ageYears, setAgeYears] = usePersistentState('ageYears', null);
  const [heightCm, setHeightCm] = usePersistentState('heightCm', null);
  const [sex, setSex] = usePersistentState('sex', null);
  const hasWeight = bodyWeightKg != null && bodyWeightKg > 0;
  const hasBMRProfile = hasWeight && heightCm != null && ageYears != null && sex != null;

  // Display/input only — every stored value and every calorie/PR/chart
  // calculation stays in kg regardless of this. See units.js.
  const [weightUnit, setWeightUnit] = usePersistentState('weightUnit', 'kg');
  const toggleWeightUnit = () => setWeightUnit(u => (u === 'kg' ? 'lbs' : 'kg'));

  const [showBodyModal, setShowBodyModal] = useState(false);
  const [showTextExport, setShowTextExport] = useState(false);
  const [weightDraft, setWeightDraft] = useState('');
  const [ageDraft, setAgeDraft] = useState('');
  const [heightDraft, setHeightDraft] = useState('');
  const [sexDraft, setSexDraft] = useState(null);

  const openBodyModal = () => {
    setWeightDraft(hasWeight ? (weightUnit === 'lbs' ? kgToLbs(bodyWeightKg).toFixed(1) : String(bodyWeightKg)) : '');
    setAgeDraft(ageYears != null ? String(ageYears) : '');
    setHeightDraft(heightCm != null ? String(heightCm) : '');
    setSexDraft(sex);
    setShowBodyModal(true);
  };

  const saveBodyProfile = (e) => {
    e.preventDefault();
    const w = parseFloat(weightDraft);
    const kgValue = weightUnit === 'lbs' ? lbsToKg(w) : w;
    if (Number.isFinite(kgValue) && kgValue > 0) {
      setBodyWeightKg(kgValue);
      // recordWeight decides whether this is actually a weigh-in: re-saving the
      // same number (opening this modal to fix a height, say) records nothing,
      // so the log never gains a reading nobody took. See bodyWeight.js.
      setWeightLog(log => recordWeight(log, { kg: kgValue, date: todayStr }));
    }
    const a = parseInt(ageDraft, 10);
    if (Number.isFinite(a) && a > 0) setAgeYears(a);
    const h = parseFloat(heightDraft);
    if (Number.isFinite(h) && h > 0) setHeightCm(h);
    setSex(sexDraft);
    setShowBodyModal(false);
  };

  // Routines, normalized on every read so a routine saved as bare strings —
  // the pre-targets storage shape — still produces a usable plan. Never a
  // stored migration: an old backup restored next year has to land on the same
  // plan as a fresh install.
  const [routinesRaw, setRoutines] = usePersistentState('routines', DEFAULT_ROUTINES);
  const routines = useMemo(
    () => routinesRaw.map(r => normalizeRoutineSets(r)),
    [routinesRaw]
  );
  const [showAddRoutineModal, setShowAddRoutineModal] = useState(false);
  const [newRoutineName, setNewRoutineName] = useState('');
  const [newRoutineExercises, setNewRoutineExercises] = useState('');
  const [showRoutinePicker, setShowRoutinePicker] = useState(false);

  // 健身房 or 徒手. Persisted, because it's a fact about the next few weeks —
  // gym membership lapsed, travelling, whatever — not a per-visit choice, and
  // being asked every single time you open the app would be worse than being
  // occasionally wrong.
  const [place, setPlace] = usePersistentState('workoutPlace', 'gym');
  // A routine the user typed themselves has no `place`; it belongs to whichever
  // one is showing rather than disappearing when the toggle flips. Losing your
  // own routine because you tapped 徒手 would be the worst possible behaviour
  // here.
  const routinesHere = useMemo(
    () => routines.filter(r => (r.place ?? place) === place),
    [routines, place]
  );

  // `useToday()` rather than a bare `getTodayString()` call: this only
  // re-evaluated when something else happened to re-render this screen, so an
  // app left open past midnight kept the week strip's "today" marker and the
  // 「回到今天」 buttons pointing at yesterday.
  const todayStr = useToday();

  // Which routine today, and why — see suggestRoutine() for the rotation rule
  // and why a session already started today outranks it. Scoped to the current
  // place: 板块 2 done at home still means 板块 3 is next in the gym, so the
  // rotation is matched on the block, not on the exact routine object.
  const suggestion = useMemo(
    () => suggestRoutine(routinesHere, allWorkouts, todayStr),
    [routinesHere, allWorkouts, todayStr]
  );

  // The user can override the suggestion; null means "use the suggestion", so
  // the rotation keeps working tomorrow instead of being pinned by one tap.
  const [chosenRoutineId, setChosenRoutineId] = useState(null);
  const activeRoutine = useMemo(
    () => routinesHere.find(r => r.id === chosenRoutineId)
      ?? suggestion.routine ?? routinesHere[0] ?? routines[0] ?? null,
    [routines, routinesHere, chosenRoutineId, suggestion.routine]
  );

  // --- today's plan ------------------------------------------------------
  const strengthWorkoutsToday = useMemo(() => workouts.filter(w => w.type !== 'cardio'), [workouts]);
  const cardioWorkoutsToday = useMemo(() => workouts.filter(w => w.type === 'cardio'), [workouts]);

  const plan = useMemo(
    () => (activeRoutine ? buildPlan(activeRoutine, strengthWorkoutsToday) : []),
    [activeRoutine, strengthWorkoutsToday]
  );
  const progress = useMemo(() => planProgress(plan), [plan]);

  // Which exercise the session screen is on. Follows the plan by default;
  // tapping another exercise pins it there until that one's target is met.
  const [pinnedIndex, setPinnedIndex] = useState(null);
  const currentIndex = pinnedIndex != null && plan[pinnedIndex] ? pinnedIndex : progress.currentIndex;
  const currentExercise = plan[currentIndex] ?? null;
  const selectedExercise = currentExercise?.name ?? '';

  // A hold (靠墙静蹲, 平板支撑) is logged in seconds, not reps x weight. Same
  // form, one field relabelled — a separate screen for two exercises would be
  // more machinery than the difference deserves.
  const isHold = currentExercise?.mode === 'time';

  const [weightKg, setWeightKg] = useState('');
  const [reps, setReps] = useState('');
  // What was lifted last time, so a set starts from where the last one ended
  // instead of from a hardcoded 60kg that's wrong for every exercise but one.
  const lastSet = useMemo(
    () => (selectedExercise ? lastSetFor(allWorkouts, selectedExercise) : null),
    [allWorkouts, selectedExercise]
  );
  // The plan's own prescription is the third fallback, behind what you typed
  // and what you did last time. It matters on the first ever set of an
  // exercise, where "12" (or "45 秒") is a real instruction from the programme
  // and a blank field is just a blank field.
  const prescribed = isHold
    ? (currentExercise?.holdSec ?? 45)
    : (currentExercise?.reps ?? 12);
  const lastCount = isHold ? lastSet?.holdSec : lastSet?.reps;
  const effectiveWeight = weightKg !== '' ? weightKg : (lastSet ? String(lastSet.weightKg) : '');
  const effectiveReps = reps !== '' ? reps : String(lastCount || prescribed);

  const [cardioActivity, setCardioActivity] = useState(CARDIO_TYPES[0]);
  const [cardioDuration, setCardioDuration] = useState('20');
  const [cardioDistance, setCardioDistance] = useState('');

  const [strengthViewDate, setStrengthViewDate] = useState(todayStr);
  const [cardioViewDate, setCardioViewDate] = useState(todayStr);
  const shiftDate = (dateStr, delta) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    return getTodayString(dt);
  };

  const [weekWindowEnd, setWeekWindowEnd] = useState(todayStr);

  // /sports · /sports/strength · /sports/strength/session · /sports/cardio
  const { section, sub } = useParams();
  const navigate = useNavigate();
  const activeSection = section;
  const inSession = section === 'strength' && sub === 'session';

  const handleDeleteWorkout = (id) => {
    setWorkouts(workouts.filter(w => w.id !== id));
  };

  const handleAddRoutine = (e) => {
    e.preventDefault();
    const names = newRoutineExercises.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    if (!newRoutineName || names.length === 0) return;
    // Targets are assigned, not asked for: splitting them is arithmetic the
    // user shouldn't have to do at creation time. Each one is still adjustable
    // afterwards on the plan screen, and adjusting one now changes the day's
    // total rather than robbing another exercise.
    const shares = distributeSets(names.length);
    const exercises = names.map((name, i) => ({ name, targetSets: shares[i], restSec: 60, reps: 12 }));

    const newRoutine = {
      id: newId(),
      name: newRoutineName,
      // Belongs to whichever place it was created in, so it shows up under
      // that toggle instead of appearing in both.
      place,
      exercises,
      durationEst: `${estimateRoutineMinutes({ exercises })} 分钟`,
    };

    setRoutines([...routinesRaw, newRoutine]);
    setChosenRoutineId(newRoutine.id);
    setPinnedIndex(null);
    setNewRoutineName('');
    setNewRoutineExercises('');
    setShowAddRoutineModal(false);
  };

  const handleDeleteRoutine = (id) => {
    const remaining = routinesRaw.filter(r => r.id !== id);
    if (remaining.length === 0) return; // always keep at least one routine
    setRoutines(remaining);
    if (chosenRoutineId === id) setChosenRoutineId(null);
  };

  // Up/down buttons rather than a drag library — the user's own call (no new
  // dependency, and taps beat drag in a WebView). Persisted immediately, so
  // the order you train in is the order you see next time.
  const moveExercise = (idx, direction) => {
    if (!activeRoutine) return;
    const reordered = reorderExercises(activeRoutine.exercises, idx, direction);
    if (reordered === activeRoutine.exercises) return;
    setRoutines(routinesRaw.map(r => (r.id === activeRoutine.id ? { ...r, exercises: reordered } : r)));
    setPinnedIndex(null);
  };

  // Adding a set to one exercise now adds a set to the DAY.
  //
  // It used to steal one from a neighbour, to hold every routine at exactly 13.
  // That rule existed to protect a total the app had invented; now the totals
  // come from the user's own programme (20 / 18 / 15 / 19), and silently taking
  // a set off the bench press because you added one to the flyes would be the
  // app editing his plan behind his back. Capped at 10 per exercise only to
  // keep a stuck finger from writing 400.
  const adjustTarget = (idx, delta) => {
    if (!activeRoutine) return;
    const exercises = activeRoutine.exercises;
    const current = exercises[idx]?.targetSets ?? 0;
    const next = current + delta;
    if (next < 1 || next > 10) return;

    setRoutines(routinesRaw.map(r => (r.id === activeRoutine.id
      ? { ...r, exercises: exercises.map((ex, i) => (i === idx ? { ...ex, targetSets: next } : ex)) }
      : r)));
  };

  const handleLogSet = (e) => {
    e.preventDefault();
    if (!currentExercise) return;
    const wKg = parseFloat(effectiveWeight) || 0;
    // One field, two meanings: reps for a normal set, seconds for a hold.
    const count = parseInt(effectiveReps, 10) || 0;
    if (count <= 0) return;
    const holdSec = isHold ? count : 0;
    const repCount = isHold ? 0 : count;

    // Compared against the PR *before* this set is added — beating your own
    // prior best, not the new number that includes this set.
    const priorPR = getPR(allWorkouts, currentExercise.name);
    const isNewPR = !isHold && priorPR > 0 && wKg > priorPR;
    const newLog = {
      id: newId(),
      type: 'strength',
      routineName: activeRoutine.name,
      // The rotation reads this, so a session continues correctly even after the
      // routine is renamed or the place is switched. See suggestRoutine().
      routineBlock: activeRoutine.block ?? null,
      place: activeRoutine.place ?? place,
      exercise: currentExercise.name,
      mode: isHold ? 'time' : 'reps',
      weightKg: wKg,
      reps: repCount,
      holdSec,
      isNewPR,
      // The set's own rest time is part of what it cost — see
      // strengthSetCalories. Stored on the record too, so recomputing a past
      // day's burn doesn't depend on the routine still saying 75 seconds.
      restSec: currentExercise.restSec,
      calories: strengthSetCalories({
        weightKg: wKg, reps: repCount, holdSec,
        restSec: currentExercise.restSec, bodyWeightKg,
      }),
      time: nowTimeStr(),
    };

    setWorkouts([newLog, ...workouts]);
    if (isNewPR) confetti({ particleCount: 45, spread: 65 });

    // The set just logged may have finished this exercise. Unpin so the plan's
    // own "what's next" takes over again — staying pinned to a completed
    // exercise is exactly the "nothing tells you what to do" problem.
    if (currentExercise.doneSets + 1 >= currentExercise.targetSets) setPinnedIndex(null);
    // Fields fall back to this set's numbers via lastSetFor on the next render.
    setWeightKg(''); setReps('');
    // The plan's rest, not a flat 60 — 75 after heavy incline press, 45 after a
    // pushdown. This is the difference between the session fitting in 50
    // minutes and not.
    startRestTimer(currentExercise.restSec);
  };

  // --- "I already trained, just record it" ---------------------------------
  //
  // The whole session as ONE record, because that is how this actually gets
  // used: phone in the locker, own timer, and at the end a single fact worth
  // keeping — I did 板块 1 for 50 minutes. The set-by-set path is still there
  // and still better data; it is simply not what happens most days, and an app
  // that only supports the diligent version of you gets a week of records and
  // then nothing.
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickRoutineId, setQuickRoutineId] = useState(null);
  const [quickMinutes, setQuickMinutes] = useState('');
  const [quickIntensity, setQuickIntensity] = useState(DEFAULT_INTENSITY);
  const [quickNote, setQuickNote] = useState('');

  const quickRoutine = routinesHere.find(r => r.id === quickRoutineId) ?? activeRoutine;

  const openQuickLog = () => {
    setQuickRoutineId(activeRoutine?.id ?? null);
    // Prefilled with the plan's own estimate, which is a much better starting
    // point than a blank box — most sessions land within a few minutes of it.
    setQuickMinutes(String(estimateRoutineMinutes(activeRoutine) || 45));
    setQuickIntensity(DEFAULT_INTENSITY);
    setQuickNote('');
    setQuickOpen(true);
  };

  const handleQuickLog = (e) => {
    e.preventDefault();
    const durationMin = parseInt(quickMinutes, 10) || 0;
    if (!quickRoutine || durationMin <= 0) return;

    setWorkouts([{
      id: newId(),
      // Its own type, deliberately. It is not `strength` — it carries no
      // exercise, so anything counting sets or tracking a PR must be able to
      // skip it rather than treat it as one mysterious set of nothing.
      type: 'session',
      routineName: quickRoutine.name,
      routineBlock: quickRoutine.block ?? null,
      place: quickRoutine.place ?? place,
      durationMin,
      intensity: quickIntensity,
      // What the routine ASKS for. Recorded as the session's volume because
      // that's the claim being made ("I did that day"), and flagged as
      // `setsPlanned` rather than `sets` so it can never be mistaken for
      // twenty individually logged sets.
      setsPlanned: routineTotalSets(quickRoutine),
      note: quickNote.trim(),
      calories: sessionCalories({ durationMin, intensity: quickIntensity, bodyWeightKg }),
      time: nowTimeStr(),
    }, ...workouts]);

    confetti({ particleCount: 40, spread: 60 });
    setQuickOpen(false);
  };

  const handleLogCardio = (e) => {
    e.preventDefault();
    const durationMin = parseInt(cardioDuration, 10) || 0;
    if (durationMin <= 0) return;
    const distanceKm = parseFloat(cardioDistance) || 0;

    setWorkouts([{
      id: newId(),
      type: 'cardio',
      activity: cardioActivity,
      durationMin,
      distanceKm: distanceKm > 0 ? distanceKm : null,
      calories: cardioCalories({ activity: cardioActivity, durationMin, distanceKm, bodyWeightKg }),
      time: nowTimeStr(),
    }, ...workouts]);
    setCardioDistance('');
    resetCardioTimer();
  };

  // Stopping the clock fills the duration field rather than logging straight
  // away — distance and activity still need saying, and a session that logged
  // itself the instant you stopped would be impossible to correct.
  const useStopwatchDuration = () => {
    pauseCardioTimer();
    setCardioDuration(String(Math.max(1, Math.round(cardioSeconds / 60))));
  };

  const totalSetsLogged = countSets(workouts);
  const totalCaloriesToday = sumBy(workouts, w => w.calories);

  const bmrToday = useMemo(
    () => calcBMR({ weightKg: bodyWeightKg, heightCm, age: ageYears, sex }),
    [bodyWeightKg, heightCm, ageYears, sex]
  );
  // Resting burn SO FAR, not a whole day's.
  //
  // This line used to be `totalCaloriesToday + bmrToday`, i.e. today's training
  // plus twenty-four hours of resting metabolism — at nine in the morning. The
  // headline "今天总消耗" was therefore always too high, by up to a full day's
  // BMR, and there was no hour of the day at which it was right. Pro-rated by
  // the clock now; see restingBurnSoFar in calories.js. `nowTick` re-reads the
  // clock every minute, because this number changes on its own even when
  // nothing is logged.
  const nowTick = useNowMinute();
  const restingSoFar = useMemo(
    () => restingBurnSoFar(bmrToday, nowTick),
    [bmrToday, nowTick]
  );
  const grandTotalCaloriesToday = totalCaloriesToday + (restingSoFar || 0);

  const cardioSessionsToday = cardioWorkoutsToday.length;
  const strengthCaloriesToday = sumBy(strengthWorkoutsToday, w => w.calories);
  const cardioCaloriesToday = sumBy(cardioWorkoutsToday, w => w.calories);
  const cardioMinutesToday = sumBy(cardioWorkoutsToday, w => w.durationMin);

  const cardioPreviewKcal = cardioCalories({
    activity: cardioActivity,
    durationMin: parseInt(cardioDuration, 10) || 0,
    distanceKm: parseFloat(cardioDistance) || 0,
    bodyWeightKg,
  });
  const strengthPreviewKcal = strengthSetCalories({
    weightKg: parseFloat(effectiveWeight) || 0,
    reps: isHold ? 0 : parseInt(effectiveReps, 10) || 0,
    holdSec: isHold ? parseInt(effectiveReps, 10) || 0 : 0,
    restSec: currentExercise?.restSec ?? 60,
    bodyWeightKg,
  });
  const quickPreviewKcal = sessionCalories({
    durationMin: parseInt(quickMinutes, 10) || 0,
    intensity: quickIntensity,
    bodyWeightKg,
  });

  const currentExercisePR = useMemo(
    () => (selectedExercise ? getPR(allWorkouts, selectedExercise) : 0),
    [allWorkouts, selectedExercise]
  );

  const weightProgressData = useMemo(() => {
    if (!selectedExercise) return [];
    const byDate = new Map();
    allWorkouts
      .filter(w => w.type !== 'cardio' && w.exercise === selectedExercise && w.date)
      .forEach(w => {
        const prevBest = byDate.get(w.date) ?? 0;
        if (w.weightKg > prevBest) byDate.set(w.date, w.weightKg);
      });
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([date, weightKgVal]) => ({ date: date.slice(5), weightKg: weightKgVal }));
  }, [allWorkouts, selectedExercise]);

  const streak = useMemo(() => computeWorkoutStreak(history, totalSetsLogged), [history, totalSetsLogged]);

  const weeklyDays = useMemo(() => {
    const byDate = new Map();
    allWorkouts.forEach((w) => {
      if (!w.date) return;
      const rec = byDate.get(w.date) ?? { calories: 0, sets: 0, cardioSessions: 0 };
      // A whole session logged in one tap is worth the sets it planned, not
      // one — otherwise the week strip would draw a 20-set chest day as a
      // shorter bar than a day with three lazy sets on it.
      if (w.type === 'cardio') rec.cardioSessions += 1;
      else if (w.type === 'session') rec.sets += Number(w.setsPlanned) || 0;
      else rec.sets += 1;
      rec.calories += num(w.calories);
      byDate.set(w.date, rec);
    });
    const [ey, em, ed] = weekWindowEnd.split('-').map(Number);
    const end = new Date(ey, em - 1, ed);
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(end.getFullYear(), end.getMonth(), end.getDate());
      d.setDate(d.getDate() - i);
      const dateStr = getTodayString(d);
      const rec = byDate.get(dateStr) ?? { calories: 0, sets: 0, cardioSessions: 0 };
      days.push({ date: dateStr, label: d.toLocaleDateString([], { weekday: 'narrow' }), isToday: dateStr === todayStr, ...rec });
    }
    return days;
  }, [allWorkouts, weekWindowEnd, todayStr]);

  const weekSets = sumBy(weeklyDays, d => d.sets);
  const weekCardioSessions = sumBy(weeklyDays, d => d.cardioSessions);
  const weekCalories = sumBy(weeklyDays, d => d.calories);
  const weekDaysTrained = weeklyDays.filter((d) => d.sets + d.cardioSessions > 0).length;
  const weekChartMax = Math.max(1, ...weeklyDays.map((d) => (hasWeight ? d.calories : d.sets + d.cardioSessions)));

  const recentPRs = useMemo(() => {
    const from = weeklyDays[0]?.date;
    const to = weeklyDays[weeklyDays.length - 1]?.date;
    if (!from || !to) return [];
    return allWorkouts
      .filter((w) => w.isNewPR && w.date >= from && w.date <= to)
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      .slice(0, 3);
  }, [allWorkouts, weeklyDays]);

  // One line for the 进度 entry card: how much training the last 4 weeks held,
  // and which 板块 has gone longest without being touched. Computed here rather
  // than inside WorkoutProgress so the overview can say it WITHOUT mounting
  // that screen — the whole point of an entry card is answering before the tap.
  const progressSummary = useMemo(() => {
    const [y, mo, d] = todayStr.split('-').map(Number);
    const blocks = blockHistory(allWorkouts, { days: 28, now: new Date(y, mo - 1, d) });
    const sessions = blocks.reduce((sum, b) => sum + b.count, 0);
    // A block in the user's routine list that has NEVER been trained outranks
    // any gap, and cannot come from the log — see WorkoutProgress.
    const untrained = routinesHere.find(
      (r) => !blocks.some((b) => String(b.key) === String(r.block ?? r.name)));
    const stalest = blocks.find((b) => b.daysSince != null && b.daysSince >= 10) ?? null;
    return { sessions, untrained: untrained ?? null, stalest };
  }, [allWorkouts, routinesHere, todayStr]);

  const strengthLogsForView = strengthViewDate === todayStr
    ? strengthWorkoutsToday
    : allWorkouts.filter(w => w.type !== 'cardio' && w.date === strengthViewDate);
  const cardioLogsForView = cardioViewDate === todayStr
    ? cardioWorkoutsToday
    : allWorkouts.filter(w => w.type === 'cardio' && w.date === cardioViewDate);

  const renderLogRow = (log, readOnly = false) => {
    const isCardio = log.type === 'cardio';
    // A whole session logged in one go. Rendered as its own kind of row rather
    // than falling through the strength branch, which would have shown an empty
    // exercise name and "0kg x undefined次".
    const isSession = log.type === 'session';
    const tint = isCardio ? CARDIO_COLOR : 'var(--color-sports)';
    return (
      <div key={log.id} className="glass-card" style={{ padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <div style={{
            width: '34px', height: '34px', borderRadius: 'var(--radius-sm)', flexShrink: 0,
            background: isCardio ? CARDIO_COLOR_SOFT : 'var(--color-sports-soft)', color: tint,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            {isCardio ? <HeartPulse size={16} /> : isSession ? <CheckCircle size={16} /> : <Dumbbell size={16} />}
          </div>
          {isSession ? (
            <div style={{ minWidth: 0 }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: '600' }}>{log.routineName}</h4>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                整场记录 · {log.durationMin} 分钟
                {log.setsPlanned > 0 ? ` · ${log.setsPlanned} 组` : ''}
                {SESSION_INTENSITY[log.intensity] ? ` · ${SESSION_INTENSITY[log.intensity].label}` : ''} · {log.time}
                {log.note ? ` · ${log.note}` : ''}
              </span>
            </div>
          ) : isCardio ? (
            <div style={{ minWidth: 0 }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: '600' }}>{log.activity}</h4>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {log.durationMin} 分钟{log.distanceKm ? ` · ${log.distanceKm} km` : ''} · {log.time}
              </span>
            </div>
          ) : (
            <div style={{ minWidth: 0 }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
                {log.exercise}
                {log.isNewPR && <Trophy size={12} color="var(--color-accent-amber)" title="新纪录！" />}
              </h4>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {log.routineName} · {log.mode === 'time' || log.holdSec > 0
                  ? `${log.holdSec} 秒`
                  : `${formatWeight(log.weightKg, weightUnit)} × ${log.reps}次`} · {log.time}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{ fontSize: '0.9rem', fontWeight: '700', color: log.calories == null ? 'var(--text-muted)' : tint }}>
            {log.calories == null ? '卡路里未知' : `~${log.calories} kcal`}
          </span>
          {!readOnly && (
            <button
              onClick={() => handleDeleteWorkout(log.id)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderDateNav = (viewDate, setViewDate, color, { step = 1, isCurrent = (v) => v === todayStr, label = (v) => (v === todayStr ? '今天' : v), jumpLabel = '回到今天' } = {}) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <button
        type="button"
        onClick={() => setViewDate(shiftDate(viewDate, -step))}
        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.9rem', padding: '2px 4px' }}
      >
        ‹
      </button>
      <span style={{ fontSize: '0.78rem', fontWeight: '700', color: isCurrent(viewDate) ? 'var(--text-primary)' : color, minWidth: '92px', textAlign: 'center' }}>
        {label(viewDate)}
      </span>
      <button
        type="button"
        onClick={() => setViewDate(shiftDate(viewDate, step))}
        disabled={isCurrent(viewDate)}
        style={{ background: 'none', border: 'none', color: isCurrent(viewDate) ? 'var(--text-muted)' : 'var(--text-secondary)', cursor: isCurrent(viewDate) ? 'default' : 'pointer', fontSize: '0.9rem', padding: '2px 4px', opacity: isCurrent(viewDate) ? 0.4 : 1 }}
      >
        ›
      </button>
      {!isCurrent(viewDate) && (
        <button
          type="button"
          onClick={() => setViewDate(todayStr)}
          style={{ fontSize: '0.65rem', color, background: 'none', border: `1px dashed ${color}`, borderRadius: 'var(--radius-sm)', padding: '2px 6px', cursor: 'pointer' }}
        >
          {jumpLabel}
        </button>
      )}
    </div>
  );

  // One row of the exercise list, shared by the plan screen and the session's
  // "jump to another exercise" strip so both always describe the same order.
  const renderPlanRow = (p, { editable, onPick }) => {
    const isCurrent = p.index === currentIndex;
    return (
      <div
        key={p.name}
        onClick={() => onPick?.(p.index)}
        className="tap-zone"
        style={{
          display: 'flex', alignItems: 'center', gap: '9px', padding: '0.6rem 0.7rem',
          borderRadius: 'var(--radius-sm)', cursor: onPick ? 'pointer' : 'default',
          background: isCurrent ? 'var(--color-sports-soft)' : 'var(--bg-input)',
          border: `1px solid ${isCurrent ? 'var(--color-sports)' : 'var(--border-glass)'}`,
          opacity: p.isDone && !isCurrent ? 0.62 : 1,
        }}
      >
        <span style={{
          flexShrink: 0, width: '20px', height: '20px', borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.62rem', fontWeight: '800',
          background: p.isDone ? 'var(--color-money-soft)' : isCurrent ? 'var(--color-sports)' : 'var(--bg-card)',
          color: p.isDone ? 'var(--color-money)' : isCurrent ? 'var(--color-sports-ink)' : 'var(--text-muted)',
          border: `1px solid ${p.isDone ? 'var(--color-money)' : isCurrent ? 'var(--color-sports)' : 'var(--border-glass)'}`,
        }}>
          {p.isDone ? <Check size={11} /> : p.index + 1}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '0.82rem', fontWeight: isCurrent ? '800' : '600',
            color: isCurrent ? 'var(--color-sports)' : 'var(--text-primary)',
          }}>
            {p.name}
          </div>
          <div style={{ height: '3px', background: 'var(--border-glass)', borderRadius: '2px', marginTop: '5px' }}>
            <div style={{
              height: '100%', borderRadius: '2px',
              width: `${p.targetSets > 0 ? Math.min(100, (p.doneSets / p.targetSets) * 100) : 0}%`,
              background: p.isDone ? 'var(--color-money)' : 'var(--color-sports)',
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>

        <span style={{
          fontSize: '0.7rem', fontWeight: '700', flexShrink: 0,
          color: p.isDone ? 'var(--color-money)' : 'var(--text-muted)',
        }}>
          {p.viaSession && p.loggedSets === 0 ? `✓ ${p.targetSets}` : `${p.doneSets}/${p.targetSets}`}
        </span>

        {editable && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); adjustTarget(p.index, -1); }}
              title="这个动作少一组（这天总数也少一组）"
              style={miniBtn}>−</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); adjustTarget(p.index, 1); }}
              title="这个动作多一组（这天总数也多一组）"
              style={miniBtn}>+</button>
            <div style={{ display: 'flex', flexDirection: 'column', marginLeft: '2px' }}>
              <button type="button" onClick={(e) => { e.stopPropagation(); moveExercise(p.index, -1); }}
                disabled={p.index === 0} style={{ ...arrowBtn, opacity: p.index === 0 ? 0.3 : 1 }}>▲</button>
              <button type="button" onClick={(e) => { e.stopPropagation(); moveExercise(p.index, 1); }}
                disabled={p.index === plan.length - 1} style={{ ...arrowBtn, opacity: p.index === plan.length - 1 ? 0.3 : 1 }}>▼</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: '800' }}>健身 & 运动</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {inSession ? '训练中 · 一个动作一个动作来'
              : activeSection === 'strength' ? '今天练什么'
              : activeSection === 'cardio' ? '有氧 · 计时与记录'
              : activeSection === 'progress' ? '轮换 · 动作进展'
              : '我的训练菜单'}
          </p>
          <div style={{ marginTop: '5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Scale size={12} color="var(--text-muted)" />
            <span
              onClick={openBodyModal}
              title="用来计算卡路里，点击填写"
              style={{ fontSize: '0.7rem', color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline dotted' }}
            >
              {hasWeight ? (
                <>
                  体重 {formatWeight(bodyWeightKg, weightUnit)}
                  {hasBMRProfile
                    ? ` · ${ageYears}岁 · ${heightCm}cm · ${sex === 'female' ? '女' : '男'}（用于估算卡路里，点击修改）`
                    : '（点击补充年龄/身高/性别，可看基础代谢）'}
                </>
              ) : '尚未填写体重（点击填写，才能估算卡路里）'}
            </span>
            {hasWeight && (
              <button
                onClick={toggleWeightUnit}
                title="切换单位"
                style={{
                  fontSize: '0.62rem', fontWeight: '700', color: 'var(--color-sports)',
                  background: 'var(--color-sports-soft)', border: '1px solid var(--color-sports)',
                  borderRadius: 'var(--radius-sm)', padding: '1px 6px', cursor: 'pointer',
                }}
              >
                {weightUnit}
              </button>
            )}
          </div>
        </div>
        {hasWeight ? (
          <div style={{
            background: 'var(--color-sports-soft)',
            border: '1px solid var(--color-sports)',
            color: 'var(--color-sports)',
            padding: '6px 12px',
            borderRadius: 'var(--radius-lg)',
            fontSize: '0.78rem',
            fontWeight: '700',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: '2px',
            flexShrink: 0,
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Flame size={14} /> 今天总消耗 ~{grandTotalCaloriesToday} kcal
            </span>
            {/* "到现在为止", not "today" — this is a running total that has not
                finished happening yet, and the old wording next to a full day's
                BMR made it read as a completed figure at eight in the morning. */}
            <span style={{ fontSize: '0.6rem', fontWeight: '500', opacity: 0.85 }}>
              到现在为止 · 运动 ~{totalCaloriesToday} + 静息 {restingSoFar != null ? `~${restingSoFar}` : '未知'}
            </span>
            {bmrToday != null && (
              <span style={{ fontSize: '0.58rem', fontWeight: '500', opacity: 0.6 }}>
                整天静息 ~{bmrToday} kcal
              </span>
            )}
          </div>
        ) : (
          <button
            onClick={openBodyModal}
            style={{
              background: 'var(--color-sports-soft)',
              border: '1px solid var(--color-sports)',
              color: 'var(--color-sports)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-lg)',
              fontSize: '0.72rem',
              fontWeight: '700',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              flexShrink: 0,
              cursor: 'pointer',
            }}
          >
            <Flame size={14} /> 填写体重才能算卡路里
          </button>
        )}
      </div>

      {/* ================= OVERVIEW ================= */}
      {!activeSection && (
      <>
        {/* The calorie/training history as plain text, for asking an AI about
            it. Sits on the overview because that is the screen you are on when
            you wonder how the last few weeks actually went. */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => setShowTextExport(true)}
            className="btn-secondary"
            style={{ padding: '7px 12px', fontSize: '0.75rem' }}
            title="导出成文字，贴给 AI 看"
          >
            <Copy size={14} /> 导出记录
          </button>
        </div>

        <div className="glass-card" style={{ padding: '0.9rem 1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <Flame size={17} color={streak > 0 ? 'var(--color-accent-red)' : 'var(--text-muted)'} />
              <span style={{ fontSize: '0.85rem', fontWeight: '700' }}>
                {streak > 0 ? `连续训练 ${streak} 天` : '今天开始你的连续记录'}
              </span>
            </div>
            {renderDateNav(weekWindowEnd, setWeekWindowEnd, 'var(--color-sports)', {
              step: 7,
              label: (v) => (v === todayStr ? '近7天' : `${weeklyDays[0]?.date.slice(5)} ~ ${weeklyDays[6]?.date.slice(5)}`),
              jumpLabel: '回到本周',
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '48px' }}>
            {weeklyDays.map((d) => {
              const value = hasWeight ? d.calories : d.sets + d.cardioSessions;
              const heightPct = value > 0 ? Math.max(8, Math.round((value / weekChartMax) * 100)) : 0;
              return (
                <div
                  key={d.date}
                  style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}
                  title={`${d.date} · ${d.sets} 组 · ${d.cardioSessions} 次有氧${hasWeight ? ` · ~${d.calories} kcal` : ''}`}
                >
                  <div style={{
                    width: '100%', height: `${heightPct}%`, minHeight: '4px', borderRadius: '3px 3px 0 0',
                    background: value > 0 ? 'var(--color-sports)' : 'var(--bg-input)',
                    border: d.isToday ? '1px solid var(--color-sports)' : '1px solid var(--border-glass)',
                    opacity: value > 0 && !d.isToday ? 0.65 : 1,
                  }} />
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '4px', marginBottom: '10px' }}>
            {weeklyDays.map((d) => (
              <span key={d.date} style={{ flex: 1, textAlign: 'center', fontSize: '0.6rem', color: d.isToday ? 'var(--color-sports)' : 'var(--text-muted)' }}>
                {d.label}
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '6px', paddingTop: '10px', borderTop: '1px solid var(--border-glass)' }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: '1rem', fontWeight: '800' }}>{weekDaysTrained}/7</div>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>训练天数</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: '1rem', fontWeight: '800' }}>{weekSets + weekCardioSessions}</div>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{weekSets} 组 · {weekCardioSessions} 次有氧</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: '1rem', fontWeight: '800', color: 'var(--color-sports)' }}>{hasWeight ? `~${weekCalories}` : '—'}</div>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{hasWeight ? '本周消耗 kcal' : '卡路里未知'}</div>
            </div>
          </div>
        </div>

        {recentPRs.length > 0 && (
          <div className="glass-card" style={{ padding: '0.8rem 1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <Trophy size={15} color="var(--color-accent-amber)" />
              <span style={{ fontSize: '0.82rem', fontWeight: '700' }}>近期突破</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {recentPRs.map((p) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{p.exercise}</span>
                  <span style={{ fontWeight: '700', color: 'var(--color-accent-amber)' }}>
                    {formatWeight(p.weightKg, weightUnit)} × {p.reps}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Entry points. The strength one now says what today's plan IS and how
            far through it you are, so the overview answers "what am I doing
            today" without having to tap in first. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[
            {
              key: 'strength', label: '力量', icon: Dumbbell,
              color: 'var(--color-sports)', soft: 'var(--color-sports-soft)',
              title: activeRoutine ? activeRoutine.name : '力量',
              sub: `${progress.doneSets}/${progress.targetSets} 组`
                + (progress.isComplete ? ' · 今天完成了 ✓' : progress.doneSets > 0 ? ' · 训练中' : ' · 还没开始')
                + (hasWeight && strengthCaloriesToday > 0 ? ` · ~${strengthCaloriesToday} kcal` : ''),
              pct: progress.pct,
            },
            {
              key: 'progress', label: '进度', icon: Repeat,
              color: 'var(--color-accent-amber)', soft: 'var(--color-accent-amber-soft)',
              title: '训练进度',
              // Leads with what is WRONG when something is, because that is the
              // line worth reading; falls back to the plain count otherwise.
              sub: progressSummary.untrained
                ? `${progressSummary.untrained.name} 还没练过`
                : progressSummary.stalest
                  ? `${progressSummary.stalest.name} 已经 ${progressSummary.stalest.daysSince} 天没练`
                  : `过去 4 周 ${progressSummary.sessions} 次训练`,
              pct: null,
            },
            {
              key: 'cardio', label: '有氧', icon: HeartPulse,
              color: CARDIO_COLOR, soft: CARDIO_COLOR_SOFT,
              title: '有氧',
              sub: `今天 ${cardioSessionsToday} 次 · ${cardioMinutesToday} 分钟 · ${hasWeight ? `~${cardioCaloriesToday} kcal` : '卡路里未知'}`,
              pct: null,
            },
          ].map(({ key, icon: Icon, color, soft, title, sub, pct }) => (
            <div
              key={key}
              className="glass-card tap-zone"
              onClick={() => navigate(`/sports/${key}`)}
              style={{ cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: 'var(--radius-sm)', flexShrink: 0,
                    background: soft, color: color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon size={18} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <h4 style={{ fontSize: '0.88rem', fontWeight: '700' }}>{title}</h4>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{sub}</p>
                  </div>
                </div>
                <ArrowRight size={16} color="var(--text-muted)" />
              </div>
              {pct != null && (
                <div style={{ height: '4px', background: 'var(--border-glass)', borderRadius: '2px', marginTop: '10px' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '2px', transition: 'width 0.4s ease' }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </>
      )}

      {/* Back link on every detail screen. In a session it goes back to the
          plan, not all the way out — the session is one level deeper. */}
      {activeSection && (
        <button
          onClick={() => navigate(inSession ? '/sports/strength' : '/sports')}
          style={{
            display: 'flex', alignItems: 'center', gap: '2px', alignSelf: 'flex-start',
            background: 'none', border: 'none', color: 'var(--text-secondary)',
            fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer', padding: 0,
          }}
        >
          <ChevronLeft size={16} /> {inSession ? '今天的菜单' : '总览'}
        </button>
      )}

      {/* ================= STRENGTH: TODAY'S PLAN ================= */}
      {activeSection === 'strength' && !inSession && activeRoutine && (
      <div key="plan" className="section-sweep-transition">
        <div className="section-sweep-line" style={{ background: 'var(--color-sports)', boxShadow: '0 0 8px var(--color-sports)' }} />

        {/* 健身房 or 徒手 — the same four blocks either way, so this swaps the
            whole day rather than annotating individual exercises with "no
            equipment? try a push-up". The rotation carries across: doing 板块 2
            at home still means 板块 3 is next in the gym. */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '0.9rem' }}>
          {PLACES.map(pl => (
            <button
              key={pl.key}
              onClick={() => { setPlace(pl.key); setChosenRoutineId(null); setPinnedIndex(null); }}
              style={{
                flex: 1, padding: '9px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                background: place === pl.key ? 'var(--color-sports-soft)' : 'var(--bg-card)',
                border: `1px solid ${place === pl.key ? 'var(--color-sports)' : 'var(--border-glass)'}`,
                color: place === pl.key ? 'var(--color-sports)' : 'var(--text-secondary)',
                fontSize: '0.8rem', fontWeight: '700',
              }}
            >
              {pl.label}
              <span style={{ display: 'block', fontSize: '0.62rem', fontWeight: '500', opacity: 0.75, marginTop: '1px' }}>
                {pl.hint}
              </span>
            </button>
          ))}
        </div>

        {/* What you're doing today, and why that one. The rotation used to be
            a sentence above a horizontal row of cards you had to pick from;
            now it's the answer, with changing it as the secondary action. */}
        <div className="glass-card glass-card-glow" style={{ borderLeftColor: 'var(--color-sports)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--color-sports)', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Repeat size={13} /> 今天练
              </span>
              <h3 style={{ fontSize: '1.3rem', fontWeight: '800', marginTop: '3px' }}>{activeRoutine.name}</h3>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '3px', lineHeight: 1.5 }}>
                {progress.viaSession ? '今天整场记录过了 — 想补细节就逐组记录'
                  : suggestion.reason === 'in-progress' ? '今天已经开始练这个了，继续'
                  : suggestion.reason === 'rotation' && suggestion.priorName ? `上次练了「${suggestion.priorName}」，循环轮到这个`
                  : chosenRoutineId != null ? '你自己选的菜单'
                  : '从这个开始你的训练循环'}
              </p>
            </div>
            <button onClick={() => setShowRoutinePicker(true)} className="btn-secondary"
              style={{ padding: '5px 10px', fontSize: '0.68rem', flexShrink: 0 }}>
              换菜单
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '14px' }}>
            <span style={{ fontSize: '2rem', fontWeight: '800', color: progress.isComplete ? 'var(--color-money)' : 'white' }}>
              {progress.doneSets}
            </span>
            <span style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>/ {progress.targetSets} 组</span>
            <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {activeRoutine.exercises.length} 个动作 · 约 {estimateRoutineMinutes(activeRoutine)} 分钟
            </span>
          </div>
          <div style={{ height: '7px', background: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', marginTop: '8px' }}>
            <div style={{
              height: '100%', width: `${progress.pct}%`, borderRadius: 'var(--radius-sm)',
              background: progress.isComplete ? 'var(--color-money)' : 'var(--color-sports)',
              transition: 'width 0.4s ease',
            }} />
          </div>

          <button
            onClick={() => { setPinnedIndex(null); navigate('/sports/strength/session'); }}
            style={{
              width: '100%', marginTop: '14px', padding: '0.85rem',
              background: progress.isComplete ? 'var(--bg-card)' : 'var(--color-sports)',
              color: progress.isComplete ? 'var(--color-sports)' : 'var(--color-sports-ink)',
              border: progress.isComplete ? '1px solid var(--color-sports)' : 'none',
              borderRadius: 'var(--radius-sm)', fontSize: '0.92rem', fontWeight: '800', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
            }}
          >
            <Play size={16} />
            {progress.viaSession ? '再练几组？逐组记录'
              : progress.isComplete ? '今天练完了 · 再加几组'
              : progress.doneSets > 0 ? `继续训练 · 下一个「${progress.current?.name}」`
              : `开始训练 · 先做「${progress.current?.name}」`}
          </button>

          {/* The other way to log a day, and it is not a lesser one.
              Set-by-set is better data; "I did 板块 1, 50 分钟" is what actually
              gets recorded when the phone stayed in the locker and the timer
              was the one on his wrist. An app that only supports the diligent
              version of you collects a week of records and then nothing. */}
          {progress.viaSession ? (
            <p style={{
              marginTop: '10px', fontSize: '0.72rem', color: 'var(--color-money)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            }}>
              <Check size={14} /> 这个板块今天已经整场记录了
            </p>
          ) : (
            <button
              onClick={openQuickLog}
              style={{
                width: '100%', marginTop: '8px', padding: '0.7rem',
                background: 'transparent', color: 'var(--text-secondary)',
                border: '1px dashed var(--border-glass)',
                borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
              }}
            >
              <Check size={15} /> 已经练完了 · 直接记录一整场
            </button>
          )}
        </div>

        {/* The order, stated. Reorderable, but always saying what comes first. */}
        <div style={{ marginTop: '1.1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: '700' }}>动作顺序</h3>
            <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>▲▼ 换顺序 · ± 调组数</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {plan.map(p => renderPlanRow(p, { editable: true, onPick: (i) => { setPinnedIndex(i); navigate('/sports/strength/session'); } }))}
          </div>
          <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '9px', lineHeight: 1.5 }}>
            这个板块一共 {progress.targetSets} 组。± 只改这个动作，加一组就是这天多一组 —
            你的计划说几组就几组，app 不会偷偷帮你搬。
          </p>
        </div>

        {/* Today's log lives on the plan screen, not the session, so you can
            check what you did without starting a workout. */}
        <div style={{ marginTop: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: '700' }}>
              {strengthViewDate === todayStr ? '今天的力量记录' : `${strengthViewDate} 的力量记录`}
            </h3>
            {renderDateNav(strengthViewDate, setStrengthViewDate, 'var(--color-sports)')}
          </div>
          {strengthLogsForView.length === 0 ? (
            <div className="glass-card" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
              {strengthViewDate === todayStr ? '今天还没开始 — 按上面的「开始训练」。' : '这天没有力量记录。'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {strengthLogsForView.map((log) => renderLogRow(log, strengthViewDate !== todayStr))}
            </div>
          )}
        </div>
      </div>
      )}

      {/* ================= STRENGTH: THE SESSION ================= */}
      {inSession && activeRoutine && currentExercise && (
      <div key="session" className="section-sweep-transition">
        <div className="section-sweep-line" style={{ background: 'var(--color-sports)', boxShadow: '0 0 8px var(--color-sports)' }} />

        {/* Where you are in the day. */}
        <div className="glass-card" style={{ padding: '0.75rem 0.9rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem' }}>
            <span style={{ color: 'var(--text-secondary)', fontWeight: '600' }}>{activeRoutine.name}</span>
            <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Clock size={12} /> {formatClock(stopwatchSeconds)}
              {sessionActive && (
                <button onClick={resetSession} title="重置本次计时"
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontSize: '0.7rem' }}>
                  ↺
                </button>
              )}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '6px' }}>
            <span style={{ fontSize: '1.4rem', fontWeight: '800', color: progress.isComplete ? 'var(--color-money)' : 'white' }}>
              {progress.doneSets}
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>/ {progress.targetSets} 组</span>
            <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: progress.isComplete ? 'var(--color-money)' : 'var(--text-muted)' }}>
              {progress.isComplete ? '目标达成 ✓' : `还剩 ${progress.remaining} 组`}
            </span>
          </div>
          <div style={{ height: '5px', background: 'var(--border-glass)', borderRadius: '3px', marginTop: '7px' }}>
            <div style={{
              height: '100%', width: `${progress.pct}%`, borderRadius: '3px',
              background: progress.isComplete ? 'var(--color-money)' : 'var(--color-sports)',
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>

        {/* The one exercise you're on, and what follows it. */}
        <div className="glass-card glass-card-glow" style={{ borderLeftColor: 'var(--color-sports)', marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontSize: '0.68rem', color: 'var(--color-sports)', fontWeight: '700' }}>
                第 {currentIndex + 1} / {plan.length} 个动作
              </span>
              <h3 style={{ fontSize: '1.25rem', fontWeight: '800', marginTop: '2px' }}>{currentExercise.name}</h3>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
                这个动作 <strong style={{ color: currentExercise.isDone ? 'var(--color-money)' : 'var(--color-sports)' }}>
                  {currentExercise.doneSets}/{currentExercise.targetSets}
                </strong> 组
                {currentExercise.isDone ? ' · 做完了' : ` · 还差 ${currentExercise.remaining} 组`}
              </div>
            </div>
            {currentExercisePR > 0 && (
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>个人最佳</div>
                <div style={{ fontSize: '0.85rem', fontWeight: '800', color: 'var(--color-accent-amber)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Trophy size={12} /> {formatWeight(currentExercisePR, weightUnit)}
                </div>
              </div>
            )}
          </div>

          {/* The plan's own coaching note for this exercise — why it's here and
              how to do it. It was written down; it may as well be on screen at
              the moment it applies, instead of in a message from weeks ago. */}
          {(currentExercise.note || currentExercise.en) && (
            <p style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.5 }}>
              {currentExercise.en && <span style={{ color: 'var(--text-muted)' }}>{currentExercise.en}</span>}
              {currentExercise.en && currentExercise.note ? ' · ' : ''}
              {currentExercise.note}
            </p>
          )}

          <form onSubmit={handleLogSet} style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', marginTop: '0.9rem' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              {/* A wall sit has no weight to type. Hiding the field beats showing
                  a required box whose only honest answer is 0. */}
              <div style={{ flex: 1, display: isHold ? 'none' : 'block' }}>
                <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>重量 ({weightUnit})</label>
                <input
                  type="number"
                  step={weightUnit === 'lbs' ? '0.1' : '1'}
                  inputMode="decimal"
                  value={weightUnit === 'lbs'
                    ? (effectiveWeight === '' ? '' : kgToLbs(parseFloat(effectiveWeight) || 0).toFixed(1))
                    : effectiveWeight}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setWeightKg(raw === '' ? '0' : String(weightUnit === 'lbs' ? lbsToKg(parseFloat(raw) || 0) : parseFloat(raw) || 0));
                  }}
                  style={fieldStyle}
                  required={!isHold}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  {isHold ? '秒数' : '次数'}
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={effectiveReps}
                  onChange={(e) => setReps(e.target.value)}
                  style={fieldStyle}
                  required
                />
              </div>
            </div>

            <p style={{ fontSize: '0.67rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {lastSet && (isHold ? lastSet.holdSec > 0 : lastSet.reps > 0)
                ? <>上次这个动作是 <strong>
                    {isHold ? `${lastSet.holdSec} 秒` : `${formatWeight(lastSet.weightKg, weightUnit)} × ${lastSet.reps}`}
                  </strong>
                  {lastSet.date && lastSet.date !== todayStr ? `（${lastSet.date}）` : ''}，已经帮你填好了。</>
                : isHold
                  ? <>计划是撑 <strong>{prescribed} 秒</strong> × {currentExercise.targetSets} 组，已经填好了。</>
                  : <>计划是每组 <strong>{prescribed} 下</strong>，填上这组用的重量。</>}
              {hasWeight && strengthPreviewKcal > 0 && <> 这组约 ~{strengthPreviewKcal} kcal。</>}
            </p>

            <button type="submit" style={{
              background: 'var(--color-sports)', color: 'var(--color-sports-ink)',
              border: 'none', padding: '0.8rem 1.25rem', fontSize: '0.92rem', fontWeight: '800',
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
            }}>
              <CheckCircle size={16} /> 完成第 {currentExercise.doneSets + 1} 组 · 休息 {currentExercise.restSec} 秒
            </button>
          </form>

          {/* What's coming, so the order is a prompt rather than a memory test. */}
          <div style={{
            marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-glass)',
            fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            <ArrowRight size={13} color="var(--color-sports)" />
            {progress.next
              ? <>做完接着 <strong style={{ color: 'var(--color-sports)' }}>{progress.next.name}</strong> · {progress.next.targetSets} 组
                  <span style={{ color: 'var(--text-muted)' }}> · 换动作控死 {SWITCH_LIMIT_SEC} 秒内</span></>
              : currentExercise.isDone
                ? <>全部动作都做完了 — 想加练就继续这个动作。</>
                : <>这是最后一个动作，剩 {currentExercise.remaining} 组就收工。</>}
          </div>
        </div>

        {/* Rest timer — HERE, and nowhere else. It's a between-sets countdown,
            so it belongs to the only screen that has sets between. */}
        <div className="glass-card" style={{ textAlign: 'center', padding: '1.1rem 1rem', marginTop: '1rem' }}>
          <span style={{ fontSize: '0.74rem', color: 'var(--color-sports)', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
            <Timer size={14} /> 组间休息 · 计划 {currentExercise.restSec} 秒
          </span>
          <div style={{
            fontSize: '2.6rem',
            fontFamily: 'Outfit, sans-serif',
            fontWeight: '800',
            color: restSeconds === 0 ? 'var(--color-money)' : restSeconds <= 10 ? 'var(--color-accent-red)' : 'var(--color-sports)',
            letterSpacing: '2px',
            margin: '0.3rem 0',
          }}>
            {formatClock(restSeconds)}
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.8rem' }}>
            {restSeconds === 0 ? '休息完成！下一组' : timerRunning ? '休息中…' : '暂停中'}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '7px', flexWrap: 'wrap' }}>
            <button onClick={() => setTimerRunning(!timerRunning)} style={{
              background: 'var(--color-sports)', color: 'var(--color-sports-ink)', border: 'none',
              padding: '7px 15px', fontSize: '0.8rem', fontWeight: '700', borderRadius: 'var(--radius-sm)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
            }}>
              {timerRunning ? <Pause size={15} /> : <Play size={15} />}
              {timerRunning ? '暂停' : '继续'}
            </button>
            {/* The plan's own rest for THIS exercise leads, then the generic
                presets. It used to be a flat 45/60/75/90 with no indication of
                which one the programme actually asks for — so the number you
                were supposed to press was the one thing the screen didn't say. */}
            {[...new Set([currentExercise.restSec, 45, 60, 75, 90])].map(secs => (
              <button key={secs} onClick={() => startRestTimer(secs)} style={{
                background: restSeconds === secs ? 'var(--color-sports-soft)' : 'var(--bg-card)',
                border: `1px solid ${restSeconds === secs ? 'var(--color-sports)' : 'var(--border-glass)'}`,
                color: 'white', padding: '7px 13px', borderRadius: 'var(--radius-sm)',
                fontSize: '0.76rem', cursor: 'pointer',
              }}>
                {secs}秒{secs === currentExercise.restSec ? ' ·计划' : ''}
              </button>
            ))}
            <button onClick={() => setRestSeconds(prev => prev + 30)} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-glass)',
              color: 'var(--text-secondary)', padding: '7px 11px', borderRadius: 'var(--radius-sm)',
              fontSize: '0.74rem', cursor: 'pointer',
            }}>
              +30秒
            </button>
          </div>
        </div>

        {/* Jump to another exercise without leaving the session. */}
        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: '700' }}>今天的动作</h3>
            {pinnedIndex != null && (
              <button onClick={() => setPinnedIndex(null)} className="btn-secondary" style={{ padding: '3px 9px', fontSize: '0.64rem' }}>
                跟着菜单走
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {plan.map(p => renderPlanRow(p, { editable: false, onPick: setPinnedIndex }))}
          </div>
        </div>

        {weightProgressData.length >= 2 && (
          <div className="glass-card" style={{ marginTop: '1rem' }}>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: '600' }}>
              {selectedExercise} · 重量趋势
            </p>
            {/* A fixed-height placeholder, not a spinner: the chart is 120px
                tall either way, so the content below it never jumps when the
                chunk lands mid-workout. */}
            <Suspense fallback={<div style={{ height: 120 }} />}>
              <WeightTrendChart data={weightProgressData} weightUnit={weightUnit} />
            </Suspense>
          </div>
        )}

        {/* Just-logged sets, so a mistyped set can be deleted on the spot. */}
        {strengthWorkoutsToday.length > 0 && (
          <div style={{ marginTop: '1.1rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: '700', marginBottom: '0.6rem' }}>刚才做的</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {strengthWorkoutsToday.slice(0, 5).map((log) => renderLogRow(log))}
            </div>
          </div>
        )}

        <button
          onClick={() => navigate('/sports/strength')}
          className="btn-secondary"
          style={{ width: '100%', marginTop: '1.1rem', padding: '0.7rem', fontSize: '0.82rem' }}
        >
          结束训练 · 回到菜单
        </button>
      </div>
      )}

      {/* ================= CARDIO ================= */}
      {/* ================= PROGRESS ================= */}
      {activeSection === 'progress' && (
        <WorkoutProgress
          allWorkouts={allWorkouts}
          routines={routinesHere}
          weightUnit={weightUnit}
          todayStr={todayStr}
        />
      )}

      {activeSection === 'cardio' && (
      <div key="cardio" className="section-sweep-transition">
        <div className="section-sweep-line" style={{ background: CARDIO_COLOR, boxShadow: `0 0 8px ${CARDIO_COLOR}` }} />

        {/* A count-UP stopwatch, not the between-sets rest countdown that used
            to sit here. A run has no sets to rest between; what it needs is
            "how long have I been going", which then fills the duration below
            instead of being guessed afterwards. */}
        <div className="glass-card glass-card-glow" style={{ borderLeftColor: CARDIO_COLOR, textAlign: 'center', padding: '1.3rem 1rem' }}>
          <span style={{ fontSize: '0.74rem', color: CARDIO_COLOR, fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
            <Clock size={14} /> {cardioActivity}计时
          </span>
          <div style={{
            fontSize: '3rem', fontFamily: 'Outfit, sans-serif', fontWeight: '800',
            color: cardioRunning ? CARDIO_COLOR : 'var(--text-primary)',
            letterSpacing: '2px', margin: '0.4rem 0',
          }}>
            {formatClock(cardioSeconds)}
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.9rem' }}>
            {cardioRunning ? '进行中 — 切到别的分页也会继续跑'
              : cardioSeconds > 0 ? '已暂停 · 按「用这个时长」填进下面'
              : '按开始，练完停下来，分钟数会自己填好'}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={cardioRunning ? pauseCardioTimer : startCardioTimer}
              style={{
                background: CARDIO_COLOR, color: '#052430', border: 'none',
                padding: '9px 20px', fontSize: '0.85rem', fontWeight: '800',
                borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              {cardioRunning ? <Pause size={16} /> : <Play size={16} />}
              {cardioRunning ? '暂停' : cardioSeconds > 0 ? '继续' : '开始'}
            </button>
            {cardioSeconds > 0 && (
              <>
                <button onClick={useStopwatchDuration} style={{
                  background: 'var(--bg-card)', border: `1px solid ${CARDIO_COLOR}`, color: CARDIO_COLOR,
                  padding: '9px 15px', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem',
                  fontWeight: '700', cursor: 'pointer',
                }}>
                  用这个时长（{Math.max(1, Math.round(cardioSeconds / 60))} 分钟）
                </button>
                <button onClick={resetCardioTimer} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border-glass)',
                  color: 'var(--text-secondary)', padding: '9px 13px', borderRadius: 'var(--radius-sm)',
                  fontSize: '0.78rem', cursor: 'pointer',
                }}>
                  归零
                </button>
              </>
            )}
          </div>
        </div>

        <div className="glass-card" style={{ borderLeft: `3px solid ${CARDIO_COLOR}`, marginTop: '1rem' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: '800', marginBottom: '0.9rem', display: 'flex', alignItems: 'center', gap: '7px', color: CARDIO_COLOR }}>
            <HeartPulse size={17} /> 记录这次有氧
          </h3>

          <form onSubmit={handleLogCardio} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {/* Tappable chips rather than a dropdown: this is picked every
                single time and the value changes the stopwatch's own label. */}
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>运动类型</label>
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '6px' }}>
                {CARDIO_TYPES.map((t) => (
                  <button
                    key={t} type="button" onClick={() => setCardioActivity(t)}
                    style={{
                      padding: '6px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      fontSize: '0.76rem', fontWeight: cardioActivity === t ? '800' : '600',
                      background: cardioActivity === t ? CARDIO_COLOR_SOFT : 'var(--bg-input)',
                      border: `1px solid ${cardioActivity === t ? CARDIO_COLOR : 'var(--border-glass)'}`,
                      color: cardioActivity === t ? CARDIO_COLOR : 'var(--text-secondary)',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>时长（分钟）</label>
                <input
                  type="number" inputMode="numeric" value={cardioDuration}
                  onChange={(e) => setCardioDuration(e.target.value)}
                  style={fieldStyle} required
                />
              </div>

              {DISTANCE_RELEVANT.has(cardioActivity) && (
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>距离 (km，选填)</label>
                  <input
                    type="number" step="0.01" inputMode="decimal" value={cardioDistance}
                    onChange={(e) => setCardioDistance(e.target.value)}
                    placeholder="例：5" style={fieldStyle}
                  />
                </div>
              )}
            </div>

            <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {hasWeight
                ? <>预估消耗 ~{cardioPreviewKcal} kcal（依体重、时长{PACE_MET_TABLES[cardioActivity] && cardioDistance ? '与配速' : ''}估算）
                  {DISTANCE_RELEVANT.has(cardioActivity) && !cardioDistance && ' · 填了距离会更准，因为配速会算进去'}</>
                : <>先<span onClick={openBodyModal} style={{ color: CARDIO_COLOR, textDecoration: 'underline dotted', cursor: 'pointer' }}>填写体重</span>才能预估消耗多少 kcal</>}
            </p>

            <button type="submit" style={{
              background: CARDIO_COLOR, color: '#052430',
              border: 'none', padding: '0.8rem 1.25rem', fontSize: '0.9rem', fontWeight: '800',
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
            }}>
              <CheckCircle size={16} /> 记录这次有氧
            </button>
          </form>
        </div>

        <div style={{ marginTop: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: '700' }}>
              {cardioViewDate === todayStr ? '今天的有氧记录' : `${cardioViewDate} 的有氧记录`}
            </h3>
            {renderDateNav(cardioViewDate, setCardioViewDate, CARDIO_COLOR)}
          </div>
          {cardioLogsForView.length === 0 ? (
            <div className="glass-card" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
              {cardioViewDate === todayStr ? '今天还没有有氧记录。' : '这天没有有氧记录。'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {cardioLogsForView.map((log) => renderLogRow(log, cardioViewDate !== todayStr))}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Routine picker — a modal, not a row of cards permanently taking up
          the top of the strength screen. Changing menus is occasional; being
          told what today's menu IS is constant. */}
      {showRoutinePicker && (
        <div className="modal-overlay" onClick={() => setShowRoutinePicker(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>换一个菜单</h3>
              <button onClick={() => setShowRoutinePicker(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>
            {/* Scoped to the current place, same as the plan screen. Listing all
                eight here made the 健身房/徒手 toggle look decorative, and put
                「板块 3（徒手）」 one tap away while standing in the gym. */}
            <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.5 }}>
              现在看的是<strong style={{ color: 'var(--color-sports)' }}>
                {PLACES.find(pl => pl.key === place)?.label}
              </strong>的菜单。要换另一边，回上一页按 {PLACES.find(pl => pl.key !== place)?.label}。
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {routinesHere.map(r => {
                const isActive = r.id === activeRoutine?.id;
                return (
                  <div key={r.id}
                    onClick={() => { setChosenRoutineId(r.id); setPinnedIndex(null); setShowRoutinePicker(false); }}
                    className="tap-zone"
                    style={{
                      padding: '0.8rem 0.9rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      background: isActive ? 'var(--color-sports-soft)' : 'var(--bg-input)',
                      border: `1px solid ${isActive ? 'var(--color-sports)' : 'var(--border-glass)'}`,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.86rem', fontWeight: '700', color: isActive ? 'var(--color-sports)' : 'var(--text-primary)' }}>
                        {r.name}
                        {r.id === suggestion.routine?.id && (
                          <span style={{ fontSize: '0.58rem', fontWeight: '800', color: 'var(--color-sports)', marginLeft: '6px' }}>推荐</span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {r.exercises.map(e => e.name).join(' · ')}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteRoutine(r.id); }}
                      aria-label={`删除 ${r.name}`}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => { setShowRoutinePicker(false); setShowAddRoutineModal(true); }}
              className="btn-secondary"
              style={{ width: '100%', marginTop: '1rem', fontSize: '0.8rem' }}
            >
              <Plus size={14} /> 新增菜单
            </button>
          </div>
        </div>
      )}

      {/* Body Profile Modal */}
      {showBodyModal && (
        <div className="modal-overlay" onClick={() => setShowBodyModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>身体资料</h3>
              <button onClick={() => setShowBodyModal(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
              体重用于所有运动/力量的卡路里估算；年龄、身高、性别只用于估算基础代谢（静息消耗）。
            </p>
            <form onSubmit={saveBodyProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>体重 ({weightUnit})</label>
                <input
                  type="number"
                  // 0.1 in BOTH units. It used to be whole kilos, which was
                  // harmless while this was one settings value feeding a calorie
                  // formula, and is not harmless now that it feeds a trend: body
                  // weight moves in hundreds of grams, and `step="1"` makes the
                  // browser reject 66.6 on submit — you could not have logged a
                  // real weigh-in at all.
                  step="0.1"
                  value={weightDraft}
                  onChange={(e) => setWeightDraft(e.target.value)}
                  style={{ ...fieldStyle, padding: '10px 12px' }}
                  required
                />
                {lastWeighIn && (
                  <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '5px' }}>
                    上次 {lastWeighIn.date.slice(5)} · {formatWeight(lastWeighIn.kg, weightUnit)}
                    {weighInCount > 1 ? ` · 共 ${weighInCount} 次记录` : ''}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>年龄（选填，用于基础代谢）</label>
                  <input type="number" value={ageDraft} onChange={(e) => setAgeDraft(e.target.value)} style={{ ...fieldStyle, padding: '10px 12px' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>身高 cm（选填）</label>
                  <input type="number" value={heightDraft} onChange={(e) => setHeightDraft(e.target.value)} style={{ ...fieldStyle, padding: '10px 12px' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>性别（选填，用于基础代谢）</label>
                <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                  {[['male', '男'], ['female', '女']].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSexDraft(value)}
                      style={{
                        flex: 1, padding: '10px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        background: sexDraft === value ? 'var(--color-sports-soft)' : 'var(--bg-input)',
                        border: sexDraft === value ? '1px solid var(--color-sports)' : '1px solid var(--border-glass)',
                        color: sexDraft === value ? 'var(--color-sports)' : 'var(--text-primary)',
                        fontWeight: sexDraft === value ? '700' : '500', fontSize: '0.85rem',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '1rem' }}>
                <button type="button" onClick={() => setShowBodyModal(false)} className="btn-secondary" style={{ flex: 1 }}>取消</button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>保存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Whole-session log. Four fields, because that is the entire content of
          "I trained today": which block, how long, how hard, anything to note. */}
      {quickOpen && (
        <div className="modal-overlay" onClick={() => setQuickOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>记录一整场训练</h3>
              <button onClick={() => setQuickOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
              在外面用自己的计时器练完了？选板块、填时长就好，不用一组一组补。
            </p>

            <form onSubmit={handleQuickLog} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>今天练的是</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                  {routinesHere.map(r => {
                    const picked = (quickRoutineId ?? activeRoutine?.id) === r.id;
                    return (
                      <button
                        type="button"
                        key={r.id}
                        onClick={() => {
                          setQuickRoutineId(r.id);
                          setQuickMinutes(String(estimateRoutineMinutes(r) || 45));
                        }}
                        style={{
                          textAlign: 'left', padding: '10px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                          background: picked ? 'var(--color-sports-soft)' : 'var(--bg-card)',
                          border: `1px solid ${picked ? 'var(--color-sports)' : 'var(--border-glass)'}`,
                          color: 'white', fontSize: '0.82rem', fontWeight: '600',
                        }}
                      >
                        {r.name}
                        <span style={{ display: 'block', fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: '500', marginTop: '2px' }}>
                          {r.focus ?? `${r.exercises.length} 个动作`} · {routineTotalSets(r)} 组
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>练了多久（分钟）</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={quickMinutes}
                  onChange={(e) => setQuickMinutes(e.target.value)}
                  style={fieldStyle}
                  required
                />
                <p style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  已经按计划估好了（热身 {WARMUP_MIN} 分 + 所有组 + 组间休息），不对就改。
                </p>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>强度</label>
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                  {Object.entries(SESSION_INTENSITY).map(([key, meta]) => (
                    <button
                      type="button"
                      key={key}
                      onClick={() => setQuickIntensity(key)}
                      style={{
                        flex: 1, padding: '8px 6px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        background: quickIntensity === key ? 'var(--color-sports-soft)' : 'var(--bg-card)',
                        border: `1px solid ${quickIntensity === key ? 'var(--color-sports)' : 'var(--border-glass)'}`,
                        color: quickIntensity === key ? 'var(--color-sports)' : 'var(--text-secondary)',
                        fontSize: '0.76rem', fontWeight: '700',
                      }}
                    >
                      {meta.label}
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {SESSION_INTENSITY[quickIntensity]?.hint}
                </p>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>备注（选填）</label>
                <input
                  type="text"
                  placeholder="例：倒蹬机被占了，换了分腿蹲"
                  value={quickNote}
                  onChange={(e) => setQuickNote(e.target.value)}
                  style={fieldStyle}
                />
              </div>

              {/* Says what it will record BEFORE recording it — the same
                  suggest-then-confirm shape the money side uses. */}
              <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                会记成：<strong>{quickRoutine?.name}</strong> · {parseInt(quickMinutes, 10) || 0} 分钟 · {routineTotalSets(quickRoutine)} 组
                {hasWeight
                  ? <> · 约 <strong style={{ color: 'var(--color-sports)' }}>~{quickPreviewKcal} kcal</strong></>
                  : <> · <span style={{ color: 'var(--text-muted)' }}>填了体重才算得出卡路里</span></>}
              </p>

              <button type="submit" style={{
                background: 'var(--color-sports)', color: 'var(--color-sports-ink)', border: 'none',
                padding: '0.85rem', fontSize: '0.9rem', fontWeight: '800',
                borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              }}>
                <CheckCircle size={16} /> 记录这一场
              </button>
            </form>
          </div>
        </div>
      )}

      {showTextExport && (
        <TextExportModal onClose={() => setShowTextExport(false)} />
      )}

      {/* Add Routine Modal */}
      {showAddRoutineModal && (
        <div className="modal-overlay" onClick={() => setShowAddRoutineModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>新增训练菜单</h3>
              <button onClick={() => setShowAddRoutineModal(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <form onSubmit={handleAddRoutine} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>菜单名称</label>
                <input
                  type="text"
                  placeholder="例：肩部 & 核心"
                  value={newRoutineName}
                  onChange={(e) => setNewRoutineName(e.target.value)}
                  style={{ ...fieldStyle, padding: '10px 12px' }}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>动作（用逗号分隔，按训练顺序）</label>
                <input
                  type="text"
                  placeholder="例：肩上推举, 侧平举, 面拉, 平板支撑"
                  value={newRoutineExercises}
                  onChange={(e) => setNewRoutineExercises(e.target.value)}
                  style={{ ...fieldStyle, padding: '10px 12px' }}
                  required
                />
                <p style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.5 }}>
                  会先自动分配组数（排前面的多一组，因为通常是大重量的复合动作），之后在菜单页 ± 随便改。
                  建好之后在菜单页可以再调。
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '1rem' }}>
                <button type="button" onClick={() => setShowAddRoutineModal(false)} className="btn-secondary" style={{ flex: 1 }}>取消</button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>保存菜单</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

const miniBtn = {
  background: 'var(--bg-card)', border: '1px solid var(--border-glass)',
  color: 'var(--text-secondary)', cursor: 'pointer', padding: '0 6px',
  fontSize: '0.75rem', lineHeight: '18px', borderRadius: '4px',
};

const arrowBtn = {
  background: 'none', border: 'none', color: 'var(--text-secondary)',
  cursor: 'pointer', padding: 0, lineHeight: '10px', fontSize: '0.55rem',
};
