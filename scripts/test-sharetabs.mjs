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
  renameTab, setTabArchived, tabRecordCount, deleteTab, detachTabRecords,
  coveredCycleStarts, portionIn, isSpread, nextCycleOf, expectedForCycle,
  addTabMember, updateTabMember, removeTabMember, learnMemberAlias,
  membersStatus, suggestMember, suggestCoverage, coverageLabel, withoutTab, intoTab,
} from '../src/utils/shareTabs.js';
import { getCycle, getPreviousCycle, computeCycleBudget } from '../src/utils/cycle.js';
import { isDailySpend, isRealSpend, isSpendingRecord } from '../src/utils/accounts.js';
import { getProjects } from '../src/utils/projects.js';

// Pinned clocks. computeCycleBudget asks "has this cycle ended?", and the
// answer used to come from the real clock — so every "September is still
// live" assertion below was a failure scheduled for 1 October 2026.
const SEPT_DAY = new Date(2026, 8, 20);
const OCT_DAY = new Date(2026, 9, 20);

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
// Archiving means "stop offering this for new records", NOT "erase the month".
// A tab archived while this cycle's rent is still sitting in it keeps its card
// and its budget line — see tabsForCycle. It drops out once the cycle it was
// used in is behind us, which is what the second check here is.
check('an archived tab that still holds THIS cycle\'s records is not dropped',
  tabsForCycle([{ ...tab, archived: true }], sept, cycle).map(t => t.id), [tab.id]);
check('an archived tab with nothing in this cycle is left out entirely',
  tabsForCycle([{ ...tab, archived: true }], [], cycle), []);

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
check('one line, carrying the net (and no expectation — this tab has no members)',
  lines.map(l => ({ ...l, net: Math.round(l.net * 100) / 100 })),
  [{ id: 'rt', label: '房友共摊', net: -1062.94, expectedNet: null }]);

// --- while the cycle is still running, the net does not press the budget ----
// His rule, 2026-09-20: "不压，月底才结算" — a housemate two days from paying
// is not a bill this cycle should already count as lost, so the daily
// allowance must read exactly as if the tab did not exist until the cycle is
// actually over. `cycle` here is September and the clock is pinned inside it
// (SEPT_DAY) — see the "once the cycle has ended" block below for the settled
// half of this rule, tested against a cycle safely in the past.
const withTab = computeCycleBudget({ incomeSources: income, allocations: [], expenses: sept, cycle, shareLines: lines, today: SEPT_DAY });
const noTab = computeCycleBudget({ incomeSources: income, allocations: [], expenses: sept, cycle, today: SEPT_DAY });

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
  today: OCT_DAY,
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
const janBudget = computeCycleBudget({ incomeSources: income, allocations: [], expenses: jan, cycle: janCycle, shareLines: janLines, today: SEPT_DAY });
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


// --- managing the tab itself ----------------------------------------------
//
// "我按进去不可以设置什么的吗，有点奇怪，然后也不可以取消，就删除不掉"
// (2026-09-22). `archived` was read in five places and written by none, and
// there was no rename and no delete at all.

const mgmt = [{ id: 't1', label: '房友共摊' }, { id: 't2', label: '旅行共摊' }];

check('rename changes just that tab', renameTab(mgmt, 't1', '室友共摊').map(t => t.label),
  ['室友共摊', '旅行共摊']);
check('a blank name is refused rather than saved', renameTab(mgmt, 't1', '   '), mgmt);
check('renaming an unknown id is a no-op', renameTab(mgmt, 'nope', 'x'), mgmt);

check('archiving sets the flag', setTabArchived(mgmt, 't2', true)[1].archived, true);
check('...and un-archiving REMOVES it rather than storing false',
  Object.prototype.hasOwnProperty.call(setTabArchived(setTabArchived(mgmt, 't2', true), 't2', false)[1], 'archived'),
  false);

// THE TRAP THIS CLOSES. `inShareTab` keeps a record out of daily spend on
// `shareTabId != null` alone — it never looks at the tab. So a `!t.archived`
// filter in tabsForCycle meant archiving a tab mid-cycle excluded its records
// from spending AND its net from the budget: the money existed nowhere.
const liveTab = { id: 't1', label: '房友共摊' };
const liveRows = [
  { id: 'r1', date: '2026-09-05', merchant: '房租', amount: 2000, shareTabId: 't1' },
  { id: 'r2', date: '2026-09-06', merchant: '阿强', amount: -1600, shareTabId: 't1' },
];
const mgmtCycle = getCycle(new Date('2026-09-22T09:00:00'));
const archivedLive = setTabArchived([liveTab], 't1', true);
check('an archived tab that still has records THIS cycle keeps its card',
  tabsForCycle(archivedLive, liveRows, mgmtCycle).map(t => t.id), ['t1']);
