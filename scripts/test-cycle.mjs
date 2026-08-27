import {
  getCycle, isInCycle, computeCycleBudget, projectImpact,
  resolveAllocationAmount, isEstimated, getPreviousCycle, grossSpentByDayIndex,
} from '../src/utils/cycle.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const on = (y, m, d) => new Date(y, m - 1, d);

// --- which cycle are we in -------------------------------------------------
check('payday itself starts a new cycle',
  getCycle(on(2026, 8, 10)).start, '2026-08-10');
check('payday is day 0',
  getCycle(on(2026, 8, 10)).dayIndex, 0);
check('the day after payday is still this cycle',
  getCycle(on(2026, 8, 11)).start, '2026-08-10');

// The one that would silently reset the budget nine days early every month.
check('before the 10th belongs to LAST month\'s payday',
  getCycle(on(2026, 8, 9)).start, '2026-07-10');
check('  ...and ends on this month\'s payday',
  getCycle(on(2026, 8, 9)).end, '2026-08-10');

// --- boundaries ------------------------------------------------------------
check('year rollover: 5 Jan belongs to 10 Dec',
  getCycle(on(2027, 1, 5)).start, '2026-12-10');
check('year rollover end',
  getCycle(on(2027, 1, 5)).end, '2027-01-10');
check('Feb is short: 10 Feb -> 10 Mar is 28 days (2026)',
  getCycle(on(2026, 2, 10)).totalDays, 28);
check('leap year: 10 Feb 2028 -> 10 Mar is 29 days',
  getCycle(on(2028, 2, 10)).totalDays, 29);
check('31-day cycle',
  getCycle(on(2026, 8, 10)).totalDays, 31);

// --- days remaining includes today ----------------------------------------
check('on payday the whole cycle remains',
  getCycle(on(2026, 8, 10)).daysRemaining, 31);
check('day before next payday leaves 1 day',
  getCycle(on(2026, 9, 9)).daysRemaining, 1);
check('never returns 0 days (would divide by zero)',
  getCycle(on(2026, 9, 9)).daysRemaining > 0, true);

// --- isInCycle: end is exclusive ------------------------------------------
const c = getCycle(on(2026, 8, 15));
check('start is inside', isInCycle('2026-08-10', c), true);
check('mid is inside', isInCycle('2026-08-25', c), true);
check('next payday is NOT inside (exclusive end)', isInCycle('2026-09-10', c), false);
check('day before start is outside', isInCycle('2026-08-09', c), false);

// --- budget maths ----------------------------------------------------------
const cycle = getCycle(on(2026, 8, 10));   // 31 days, day 0
const income = [
  { id: 1, label: 'Internship', amount: 1000, kind: 'income' },
  { id: 2, label: 'Family', amount: 500, kind: 'income' },
  { id: 3, label: "Friends' rent share", amount: 1300, kind: 'passthrough' },
];
const allocations = [
  { id: 1, label: 'SPayLater', amount: 299.3, paid: false },
  { id: 2, label: 'TNB + Time', amount: 250, paid: false },
  { id: 3, label: 'GXBank savings', amount: 400, paid: false },
];

let b = computeCycleBudget({ incomeSources: income, allocations, expenses: [], cycle });
check('passthrough excluded from spendable income', b.spendableIncome, 1500);
check('passthrough still reported', b.passthrough, 1300);
check('committed outgoings summed', b.committed, 949.3);
check('available = spendable - committed', Number(b.available.toFixed(2)), 550.7);
check('daily limit spreads over days remaining',
  Number(b.dailySafeLimit.toFixed(2)), Number((550.7 / 31).toFixed(2)));

// Treating the rent as real income instead
const asIncome = income.map(s => (s.id === 3 ? { ...s, kind: 'income' } : s));
b = computeCycleBudget({ incomeSources: asIncome, allocations, expenses: [], cycle });
check('flagging it as income changes the answer', Number(b.available.toFixed(2)), 1850.7);

// Spending inside vs outside the cycle
b = computeCycleBudget({
  incomeSources: income, allocations, cycle,
  expenses: [
    { date: '2026-08-15', amount: 100 },   // in cycle
    { date: '2026-08-09', amount: 999 },   // previous cycle — must be ignored
    { date: '2026-09-10', amount: 999 },   // next cycle — must be ignored
  ],
});
check('only this cycle\'s spending counts', b.spentThisCycle, 100);
check('available drops by that spend', Number(b.available.toFixed(2)), 450.7);

