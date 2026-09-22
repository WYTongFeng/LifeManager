import React, { useMemo, useState } from 'react';
import { X, Search, Check, CheckSquare, Square } from '../utils/icons';
import { saveJSON, loadJSON } from '../utils/storage';
import { num, sumBy, newId } from '../utils/num';
import { getCycle, getPreviousCycle, isInCycle } from '../utils/cycle';
import { txType, isTransferRecord } from '../utils/accounts';
import { detachCyclePayment } from '../utils/recurring';
import { useMoneyCategories } from './CategoryPicker';
import { categoryKindFor, resolveCategoryId } from '../utils/moneyCategories';
import {
  recordOwnership, OWNERSHIP, OWNERSHIP_META, OWNERSHIP_FILTERS,
} from '../utils/recordOwnership';

const money = (n) => `RM ${num(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const inputStyle = {
  width: '100%', padding: '9px 11px', borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
  color: 'white', fontSize: '0.8rem',
};
const labelStyle = { fontSize: '0.66rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' };

function toggleGroupBtn(active) {
  return {
    flex: 1, padding: '7px 6px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
    fontSize: '0.72rem', fontWeight: '700', whiteSpace: 'nowrap',
    background: active ? 'var(--color-money-soft)' : 'transparent',
    border: `1px solid ${active ? 'var(--color-money)' : 'var(--border-glass)'}`,
    color: active ? 'var(--color-money)' : 'var(--text-secondary)',
  };
}

/**
 * 归类中心 — search every record ever logged and fix what it's filed under.
 *
 * WHY THIS EXISTS
 * Five machineries can each claim a record (see recordOwnership.js), and the
 * moment you decide one should is very often NOT the moment you first logged
 * it — a 共摊本 gets created partway through a cycle, and the rent you
 * already paid this month is sitting there with nowhere to go back and say
 * so. This is that "go back": search, select, and re-file in bulk, with a
 * confirmation screen before anything actually changes.
 *
 * Every batch action funnels through `onSaveExpense`, never a local setter —
 * these records can be dated any day, and `setExpenses` (the today-only
 * slice in App.jsx) silently no-ops on anything else. Same reasoning as
 * MoneyModule's `closeProject`.
 */
export default function ReclassifyCenter({
  expenses, shareTabs, cycle, onSaveExpense, onClose,
  initialOwnership = '', initialShareTabId = '',
  initialCategory = '', initialRange = 'cycle',
}) {
  // `initialRange` matters as much as the filter it comes with. Opening from
  // a 其他 slice means "show me everything filed under this" — scoping that
  // to the current cycle answers a narrower question than the one that was
  // asked, and does it silently.
  const [rangeMode, setRangeMode] = useState(initialRange); // 'cycle' | 'prev' | 'all' | 'custom'
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [direction, setDirection] = useState('all'); // 'all' | 'out' | 'in'
  const [ownershipFilter, setOwnershipFilter] = useState(initialOwnership);
  const [categoryFilter, setCategoryFilter] = useState(initialCategory ? String(initialCategory) : '');
  const [merchantQuery, setMerchantQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [openAction, setOpenAction] = useState(null); // null | 'toTab' | 'fromTab' | 'category'
  const [pending, setPending] = useState(null);
  const [justDone, setJustDone] = useState(null);

  const [targetTabId, setTargetTabId] = useState(initialShareTabId ? String(initialShareTabId) : '');
  const [newTabName, setNewTabName] = useState('');
  const [targetCategory, setTargetCategory] = useState('');

  const { categories: expenseCategories } = useMoneyCategories('expense');
  const { categories: incomeCategories } = useMoneyCategories('income');
  const allCategories = useMemo(
    () => [...expenseCategories, ...incomeCategories],
    [expenseCategories, incomeCategories]
  );

  const previousCycle = useMemo(() => getPreviousCycle(cycle), [cycle]);

  const filtered = useMemo(() => {
    const q = merchantQuery.trim().toLowerCase();
    return (expenses ?? [])
      // Transfers are never a candidate for anything this screen does — moving
      // your own money between your own accounts was never a spend/income
      // question, let alone a 共摊本/项目/欠款 one.
      .filter(e => !isTransferRecord(e))
      .filter(e => {
        const d = e.date ?? '';
        if (rangeMode === 'cycle') return isInCycle(d, cycle);
        if (rangeMode === 'prev') return isInCycle(d, previousCycle);
        if (rangeMode === 'custom') {
          if (customFrom && d < customFrom) return false;
          if (customTo && d > customTo) return false;
        }
        return true;
      })
      // Ledger-wide sign convention: positive leaves, negative arrives.
      .filter(e => {
        if (direction === 'out') return num(e.amount) >= 0;
        if (direction === 'in') return num(e.amount) < 0;
        return true;
      })
      .filter(e => !ownershipFilter || recordOwnership(e) === ownershipFilter)
      .filter(e => {
        if (!categoryFilter) return true;
        const kind = categoryKindFor(txType(e));
        return resolveCategoryId(e.category, kind) === categoryFilter;
      })
      .filter(e => !q || (e.merchant || '').toLowerCase().includes(q))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (num(b.at) - num(a.at)));
  }, [expenses, rangeMode, cycle, previousCycle, customFrom, customTo, direction, ownershipFilter, categoryFilter, merchantQuery]);

  const selectedRows = useMemo(() => filtered.filter(e => selected.has(e.id)), [filtered, selected]);
  const selectedOut = sumBy(selectedRows.filter(e => num(e.amount) >= 0), e => num(e.amount));
  const selectedIn = sumBy(selectedRows.filter(e => num(e.amount) < 0), e => -num(e.amount));
  const allFilteredSelected = filtered.length > 0 && filtered.every(e => selected.has(e.id));
  const canMoveOutOfTab = selectedRows.some(e => recordOwnership(e) === OWNERSHIP.SHARE_TAB);

  const toggleOne = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allFilteredSelected ? new Set() : new Set(filtered.map(e => e.id)));

  // --- un-claim a bill payment before it moves somewhere else ---------------
  // `eligibleIds` covers every record leaving IN THIS SAME BATCH, not just
  // this one — two payments logged separately against the same bill this
  // cycle, both being reclassified together, must not count each other as
  // "still linked" just because the snapshot hasn't been rewritten yet.
  function detachAllocationLink(record, eligibleIds) {
    if (record.allocationId == null || !record.date) return;
    const [yy, mm, dd] = record.date.split('-').map(Number);
    const paidCycle = getCycle(new Date(yy, (mm || 1) - 1, dd || 1));
    const stillLinked = (expenses ?? []).filter(e =>
      !eligibleIds.has(e.id)
      && e.allocationId != null && String(e.allocationId) === String(record.allocationId)
      && (e.date ?? paidCycle.start) >= paidCycle.start
      && (e.date ?? paidCycle.start) < paidCycle.end);
    const remaining = sumBy(stillLinked, e => Math.abs(num(e.amount)));
    const live = loadJSON('allocations', []);
    saveJSON('allocations', detachCyclePayment(live, record.allocationId, paidCycle.start, remaining));
  }

  function startAction(type) {
    if (type === 'toTab') {
      const usingNew = targetTabId === '__new';
      const label = usingNew ? newTabName.trim() : (shareTabs.find(t => String(t.id) === targetTabId)?.label ?? '');
      if (!label) return;
      const eligible = [], skipped = [];
      for (const e of selectedRows) {
        const o = recordOwnership(e);
        if (o === OWNERSHIP.PROJECT) { skipped.push({ e, reason: '项目的一部分' }); continue; }
        if (o === OWNERSHIP.DEBT) { skipped.push({ e, reason: '欠款还款的一部分' }); continue; }
        if (o === OWNERSHIP.SHARE_TAB && !usingNew && String(e.shareTabId) === String(targetTabId)) {
          skipped.push({ e, reason: '已经在这本共摊本了' }); continue;
        }
        eligible.push(e);
      }
      setPending({ type: 'toTab', label: `归入「${label}」`, eligible, skipped, targetTabId, newTabName: usingNew ? label : null });
    } else if (type === 'fromTab') {
      const eligible = [], skipped = [];
      for (const e of selectedRows) {
        if (recordOwnership(e) === OWNERSHIP.SHARE_TAB) eligible.push(e);
        else skipped.push({ e, reason: '本来就不在共摊本里' });
      }
      setPending({ type: 'fromTab', label: '移出共摊本', eligible, skipped });
    } else if (type === 'category') {
      if (!targetCategory) return;
      // Read back from the already-resolved list (renames included) rather
      // than re-deriving through moneyCategoryMeta, which needs `prefs` to
      // know about a rename and this screen has no reason to load twice.
      const meta = allCategories.find(c => c.id === targetCategory) ?? { emoji: '', label: targetCategory };
      setPending({ type: 'category', label: `改成「${meta.emoji} ${meta.label}」`, eligible: selectedRows, skipped: [], targetCategory });
    }
    setOpenAction(null);
  }

  function runPending() {
    if (!pending) return;
    if (pending.type === 'toTab') {
      let resolvedTabId = pending.targetTabId;
      if (resolvedTabId === '__new') {
        const created = { id: newId(), label: pending.newTabName };
        saveJSON('shareTabs', [...shareTabs, created]);
        resolvedTabId = created.id;
      }
      const eligibleIds = new Set(pending.eligible.map(e => e.id));
      for (const e of pending.eligible) {
        if (e.allocationId != null) detachAllocationLink(e, eligibleIds);
        onSaveExpense({ ...e, shareTabId: resolvedTabId, allocationId: null, isProject: false });
      }
    } else if (pending.type === 'fromTab') {
      for (const e of pending.eligible) onSaveExpense({ ...e, shareTabId: null });
    } else if (pending.type === 'category') {
      for (const e of pending.eligible) onSaveExpense({ ...e, category: pending.targetCategory });
    }
    setJustDone({ count: pending.eligible.length, label: pending.label });
    setSelected(new Set());
    setPending(null);
    setTargetTabId(''); setNewTabName(''); setTargetCategory('');
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="glass-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          height: '88vh', maxHeight: '88vh', width: '100%', maxWidth: '520px',
          display: 'flex', flexDirection: 'column', padding: '1.1rem',
          background: 'rgba(22, 22, 30, 0.97)', border: '1px solid var(--border-strong)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem', flexShrink: 0 }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: '700' }}>
            {pending ? '确认' : '归类中心'}
          </h3>
          <button onClick={() => (pending ? setPending(null) : onClose())} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {pending ? (
          <ConfirmScreen pending={pending} onCancel={() => setPending(null)} onConfirm={runPending} />
        ) : (
          <>
            {justDone && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'var(--color-money-soft)', border: '1px solid var(--color-money)',
                borderRadius: 'var(--radius-sm)', padding: '8px 11px', marginBottom: '10px', flexShrink: 0,
              }}>
                <span style={{ fontSize: '0.76rem', color: 'var(--color-money)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Check size={13} /> 已{justDone.label} · {justDone.count} 笔
                </span>
                <button onClick={() => setJustDone(null)} style={{ background: 'none', border: 'none', color: 'var(--color-money)', cursor: 'pointer', padding: 0 }}>
                  <X size={14} />
                </button>
              </div>
            )}

            {/* --- filters ---------------------------------------------- */}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                {[['cycle', '这个周期'], ['prev', '上个周期'], ['all', '全部'], ['custom', '自订']].map(([v, l]) => (
                  <button key={v} onClick={() => setRangeMode(v)} style={toggleGroupBtn(rangeMode === v)}>{l}</button>
                ))}
              </div>
              {rangeMode === 'custom' && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={inputStyle} />
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={inputStyle} />
                </div>
              )}

              <div style={{ display: 'flex', gap: '6px' }}>
                {[['all', '出入全部'], ['out', '只看出'], ['in', '只看入']].map(([v, l]) => (
                  <button key={v} onClick={() => setDirection(v)} style={toggleGroupBtn(direction === v)}>{l}</button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '6px' }}>
                <select value={ownershipFilter} onChange={e => setOwnershipFilter(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                  {OWNERSHIP_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                  <option value="">全部分类</option>
                  {allCategories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
                </select>
              </div>

              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text" placeholder="搜商家名字…" value={merchantQuery}
                  onChange={e => setMerchantQuery(e.target.value)}
                  style={{ ...inputStyle, paddingLeft: '32px' }}
                />
              </div>
            </div>

            {/* --- list header: select-all + selection summary ----------- */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, marginBottom: '6px' }}>
              <button
                onClick={toggleAll}
                disabled={filtered.length === 0}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: filtered.length ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.72rem', padding: 0 }}
              >
                {allFilteredSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                全选 {filtered.length} 笔
              </button>
              {selected.size > 0 && (
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  已选 {selected.size} 笔
                  {selectedOut > 0 && ` · 出 ${money(selectedOut)}`}
                  {selectedIn > 0 && ` · 入 ${money(selectedIn)}`}
                </span>
              )}
            </div>

            {/* --- the list ------------------------------------------------ */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                  这个范围里没有符合条件的记录。
                </div>
              ) : filtered.map(e => {
                const on = selected.has(e.id);
                const ownership = recordOwnership(e);
                const meta = OWNERSHIP_META[ownership];
                const isIn = num(e.amount) < 0;
                return (
                  <div
                    key={e.id}
                    onClick={() => toggleOne(e.id)}
                    className="glass-card"
                    style={{
                      padding: '0.6rem 0.75rem', display: 'flex', alignItems: 'center', gap: '9px', cursor: 'pointer',
                      border: on ? '1px solid var(--color-money)' : '1px solid var(--border-glass)',
                      background: on ? 'var(--color-money-soft)' : undefined,
                    }}
                  >
                    <span style={{ color: on ? 'var(--color-money)' : 'var(--text-muted)', flexShrink: 0 }}>
                      {on ? <CheckSquare size={16} /> : <Square size={16} />}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {e.merchant || '（无名称）'}
                        </span>
                        <span style={{ fontSize: '0.82rem', fontWeight: '700', color: isIn ? 'var(--color-money)' : 'var(--text-primary)', flexShrink: 0 }}>
                          {isIn ? '+' : '−'} {money(Math.abs(num(e.amount)))}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                        <span style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>{e.date}</span>
                        <span style={{
                          fontSize: '0.6rem', fontWeight: '700', padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                          color: meta.color, border: `1px solid ${meta.color}`,
                        }}>
                          {meta.label}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* --- batch actions --------------------------------------- */}
            {selected.size > 0 && (
              <div style={{ flexShrink: 0, marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-glass)' }}>
                {openAction === null ? (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button onClick={() => setOpenAction('toTab')} className="btn-secondary" style={{ flex: 1, padding: '9px 6px', fontSize: '0.74rem' }}>
                      归入共摊本
                    </button>
                    <button
                      onClick={() => setOpenAction('fromTab')}
                      disabled={!canMoveOutOfTab}
                      className="btn-secondary"
                      style={{ flex: 1, padding: '9px 6px', fontSize: '0.74rem', opacity: canMoveOutOfTab ? 1 : 0.4 }}
                    >
                      移出共摊本
                    </button>
                    <button onClick={() => setOpenAction('category')} className="btn-secondary" style={{ flex: 1, padding: '9px 6px', fontSize: '0.74rem' }}>
                      改分类
                    </button>
                  </div>
                ) : openAction === 'toTab' ? (
                  <div>
                    <label style={labelStyle}>归进哪一本?</label>
                    <select value={targetTabId} onChange={e => setTargetTabId(e.target.value)} style={inputStyle}>
                      <option value="">选一本…</option>
                      {shareTabs.filter(t => !t.archived).map(t => (
                        <option key={t.id} value={String(t.id)}>{t.label}</option>
                      ))}
                      <option value="__new">+ 开一个新的共摊本…</option>
                    </select>
                    {targetTabId === '__new' && (
                      <input
                        type="text" placeholder="例：房友共摊" value={newTabName}
                        onChange={e => setNewTabName(e.target.value)}
                        style={{ ...inputStyle, marginTop: '6px' }}
                      />
                    )}
                    <ActionButtons
                      onCancel={() => setOpenAction(null)}
                      onNext={() => startAction('toTab')}
                      disabled={!targetTabId || (targetTabId === '__new' && !newTabName.trim())}
                    />
                  </div>
                ) : openAction === 'fromTab' ? (
                  <div>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      选中的 {selected.size} 笔里，{selectedRows.filter(e => recordOwnership(e) === OWNERSHIP.SHARE_TAB).length} 笔在共摊本里，会移出来变成普通记录。
                    </p>
                    <ActionButtons onCancel={() => setOpenAction(null)} onNext={() => startAction('fromTab')} disabled={false} />
                  </div>
                ) : (
                  <div>
                    <label style={labelStyle}>改成哪个分类?</label>
                    <select value={targetCategory} onChange={e => setTargetCategory(e.target.value)} style={inputStyle}>
                      <option value="">选一个分类…</option>
                      <optgroup label="支出">
                        {expenseCategories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
                      </optgroup>
                      <optgroup label="收入">
                        {incomeCategories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
                      </optgroup>
                    </select>
                    <ActionButtons onCancel={() => setOpenAction(null)} onNext={() => startAction('category')} disabled={!targetCategory} />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ActionButtons({ onCancel, onNext, disabled }) {
  return (
    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
      <button onClick={onCancel} className="btn-secondary" style={{ flex: 1, padding: '8px', fontSize: '0.74rem' }}>取消</button>
      <button
        onClick={onNext}
        disabled={disabled}
        style={{
          flex: 2, padding: '8px', fontSize: '0.74rem', fontWeight: '700', borderRadius: 'var(--radius-sm)',
          background: disabled ? 'var(--bg-input)' : 'var(--color-money)',
          color: disabled ? 'var(--text-muted)' : 'var(--color-money-ink)',
          border: 'none', cursor: disabled ? 'default' : 'pointer',
        }}
      >
        下一步：预览
      </button>
    </div>
  );
}

/**
 * The step he asked for by name — "可以有一些手动确认的吗，我比较安心一点".
 * Nothing from the picker above actually writes anything until this screen's
 * own 确认 is pressed.
 */
function ConfirmScreen({ pending, onCancel, onConfirm }) {
  const { eligible, skipped, label } = pending;

  const skipTally = useMemo(() => {
    const by = new Map();
    for (const { reason } of skipped) by.set(reason, (by.get(reason) ?? 0) + 1);
    return [...by.entries()];
  }, [skipped]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <p style={{ fontSize: '0.85rem', fontWeight: '700', marginBottom: '4px' }}>
        {label} · {eligible.length} 笔
      </p>
      {skipTally.length > 0 && (
        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: 1.5 }}>
          另外 {skipped.length} 笔不会被改动：{skipTally.map(([r, n]) => `${r} ${n} 笔`).join('、')}。
        </p>
      )}

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {eligible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
            选的这些都不适合这样处理，没有东西会被改动。
          </div>
        ) : eligible.map(e => {
          const isIn = num(e.amount) < 0;
          return (
            <div key={e.id} className="glass-card" style={{ padding: '0.55rem 0.75rem', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {e.merchant || '（无名称）'}
                </div>
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{e.date}</div>
              </div>
              <span style={{ fontSize: '0.78rem', fontWeight: '700', color: isIn ? 'var(--color-money)' : 'var(--text-primary)', flexShrink: 0 }}>
                {isIn ? '+' : '−'} {money(Math.abs(num(e.amount)))}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexShrink: 0 }}>
        <button onClick={onCancel} className="btn-secondary" style={{ flex: 1, padding: '10px', fontSize: '0.8rem' }}>取消</button>
        <button
          onClick={onConfirm}
          disabled={eligible.length === 0}
          style={{
            flex: 2, padding: '10px', fontSize: '0.82rem', fontWeight: '700', borderRadius: 'var(--radius-sm)',
            background: eligible.length ? 'var(--color-money)' : 'var(--bg-input)',
            color: eligible.length ? 'var(--color-money-ink)' : 'var(--text-muted)',
            border: 'none', cursor: eligible.length ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          }}
        >
          <Check size={15} /> 确认
        </button>
      </div>
    </div>
  );
}