check('...and its net is still handed to the budget — the money cannot vanish',
  budgetLinesForCycle(archivedLive, liveRows, mgmtCycle).map(l => l.net), [-400]);
check('...while an archived tab with nothing in this cycle really is gone',
  tabsForCycle(archivedLive, [], mgmtCycle).map(t => t.id), []);

check('counting looks at the whole ledger, not one cycle',
  tabRecordCount(liveTab, [...liveRows, { id: 'r3', date: '2026-07-01', amount: 50, shareTabId: 't1' }]), 3);
check('a record in a DIFFERENT tab is not counted',
  tabRecordCount(liveTab, [{ id: 'r9', date: '2026-09-01', amount: 10, shareTabId: 't2' }]), 0);

const blocked = deleteTab([liveTab], 't1', liveRows);
check('deleting a tab that still owns records is refused', blocked.deleted, false);
check('...and says how many are in the way', blocked.blockedBy, 2);
check('...leaving the list untouched', blocked.tabs.map(t => t.id), ['t1']);

const gone = deleteTab(mgmt, 't2', liveRows);
check('an empty tab deletes cleanly', [gone.deleted, gone.tabs.map(t => t.id)], [true, ['t1']]);

const detached = detachTabRecords('t1', liveRows);
check('detaching returns only the records that changed', detached.map(e => e.id), ['r1', 'r2']);
check('...with both tab links cleared, not just the tab one',
  detached.map(e => [e.shareTabId, e.shareTabBillId]), [[null, null], [null, null]]);
check('...so they are ordinary records again', detached.map(inShareTab), [false, false]);
check('...and the rent among them counts as real spending once more',
  detached.filter(e => isDailySpend(e) && e.amount > 0).map(e => e.id), ['r1']);

// === 2026-09-28: 月初先预留, 平均分到那几个月, 每个人的数目 ================
//
// His real month, confirmed that day: 工资 1,000 + 爸爸 2,500 (as 我的钱), five
// friends sending 448 / 417.20 / 413.20 / 327.20 / 360 = 1,965.60, and rent
// 2,000 + TIME 210.95 + Spotify 20.90 = 2,231.85 going out. His own share is
// 266.25, and the month he can actually use is 3,233.75. Those two numbers
// are what the block below exists to pin down.

const octCycle = getCycle(new Date(2026, 9, 15));
const OCT_1 = new Date(2026, 9, 1);
const NOV_DAY = new Date(2026, 10, 10);
check('the cycle after September is October', nextCycleOf(cycle).start, '2026-10-01');

const FRIENDS = [
  { id: 'f1', name: '朋友1', amount: 448 },
  { id: 'f2', name: '朋友2', amount: 417.20 },
  { id: 'f3', name: '朋友3', amount: 413.20 },
  { id: 'f4', name: '朋友4', amount: 327.20 },
  { id: 'f5', name: '朋友5', amount: 360 },
];
const HOUSE_BILLS = [
  { id: 'rent', label: '房租', amount: 2000, dueDay: 1 },
  { id: 'time', label: 'TIME', amount: 210.95, dueDay: 1 },
  { id: 'spot', label: 'Spotify', amount: 20.90, dueDay: 1 },
];
const realTab = { id: 'house', label: '房友共摊', bills: HOUSE_BILLS, members: FRIENDS };
const hisIncome = [
  { id: 'pay', label: '工资', amount: 1000, kind: 'income' },
  { id: 'dad', label: '爸爸生活费', amount: 2500, kind: 'income' },
];

// --- the expectation --------------------------------------------------------
check('no members, no expectation — nothing to reserve against yet',
  expectedForCycle({ id: 'x', bills: HOUSE_BILLS }), null);
const exp = expectedForCycle(realTab);
near('expected in = the five friends', exp.expectedIn, 1965.60);
near('expected out = rent + TIME + Spotify', exp.expectedOut, 2231.85);
near('expected net = his own share, 266.25', exp.expectedNet, -266.25);
near('paying out MORE than planned raises it at once (the larger of the two counts)',
  expectedForCycle(realTab, 2331.85).expectedNet, -366.25);
near('paying out less than planned so far does not lower it',
  expectedForCycle(realTab, 2000).expectedNet, -266.25);

