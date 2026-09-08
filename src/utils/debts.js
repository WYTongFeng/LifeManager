// Debt repayment.
//
// TWO KINDS OF DEBT, AND THEY BEHAVE NOTHING ALIKE
//
//   fixed     SPayLater and anything else with an instalment plan. Someone
//             else wrote the table, so the table is what the app SUGGESTS for
//             the cycle — but the figure that actually gets reserved is still
//             the user's, because he is the one who knows what he is paying and
//             when. Paying early should visibly shorten the plan.
//
//   flexible  Money owed to a person, a card you chip away at. There is no
//             monthly figure at all until you decide one, and next month you
//             may decide a different one. Forcing a fixed "monthly repayment"
//             field on these was the original mistake: it made the app demand
//             a commitment the real debt never had.
//
// A debt is `fixed` exactly when it has a `schedule`. Nothing else distinguishes
// them, and nothing needs to — the two now share one input and one code path
// (`plannedForCycle`), differing only in what the box is pre-filled with.
//
// HOW A REPAYMENT HITS THE BUDGET — the user's own words:
// "我会希望月头就先拿一笔钱还这个月的，然后再让我这个月的今天还能花多少变少,
//  就是整个月的每天,是每一天花的钱变少"
//
// So a repayment is NOT a spending spike on the day it happens. The figure HE
// decides for the cycle is reserved and spread thin across every remaining day,
// exactly like rent — RM200 owed over 30 days is "RM6.67 less per day", not
// "one day where you cannot eat". That is what the existing `committed`
// mechanism in cycle.js already does for bills, so repayments join it rather
// than getting a parallel one.
//
// What is spread is the AMOUNT, never the timing. The app never asks him to pay
// on a particular day and has no opinion about which day he does: the reserve
// is budgeting, `makeRepayment`'s free `date` is the record.
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
 * What the instalment table says this cycle costs — the SUGGESTION, and only
 * ever a suggestion. Zero for a debt with no schedule, which has nothing to
 * suggest from.
 */
export function scheduledForCycle(debt, cycle) {
  if (!cycle || !isFixedDebt(debt)) return 0;
  return sumBy(
    debt.schedule.filter(i => !i.paid && isInCycle(String(i.due), cycle)),
    i => num(i.amount)
  );
}

/** Has the user typed a figure for this debt this cycle? */
export function hasCyclePlan(debt, cycle) {
  return Boolean(cycle) && debt?.plan?.[cycle.start] != null;
}

/**
 * 「这个月不算这一笔」 — a per-cycle off switch, keyed by cycle start.
 *
 * WHY NOT JUST TYPE 0
 * You can, and it means the same thing to the arithmetic. It does not mean the
 * same thing to read. A row saying RM0.00 with a box you could have typed
 * anything into looks like a debt you forgot to plan; a row that is ticked off
 * looks like a decision. The user asked for the tick by name — 「让我勾哪些要
 * 出现在这个月」 — and a tick that secretly writes into the same field he types
 * amounts into would fight him the moment he typed one.
 *
 * So it is its own map, and it OUTRANKS the plan: skipped means 0 reserved and
 * off the calendar, whatever the schedule or the box says. Untick and whatever
 * was there before comes back untouched — which is the whole reason it isn't
 * implemented by overwriting the plan with 0.
 *
 * Repayments actually made are NOT hidden by it. Money that moved, moved: see
 * `reservedForCycle`, which still reserves what was really paid.
 */
export function isDebtSkippedInCycle(debt, cycle) {
  return Boolean(cycle) && Boolean(debt?.skipped?.[cycle.start]);
}

/** Switch one debt off (or back on) for one cycle. */
export function setDebtCycleSkip(debts = [], debtId, cycleStart, skip) {
  return debts.map(d => {
    if (String(d.id) !== String(debtId)) return d;
    const skipped = { ...(d.skipped ?? {}) };
    // Deleted rather than stored as false, so the map only ever holds the
    // exceptions — same rule as recurring.js's.
    if (skip) skipped[cycleStart] = true;
    else delete skipped[cycleStart];
    return { ...d, skipped };
  });
}

