import React, { useMemo, useState } from 'react';
import {
  X, ChevronLeft, Flame, Dumbbell, Wallet, Sparkles,
  Utensils, Trophy,
} from '../utils/icons';
import { computeDayXP } from '../utils/gamification';
import { num } from '../utils/num';
import { getProjects } from '../utils/projects';

// `num` first: a history day written by an older build (or a legacy row with
// fields simply absent) rendered "RM NaN" here. Same reason as everywhere
// else — see utils/num.js.
const money = (n) => `RM ${num(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Browse every day that's ever been logged.
 *
 * The records have carried a `date` since the schema-v2 migration, and the
 * midnight rollover no longer deletes them (see SCHEMA.md) — but until this
 * component existed there was nowhere in the UI to actually look at a day
 * older than the 7-day trend chart shows. This is that missing screen.
 *
 * Two steps in one modal: a day list, then that day's detail. A single flow
 * is simpler to reason about than N independent accordions.
 */
export default function HistoryModal({ onClose, history, allMeals, allWorkouts, allExpenses, todayStats, today }) {
  const [selected, setSelected] = useState(null);

  const days = useMemo(() => {
    const map = new Map(history.map(d => [d.date, d]));
    // Today isn't in `history` yet — it's only archived at the next rollover —
    // so it's included here if there's anything worth showing.
    //
    // Checked by RECORD COUNT, not by whether todayStats.totalExpense is
    // non-zero: a day where you fronted RM90 and got fully reimbursed nets to
    // exactly RM0, which would make a day with four real transactions look
    // like an empty one and vanish from this list entirely.
    const hasToday = todayStats.mealsLogged > 0 || todayStats.totalSets > 0
      || allExpenses.some(e => e.date === today);
    if (hasToday) map.set(today, { date: today, ...todayStats });
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [history, todayStats, today, allExpenses]);

  // Projects need the FULL expense list — a project fronted on the selected
  // day may have been repaid on a later one, and repayment progress should
  // reflect that even when looking back at the original day.
  const projects = useMemo(() => getProjects(allExpenses), [allExpenses]);
  const projectsById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);

  const detail = useMemo(() => {
    if (!selected) return null;
    return {
      meals: allMeals.filter(m => m.date === selected),
      workouts: allWorkouts.filter(w => w.date === selected),
      expenses: allExpenses.filter(e => e.date === selected),
    };
  }, [selected, allMeals, allWorkouts, allExpenses]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ height: '82vh', display: 'flex', flexDirection: 'column' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexShrink: 0 }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {selected ? (
              <>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', padding: 0 }}>
                  <ChevronLeft size={20} />
                </button>
                {selected}
              </>
            ) : '历史记录 History'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {selected ? (
            <DayDetail date={selected} detail={detail} projectsById={projectsById} />
          ) : (
            <DayList days={days} onSelect={setSelected} today={today} />
          )}
        </div>
      </div>
    </div>
  );
}

function DayList({ days, onSelect, today }) {
  if (days.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
        <p style={{ fontSize: '0.85rem' }}>还没有任何一天的记录。</p>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '6px' }}>
          记完东西之后回来看，每一天都会留在这里。
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {days.map(d => {
        const xp = computeDayXP(d);
        return (
          <div
            key={d.date}
            className="glass-card"
            onClick={() => onSelect(d.date)}
            style={{ padding: '0.8rem 1rem', cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: '700' }}>{d.date}</span>
                {d.date === today && (
                  <span style={{ fontSize: '0.6rem', fontWeight: '800', color: 'var(--accent)', background: 'var(--accent-soft)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>
                    今天
                  </span>
                )}
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--color-diet)', display: 'flex', alignItems: 'center', gap: '3px', fontWeight: '700' }}>
                <Trophy size={11} /> {xp} XP
              </span>
            </div>
            <div style={{ display: 'flex', gap: '14px', marginTop: '6px', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              <span>{num(d.totalCalories)} kcal</span>
              <span>{num(d.totalSets)} 组</span>
              <span>{money(d.totalExpense)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayDetail({ detail, projectsById }) {
  if (!detail) return null;
  const { meals, workouts, expenses } = detail;
  const empty = meals.length === 0 && workouts.length === 0 && expenses.length === 0;

  if (empty) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
        这天只有总结数字，没有留下逐笔记录。
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      {meals.length > 0 && (
        <DetailSection icon={<Flame size={15} color="var(--color-diet)" />} title="饮食">
          {meals.map(m => (
            <DetailRow key={m.id}
              icon={m.aiDetected ? <Sparkles size={14} /> : <Utensils size={14} />}
              title={m.name}
              subtitle={`${m.category} · ${m.time}`}
              value={`${num(m.calories)} kcal`}
              valueColor="var(--color-diet)"
            />
          ))}
        </DetailSection>
      )}

      {workouts.length > 0 && (
        <DetailSection icon={<Dumbbell size={15} color="var(--color-sports)" />} title="运动">
          {workouts.map(w => (
            <DetailRow key={w.id}
              icon={<Dumbbell size={14} />}
              title={w.exercise}
              subtitle={`${w.routineName} · ${w.time}`}
              value={`${num(w.weightKg)}kg × ${num(w.reps)}`}
              valueColor="var(--color-sports)"
            />
          ))}
        </DetailSection>
      )}

      {expenses.length > 0 && (
        <DetailSection icon={<Wallet size={15} color="var(--color-money)" />} title="开销">
          {expenses.map(e => {
            // A project's repayment progress reflects ALL time, not just this
            // day — a dinner fronted here may still be getting repaid weeks
            // later, and looking back at this day should show where it
            // actually stands today, not a snapshot frozen on this date.
            const project = e.isProject ? projectsById?.get(e.id) : null;
            const repaidProject = e.repaysExpenseId != null ? projectsById?.get(e.repaysExpenseId) : null;
            return (
              <div key={e.id}>
                <DetailRow
                  icon={<Wallet size={14} />}
                  title={e.merchant}
                  subtitle={[
                    num(e.amount) < 0 ? '退款' : null,
                    repaidProject ? `还「${repaidProject.merchant}」的钱` : null,
                    e.category, e.note, e.time,
                  ].filter(Boolean).join(' · ')}
                  value={`${num(e.amount) < 0 ? '+' : '−'} ${money(Math.abs(num(e.amount)))}`}
                  valueColor={num(e.amount) < 0 ? 'var(--color-money)' : 'var(--color-accent-red)'}
                />
                {project && (
                  <p style={{ fontSize: '0.66rem', color: project.isSettled ? 'var(--color-money)' : 'var(--color-diet)', marginTop: '3px', paddingLeft: '4px' }}>
                    {project.isSettled
                      ? `已结清 · 收回 RM ${num(project.repaidAmount).toFixed(2)}`
                      : `已还 RM ${num(project.repaidAmount).toFixed(2)} / RM ${num(project.amount).toFixed(2)}`}
                  </p>
                )}
              </div>
            );
          })}
        </DetailSection>
      )}
    </div>
  );
}

function DetailSection({ icon, title, children }) {
  return (
    <div>
      <h4 style={{ fontSize: '0.85rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '7px' }}>
        {icon} {title}
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>{children}</div>
    </div>
  );
}

function DetailRow({ icon, title, subtitle, value, valueColor }) {
  return (
    <div className="glass-card" style={{ padding: '0.65rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
        <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{icon}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          {subtitle && <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{subtitle}</div>}
        </div>
      </div>
      <span style={{ fontSize: '0.85rem', fontWeight: '700', color: valueColor, flexShrink: 0 }}>{value}</span>
    </div>
  );
}
