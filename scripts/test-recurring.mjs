// Recurring bills: due dates, frequencies other than monthly, and the two
// honest ways an annual cost can be charged to a cycle.

import {
  normalizeAllocation, dueDatesBetween, nextDueDate, daysUntilDue,
  cycleCost, upcoming, totalBudgeted, totalCharged, chargedByAccount,
  occurrencesPerYear,
} from '../src/utils/recurring.js';
import { getCycle } from '../src/utils/cycle.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const r2 = n => Number(n.toFixed(2));

// The cycle containing 20 Aug 2026 — payday is the 10th, so 10 Aug → 10 Sep.
const cycle = getCycle(new Date(2026, 7, 20));
check('cycle runs payday to payday', [cycle.start, cycle.end], ['2026-08-10', '2026-09-10']);

// --- defaults --------------------------------------------------------------
const legacy = normalizeAllocation({ id: 1, label: 'Rent', amount: 500 });
check('a pre-frequency bill is monthly', legacy.frequency, 'monthly');
check('and defaults to payday, where the old model implicitly put it', legacy.dueDay, 10);
check('monthly bills are charged when due, not spread', legacy.costing, 'due');
check('a yearly bill defaults to being spread',
  normalizeAllocation({ id: 2, label: 'Insurance', frequency: 'yearly' }).costing, 'spread');

// --- monthly on a chosen day ----------------------------------------------
const rent = { id: 1, label: 'Rent', amount: 500, frequency: 'monthly', dueDay: 15, accountId: 'mb' };
check('rent falls once in the cycle, on the 15th',
  dueDatesBetween(rent, cycle.start, cycle.end), ['2026-08-15']);
check('next due from the 20th is next month',
  nextDueDate(rent, '2026-08-20'), '2026-09-15');
check('days until due', daysUntilDue(rent, '2026-08-20'), 26);

// A bill due on the 5th belongs to the cycle that started on the 10th of the
// PREVIOUS month — i.e. it lands near the end of the cycle, not the start.
const early = { id: 2, label: 'Netflix', amount: 45, frequency: 'monthly', dueDay: 5 };
check('a bill due on the 5th lands in September, inside this cycle',
  dueDatesBetween(early, cycle.start, cycle.end), ['2026-09-05']);

// --- the 31st problem ------------------------------------------------------
// "The 31st" must clamp to the last real day, never roll into the next month
// — rolling is how a bill silently jumps cycles four times a year.
const lastDay = { id: 3, label: 'Loan', amount: 100, frequency: 'monthly', dueDay: 31 };
check('31 Feb clamps to 28 Feb 2027',
  dueDatesBetween(lastDay, '2027-02-01', '2027-03-01'), ['2027-02-28']);
check('31 Apr clamps to 30 Apr',
  dueDatesBetween(lastDay, '2026-04-01', '2026-05-01'), ['2026-04-30']);
check('31 Jan stays the 31st',
  dueDatesBetween(lastDay, '2027-01-01', '2027-02-01'), ['2027-01-31']);

// --- weekly hits several times in one cycle -------------------------------
// The old flat-amount model counted a RM30/week cost as RM30 a month.
const weekly = { id: 4, label: '每周补习', amount: 30, frequency: 'weekly', dueDay: 1 }; // Mondays
const weeklyDates = dueDatesBetween(weekly, cycle.start, cycle.end);
check('a weekly bill lands 4-5 times in one cycle', weeklyDates.length, 5);
check('every one of them is a Monday',
  weeklyDates.every(d => new Date(...d.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v)))).getDay() === 1), true);
check('a weekly RM30 really costs RM150 this cycle', r2(cycleCost(weekly, cycle).charged), 150);

// --- yearly ----------------------------------------------------------------
const roadTax = {
  id: 5, label: '路税 + 保险', amount: 1200, frequency: 'yearly',
  dueDay: 20, dueMonth: 3, costing: 'due', accountId: 'mb',
};
check('a yearly bill anchored to March does not land in an August cycle',
  dueDatesBetween(roadTax, cycle.start, cycle.end), []);
check('it lands next March', nextDueDate(roadTax, '2026-08-20'), '2027-03-20');
check("costing 'due' charges nothing to a cycle it misses", r2(cycleCost(roadTax, cycle).charged), 0);
check("and budgets nothing either", r2(cycleCost(roadTax, cycle).budgeted), 0);