/**
 * What this cycle is supposed to cost.
 *
 * ONE RULE FOR BOTH KINDS: what you decided, and only failing that, what the
 * schedule says. A fixed instalment used to be read straight off the table with
 * no way to say otherwise, which made the app the one deciding how much left
 * his account this month. His words, 1 Sep 2026: "还钱什么我自己来定时间 …
 * 这个月我要还多少我会自己去算的，这个 app 就是帮我记录一下". So the schedule
 * became the default rather than the answer — it still fills the box, and it is
 * still shown beside the box after an override (`scheduledForCycle`), because
 * "what the plan wanted" stays worth knowing once you have chosen differently.
 *
 * A flexible debt is unchanged: nothing until you decide.
 *
 * `plan` is keyed by cycle start, the same shape a variable allocation's
 * `actuals` uses — so deciding RM200 this month says nothing about next month,
 * and last month's decision stays on the record instead of being overwritten.
 * A stored 0 is a real answer ("nothing this month"), which is why the lookup
 * is `!= null` rather than truthiness: falling through to the schedule there
 * would quietly overrule the one case where saying zero matters.
 */
export function plannedForCycle(debt, cycle) {
  if (!cycle) return 0;
  // Ticked off for this cycle. Outranks both the box and the schedule — see
  // isDebtSkippedInCycle. Deliberately NOT applied to `scheduledForCycle`,
  // which keeps answering "what the plan wanted": a row that is ticked off
  // should still be able to say what it would have cost.
  if (isDebtSkippedInCycle(debt, cycle)) return 0;
  const chosen = debt?.plan?.[cycle.start];
  if (chosen != null) return num(chosen);
  return scheduledForCycle(debt, cycle);
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

/**
 * Set what you intend to repay on this debt this cycle.
 *
 * An EMPTY value (null, undefined, '') clears the decision — for a scheduled
 * debt that means "go back to following the instalment table", which is the
 * only way back once you have typed over it. A number is stored as typed,
 * **including 0**: "I am not paying this one this month" is a decision, and the
 * old rule (0 deletes the key) made it unsayable for a fixed debt, since the
 * schedule would immediately reclaim the row.
 */
export function setCyclePlan(debts, debtId, cycleStart, amount) {
  const cleared = amount == null || amount === '';
  const value = num(amount);
  return debts.map(d => {
    if (String(d.id) !== String(debtId)) return d;
    const plan = { ...(d.plan ?? {}) };
    if (cleared) delete plan[cycleStart];
    else plan[cycleStart] = Math.max(0, value);
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
      // What the instalment table wanted, and whether the figure above is the
      // user's own answer or just that table showing through. The screen prints
      // both — a suggestion that disappears the moment you override it leaves
      // you with no way to check what you overrode.
      suggested: scheduledForCycle(debt, cycle),
      chosen: hasCyclePlan(debt, cycle),
      repaid,
      reserved: Math.max(planned, repaid),
      remainingThisCycle: Math.max(0, Math.min(outstanding, planned - repaid)),
      outstanding,
      original,
      // Null rather than 0 when there is nothing to measure against, so the UI
      // can leave the bar out instead of drawing a permanently empty one.
      progressPct: original > 0 ? Math.min(100, ((original - outstanding) / original) * 100) : null,
      settled: outstanding <= 0,
      // Ticked off for this cycle. `planned` is already 0 because of it — this
      // flag exists so the row can say WHY it is 0 rather than looking like a
      // debt nobody got round to planning.
      skipped: isDebtSkippedInCycle(debt, cycle),
    };
  });
}

/**
 * The instalment this cycle actually wants, if any — the row's real due date.
 *
 * `nextInstalment` (networth.js) answers a different question: the next unpaid
 * one, ever. Putting that on a calendar headed 本期扣款日 is how a December
 * instalment ended up printed under 「这个月」 — true about the debt, false
 * about the month, and the reader has no way to tell which they are looking at.
 */
