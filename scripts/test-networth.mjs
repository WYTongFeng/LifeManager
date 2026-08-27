import {
  computeNetPosition, debtOutstanding, nextInstalment,
  instalmentsDueIn, buildSchedule, getWaterfallOrder, toggleInstalmentPaid,
  moveInOrder, monthsToClear, computeSpendable,
} from '../src/utils/networth.js';
import { resolveAccounts } from '../src/utils/accounts.js';
import { getCycle, computeCycleBudget } from '../src/utils/cycle.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const r2 = n => Number(n.toFixed(2));

// --- the real situation ----------------------------------------------------
// PBE is custodial: the money isn't his, and what he's taken out must go back.
const accounts = [
  { id: 1, name: 'PBE', balance: 13331.4, target: 15269, kind: 'custodial' },
  { id: 2, name: 'TNG eWallet', balance: 40.22, target: null, kind: 'own' },
  { id: 3, name: 'GX Bank', balance: 20, target: null, kind: 'own' },
  { id: 4, name: 'HLB', balance: 184.42, target: null, kind: 'own' },
];

// SPayLater: Sep 299.30, Oct 246.06, Nov 246.08, then 18 x 20.73 from Dec.
const spaylater = {
  id: 1,
  creditor: 'SPayLater',
  schedule: [
    ...buildSchedule('2026-09-10', [299.30, 246.06, 246.08]),
    ...buildSchedule('2026-12-10', 20.73, 18),
  ],
};

check('schedule has 21 instalments left', spaylater.schedule.length, 21);
check('last payment is May 2028', spaylater.schedule.at(-1).due, '2028-05-10');
check('SPayLater outstanding', r2(debtOutstanding(spaylater)), 1164.58);
check('next instalment is September', nextInstalment(spaylater).due, '2026-09-10');
check('next instalment amount', nextInstalment(spaylater).amount, 299.30);
check('September total due', instalmentsDueIn([spaylater], '2026-09').map(i => i.amount), [299.30]);
check('December is the small one', instalmentsDueIn([spaylater], '2026-12').map(i => i.amount), [20.73]);

const pos = computeNetPosition(accounts, [spaylater]);

// The whole point: a custodial balance is not an asset.
check('own cash excludes PBE', r2(pos.ownCash), 244.64);
check('PBE reported separately as held', r2(pos.custodialHeld), 13331.4);
check('money taken out of PBE is a debt', r2(pos.custodialShortfall), 1937.60);
check('total owed = SPayLater + PBE shortfall', r2(pos.totalOwed), 3102.18);
check('net position is deeply negative', r2(pos.netPosition), -2857.54);
check('inDebt flag set', pos.inDebt, true);
check('244.64 liquid trips survival mode (< RM300)', pos.inSurvivalMode, true);

// --- survival mode (module 3): keyed on ownCash alone, not netPosition -----
const flush = computeNetPosition(
  [{ id: 1, name: 'TNG', balance: 500, target: null, kind: 'own' }], []
);
check('RM500 own cash, no debts — not in survival mode', flush.inSurvivalMode, false);

check('exactly at the threshold is NOT survival mode (strict <)',
  computeNetPosition([{ id: 1, name: 'TNG', balance: 300, target: null, kind: 'own' }], []).inSurvivalMode,
  false);
check('one cent under the threshold IS survival mode',
  computeNetPosition([{ id: 1, name: 'TNG', balance: 299.99, target: null, kind: 'own' }], []).inSurvivalMode,
  true);
check('threshold is overridable for tests',
  computeNetPosition([{ id: 1, name: 'TNG', balance: 500, target: null, kind: 'own' }], [], [], 1000).inSurvivalMode,
  true);
check('being deep in overall debt does not itself trigger survival mode if cash on hand is fine',
  computeNetPosition(
    [{ id: 1, name: 'TNG', balance: 500, target: null, kind: 'own' }],
    [{ creditor: 'Loan', amount: 50000 }],
  ).inSurvivalMode,
  false);

// --- the bug this replaces -------------------------------------------------
// Treat every account as "own" — the old behaviour — and the number flatters.
const naive = computeNetPosition(accounts.map(a => ({ ...a, kind: 'own' })), []);
check('old model called it +13,576 (wrong by ~16k)', r2(naive.ownCash), 13576.04);

