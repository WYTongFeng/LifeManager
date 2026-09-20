// recordOwnership — one label per record, read in the same priority order
// the form and the budget arithmetic already agree on (see shareTabs.js's
// "two machineries must never both count the same record" test in
// test-sharetabs.mjs). This file only has to prove the label matches that
// order, including the conflicted cases a restored backup can produce.

import { recordOwnership, OWNERSHIP, OWNERSHIP_FILTERS } from '../src/utils/recordOwnership.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

check('a plain expense is 还没归类', recordOwnership({ id: 1, amount: 16.50, merchant: 'x' }), OWNERSHIP.PLAIN);
check('a tabbed record is 共摊本', recordOwnership({ id: 2, shareTabId: 'rt' }), OWNERSHIP.SHARE_TAB);
check('a fronted project is 项目', recordOwnership({ id: 3, isProject: true }), OWNERSHIP.PROJECT);
check('a project repayment is also 项目', recordOwnership({ id: 4, repaysExpenseId: 3 }), OWNERSHIP.PROJECT);
check('a debt repayment is 欠款', recordOwnership({ id: 5, repaysDebtId: 'd1' }), OWNERSHIP.DEBT);
check('a bill payment is 固定月费', recordOwnership({ id: 6, allocationId: 'a1' }), OWNERSHIP.BILL);
check('a transfer half is 户口转账, ahead of everything else',
  recordOwnership({ id: 7, isAccountTransfer: true, allocationId: 'a1' }), OWNERSHIP.TRANSFER);
check('null/undefined does not throw', recordOwnership(null), OWNERSHIP.PLAIN);
check('missing entirely does not throw', recordOwnership(undefined), OWNERSHIP.PLAIN);

// Conflicted records — a restored backup or an older build can carry more
// than one tag. 共摊本 must win, matching cycle.js's own arithmetic (it folds
// a record into the tab's net and refuses to also charge it to an allocation
// or a project — see test-sharetabs.mjs's 「两个机制都不能算」 case).
check('shareTabId wins over allocationId',
  recordOwnership({ id: 8, shareTabId: 'rt', allocationId: 'a1' }), OWNERSHIP.SHARE_TAB);
// projects.js's own getProjects() filters `isProject && shareTabId == null`
// — a record wearing both tags is never treated as a project. This has to
// agree with that, or the badge shown here would call something 项目 that
// the 进行中的项目 list has already silently dropped.
check('shareTabId wins over isProject too',
  recordOwnership({ id: 9, shareTabId: 'rt', isProject: true }), OWNERSHIP.SHARE_TAB);

check('the filter list always offers exactly one 全部 option plus the five kinds',
  OWNERSHIP_FILTERS.map(f => f.value), ['', OWNERSHIP.SHARE_TAB, OWNERSHIP.PROJECT, OWNERSHIP.DEBT, OWNERSHIP.BILL, OWNERSHIP.PLAIN]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
