import React, { useMemo } from 'react';
import { Dumbbell, Trophy, ArrowUpFromLine, ArrowDownToLine, Check, Info } from '../utils/icons';
import { formatWeight } from '../utils/units';
import {
  blockHistory, trackedExercises, loggingMix,
} from '../utils/workoutProgress';

/**
 * 训练进度 — /sports/progress
 *
 * TWO TIERS, AND THE FIRST ONE IS THE IMPORTANT ONE
 * The obvious design for "am I getting stronger" is a list of exercises with
 * weight charts. For this user that design is mostly blank: he trains a real
 * 4-day split and logs most days in ONE TAP (`type: 'session'` — no exercise,
 * no weight, no reps), because the phone is in the locker while he trains.
 *
 * So the screen leads with 轮换 — which 板块 got done, how often, how long ago —
 * which reads a one-tap record and a set-by-set day identically. That is also
 * the more useful question: whether the split is being followed matters more
 * than whether bench went up 2.5kg, and skipping leg day for three weeks is
 * exactly the thing a per-exercise view cannot show you.
 *
 * Per-exercise progression comes second, and when it is thin it SAYS WHY —
 * "6 of 8 sessions were logged in one tap" is an explanation, an empty list is
 * a bug report.
 */

const VERDICT = {
  up: { icon: ArrowUpFromLine, color: 'var(--color-accent-green)', label: '变重了' },
  reps: { icon: ArrowUpFromLine, color: 'var(--color-accent-green)', label: '次数多了' },
  // Same weight, fewer reps. Amber like 'down', because it IS a step back —
  // treating it as 持平 would be the mirror error of missing the 'reps' case.
  repsDown: { icon: ArrowDownToLine, color: 'var(--color-accent-amber)', label: '次数少了' },
  same: { icon: Check, color: 'var(--text-muted)', label: '持平' },
  down: { icon: ArrowDownToLine, color: 'var(--color-accent-amber)', label: '轻了' },
};

/** Bars of the last few sessions' top sets. Deliberately not a charting library. */
function MiniBars({ sessions, color = 'var(--color-sports)' }) {
  const recent = sessions.slice(-6);
  const max = Math.max(1, ...recent.map(s => s.topKg));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '26px', marginTop: '6px' }}>
      {recent.map((s) => (
        <div
          key={s.date}
          title={`${s.date} · ${s.topKg}kg × ${s.repsAtTop}`}
          style={{
            flex: 1,
            // Floored so the lightest session is still a visible bar rather
            // than a gap that reads as "no session".
            height: `${Math.max(12, (s.topKg / max) * 100)}%`,
            background: color,
            opacity: 0.35 + 0.65 * (s.topKg / max),
            borderRadius: '2px',
          }}
        />
      ))}
    </div>
  );
}

