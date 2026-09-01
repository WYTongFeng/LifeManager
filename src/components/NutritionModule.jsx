import React from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { Utensils, Package } from '../utils/icons';
import DietModule from './DietModule';
import SupplementsModule from './SupplementsModule';

/**
 * 饮食 and 补充剂, behind one tab.
 *
 * WHY THE SUPPLEMENT MODULE LIVES HERE AND NOT IN THE LIFE HUB
 * The hub's sheet is documented as four tiles and only four — a launcher with
 * five is a menu, and a menu is something you read before you can act. Adding a
 * fifth would undo that on the first new feature after it was written down.
 *
 * Nutrition is also where it actually belongs. A protein powder's 24 g and 125
 * kcal are food, and the one integration that matters — logging a shake into
 * the day's calories — is a screen away rather than a module away. The two tabs
 * share a subject; they are not two things filed together for want of a home.
 *
 * DELIBERATELY NOT A THIRD TAB IN THE BOTTOM NAV. That bar is four items and a
 * centre button, and its whole shape depends on staying that.
 *
 * The section is a real URL segment, matching /sports/:section? and /money/:view?,
 * so the Android back button walks 补充剂表单 → 补充剂 → 饮食 with no special
 * handling — every step is a route.
 */
export default function NutritionModule(props) {
  const { section } = useParams();
  const onSupplements = section === 'supplements';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ display: 'flex', gap: '6px', padding: '0.75rem 1rem 0' }}>
        <Tab to="/diet" active={!onSupplements} Icon={Utensils} label="饮食" />
        <Tab to="/diet/supplements" active={onSupplements} Icon={Package} label="补充剂" />
      </div>

      {/* Only one of the two is mounted. DietModule carries a large amount of
          form state and a food-estimate pipeline; keeping it alive behind the
          supplement screen would cost that for nothing, and its `useEffect`s
          would keep running against a screen nobody is looking at. */}
      {onSupplements
        ? <SupplementsModule onLogMeal={props.onLogMeal} />
        : <DietModule {...props} />}
    </div>
  );
}

function Tab({ to, active, Icon, label }) {
  return (
    <NavLink
      to={to}
      // `end` on neither: /diet/supplements/:id must keep the 补充剂 tab lit,
      // and the active state is computed here anyway so the two can never
      // disagree with each other.
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: '6px', textDecoration: 'none',
        background: active ? 'var(--color-diet-soft)' : 'var(--bg-input)',
        border: `1px solid ${active ? 'var(--color-diet)' : 'var(--border-glass)'}`,
        color: active ? 'var(--color-diet)' : 'var(--text-secondary)',
        borderRadius: 'var(--radius-sm)', padding: '8px 10px',
        fontSize: '0.78rem', fontWeight: active ? '700' : '600',
      }}
    >
      <Icon size={14} /> {label}
    </NavLink>
  );
}