// A friend paying back their share of a meal you fronted is a reimbursement,
// not new income — modelled as a negative expense so it nets against the
// original spend rather than inflating spendable income (which would count
// the same money twice: once as the original expense, once as "income").
b = computeCycleBudget({
  incomeSources: income, allocations, cycle,
  expenses: [
    { date: '2026-08-15', amount: 100 },    // fronted dinner for the group
    { date: '2026-08-16', amount: -75 },    // friend transferred their share back
  ],
});
check('reimbursement nets against the original spend', Number(b.spentThisCycle.toFixed(2)), 25);
check('available reflects net cost, not gross spend', Number(b.available.toFixed(2)), Number((1500 - 949.3 - 25).toFixed(2)));
check('gross spend is the full RM100, not netted against the refund', b.grossSpentThisCycle, 100);
check('received this cycle is the RM75 refund, as a positive figure', b.receivedThisCycle, 75);

// Overspending must not produce a negative daily allowance
b = computeCycleBudget({
  incomeSources: income, allocations, cycle,
  expenses: [{ date: '2026-08-15', amount: 5000 }],
});
check('overspent flag set', b.overspent, true);
check('daily limit floors at 0, never negative', b.dailySafeLimit, 0);

// --- impulse impact projection --------------------------------------------
b = computeCycleBudget({ incomeSources: income, allocations, expenses: [], cycle });
const impact = projectImpact(b, cycle, 300);
check('impact: available after', Number(impact.availableAfter.toFixed(2)), 250.7);
check('impact: daily drops', impact.dailyAfter < impact.dailyBefore, true);
check('impact: flags going negative', projectImpact(b, cycle, 9999).goesNegative, true);

// --- variable allocations: estimate before the bill, actual after ----------
const tnb = { id: 9, label: 'TNB', variable: true, estimate: 120, actuals: {} };
check('no actual yet -> falls back to estimate',
  resolveAllocationAmount(tnb, cycle), 120);
check('running on the estimate is flagged', isEstimated(tnb, cycle), true);

const tnbConfirmed = { ...tnb, actuals: { [cycle.start]: 143.20 } };
check('actual for this cycle overrides the estimate',
  resolveAllocationAmount(tnbConfirmed, cycle), 143.20);
check('once confirmed, no longer flagged as estimated',
  isEstimated(tnbConfirmed, cycle), false);

// A DIFFERENT cycle's actual must not leak into this one.
const tnbFromLastCycle = { ...tnb, actuals: { '2026-07-10': 98.50 } };
check('an old cycle\'s actual does not apply to this cycle',
  resolveAllocationAmount(tnbFromLastCycle, cycle), 120);
check('this cycle is still estimated even though a past one is confirmed',
  isEstimated(tnbFromLastCycle, cycle), true);

// Fixed allocations are unaffected by any of this.
const fixed = { id: 10, label: 'Rent', amount: 500 };
check('fixed allocation ignores estimate/actual machinery',
  resolveAllocationAmount(fixed, cycle), 500);
check('fixed allocation is never "estimated"', isEstimated(fixed, cycle), false);

// A variable bill flows through computeCycleBudget the same as a fixed one.
b = computeCycleBudget({
  incomeSources: income,
  allocations: [fixed, tnbConfirmed],
  expenses: [],
  cycle,
});
check('variable allocation\'s actual counts toward committed',
  Number(b.committed.toFixed(2)), Number((500 + 143.20).toFixed(2)));

// --- previous cycle / same-day comparison -----------------------------------
check('previous cycle starts a month earlier',
  getPreviousCycle(getCycle(on(2026, 8, 15))).start, '2026-07-10');
check('previous cycle ends where this one starts',
  getPreviousCycle(getCycle(on(2026, 8, 15))).end, '2026-08-10');
check('year rollover: previous cycle of the Dec-10-starting cycle is November',
  getPreviousCycle(getCycle(on(2027, 1, 5))).start, '2026-11-10');

const augCycle = getCycle(on(2026, 8, 14));   // day index 4
const augExpenses = [
  { date: '2026-07-10', amount: 50 },   // prev cycle, day 0 — within cutoff
  { date: '2026-07-14', amount: 30 },   // prev cycle, day 4 — within cutoff (inclusive)
  { date: '2026-07-20', amount: 999 },  // prev cycle, day 10 — past the cutoff, excluded
  { date: '2026-06-30', amount: 999 },  // two cycles back — excluded entirely
];
check('gross spend by day index only counts up to and including that day',
  grossSpentByDayIndex(augExpenses, getPreviousCycle(augCycle), augCycle.dayIndex), 80);

