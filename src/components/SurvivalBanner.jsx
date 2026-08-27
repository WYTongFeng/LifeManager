import React from 'react';
import { ShieldAlert } from '../utils/icons';
import { SURVIVAL_THRESHOLD } from '../utils/networth';
import { num } from '../utils/num';

const money = (n) => `RM ${num(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Module 3 of the firewall spec: red-alert survival mode. Renders across
 * every tab, not just Money — the whole point is you can't get away from the
 * number by looking at Diet or Sports instead.
 *
 * Deliberately has no dismiss button. A close button would let the banner be
 * silenced without the actual number changing, which defeats it. It only
 * stops showing once `ownCash` genuinely rises above SURVIVAL_THRESHOLD —
 * payday arrives, or spending stops.
 */
export default function SurvivalBanner({ ownCash, daysRemaining }) {
  return (
    <div style={{
      background: 'var(--color-accent-red)', color: 'white',
      padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '8px',
      fontSize: '0.76rem', fontWeight: '700', lineHeight: 1.4,
    }}>
      <ShieldAlert size={16} style={{ flexShrink: 0 }} />
      <span>
        生存模式 SURVIVAL MODE · 可动用现金只剩 {money(ownCash)}（低于 {money(SURVIVAL_THRESHOLD)}）
        {daysRemaining != null && <> · 还有 {daysRemaining} 天才发薪</>}
        {' '}— 只买躲不掉的：吃饭、交通。
      </span>
    </div>
  );
}