// --- 月初先预留: the live month reserves the expected share ----------------
const oct1Lines = budgetLinesForCycle([realTab], [], octCycle);
check('on the 1st, with nothing logged yet, the tab is still on the budget',
  oct1Lines.map(l => [l.id, Math.round(l.expectedNet * 100) / 100]), [['house', -266.25]]);
const oct1 = computeCycleBudget({
  incomeSources: hisIncome, allocations: [], expenses: [], cycle: octCycle, shareLines: oct1Lines, today: OCT_1,
});
near('...reserving his share in 固定开销', oct1.shareCommitted, 266.25);
near('...so the month he can use is 3,233.75 from day one — his own number', oct1.available, 3233.75);
check('...and the breakdown says it is the expected figure, not the actual',
  oct1.shareBreakdown.map(b => b.basis), ['expected']);

// Rent gone on the 1st, only two friends paid by the 10th: the ACTUAL net is
// badly negative, and the live month must not move at all — 「不压」 kept.
const octPartial = [
  { id: 'o1', date: '2026-10-01', merchant: '房租', amount: 2000, shareTabId: 'house', shareTabBillId: 'rent' },
  { id: 'o2', date: '2026-10-02', merchant: 'TIME', amount: 210.95, shareTabId: 'house', shareTabBillId: 'time' },
  { id: 'o3', date: '2026-10-02', merchant: 'Spotify', amount: 20.90, shareTabId: 'house', shareTabBillId: 'spot' },
  { id: 'o4', date: '2026-10-05', merchant: '朋友1', amount: -448, isMoneyIn: true, shareTabId: 'house', shareTabMemberId: 'f1' },
  { id: 'o5', date: '2026-10-06', merchant: '朋友3', amount: -413.20, isMoneyIn: true, shareTabId: 'house', shareTabMemberId: 'f3' },
];
const octPartialBudget = computeCycleBudget({
  incomeSources: hisIncome, allocations: [], expenses: octPartial, cycle: octCycle,
  shareLines: budgetLinesForCycle([realTab], octPartial, octCycle), today: OCT_DAY,
});
near('rent paid, three friends still to pay: the reserve is still 266.25', octPartialBudget.shareCommitted, 266.25);
near('...and the month still reads 3,233.75', octPartialBudget.available, 3233.75);

// Once October is over, the month settles on what really happened: friend 2
// never paid, so his real share that month was 683.45, not 266.25.
const octMissing = [
  ...octPartial,
  { id: 'o6', date: '2026-10-07', merchant: '朋友4', amount: -327.20, isMoneyIn: true, shareTabId: 'house', shareTabMemberId: 'f4' },
  { id: 'o7', date: '2026-10-08', merchant: '朋友5', amount: -360, isMoneyIn: true, shareTabId: 'house', shareTabMemberId: 'f5' },
];
const octEnded = computeCycleBudget({
  incomeSources: hisIncome, allocations: [], expenses: octMissing, cycle: octCycle,
  shareLines: budgetLinesForCycle([realTab], octMissing, octCycle), today: NOV_DAY,
});
near('an ended month settles on the ACTUAL net', octEnded.shareCommitted, 683.45);
check('...and says so', octEnded.shareBreakdown.map(b => b.basis), ['actual']);

// A tab planned to come out ahead: nothing reserved, and the surplus is NOT
// banked while the month is live.
const aheadTab = { id: 'ahead', label: '多收的', bills: [{ id: 'b', label: 'x', amount: 100 }], members: [{ id: 'm', name: 'A', amount: 150 }] };
const ahead = computeCycleBudget({
  incomeSources: hisIncome, allocations: [], expenses: [], cycle: octCycle,
  shareLines: budgetLinesForCycle([aheadTab], [], octCycle), today: OCT_DAY,
});
check('an expected surplus reserves nothing and banks nothing early',
  [ahead.shareCommitted, ahead.shareIncome, ahead.available], [0, 0, 3500]);

// --- 平均分到那几个月: a prepayment spread over the months it is for --------
const prepay = {
  id: 'pp', date: '2026-09-27', merchant: '朋友2', amount: -1251.60, isMoneyIn: true,
  shareTabId: 'house', shareTabMemberId: 'f2', coversFrom: '2026-10-01', coversMonths: 3,
};
check('a spread record covers exactly the months it names',
  coveredCycleStarts(prepay), ['2026-10-01', '2026-11-01', '2026-12-01']);
