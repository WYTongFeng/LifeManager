// One label for "what machinery already claims this expense record" — the
// question 归类中心 (ReclassifyCenter.jsx) exists to answer and let you fix.
//
// WHY THIS IS ITS OWN FILE
// Five different modules each independently know how to tell a record apart
// from a plain one — shareTabs.js checks `shareTabId`, projects.js checks
// `isProject`, debts.js checks `repaysDebtId`, recurring.js/cycle.js check
// `allocationId`. None of them needed a NAME for "which of these is this
// record, if any" until a screen came along whose whole job is showing that
// back to the user and letting them change it. Rather than duplicate the
// priority order the form and the budget arithmetic already agree on, this
// reads the same fields in the same order and gives the result a name.
//
// PRIORITY ORDER MATTERS AND IS NOT ARBITRARY
// A restored backup or an older build can produce a record carrying more than
// one of these fields at once — the form keeps them mutually exclusive
// (picking a 共摊本 clears `allocationId` and `isProject`, see MoneyModule's
// 算进共摊本吗 handler), but nothing stops a stale record from disagreeing.
// `computeCycleBudget` already has to pick a winner when that happens — see
// its 「两个机制都不能算」 handling in cycle.js — and 共摊本 wins there. This
// reads the fields in that same order, so the tag shown here never contradicts
// what the budget actually counted.
export const OWNERSHIP = {
  TRANSFER: 'transfer',
  SHARE_TAB: 'shareTab',
  PROJECT: 'project',
  DEBT: 'debt',
  BILL: 'bill',
  PLAIN: 'plain',
};

/**
 * What already claims this record. `transfer` is reported like any other
 * kind rather than being filtered out here — moving your own money between
 * your own accounts is never a candidate for reclassification, but the
 * caller (not this function) decides whether to hide it from a list.
 */
export function recordOwnership(e) {
  if (!e || typeof e !== 'object') return OWNERSHIP.PLAIN;
  if (e.isAccountTransfer) return OWNERSHIP.TRANSFER;
  if (e.shareTabId != null) return OWNERSHIP.SHARE_TAB;
  // Both sides of a project: the fronting record (`isProject`) and a
  // repayment landing back on it (`repaysExpenseId`). Either means this
  // record's story is "a project", not "an ordinary expense that happens to
  // be unlinked".
  if (e.isProject || e.repaysExpenseId != null) return OWNERSHIP.PROJECT;
  if (e.repaysDebtId != null) return OWNERSHIP.DEBT;
  if (e.allocationId != null) return OWNERSHIP.BILL;
  return OWNERSHIP.PLAIN;
}

export const OWNERSHIP_META = {
  [OWNERSHIP.TRANSFER]: { label: '户口转账', color: 'var(--text-muted)' },
  [OWNERSHIP.SHARE_TAB]: { label: '共摊本', color: 'var(--color-money)' },
  [OWNERSHIP.PROJECT]: { label: '项目', color: 'var(--color-diet)' },
  [OWNERSHIP.DEBT]: { label: '欠款', color: 'var(--color-accent-red)' },
  [OWNERSHIP.BILL]: { label: '固定月费', color: 'var(--color-accent-amber)' },
  [OWNERSHIP.PLAIN]: { label: '还没归类', color: 'var(--text-secondary)' },
};

/**
 * The 归属 filter's options. `''` means "everything except transfers" — a
 * transfer is never a plausible target for any of the batch actions this
 * screen offers, so it has no button of its own here; it can still show up
 * tagged 户口转账 if a caller chooses to include it.
 */
export const OWNERSHIP_FILTERS = [
  { value: '', label: '全部归属' },
  { value: OWNERSHIP.SHARE_TAB, label: OWNERSHIP_META[OWNERSHIP.SHARE_TAB].label },
  { value: OWNERSHIP.PROJECT, label: OWNERSHIP_META[OWNERSHIP.PROJECT].label },
  { value: OWNERSHIP.DEBT, label: OWNERSHIP_META[OWNERSHIP.DEBT].label },
  { value: OWNERSHIP.BILL, label: OWNERSHIP_META[OWNERSHIP.BILL].label },
  { value: OWNERSHIP.PLAIN, label: OWNERSHIP_META[OWNERSHIP.PLAIN].label },
];
