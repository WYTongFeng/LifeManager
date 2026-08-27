import React, { useState, useEffect } from 'react';
import { Clock, ShieldAlert, Check, X, Plus, Lock, Unlock, AlertTriangle } from '../utils/icons';
import { usePersistentState } from '../utils/storage';
import { num, newId } from '../utils/num';
import { projectImpact } from '../utils/cycle';
import { isUnlocked, formatRemaining, COOLDOWN_HOURS } from '../utils/impulse';
import { CATEGORIES } from '../utils/tngParser';
import { accountById, defaultAccount } from '../utils/accounts';
import { AccountPicker, AccountChip } from './AccountPicker';
import { nowTimeStr } from '../utils/datetime';

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
  color: 'white', marginTop: '4px', fontSize: '0.85rem',
};
const labelStyle = { fontSize: '0.78rem', color: 'var(--text-secondary)' };
const money = (n) => `RM ${num(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Module 2 of the firewall spec: a non-essential purchase doesn't get logged
 * straight away. It becomes a pending request that sits in a mandatory
 * COOLDOWN_HOURS-long wait, and can only be turned into a real expense once
 * that has actually elapsed.
 *
 * There is deliberately no "buy now anyway" button. The only two actions
 * available before the cooldown ends are wait, or cancel — cancelling early
 * is the wanted behaviour (an impulse that faded is a win), approving early
 * is exactly what this component exists to prevent.
 */
export default function ImpulseSandbox({ budget, cycle, onApprove, accounts = [] }) {
  const [requests, setRequests] = usePersistentState('pendingRequests', []);
  const [showModal, setShowModal] = useState(false);
  const [fLabel, setFLabel] = useState('');
  const [fAmount, setFAmount] = useState('');
  const [fCategory, setFCategory] = useState('Other');
  const [fAccountId, setFAccountId] = useState(null);

  // Countdowns are computed from wall-clock time, not stored state, so this
  // tick exists purely to force a re-render while a request is locked —
  // without it "还要等 23 小时" would freeze at whatever it read on mount.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (requests.length === 0) return;
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, [requests.length]);

  const resetForm = () => {
    setFLabel(''); setFAmount(''); setFCategory('Other');
    setFAccountId(defaultAccount(accounts)?.id ?? null);
  };

  const submitRequest = (e) => {
    e.preventDefault();
    const amount = Number(fAmount);
    if (!fLabel.trim() || !Number.isFinite(amount) || amount <= 0) return;
    setRequests([
      { id: newId(), label: fLabel.trim(), amount, category: fCategory, accountId: fAccountId, createdAt: Date.now() },
      ...requests,
    ]);
    resetForm();
    setShowModal(false);
  };

  const cancelRequest = (id) => setRequests(requests.filter(r => r.id !== id));

  const approveRequest = (r) => {
    // The account is chosen when the request is CREATED, not when it's
    // approved — deciding which pot a purchase comes out of is part of
    // deciding whether you can afford it, which is what the 48-hour wait is
    // for. Falls back to the default for requests created before this existed.
    const account = accountById(accounts, r.accountId) ?? defaultAccount(accounts);
    onApprove({
      merchant: r.label,
      amount: r.amount,
      category: r.category,
      note: '',
      accountId: account?.id ?? null,
      paymentMethod: account?.name ?? '未指定户口',
      source: '冲动沙盒 · 等满 48 小时后确认',
      time: nowTimeStr(),
    });
    cancelRequest(r.id);
  };

  const sorted = [...requests].sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '7px' }}>
          <ShieldAlert size={17} color="var(--color-accent-red)" /> 冲动消费沙盒
        </h3>
        <button onClick={() => setShowModal(true)} className="btn-secondary" style={{ padding: '6px 11px', fontSize: '0.73rem' }}>
          <Plus size={13} /> 新增
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="glass-card" style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.78rem', lineHeight: 1.6 }}>
          想买非必需品（游戏课金、外设、大餐）先记在这里，冻结 {COOLDOWN_HOURS} 小时。
          冷静下来不想买了就取消；{COOLDOWN_HOURS} 小时后还是想要，才能确认变成真的开销。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {sorted.map(r => {
            const unlocked = isUnlocked(r);
            const remaining = formatRemaining(r);
            const impact = projectImpact(budget, cycle, r.amount);
            return (
              <div key={r.id} className="glass-card" style={{
                padding: '0.85rem 1rem',
                border: `1px solid ${unlocked ? 'var(--color-diet)' : 'var(--border-glass)'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{ minWidth: 0 }}>
                    <h4 style={{ fontSize: '0.88rem', fontWeight: '700' }}>{r.label}</h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', flexWrap: 'wrap' }}>
                      <AccountChip accounts={accounts} accountId={r.accountId} size="xs" />
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{r.category}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: '1rem', fontWeight: '800', color: 'var(--color-accent-red)', flexShrink: 0 }}>
                    {money(r.amount)}
                  </span>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px',
                  fontSize: '0.74rem', fontWeight: '700',
                  color: unlocked ? 'var(--color-diet)' : 'var(--text-secondary)',
                }}>
                  {unlocked ? <Unlock size={13} /> : <Lock size={13} />}
                  {unlocked ? '冷却结束 — 可以决定了' : `还要等 ${remaining}`}
                </div>

                {/* The impact preview is shown throughout the cooldown, not just
                    at the end — seeing the consequence early, repeatedly, is
                    part of the friction, not just a gate at approval time. */}
                <div style={{
                  marginTop: '8px', padding: '0.6rem 0.7rem', borderRadius: 'var(--radius-sm)',
                  background: impact.goesNegative ? 'var(--color-accent-red-soft)' : 'var(--bg-card)',
                  border: `1px solid ${impact.goesNegative ? 'var(--color-accent-red)' : 'var(--border-glass)'}`,
                  display: 'flex', gap: '7px', alignItems: 'flex-start',
                }}>
                  <Clock size={13} color={impact.goesNegative ? 'var(--color-accent-red)' : 'var(--text-muted)'} style={{ flexShrink: 0, marginTop: '1px' }} />
                  <p style={{ fontSize: '0.71rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {impact.goesNegative ? (
                      <>如果买了，这个周期会<strong style={{ color: 'var(--color-accent-red)' }}>超支 {money(Math.abs(impact.availableAfter))}</strong>。</>
                    ) : (
                      <>如果买了，接下来 {cycle.daysRemaining} 天每天的额度会从 {money(impact.dailyBefore)}
                        {' '}降到 <strong style={{ color: 'var(--color-diet)' }}>{money(impact.dailyAfter)}</strong>。</>
                    )}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                  <button onClick={() => cancelRequest(r.id)} className="btn-secondary" style={{ flex: 1, fontSize: '0.76rem', padding: '0.55rem' }}>
                    <X size={14} /> 不买了
                  </button>
                  {/* No early-approve path exists — this button is the only way
                      to convert a request into a real expense, and it renders
                      only once `unlocked` is true. */}
                  {unlocked && (
                    <button onClick={() => approveRequest(r)} className="btn-primary" style={{ flex: 1, fontSize: '0.76rem', padding: '0.55rem' }}>
                      <Check size={14} /> 确认购买
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); resetForm(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldAlert size={20} color="var(--color-accent-red)" /> 新的冲动消费请求
              </h3>
              <button onClick={() => { setShowModal(false); resetForm(); }} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{
              background: 'var(--color-accent-red-soft)', border: '1px solid var(--color-accent-red)',
              borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.75rem', marginBottom: '1rem',
              display: 'flex', gap: '7px', alignItems: 'flex-start',
            }}>
              <AlertTriangle size={14} color="var(--color-accent-red)" style={{ flexShrink: 0, marginTop: '1px' }} />
              <p style={{ fontSize: '0.71rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                提交之后会冻结 {COOLDOWN_HOURS} 小时，没有提早解锁的办法。
                真的等不了、现在就要买的东西，直接去「今天」记一般开销就好，不用走这里。
              </p>
            </div>

            <form onSubmit={submitRequest} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>想买什么</label>
                <input
                  type="text" autoFocus placeholder="例：游戏皮肤 / Razer 键盘"
                  value={fLabel} onChange={(e) => setFLabel(e.target.value)}
                  style={inputStyle} required
                />
              </div>
              <div>
                <label style={labelStyle}>金额 (RM)</label>
                <input
                  type="number" step="0.01" min="0.01" inputMode="decimal" placeholder="例：150"
                  value={fAmount} onChange={(e) => setFAmount(e.target.value)}
                  style={inputStyle} required
                />
              </div>
              <div>
                <label style={labelStyle}>分类</label>
                <select value={fCategory} onChange={(e) => setFCategory(e.target.value)} style={inputStyle}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {/* Choosing the pot is part of deciding whether you can afford
                  it — the picker shows each balance, which is the number that
                  should be doing the arguing during the 48-hour wait. */}
              <AccountPicker accounts={accounts} value={fAccountId} onChange={setFAccountId} />
              <div style={{ display: 'flex', gap: '10px', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => { setShowModal(false); resetForm(); }} className="btn-secondary" style={{ flex: 1 }}>取消</button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>
                  <Lock size={14} /> 开始冻结
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