check('...and an ordinary record covers none (it belongs to its date)', coveredCycleStarts(octPartial[0]), null);
check('isSpread tells the two apart', [isSpread(prepay), isSpread(octPartial[0])], [true, false]);
near('nothing of it lands in September, the month it arrived', portionIn(prepay, cycle), 0);
near('a third lands in October', portionIn(prepay, octCycle), -417.20);
near('...and a third in December', portionIn(prepay, getCycle(new Date(2026, 11, 5))), -417.20);
check('September\'s tab does not see it', tabRecords(realTab, [prepay], cycle), []);
check('October\'s does', tabRecords(realTab, [prepay], octCycle).map(e => e.id), ['pp']);
check('a spread crosses the new year cleanly',
  coveredCycleStarts({ coversFrom: '2026-11-01', coversMonths: 3 }), ['2026-11-01', '2026-12-01', '2027-01-01']);
const thirds = [0, 1, 2].map(i => portionIn(
  { amount: 100, coversFrom: '2026-10-01', coversMonths: 3 },
  getCycle(new Date(2026, 9 + i, 5))));
check('an uneven split goes to the sen, odd sen first', thirds, [33.34, 33.33, 33.33]);
near('...and always adds back up to exactly what was paid', thirds.reduce((a, b) => a + b, 0), 100, 0.0001);

// October with friend 2's prepayment spread into it: everyone is square.
const octWithPrepay = [...octMissing, prepay];
const octSquare = tabCycle(realTab, octWithPrepay, octCycle);
near('with the prepayment spread in, October nets exactly his share', octSquare.net, -266.25);
// Filed by date instead (no coverage), September would have read as a windfall.
const septByDate = tabCycle(realTab, [{ ...prepay, coversFrom: null, coversMonths: null }], cycle);
near('unspread, the whole 1,251.60 lands on the day it arrived', septByDate.received, 1251.60);

// --- who has paid ------------------------------------------------------------
const octStatus = membersStatus(realTab, octMissing, octCycle);
check('each friend\'s month, in the order he listed them',
  octStatus.map(m => [m.name, m.state]),
  [['朋友1', 'paid'], ['朋友2', 'unpaid'], ['朋友3', 'paid'], ['朋友4', 'paid'], ['朋友5', 'paid']]);
near('...with what the unpaid one still owes', octStatus.find(m => m.id === 'f2').short, 417.20);
const withSpread = membersStatus(realTab, octWithPrepay, octCycle);
check('the spread prepayment counts as friend 2\'s October', withSpread.find(m => m.id === 'f2').state, 'paid');
const unspreadSept = membersStatus(realTab, [{ ...prepay, date: '2026-09-27', coversFrom: null, coversMonths: null }], cycle);
check('an unspread prepayment reads as OVER — the cue to offer spreading it',
  [unspreadSept.find(m => m.id === 'f2').state, Math.round(unspreadSept.find(m => m.id === 'f2').extra * 100) / 100],
  ['over', 834.40]);
check('a tab with no members has no status list', membersStatus(tab, sept, cycle), []);

// --- recognising who sent it, and for how long --------------------------------
check('448 is friend 1, one month', suggestMember(realTab, { amount: 448 }), { memberId: 'f1', months: 1, by: 'amount' });
check('1,251.60 is friend 2, three months', suggestMember(realTab, { amount: 1251.60 }), { memberId: 'f2', months: 3, by: 'amount' });
check('a name wins over the amount', suggestMember(realTab, { amount: 50, merchant: ' 朋友3 ' }), { memberId: 'f3', months: 1, by: 'name' });
check('an amount matching nobody is no suggestion, not a guess', suggestMember(realTab, { amount: 100 }), null);
check('two members whose amounts both fit is a coin toss — no answer',
  suggestMember({ members: [{ id: 'a', name: 'A', amount: 200 }, { id: 'b', name: 'B', amount: 200 }] }, { amount: 200 }), null);
check('a tab with no members suggests nothing', suggestMember(tab, { amount: 448 }), null);

const learned = learnMemberAlias([realTab], 'house', 'f2', 'YAP  Lee Chin');
check('a sender name he confirmed is learned for that member',
  learned[0].members.find(m => m.id === 'f2').aliases, ['yap lee chin']);
check('...after which the name alone is enough',
  suggestMember(learned[0], { amount: 417.20, merchant: 'Yap Lee Chin' }), { memberId: 'f2', months: 1, by: 'name' });
check('learning a name already known changes nothing (same list back)',
  learnMemberAlias(learned, 'house', 'f2', 'yap lee chin') === learned, true);
check('...nor does the member\'s own name', learnMemberAlias([realTab], 'house', 'f1', '朋友1')[0] === realTab, true);

