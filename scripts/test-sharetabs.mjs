// 共摊本 — money that passes through him, netted once per cycle.
//
// The rule under test, in his words (2026-09-09):
// 「他们给了我那些全部加起来然后扣掉房租、扣掉 time wifi、那些 spotify，
//   多的算收入，少的算支出，就是结果才算，中间不用算」
//
// So the property this file exists to protect is that NOTHING inside a tab
// reaches the budget on its own — not the RM2,000 rent, not the RM354 a
// housemate sends back — and the net reaches it exactly once.

import {
  inShareTab, tabRecords, tabCycle, tabsForCycle, budgetLinesForCycle,
  contributors, outgoings, isSettled, setSettled, unsettledCycles, settledCycles,
  addTabBill, updateTabBill, removeTabBill, billsStatus,
} from '../src/utils/shareTabs.js';
import { getCycle, getPreviousCycle, computeCycleBudget } from '../src/utils/cycle.js';
import { isDailySpend, isRealSpend, isSpendingRecord } from '../src/utils/accounts.js';
import { getProjects } from '../src/utils/projects.js';

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

const cycle = getCycle(new Date(2026, 8, 20));      // September
const next = getCycle(new Date(2026, 9, 20));       // October
check('the cycle under test is September', [cycle.start, cycle.end], ['2026-09-01', '2026-10-01']);

const tab = { id: 'rt', label: '房友共摊' };

// His real shape: rent from the custodial account, wifi and Spotify from his
// own, three of five housemates paying up.
const sept = [
  { id: 1, date: '2026-09-05', merchant: '房租', amount: 2000, shareTabId: 'rt', accountId: 'pbe' },
  { id: 2, date: '2026-09-08', merchant: 'TIME wifi', amount: 99, shareTabId: 'rt', accountId: 'tng' },
  { id: 3, date: '2026-09-12', merchant: 'Spotify', amount: 26.90, shareTabId: 'rt', accountId: 'tng' },
  { id: 4, date: '2026-09-06', merchant: '阿明', amount: -354.32, shareTabId: 'rt', isMoneyIn: true },
  { id: 5, date: '2026-09-07', merchant: '小陈', amount: -354.32, shareTabId: 'rt', isMoneyIn: true },
  { id: 6, date: '2026-09-09', merchant: 'Wei Jie', amount: -354.32, shareTabId: 'rt', isMoneyIn: true },
  // Untabbed, and must stay completely unaffected.
  { id: 7, date: '2026-09-10', merchant: 'Restoran Pelita', amount: 16.50 },
];

// --- the tab itself ---------------------------------------------------------
check('a tabbed record is recognised', inShareTab(sept[0]), true);
check('an ordinary expense is not', inShareTab(sept[6]), false);
check('only this tab\'s records, only this cycle', tabRecords(tab, sept, cycle).map(e => e.id), [1, 2, 3, 4, 5, 6]);

const s = tabCycle(tab, sept, cycle);
near('paid out is the gross bills side', s.paidOut, 2125.90);
near('received is the gross incoming side', s.received, 1062.96);
near('net = 收到 − 付出去', s.net, -1062.94);
check('a negative net is spending, not income', [s.isSpend, s.isIncome], [true, false]);
near('...and that IS what he actually paid this month', s.ownShare, 1062.94);

// 「多的算收入」 — the other direction, which is how a late payment comes back.
const octLatecomers = [
  { id: 10, date: '2026-10-05', merchant: '房租', amount: 2000, shareTabId: 'rt' },
  { id: 11, date: '2026-10-08', merchant: 'TIME wifi', amount: 99, shareTabId: 'rt' },
  { id: 12, date: '2026-10-12', merchant: 'Spotify', amount: 26.90, shareTabId: 'rt' },
  // all five pay, plus the two who were late in September
  ...[1, 2, 3, 4, 5].map((n, i) => ({ id: 20 + i, date: '2026-10-06', merchant: `友${n}`, amount: -354.32, shareTabId: 'rt' })),
  { id: 30, date: '2026-10-11', merchant: '阿强补上', amount: -354.32, shareTabId: 'rt' },
  { id: 31, date: '2026-10-11', merchant: '阿豪补上', amount: -354.32, shareTabId: 'rt' },
];
const o = tabCycle(tab, octLatecomers, next);
near('a tab that collected more than it spent comes out positive', o.net, 354.34);
check('...and that is income, not negative spending', [o.isIncome, o.ownShare], [true, 0]);

check('a cycle with nothing in the tab is absent, not a RM0 commitment',
  budgetLinesForCycle([tab], sept, getCycle(new Date(2026, 11, 20))), []);
check('an archived tab is left out entirely',
  tabsForCycle([{ ...tab, archived: true }], sept, cycle), []);