const withRefund = [
  { date: '2026-07-11', amount: 100 },
  { date: '2026-07-11', amount: -40 },   // refund must not reduce (or flip) the gross figure
];
check('gross spend by day index excludes refunds, not nets them',
  grossSpentByDayIndex(withRefund, getPreviousCycle(augCycle), augCycle.dayIndex), 100);

// --- 进账 (isMoneyIn) is budget-neutral ------------------------------------
// An arrival credits an account balance but must not move the cycle budget.
// A refund legitimately nets against `spentThisCycle` because it returns money
// from spending already counted there. An arrival is not that: its budget
// effect is already carried by `incomeSources`, so letting it net would count
// the same ringgit twice and hand back a daily limit that doesn't exist.
const arrival = computeCycleBudget({
  incomeSources: income, allocations, cycle,
  expenses: [
    { date: '2026-08-15', amount: 100 },
    { date: '2026-08-16', amount: -1000, isMoneyIn: true },   // salary landed
  ],
});
const noArrival = computeCycleBudget({
  incomeSources: income, allocations, cycle,
  expenses: [{ date: '2026-08-15', amount: 100 }],
});
check('an arrival does not reduce spend for the cycle',
  Number(arrival.spentThisCycle.toFixed(2)), 100);
check('...so the daily safe limit is identical with and without it',
  Number(arrival.dailySafeLimit.toFixed(4)), Number(noArrival.dailySafeLimit.toFixed(4)));
check('...and it is not reported as money received (that is refunds only)',
  arrival.receivedThisCycle, 0);
check('...nor counted as spending', arrival.grossSpentThisCycle, 100);

// The distinction has to survive the two landing on the same day, since both
// are stored as negative amounts and only the flag separates them.
const both = computeCycleBudget({
  incomeSources: income, allocations, cycle,
  expenses: [
    { date: '2026-08-15', amount: 100 },
    { date: '2026-08-16', amount: -75 },                     // real refund
    { date: '2026-08-16', amount: -1000, isMoneyIn: true },  // arrival
  ],
});
check('a refund still nets while an arrival alongside it does not',
  Number(both.spentThisCycle.toFixed(2)), 25);
check('and only the refund shows as received', both.receivedThisCycle, 75);

// --- spentToday: the same exclusions as the cycle, not a raw sum ------------
//
// `spentToday` feeds `todayRemaining`, which is the number the app puts in
// front of you before you buy something. It used to be a plain sum of every
// record dated today, ignoring both flags the rest of this function is careful
// about — so an allowance arriving today (stored negative, `isMoneyIn`) read as
// negative spending and handed out its full value as extra headroom for the
// day, on top of already being counted as income.
const todayYmd = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const liveCycle = getCycle();

const today = computeCycleBudget({
  incomeSources: [{ id: 1, label: 'Allowance', amount: 1000, kind: 'income' }],
  allocations: [],
  cycle: liveCycle,
  expenses: [
    { date: todayYmd, amount: 30 },                            // real spend
    { date: todayYmd, amount: -1200, isMoneyIn: true },         // allowance landing
    { date: todayYmd, amount: 100, isAccountTransfer: true },   // top-up, out
    { date: todayYmd, amount: -100, isAccountTransfer: true },  // top-up, in
  ],
});
check('an arrival today does not read as negative spending', today.spentToday, 30);
check('...so today\'s remaining is not inflated by it',
  Number((today.dailySafeLimit - today.spentToday).toFixed(2)),
  Number(today.todayRemaining.toFixed(2)));
check('a transfer between your own accounts is not today\'s spending either',
  today.spentToday, 30);

// A past cycle's card must not report today's spending as part of it.
const pastCycle = getPreviousCycle(liveCycle);
const past = computeCycleBudget({
  incomeSources: [], allocations: [], cycle: pastCycle,
  expenses: [{ date: todayYmd, amount: 55 }],
});
check('today\'s spend is not attributed to a past cycle', past.spentToday, 0);

