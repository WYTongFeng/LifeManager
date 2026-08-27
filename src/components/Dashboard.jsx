import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Flame, Dumbbell, Wallet, Sparkles, ArrowRight, Camera, Timer, BellRing, History as HistoryIcon,
  CalendarDays,
} from '../utils/icons';
import confetti from 'canvas-confetti';
import UpNextCard from './UpNextCard';
import { useLiveJSON, usePersistentState, getTodayString, useToday, useNowMinute } from '../utils/storage';
import { num, sumBy } from '../utils/num';
import { computeDayXP, computeLevel } from '../utils/gamification';
import { resolveAccounts, typeMeta, isDailySpend } from '../utils/accounts';
// `computeSpendable` returns everything `computeNetPosition` does, spread onto
// its own result — one call, so the overview cannot disagree with itself.
import { computeSpendable } from '../utils/networth';
import { getCycle } from '../utils/cycle';
import { countSets } from '../utils/workoutPlan';
import {
  calcBMR, calcEnergyBalance, restingBurnSoFar, ACTIVITY_LEVELS, DEFAULT_ACTIVITY,
} from '../utils/calories';
import { AccountChip } from './AccountPicker';
import { subscribe, getState } from '../utils/cloudSync';
import HistoryModal from './HistoryModal';
import WeekReview from './WeekReview';
import { getWeek, computeWeekComparison, pickWeekHighlights, hasData } from '../utils/weekStats';