export function instalmentDueInCycle(debt, cycle) {
  if (!cycle || !isFixedDebt(debt)) return null;
  return debt.schedule
    .filter(i => !i.paid && isInCycle(String(i.due), cycle))
    .sort((a, b) => String(a.due).localeCompare(String(b.due)))[0] ?? null;
}

// --- growing a debt ---------------------------------------------------------
//
// SPayLater does not hold still. A new Shopee purchase lands on the same plan
// and the instalment goes from RM200 to RM250 — the user's words: 「我的
// spaylater会增加就是200变成250就是很麻烦，就是很难更改原本的」.
//
// Everything the app offered was "describe the whole plan again": the generator
// rebuilds the unpaid tail from scratch, and the per-row editor makes you find
// the row and do the addition yourself. Both are the wrong shape for what
// actually happened, which is that a KNOWN EXTRA AMOUNT joined an existing
// plan. So this takes the extra and asks only where to put it.

/** Where an added amount lands on an existing plan. */
export const ADD_MODES = [
  { value: 'next', label: '加到下一期', hint: '下一期那笔变大，其他不动' },
  { value: 'even', label: '平均分到剩下每一期', hint: '每期都变大一点点' },
  { value: 'append', label: '加在最后，多几期', hint: '现有的都不动，后面接上去' },
];

/**
 * Add money to a debt that got bigger.
 *
 * A debt with no schedule just owes more, and that is the whole operation.
 * A scheduled one has three honest answers and no way to guess between them,
 * so `mode` is asked rather than assumed.
 *
 * Paid instalments are never touched, in any mode — 'even' spreads across the
 * UNPAID ones only. Rewriting a settled row would make `debtOutstanding` jump
 * by money that has already left.
 *
 * @param {Array}  debts
 * @param {any}    debtId
 * @param {object} spec
 * @param {number} spec.amount     how much bigger the debt got
 * @param {string} spec.mode       one of ADD_MODES
 * @param {number} spec.count      'append' only: over how many new instalments
 * @param {string} spec.frequency  'append' only: how far apart they fall
 */
export function addToDebt(debts = [], debtId, { amount, mode = 'next', count = 1, frequency = 'monthly' } = {}) {
  const extra = num(amount);
  if (!(extra > 0)) return debts;

  return debts.map(d => {
    if (String(d.id) !== String(debtId)) return d;

    if (!isFixedDebt(d)) return { ...d, amount: num(d.amount) + extra };

    const unpaid = d.schedule.filter(i => !i.paid);

    if (mode === 'append' || unpaid.length === 0) {
      // After the last instalment there is, paid ones included — appending
      // before a row that already exists would silently reorder the plan.
      const last = [...d.schedule].sort((a, b) => String(a.due).localeCompare(String(b.due))).pop();
      const n = Math.max(1, Math.floor(num(count)) || 1);
      const step = frequency === 'weekly' ? 7 : frequency === 'biweekly' ? 14 : 0;
      const [ly, lm, ld] = String(last?.due ?? '').split('-').map(Number);
      const base = Number.isFinite(ly) ? new Date(ly, lm - 1, ld) : new Date();
      const firstDue = step > 0
        ? new Date(base.getFullYear(), base.getMonth(), base.getDate() + step)
        : new Date(base.getFullYear(), base.getMonth() + 1, base.getDate());
      const per = Math.round((extra / n) * 100) / 100;
      const amounts = Array(n).fill(per);
      // The rounding remainder rides on the last row, so the plan still totals
      // exactly what was added — the same rule buildInstalments uses.
      amounts[n - 1] = Math.round((extra - per * (n - 1)) * 100) / 100;
      const firstDueStr = `${firstDue.getFullYear()}-${String(firstDue.getMonth() + 1).padStart(2, '0')}-${String(firstDue.getDate()).padStart(2, '0')}`;
      return {
        ...d,
        schedule: [...d.schedule, ...buildSchedule(firstDueStr, amounts, n, frequency)]
          .sort((a, b) => String(a.due).localeCompare(String(b.due))),
      };
    }

    if (mode === 'even') {
      const per = Math.round((extra / unpaid.length) * 100) / 100;
      let spent = 0;
      let seen = 0;
      return {
        ...d,
        schedule: d.schedule.map(i => {
          if (i.paid) return i;
          seen += 1;
          const share = seen === unpaid.length
            ? Math.round((extra - spent) * 100) / 100
            : per;
          spent += share;
          return { ...i, amount: Math.round((num(i.amount) + share) * 100) / 100 };
        }),
      };
    }

    // 'next' — the RM200-becomes-RM250 case, said the way it happened.
    const target = [...unpaid].sort((a, b) => String(a.due).localeCompare(String(b.due)))[0];
    return {
      ...d,
      schedule: d.schedule.map(i => (i.due === target.due && !i.paid
        ? { ...i, amount: Math.round((num(i.amount) + extra) * 100) / 100 }
        : i)),
    };
  });
}

