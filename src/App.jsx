import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import confetti from 'canvas-confetti';
import Header from './components/Header';
import BottomNav from './components/BottomNav';
import Dashboard from './components/Dashboard';
import DietModule from './components/DietModule';
import SportsModule, { DEFAULT_ROUTINES } from './components/SportsModule';
import { countSets } from './utils/workoutPlan';
import MoneyModule from './components/MoneyModule';
import AiAssistantModal from './components/AiAssistantModal';
import LifeHub from './components/LifeHub';
import NotesModule from './components/NotesModule';
import RemindersModule from './components/RemindersModule';
import SpecialDaysModule from './components/SpecialDaysModule';
import SurvivalBanner from './components/SurvivalBanner';
import UpdateBanner from './components/UpdateBanner';
import LoginGate from './components/LoginGate';
import { usePersistentState, useLiveJSON, getTodayString, loadJSON } from './utils/storage';
import { num, sumBy } from './utils/num';
import { runMigrations } from './utils/migrate';
import { computeNetPosition } from './utils/networth';
import { resolveAccounts, isDailySpend } from './utils/accounts';
import { getCycle } from './utils/cycle';
import { subscribe as subscribeSync, getState as getSyncState } from './utils/cloudSync';
import { useAndroidBackButton } from './hooks/useAndroidBackButton';
import { useTngCapture } from './hooks/useTngCapture';
import { buildFeed } from './utils/upNext';
import { syncScheduled } from './utils/notify';

/**
 * The banner strip under the header, per top-level route.
 *
 * A lookup table rather than the chain of `activeTab === 'x' &&` this used to
 * be. With four tabs the chain read fine — but the Life Hub's three screens
 * are not tabs, and nothing about that chain made it obvious they had to be
 * added to it, so /notes rendered the banner's frame with NOTHING inside it. A
 * table makes a missing entry visible, and an unmatched route now renders no
 * banner at all rather than an empty one.
 */
const HUD = {
  dashboard: ['⚡ OVERVIEW // 系统概览', '全局数据监控 · 动态记录'],
  diet: ['🥗 DIET AI // 智能饮食', '热量追踪 · 智能分析'],
  sports: ['🏋️ SPORTS // 健身打卡', '力量 · 有氧 · 四分化'],
  money: ['💰 MONEY // 财务风控', 'TNG记账 · 每日预算'],
  notes: ['📝 NOTES // 记事本', '随手记下 · 自动储存'],
  reminders: ['🔔 REMIND // 提醒事项', '一次 · 每天 · 每周 · 每月'],
  special: ['⭐ SPECIAL // 特别的日子', '生日 · 纪念日 · 倒数'],
};

// Rest-timer completion beep (A5 sine tone)
function playBeep() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
  } catch (e) {
    console.log('Audio error:', e);
  }
}

// Signatures of the demo history that used to ship with the app. It inflated
// the Level/XP badge with days the user never actually logged, so it's gone —
// this list only exists to purge it from storage for anyone who still has it.
const RETIRED_DEMO_HISTORY = [
  [1950, 3, 4, 62.30],
  [2260, 4, 0, 91.10],
  [1780, 3, 6, 45.00],
  [2050, 4, 3, 70.50],
  [1600, 2, 5, 38.20],
  [2400, 5, 2, 102.40],
];

function isRetiredDemoDay(d) {
  return RETIRED_DEMO_HISTORY.some(([cal, meals, sets, spend]) =>
    d.totalCalories === cal && d.mealsLogged === meals && d.totalSets === sets && d.totalExpense === spend
  );
}

