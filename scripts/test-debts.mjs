// Debt repayment: the two kinds of debt, and the double-counting trap.
//
// The rule that most of this file exists to protect, in the user's words:
// "月头就先拿一笔钱还这个月的,然后再让我这个月的今天还能花多少变少,是每一天花的钱变少".
// A repayment is reserved up front and spread across the cycle, so it must
// NEVER also be charged as spending on the day it leaves — that would subtract
// the same money twice, and in the direction that makes paying off debt look
// like overspending.

import {
  isFixedDebt, isRepayment, repaidTotal, repaidInCycle, statedRemaining,
  outstandingFor, originalTotal, plannedForCycle, reservedForCycle,
  setCyclePlan, makeRepayment, debtsForCycle, totalReservedForCycle,
  totalRepaidInCycle, REPAYMENT_CATEGORY,
  buildSchedule, buildInstalments, rebuildSchedule, setInstalmentAmount,
  removeInstalment, scheduleSummary, commitmentOf,
} from '../src/utils/debts.js';
import { getCycle, computeCycleBudget, grossSpentByDayIndex } from '../src/utils/cycle.js';
import { debtOutstanding, computeNetPosition } from '../src/utils/networth.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const near = (name, got, want, tol = 0.005) => {
  const ok = Math.abs(got - want) <= tol;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${got}\n      want ${want}`);
};

const sumOf = (rows) => rows.reduce((t, i) => t + i.amount, 0);

// 20 Aug 2026 sits inside the cycle that opened on the 10th.
const cycle = getCycle(new Date(2026, 7, 20));
check('the cycle under test runs 10 Aug -> 10 Sep', [cycle.start, cycle.end], ['2026-08-10', '2026-09-10']);

// The user's real debt, trimmed to the first three instalments.
const spaylater = {
  id: 1, creditor: 'SPayLater', note: '分期付款',
  schedule: [
    { due: '2026-08-15', amount: 299.30, paid: false },
    { due: '2026-09-15', amount: 246.06, paid: false },
    { due: '2026-10-15', amount: 246.08, paid: false },
  ],
};
// The other kind: money owed to a person, no schedule, no monthly figure.
const ahMeng = { id: 2, creditor: '阿明', amount: 500, note: '上次借的' };

const repayment = (debtId, amount, date, id = Math.random()) =>
  ({ id, date, amount, repaysDebtId: debtId, category: REPAYMENT_CATEGORY, merchant: 'x' });

// --- which kind is it -------------------------------------------------------
check('a debt with a schedule is fixed', isFixedDebt(spaylater), true);
check('a debt with only an amount is flexible', isFixedDebt(ahMeng), false);
check('an empty schedule is not a fixed debt', isFixedDebt({ id: 3, schedule: [] }), false);

// --- flexible: you decide the amount, per cycle ------------------------------
check('a flexible debt asks for nothing until you decide', plannedForCycle(ahMeng, cycle), 0);

const planned200 = setCyclePlan([ahMeng], 2, cycle.start, 200)[0];
check('deciding RM200 for this cycle', plannedForCycle(planned200, cycle), 200);

// The whole reason `plan` is keyed by cycle rather than being one field.
const nextCycle = getCycle(new Date(2026, 8, 20));
check('this cycle\'s decision says nothing about next cycle',
  plannedForCycle(planned200, nextCycle), 0);

const cleared = setCyclePlan([planned200], 2, cycle.start, 0)[0];
check('setting 0 clears the plan rather than storing a zero',
  Object.keys(cleared.plan ?? {}).length, 0);

// --- fixed: the amount is decided for you -----------------------------------
near('a fixed debt takes the instalment falling inside the cycle',
  plannedForCycle(spaylater, cycle), 299.30);
near('an instalment dated after the cycle ends is not this cycle\'s problem',
  plannedForCycle(spaylater, nextCycle), 246.06);
check('an instalment already ticked paid stops being planned',
  plannedForCycle({ ...spaylater, schedule: spaylater.schedule.map(i => ({ ...i, paid: true })) }, cycle), 0);

// --- repayments reduce what is owed -----------------------------------------
const paid200 = [repayment(2, 200, '2026-08-12')];
check('stated remaining ignores repayments', statedRemaining(ahMeng), 500);
check('outstanding subtracts them', outstandingFor(ahMeng, paid200), 300);
check('repaid this cycle', repaidInCycle(ahMeng, paid200, cycle), 200);
check('a repayment made in a previous cycle is not this cycle\'s',
  repaidInCycle(ahMeng, [repayment(2, 200, '2026-07-12')], cycle), 0);
check('...but it still counts against the total owed',
  outstandingFor(ahMeng, [repayment(2, 200, '2026-07-12')]), 300);

check('overpaying clears the debt and never goes negative',
  outstandingFor(ahMeng, [repayment(2, 800, '2026-08-12')]), 0);

check('repayments against another debt are not counted here',
  outstandingFor(ahMeng, [repayment(1, 200, '2026-08-12')]), 500);
check('an id stored as a string still matches',
  outstandingFor(ahMeng, [repayment('2', 200, '2026-08-12')]), 300);

// Paying early is the only control a fixed debt gives you, so it has to work.
near('clearing SPayLater early drops the outstanding below the schedule',
  outstandingFor(spaylater, [repayment(1, 500, '2026-08-12')]), 291.44);
near('the original total is the whole schedule, for a progress bar',
  originalTotal(spaylater), 791.44);

// --- the reservation --------------------------------------------------------
check('nothing planned, nothing paid -> nothing held back',
  reservedForCycle(ahMeng, [], cycle), 0);
check('planned but not yet paid -> still held back (it is still owed)',
  reservedForCycle(planned200, [], cycle), 200);
check('planned AND paid -> held back ONCE, not twice',
  reservedForCycle(planned200, paid200, cycle), 200);
check('paying more than planned holds back what actually left',
  reservedForCycle(planned200, [repayment(2, 350, '2026-08-12')], cycle), 350);
near('paying a fixed debt off early holds back the real figure, not the instalment',
  reservedForCycle(spaylater, [repayment(1, 700, '2026-08-12')], cycle), 700);

check('totals across every debt',
  totalReservedForCycle([planned200, spaylater], paid200, cycle), 499.3);
check('total repaid this cycle', totalRepaidInCycle([planned200, spaylater], paid200, cycle), 200);

// --- the per-cycle summary the UI reads -------------------------------------
const [flexRow] = debtsForCycle([planned200], paid200, cycle);
check('summary: flexible debt half paid this cycle',
  [flexRow.planned, flexRow.repaid, flexRow.remainingThisCycle, flexRow.outstanding, flexRow.settled],
  [200, 200, 0, 300, false]);
const [partRow] = debtsForCycle([planned200], [repayment(2, 50, '2026-08-12')], cycle);
check('summary: RM150 of this cycle\'s plan still to pay',
  [partRow.planned, partRow.repaid, partRow.remainingThisCycle], [200, 50, 150]);
const [doneRow] = debtsForCycle([ahMeng], [repayment(2, 500, '2026-08-12')], cycle);
check('summary: fully repaid reads as settled', [doneRow.outstanding, doneRow.settled], [0, true]);
check('a flat debt now has a real progress figure (it had none before repayments existed)',
  partRow.progressPct, 10);

// --- THE DOUBLE-COUNT: the point of all of this ------------------------------
//
// RM3000 income, RM200 reserved for the debt, and the RM200 actually paid. The
// budget must be 2800, not 2600.
const allocations = [{ id: 'debt:2', label: '阿明', budgeted: 200 }];
const budget = computeCycleBudget({
  incomeSources: [{ id: 'i', label: 'pay', amount: 3000, kind: 'income' }],
  allocations,
  expenses: [repayment(2, 200, '2026-08-12')],
  cycle,
});
check('a repayment is not charged as spending — it was already reserved',
  budget.spentThisCycle, 0);
check('available = income - reserved, with the payment counted once', budget.available, 2800);
check('and it is reported separately as money repaid', budget.repaidThisCycle, 200);
check('a repayment is not daily spending either', budget.grossSpentThisCycle, 0);

// The comparison against last cycle has to agree, or clearing a debt reads as
// a blowout month.
check('the vs-last-cycle figure excludes repayments too',
  grossSpentByDayIndex([repayment(2, 200, '2026-08-12')], cycle, 30), 0);

// An ordinary expense on the same day still counts, so the exclusion is not
// simply "nothing counts any more".
const mixed = computeCycleBudget({
  incomeSources: [{ id: 'i', label: 'pay', amount: 3000, kind: 'income' }],
  allocations,
  expenses: [repayment(2, 200, '2026-08-12'), { id: 9, date: '2026-08-12', amount: 45, merchant: 'lunch' }],
  cycle,
});
check('normal spending on the same day is unaffected', mixed.spentThisCycle, 45);
check('available drops by the lunch only', mixed.available, 2755);

// --- net position -----------------------------------------------------------
const accounts = [{ id: 'tng', name: 'TNG', balance: 1000, target: null, kind: 'own' }];
check('net position counts a debt at its stated size when no ledger is given',
  computeNetPosition(accounts, [ahMeng]).totalOwed, 500);
check('and at what is actually left once repayments are known',
  computeNetPosition(accounts, [ahMeng], paid200).totalOwed, 300);
check('debtOutstanding agrees with it', debtOutstanding(ahMeng, paid200), 300);

// --- building a repayment record --------------------------------------------
const rec = makeRepayment({
  debt: ahMeng, amount: 120, accountId: 'tng', accountName: 'TNG eWallet',
  note: '还一点', at: new Date(2026, 7, 12, 15, 30).getTime(),
});
check('a repayment is an ordinary expense carrying repaysDebtId',
  [rec.merchant, rec.amount, rec.category, rec.repaysDebtId, rec.date, rec.accountId],
  ['阿明', 120, REPAYMENT_CATEGORY, 2, '2026-08-12', 'tng']);
check('and is recognised as one', isRepayment(rec), true);
check('an ordinary expense is not', isRepayment({ id: 1, amount: 10 }), false);

// Two repayments in the same millisecond must not share an id — every id-keyed
// operation in the app, cloud sync included, would treat them as one record.
const at = Date.now();
const a = makeRepayment({ debt: ahMeng, amount: 10, at });
const b = makeRepayment({ debt: spaylater, amount: 10, at });
check('two repayments made in the same millisecond get different ids', a.id === b.id, false);

// --- one bad row must not poison a total ------------------------------------
check('a repayment with a missing amount costs one row, not the whole figure',
  repaidTotal(ahMeng, [repayment(2, 100, '2026-08-12'), { id: 7, repaysDebtId: 2, amount: undefined }]),
  100);
check('a debt with no amount at all reads as zero, not NaN', outstandingFor({ id: 5 }, []), 0);
check('debts undefined everywhere is still a number', totalReservedForCycle(undefined, undefined, cycle), 0);

// --- building an instalment plan from the form -------------------------------
// Until this existed the app could READ a schedule perfectly and could not
// create one, so every debt added by hand became a flat lump sum. See debts.js.

const plan3 = buildInstalments({ firstDue: '2026-09-10', count: 3, amount: 100 });
check('the plan has one row per instalment', plan3.length, 3);
check('...stepping one month at a time from the first due date',
  plan3.map(i => i.due), ['2026-09-10', '2026-10-10', '2026-11-10']);
check('...none of them starts out paid', plan3.every(i => i.paid === false), true);

// A plan almost never divides evenly. Letting the last row carry the remainder
// is how the real ones work and keeps the schedule total equal to what is owed.
const uneven = buildInstalments({ firstDue: '2026-09-10', count: 3, amount: 100, finalAmount: 88.5 });
check('the final instalment can carry the remainder', uneven.map(i => i.amount), [100, 100, 88.5]);
near('...so the schedule totals what is actually owed', sumOf(uneven), 288.5);

check('weekly steps 7 days, not a month',
  buildInstalments({ firstDue: '2026-09-10', count: 3, amount: 10, frequency: 'weekly' }).map(i => i.due),
  ['2026-09-10', '2026-09-17', '2026-09-24']);
check('fortnightly steps 14',
  buildInstalments({ firstDue: '2026-09-10', count: 3, amount: 10, frequency: 'biweekly' }).map(i => i.due),
  ['2026-09-10', '2026-09-24', '2026-10-08']);

// The 31st does not exist in four months of the year. Rolling over instead of
// clamping moves those instalments into a cycle they do not belong to — the
// same trap recurring.js documents for bills.
check('a plan starting on the 31st clamps to the last real day, never rolls over',
  buildInstalments({ firstDue: '2026-01-31', count: 4, amount: 10 }).map(i => i.due),
  ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);

check('nothing is generated from an empty form', buildInstalments({}), []);
check('...or from zero instalments',
  buildInstalments({ firstDue: '2026-09-10', count: 0, amount: 100 }), []);
check('...or from a zero amount',
  buildInstalments({ firstDue: '2026-09-10', count: 3, amount: 0 }), []);

// --- editing a plan that is already part-paid --------------------------------
const partPaid = {
  id: 20, creditor: 'SPayLater',
  schedule: [
    { due: '2026-07-10', amount: 365.70, paid: true },
    { due: '2026-08-10', amount: 262.66, paid: true },
    { due: '2026-09-10', amount: 262.68, paid: false },
  ],
};
const rebuilt = rebuildSchedule(partPaid, { firstDue: '2026-09-10', count: 2, amount: 300 });
check('rebuilding keeps every instalment already paid',
  rebuilt.filter(i => i.paid).map(i => i.due), ['2026-07-10', '2026-08-10']);
check('...and replaces only the unpaid tail',
  rebuilt.filter(i => !i.paid).map(i => [i.due, i.amount]),
  [['2026-09-10', 300], ['2026-10-10', 300]]);
check('...leaving the whole list in date order',
  rebuilt.map(i => i.due).join() === [...rebuilt.map(i => i.due)].sort().join(), true);
// The point of keeping them: outstanding must not jump back up by their value.
near('rebuilding does not resurrect paid instalments as debt',
  statedRemaining({ ...partPaid, schedule: rebuilt }), 600);

// A real plan is not uniform — this user's is 365.70 / 262.66 / 262.68 / then
// 20.73 eighteen times. Generating is the starting point, not the answer.
const edited = setInstalmentAmount([partPaid], 20, '2026-09-10', 20.73);
near('one instalment can be corrected without touching the rest',
  statedRemaining(edited[0]), 20.73);
check('...and the paid ones are left exactly as they were',
  edited[0].schedule.filter(i => i.paid).map(i => i.amount), [365.70, 262.66]);
check('editing an instalment on a debt with no schedule is a no-op, not a crash',
  setInstalmentAmount([ahMeng], 2, '2026-09-10', 50)[0], ahMeng);

const shortened = removeInstalment([partPaid], 20, '2026-09-10');
check('an instalment can be dropped entirely', shortened[0].schedule.length, 2);
near('...and stops being owed', statedRemaining(shortened[0]), 0);

// --- what the form and the debt card both print ------------------------------
const summary = scheduleSummary(partPaid);
check('the summary counts paid and remaining separately',
  [summary.count, summary.paidCount, summary.remainingCount], [3, 2, 1]);
near('...totals the whole plan', summary.total, 891.04);
near('...and separately what is still owed on it', summary.remainingTotal, 262.68);
check('...and names the next instalment', summary.next.due, '2026-09-10');
check('a debt with no schedule has no summary at all', scheduleSummary(ahMeng), null);

check('a scheduled debt is not a matter of choice', commitmentOf(partPaid), 'scheduled');
check('a flat debt is', commitmentOf(ahMeng), 'flexible');

// buildSchedule stays the primitive underneath, taking explicit amounts.
check('the primitive still accepts a list of amounts',
  buildSchedule('2026-09-10', [1, 2, 3]).map(i => i.amount), [1, 2, 3]);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