// --- the months ahead -------------------------------------------------------
//
// Every debt screen in the app answered a question about NOW: what is owed in
// total, what this cycle wants. Neither says whether November is survivable,
// which is the question an instalment plan exists to raise — 「我也希望可以看到
// 后几个月的欠款，给我单独看欠款，每个月要还多少」.

/**
 * What each of the next `months` cycles has to pay, debt by debt.
 *
 * Only SCHEDULED debts can appear in a future month, and that is the honest
 * answer rather than a gap: a flexible debt has no monthly figure until the
 * month arrives and you decide one (see the header). Inventing one would put a
 * commitment on the calendar that nobody made — the exact thing the repayment
 * waterfall was removed for.
 *
 * The CURRENT cycle is different, because there a decision may already exist:
 * its rows are what is actually reserved (`plannedForCycle`), so the first
 * month of this table and the 这个月还债 screen cannot disagree.
 *
 * @param {Array} debts
 * @param {Array} expenses    for "already repaid this cycle"
 * @param {object} cycle      the current cycle, from getCycle()
 * @param {number} months     how far ahead, including the current cycle
 * @param {function} cycleAt  (date) => cycle. Injected so this stays pure and
 *                            testable, and so cycle.js's start-day rule is
 *                            never re-implemented here by hand.
 */
export function repaymentOutlook(debts = [], expenses = [], cycle, months = 12, cycleAt) {
  if (!cycle || typeof cycleAt !== 'function') return [];
  const out = [];

  for (let m = 0; m < Math.max(1, months); m += 1) {
    // Mid-month, so a cycle that starts on the 1st is unambiguous and a
    // month-end date can never roll into the following one.
    const probe = new Date(cycle.startDate.getFullYear(), cycle.startDate.getMonth() + m, 15);
    const c = cycleAt(probe);
    const current = c.start === cycle.start;

    const rows = [];
    for (const debt of debts) {
      if (isDebtSkippedInCycle(debt, c)) continue;

      if (current) {
        const planned = plannedForCycle(debt, c);
        const repaid = repaidInCycle(debt, expenses, c);
        const amount = Math.max(planned, repaid);
        if (amount <= 0) continue;
        rows.push({
          debtId: debt.id,
          creditor: debt.creditor ?? '欠款',
          amount,
          due: instalmentDueInCycle(debt, c)?.due ?? null,
          fixed: isFixedDebt(debt),
          repaid,
          done: repaid >= amount - 0.005,
        });
        continue;
      }

      if (!isFixedDebt(debt)) continue;
      const dueRows = debt.schedule.filter(i => !i.paid && isInCycle(String(i.due), c));
      for (const i of dueRows) {
        rows.push({
          debtId: debt.id,
          creditor: debt.creditor ?? '欠款',
          amount: num(i.amount),
          due: i.due,
          fixed: true,
          repaid: 0,
          done: false,
        });
      }
    }

    rows.sort((a, b) => String(a.due ?? '9999').localeCompare(String(b.due ?? '9999')));
    out.push({
      start: c.start,
      end: c.end,
      year: c.startDate.getFullYear(),
      month: c.startDate.getMonth() + 1,
      current,
      rows,
      total: sumBy(rows, r => r.amount),
    });
  }

  return out;
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