// --- an own account below target is a goal, not a debt ---------------------
const withGoal = computeNetPosition([
  { id: 1, name: 'GX Bank', balance: 20, target: 400, kind: 'own' },
], []);
check('missing a savings goal is not a debt', withGoal.totalOwed, 0);
check('...but it is reported', withGoal.ownShortfall, 380);
check('net position unaffected by the goal', withGoal.netPosition, 20);

// --- flat debts without a schedule still work ------------------------------
check('flat debt falls back to amount',
  debtOutstanding({ creditor: 'Friend', amount: 500 }), 500);
check('paid instalments are excluded', r2(debtOutstanding({
  schedule: [{ due: '2026-09-10', amount: 100, paid: true },
             { due: '2026-10-10', amount: 100, paid: false }],
})), 100);

// --- module 4: debt waterfall -----------------------------------------------
// Real situation again: SPayLater (RM1,164.58 left) and PBE's shortfall
// (RM1,937.60) both belong in one prioritized list.
const waterfall = getWaterfallOrder(accounts, [spaylater]);
check('two items: the debt and the reserve shortfall', waterfall.map(i => i.kind), ['debt', 'reserve']);
check('smallest outstanding first (snowball, not avalanche)',
  waterfall.map(i => i.label), ['SPayLater', 'PBE']);
check('SPayLater progress is derived from its schedule (0 paid so far)',
  r2(waterfall[0].progressPct), 0);
check('PBE reserve original is its target, not its balance',
  waterfall[1].original, 15269);
check('remainingAfter the last item is exactly 0 — nothing left once it is all cleared',
  r2(waterfall.at(-1).remainingAfter), 0);
check('remainingAfter the first item equals everything else still owed',
  r2(waterfall[0].remainingAfter), r2(waterfall[1].outstanding));

// A flat (unscheduled) debt used to have no tracked starting point, so it could
// not show a percentage and correctly showed none — a fabricated figure is
// worse than no figure. It has one now: repayments are recorded against the
// debt rather than hand-edited into `amount`, so `amount` IS the starting point
// and the progress is measured rather than invented. See debts.js.
const flatDebt = { id: 9, creditor: 'Ah Meng', amount: 50 };
const flatWaterfall = getWaterfallOrder([], [flatDebt]);
check('an untouched flat debt shows its full size and no progress yet',
  [flatWaterfall[0].original, flatWaterfall[0].progressPct], [50, 0]);

const flatRepaid = getWaterfallOrder([], [flatDebt], null,
  [{ id: 1, repaysDebtId: 9, amount: 20, date: '2026-08-12' }]);
check('repayments shrink it and give it a real progress figure',
  [flatRepaid[0].outstanding, flatRepaid[0].progressPct], [30, 40]);

// Still nothing to measure against when there is no figure at all.
check('a debt with no figure does not reach the plan',
  getWaterfallOrder([], [{ id: 10, creditor: 'x', amount: 0 }]).length, 0);

// A fully-paid debt and a fully-met reserve target both drop out entirely —
// nothing left to prioritise.
const cleared = getWaterfallOrder(
  [{ id: 1, name: 'PBE', balance: 15269, target: 15269, kind: 'custodial' }],
  [{ id: 1, creditor: 'Paid off', schedule: [{ due: '2026-01-01', amount: 100, paid: true }] }],
);
check('fully settled debts and met reserves are not in the plan', cleared, []);

check('no debts, no reserve shortfall -> empty plan, not an error', getWaterfallOrder([], []), []);

// --- toggleInstalmentPaid: the missing "mark this one paid" mechanism ------
const twoDebts = [
  { id: 1, creditor: 'SPayLater', schedule: [
    { due: '2026-09-10', amount: 299.30, paid: false },
    { due: '2026-10-10', amount: 246.06, paid: false },
  ] },
  { id: 2, creditor: 'Friend', amount: 500 }, // flat debt, no schedule
];

const afterToggle = toggleInstalmentPaid(twoDebts, 1, '2026-09-10');
check('the matching instalment flips to paid',
  afterToggle[0].schedule.find(i => i.due === '2026-09-10').paid, true);
check('the other instalment on the same debt is untouched',
  afterToggle[0].schedule.find(i => i.due === '2026-10-10').paid, false);