// --- who paid ---------------------------------------------------------------
// Reported, never planned: he was asked for a list of expected shares and said
// 「不需要懂谁欠我多少…我知道谁还没给的」.
check('who put money in, largest first',
  contributors(tab, sept, cycle).map(c => [c.name, c.paid]),
  [['阿明', 354.32], ['小陈', 354.32], ['Wei Jie', 354.32]]);
check('two payments from one person add up',
  contributors(tab, [...sept, { id: 8, date: '2026-09-20', merchant: '阿明', amount: -100, shareTabId: 'rt' }], cycle)[0],
  { name: '阿明', paid: 454.32 });
check('the bills side lists what went out, largest first',
  outgoings(tab, sept, cycle).map(e => e.merchant), ['房租', 'TIME wifi', 'Spotify']);

// --- the budget: nothing inside counts, the net counts once -----------------
const income = [{ id: 'sal', label: '实习薪水', amount: 2500, kind: 'income' }];
const lines = budgetLinesForCycle([tab], sept, cycle);
check('one line, carrying the net', lines, [{ id: 'rt', label: '房友共摊', net: -1062.94 }]);

// --- while the cycle is still running, the net does not press the budget ----
// His rule, 2026-09-20: "不压，月底才结算" — a housemate two days from paying
// is not a bill this cycle should already count as lost, so the daily
// allowance must read exactly as if the tab did not exist until the cycle is
// actually over. `cycle` here (built from a September date) IS the live
// cycle for as long as this suite runs on its real clock in September 2026 —
// see the "once the cycle has ended" block below for the settled half of
// this rule, tested against a cycle safely in the past.
const withTab = computeCycleBudget({ incomeSources: income, allocations: [], expenses: sept, cycle, shareLines: lines });
const noTab = computeCycleBudget({ incomeSources: income, allocations: [], expenses: sept, cycle });

near('a live cycle\'s net does not join 固定开销 yet', withTab.shareCommitted, 0);
near('...so nothing is committed against it either', withTab.committed, 0);
near('the RM2,000 rent is NOT spending (that part of the rule never changes)', withTab.grossSpentThisCycle, 16.50);
near('...and the housemates\' money is NOT income', withTab.spendableIncome, 2500);
near('...nor an unfiled arrival needing to be explained away', withTab.arrivedUnlinked, 0);
near('so the live month is just income minus ordinary spend, tab untouched',
  withTab.available, 2500 - 16.50);

// The same records with no `shareLines` passed still must not leak in through
// the individual totals — the exclusion is driven by the record, not the call.
near('a tabbed record never counts as spending, even if the caller forgets the lines',
  noTab.grossSpentThisCycle, 16.50);
near('...and never as an arrival either', noTab.arrivedThisCycle, 0);

// 「多的算收入」 while still live: still 0, for the same "not over yet" reason
// — a tab running ahead this week is not income banked early.
const octBudget = computeCycleBudget({
  incomeSources: income, allocations: [], expenses: octLatecomers, cycle: next,
  shareLines: budgetLinesForCycle([tab], octLatecomers, next),
});
near('a live cycle\'s positive net is not banked as income early', octBudget.spendableIncome, 2500);
near('...and commits nothing', octBudget.shareCommitted, 0);

// --- once the cycle has ENDED, its net settles automatically ----------------
// No separate "结算" stamp is checked here — a cycle whose `end` is in the
// past has nothing left to wait for. Built from a January date so it is
// genuinely over relative to this suite's real clock (pinned well past it),
// unlike `cycle`/`next` above which are this suite's OWN live/upcoming
// months and must stay 0 for as long as that pin holds.
const janCycle = getCycle(new Date(2026, 0, 20));
const jan = [
  { id: 101, date: '2026-01-05', merchant: '房租', amount: 2000, shareTabId: 'rt' },
  { id: 102, date: '2026-01-08', merchant: 'TIME wifi', amount: 99, shareTabId: 'rt' },
  { id: 103, date: '2026-01-12', merchant: 'Spotify', amount: 26.90, shareTabId: 'rt' },
  { id: 104, date: '2026-01-06', merchant: '阿明', amount: -354.32, shareTabId: 'rt' },
];
const janLines = budgetLinesForCycle([tab], jan, janCycle);
const janBudget = computeCycleBudget({ incomeSources: income, allocations: [], expenses: jan, cycle: janCycle, shareLines: janLines });
near('an ended cycle\'s net joins 固定开销, exactly once', janBudget.shareCommitted, 1771.58);
near('...and commits exactly that', janBudget.committed, 1771.58);
near('so an ended month is income minus the settled net, nothing double-counted',
  janBudget.available, 2500 - 1771.58);

