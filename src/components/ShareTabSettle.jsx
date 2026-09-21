import React from 'react';
import { Check, ArrowRightLeft } from '../utils/icons';
import { saveJSON } from '../utils/storage';
import { num } from '../utils/num';
import { unsettledCycles, settledCycles } from '../utils/shareTabs';

const money = (n) => `RM ${num(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (cycleStart) => `${Number(cycleStart.slice(5, 7))} 月`;

/**
 * 结算 — acknowledging a share tab's cycle once it's actually over.
 *
 * NOTHING here decides whether a net counts — computeCycleBudget (cycle.js)
 * already folds an ended cycle's net into the budget on its own, purely from
 * `cycle.end`. This is a narrower, human question sitting on top of that
 * already-correct arithmetic: "have I actually looked at what last month's
 * tab came to". His own ask, 2026-09-20: "可以有一些手动确认的吗，我比较安心
 * 一点" — so nothing here is silent or automatic. A cycle with real activity
 * that hasn't been acknowledged nags every time this screen opens, however
 * many cycles back that turns out to be; pressing 就这样结 stamps it and the
 * card goes quiet, replaced by a single slim "取消结算" line for the most
 * recent one — settling is a real decision, so undoing it has to stay within
 * reach, not just for the few seconds right after.
 */
export default function ShareTabSettle({ shareTabs, expenses, cycle }) {
  const tabs = (shareTabs ?? []).filter(t => !t.archived);

  const pending = tabs.flatMap(t =>
    unsettledCycles(t, expenses, cycle).map(c => ({ tab: t, cycle: c })));

  // Only the single most recent settle stays reachable for undo — an old one
  // did its job; permanently offering to undo something from months ago is
  // clutter, not safety.
  const recent = tabs
    .map(t => {
      const [latest] = settledCycles(t, expenses, cycle, 1);
      return latest ? { tab: t, cycle: latest } : null;
    })
    .filter(Boolean);

  if (pending.length === 0 && recent.length === 0) return null;

  const settle = (tabId, cycleStart, value) => {
    saveJSON('shareTabs', shareTabs.map(t => {
      if (String(t.id) !== String(tabId)) return t;
      const settledMap = { ...(t.settled ?? {}) };
      if (value) settledMap[cycleStart] = Date.now();
      else delete settledMap[cycleStart];
      return { ...t, settled: settledMap };
    }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {pending.map(({ tab, cycle: c }) => (
        <div key={`${tab.id}:${c.cycleStart}`} className="glass-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <ArrowRightLeft size={15} color="var(--color-money)" />
            <span style={{ fontSize: '0.85rem', fontWeight: '700' }}>
              {tab.label} · {monthLabel(c.cycleStart)}要结了
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
            已出 {money(c.paidOut)} · 已收 {money(c.received)}
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            净额 {c.isIncome ? '+' : '−'}{money(Math.abs(c.net))} → 算成{monthLabel(c.cycleStart)}的
            {c.isIncome ? '收入' : '支出'}
          </div>
          <button
            onClick={() => settle(tab.id, c.cycleStart, true)}
            style={{
              marginTop: '9px', width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)',
              background: 'var(--color-money)', border: 'none', color: 'var(--color-money-ink)',
              fontSize: '0.78rem', fontWeight: '700', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            }}
          >
            <Check size={14} /> 就这样结
          </button>
        </div>
      ))}

      {recent.map(({ tab, cycle: c }) => (
        <div
          key={`${tab.id}:${c.cycleStart}:settled`}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '6px 11px', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-glass)', fontSize: '0.7rem', color: 'var(--text-muted)',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Check size={12} color="var(--color-money)" />
            {tab.label} {monthLabel(c.cycleStart)}已结 · 净额 {c.isIncome ? '+' : '−'}{money(Math.abs(c.net))}
          </span>
          <button
            onClick={() => settle(tab.id, c.cycleStart, false)}
            style={{ background: 'none', border: 'none', color: 'var(--color-money)', fontSize: '0.68rem', fontWeight: '700', cursor: 'pointer', padding: 0 }}
          >
            取消结算
          </button>
        </div>
      ))}
    </div>
  );
}
