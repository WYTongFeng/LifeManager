import React, { useState } from 'react';
import { Plus, Pencil, Trash2, Check } from '../utils/icons';
import { saveJSON, loadJSON } from '../utils/storage';
import { num, newId } from '../utils/num';
import {
  addTabMember, updateTabMember, removeTabMember, membersStatus, expectedForCycle,
  suggestMember, suggestCoverage, intoTab, learnMemberAlias, portionIn, tabRecords, coverageLabel,
} from '../utils/shareTabs';
import { isInCycle } from '../utils/cycle';
import { isTransferRecord } from '../utils/accounts';
import { confirmDelete } from './ConfirmDialog';

const money = (n) => `RM ${num(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
  color: 'white', fontSize: '0.78rem',
};

const STATE_META = {
  paid: { label: '已给', color: 'var(--color-money)' },
  partial: { label: '还差', color: 'var(--color-accent-amber)' },
  unpaid: { label: '还没给', color: 'var(--text-muted)' },
  over: { label: '多了', color: 'var(--color-diet)' },
};

/**
 * Money arriving this month that looks like one of the members' — either
 * already in the tab with nobody named on it, or not in the tab at all.
 *
 * The second kind is how friends' transfers actually arrive when TNG catches
 * them: the review queue files every incoming notification as an unfiled
 * arrival (TngAutoCapture.jsx), and its hint sends him to pick an income
 * source — which would make a friend's rent money spendable income and leave
 * the tab showing RM2,231.85 out and nothing in. So the tab goes looking for
 * them itself, by amount and by learned sender name, and offers them back.
 *
 * Only exact matches (`suggestMember`) are offered from outside the tab — an
 * RM50 dinner refund must never be proposed as someone's rent.
 */
function unmatchedFor(tab, expenses, cycle) {
  const inTab = tabRecords(tab, expenses, cycle)
    .filter(e => portionIn(e, cycle) < 0 && e.shareTabMemberId == null)
    .map(e => ({ record: e, suggestion: suggestMember(tab, { amount: e.amount, merchant: e.merchant }), inTab: true }));
  const loose = expenses
    .filter(e => e.shareTabId == null
      && num(e.amount) < 0
      && !isTransferRecord(e)
      && e.incomeSourceId == null
      && e.repaysExpenseId == null
      && isInCycle(e.date ?? cycle.start, cycle))
    .map(e => ({ record: e, suggestion: suggestMember(tab, { amount: e.amount, merchant: e.merchant }), inTab: false }))
    .filter(x => x.suggestion != null);
  return [...inTab, ...loose];
}

/**
 * What matching each of those records would save — worked out in the order a
 * person would settle them, each one linked in memory before the next is
 * decided.
 *
 * THE ORDER IS THE FIX. Caught in testing with his real month: friend B's
 * RM417.20 for September and his RM1,251.60 for 10–12 月 were both sitting
 * unmatched. Deciding each on its own, September looked unpaid for B, so the
 * RM1,251.60 was offered as 9–11 月 — and 「全部照建议对上」 would have saved it
 * that way. Ordinary one-month payments go first, oldest first, and only then
 * the multi-month ones, so a prepayment is spread from the month after
 * everything that has really been paid.
 *
 * The same plan backs the single 对上 button, so tapping just the RM1,251.60
 * still files it as 10–12 月: that IS the truth once the RM417.20 beside it is
 * matched too, which it plainly is going to be.
 */
function planMatches(tab, unmatched, expenses) {
  const order = unmatched
    .filter(x => x.suggestion != null)
    .sort((a, b) => (a.suggestion.months - b.suggestion.months)
      || String(a.record.date ?? '').localeCompare(String(b.record.date ?? ''))
      || (num(a.record.at) - num(b.record.at)));
  let working = expenses;
  const plan = new Map();
  for (const { record, suggestion } of order) {
    const coverage = suggestCoverage(tab, suggestion.memberId, suggestion.months, record.date, working, record.id);
    const matched = {
      ...intoTab(record, tab.id),
      shareTabMemberId: suggestion.memberId,
      coversFrom: coverage?.coversFrom ?? null,
      coversMonths: coverage?.coversMonths ?? null,
    };
    plan.set(record.id, matched);
    working = working.map(e => (e.id === record.id ? matched : e));
  }
  return plan;
}

/**
 * 每个人每月给多少 — a tab's members, this month's status for each, and the
 * money that has not been matched to anyone yet.
 *
 * The members are what 「月初先预留」 is built on: their total against the
 * tab's bills is his own share, reserved from the 1st (expectedForCycle in
 * shareTabs.js). Stored on the tab like its bills, so there is nothing new to
 * register with sync.
 *
 * Matching goes through `onSaveExpense`, one real save per record — these can
 * be dated any day of the month, and the today-only setter silently no-ops on
 * everything else.
 */
export default function ShareTabMembers({ tab, shareTabs, expenses, cycle, onSaveExpense, onOpenRecord }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [fName, setFName] = useState('');
  const [fAmount, setFAmount] = useState('');

  const status = membersStatus(tab, expenses, cycle);
  const expected = expectedForCycle(tab);
  const unmatched = status.length > 0 ? unmatchedFor(tab, expenses, cycle) : [];
  const plan = planMatches(tab, unmatched, expenses);

  const resetForm = () => { setAdding(false); setEditingId(null); setFName(''); setFAmount(''); };

  const startEdit = (m) => {
    setEditingId(m.id);
    setAdding(false);
    setFName(m.name);
    setFAmount(String(m.amount));
  };

  const save = () => {
    const amount = Number(fAmount);
    if (!fName.trim() || !Number.isFinite(amount) || amount <= 0) return;
    const patch = { name: fName.trim(), amount };
    // Re-read: another screen may have written the tabs since this rendered.
    const live = loadJSON('shareTabs', shareTabs);
    saveJSON('shareTabs', editingId
      ? updateTabMember(live, tab.id, editingId, patch)
      : addTabMember(live, tab.id, { id: newId(), ...patch }));
    resetForm();
  };

  const remove = async (m) => {
    const ok = await confirmDelete({
      title: '把这个人拿掉？',
      subject: { label: m.name, meta: `${tab.label} · 每月`, amount: money(m.amount) },
      body: '他已经给过的钱一笔都不会动，照样算在共摊本里 — 只是以后不再算他该给多少，月初的预留也会跟着变。',
    });
    if (!ok) return;
    saveJSON('shareTabs', removeTabMember(loadJSON('shareTabs', shareTabs), tab.id, m.id));
    if (editingId === m.id) resetForm();
  };

  // File one record under a member exactly as the plan worked it out: into
  // this tab if it wasn't already, the member named, and — for a payment
  // worth several months — spread over the months it is for.
  const match = (recordId) => {
    const matched = plan.get(recordId);
    if (!matched) return;
    onSaveExpense(matched);
    const live = loadJSON('shareTabs', shareTabs);
    const learned = learnMemberAlias(live, tab.id, matched.shareTabMemberId, matched.merchant);
    if (learned !== live) saveJSON('shareTabs', learned);
  };
  // In the plan's own order — one-month payments before the prepayments that
  // depend on them — so what is saved is what the rows said it would be.
  const matchAll = () => [...plan.keys()].forEach(match);

  const showForm = adding || editingId != null;
  const nameOf = (id) => (tab.members ?? []).find(m => String(m.id) === String(id))?.name ?? '?';

  return (
    <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-glass)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-secondary)' }}>每个人每月给</span>
        {!showForm && (
          <button
            onClick={() => { resetForm(); setAdding(true); }}
            style={{ background: 'none', border: 'none', color: 'var(--color-money)', fontSize: '0.68rem', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px', padding: 0 }}
          >
            <Plus size={12} /> 加
          </button>
        )}
      </div>

      {status.length === 0 && !showForm && (
        <p style={{ fontSize: '0.68rem', color: 'var(--color-accent-amber)', lineHeight: 1.5 }}>
          还没设每个人每月给多少，所以这本<strong>还没算进这个月</strong>。
          加进来之后，app 会在月初先预留你自己出的那份（账单 − 他们给的）。
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {status.map(m => {
          const meta = STATE_META[m.state];
          // The one record behind an 'over' month, largest first — most often
          // a prepayment that has not been spread yet.
          const biggest = m.state === 'over'
            ? [...m.records].sort((a, b) => num(a.amount) - num(b.amount))[0]
            : null;
          return (
            <div key={m.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px',
              padding: '6px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-input)',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.76rem', fontWeight: '600' }}>{m.name}</div>
                <div style={{ fontSize: '0.64rem', color: meta.color }}>
                  每月 {money(m.due)} · {meta.label}
                  {m.state === 'partial' && ` ${money(m.short)}`}
                  {m.state === 'over' && ` ${money(m.extra)}`}
                </div>
                {biggest && onOpenRecord && (
                  <button
                    type="button"
                    onClick={() => onOpenRecord(biggest)}
                    style={{ background: 'none', border: 'none', padding: 0, marginTop: '2px', color: 'var(--color-diet)', fontSize: '0.63rem', fontWeight: '700', cursor: 'pointer', textAlign: 'left' }}
                  >
                    是预付吗？点开分到后面几个月 →
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                <button onClick={() => startEdit(m)} aria-label={`编辑 ${m.name}`} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}>
                  <Pencil size={13} />
                </button>
                <button onClick={() => remove(m)} aria-label={`删除 ${m.name}`} style={{ background: 'none', border: 'none', color: 'var(--color-accent-red)', cursor: 'pointer', padding: '2px' }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <div style={{ marginTop: '8px', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input type="text" placeholder="名字，例：阿明" value={fName}
              onChange={e => setFName(e.target.value)} style={inputStyle} autoFocus />
            <input type="number" step="0.01" inputMode="decimal" placeholder="每月 RM" value={fAmount}
              onChange={e => setFAmount(e.target.value)} style={{ ...inputStyle, width: '110px', flexShrink: 0 }} />
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '7px' }}>
            <button onClick={resetForm} className="btn-secondary" style={{ flex: 1, padding: '7px', fontSize: '0.72rem' }}>取消</button>
            <button
              onClick={save}
              disabled={!fName.trim() || !(Number(fAmount) > 0)}
              style={{
                flex: 2, padding: '7px', fontSize: '0.72rem', fontWeight: '700', borderRadius: 'var(--radius-sm)',
                background: (fName.trim() && Number(fAmount) > 0) ? 'var(--color-money)' : 'var(--bg-input)',
                color: (fName.trim() && Number(fAmount) > 0) ? 'var(--color-money-ink)' : 'var(--text-muted)',
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
              }}
            >
              <Check size={13} /> {editingId ? '存' : '加进来'}
            </button>
          </div>
        </div>
      )}

      {/* The arithmetic behind the reserve, spelled out once, so the number in
          固定开销 is never a figure he has to take on trust. */}
      {expected && (
        <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '8px', lineHeight: 1.55 }}>
          他们每月一共给 {money(expected.expectedIn)} · 账单 {money(expected.expectedOut)} →
          <strong style={{ color: expected.expectedNet < 0 ? 'var(--color-accent-red)' : 'var(--color-money)' }}>
            {expected.expectedNet < 0
              ? ` 你自己出 ${money(-expected.expectedNet)}，月初先预留`
              : ` 预计多收 ${money(expected.expectedNet)}，月底才算收入`}
          </strong>
        </p>
      )}

      {unmatched.length > 0 && (
        <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed var(--border-glass)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', marginBottom: '5px' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--color-accent-amber)' }}>
              还没对上是谁给的（{unmatched.length}）
            </span>
            {plan.size >= 2 && (
              <button
                type="button"
                onClick={matchAll}
                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-money)', fontSize: '0.66rem', fontWeight: '700', cursor: 'pointer' }}
              >
                全部照建议对上
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {unmatched.map(item => {
              const { record, suggestion } = item;
              const planned = plan.get(record.id);
              const spreadLabel = planned ? coverageLabel(planned) : null;
              return (
                <div key={record.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px',
                  padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border-glass)',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {record.merchant || '进账'} +{money(Math.abs(num(record.amount)))}
                    </div>
                    <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                      {record.date}{item.inTab ? '' : ' · 还不在共摊本里'}
                      {suggestion && (
                        <> · 看起来是 <strong style={{ color: 'var(--text-secondary)' }}>{nameOf(suggestion.memberId)}</strong>
                          {suggestion.months > 1 ? ` × ${suggestion.months} 个月` : ''}
                          {spreadLabel ? `（算 ${spreadLabel}）` : ''}</>
                      )}
                    </div>
                  </div>
                  {suggestion ? (
                    <button
                      type="button"
                      onClick={() => match(record.id)}
                      style={{
                        padding: '4px 9px', borderRadius: 'var(--radius-sm)', background: 'var(--color-money-soft)',
                        border: '1px solid var(--color-money)', color: 'var(--color-money)',
                        fontSize: '0.66rem', fontWeight: '700', cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      对上
                    </button>
                  ) : onOpenRecord && (
                    <button
                      type="button"
                      onClick={() => onOpenRecord(record)}
                      style={{
                        padding: '4px 9px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-input)',
                        border: '1px solid var(--border-glass)', color: 'var(--text-secondary)',
                        fontSize: '0.66rem', fontWeight: '700', cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      点开选
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