// --- the classifier, which is where the leaks would have been ---------------
// 今天花了多少, the Dashboard, 本周回顾 and the midnight rollover all filter on
// isDailySpend and none of them has ever heard of a share tab. If the rent
// answered yes there, the day it was paid would read as blowing the daily cap
// — and the rollover writes that day into `history` permanently.
check('a tabbed bill is not daily spending', isDailySpend(sept[0]), false);
check('...nor "real" spending, so it stays out of the category circle', isRealSpend(sept[0]), false);
check('a tabbed arrival is not daily spending either', isDailySpend(sept[3]), false);
check('an ordinary expense is completely unaffected',
  [isDailySpend(sept[6]), isRealSpend(sept[6])], [true, true]);
check('but the account-facing predicate still sees it — the money DID leave',
  isSpendingRecord(sept[0]), true);

// --- two machineries must never both count the same record ------------------
// The form keeps 共摊本 / 固定月费 / 项目 mutually exclusive. These are the
// arithmetic refusing to trust that, because a restored backup or an older
// build can produce a record carrying both. Run against `janCycle` (ended),
// not the live `cycle` — a live cycle's shareCommitted is always 0 by the
// rule just above, which would make this guard untestable rather than proven.
const bothTabAndBill = [
  { id: 1, date: '2026-01-05', merchant: '房租', amount: 2000, shareTabId: 'rt', allocationId: 'a1' },
];
const rentBill = [{ id: 'a1', label: '房租', amount: 2000, frequency: 'monthly', dueDay: 5 }];
const conflicted = computeCycleBudget({
  incomeSources: income,
  allocations: [{ ...rentBill[0], budgeted: 2000, charged: 2000 }],
  expenses: bothTabAndBill,
  cycle: janCycle,
  shareLines: budgetLinesForCycle([tab], bothTabAndBill, janCycle),
});
near('a record in a tab does not also pay down an allocation', conflicted.shareCommitted, 2000);
near('...so the bill is reserved once by the allocation and once by the tab, not three times',
  conflicted.committed, 4000);
check('a record in a tab is never also a project',
  getProjects([{ id: 1, merchant: 'x', amount: 100, isProject: true, shareTabId: 'rt' }]).length, 0);
check('...while an ordinary project is untouched',
  getProjects([{ id: 1, merchant: 'x', amount: 100, isProject: true }]).length, 1);

// --- a bill drawn on a 代管 account -----------------------------------------
// PBE's balance is excluded from ownCash and its inflows are not income, so
// subtracting a bill it pays from an income-based budget charged him twice for
// money that was never his: RM2,000 of rent a month, ~RM66/day of allowance
// that quietly did not exist.
const rentOnPbe = [{ id: 'a1', label: '房租', budgeted: 2000, charged: 2000, custodial: true }];
const netflixOnHis = [{ id: 'a2', label: 'Netflix', budgeted: 55, charged: 55 }];

const custodialOnly = computeCycleBudget({
  incomeSources: income, allocations: rentOnPbe, expenses: [], cycle,
});
near('a 代管 bill does not reduce his budget', custodialOnly.committed, 0);
near('...but is still reported, because the money really does leave',
  custodialOnly.custodialCommitted, 2000);
near('...so the month is his income, whole', custodialOnly.available, 2500);

const mixed = computeCycleBudget({
  incomeSources: income, allocations: [...rentOnPbe, ...netflixOnHis], expenses: [], cycle,
});
near('a bill on his own account still counts, unchanged', mixed.committed, 55);
near('...and the two are reported apart', mixed.custodialCommitted, 2000);
near('...and 花掉的 is untouched by either', mixed.grossSpentThisCycle, 0);

// --- 结算: acknowledging a cycle that already settled itself ---------------
// No arithmetic depends on any of this — computeCycleBudget above already
// settles an ended cycle's net on its own, purely from `cycle.end`. This is
// only "has he actually looked", tracked as his own explicit ask.
const liveCycle = getCycle();
const prevCycle = getPreviousCycle(liveCycle);
const twoBackCycle = getPreviousCycle(prevCycle);

check('a tab with no `settled` field is unsettled everywhere',
  isSettled(tab, prevCycle.start), false);

const stamped = setSettled([tab], tab.id, prevCycle.start, true);
check('settling stamps a timestamp, not just `true`',
  typeof stamped[0].settled[prevCycle.start], 'number');
check('...and isSettled reads it back', isSettled(stamped[0], prevCycle.start), true);
check('a DIFFERENT cycle on the same tab is untouched',
  isSettled(stamped[0], twoBackCycle.start), false);
check('the original tab object is never mutated', tab.settled, undefined);

const unstamped = setSettled(stamped, tab.id, prevCycle.start, false);
check('un-settling is a real way back, not a dead end',
  isSettled(unstamped[0], prevCycle.start), false);