// Exclusive range: the days strictly between two YYYY-MM-DD dates.
// Capped at 30 so a long absence can't blow up history.
function datesBetween(startDate, endDate) {
  const out = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  cursor.setDate(cursor.getDate() + 1);

  while (cursor < end && out.length < 30) {
    out.push(getTodayString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

// Runs once at module load, before any component reads storage — doing this in
// an effect would race with Dashboard, which reads lastSeenLevel while rendering.
function purgeDemoHistory() {
  try {
    if (localStorage.getItem('lifemanager:demoHistoryPurged') === 'true') return;

    const raw = localStorage.getItem('lifemanager:history');
    if (raw) {
      const cleaned = JSON.parse(raw).filter(d => !isRetiredDemoDay(d));
      localStorage.setItem('lifemanager:history', JSON.stringify(cleaned));
    }
    // Level is derived from history, so it drops. Clear the high-water mark or
    // confetti stays suppressed until the old inflated level is re-earned.
    localStorage.removeItem('lifemanager:lastSeenLevel');
    localStorage.setItem('lifemanager:demoHistoryPurged', 'true');
  } catch (e) {
    console.warn('Demo history purge failed', e);
  }
}

// The gym module's built-in routines shipped in English, then got translated
// to Chinese. Only overwrites the untouched shipped defaults — a routine the
// user renamed, edited, or added themselves is left alone.
const LEGACY_DEFAULT_ROUTINE_NAMES = [
  'Chest & Triceps Power', 'Back & Biceps Hypertrophy', 'Leg Day Blitz', 'Fat Burn HIIT & Core',
];

function localizeDefaultRoutines() {
  try {
    if (localStorage.getItem('lifemanager:routinesLocalized') === 'true') return;

    const raw = localStorage.getItem('lifemanager:routines');
    if (raw) {
      const stored = JSON.parse(raw);
      const isUntouchedDefault = Array.isArray(stored)
        && stored.length === LEGACY_DEFAULT_ROUTINE_NAMES.length
        && stored.every((r, i) => r?.name === LEGACY_DEFAULT_ROUTINE_NAMES[i]);
      if (isUntouchedDefault) {
        localStorage.setItem('lifemanager:routines', JSON.stringify(DEFAULT_ROUTINES));
      }
    }
    localStorage.setItem('lifemanager:routinesLocalized', 'true');
  } catch (e) {
    console.warn('Routine localization failed', e);
  }
}

purgeDemoHistory();
localizeDefaultRoutines();
// Stamps pre-schema-v2 records with the day they were logged. Must run before
// any component reads storage, for the same reason as the purge above.
runMigrations();

/**
 * Presents an all-time record list to a module as if it were just today's.
 *
 * Records are now append-only and date-stamped (SCHEMA.md), but the modules
 * were written against "today's array" and do things like
 * `setMeals([newMeal, ...meals])`. Rather than rewrite all of them, they get a
 * filtered view plus a setter that splices their result back into the full
 * list — so a module can only ever affect today, and other days are untouchable
 * by construction.
 */
function useTodayRecords(all, setAll, today) {
  const todays = useMemo(
    () => all.filter(r => (r.date ?? today) === today),
    [all, today]
  );

  const setTodays = useCallback((updater) => {
    setAll(prev => {
      const mine = prev.filter(r => (r.date ?? today) === today);
      const others = prev.filter(r => (r.date ?? today) !== today);
      const next = typeof updater === 'function' ? updater(mine) : updater;
      // Anything the module just created has no date yet.
      const stamped = next.map(r => (r.date ? r : { ...r, date: today, at: r.at ?? Date.now() }));
      return [...others, ...stamped];
    });
  }, [setAll, today]);

  return [todays, setTodays];
}

export default function App() {
  // Top-level tab is now the URL's first path segment, not local state — see
  // src/main.jsx for the HashRouter this relies on. Still used exactly like
  // the old activeTab: to key the HUD banner and the page-transition wrapper
  // (so a top-level tab switch replays the sweep, but switching sections
  // *within* a module like /sports/:section does not).
  const location = useLocation();
  const activeTab = location.pathname.split('/')[1] || 'dashboard';
  useAndroidBackButton();
  const [showAiModal, setShowAiModal] = useState(false);
  // The centre button's sheet. Lives here rather than in BottomNav because the
  // sheet has to render OUTSIDE the nav island's clipping and z-index, and
  // because one of its four actions opens the AI modal, which App owns.
  const [hubOpen, setHubOpen] = useState(false);

  // A real front door on first launch, instead of the sign-in button being
  // buried three taps deep in Header → 备份 → Sync. `loginGateSeen` is set
  // the first time it's dismissed (signed in OR explicitly skipped) so a
  // returning user is never asked again — see LoginGate.jsx.
  const [loginGateSeen, setLoginGateSeen] = usePersistentState('loginGateSeen', false);
  const [sync, setSync] = useState(getSyncState);
  useEffect(() => subscribeSync(setSync), []);
  const showLoginGate = sync.available && !sync.user && !loginGateSeen;

  // Global State for Diet Module
  const [calorieLimit, setCalorieLimit] = usePersistentState('calorieLimit', 2100);
  const [macroTargets, setMacroTargets] = usePersistentState('macroTargets', { protein: 140, carbs: 220, fat: 65 });
  // These all start empty. They used to ship with demo entries, which meant a
  // new user's first screen showed meals they never ate and XP they never
  // earned — same problem as the retired demo history.
  // These hold EVERY record ever logged, each stamped with its date. The
  // midnight rollover used to empty them, which destroyed the detail — a set of
  // "Bench Press 80kg x 10" survived only as the number 4. See SCHEMA.md.
  const [allMeals, setAllMeals] = usePersistentState('meals', []);
  const [allWorkouts, setAllWorkouts] = usePersistentState('workouts', []);

  // Global State for Money Module (TNG eWallet)
  const [dailyBudget, setDailyBudget] = usePersistentState('dailyBudget', 80.00);
  const [allExpenses, setAllExpenses] = usePersistentState('expenses', []);

  // Read-only, live-synced — accounts/debts are owned by AccountsView, several
  // tabs away. The survival banner below has to stay accurate the moment a
  // balance is edited, not just after a tab switch remounts a stale read, so
  // this uses useLiveJSON rather than a second usePersistentState instance.
  const accounts = useLiveJSON('accounts', []);
  const debts = useLiveJSON('debts', []);

  // Reminders and special days are owned by their own screens. App reads them
  // only to keep the OS's alarm window in step — see the effect below.
  const reminders = useLiveJSON('reminders', []);
  const specialDays = useLiveJSON('specialDays', []);

  // resolveAccounts FIRST — `balance` is derived and never stored (see
  // accounts.js), so the raw array straight out of localStorage has no
  // `balance` field at all. Feeding it to computeNetPosition summed a column
  // of `undefined`: ownCash was always exactly RM 0.00, which put
  // `inSurvivalMode` permanently true no matter how much money was in the
  // accounts. A red alert that never switches off is not an alert, so this
  // quietly disabled module 3 of the firewall spec rather than breaking
  // visibly. Caught because the banner said RM 0.00 while the Money tab's own
  // panel, which does resolve, said RM 83.90 on the same screen.
  const resolvedAccounts = useMemo(
    () => resolveAccounts(accounts, allExpenses), [accounts, allExpenses],
  );
  const netPosition = useMemo(
    () => computeNetPosition(resolvedAccounts, debts, allExpenses),
    [resolvedAccounts, debts, allExpenses],
  );
  // Today re-derived on each render so a rollover while the app is open moves
  // the modules onto the new day without a reload.
  const [today, setToday] = useState(getTodayString);

  // Keyed on `today`, not `[]`. The survival banner reads `daysRemaining` off
  // this to say "还有 N 天才发薪"; frozen at mount it counted down to the wrong
  // payday for as long as the app stayed open, which on Android is days.
  //
  // `today` is deliberately a dependency the body doesn't reference — getCycle()
  // reads the clock itself, so the date IS the cache key. The linter can't see
  // that and calls it unnecessary; removing it is exactly the bug.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cycle = useMemo(() => getCycle(), [today]);

  // What the modules see: today's slice, with setters that write back into the
  // full list. Module code is unchanged.
  const [meals, setMeals] = useTodayRecords(allMeals, setAllMeals, today);
  const [workouts, setWorkouts] = useTodayRecords(allWorkouts, setAllWorkouts, today);
  const [expenses, setExpenses] = useTodayRecords(allExpenses, setAllExpenses, today);

  // --- writing to a day that isn't today -----------------------------------
  //
  // `setExpenses` above can only ever touch today, on purpose: it hands the
  // module a filtered view and splices the result back, so other days are
  // untouchable by construction. That protection is right for auto-capture and
  // wrong for the one thing the user asked for — logging yesterday's payment
  // that he forgot to enter, and fixing a date that came out wrong.
  //
  // So the ability to write another day is its own narrow, explicit pair of
  // functions rather than handing MoneyModule the raw `setAllExpenses`. An
  // upsert and a delete-by-id is the whole surface; nothing here can rewrite a
  // day wholesale the way a raw setter could.
  const saveExpense = useCallback((record) => {
    if (!record?.id) return;
    setAllExpenses(prev => {
      // `date` is what makes this an any-day write; falling back to today
      // matches how an undated record has always been treated.
      const stamped = {
        ...record,
        date: record.date ?? getTodayString(),
        at: record.at ?? Date.now(),
        // Cloud sync's change detection — see touchedAt() in syncModel.js.
        // Deliberately NOT `at`: `at` is when the money moved, and back-dating
        // an expense must not make it look older than the copy in the cloud.
        updatedAt: Date.now(),
      };
      const exists = prev.some(e => e.id === record.id);
      return exists
        ? prev.map(e => (e.id === record.id ? stamped : e))
        : [stamped, ...prev];
    });
  }, [setAllExpenses]);

  // Takes a LIST because a transfer is two linked records and deleting one half
  // leaves both balances wrong in opposite directions — the worst state for a
  // ledger, since each account still looks individually plausible.
  const deleteExpenses = useCallback((ids) => {
    const doomed = new Set(Array.isArray(ids) ? ids : [ids]);
    if (doomed.size === 0) return;
    setAllExpenses(prev => prev.filter(e => !doomed.has(e.id)));
  }, [setAllExpenses]);

  // Notification capture — here for the same reason the rest timer is: the
  // Money screen unmounts the moment you navigate away, and this has to keep
  // working while you're anywhere else in the app, or off it entirely. It used
  // to be wired up inside the Money screen's auto-capture card, so a payment
  // made while you were on any other tab was captured by the phone and then
  // thrown away before it ever reached an expense.
  useTngCapture({ setExpenses });

  // Gym rest timer — lives here, not in SportsModule, so it keeps counting
  // while you're on another tab (SportsModule unmounts when you navigate away)
  const [restSeconds, setRestSeconds] = useState(60);
  const [timerRunning, setTimerRunning] = useState(false);

  // Session stopwatch. It used to be incremented inside the rest-timer
  // interval, so "Total Session" actually measured time spent *resting* — it
  // froze the moment a rest ended. It now runs from the wall clock, from the
  // start of the session until it's reset.
  const [sessionStartedAt, setSessionStartedAt] = useState(null);
  const [stopwatchSeconds, setStopwatchSeconds] = useState(0);

  useEffect(() => {
    if (sessionStartedAt === null) { setStopwatchSeconds(0); return; }
    const tick = () => setStopwatchSeconds(Math.floor((Date.now() - sessionStartedAt) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [sessionStartedAt]);

  // Cardio stopwatch — a count-UP clock, and deliberately not the same thing as
  // the rest countdown above.
  //
  // The cardio screen used to show the between-sets rest timer, which is
  // meaningless there: a run has no sets to rest between. What it actually
  // needs is "how long have I been going", which then fills the duration field
  // so the minutes aren't guessed after the fact.
  //
  // Lives up here with the rest timer for the same reason: SportsModule
  // unmounts when you switch tabs, and a stopwatch that resets because you
  // checked a message is worse than no stopwatch.
  //
  // Split into a paused accumulator plus a running-since stamp so pausing at a
  // traffic light doesn't lose the elapsed time, and so the clock is read from
  // the wall clock rather than counted by an interval that stalls in a
  // backgrounded WebView.
  const [cardioStartedAt, setCardioStartedAt] = useState(null);
  const [cardioBaseSeconds, setCardioBaseSeconds] = useState(0);
  const [cardioSeconds, setCardioSeconds] = useState(0);

  useEffect(() => {
    if (cardioStartedAt === null) { setCardioSeconds(cardioBaseSeconds); return; }
    const tick = () => setCardioSeconds(cardioBaseSeconds + Math.floor((Date.now() - cardioStartedAt) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [cardioStartedAt, cardioBaseSeconds]);

  // When the rest countdown last hit zero, so the "rest complete" notification
  // can expire instead of sitting in the bell forever.
  const [restCompletedAt, setRestCompletedAt] = useState(null);

  useEffect(() => {
    if (!timerRunning) return;

    const interval = setInterval(() => {
      setRestSeconds(prev => {
        if (prev <= 1) {
          setTimerRunning(false);
          setRestCompletedAt(Date.now());
          playBeep();
          confetti({ particleCount: 30, spread: 50 });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timerRunning]);

  const startRestTimer = (seconds = 60) => {
    setRestSeconds(seconds);
    setTimerRunning(true);
    setRestCompletedAt(null);
    setSessionStartedAt(prev => prev ?? Date.now());
  };

  const resetSession = () => {
    setSessionStartedAt(null);
    setRestCompletedAt(null);
  };

  const startCardioTimer = () => setCardioStartedAt(prev => prev ?? Date.now());

  const pauseCardioTimer = () => {
    setCardioStartedAt(prev => {
      if (prev === null) return null;
      setCardioBaseSeconds(b => b + Math.floor((Date.now() - prev) / 1000));
      return null;
    });
  };

  const resetCardioTimer = () => { setCardioStartedAt(null); setCardioBaseSeconds(0); };

  const timer = {
    restSeconds, setRestSeconds,
    timerRunning, setTimerRunning,
    stopwatchSeconds,
    sessionActive: sessionStartedAt !== null,
    startRestTimer,
    resetSession,
    // Cardio's own clock — see above for why it isn't the rest timer.
    cardioSeconds,
    cardioRunning: cardioStartedAt !== null,
    startCardioTimer,
    pauseCardioTimer,
    resetCardioTimer,
  };

  // Real alerts derived from today's actual data — the bell used to be a
  // permanent "you're all caught up" with no logic behind it.
  const totalCaloriesToday = sumBy(meals, m => m.calories);
  // `isSpendingRecord`, not just "not a transfer": an arrival (生活费, salary)
  // is stored negative so it credits the account, and counting it here made
  // today's spend negative — see accounts.js.
  const totalSpendToday = sumBy(expenses.filter(isDailySpend), e => e.amount);

  const alerts = [];
  if (totalCaloriesToday > calorieLimit) {
    alerts.push({
      id: 'calories',
      tone: 'bad',
      text: `Over your calorie limit by ${totalCaloriesToday - calorieLimit} kcal.`,
    });
  } else if (meals.length > 0 && totalCaloriesToday >= calorieLimit * 0.85) {
    alerts.push({
      id: 'calories-near',
      tone: 'warn',
      text: `${calorieLimit - totalCaloriesToday} kcal left before you hit your limit.`,
    });
  }
  if (totalSpendToday > dailyBudget) {
    alerts.push({
      id: 'budget',
      tone: 'bad',
      text: `Over budget by RM ${(totalSpendToday - num(dailyBudget)).toFixed(2)}.`,
    });
  }
  // Expires after two minutes. This used to have no time component, so once a
  // rest finished the notification stayed in the bell indefinitely.
  if (restCompletedAt !== null && Date.now() - restCompletedAt < 120_000) {
    alerts.push({ id: 'rest', tone: 'good', text: 'Rest complete — ready for your next set.' });
  }

  // History of past days' totals, used for the Overview trend chart & XP.
  // Starts empty — every entry here is a day you actually logged.
  const [history, setHistory] = usePersistentState('history', []);
  const [lastActiveDate, setLastActiveDate] = usePersistentState('lastActiveDate', getTodayString());

  // XP banked from days that aged out back when history was capped at 30.
  //
  // That cap was why Level used to fall over time — total XP was recomputed by
  // summing `history`, so on day 31 the oldest day's XP silently vanished.
  // History is no longer capped, so nothing new is ever banked here; it's read
  // only so anyone who already accumulated a value keeps their level.
  const archivedXp = loadJSON('archivedXp', 0);

  // The rollover runs from a timer and a visibility listener that are created
  // once, so reading state directly would give them values frozen at mount.
  // Holds the FULL record lists, not the today-filtered views. The rollover
  // summarises `lastActiveDate`, and by the time it runs the filter has already
  // moved to today — reading the filtered views summarised an empty list and
  // wrote a day of zeros over real activity.
  const latest = useRef(null);
  latest.current = { allMeals, allWorkouts, allExpenses, calorieLimit, dailyBudget, lastActiveDate };

  // Which date we've already rolled over to. Covers both React StrictMode's
  // dev-mode double-invoke and repeated timer ticks firing before the
  // `lastActiveDate` state update has flushed.
  const rolledTo = useRef(null);

  // Day rollover: archive yesterday's totals into history, clear today's logs.
  const runRollover = () => {
    const { allMeals, allWorkouts, allExpenses, calorieLimit, dailyBudget, lastActiveDate } = latest.current;
    const today = getTodayString();

    // Keep the "today" filter honest even when no archiving is due — the app
    // may simply have been left open across midnight.
    setToday(prev => (prev === today ? prev : today));

    if (lastActiveDate !== today && rolledTo.current !== today) {
      rolledTo.current = today;

      // Summarise the day being closed, by its own date.
      const on = (list) => list.filter(r => (r.date ?? lastActiveDate) === lastActiveDate);
      const dayMeals = on(allMeals);
      const dayWorkouts = on(allWorkouts);
      const dayExpenses = on(allExpenses);

      // Every number here goes through `sumBy`/`num` for the same reason the
      // transfer filter below is explicit: history is NEVER recomputed, so a
      // wrong value written at this moment is wrong forever. A single record
      // with a missing `calories` or `amount` (a hand-edited row, a restored
      // backup from an older build, a cloud merge from a device on a different
      // version) used to make the whole sum NaN — and a NaN day then poisons
      // the XP/Level total, which is summed straight out of this list.
      const entries = [{
        date: lastActiveDate,
        totalCalories: sumBy(dayMeals, m => m.calories),
        calorieLimit: num(calorieLimit),
        mealsLogged: dayMeals.length,
        // countSets, not `.length` — a whole session logged in one tap is
        // worth the sets it planned, and cardio is worth none. See
        // workoutPlan.js. This figure feeds the streak and the week stats.
        totalSets: countSets(dayWorkouts),
        // Transfers net to zero anyway, but they're filtered explicitly so a
        // half-logged pair can't skew an archived day — and arrivals are
        // filtered because they are not negative spending (accounts.js). A day
        // an allowance landed used to be archived as a large negative
        // `totalExpense`, forever.
        totalExpense: sumBy(dayExpenses.filter(isDailySpend), e => e.amount),
        dailyBudget: num(dailyBudget),
      }];

      // Backfill any days skipped entirely as explicit zero-days. Without these
      // the chart draws a straight line across a gap, which reads as "no change"
      // rather than "you didn't log anything". They earn 0 XP either way.
      for (const date of datesBetween(lastActiveDate, today)) {
        entries.push({
          date,
          totalCalories: 0, calorieLimit: num(calorieLimit),
          mealsLogged: 0, totalSets: 0,
          totalExpense: 0, dailyBudget: num(dailyBudget),
        });
      }

      setHistory(prev => {
        // Never let a backfilled zero-day overwrite or duplicate a real logged
        // day, and keep the list in date order — the chart reads it positionally.
        const seen = new Set(prev.map(d => d.date));
        const merged = [...prev, ...entries.filter(e => !seen.has(e.date))];
        merged.sort((a, b) => a.date.localeCompare(b.date));
        // No longer capped at 30. A day's summary is ~100 bytes, so a year is
        // about 36 KB — and capping it was what made Level go backwards.
        return merged;
      });

      // Records are NOT cleared. They carry their own date, so today's views
      // move on by themselves; clearing here is what used to destroy the
      // detail behind every summary.
      setToday(today);
      setLastActiveDate(today);
    }
  };

  // Rollover has to be re-checked while the app is open, not only at startup.
  // A phone app left running overnight would otherwise never archive the day,
  // and today's meals/sets/spend would keep piling onto yesterday's totals.
  useEffect(() => {
    runRollover();
    const onVisible = () => { if (!document.hidden) runRollover(); };
    document.addEventListener('visibilitychange', onVisible);
    // Backstop for a device that simply stays awake on this screen.
    const interval = setInterval(runRollover, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the OS holding alarms for the next 60 days of reminders and special
  // days — see notify.js for why it's a rolling window rather than a repeating
  // alarm, and upNext.js for why the ids make this cheap to re-run.
  //
  // Runs on every edit (the dependencies) AND on resume, which is the one that
  // matters: on Android the app is suspended for days at a time, so "the window
  // is topped up whenever you open it" is the whole mechanism. Deliberately
  // fire-and-forget — syncScheduled never throws, and nothing on screen waits
  // for it.
  useEffect(() => {
    const run = () => {
      syncScheduled(buildFeed({
        reminders, specialDays, now: Date.now(), horizonDays: 60, perReminderLimit: 4,
      }));
    };
    run();
    const onVisible = () => { if (!document.hidden) run(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reminders, specialDays]);

  // Placed after every hook above (never conditionally skipping a hook call,
  // just short-circuiting the JSX) — see LoginGate.jsx for why this only
  // shows once, and never at all when Firebase isn't configured.
  if (showLoginGate) {
    return <LoginGate onDismiss={() => setLoginGateSeen(true)} />;
  }

  return (
    <div className="app-viewport">
      {/* Top Header Bar */}
      <Header alerts={alerts} onOpenAi={() => setShowAiModal(true)} />

      {/* Above the survival banner deliberately: an update is a one-off action
          you take and dismiss, while survival mode is a condition that stays
          until the money situation changes. Pushing the persistent one down
          the page would be the wrong way round. */}
      <UpdateBanner />

      {/* Module 3 of the firewall spec: shown on every tab, not just Money —
          no dismiss button, see SurvivalBanner.jsx for why. */}
      {netPosition.inSurvivalMode && (
        <SurvivalBanner ownCash={netPosition.ownCash} daysRemaining={cycle.daysRemaining} />
      )}

      {/* Main Tab Content with Page Transition & Cyber HUD Text */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Cyber HUD Animated Status Banner */}
        {HUD[activeTab] && (
          <div key={`hud-${activeTab}`} className={`cyber-hud-banner hud-${activeTab}`}>
            <div className="hud-banner-line" />
            <span className="hud-tag">{HUD[activeTab][0]}</span>
            <span className="hud-subtext">{HUD[activeTab][1]}</span>
          </div>
        )}

        <div key={activeTab} className="tab-page-transition" style={{ flex: 1 }}>
          <Routes>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={
              <Dashboard
                meals={meals}
                calorieLimit={calorieLimit}
                workouts={workouts}
                expenses={expenses}
                allMeals={allMeals}
                allWorkouts={allWorkouts}
                allExpenses={allExpenses}
                dailyBudget={dailyBudget}
                history={history}
                archivedXp={archivedXp}
                onOpenAi={() => setShowAiModal(true)}
                onStartRestTimer={startRestTimer}
              />
            } />

            <Route path="/diet" element={
              <DietModule
                meals={meals}
                setMeals={setMeals}
                calorieLimit={calorieLimit}
                setCalorieLimit={setCalorieLimit}
                macroTargets={macroTargets}
                setMacroTargets={setMacroTargets}
                workouts={workouts}
              />
            } />

            {/* Two optional segments: /sports (overview), /sports/strength
                (today's plan), /sports/strength/session (training). The session
                is its own URL so the Android back button leaves a workout the
                way it leaves anything else. */}
            <Route path="/sports/:section?/:sub?" element={
              <SportsModule
                workouts={workouts}
                setWorkouts={setWorkouts}
                timer={timer}
                history={history}
                allWorkouts={allWorkouts}
              />
            } />

            <Route path="/money/:view?" element={
              <MoneyModule
                expenses={expenses}
                setExpenses={setExpenses}
                allExpenses={allExpenses}
                onSaveExpense={saveExpense}
                onDeleteExpenses={deleteExpenses}
                dailyBudget={dailyBudget}
                setDailyBudget={setDailyBudget}
                today={today}
              />
            } />

            {/* The Life Hub's three screens. Each is a REAL route with an
                optional id, not a modal, for two reasons: the Android back
                button then walks editor → list → wherever you came from with no
                special handling, and each screen keeps ONE mounted
                usePersistentState for its key (two routes would mean two
                instances of the same hook drifting apart — see storage.js).
                `/notes/new` is what the hub's tiles link to, so a tap lands
                straight in an empty note rather than on a list with an Add
                button. */}
            <Route path="/notes/:id?" element={<NotesModule />} />
            <Route path="/reminders/:id?" element={<RemindersModule />} />
            <Route path="/special/:id?" element={<SpecialDaysModule />} />

            {/* Catch-all. Without it an unmatched hash renders the shell with
                an empty content area — header and nav present, nothing between
                them, and no way back except the nav. That is reachable in the
                APK specifically: the WebView restores the last hash across an
                upgrade, so a route removed or renamed in a new version drops
                the returning user onto a blank screen that reads as a crash. */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>
      </main>

      {/* Bottom Navigation */}
      <BottomNav onToggleHub={() => setHubOpen(v => !v)} hubOpen={hubOpen} />

      {/* The centre button's four actions. Rendered after the nav so it stacks
          above the page, and outside it so the sheet isn't trapped inside the
          nav island's rounded, clipped box. */}
      <LifeHub
        open={hubOpen}
        onClose={() => setHubOpen(false)}
        onOpenAi={() => setShowAiModal(true)}
      />

      {/* Floating AI Assistant Modal */}
      {showAiModal && (
        <AiAssistantModal
          onClose={() => setShowAiModal(false)}
          meals={meals}
          calorieLimit={calorieLimit}
          macroTargets={macroTargets}
          workouts={workouts}
          expenses={expenses}
          dailyBudget={dailyBudget}
        />
      )}
    </div>
  );
}