check('the other debt is untouched entirely', afterToggle[1], twoDebts[1]);
check('outstanding drops by exactly the toggled instalment', r2(debtOutstanding(afterToggle[0])), 246.06);

const toggledBack = toggleInstalmentPaid(afterToggle, 1, '2026-09-10');
check('toggling again flips it back to unpaid',
  toggledBack[0].schedule.find(i => i.due === '2026-09-10').paid, false);

check('toggling a flat debt (no schedule) with this function is a no-op, not a crash',
  toggleInstalmentPaid(twoDebts, 2, '2026-09-10')[1], twoDebts[1]);
check('toggling a due date that does not exist on the debt changes nothing',
  toggleInstalmentPaid(twoDebts, 1, '2099-01-01')[0], twoDebts[0]);

// --- empty state -----------------------------------------------------------
const empty = computeNetPosition([], []);
check('empty is zero, not NaN', empty.netPosition, 0);
check('empty is not flagged as debt', empty.inDebt, false);
check('empty (RM0 cash) is honestly in survival mode too', empty.inSurvivalMode, true);

// --- raw stored accounts must be resolved before they are weighed ----------
// The bug this locks down: `balance` is DERIVED and never persisted, so the
// accounts array straight out of localStorage carries `openingBalance` and no
// `balance` at all. App.jsx passed that raw array to computeNetPosition, which
// summed a column of `undefined` — ownCash came out as exactly 0 every time,
// which pinned `inSurvivalMode` on permanently no matter how much money was
// really there. It failed silently and in the *alarming* direction, so nothing
// about it looked broken; it just made module 3 meaningless.
const rawStored = [
  { id: 'tng', name: 'TNG', kind: 'own', countsToNetWorth: true, openingBalance: 500, openingAt: 1000 },
  { id: 'gx', name: 'GX', kind: 'own', countsToNetWorth: true, openingBalance: 300, openingAt: 1000 },
];

const unresolved = computeNetPosition(rawStored, []);
check('raw stored accounts have no balance field to sum — this is the trap',
  unresolved.ownCash, 0);
check('...and that wrongly reads as survival mode on RM 800 of real cash',
  unresolved.inSurvivalMode, true);

const resolved = computeNetPosition(resolveAccounts(rawStored, []), []);
check('resolved first, ownCash is the real figure', resolved.ownCash, 800);
check('...and survival mode correctly switches OFF above the threshold',
  resolved.inSurvivalMode, false);

// The same account after real spending, to prove resolve isn't just echoing
// openingBalance back — the banner has to fall as money is actually spent.
const spent = computeNetPosition(
  resolveAccounts(rawStored, [{ id: 1, accountId: 'tng', amount: 250, at: 5000 }]), [],
);
check('spending moves the figure the banner reads', spent.ownCash, 550);

// --- the repayment order is the user's, the sort is only a suggestion -------
const planAccounts = [{ id: 'pbe', name: 'PBE', kind: 'custodial', target: 15269, balance: 12803.29, archived: false }];
const planDebts = [
  { id: 1, creditor: 'LCF', amount: 256 },
  { id: 2, creditor: 'SPayLater', schedule: [{ due: '2026-09-10', amount: 1264.28, paid: false }] },
];

const suggested = getWaterfallOrder(planAccounts, planDebts);
check('with no plan, smallest outstanding first',
  suggested.map(i => i.label), ['LCF', 'SPayLater', 'PBE']);
check('every item records where the suggestion put it',
  suggested.map(i => i.suggestedRank), [0, 1, 2]);
check('and each one is sitting on its suggestion',
  suggested.every(i => i.followsSuggestion), true);

// moveInOrder seeds from the RENDERED list, so one nudge pins everything else
// exactly where it already was rather than reshuffling around a stored order
// the user isn't looking at.
const moved = moveInOrder(suggested, 'reserve:pbe', -1);
check('moving PBE up swaps it with the item above, nothing else moves',
  moved, ['debt:1', 'reserve:pbe', 'debt:2']);

const custom = getWaterfallOrder(planAccounts, planDebts, { order: moved });
check('the custom order wins over the sort', custom.map(i => i.label), ['LCF', 'PBE', 'SPayLater']);
check('an item off its suggested slot is flagged so the UI can say so',
  custom.map(i => i.followsSuggestion), [true, false, false]);