const marchCycle = getCycle(new Date(2027, 2, 25)); // 10 Mar → 10 Apr 2027
check("'due' dumps the whole RM1200 on the cycle it lands in",
  r2(cycleCost(roadTax, marchCycle).charged), 1200);

// The same bill, set aside monthly instead — the firewall-friendly default.
const spread = { ...roadTax, costing: 'spread' };
check("'spread' still charges RM0 to a cycle it misses",
  r2(cycleCost(spread, cycle).charged), 0);
check("but reserves RM100 every cycle", r2(cycleCost(spread, cycle).budgeted), 100);
check("including the cycle it lands in (the reserve is what pays it)",
  r2(cycleCost(spread, marchCycle).budgeted), 100);
check("while still showing RM1200 actually leaving that month",
  r2(cycleCost(spread, marchCycle).charged), 1200);

// --- quarterly phases off its anchor month --------------------------------
const quarterly = { id: 6, label: 'Water', amount: 90, frequency: 'quarterly', dueDay: 12, dueMonth: 2 };
check('quarterly anchored to Feb recurs Feb/May/Aug/Nov',
  dueDatesBetween(quarterly, '2026-01-01', '2027-01-01'),
  ['2026-02-12', '2026-05-12', '2026-08-12', '2026-11-12']);
check('four times a year', occurrencesPerYear('quarterly'), 4);
check('spread quarterly reserves a third of the bill each cycle',
  r2(cycleCost({ ...quarterly, costing: 'spread' }, cycle).budgeted), 30);

// --- one-off ---------------------------------------------------------------
const once = { id: 7, label: '换轮胎', amount: 600, frequency: 'once', onceDate: '2026-08-22' };
check('a one-off lands exactly once', dueDatesBetween(once, cycle.start, cycle.end), ['2026-08-22']);
check('and never again', dueDatesBetween(once, '2026-09-10', '2027-09-10'), []);
check('a one-off is never spread', normalizeAllocation(once).costing, 'due');

// --- start / end dates -----------------------------------------------------
const cancelled = { id: 8, label: 'Spotify', amount: 16, frequency: 'monthly', dueDay: 12, endDate: '2026-08-01' };
check('a cancelled subscription stops charging',
  dueDatesBetween(cancelled, cycle.start, cycle.end), []);
const notYet = { id: 9, label: 'New gym', amount: 120, frequency: 'monthly', dueDay: 12, startDate: '2026-09-01' };
check('a bill that has not started yet charges nothing',
  dueDatesBetween(notYet, cycle.start, cycle.end), []);

// --- variable bills still work --------------------------------------------
const utilities = {
  id: 10, label: '水电', variable: true, estimate: 250, frequency: 'monthly', dueDay: 18,
  actuals: { '2026-08-10': 312.40 },
};
check('a confirmed real bill beats the estimate', r2(cycleCost(utilities, cycle).charged), 312.40);
check('an unconfirmed cycle falls back to the estimate',
  r2(cycleCost(utilities, getCycle(new Date(2026, 8, 20))).charged), 250);

// --- totals and the upcoming strip ----------------------------------------
const all = [rent, early, weekly, spread, once, utilities];
check('budgeted total folds the spread reserve in',
  r2(totalBudgeted(all, cycle)), r2(500 + 45 + 150 + 100 + 600 + 312.40));
check('charged total is only what actually leaves this cycle',
  r2(totalCharged(all, cycle)), r2(500 + 45 + 150 + 0 + 600 + 312.40));

const soon = upcoming(all, cycle, { extra: [{ id: 'debt:1', label: 'SPayLater 分期', amount: 20.73, due: '2026-08-10', kind: 'debt' }] });
check('upcoming is sorted by date, debts folded in', soon.slice(0, 4).map(u => u.due),
  ['2026-08-10', '2026-08-10', '2026-08-15', '2026-08-17']);
check('the debt instalment appears alongside the bills',
  soon.some(u => u.kind === 'debt'), true);
check('every upcoming row knows its account',
  soon.find(u => u.label === 'Rent').accountId, 'mb');

const byAccount = chargedByAccount(all, cycle);
check('rent charges Maybank', r2(byAccount.get('mb')), 500);
check('bills with no account are flagged, not silently dropped',
  byAccount.has('__unassigned'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
