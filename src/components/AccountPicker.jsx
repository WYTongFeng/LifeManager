import React from 'react';
import { Wallet, Landmark, Lock, AlertTriangle } from '../utils/icons';
import { typeMeta, accountById, sameId } from '../utils/accounts';

/**
 * "Which account did this come out of" — as a control, and as a badge.
 *
 * Deliberately shared rather than re-implemented per screen: the expense form,
 * the recurring-bill form, the impulse sandbox and the notification review
 * queue all have to ask the same question, and the answer has to look
 * identical in all four or the app stops feeling like it knows its own data.
 *
 * Rendered as tappable chips, not a <select>. On a phone this is the field
 * you touch most often in the whole app — one tap beats a native picker
 * wheel — and it also makes the balance visible AT THE MOMENT OF CHOOSING,
 * which is the entire point of a spending-firewall app.
 */
export function AccountPicker({ accounts, value, onChange, showBalance = true, label = '从哪个户口出?' }) {
  const usable = accounts.filter(a => !a.archived);
  if (usable.length === 0) return null;

  return (
    <div>
      {label && <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{label}</label>}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
        {usable.map(a => {
          const meta = typeMeta(a.type);
          const selected = sameId(a.id, value);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onChange(a.id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '1px',
                padding: '7px 11px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                background: selected ? `${meta.color}22` : 'var(--bg-input)',
                border: `1px solid ${selected ? meta.color : 'var(--border-glass)'}`,
                color: selected ? meta.color : 'var(--text-secondary)',
                minWidth: '96px',
              }}
            >
              <span style={{ fontSize: '0.76rem', fontWeight: selected ? '800' : '600', display: 'flex', alignItems: 'center', gap: '5px' }}>
                {a.kind === 'custodial' ? <Lock size={11} /> : a.type === 'bank' ? <Landmark size={11} /> : <Wallet size={11} />}
                {a.name}
              </span>
              {showBalance && a.balance != null && (
                <span style={{
                  fontSize: '0.62rem',
                  color: a.balance < 0 ? 'var(--color-accent-red)' : selected ? meta.color : 'var(--text-muted)',
                  opacity: selected ? 0.9 : 1,
                }}>
                  RM {Number(a.balance).toFixed(2)}
                  {a.countsToNetWorth === false && ' · 不算储蓄'}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Spending from money that isn't yours is the single most consequential
          thing this app can fail to point out — say it at the moment of
          choosing, not afterwards on a summary screen. */}
      {(() => {
        const chosen = accountById(usable, value);
        if (!chosen) return null;
        if (chosen.kind === 'custodial') {
          return (
            <p style={{
              fontSize: '0.67rem', color: 'var(--color-accent-red)', marginTop: '7px',
              display: 'flex', gap: '5px', alignItems: 'flex-start', lineHeight: 1.5,
            }}>
              <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>这是<strong>代管的钱</strong> — 花掉等于欠回去，会自动算进欠款里。</span>
            </p>
          );
        }
        if (chosen.countsToNetWorth === false) {
          return (
            <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '7px', lineHeight: 1.5 }}>
              这个户口设成「只记录」 — 这笔照样记账，但它的余额不算进你的储蓄。
            </p>
          );
        }
        return null;
      })()}
    </div>
  );
}

/**
 * The read-only counterpart: a small chip identifying an account in a list row.
 * `unassigned` deliberately renders as a visible warning rather than as blank —
 * an expense whose account nobody ever set is a hole in the ledger, and a hole
 * you can see gets fixed.
 */
export function AccountChip({ accounts, accountId, size = 'sm' }) {
  const a = accountById(accounts, accountId);
  const fontSize = size === 'xs' ? '0.6rem' : '0.66rem';

  if (!a) {
    return (
      <span style={{
        fontSize, fontWeight: '700', color: 'var(--color-accent-red)',
        background: 'var(--color-accent-red-soft)', border: '1px solid var(--color-accent-red)',
        borderRadius: 'var(--radius-sm)', padding: '1px 6px', whiteSpace: 'nowrap',
      }}>
        未指定户口
      </span>
    );
  }

  const meta = typeMeta(a.type);
  return (
    <span style={{
      fontSize, fontWeight: '700', color: meta.color,
      background: `${meta.color}1f`, border: `1px solid ${meta.color}66`,
      borderRadius: 'var(--radius-sm)', padding: '1px 6px', whiteSpace: 'nowrap',
      display: 'inline-flex', alignItems: 'center', gap: '3px',
    }}>
      {a.kind === 'custodial' && <Lock size={9} />}
      {a.name}
    </span>
  );
}

/** Compact `<select>` for places too tight for chips (modals with many fields). */
export function AccountSelect({ accounts, value, onChange, style, allowEmpty = false, emptyLabel = '还没决定' }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} style={style}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {accounts.filter(a => !a.archived).map(a => (
        <option key={a.id} value={a.id}>
          {a.name}{a.balance != null ? ` · RM ${Number(a.balance).toFixed(2)}` : ''}
        </option>
      ))}
    </select>
  );
}