check('the staircase is recomputed for the NEW order, not the suggested one',
  custom.map(i => r2(i.remainingAfter)), [3729.99, 1264.28, 0]);
check('the last item never renders as -0.00', Object.is(custom[2].remainingAfter, -0), false);

check('moving the top item up is a no-op, not a wrap-around',
  moveInOrder(suggested, 'debt:1', -1), ['debt:1', 'debt:2', 'reserve:pbe']);
check('moving the bottom item down is a no-op too',
  moveInOrder(suggested, 'reserve:pbe', 1), ['debt:1', 'debt:2', 'reserve:pbe']);

// A debt added after the order was pinned must still appear — silently
// dropping it is how a repayment plan quietly stops covering everything.
const plusNew = getWaterfallOrder(planAccounts,
  [...planDebts, { id: 3, creditor: 'New', amount: 50 }], { order: moved });
check('an unranked new debt still appears, after the ranked ones',
  plusNew.map(i => i.label), ['LCF', 'PBE', 'SPayLater', 'New']);

// Payoff projection — the app divides, the user supplies the rate.
const withPlan = getWaterfallOrder(planAccounts, planDebts,
  { order: moved, monthly: { 'debt:1': 100 } });
check('months to clear is rounded up, not truncated',
  withPlan.find(i => i.label === 'LCF').monthsToClear, 3);
check('an item with no planned amount reports null, not 0 or Infinity',
  withPlan.find(i => i.label === 'PBE').monthsToClear, null);
check('a zero rate is null rather than Infinity', monthsToClear(256, 0), null);
check('nothing owed is null too', monthsToClear(0, 100), null);
check('an exact division does not round up to an extra month', monthsToClear(300, 100), 3);

// --- autoShortfallDebt: a noisy account can opt out of the derived debt -----
// PBE's balance moves for four unrelated reasons (allowance in, rent out,
// spendable money transferred out, salary parked in transit), so target−balance
// swings meaninglessly. Opting out leaves it tracked and visible but stops it
// being counted as owed; the real figure goes in `debts` by hand instead.
const noisy = [{ id: 'pbe', name: 'PBE', kind: 'custodial', target: 15269, balance: 12803.29, archived: false }];

check('by default the shortfall is still auto-counted as debt',
  r2(computeNetPosition(noisy, []).custodialShortfall), 2465.71);

const optedOut = [{ ...noisy[0], autoShortfallDebt: false }];
check('opted out, the shortfall is no longer owed',
  computeNetPosition(optedOut, []).custodialShortfall, 0);
check('...so total owed drops to just the listed debts',
  computeNetPosition(optedOut, [{ id: 1, creditor: 'LCF', amount: 256 }]).totalOwed, 256);
check('...but the balance is still reported as held, not hidden',
  r2(computeNetPosition(optedOut, []).custodialHeld), 12803.29);
check('...and it never leaks into own cash — it is still not his money',
  computeNetPosition(optedOut, []).ownCash, 0);
check('an opted-out reserve is absent from the repayment plan too',
  getWaterfallOrder(optedOut, []), []);
check('...while the default account still appears in it',
  getWaterfallOrder(noisy, []).map(i => i.label), ['PBE']);
// Explicit true and absent must behave identically, or upgrading an existing
// account by opening the edit form would silently change its debt total.
check('autoShortfallDebt:true matches the absent default',
  r2(computeNetPosition([{ ...noisy[0], autoShortfallDebt: true }], []).custodialShortfall), 2465.71);

// --- 总欠款 vs 本期应还 -------------------------------------------------------
// The complaint this answers, in the user's words: "不能只显示 RM1,864.28 然后
// 叫我一次还掉；它本身就是分期债务". One number per item made an instalment plan
// and money owed to a friend look like the same kind of demand.
const wfCycle = getCycle(new Date(2026, 7, 20)); // 10 Aug -> 10 Sep

const spay = {
  id: 30, creditor: 'SPayLater',
  schedule: [
    { due: '2026-08-10', amount: 368.70, paid: false },
    { due: '2026-09-10', amount: 262.66, paid: false },
    { due: '2026-10-10', amount: 262.68, paid: false },
  ],
};
const lcf = { id: 31, creditor: 'LCF', amount: 256, plan: { '2026-08-10': 50 } };
const noPlan = { id: 32, creditor: 'Ah Meng', amount: 90 };

