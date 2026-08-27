// Debt repayment.
//
// TWO KINDS OF DEBT, AND THEY BEHAVE NOTHING ALIKE
//
//   fixed     SPayLater and anything else with an instalment plan. The amount
//             is decided by someone else and the same figure leaves every
//             cycle whether you like it or not. Paying EARLY is the only
//             control you have, and it should visibly shorten the plan.
//
//   flexible  Money owed to a person, a card you chip away at. There is no
//             monthly figure at all until you decide one, and next month you
//             may decide a different one. Forcing a fixed "monthly repayment"
//             field on these was the original mistake: it made the app demand
//             a commitment the real debt never had.
//
// A debt is `fixed` exactly when it has a `schedule`. Nothing else distinguishes
// them, and nothing needs to.
//
// HOW A REPAYMENT HITS THE BUDGET — the user's own words:
// "我会希望月头就先拿一笔钱还这个月的，然后再让我这个月的今天还能花多少变少,
//  就是整个月的每天,是每一天花的钱变少"
//
// So a repayment is NOT a spending spike on the day it happens. It is reserved
// at the top of the cycle and spread thin across every remaining day, exactly
// like rent — RM200 owed over 30 days is "RM6.67 less per day", not "one day
// where you cannot eat". That is what the existing `committed` mechanism in
// cycle.js already does for bills, so repayments join it rather than getting a
// parallel one.
//
// The direct consequence, and the reason `isRepayment` exists: the actual
// payment must then be kept OUT of `spentThisCycle`. It was already subtracted
// when it was reserved. Counting it again on the day it leaves would charge the
// same ringgit to the budget twice — and in the punishing direction, which for
// a repayment is the difference between "I paid off some debt" and "I somehow
// blew the whole month".
//
// A REPAYMENT IS AN EXPENSE, NOT A NEW COLLECTION
// Same decision projects.js made, for the same reasons: it carries
// `repaysDebtId` and is otherwise an ordinary expense. Account balances, the
// ledger, history, sync and backup all keep working untouched, and "how much
// did I repay this month" is a filter rather than a second set of books to keep
// in step with the first.

import { num, sumBy, newId } from './num.js';
import { isInCycle } from './cycle.js';
import { nowTimeStr } from './datetime.js';

/** Category shown on a repayment. Not selectable as a plain expense category. */
export const REPAYMENT_CATEGORY = '还款';

/** A debt with an instalment plan behaves completely differently — see header. */
export function isFixedDebt(debt) {
  return Array.isArray(debt?.schedule) && debt.schedule.length > 0;
}

/** Is this expense a repayment against a debt? */
export function isRepayment(e) {
  return e?.repaysDebtId != null;
}

export function repaymentsFor(debt, expenses = []) {
  if (debt?.id == null) return [];
  return expenses.filter(e => isRepayment(e) && String(e.repaysDebtId) === String(debt.id));
}

/** Everything ever repaid on this debt, through the app. */
export function repaidTotal(debt, expenses = []) {
  return sumBy(repaymentsFor(debt, expenses), e => Math.abs(num(e.amount)));
}

/** Repaid inside one cycle — the "这个月我还了多少" figure. */
export function repaidInCycle(debt, expenses = [], cycle) {
  if (!cycle) return 0;
  return sumBy(
    repaymentsFor(debt, expenses).filter(e => isInCycle(e.date ?? cycle.start, cycle)),
    e => Math.abs(num(e.amount))
  );
}

/**
 * What the debt still says it owes, before repayments.
 *
 * For a scheduled debt that is the unpaid instalments; `paid` flags stay
 * meaningful for anything settled outside the app, which is why they are not
 * simply ignored now that repayments exist.
 */
export function statedRemaining(debt) {
  if (isFixedDebt(debt)) {
    return sumBy(debt.schedule.filter(i => !i.paid), i => num(i.amount));
  }
  return num(debt?.amount);
}

/**
 * What is actually still owed: what the debt says, minus what has been repaid.
 *
 * Floored at zero. Overpaying is not an error — you can clear a schedule early,
 * which is the entire point of paying early — it just cannot make a debt owe
 * you money.
 */