check('settling a different tab in the list leaves this one alone',
  isSettled(setSettled([tab, { id: 'other' }], 'other', prevCycle.start, true)[0], prevCycle.start),
  false);

// A tab with real activity two cycles back, nothing further back than that —
// the walk has to find the one with activity and stop at the empty one
// beyond it, not report every cycle in between as "unsettled".
const settleData = [
  { id: 901, date: prevCycle.start, merchant: '房租', amount: 2000, shareTabId: tab.id },
  { id: 902, date: prevCycle.start, merchant: '阿明', amount: -800, shareTabId: tab.id },
];
const unsettled = unsettledCycles(tab, settleData, liveCycle);
check('the one ended cycle with real activity is surfaced',
  unsettled.map(c => c.cycleStart), [prevCycle.start]);
near('...carrying its own net', unsettled[0].net, -1200);
check('...and stops at the empty cycle beyond it, not walking further back',
  unsettled.length, 1);

const alreadyDone = unsettledCycles(stamped[0], settleData, liveCycle);
check('once settled, it drops off the list entirely', alreadyDone, []);

check('a tab with nothing anywhere has nothing to settle',
  unsettledCycles(tab, [], liveCycle), []);

check('maxBack of 0 finds nothing regardless of what is actually there',
  unsettledCycles(tab, settleData, liveCycle, 0), []);

// The undo side: 取消结算 needs somewhere to find what was settled, not just
// a toast that vanishes the moment the banner does.
check('nothing settled yet, so nothing to undo', settledCycles(tab, settleData, liveCycle), []);
const settledList = settledCycles(stamped[0], settleData, liveCycle);
check('once settled, it is exactly what 取消结算 lists',
  settledList.map(c => c.cycleStart), [prevCycle.start]);
near('...still carrying its net, so 取消结算 can show what it is undoing',
  settledList[0].net, -1200);
check('settled and unsettled are always a strict partition of the same history',
  unsettledCycles(stamped[0], settleData, liveCycle).length + settledList.length,
  unsettledCycles(tab, settleData, liveCycle).length);

// --- a tab's own bills: what replaces 固定月费 for things inside the tab ---
const withBill = addTabBill([tab], tab.id, { id: 'b1', label: '房租', amount: 2000, dueDay: 5 });
check('adding a bill leaves the original tab untouched', tab.bills, undefined);
check('...and appears on the returned copy', withBill[0].bills, [{ id: 'b1', label: '房租', amount: 2000, dueDay: 5 }]);

const twoBills = addTabBill(withBill, tab.id, { id: 'b2', label: 'Spotify', amount: 26.90, dueDay: 1 });
check('a second bill is appended, not replacing the first', twoBills[0].bills.length, 2);

const renamed = updateTabBill(twoBills, tab.id, 'b1', { amount: 2100 });
check('editing a bill changes only that field', renamed[0].bills.find(b => b.id === 'b1').amount, 2100);
check('...leaving its label alone', renamed[0].bills.find(b => b.id === 'b1').label, '房租');
check('...and the other bill on the tab untouched', renamed[0].bills.find(b => b.id === 'b2').amount, 26.90);
check('editing an unknown bill id is a no-op', updateTabBill(twoBills, tab.id, 'nope', { amount: 1 })[0].bills, twoBills[0].bills);

const oneLeft = removeTabBill(twoBills, tab.id, 'b2');
check('removing a bill drops just that one', oneLeft[0].bills.map(b => b.id), ['b1']);

check('a tab with no bills array reports none', billsStatus(tab, sept, cycle), []);

const billTab = twoBills[0];
const unpaidStatus = billsStatus(billTab, sept, cycle);
check('an unlinked payment does not mark a bill paid — sept has 房租 but no shareTabBillId',
  unpaidStatus.find(b => b.id === 'b1').paid, false);

const paidThisCycle = [
  ...sept,
  { id: 999, date: '2026-09-05', merchant: '房租', amount: 2100, shareTabId: tab.id, shareTabBillId: 'b1' },
];
const paidStatus = billsStatus(billTab, paidThisCycle, cycle);
check('a record carrying this bill\'s id marks it paid', paidStatus.find(b => b.id === 'b1').paid, true);
check('...and the linked record is the one reported back',
  paidStatus.find(b => b.id === 'b1').paidRecord.id, 999);
check('the other bill on the same tab is unaffected', paidStatus.find(b => b.id === 'b2').paid, false);
check('a different cycle sees no payment at all',
  billsStatus(billTab, paidThisCycle, next).find(b => b.id === 'b1').paid, false);
check('removed bills are simply absent from status, not reported broken',
  billsStatus(oneLeft[0], paidThisCycle, cycle).map(b => b.id), ['b1']);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