const wf = getWaterfallOrder([], [spay, lcf, noPlan], null, [], wfCycle);
const byLabel = (l) => wf.find(i => i.label === l);

check('an instalment plan is not a matter of choice',
  byLabel('SPayLater').commitment, 'scheduled');
check('money owed to a person is', byLabel('LCF').commitment, 'flexible');

check('the total owed is still the whole plan',
  r2(byLabel('SPayLater').outstanding), 894.04);
check('...but what this cycle actually asks for is one instalment',
  r2(byLabel('SPayLater').dueThisCycle), 368.70);
check('...and it names the date that instalment falls on',
  byLabel('SPayLater').nextDue, '2026-08-10');

check('a flexible debt asks for whatever you decided this cycle, not its total',
  [r2(byLabel('LCF').outstanding), r2(byLabel('LCF').dueThisCycle)], [256, 50]);
check('...and asks for nothing until you decide',
  r2(byLabel('Ah Meng').dueThisCycle), 0);

// Never send the user to pay money that would bounce straight back.
const nearlyDone = getWaterfallOrder([], [{ id: 33, creditor: 'X', amount: 30, plan: { '2026-08-10': 200 } }],
  null, [], wfCycle);
check('this cycle can never ask for more than is actually still owed',
  r2(nearlyDone[0].dueThisCycle), 30);

// A repayment already made this cycle reduces what is still to be paid, rather
// than the screen asking for the full instalment a second time.
const partlyPaid = getWaterfallOrder([], [spay], null,
  [{ id: 1, repaysDebtId: 30, amount: 100, date: '2026-08-12' }], wfCycle);
check('paying part of this month leaves only the rest of it outstanding for now',
  r2(partlyPaid[0].dueThisCycle), 268.70);
check('...and the total owed drops by the same amount',
  r2(partlyPaid[0].outstanding), 794.04);

// Nobody chases you for money owed to your own reserve, so it has no deadline.
const reserveWf = getWaterfallOrder(
  [{ id: 'pbe', name: 'PBE', kind: 'custodial', target: 15269, balance: 12672.09, archived: false }],
  [], { monthly: { 'reserve:pbe': 200 } }, [], wfCycle);
check('a reserve shortfall is real but never scheduled',
  reserveWf[0].commitment, 'reserve');
check('...it asks for what you decided to put back, and no due date',
  [r2(reserveWf[0].dueThisCycle), reserveWf[0].nextDue], [200, null]);
check('...and its total is still the whole shortfall',
  r2(reserveWf[0].outstanding), 2596.91);

// Called without a cycle (a preview, a test, an older call site) it must report
// 0 rather than guessing at a cycle the caller never named.
check('no cycle means no claim about what is due now',
  getWaterfallOrder([], [spay])[0].dueThisCycle, 0);

// --- 「我现在真正有多少钱能花」 ----------------------------------------------
// Neither figure that existed answered this: `ownCash` flatters you by exactly
// what you are about to owe, and cycle.js's `available` is a statement about
// income you told the app you earn. See computeSpendable.
const spCycle = getCycle(new Date(2026, 7, 20)); // 10 Aug -> 10 Sep

const spAccounts = [
  { id: 'tng', name: 'TNG', kind: 'own', balance: 1000, target: null, archived: false },
  { id: 'pbe', name: 'PBE', kind: 'custodial', balance: 12672.09, target: 15269, archived: false },
];
const spBills = [
  { id: 1, label: '房租', amount: 500, frequency: 'monthly', dueDay: 15, essential: true },
  { id: 2, label: 'Netflix', amount: 55, frequency: 'monthly', dueDay: 20, essential: false },
  // Yearly, set aside monthly, landing in December — reserves a slice in the
  // BUDGET but takes nothing out of the bank this cycle.
  { id: 3, label: '车保险', amount: 600, frequency: 'yearly', dueDay: 1, dueMonth: 12, costing: 'spread' },
];
const spDebts = [
  { id: 1, creditor: 'SPayLater', schedule: [{ due: '2026-08-10', amount: 368.70, paid: false }] },
  { id: 2, creditor: 'LCF', amount: 256, plan: { '2026-08-10': 50 } },
];