export function outstandingFor(debt, expenses = []) {
  return Math.max(0, statedRemaining(debt) - repaidTotal(debt, expenses));
}

/** The original size of the debt, for a progress bar. */
export function originalTotal(debt) {
  if (isFixedDebt(debt)) return sumBy(debt.schedule, i => num(i.amount));
  return num(debt?.amount);
}

/**
 * How much of this cycle's plan is left to pay — what a "还这个月的" button
 * should offer, and never more than the debt actually still owes.
 */
export function remainingPlanThisCycle(debt, expenses = [], cycle) {
  const owed = outstandingFor(debt, expenses);
  const short = plannedForCycle(debt, cycle) - repaidInCycle(debt, expenses, cycle);
  return Math.max(0, Math.min(owed, short));
}

/**
 * What this cycle is supposed to cost.
 *
 *   fixed     every instalment falling inside the cycle. Note this is a cycle
 *             (10th → 10th), not a calendar month, so an instalment dated the
 *             1st belongs to the cycle that started the previous 10th.
 *   flexible  whatever you decided for this cycle, and nothing until you do.
 *
 * `plan` is keyed by cycle start, the same shape a variable allocation's
 * `actuals` uses — so deciding RM200 this month says nothing about next month,
 * and last month's decision stays on the record instead of being overwritten.
 */
export function plannedForCycle(debt, cycle) {
  if (!cycle) return 0;
  if (isFixedDebt(debt)) {
    return sumBy(
      debt.schedule.filter(i => !i.paid && isInCycle(String(i.due), cycle)),
      i => num(i.amount)
    );
  }
  return num(debt?.plan?.[cycle.start]);
}

/**
 * What to hold back from this cycle's budget for this debt.
 *
 * The larger of what you planned and what you have actually already paid.
 * Paying MORE than planned — clearing a SPayLater plan early, say — really did
 * take that money out of this month, so the budget has to know about all of it;
 * reserving only the plan would leave the app cheerfully offering a daily
 * allowance built on money that is already gone.
 */
export function reservedForCycle(debt, expenses = [], cycle) {
  return Math.max(plannedForCycle(debt, cycle), repaidInCycle(debt, expenses, cycle));
}

/** Set (or clear, with 0) what you intend to repay on a flexible debt this cycle. */
export function setCyclePlan(debts, debtId, cycleStart, amount) {
  const value = num(amount);
  return debts.map(d => {
    if (String(d.id) !== String(debtId)) return d;
    const plan = { ...(d.plan ?? {}) };
    if (value > 0) plan[cycleStart] = value;
    else delete plan[cycleStart];
    return { ...d, plan };
  });
}

/**
 * Build the expense record for a repayment.
 *
 * `at`/`date` are the caller's so a repayment can be backdated, and the account
 * is required in practice — a repayment that names no account moves no balance,
 * which is the one thing this must never quietly do.
 */
export function makeRepayment({ debt, amount, accountId = null, accountName = null, note = '', at = Date.now(), date }) {
  const when = new Date(at);
  return {
    // newId(), not `at` — two repayments made in the same millisecond (clearing
    // several debts in one go) would otherwise share an id, and every id-keyed
    // operation in the app, cloud sync included, would treat them as one record.
    id: newId(),
    at,
    date: date ?? `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`,
    time: nowTimeStr(when),
    merchant: debt?.creditor ?? '还款',
    amount: num(amount),
    category: REPAYMENT_CATEGORY,
    note,
    accountId,
    paymentMethod: accountName ?? '未指定户口',
    repaysDebtId: debt?.id ?? null,
    // Written alongside the link for the same reason makeTransfer writes it:
    // the flag and the type must never be able to disagree.
    type: 'repayment',
    source: '还款',
  };
}

/**
 * Every debt with this cycle's figures worked out. One call, so the several
 * screens that show debts can't drift apart on what "还了多少" means.
 */