// --- 收入：设定和实际是同一个系统 ---------------------------------------------
// They used to be two: `incomeSources` was a number you typed once and summed
// into every cycle, and 今天记收入 wrote an arrival record deliberately kept out
// of the budget. Logging RM1,000 arriving therefore changed the month's income
// by nothing. `incomeSourceId` joins them — see computeCycleBudget.
const incCycle = getCycle(new Date(2026, 7, 20)); // 10 Aug -> 10 Sep
const sources = [
  { id: 's1', label: '实习薪水', amount: 1000, kind: 'income' },
  { id: 's2', label: '房租代收', amount: 800, kind: 'passthrough' },
];
const incBudget = (expenses) => computeCycleBudget({ incomeSources: sources, allocations: [], expenses, cycle: incCycle });

// Day one of the cycle: nothing has landed, the budget still has to work.
const beforeLanding = incBudget([]);
check('before anything lands, income is what you expect',
  beforeLanding.spendableIncome, 1000);

// The whole point: filing an arrival against its source updates the month.
const landedShort = incBudget([
  { date: '2026-08-12', amount: -800, isMoneyIn: true, incomeSourceId: 's1' },
]);
check('once it lands, the REAL figure replaces the expectation',
  landedShort.spendableIncome, 800);
check('...and the month says the source came up short',
  landedShort.incomeBreakdown.find(i => i.id === 's1').shortfall, 200);

// Math.max would have been the tempting rule and is wrong exactly here: an
// allowance RM200 short must shrink the month, not keep quoting the hope.
check('a short allowance is never rounded back up to what you hoped for',
  landedShort.spendableIncome < 1000, true);

const landedMore = incBudget([
  { date: '2026-08-12', amount: -1200, isMoneyIn: true, incomeSourceId: 's1' },
]);
check('a bigger-than-expected arrival counts in full too',
  landedMore.spendableIncome, 1200);

// Two payments against one source add up rather than the last one winning.
const twoPayments = incBudget([
  { date: '2026-08-12', amount: -600, isMoneyIn: true, incomeSourceId: 's1' },
  { date: '2026-08-20', amount: -400, isMoneyIn: true, incomeSourceId: 's1' },
]);
check('a source paid in instalments totals them', twoPayments.spendableIncome, 1000);

// The reassuring-direction error this must never make: an unfiled arrival may
// well BE the salary already listed, so adding it would count it twice.
const unlinked = incBudget([
  { date: '2026-08-12', amount: -1000, isMoneyIn: true },
]);
check('an arrival filed against nothing does not inflate the budget',
  unlinked.spendableIncome, 1000);
check('...but it is reported, so the gap can be seen and fixed',
  unlinked.arrivedUnlinked, 1000);

// Pass-through stays out of what you can spend, landed or not.
const passLanded = incBudget([
  { date: '2026-08-12', amount: -900, isMoneyIn: true, incomeSourceId: 's2' },
]);
check('a pass-through source is never spendable, however much arrives',
  [passLanded.spendableIncome, passLanded.passthrough], [1000, 900]);

// A transfer's receiving half is stored exactly like an arrival and is not income.
const transferIn = incBudget([
  { date: '2026-08-12', amount: -300, isMoneyIn: true, isAccountTransfer: true, incomeSourceId: 's1' },
]);
check('moving your own money between accounts is not income arriving',
  transferIn.spendableIncome, 1000);

// --- a logged bill payment must not be charged twice --------------------------
// The allocation already reserved the money in `committed` at the top of the
// cycle. Before `allocationId` existed there was no way to say "this payment IS
// my rent", so anyone who logged it lost the amount from their budget twice.
const rent = [{ id: 'a1', label: '房租', amount: 500, frequency: 'monthly', dueDay: 15, budgeted: 500, charged: 500 }];
const unlinkedRent = computeCycleBudget({
  incomeSources: sources, allocations: rent, cycle: incCycle,
  expenses: [{ date: '2026-08-15', amount: 500 }],
});
const linkedRent = computeCycleBudget({
  incomeSources: sources, allocations: rent, cycle: incCycle,
  expenses: [{ date: '2026-08-15', amount: 500, allocationId: 'a1' }],
});
check('an unmarked rent payment is charged on top of the reservation',
  [unlinkedRent.committed, unlinkedRent.spentThisCycle, unlinkedRent.available], [500, 500, 0]);
check('marking it as the bill charges it once, not twice',
  [linkedRent.committed, linkedRent.spentThisCycle, linkedRent.available], [500, 0, 500]);
check('...and it is not counted as discretionary spending either',
  linkedRent.grossSpentThisCycle, 0);
check('...it is reported under its own name instead',
  linkedRent.billPaymentsThisCycle, 500);
check('...and it does not eat the same day twice either',
  linkedRent.spentToday, 0);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
