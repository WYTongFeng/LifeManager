import React, { useState } from 'react';
import { Plus, Pencil, Trash2, Check } from '../utils/icons';
import { saveJSON, loadJSON } from '../utils/storage';
import { num, newId } from '../utils/num';
import { addTabBill, updateTabBill, removeTabBill, billsStatus } from '../utils/shareTabs';
import { confirmDelete } from './ConfirmDialog';

const money = (n) => `RM ${num(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
  color: 'white', fontSize: '0.78rem',
};

/**
 * A tab's own recurring bills — what replaces a 固定月费 entry for something
 * whose payment now lives inside a 共摊本. The "几号交" reminder has to live
 * SOMEWHERE once rent stops being a plain allocation; this is where it moved
 * to, deliberately stripped of everything an allocation carries that doesn't
 * apply here (frequency, variable/estimate, custodial) — a tab bill is
 * always monthly, always a flat amount, and reserves nothing on its own.
 * computeCycleBudget never reads `bills` at all; only the tab's NET still
 * reaches the budget.
 *
 * "已付" is asked, not stored — see `billsStatus` in shareTabs.js. Tapping
 * 记这笔 on an unpaid bill hands off to MoneyModule's own entry form,
 * pre-filled and pre-linked (`shareTabBillId`), rather than writing an
 * expense from in here: one save path for every expense, not two.
 */
export default function ShareTabBills({ tab, shareTabs, expenses, cycle, onLogBill }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [fLabel, setFLabel] = useState('');
  const [fAmount, setFAmount] = useState('');
  const [fDueDay, setFDueDay] = useState('1');

  const status = billsStatus(tab, expenses, cycle);

  const resetForm = () => { setAdding(false); setEditingId(null); setFLabel(''); setFAmount(''); setFDueDay('1'); };

  const startEdit = (bill) => {
    setEditingId(bill.id);
    setAdding(false);
    setFLabel(bill.label);
    setFAmount(String(bill.amount));
    setFDueDay(String(bill.dueDay ?? 1));
  };

  const save = () => {
    const amount = Number(fAmount);
    if (!fLabel.trim() || !Number.isFinite(amount) || amount <= 0) return;
    const patch = { label: fLabel.trim(), amount, dueDay: Number(fDueDay) || 1 };
    const next = editingId
      ? updateTabBill(shareTabs, tab.id, editingId, patch)
      : addTabBill(shareTabs, tab.id, { id: newId(), ...patch });
    saveJSON('shareTabs', next);
    resetForm();
  };

  const remove = async (bill) => {
    const ok = await confirmDelete({
      title: '删掉这个固定支出？',
      subject: { label: bill.label, meta: `${tab.label} · 每月 ${bill.dueDay ?? 1} 号`, amount: money(bill.amount) },
      body: '以后不会再提醒这笔。已经记下的付款一笔都不会动。',
    });
    if (!ok) return;
    // Re-read: the list can have changed while the dialog was open.
    saveJSON('shareTabs', removeTabBill(loadJSON('shareTabs', shareTabs), tab.id, bill.id));
    if (editingId === bill.id) resetForm();
  };

  const showForm = adding || editingId != null;

  return (
    <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-glass)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-secondary)' }}>固定支出</span>
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
        <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
          还没有固定支出。像房租、Time wifi、Spotify 这种每期都要付的，加进来才会提醒几号交、这期付了没。
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {status.map(bill => (
          <div key={bill.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px',
            padding: '6px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-input)',
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.76rem', fontWeight: '600' }}>{bill.label}</div>
              <div style={{ fontSize: '0.64rem', color: bill.paid ? 'var(--color-money)' : 'var(--text-muted)' }}>
                {bill.dueDay} 号 · {money(bill.amount)}{bill.paid ? ' · 已付' : ' · 还没付'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              {!bill.paid && (
                <button
                  onClick={() => onLogBill(tab, bill)}
                  style={{
                    padding: '4px 9px', borderRadius: 'var(--radius-sm)', background: 'var(--color-money-soft)',
                    border: '1px solid var(--color-money)', color: 'var(--color-money)',
                    fontSize: '0.66rem', fontWeight: '700', cursor: 'pointer',
                  }}
                >
                  记这笔
                </button>
              )}
              <button onClick={() => startEdit(bill)} aria-label={`编辑 ${bill.label}`} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}>
                <Pencil size={13} />
              </button>
              <button onClick={() => remove(bill)} aria-label={`删除 ${bill.label}`} style={{ background: 'none', border: 'none', color: 'var(--color-accent-red)', cursor: 'pointer', padding: '2px' }}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div style={{ marginTop: '8px', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
          <input type="text" placeholder="例：房租 / Time wifi / Spotify" value={fLabel}
            onChange={e => setFLabel(e.target.value)} style={inputStyle} autoFocus />
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
            <input type="number" step="0.01" inputMode="decimal" placeholder="金额 RM" value={fAmount}
              onChange={e => setFAmount(e.target.value)} style={inputStyle} />
            <select value={fDueDay} onChange={e => setFDueDay(e.target.value)} style={{ ...inputStyle, flexShrink: 0, width: '90px' }}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d} 号</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '7px' }}>
            <button onClick={resetForm} className="btn-secondary" style={{ flex: 1, padding: '7px', fontSize: '0.72rem' }}>取消</button>
            <button
              onClick={save}
              disabled={!fLabel.trim() || !(Number(fAmount) > 0)}
              style={{
                flex: 2, padding: '7px', fontSize: '0.72rem', fontWeight: '700', borderRadius: 'var(--radius-sm)',
                background: (fLabel.trim() && Number(fAmount) > 0) ? 'var(--color-money)' : 'var(--bg-input)',
                color: (fLabel.trim() && Number(fAmount) > 0) ? 'var(--color-money-ink)' : 'var(--text-muted)',
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
              }}
            >
              <Check size={13} /> {editingId ? '存' : '加进清单'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