export default function Dashboard({
  meals, calorieLimit,
  workouts,
  expenses, dailyBudget,
  allMeals = [], allWorkouts = [], allExpenses = [],
  history, archivedXp = 0,
  onOpenAi, onStartRestTimer
}) {
  const navigate = useNavigate();
  const [showHistory, setShowHistory] = useState(false);
  const [showWeek, setShowWeek] = useState(false);
  // Overview was the one screen that talked about money without ever saying
  // whose money or which account — a "TNG Money Tracker" card, on an app that
  // now knows about four accounts.
  const rawAccounts = useLiveJSON('accounts', []);
  const accounts = useMemo(() => resolveAccounts(rawAccounts, allExpenses), [rawAccounts, allExpenses]);
  // Real debts passed in, not `[]`. Only `ownCash` is read below and that is
  // debt-independent, so this changes nothing today — but an empty debt list
  // makes every other field on the result silently rosy, and reaching for
  // `totalOwed` here later would have looked completely reasonable. Same shape
  // as the bug in M46.
  const debts = useLiveJSON('debts', []);
  // 「现在能花」 rather than raw cash. `ownCash` is every ringgit in your own
  // accounts, which flatters you by exactly the amount of rent and instalments
  // that have not left yet — on the one screen whose job is a quick honest
  // glance, that is the wrong direction to be wrong in. See computeSpendable.
  const allocations = useLiveJSON('allocations', []);
  // `useToday()`, not `useMemo(..., [])`: both this and the day strip below were
  // frozen at mount, so an app left open overnight kept calling yesterday
  // "今天" — the strip showed yesterday's seven days, and `selectedDay ===
  // todayStr` went false, which made the recap read TODAY's live meals/sets/
  // spend under YESTERDAY's date heading. Declared once, up here, because the
  // cycle needs it too.
  const todayStr = useToday();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cycle = useMemo(() => getCycle(), [todayStr]);
  const spendable = useMemo(
    () => computeSpendable({ accounts, allocations, debts, expenses: allExpenses, cycle }),
    [accounts, allocations, debts, allExpenses, cycle]);
  const spendableAccounts = accounts.filter(a => !a.archived && a.kind !== 'custodial');
  // `sumBy`, not a bare `+ item.calories` — one record with a missing number
  // used to turn the whole figure into "NaN" on screen. See utils/num.js.
  const totalCalories = sumBy(meals, m => m.calories);
  const isOverCalorie = totalCalories > calorieLimit;

  // Arrivals excluded as well as transfers — see isSpendingRecord. This card
  // used to read "今天花了 RM -1,187.50" on the day an allowance landed.
  const totalExpense = sumBy(expenses.filter(isDailySpend), e => e.amount);
  const isOverExpense = totalExpense > dailyBudget;

  // Counts a one-tap whole-session record as the sets it planned, and
  // cardio as none — `workouts.length` did neither. See workoutPlan.js.
  const totalSets = countSets(workouts);

  // --- today's energy, in one place ----------------------------------------
  //
  // 饮食 and 健身 were two screens that clearly had something to do with each
  // other and never said what. The gym raises the calorie target; the target is
  // what the diet screen measures against; neither screen showed the other half,
  // and the overview showed only "1450 / 2100 kcal" — a target with no
  // explanation of where 2100 came from.
  //
  // This is the sentence that was missing: ate X, burned Y (resting + training),
  // net Z. It's the same calcEnergyBalance the diet screen uses, so the two can
  // never disagree.
  const bodyWeightKg = usePersistentState('bodyWeightKg', null)[0];
  const heightCm = usePersistentState('heightCm', null)[0];
  const ageYears = usePersistentState('ageYears', null)[0];
  const sex = usePersistentState('sex', null)[0];
  const activityLevel = usePersistentState('activityLevel', DEFAULT_ACTIVITY)[0];

  const bmr = useMemo(
    () => calcBMR({ weightKg: bodyWeightKg, heightCm, age: ageYears, sex }),
    [bodyWeightKg, heightCm, ageYears, sex]
  );
  const workoutCalories = sumBy(workouts, w => w.calories);
  const energy = useMemo(
    () => calcEnergyBalance({ bmr, activityLevel, intake: totalCalories, workoutCalories }),
    [bmr, activityLevel, totalCalories, workoutCalories]
  );
  // The FULL day's figure is right for `energy` (a daily budget), and wrong for
  // "how much have I burned so far" — see restingBurnSoFar. Both are shown,
  // labelled as what they are.
  const nowTick = useNowMinute();
  const burnedSoFar = useMemo(() => {
    const resting = restingBurnSoFar(bmr, nowTick);
    if (resting == null) return null;
    const factor = (ACTIVITY_LEVELS[activityLevel] ?? ACTIVITY_LEVELS[DEFAULT_ACTIVITY]).factor;
    return Math.round(resting * factor) + workoutCalories;
  }, [bmr, activityLevel, workoutCalories, nowTick]);

  const todayStats = useMemo(() => ({
    totalCalories, calorieLimit,
    mealsLogged: meals.length,
    totalSets,
    totalExpense, dailyBudget,
  }), [totalCalories, calorieLimit, meals.length, totalSets, totalExpense, dailyBudget]);

  const totalXp = useMemo(() => {
    const historyXp = history.reduce((sum, day) => sum + computeDayXP(day), 0);
    // archivedXp holds the XP of days that have aged out of the 30-day history
    // window. Without it, Level went backwards as old days were dropped.
    return archivedXp + historyXp + computeDayXP(todayStats);
  }, [history, todayStats, archivedXp]);

  const { level, xpIntoLevel, xpForNextLevel } = computeLevel(totalXp);

  // --- 本周 ----------------------------------------------------------------
  //
  // The overview could answer "what happened today" six ways and "how is the
  // week going" not at all — which is the wrong way round for eating, training
  // and weight, where a single day is noise and a week is the shortest span
  // that means anything.
  //
  // Read here rather than passed down: these four are settings the dashboard
  // has no other use for, and threading them through App.jsx as props would
  // put them on a component that never reads them.
  const weightLog = useLiveJSON('weightLog', []);
  const macroTargets = useLiveJSON('macroTargets', null);
  const dietGoal = useLiveJSON('dietGoal', null);
  const weightUnit = useLiveJSON('weightUnit', 'kg');

  // `todayStr`, not `new Date()` frozen at mount — this app is left running for
  // days on a phone, and a week window pinned at mount would keep reporting a
  // week that ended on Sunday. Same reason the day strip above uses useToday().
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const thisWeek = useMemo(() => getWeek(), [todayStr]);
  const weekCmp = useMemo(() => computeWeekComparison({
    meals: allMeals, workouts: allWorkouts, expenses: allExpenses, weightLog,
    week: thisWeek, todayStr,
  }), [allMeals, allWorkouts, allExpenses, weightLog, thisWeek, todayStr]);
  // Only the single most important line goes on the dashboard. The rest live
  // one tap away — this card exists to be glanced at, not read.
  const weekLead = useMemo(
    () => pickWeekHighlights(weekCmp, { macroTargets, dietGoal, max: 1 })[0] ?? null,
    [weekCmp, macroTargets, dietGoal]);
  const weekHasData = hasData(weekCmp.current);

  const [userName, setUserName] = usePersistentState('userName', '');
  const [editingName, setEditingName] = useState(false);

  // The signed-in Google account is a real, recognised identity — it should
  // be the greeting's fallback, not just the manually typed userName. Never
  // written into `userName` itself: a deliberate manual name (or a
  // deliberately blank one) always wins, this only fills the gap.
  const [sync, setSync] = useState(getState);
  useEffect(() => subscribe(setSync), []);
  const displayName = userName || sync.user?.name || '';

  const [lastSeenLevel, setLastSeenLevel] = usePersistentState('lastSeenLevel', 1);
  useEffect(() => {
    if (level > lastSeenLevel) {
      confetti({ particleCount: 60, spread: 70 });
      setLastSeenLevel(level);
    }
  }, [level, lastSeenLevel, setLastSeenLevel]);

  // 7-day interactive day picker state & data logic.
  //
  const [selectedDay, setSelectedDay] = useState(todayStr);

  // Follow the rollover. Someone deliberately looking at an older day stays
  // there; only a view that was pinned to "today" moves with it.
  const prevTodayRef = React.useRef(todayStr);
  useEffect(() => {
    if (prevTodayRef.current === todayStr) return;
    setSelectedDay(prev => (prev === prevTodayRef.current ? todayStr : prev));
    prevTodayRef.current = todayStr;
  }, [todayStr]);

  // Counted back from `todayStr` rather than from a second, independent
  // `new Date()`. Two clock reads in one component can straddle midnight and
  // disagree — and this way the dependency is genuinely an input, so the strip
  // provably follows the rollover instead of relying on a dependency the
  // linter would be right to call unused.
  const past7Days = useMemo(() => {
    const [y, m, d] = todayStr.split('-').map(Number);
    const dates = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(y, m - 1, d);
      day.setDate(day.getDate() - i);
      dates.push(getTodayString(day));
    }
    return dates;
  }, [todayStr]);

  const dayMeals = useMemo(() => {
    if (selectedDay === todayStr) return meals;
    return allMeals.filter(m => m.date === selectedDay);
  }, [selectedDay, todayStr, meals, allMeals]);

  const dayWorkouts = useMemo(() => {
    if (selectedDay === todayStr) return workouts;
    return allWorkouts.filter(w => w.date === selectedDay);
  }, [selectedDay, todayStr, workouts, allWorkouts]);

  // The recap answers "what did I spend", so it shows spending only —
  // `isSpendingRecord` drops both transfers between your own accounts (RM100
  // moving from Maybank to TNG is not an answer to that question) and arrivals
  // (an allowance landing is money IN; listing it under 消费 and adding it to a
  // total headed 共 RM… made the total negative).
  const dayExpenses = useMemo(() => {
    const source = selectedDay === todayStr ? expenses : allExpenses.filter(e => e.date === selectedDay);
    return source.filter(isDailySpend);
  }, [selectedDay, todayStr, expenses, allExpenses]);

  const dayTotalCal = useMemo(() => sumBy(dayMeals, m => m.calories), [dayMeals]);
  const dayTotalExp = useMemo(() => sumBy(dayExpenses, e => e.amount), [dayExpenses]);

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>

      {/* Welcome Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          {editingName ? (
            <input
              autoFocus
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              onBlur={() => setEditingName(false)}
              onKeyDown={(e) => e.key === 'Enter' && setEditingName(false)}
              placeholder={sync.user?.name || 'Your name'}
              style={{
                fontSize: '1.1rem', fontWeight: '700',
                background: 'var(--bg-input)', border: '1px solid var(--accent)',
                color: 'white', borderRadius: 'var(--radius-sm)', padding: '2px 8px', width: '170px'
              }}
            />
          ) : (
            <h2
              onClick={() => setEditingName(true)}
              title="Tap to change your name"
              style={{ fontSize: '1.12rem', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {displayName ? `Hello, ${displayName}` : 'Hello there'}
              {sync.user && (
                sync.user.photoURL ? (
                  <img
                    src={sync.user.photoURL} alt="" referrerPolicy="no-referrer" title={`已登入 · ${sync.user.email}`}
                    style={{ width: '22px', height: '22px', borderRadius: '50%', border: '1px solid var(--border-strong)' }}
                  />
                ) : (
                  <span
                    title={`已登入 · ${sync.user.email}`}
                    style={{
                      width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
                      background: 'var(--color-money-soft)', color: 'var(--color-money)',
                      border: '1px solid var(--color-money)', fontSize: '0.66rem', fontWeight: '800',
                      fontFamily: 'var(--font-pixel-retro)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {(sync.user.name || sync.user.email || '?').charAt(0).toUpperCase()}
                  </span>
                )
              )}
            </h2>
          )}
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            {displayName ? 'Life Management Overview Today' : 'Tap the greeting to set your name'}
          </p>
        </div>
        <div style={{
          background: 'rgba(255, 107, 74, 0.12)',
          border: '1px solid rgba(255, 107, 74, 0.35)',
          color: 'var(--accent)',
          padding: '4px 10px',
          borderRadius: 'var(--radius-sm)',
          fontFamily: 'var(--font-pixel-retro)',
          fontSize: '0.65rem',
          textAlign: 'center',
          boxShadow: '0 2px 8px rgba(255, 107, 74, 0.15)'
        }}>
          LV.{level}
          <div style={{ fontSize: '0.55rem', fontWeight: '400', color: 'var(--text-muted)', marginTop: '2px' }}>
            {xpIntoLevel}/{xpForNextLevel} XP
          </div>
        </div>
      </div>

      {/* AI Daily Insight Card */}
      <div className="glass-card glass-card-glow">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
          <Sparkles size={16} color="var(--accent)" />
          <h3 style={{ fontSize: '0.88rem', fontWeight: '700', color: 'var(--accent)' }}>AI Life Assistant Summary</h3>
        </div>

        <p style={{ fontSize: '0.82rem', lineHeight: '1.45', color: 'var(--text-primary)' }}>
          {isOverCalorie ? (
            <span style={{ color: 'var(--color-accent-red)' }}>You exceeded your calorie limit by {totalCalories - calorieLimit} kcal. Recommend a light dinner or cardio workout.</span>
          ) : (
            <span>You have <strong>{calorieLimit - totalCalories} kcal</strong> remaining for today.</span>
          )}
          {" "}
          {totalSets === 0 ? "No gym sets logged yet today." : `Logged ${totalSets} gym sets!`}
          {" "}
          今天花了 <strong>RM {totalExpense.toFixed(2)}</strong>，扣掉这个周期还要付的，现在能花 <strong>RM {spendable.spendable.toFixed(2)}</strong>。
        </p>

        <button
          onClick={onOpenAi}
          className="btn-primary"
          style={{ width: '100%', marginTop: '10px', padding: '6px', fontSize: '0.78rem' }}
        >
          <Sparkles size={15} /> Ask AI Life Coach
        </button>
      </div>

      {/* Reminders and special days that are close. High up because it is
          time-sensitive and nothing else on this screen is — but three rows
          only, and it renders nothing at all when there is nothing coming.
          See UpNextCard.jsx. */}
      <UpNextCard />

      {/* 本周 — the week in one glance, above the day strip on purpose: the
          higher-altitude question reads first, and the day detail is already
          right below it for anyone who wants it. Rendered only once there is
          something in the week; an empty card teaching nothing is worse than
          no card, and this screen is already dense. */}
      {weekHasData && (
        <div
          className="glass-card"
          onClick={() => setShowWeek(true)}
          style={{ padding: '0.8rem 0.9rem', marginBottom: '0.75rem', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <h3 style={{ fontSize: '0.88rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Sparkles size={14} color="var(--accent)" /> 本周
            </h3>
            <span style={{ fontSize: '0.68rem', color: 'var(--accent)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '3px' }}>
              本周回顾 <ArrowRight size={12} />
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
            {[
              {
                label: '训练',
                value: weekCmp.current.training.daysTrained,
                unit: '天',
                color: 'var(--color-sports)',
              },
              {
                label: '蛋白',
                // "—" and "0" are different statements: one is "nothing logged",
                // the other is "you ate no protein". Only one of them is ever true.
                value: weekCmp.current.nutrition.avgProtein ?? '—',
                unit: weekCmp.current.nutrition.avgProtein != null ? 'g/天' : '',
                color: 'var(--color-diet)',
              },
              {
                label: '花费',
                value: `RM ${num(weekCmp.current.money.totalSpend).toFixed(0)}`,
                unit: '',
                color: 'var(--color-money)',
              },
            ].map(stat => (
              <div
                key={stat.label}
                style={{
                  background: 'rgba(0, 0, 0, 0.25)', border: '1px solid var(--border-glass)',
                  borderRadius: 'var(--radius-sm)', padding: '0.45rem 0.5rem', minWidth: 0,
                }}
              >
                <div style={{ fontSize: '0.63rem', color: stat.color, fontWeight: '700', marginBottom: '2px' }}>
                  {stat.label}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px' }}>
                  <span style={{ fontSize: '0.95rem', fontWeight: '800' }}>{stat.value}</span>
                  {stat.unit && <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{stat.unit}</span>}
                </div>
              </div>
            ))}
          </div>

          {weekLead && (
            <p style={{
              fontSize: '0.7rem', lineHeight: 1.45, marginTop: '0.55rem',
              color: weekLead.kind === 'good' ? 'var(--color-accent-green)'
                : weekLead.kind === 'warn' ? 'var(--color-accent-amber)' : 'var(--text-secondary)',
            }}>
              {weekLead.text}
            </p>
          )}
        </div>
      )}

      {/* 7-Day Interactive Day Selector & Today's Activity Recap */}
      <div className="glass-card" style={{ padding: '0.85rem 0.95rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CalendarDays size={15} color="var(--accent)" /> 过去 7 天记录按查
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {selectedDay !== todayStr && (
              <button
                onClick={() => setSelectedDay(todayStr)}
                style={{
                  background: 'var(--accent-soft)', border: '1px solid var(--accent)',
                  color: 'var(--accent)', fontSize: '0.66rem', padding: '2px 7px',
                  cursor: 'pointer', borderRadius: 'var(--radius-sm)', fontWeight: '600'
                }}
              >
                切回今天
              </button>
            )}
            <button
              onClick={() => setShowHistory(true)}
              className="btn-secondary"
              style={{ padding: '4px 8px', fontSize: '0.68rem', flexShrink: 0, gap: '4px' }}
            >
              <HistoryIcon size={12} /> 历史
            </button>
          </div>
        </div>

        {/* 7 Day Pills */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
          {past7Days.map(dateStr => {
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDay;
            // Split, not `new Date("2026-08-20")`. The string form is parsed as
            // UTC midnight while getDate()/getDay() read it back in local time,
            // so west of UTC every pill would be labelled a day early. The rest
            // of the app is careful about this (see getTodayString); this was
            // the one place that wasn't.
            const [dy, dm, dd] = dateStr.split('-').map(Number);
            const dObj = new Date(dy, dm - 1, dd);
            const dayNum = dObj.getDate();
            const monthNum = dObj.getMonth() + 1;
            const weekdayStr = ['日', '一', '二', '三', '四', '五', '六'][dObj.getDay()];
            
            const hasMeals = (isToday ? meals : allMeals.filter(m => m.date === dateStr)).length > 0;
            const hasSports = (isToday ? workouts : allWorkouts.filter(w => w.date === dateStr)).length > 0;
            const hasSpend = (isToday ? expenses : allExpenses.filter(e => e.date === dateStr)).length > 0;
            const hasAny = hasMeals || hasSports || hasSpend;

            return (
              <button
                key={dateStr}
                onClick={() => setSelectedDay(dateStr)}
                style={{
                  background: isSelected 
                    ? 'rgba(255, 107, 74, 0.2)' 
                    : hasAny ? 'rgba(255, 255, 255, 0.05)' : 'var(--bg-input)',
                  color: isSelected 
                    ? '#ff6b4a' 
                    : isToday ? 'var(--accent)' : 'var(--text-primary)',
                  border: isSelected 
                    ? '1px solid rgba(255, 107, 74, 0.5)' 
                    : isToday ? '1px solid var(--accent)' : '1px solid var(--border-glass)',
                  boxShadow: isSelected ? '0 2px 8px rgba(255, 107, 74, 0.25)' : 'none',
                  padding: '6px 2px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '2px',
                  borderRadius: 'var(--radius-sm)',
                  transition: 'all 0.15s ease'
                }}
              >
                <span style={{ fontSize: '0.58rem', opacity: 0.85 }}>周{weekdayStr}</span>
                <span style={{ fontSize: '0.76rem', fontWeight: '800' }}>{monthNum}/{dayNum}</span>
                <div style={{ display: 'flex', gap: '2px', marginTop: '1px' }}>
                  {hasMeals && <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--color-diet)' }} />}
                  {hasSports && <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--color-sports)' }} />}
                  {hasSpend && <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--color-money)' }} />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Date Activity Recap Container */}
        <div style={{
          marginTop: '0.8rem',
          padding: '0.75rem 0.85rem',
          background: 'rgba(0, 0, 0, 0.25)',
          border: '1px solid var(--border-glass)',
          borderRadius: 'var(--radius-sm)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.55rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--text-primary)' }}>
              {selectedDay === todayStr ? '📌 今天做了什么 (Today Recap)' : `📅 ${selectedDay} 活动记录`}
            </span>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
              {dayMeals.length}餐 · {dayWorkouts.length}组 · RM {dayTotalExp.toFixed(2)}
            </span>
          </div>

          {/* Section 1: Meals */}
          <div style={{ marginBottom: '0.55rem' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-diet)', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
              <Flame size={12} /> 饮食 ({dayMeals.length} 项 · 共 {dayTotalCal} kcal)
            </div>
            {dayMeals.length === 0 ? (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', paddingLeft: '14px' }}>未记录饮食</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', paddingLeft: '14px' }}>
                {dayMeals.map(m => (
                  <div key={m.id || m.time} style={{ fontSize: '0.72rem', color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>• {m.name} <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>({m.category || '餐点'})</span></span>
                    <span style={{ fontWeight: '600', color: 'var(--color-diet)' }}>{num(m.calories)} kcal</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: Sports */}
          <div style={{ marginBottom: '0.55rem' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-sports)', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
              <Dumbbell size={12} /> 运动 ({dayWorkouts.length} 组)
            </div>
            {dayWorkouts.length === 0 ? (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', paddingLeft: '14px' }}>未记录健身</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', paddingLeft: '14px' }}>
                {dayWorkouts.map(w => (
                  <div key={w.id || w.time} style={{ fontSize: '0.72rem', color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>• {w.exercise} <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>({w.routineName})</span></span>
                    <span style={{ fontWeight: '600', color: 'var(--color-sports)' }}>{w.weightKg}kg × {w.reps}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 3: Expenses */}
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-money)', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
              <Wallet size={12} /> 消费 ({dayExpenses.length} 笔 · 共 RM {dayTotalExp.toFixed(2)})
            </div>
            {dayExpenses.length === 0 ? (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', paddingLeft: '14px' }}>未记录支出</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', paddingLeft: '14px' }}>
                {dayExpenses.map(e => (
                  <div key={e.id || e.time} style={{ fontSize: '0.72rem', color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ minWidth: 0 }}>
                      • {e.merchant}{' '}
                      <AccountChip accounts={accounts} accountId={e.accountId} size="xs" />{' '}
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>({e.category})</span>
                    </span>
                    {/* Coerced per row as well as in the totals: a record with
                        a missing amount rendered a literal "- RM NaN" line. */}
                    <span style={{ fontWeight: '600', color: num(e.amount) < 0 ? 'var(--color-money)' : 'var(--color-accent-red)' }}>
                      {num(e.amount) < 0 ? '+' : '-'} RM {Math.abs(num(e.amount)).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 今天的能量 — the one card that says how 饮食 and 健身 relate.
          Hidden entirely without a body profile: every number here is derived
          from BMR, and inventing an "average adult" burn would read exactly
          like a real measurement. */}
      {energy && (
        <div className="glass-card" style={{ marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>
              今天的能量 Energy today
            </span>
            <span style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>
              吃进 − 消耗
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '6px' }}>
            <span style={{
              fontSize: '1.6rem', fontWeight: '800',
              color: energy.net > 0 ? 'var(--color-diet)' : 'var(--color-money)',
            }}>
              {energy.net > 0 ? '+' : ''}{energy.net}
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>kcal</span>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {energy.net > 0 ? '盈余 · 会长肉' : energy.net < 0 ? '赤字 · 会掉秤' : '刚好打平'}
            </span>
          </div>

          {/* The three numbers behind it, spelled out — this is the bit that
              was missing: the gym session is IN the burn, and that is exactly
              why training raises what you can eat. */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px',
            marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-glass)',
          }}>
            <div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>吃进</div>
              <div style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--color-diet)' }}>
                {totalCalories}
              </div>
              <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)' }}>{meals.length} 餐</div>
            </div>
            <div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>整天消耗</div>
              <div style={{ fontSize: '0.9rem', fontWeight: '700' }}>{energy.burn}</div>
              <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)' }}>
                静息 + 日常
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>训练烧掉</div>
              <div style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--color-sports)' }}>
                {workoutCalories > 0 ? `+${workoutCalories}` : '0'}
              </div>
              <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)' }}>
                {totalSets > 0 ? `${totalSets} 组` : '还没练'}
              </div>
            </div>
          </div>

          {/* "So far" vs "whole day" stated separately, because conflating them
              is the bug this whole pass exists to fix: at 9am a full day's
              resting burn has NOT happened yet. */}
          {burnedSoFar != null && (
            <p style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginTop: '9px', lineHeight: 1.5 }}>
              到现在为止实际烧了 ~{burnedSoFar} kcal（上面的「整天消耗」是这一整天的预算）。
              {workoutCalories > 0 && ' 今天练了，所以今天能吃的也多了这么多。'}
            </p>
          )}
        </div>
      )}

      {/* 3 Core Module Highlights Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem' }}>

        {/* Diet Card */}
        <div
          className="glass-card"
          onClick={() => navigate('/diet')}
          style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(245, 165, 36, 0.3)',
              background: 'var(--color-diet-soft)', color: 'var(--color-diet)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Flame size={18} />
            </div>
            <div>
              <h4 style={{ fontSize: '0.88rem', fontWeight: '700' }}>饮食 Diet</h4>
              <p style={{ fontSize: '0.72rem', color: isOverCalorie ? 'var(--color-accent-red)' : 'var(--text-secondary)' }}>
                {totalCalories} / {calorieLimit} kcal · {meals.length} 餐
                {workoutCalories > 0 && <span style={{ color: 'var(--color-sports)' }}> · 含今天训练 +{workoutCalories}</span>}
              </p>
            </div>
          </div>
          <ArrowRight size={16} color="var(--text-muted)" />
        </div>

        {/* Sports Card */}
        <div
          className="glass-card"
          onClick={() => navigate('/sports')}
          style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(139, 124, 246, 0.3)',
              background: 'var(--color-sports-soft)', color: 'var(--color-sports)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Dumbbell size={18} />
            </div>
            <div>
              <h4 style={{ fontSize: '0.88rem', fontWeight: '700' }}>健身 Sports</h4>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                今天 {totalSets} 组
                {workoutCalories > 0 ? ` · 烧了 ~${workoutCalories} kcal` : ' · 还没开始'}
              </p>
            </div>
          </div>
          <ArrowRight size={16} color="var(--text-muted)" />
        </div>

        {/* Money Card */}
        <div
          className="glass-card"
          onClick={() => navigate('/money')}
          style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(61, 214, 140, 0.3)',
              background: 'var(--color-money-soft)', color: 'var(--color-money)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Wallet size={18} />
            </div>
            <div>
              <h4 style={{ fontSize: '0.88rem', fontWeight: '700' }}>记账 · 户口</h4>
              <p style={{ fontSize: '0.72rem', color: isOverExpense ? 'var(--color-accent-red)' : 'var(--text-secondary)' }}>
                今天 RM {totalExpense.toFixed(2)} / RM {num(dailyBudget).toFixed(2)} · 现在能花 RM {spendable.spendable.toFixed(2)}
              </p>
            </div>
          </div>
          <ArrowRight size={16} color="var(--text-muted)" />
        </div>

      </div>

      {/* Balances, on the landing screen. "How much have I got, and where is
          it" is the first thing an overview should answer for a spending
          firewall, and it was the one thing this screen never said. */}
      {spendableAccounts.length > 0 && (
        <div>
          <h3 style={{ fontSize: '0.88rem', fontWeight: '700', marginBottom: '0.6rem' }}>户口余额</h3>
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '2px' }}>
            {spendableAccounts.map(a => {
              const c = typeMeta(a.type).color;
              return (
                <div
                  key={a.id}
                  onClick={() => navigate('/money/accounts')}
                  className="tap-zone"
                  style={{
                    flexShrink: 0, minWidth: '118px', padding: '0.6rem 0.75rem', cursor: 'pointer',
                    borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)',
                    border: '1px solid var(--border-glass)', borderLeft: `3px solid ${c}`,
                  }}
                >
                  <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.name}
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: '800', marginTop: '1px', color: a.balance < 0 ? 'var(--color-accent-red)' : c }}>
                    RM {num(a.balance).toFixed(2)}
                  </div>
                  {a.countsToNetWorth === false && (
                    <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginTop: '1px' }}>只记录 · 不算储蓄</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Action Shortcuts */}
      <div>
        <h3 style={{ fontSize: '0.88rem', fontWeight: '700', marginBottom: '0.6rem' }}>Quick Actions</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>

          <button
            onClick={() => navigate('/diet')}
            className="glass-card"
            style={{
              padding: '10px 6px',
              color: 'white',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              fontSize: '0.72rem'
            }}
          >
            <Camera size={18} color="var(--color-diet)" />
            <span>Scan Meal</span>
          </button>

          <button
            onClick={() => { onStartRestTimer(60); navigate('/sports'); }}
            className="glass-card"
            style={{
              padding: '10px 6px',
              color: 'white',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              fontSize: '0.72rem'
            }}
          >
            <Timer size={18} color="var(--color-sports)" />
            <span>Gym Timer</span>
          </button>

          <button
            onClick={() => navigate('/money')}
            className="glass-card"
            style={{
              padding: '10px 6px',
              color: 'white',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              fontSize: '0.72rem'
            }}
          >
            <BellRing size={18} color="var(--color-money)" />
            <span>Spending</span>
          </button>

        </div>
      </div>

      {showWeek && (
        <WeekReview
          onClose={() => setShowWeek(false)}
          allMeals={allMeals}
          allWorkouts={allWorkouts}
          allExpenses={allExpenses}
          weightLog={weightLog}
          macroTargets={macroTargets}
          dietGoal={dietGoal}
          weightUnit={weightUnit}
          todayStr={todayStr}
        />
      )}

      {showHistory && (
        <HistoryModal
          onClose={() => setShowHistory(false)}
          history={history}
          allMeals={allMeals}
          allWorkouts={allWorkouts}
          allExpenses={allExpenses}
          todayStats={todayStats}
          today={getTodayString()}
        />
      )}

    </div>
  );
}