export default function WorkoutProgress({ allWorkouts = [], routines = [], weightUnit = 'kg', todayStr }) {
  // A fixed 28-day window: four weeks is two full turns of a 4-day split, so a
  // block that has genuinely been skipped shows up and a block done last
  // Tuesday does not look neglected.
  const now = useMemo(() => {
    const [y, m, d] = todayStr.split('-').map(Number);
    return new Date(y, m - 1, d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayStr]);

  const blocks = useMemo(() => blockHistory(allWorkouts, { days: 28, now }), [allWorkouts, now]);
  const mix = useMemo(() => loggingMix(allWorkouts, { days: 28, now }), [allWorkouts, now]);
  const exercises = useMemo(() => trackedExercises(allWorkouts), [allWorkouts]);

  // Merge in the routines that have NEVER been trained. blockHistory only knows
  // about blocks that appear in the log, and "板块 4 你还没练过" is the single
  // most useful line on this screen — it cannot come from the workout data,
  // because the whole point is that there isn't any.
  const rows = useMemo(() => {
    const byKey = new Map(blocks.map(b => [String(b.key), b]));
    const merged = [...blocks];
    for (const r of routines) {
      const key = String(r.block ?? r.name);
      if (byKey.has(key)) continue;
      merged.push({ key, name: r.name, count: 0, lastDate: null, daysSince: null, dates: [] });
    }
    // Never-trained first, then longest gap. Both are the same question:
    // what am I neglecting?
    return merged.sort((a, b) => {
      if (a.daysSince == null && b.daysSince == null) return 0;
      if (a.daysSince == null) return -1;
      if (b.daysSince == null) return 1;
      return b.daysSince - a.daysSince;
    });
  }, [blocks, routines]);

  const gapLabel = (b) => {
    if (b.daysSince == null) return '还没练过';
    if (b.daysSince === 0) return '今天';
    if (b.daysSince === 1) return '昨天';
    return `${b.daysSince} 天前`;
  };

  const noTraining = rows.every(r => r.count === 0 && r.daysSince == null);

  return (
    <div key="progress" className="section-sweep-transition">
      <div className="section-sweep-line" style={{ background: 'var(--color-sports)', boxShadow: '0 0 8px var(--color-sports)' }} />

      {/* ---- 轮换：the tier that always works ---- */}
      <div className="glass-card" style={{ padding: '0.85rem 1rem', marginBottom: '0.85rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.7rem' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Dumbbell size={15} color="var(--color-sports)" /> 四分化轮换
          </span>
          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>过去 4 周</span>
        </div>

        {noTraining ? (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            还没有训练记录。练完一场后按「我已经练了」一键记录，这里就会开始有东西。
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {rows.map((b) => {
              // Only a genuinely stale block is coloured. Highlighting every row
              // would make the colour mean nothing, and this list exists to make
              // ONE row stand out.
              const stale = b.daysSince == null || b.daysSince >= 10;
              return (
                <div
                  key={b.key}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: `1px solid ${stale ? 'var(--color-accent-amber-soft)' : 'var(--border-glass)'}`,
                    borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.6rem', gap: '8px',
                  }}
                >
                  <span style={{
                    fontSize: '0.76rem', fontWeight: '600', minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {b.name}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {b.count} 次
                    </span>
                    <span style={{
                      fontSize: '0.7rem', fontWeight: '700',
                      color: stale ? 'var(--color-accent-amber)' : 'var(--text-secondary)',
                    }}>
                      {gapLabel(b)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- 动作进展：real strength data, honest about its coverage ---- */}
      <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.7rem' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Trophy size={15} color="var(--color-accent-amber)" /> 动作进展
          </span>
          {exercises.length > 0 && (
            <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>跟上一次比</span>
          )}
        </div>

        {/* The explanation goes ABOVE the list, and only when there is something
            to explain — a one-tap session genuinely cannot carry per-exercise
            weights, and the screen should say so rather than look broken. */}
        {mix.quickDays > 0 && (
          <div style={{
            display: 'flex', gap: '6px', alignItems: 'flex-start',
            background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
            borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.6rem', marginBottom: '0.7rem',
          }}>
            <Info size={13} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: '1px' }} />
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              过去 4 周 {mix.totalDays} 次训练里，有 {mix.quickDays} 次是一键整场记录 —— 那种记录不含每个动作的重量，
              所以下面只看得到{mix.detailedDays > 0 ? ` ${mix.detailedDays} 次逐组记录的` : '逐组记录的'}资料。
            </span>
          </div>
        )}

        {exercises.length === 0 ? (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            还没有同一个动作练满两次的逐组记录，所以还比不出进展。想看这里的话，训练时用「开始训练」逐组记下重量和次数。
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {exercises.map((ex) => {
              const v = ex.verdict ? VERDICT[ex.verdict] : null;
              const Icon = v?.icon;
              return (
                <div
                  key={ex.name}
                  style={{
                    background: 'rgba(0, 0, 0, 0.25)', border: '1px solid var(--border-glass)',
                    borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.7rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                    <span style={{
                      fontSize: '0.78rem', fontWeight: '700', minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {ex.name}
                    </span>
                    <span style={{ fontSize: '0.82rem', fontWeight: '800', flexShrink: 0 }}>
                      {ex.hold
                        ? `${ex.latest.holdSec} 秒`
                        : `${formatWeight(ex.latest.topKg, weightUnit)} × ${ex.latest.repsAtTop}`}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '3px' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                      {ex.sessionCount} 次记录
                      {ex.bestKg > 0 ? ` · 最重 ${formatWeight(ex.bestKg, weightUnit)}` : ''}
                      {ex.latest.volume > 0 ? ` · 这次 ${Math.round(ex.latest.volume).toLocaleString()} kg` : ''}
                    </span>
                    {v && (
                      <span style={{
                        display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0,
                        fontSize: '0.66rem', fontWeight: '700', color: v.color,
                      }}>
                        <Icon size={11} />
                        {ex.verdict === 'reps'
                          ? `+${ex.deltaReps} 次`
                          : ex.verdict === 'repsDown'
                            ? `${ex.deltaReps} 次`
                            : ex.verdict === 'same'
                              ? v.label
                              : `${ex.deltaKg > 0 ? '+' : ''}${ex.deltaKg}kg`}
                      </span>
                    )}
                  </div>

                  {/* Only once there are enough points for a shape to mean
                      something — two bars is not a trend, it is a comparison,
                      and the number above already states it. */}
                  {!ex.hold && ex.sessionCount >= 3 && <MiniBars sessions={ex.sessions} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
