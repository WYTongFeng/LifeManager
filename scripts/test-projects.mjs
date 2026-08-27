import { getProjects, getOpenProjects, findProjectFor, getDebtorStatus } from '../src/utils/projects.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// A dinner fronted for the group, partially repaid across two later days.
const expenses = [
  { id: 1, date: '2026-08-12', merchant: 'Group Dinner', amount: 100, isProject: true },
  { id: 2, date: '2026-08-13', merchant: 'Ah Meng', amount: -30, repaysExpenseId: 1 },
  { id: 3, date: '2026-08-15', merchant: 'Wei Jie', amount: -25, repaysExpenseId: 1 },
  // An unrelated regular expense and an unrelated standalone refund — must
  // not be swept into the project's total.
  { id: 4, date: '2026-08-13', merchant: 'Petrol', amount: 40 },
  { id: 5, date: '2026-08-14', merchant: 'Someone else', amount: -10 },
];

const projects = getProjects(expenses);
check('exactly one project found', projects.length, 1);
check('repaid amount sums only this project\'s repayments', projects[0].repaidAmount, 55);
check('outstanding = original - repaid', projects[0].outstanding, 45);
check('not settled while outstanding > 0', projects[0].isSettled, false);
check('open projects includes it', getOpenProjects(expenses).map(p => p.id), [1]);

// Fully repaid, possibly with an overpayment.
const settled = [
  { id: 1, date: '2026-08-12', merchant: 'Group Dinner', amount: 100, isProject: true },
  { id: 2, date: '2026-08-13', merchant: 'Ah Meng', amount: -110, repaysExpenseId: 1 },
];
const settledProjects = getProjects(settled);
check('overpayment does not push outstanding negative', settledProjects[0].outstanding, 0);
check('overpaid project is settled', settledProjects[0].isSettled, true);
check('settled projects drop out of the open list', getOpenProjects(settled).length, 0);

// A repayment with no project link.
const standalone = [
  { id: 1, date: '2026-08-12', merchant: 'Random refund', amount: -20 },
];
check('no projects when nothing is marked', getProjects(standalone).length, 0);
check('findProjectFor returns null when unlinked', findProjectFor(standalone[0], []), null);

// findProjectFor resolves the right one among several.
const multi = [
  { id: 1, merchant: 'Dinner A', amount: 100, isProject: true },
  { id: 2, merchant: 'Dinner B', amount: 50, isProject: true },
  { id: 3, merchant: 'Repays B', amount: -50, repaysExpenseId: 2 },
];
const multiProjects = getProjects(multi);
check('findProjectFor picks the correct project by id',
  findProjectFor(multi[2], multiProjects)?.merchant, 'Dinner B');

// --- per-debtor status: "who hasn't paid me back" --------------------------
// One project, three expected contributors: one paid in full, one paid in two
// partial transfers across two different days, one hasn't paid anything.
const dinnerWithDebtors = [
  {
    id: 1, date: '2026-08-12', merchant: 'Group Dinner', amount: 90, isProject: true,
    debtors: [{ name: 'Ah Meng', share: 30 }, { name: 'Wei Jie', share: 30 }, { name: 'Su Lin', share: 30 }],
  },
  { id: 2, date: '2026-08-13', merchant: 'Ah Meng', amount: -30, repaysExpenseId: 1 },
  // Wei Jie pays in two parts, across two different days AND with mismatched
  // case — both must still count toward the same person.
  { id: 3, date: '2026-08-14', merchant: 'Wei Jie', amount: -10, repaysExpenseId: 1 },
  { id: 4, date: '2026-08-16', merchant: 'wei jie', amount: -20, repaysExpenseId: 1 },
  // A repayment for a DIFFERENT project must not be attributed here.
  { id: 5, date: '2026-08-13', merchant: 'Ah Meng', amount: -999, repaysExpenseId: 99 },
];

const [dinnerProject] = getProjects(dinnerWithDebtors);
const debtorStatus = getDebtorStatus(dinnerProject, dinnerWithDebtors);
check('one status entry per listed debtor', debtorStatus.length, 3);
check('Ah Meng fully paid',
  debtorStatus.find(s => s.name === 'Ah Meng'), { id: 0, name: 'Ah Meng', share: 30, paid: 30, owing: 0, isPaid: true });
check('Wei Jie\'s split, cross-day, case-mismatched payments sum together',
  debtorStatus.find(s => s.name === 'Wei Jie').paid, 30);
check('Wei Jie counts as paid once the sum reaches their share',
  debtorStatus.find(s => s.name === 'Wei Jie').isPaid, true);
check('Su Lin has paid nothing yet',
  debtorStatus.find(s => s.name === 'Su Lin'), { id: 2, name: 'Su Lin', share: 30, paid: 0, owing: 30, isPaid: false });
check('who hasn\'t paid, derived from status', debtorStatus.filter(d => !d.isPaid).map(d => d.name), ['Su Lin']);

// A repayment from a name that matches none of the listed debtors — must not
// be silently dropped from the project total (it still reduces what's owed
// overall) and must not be mis-attributed to whichever debtor is still short,
// which would wrongly mark a stranger's payment as someone else's.
const unmatchedRepayment = [
  {
    id: 1, merchant: 'Group Dinner', amount: 90, isProject: true,
    debtors: [{ name: 'Ah Meng', share: 30 }, { name: 'Wei Jie', share: 30 }, { name: 'Su Lin', share: 30 }],
  },
  { id: 2, merchant: 'Random Stranger', amount: -30, repaysExpenseId: 1 },
];
const [unmatchedProj] = getProjects(unmatchedRepayment);
check('an unattributed repayment still counts toward the project total', unmatchedProj.repaidAmount, 30);
check('but is not credited to any specific debtor',
  getDebtorStatus(unmatchedProj, unmatchedRepayment).every(d => d.paid === 0), true);

// A project with no debtors list configured — must degrade to empty, not throw.
const [noDebtorsProj] = getProjects([{ id: 1, merchant: 'Solo lunch', amount: 20, isProject: true }]);
check('no debtors configured -> empty status, not an error', getDebtorStatus(noDebtorsProj, []), []);

// Overpaying a share doesn't produce a negative "owing".
const overpaid = [
  { id: 1, merchant: 'Trip', amount: 50, isProject: true, debtors: [{ name: 'Ah Meng', share: 25 }] },
  { id: 2, merchant: 'Ah Meng', amount: -40, repaysExpenseId: 1 },
];
const [tripProj] = getProjects(overpaid);
const tripStatus = getDebtorStatus(tripProj, overpaid);
check('overpaying a share floors owing at 0', tripStatus[0].owing, 0);
check('overpaying still counts as paid', tripStatus[0].isPaid, true);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
