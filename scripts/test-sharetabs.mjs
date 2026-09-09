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
  contributors, outgoings,
} from '../src/utils/shareTabs.js';
import { getCycle, computeCycleBudget } from '../src/utils/cycle.js';

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

const withTab = computeCycleBudget({ incomeSources: income, allocations: [], expenses: sept, cycle, shareLines: lines });
const noTab = computeCycleBudget({ incomeSources: income, allocations: [], expenses: sept, cycle });

near('the net joins 固定开销 exactly once', withTab.shareCommitted, 1062.94);
near('...and is reported on its own so the screen can name it', withTab.committed, 1062.94);
near('the RM2,000 rent is NOT spending', withTab.grossSpentThisCycle, 16.50);
near('...and the housemates\' money is NOT income', withTab.spendableIncome, 2500);
near('...nor an unfiled arrival needing to be explained away', withTab.arrivedUnlinked, 0);
near('so the month is income − net, and nothing double-counted',
  withTab.available, 2500 - 1062.94 - 16.50);

// The same records with no `shareLines` passed still must not leak in through
// the individual totals — the exclusion is driven by the record, not the call.
near('a tabbed record never counts as spending, even if the caller forgets the lines',
  noTab.grossSpentThisCycle, 16.50);
near('...and never as an arrival either', noTab.arrivedThisCycle, 0);

// 「多的算收入」 end to end.
const octBudget = computeCycleBudget({
  incomeSources: income, allocations: [], expenses: octLatecomers, cycle: next,
  shareLines: budgetLinesForCycle([tab], octLatecomers, next),
});
near('a positive net raises the month\'s income instead', octBudget.spendableIncome, 2500 + 354.34);
near('...and commits nothing', octBudget.shareCommitted, 0);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