const sp = computeSpendable({
  accounts: spAccounts, allocations: spBills, debts: spDebts, expenses: [], cycle: spCycle,
});

check('必要 and 非必要 bills are counted apart, not lumped together',
  [r2(sp.essentialDue), r2(sp.optionalDue)], [500, 55]);
check('a yearly bill being SET ASIDE takes nothing out of the bank this cycle',
  r2(sp.billsDue), 555);
check('this cycle still to repay: the instalment plus what you planned',
  r2(sp.debtDue), 418.70);
check('spendable = own cash − unpaid bills − unpaid debt',
  r2(sp.spendable), 26.30);

// The whole point of the flag: without this it would be a label.
check('...and it says what cutting the optional ones would free up',
  r2(sp.spendableIfCut), 81.30);

// The reassuring-direction failure this whole file exists to prevent.
check('custodial money is never spendable, however large',
  r2(sp.ownCash), 1000);
check('...and the reserve shortfall is reported beside it, never mixed in',
  [r2(sp.reserveShortfall), r2(sp.spendable)], [2596.91, 26.30]);

// A bill already paid has already left the account, so ownCash reflects it —
// subtracting it again would charge the same ringgit twice.
const spPaid = computeSpendable({
  accounts: spAccounts,
  allocations: spBills.map(b => (b.id === 1 ? { ...b, paidFor: spCycle.start } : b)),
  debts: spDebts, expenses: [], cycle: spCycle,
});
check('a bill marked paid stops being subtracted', r2(spPaid.spendable), 526.30);
check('...and is reported as already paid rather than vanishing', r2(spPaid.billsPaid), 500);

// Same rule for debt, except a repayment IS an expense record, so ownCash has
// already moved — only what is still to pay may be subtracted.
const spRepaid = computeSpendable({
  accounts: [{ ...spAccounts[0], balance: 800 }, spAccounts[1]],
  allocations: spBills, debts: spDebts,
  expenses: [{ id: 1, repaysDebtId: 1, amount: 200, date: '2026-08-12' }],
  cycle: spCycle,
});
check('repaying RM200 leaves only the rest of the instalment committed',
  r2(spRepaid.debtDue), 218.70);
check('...and the cash it came out of is not subtracted a second time',
  r2(spRepaid.spendable), 26.30);

// Overcommitted is a real state and must read as one, not floor at zero.
const spShort = computeSpendable({
  accounts: [{ id: 'tng', name: 'TNG', kind: 'own', balance: 100, archived: false }],
  allocations: spBills, debts: spDebts, expenses: [], cycle: spCycle,
});
check('owing more than you hold reads as negative, not as zero',
  [spShort.shortOfCommitments, r2(spShort.spendable)], [true, -873.70]);

// Called without a cycle nothing is committed yet — it must not guess.
const spNoCycle = computeSpendable({ accounts: spAccounts, allocations: spBills, debts: spDebts });
check('no cycle means no claim about what is committed',
  [r2(spNoCycle.committedNow), r2(spNoCycle.spendable)], [0, 1000]);

// A bill saved before the flag existed keeps being subtracted — the safe
// direction. Silently becoming optional would inflate what you can spend.
const spLegacy = computeSpendable({
  accounts: spAccounts, allocations: [{ id: 9, label: '旧账单', amount: 80, frequency: 'monthly', dueDay: 15 }],
  debts: [], expenses: [], cycle: spCycle,
});
check('a bill with no 必要/非必要 setting counts as essential',
  [r2(spLegacy.essentialDue), r2(spLegacy.optionalDue)], [80, 0]);

// --- 现在能花 must never include money that is not there ---------------------
// The two ways this figure could lie, both in the reassuring direction, both
// named explicitly by the user before release.
const guardCycle = getCycle(new Date(2026, 7, 20));

// 1. Custodial money. PBE's RM12,672.09 is held for someone else; a headline
//    figure that includes it tells him he has RM12k to spend.
const guardAccounts = [
  { id: 'tng', name: 'TNG', kind: 'own', balance: 450.90, target: null, archived: false },
  { id: 'pbe', name: 'PBE', kind: 'custodial', balance: 12672.09, target: 15269, archived: false },
];
const guard = computeSpendable({
  accounts: guardAccounts, allocations: [], debts: [], expenses: [], cycle: guardCycle,
});
check('a custodial balance is not spendable, however large',
  r2(guard.spendable), 450.90);
