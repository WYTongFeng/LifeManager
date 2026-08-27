// "Projects" — an expense fronted for a group that others owe money back for
// (a shared dinner, a group booking). This is NOT a new data collection: a
// project is just an expense marked `isProject: true`, and a repayment is the
// existing refund mechanism (a negative expense, see MoneyModule) carrying
// `repaysExpenseId` pointing back at it.
//
// Reusing the expense ledger means History, sync, backup, and every total
// that already sums `expenses` correctly need no changes at all — the only
// new thing is "which project does this repayment belong to".
//
// Repayments can land on a different day than the original expense (a friend
// pays you back next week), so this always needs the FULL, unfiltered
// expense list — not just today's — or a repayment landing outside today's
// window would silently vanish from the running total.

/**
 * Every project, with how much of it has been paid back so far.
 * @param {Array} expenses  the full expense list, every date
 */
export function getProjects(expenses) {
  return expenses
    .filter(e => e.isProject)
    .map(project => {
      const repaidAmount = expenses
        .filter(e => e.repaysExpenseId === project.id)
        .reduce((sum, e) => sum + Math.abs(e.amount), 0);
      const outstanding = Math.max(0, project.amount - repaidAmount);
      return { ...project, repaidAmount, outstanding, isSettled: outstanding <= 0 };
    });
}

/** Projects still owed money on — what the repayment dropdown offers. */
export function getOpenProjects(expenses) {
  return getProjects(expenses).filter(p => !p.isSettled);
}

/** The project a given repayment is linked to, if any. */
export function findProjectFor(expense, projects) {
  if (expense.repaysExpenseId == null) return null;
  return projects.find(p => p.id === expense.repaysExpenseId) ?? null;
}

// So "Ah Meng" and "ah meng " are recognised as the same person when matching
// a repayment's merchant name against an expected debtor's name.
const normaliseName = (s) => (s || '').trim().toLowerCase();

/**
 * Per-person status for a project — the actual answer to "who hasn't paid me
 * back yet". `project.debtors` is an optional list set when the project was
 * created: [{ name, share }]. Without it, a project still works exactly as
 * before (aggregate outstanding only) — this is additive, not required.
 *
 * A debtor counts as paid once repayments linked to this project, matched to
 * them by name, sum to at least their share. Someone can repay across more
 * than one transfer (e.g. RM10 now, RM10 later) and both count.
 *
 * @param {object} project   one entry from getProjects()
 * @param {Array}  expenses  the full expense list, every date
 */
export function getDebtorStatus(project, expenses) {
  if (!project.debtors?.length) return [];

  const repayments = expenses.filter(e => e.repaysExpenseId === project.id);

  return project.debtors.map((d, i) => {
    const paid = repayments
      .filter(r => normaliseName(r.merchant) === normaliseName(d.name))
      .reduce((sum, r) => sum + Math.abs(r.amount), 0);
    const share = Number(d.share) || 0;
    return {
      id: i,
      name: d.name,
      share,
      paid,
      owing: Math.max(0, share - paid),
      isPaid: paid >= share && share > 0,
    };
  });
}
