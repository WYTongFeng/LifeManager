import React, { useMemo, useState } from 'react';
import {
  X, ChevronLeft, Flame, Dumbbell, Wallet, Scale, Sparkles, Target,
} from '../utils/icons';
import { num } from '../utils/num';
import { formatWeight } from '../utils/units';
import {
  getWeek, computeWeekComparison, pickWeekHighlights, hasData, comparableDomains,
} from '../utils/weekStats';

/**
 * 本周回顾 — the week as a few sentences and six numbers.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT
 * The app was already good at "what happened today": the overview's day strip,
 * the recap, the daily budget. It had nothing at all for "what happened this
 * week", which is the timescale on which eating, training and weight actually
 * do anything — a single day of either is noise.
 *
 * It is deliberately NOT a second dashboard. Six numbers, one screen, no
 * scrolling on a phone if it can be helped. The temptation with a week's data
 * is to show all of it; the reason not to is that the app already has five
 * screens that show all of it, and none of them answers "how did the week go"
 * in the two seconds someone actually gives it.
 *
 * The sentences at the top come from `pickWeekHighlights` — rule-based, in the
 * app, no model call. See the note in weekStats.js for why that is not a
 * placeholder for AI: the AI Coach gets this same structured summary and does
 * the interpreting, which is the part it is actually good at.
 */