export function debtsForCycle(debts = [], expenses = [], cycle) {
  return debts.map(debt => {
    const planned = plannedForCycle(debt, cycle);
    const repaid = repaidInCycle(debt, expenses, cycle);
    const outstanding = outstandingFor(debt, expenses);
    const original = originalTotal(debt);
    return {
      debt,
      fixed: isFixedDebt(debt),
      planned,
      repaid,
      reserved: Math.max(planned, repaid),
      remainingThisCycle: Math.max(0, Math.min(outstanding, planned - repaid)),
      outstanding,
      original,
      // Null rather than 0 when there is nothing to measure against, so the UI
      // can leave the bar out instead of drawing a permanently empty one.
      progressPct: original > 0 ? Math.min(100, ((original - outstanding) / original) * 100) : null,
      settled: outstanding <= 0,
    };
  });
}

/** Total reserved across every debt — what cycle.js holds back from the budget. */
export function totalReservedForCycle(debts = [], expenses = [], cycle) {
  return sumBy(debts, d => reservedForCycle(d, expenses, cycle));
}

/** Total actually repaid this cycle, across every debt. */
export function totalRepaidInCycle(debts = [], expenses = [], cycle) {
  return sumBy(debts, d => repaidInCycle(d, expenses, cycle));
}

// --- building and editing an instalment plan --------------------------------
//
// WHY THIS EXISTS
// `isFixedDebt` has always been "does it have a schedule", every reader of a
// schedule was written and tested, and `buildSchedule` sat in networth.js —
// but NOTHING in the app ever called it. The only schedule this user has
// arrived through a restored backup file. So the app could read a instalment
// plan perfectly and could not create one, which meant every debt added by
// hand became a flat lump sum: a RM1,864.28 SPayLater plan shown as one
// number to clear, when it is really RM368.70 this month and the rest later.
//
// The user's words: "不能只显示 RM1,864.28 然后叫我一次还掉；它本身就是分期
// 债务，要按照实际分期处理".
//
// A REAL PLAN IS NOT UNIFORM
// The generator produces even instalments because that is what a form can ask
// for, but this user's actual SPayLater is 365.70 / 262.66 / 262.68 / then
// 20.73 eighteen times — several overlapping purchases, not one plan. So
// generating is only the starting point: `setInstalmentAmount` edits a single
// row, and `rebuildSchedule` replaces the unpaid tail while keeping everything
// already settled. A generator you cannot correct afterwards would have been
// another workflow he doesn't follow.

/**
 * Build a fixed instalment schedule.
 *
 * The low-level primitive: dates and amounts in, rows out. What the user
 * actually types into the form goes through `buildInstalments` below, which
 * normalizes it and calls this. Lived in networth.js until the repayment plan
 * needed both this and `plannedForCycle`; networth.js re-exports it.
 *
 * @param {string} firstDue   YYYY-MM-DD of the first payment
 * @param {number[]|number} amounts  per-instalment amounts, or one repeated amount
 * @param {number} count      only used when `amounts` is a single number
 * @param {'monthly'|'biweekly'|'weekly'} frequency  how far apart they fall
 */
export function buildSchedule(firstDue, amounts, count = 1, frequency = 'monthly') {
  const list = Array.isArray(amounts) ? amounts : Array(count).fill(amounts);
  const [y, m, d] = String(firstDue).split('-').map(Number);

  return list.map((amount, i) => {
    let date;
    if (frequency === 'weekly' || frequency === 'biweekly') {
      date = new Date(y, m - 1, d + i * (frequency === 'weekly' ? 7 : 14));
    } else {
      // Clamp onto a real day of the target month. `new Date(y, m + i, 31)`
      // silently rolls into the NEXT month for February and the 30-day
      // months, which for a plan starting on the 31st moves four instalments
      // a year into a cycle they do not belong to. recurring.js already
      // documents this exact trap for bills; a schedule had it too.
      const monthIndex = m - 1 + i;
      const lastDay = new Date(y, monthIndex + 1, 0).getDate();
      date = new Date(y, monthIndex, Math.min(d, lastDay));
    }
    const due = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { due, amount: num(amount), paid: false };
  });
}

/** How far apart instalments fall. Matches `buildSchedule`'s `frequency`. */
export const INSTALMENT_FREQUENCIES = [
  { value: 'monthly', label: '每月', perYear: 12 },
  { value: 'biweekly', label: '每两星期', perYear: 26 },
  { value: 'weekly', label: '每星期', perYear: 52 },
];

