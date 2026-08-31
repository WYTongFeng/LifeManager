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
 *
 * CLOSING A PROJECT, AND WHY IT HAD TO EXIST
 * `isSettled` used to mean one thing only: repayments have reached the full
 * amount. That is almost never true, because the person fronting the money is
 * usually part of the group — you pay RM100 for a dinner four people ate, three
 * friends send you RM25 each, and RM25 was always yours to pay. Repayments stop
 * at RM75 and the project sits in 进行中的项目 forever with "还差 RM 25", which
 * reads as a debt nobody owes.
 *
 * So a project can now be closed by hand (`closedAt`). Closing says: nothing
 * more is coming, and whatever is left was mine all along. That leftover is
 * `myShare`, and it is the number that should count as this user's own
 * spending — see `ownSpend` below.
 *
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
      const isClosed = project.closedAt != null;
      return {
        ...project,
        repaidAmount,
        outstanding,
        isClosed,
        // What the user themselves ended up paying: everything nobody sent
        // back. Floored at 0 so an overpayment reads as "I paid nothing"
        // rather than as negative spending.
        myShare: Math.max(0, project.amount - repaidAmount),
        // Fully repaid OR closed by hand. Both mean "stop asking about this".
        isSettled: outstanding <= 0 || isClosed,
      };
    });
}

/** Projects still owed money on — what the repayment dropdown offers. */
export function getOpenProjects(expenses) {
  return getProjects(expenses).filter(p => !p.isSettled);
}

/** Projects closed by hand, newest first — the 已结束 list, and undo. */
export function getClosedProjects(expenses) {
  return getProjects(expenses)
    .filter(p => p.isClosed)
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
}

/**
 * How much of each expense is the user's OWN spending, keyed by expense id.
 *
 * Only closed projects appear in the map — everything else spends what it says
 * it spends. A closed RM100 dinner with RM75 sent back contributes RM25, so
 * the category breakdown and the monthly circle stop charging this user for
 * three other people's share of a meal.
 *
 * WHAT THIS DELIBERATELY DOES NOT TOUCH
 * Account balances, and every net total in cycle.js. Those are about money
 * that genuinely moved: RM100 really did leave the account and RM75 really did
 * come back, and `spentThisCycle` already nets the pair correctly. This is
 * only for the views that answer 「我花了多少」 — where the gross figure
 * charges you for money that was never yours to spend.
 *
 * Open projects are untouched on purpose. Until a project is closed the app
 * cannot know how much of it is yours: the RM25 still outstanding might be a
 * friend who hasn't paid yet. Closing is the user stating that it isn't.
 *
 * @param {Array} expenses  the full expense list, every date
 * @returns {Map<any, number>} expense id -> the amount that was actually yours
 */
export function ownSpendById(expenses) {
  const map = new Map();
  for (const p of getProjects(expenses)) {
    if (p.isClosed) map.set(p.id, p.myShare);
  }
  return map;
}

/**
 * The amount of one expense that counts as the user's own spending.
 * `overrides` comes from `ownSpendById` — built once per list, not per row.
 */
export function ownSpend(expense, overrides) {
  const adjusted = overrides?.get(expense?.id);
  return adjusted != null ? adjusted : Number(expense?.amount) || 0;
}

/**
 * Repayment records belonging to a CLOSED project.
 *
 * Once a project is closed its expense is counted at `myShare` — already net of
 * every repayment — so counting those same repayments again as money received
 * would subtract them twice. Anything reporting 另收 / refunds needs to skip
 * exactly this set.
 */
export function closedProjectRepaymentIds(expenses) {
  const closed = new Set(getProjects(expenses).filter(p => p.isClosed).map(p => p.id));
  const ids = new Set();
  for (const e of expenses) {
    if (e.repaysExpenseId != null && closed.has(e.repaysExpenseId)) ids.add(e.id);
  }
  return ids;
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
