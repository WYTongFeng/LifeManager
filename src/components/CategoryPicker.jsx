import React, { useMemo } from 'react';
import { useLiveJSON } from '../utils/storage';
import {
  CATEGORY_PREFS_KEY, resolveMoneyCategories, moneyCategoryMeta,
  categoryKindFor, resolveCategoryId,
} from '../utils/moneyCategories';

/**
 * One place that knows how to show and choose a money category.
 *
 * Four screens ask this question — 记账, the notification reader, 待确认, and
 * 想买清单 — and each used to render its own `<select>` over the same imported
 * array. That was survivable while there was one array; it stops being
 * survivable now that the right list depends on whether money is coming in or
 * going out, and that the user can add categories of their own. A rename would
 * otherwise have to be remembered in four places.
 *
 * `useLiveJSON`, not `usePersistentState`: the manager screen writes this key
 * while these pickers are mounted, and two `usePersistentState` instances over
 * one key drift apart until one of them remounts. See storage.js.
 */
export function useMoneyCategories(kind = 'expense') {
  const prefs = useLiveJSON(CATEGORY_PREFS_KEY, null);
  return useMemo(() => ({
    prefs,
    categories: resolveMoneyCategories(prefs, kind),
  }), [prefs, kind]);
}

/**
 * A category dropdown for one transaction type.
 *
 * `txType` rather than a raw kind, so call sites pass what they already have
 * and cannot get the expense/income split wrong — a refund reads from the
 * income list, which is not obvious enough to leave to each caller.
 */
export function CategorySelect({ txType = 'expense', value, onChange, style, id }) {
  const kind = categoryKindFor(txType);
  const { prefs, categories } = useMoneyCategories(kind);
  const current = resolveCategoryId(value, kind);

  // A record filed under a category that was later hidden — or one written by
  // an older build — still has to be selectable, or opening it to edit
  // something unrelated would silently move it to whatever sits first in the
  // list. It's appended as its own option instead.
  const known = categories.some(c => c.id === current);
  const orphan = known ? null : moneyCategoryMeta(current, kind, prefs);

  return (
    <select id={id} value={current} onChange={(e) => onChange(e.target.value)} style={style}>
      {categories.map(c => (
        <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
      ))}
      {orphan && (
        <option value={orphan.id}>
          {orphan.emoji} {orphan.label}{orphan.missing ? '（已删除）' : '（已隐藏）'}
        </option>
      )}
    </select>
  );
}

/**
 * A category as text, for lists and chips.
 *
 * Takes the raw stored value — legacy English strings included — so no call
 * site has to remember to resolve first.
 */
export function CategoryText({ value, txType = 'expense', showEmoji = true, style }) {
  const kind = categoryKindFor(txType);
  const prefs = useLiveJSON(CATEGORY_PREFS_KEY, null);
  const meta = moneyCategoryMeta(value, kind, prefs);
  return (
    <span style={style}>
      {showEmoji ? `${meta.emoji} ` : ''}{meta.label}
    </span>
  );
}