const septPaid = [{ id: 's2', date: '2026-09-05', merchant: '朋友2', amount: -417.20, shareTabId: 'house', shareTabMemberId: 'f2' }];
check('September already paid, so 3 months sent on 27 Sept cover October to December',
  suggestCoverage(realTab, 'f2', 3, '2026-09-27', septPaid), { coversFrom: '2026-10-01', coversMonths: 3 });
check('September NOT paid, so the same 3 months start with September',
  suggestCoverage(realTab, 'f2', 3, '2026-09-27', []), { coversFrom: '2026-09-01', coversMonths: 3 });
check('an ordinary monthly payment into an unpaid month needs no fields at all',
  suggestCoverage(realTab, 'f2', 1, '2026-09-27', []), null);
check('...but one month sent when this month is already paid is next month\'s',
  suggestCoverage(realTab, 'f2', 1, '2026-09-27', septPaid), { coversFrom: '2026-10-01', coversMonths: 1 });
check('the record being edited does not count as already having paid',
  suggestCoverage(realTab, 'f2', 1, '2026-09-27', septPaid, 's2'), null);

check('how a spread reads on a row', coverageLabel(prepay), '10–12 月');
check('a late payment for one month', coverageLabel({ coversFrom: '2026-09-01', coversMonths: 1 }), '9 月的');
check('across the new year', coverageLabel({ coversFrom: '2026-11-01', coversMonths: 3 }), '2026年11月–2027年1月');
check('an unspread record has no label', coverageLabel(octPartial[0]), null);

// --- the other readers see portions, not amounts ------------------------------
const timePrepaid = { id: 'tp', date: '2026-10-02', merchant: 'TIME', amount: 632.85, shareTabId: 'house', coversFrom: '2026-10-01', coversMonths: 3 };
check('a bill paid three months ahead shows its one-month portion as a chip',
  outgoings(realTab, [timePrepaid], octCycle).map(e => [e.merchant, e.portion]), [['TIME', 210.95]]);
check('contributors count portions too',
  contributors(realTab, [prepay], octCycle), [{ name: '朋友2', paid: 417.20 }]);

// --- members, managed ---------------------------------------------------------
const m1 = addTabMember([tab], 'rt', { id: 'x1', name: '阿明', amount: 400 });
check('adding a member leaves the original tab alone', tab.members, undefined);
check('...and appears on the copy', m1[0].members.map(m => m.name), ['阿明']);
check('editing a member changes only that field',
  updateTabMember(m1, 'rt', 'x1', { amount: 420 })[0].members[0], { id: 'x1', name: '阿明', amount: 420 });
check('removing a member drops just them', removeTabMember(m1, 'rt', 'x1')[0].members, []);

// --- moving records between tabs clears what named the old tab ---------------
const linked = { id: 'L', amount: -417.20, shareTabId: 'house', shareTabBillId: 'b', shareTabMemberId: 'f2', coversFrom: '2026-10-01', coversMonths: 3 };
check('out of a tab, every tab-scoped field goes with it',
  (({ shareTabId, shareTabBillId, shareTabMemberId, coversFrom, coversMonths }) =>
    [shareTabId, shareTabBillId, shareTabMemberId, coversFrom, coversMonths])(withoutTab(linked)),
  [null, null, null, null, null]);
check('into the same tab is no change at all', intoTab(linked, 'house') === linked, true);
const moved = intoTab(linked, 'other');
check('into a different tab drops the old tab\'s bill and member, keeps the months',
  [moved.shareTabId, moved.shareTabBillId, moved.shareTabMemberId, moved.coversMonths], ['other', null, null, 3]);
check('detaching a whole tab clears the new fields too',
  detachTabRecords('house', [linked]).map(e => [e.shareTabMemberId, e.coversFrom]), [[null, null]]);

// --- the settle banner can name who fell short --------------------------------
const bannerLive = getCycle();
const bannerPrev = getPreviousCycle(bannerLive);
const bannerData = [
  { id: 'bn1', date: bannerPrev.start, merchant: '房租', amount: 2000, shareTabId: 'house' },
  { id: 'bn2', date: bannerPrev.start, merchant: '朋友1', amount: -448, shareTabId: 'house', shareTabMemberId: 'f1' },
];
const bannerCycles = unsettledCycles(realTab, bannerData, bannerLive);
check('an ended month carries each member\'s status for the banner',
  bannerCycles[0].members.filter(m => m.state !== 'paid').map(m => m.name), ['朋友2', '朋友3', '朋友4', '朋友5']);
near('...and its expected net alongside the actual one', bannerCycles[0].expectedNet, -266.25);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