export function instalmentFrequencyMeta(value) {
  return INSTALMENT_FREQUENCIES.find(f => f.value === value) ?? INSTALMENT_FREQUENCIES[0];
}

/**
 * Turn what the form asked for into schedule rows.
 *
 * `finalAmount` exists because an instalment plan almost never divides evenly:
 * 21 × RM88.77 is RM1,864.17, not RM1,864.28. Letting the last row carry the
 * remainder is how the real ones work, and it keeps the schedule total equal
 * to the debt the user actually owes rather than eleven sen short.
 *
 * @param {{firstDue:string, count:number, amount:number,
 *          frequency?:string, finalAmount?:number|null}} spec
 * @returns {{due:string, amount:number, paid:boolean}[]}
 */
export function buildInstalments({ firstDue, count, amount, frequency = 'monthly', finalAmount = null }) {
  const n = Math.max(0, Math.floor(num(count)));
  const per = num(amount);
  if (!firstDue || n <= 0 || per <= 0) return [];
  const amounts = Array(n).fill(per);
  const last = finalAmount == null || finalAmount === '' ? null : num(finalAmount);
  if (last != null && last > 0 && n > 0) amounts[n - 1] = last;
  return buildSchedule(firstDue, amounts, n, frequency);
}

/**
 * Replace a debt's UNPAID instalments, keeping every settled one.
 *
 * Editing a plan mid-way is normal — the shop adds a purchase, the amount
 * changes, you paid three of them already. Regenerating the whole schedule
 * would erase the record that those three were paid, and `debtOutstanding`
 * would jump back up by their value.
 */
export function rebuildSchedule(debt, spec) {
  const kept = (debt?.schedule ?? []).filter(i => i.paid);
  return [...kept, ...buildInstalments(spec)]
    .sort((a, b) => String(a.due).localeCompare(String(b.due)));
}

/** Change one instalment's amount. Identified by `due`, like `toggleInstalmentPaid`. */
export function setInstalmentAmount(debts, debtId, due, amount) {
  return debts.map(d => {
    if (String(d.id) !== String(debtId) || !Array.isArray(d.schedule)) return d;
    return {
      ...d,
      schedule: d.schedule.map(i => (i.due === due ? { ...i, amount: num(amount) } : i)),
    };
  });
}

/** Drop one instalment entirely — a plan that got shorter, not just cheaper. */
export function removeInstalment(debts, debtId, due) {
  return debts.map(d => {
    if (String(d.id) !== String(debtId) || !Array.isArray(d.schedule)) return d;
    return { ...d, schedule: d.schedule.filter(i => i.due !== due) };
  });
}

/**
 * The plan at a glance — what the form and the debt card both need to print,
 * so they can't describe the same schedule two different ways.
 */
export function scheduleSummary(debt) {
  const rows = Array.isArray(debt?.schedule) ? debt.schedule : [];
  if (rows.length === 0) return null;
  const unpaid = rows.filter(i => !i.paid);
  const sorted = [...unpaid].sort((a, b) => String(a.due).localeCompare(String(b.due)));
  return {
    count: rows.length,
    paidCount: rows.length - unpaid.length,
    remainingCount: unpaid.length,
    total: sumBy(rows, i => num(i.amount)),
    remainingTotal: sumBy(unpaid, i => num(i.amount)),
    next: sorted[0] ?? null,
    last: sorted[sorted.length - 1] ?? null,
  };
}

/**
 * How much choice you have about paying this.
 *
 *   'scheduled' — someone else set the amount and the date. You can pay EARLY,
 *                 you cannot pay less.
 *   'flexible'  — you decide, every cycle, and may decide differently next one.
 *
 * Exists so the repayment plan can group by it instead of presenting a fixed
 * instalment and money owed to a friend as the same kind of obligation — which
 * is what made the waterfall read as "hand over everything you have".
 */
export function commitmentOf(debt) {
  return isFixedDebt(debt) ? 'scheduled' : 'flexible';
}