const money = (n) => `RM ${num(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const HIGHLIGHT_COLOR = {
  good: 'var(--color-accent-green)',
  warn: 'var(--color-accent-amber)',
  info: 'var(--text-secondary)',
};

/**
 * One number, with what it is and — where there's an honest one — how it moved.
 *
 * `delta` is only ever passed when the comparison is real (see
 * computeWeekComparison's clamping); this component never derives one itself,
 * so it cannot invent a trend the data doesn't support.
 */
function Stat({
  icon, label, value, unit, sub, color,
  // Always a NUMBER (or null), never a pre-formatted string — the arrow's
  // direction is read off its sign, and a string like "RM 42.00" compares false
  // against 0 in both directions, which silently drops the arrow entirely.
  // Formatting is `formatDelta`'s job, applied after the sign has been used.
  delta = null, deltaGood = null, formatDelta = (n) => Math.abs(n),
}) {
  const arrow = delta == null || delta === 0 ? null : delta > 0 ? '↑' : '↓';
  const deltaColor = deltaGood == null
    ? 'var(--text-muted)'
    : deltaGood ? 'var(--color-accent-green)' : 'var(--color-accent-amber)';

  return (
    <div style={{
      background: 'rgba(0, 0, 0, 0.25)',
      border: '1px solid var(--border-glass)',
      borderRadius: 'var(--radius-sm)',
      padding: '0.6rem 0.7rem',
      minWidth: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px',
        fontSize: '0.68rem', fontWeight: '700', color,
      }}>
        {icon} <span>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '1.15rem', fontWeight: '800', color: 'var(--text-primary)', lineHeight: 1.1 }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{unit}</span>}
      </div>
      {/* Both lines are optional and both stay out of the way when absent —
          an empty sub-line would push every card to a different height. */}
      {sub && (
        <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)', marginTop: '3px' }}>{sub}</div>
      )}
      {arrow && (
        <div style={{ fontSize: '0.65rem', color: deltaColor, marginTop: '2px', fontWeight: '700' }}>
          {arrow} {formatDelta(delta)}
        </div>
      )}
    </div>
  );
}

export default function WeekReview({
  onClose, allMeals = [], allWorkouts = [], allExpenses = [], weightLog = [],
  macroTargets = null, dietGoal = null, weightUnit = 'kg', todayStr,
}) {
  // 0 = this week, -1 = last week, and so on. Forward past 0 is blocked below:
  // a week that hasn't happened has nothing in it, and stepping into it just
  // shows an empty screen that looks like a bug.
  const [offset, setOffset] = useState(0);

  const week = useMemo(() => getWeek(new Date(), offset), [offset]);

  const cmp = useMemo(() => computeWeekComparison({
    meals: allMeals, workouts: allWorkouts, expenses: allExpenses, weightLog,
    week, todayStr,
  }), [allMeals, allWorkouts, allExpenses, weightLog, week, todayStr]);

  const highlights = useMemo(
    () => pickWeekHighlights(cmp, { macroTargets, dietGoal }),
    [cmp, macroTargets, dietGoal]);

  const { current, previous, partial, elapsed } = cmp;
  // Per domain. A previous week with a stray weigh-in in it and nothing else is
  // not something to compare training or spending against — see comparableDomains.
  const can = comparableDomains(previous);
  const anyComparable = can.training || can.money || can.nutrition;
  const empty = !hasData(current);

  // The last DAY of the week, not `week.end` — that boundary is exclusive
  // everywhere in this app, so a header reading "08/10 – 08/17" would name
  // eight days and overlap the following week's header by one.
  const label = useMemo(() => {
    const [y, m, d] = week.start.split('-').map(Number);
    const last = new Date(y, m - 1, d + 6);
    const dd = (n) => String(n).padStart(2, '0');
    return `${dd(m)}/${dd(d)} – ${dd(last.getMonth() + 1)}/${dd(last.getDate())}`;
  }, [week.start]);

  const proteinTarget = num(macroTargets?.protein);
  const spendDelta = can.money ? current.money.totalSpend - previous.money.totalSpend : null;
  const setsDelta = can.training ? current.training.totalSets - previous.training.totalSets : null;
  const daysDelta = can.training ? current.training.daysTrained - previous.training.daysTrained : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexShrink: 0 }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '7px' }}>
            <Sparkles size={16} color="var(--accent)" /> 本周回顾
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {/* Week stepper. Same shape as the money module's cycle stepper, so
            stepping back through time works the same way everywhere. */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
          borderRadius: 'var(--radius-sm)', padding: '5px 8px', marginBottom: '0.85rem', flexShrink: 0,
        }}>
          <button
            onClick={() => setOffset(o => o - 1)}
            style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', padding: '3px' }}
            aria-label="上一周"
          >
            <ChevronLeft size={18} />
          </button>
          <div style={{ textAlign: 'center', minWidth: 0 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: '700' }}>{label}</div>
            <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)' }}>
              {offset === 0
                ? (partial ? `本周 · 已过 ${elapsed} 天` : '本周')
                : offset === -1 ? '上周' : `${-offset} 周前`}
            </div>
          </div>
          <button
            onClick={() => setOffset(o => Math.min(0, o + 1))}
            disabled={offset >= 0}
            style={{
              background: 'none', border: 'none', cursor: offset >= 0 ? 'default' : 'pointer',
              color: offset >= 0 ? 'var(--text-muted)' : 'var(--text-primary)',
              opacity: offset >= 0 ? 0.35 : 1,
              display: 'flex', padding: '3px', transform: 'rotate(180deg)',
            }}
            aria-label="下一周"
          >
            <ChevronLeft size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {empty ? (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              这周还没有任何记录
            </div>
          ) : (
            <>
              {highlights.length > 0 && (
                <div className="glass-card" style={{ padding: '0.7rem 0.8rem', marginBottom: '0.7rem' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: '700', color: 'var(--accent)', marginBottom: '6px' }}>
                    这周值得知道
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {highlights.map((h, i) => (
                      <div key={i} style={{ fontSize: '0.76rem', lineHeight: 1.45, color: HIGHLIGHT_COLOR[h.kind], display: 'flex', gap: '6px' }}>
                        <span style={{ flexShrink: 0 }}>·</span>
                        <span>{h.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px' }}>
                <Stat
                  icon={<Flame size={12} />} label="平均热量" color="var(--color-diet)"
                  value={current.nutrition.avgCalories ?? '—'} unit={current.nutrition.avgCalories ? 'kcal/天' : ''}
                  // The denominator is stated, always. An average over two days
                  // and an average over seven are different claims, and the
                  // number alone cannot tell them apart.
                  sub={current.nutrition.daysLogged
                    ? `${current.nutrition.daysLogged} 天有记录`
                    : '这周没记录饮食'}
                />
                <Stat
                  icon={<Target size={12} />} label="平均蛋白" color="var(--color-diet)"
                  value={current.nutrition.avgProtein ?? '—'} unit={current.nutrition.avgProtein ? 'g/天' : ''}
                  sub={proteinTarget > 0 ? `目标 ${proteinTarget}g` : '未设目标'}
                />
                <Stat
                  icon={<Dumbbell size={12} />} label="训练天数" color="var(--color-sports)"
                  value={current.training.daysTrained} unit="天"
                  sub={current.training.cardioSessions > 0
                    ? `力量 ${current.training.strengthDays} · 有氧 ${current.training.cardioSessions}`
                    : null}
                  delta={daysDelta || null} deltaGood={daysDelta > 0}
                />
                <Stat
                  icon={<Dumbbell size={12} />} label="总组数" color="var(--color-sports)"
                  value={current.training.totalSets} unit="组"
                  sub={current.training.minutes > 0 ? `${current.training.minutes} 分钟` : null}
                  delta={setsDelta || null} deltaGood={setsDelta > 0}
                />
                <Stat
                  icon={<Scale size={12} />} label="体重" color="var(--color-sports)"
                  value={current.body.latestKg != null ? formatWeight(current.body.latestKg, weightUnit) : '—'}
                  sub={current.body.readings > 0
                    ? `${current.body.readings} 次记录`
                    : '这周没量体重'}
                  delta={current.body.changeKg || null}
                  // Judged only against a stated goal — see pickWeekHighlights.
                  deltaGood={dietGoal === 'cut' ? current.body.changeKg < 0
                    : dietGoal === 'bulk' ? current.body.changeKg > 0
                    : null}
                />
                <Stat
                  icon={<Wallet size={12} />} label="花费" color="var(--color-money)"
                  value={money(current.money.totalSpend)}
                  sub={`${current.money.entries} 笔`}
                  delta={spendDelta || null} deltaGood={spendDelta < 0}
                  formatDelta={(n) => money(Math.abs(n))}
                />
              </div>

              {/* Says out loud what the comparisons are against. Without this
                  line, "↓ RM42" on a Wednesday looks like a whole-week saving. */}
              <p style={{ fontSize: '0.63rem', color: 'var(--text-muted)', marginTop: '0.7rem', lineHeight: 1.5 }}>
                {anyComparable
                  ? (partial
                    ? `箭头是跟上周同一时段（前 ${elapsed} 天）比，不是跟上周整周比。`
                    : '箭头是跟上周整周比。')
                  : '上周没有记录，所以这周没有可比的对象。'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