check('...and it is reported separately rather than silently dropped',
  r2(guard.custodialHeld), 12672.09);
check('...and what is owed back to it is its own figure, not mixed in',
  r2(guard.reserveShortfall), 2596.91);

// 2. Income that has not arrived. `incomeSources` is a SETTING — what he told
//    the app he expects. Cash he does not have yet must never appear in a
//    figure titled 现在能花.
const guardWithIncome = computeSpendable({
  accounts: guardAccounts, allocations: [], debts: [], expenses: [], cycle: guardCycle,
  // Passed deliberately: the signature has no `incomeSources` parameter at all,
  // so an expectation cannot reach this figure even by accident.
  incomeSources: [{ id: 's1', label: '实习薪水', amount: 5000, kind: 'income' }],
});
check('expected income cannot inflate what you can spend today',
  r2(guardWithIncome.spendable), 450.90);

// Money that HAS arrived is different — it is in the account, so it counts,
// and it counts because the balance moved, not because a setting said so.
const guardArrived = computeSpendable({
  accounts: [{ ...guardAccounts[0], balance: 750.90 }, guardAccounts[1]],
  allocations: [], debts: [], expenses: [], cycle: guardCycle,
});
check('money that actually landed does count', r2(guardArrived.spendable), 750.90);

// --- a bill payment marked as a bill must not vanish from the month ----------
// Marking a payment as 固定月费 excludes it from spending, because the
// allocation already reserved it. That is right when the allocation really does
// claim that much this cycle — and silently loses money when it does not.
const quarterly = [{
  id: 'q1', label: '车保险', amount: 600, frequency: 'quarterly',
  dueDay: 1, dueMonth: 11, costing: 'spread',
}];
const paidEarly = computeCycleBudget({
  incomeSources: [{ id: 's1', label: '薪水', amount: 2000, kind: 'income' }],
  allocations: quarterly.map(a => ({ ...a, budgeted: 200, charged: 0 })),
  cycle: guardCycle,
  expenses: [{ date: '2026-08-15', amount: 600, allocationId: 'q1' }],
});
check('paying a bill early still costs the cycle what it really cost',
  r2(paidEarly.committed), 600);
check('...so the money cannot disappear between the two buckets',
  r2(paidEarly.committed + paidEarly.spentThisCycle), 600);

// Paying exactly what was expected changes nothing — the reservation stands.
const paidExpected = computeCycleBudget({
  incomeSources: [{ id: 's1', label: '薪水', amount: 2000, kind: 'income' }],
  allocations: [{ id: 'a1', label: '房租', amount: 500, budgeted: 500, charged: 500 }],
  cycle: guardCycle,
  expenses: [{ date: '2026-08-15', amount: 500, allocationId: 'a1' }],
});
check('paying the expected amount is counted once, not twice',
  [r2(paidExpected.committed), r2(paidExpected.spentThisCycle)], [500, 0]);

// Paying MORE than the bill asked for is real money gone, same rule as a debt.
const paidMore = computeCycleBudget({
  incomeSources: [{ id: 's1', label: '薪水', amount: 2000, kind: 'income' }],
  allocations: [{ id: 'a1', label: '水电', amount: 120, budgeted: 120, charged: 120 }],
  cycle: guardCycle,
  expenses: [{ date: '2026-08-15', amount: 180, allocationId: 'a1' }],
});
check('a bill that came in higher than expected costs what was actually paid',
  r2(paidMore.committed), 180);

// A payment pointing at a bill that has since been DELETED must fall back to
// being ordinary spending — otherwise deleting a subscription would quietly
// erase every payment ever made against it from the month's totals.
const orphan = computeCycleBudget({
  incomeSources: [{ id: 's1', label: '薪水', amount: 2000, kind: 'income' }],
  allocations: [],
  cycle: guardCycle,
  expenses: [{ date: '2026-08-15', amount: 90, allocationId: 'gone' }],
});
check('a payment whose bill no longer exists counts as spending, not as nothing',
  [r2(orphan.committed), r2(orphan.spentThisCycle)], [0, 90]);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
