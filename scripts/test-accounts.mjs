// Accounts: derived balances, the net-worth exclusion toggle, and the
// migration path from hand-typed balances.

import {
  ensureAccounts, normalizeAccount, derivedBalance, resolveAccounts,
  reconcileAccount, spendByAccount, accountForPackage, watchedPackages,
  defaultAccount, accountById, makeTransfer, isTransferRecord, TNG_ACCOUNT_ID,
  txType, isRealSpend, isSpendingRecord,
} from '../src/utils/accounts.js';
import { computeNetPosition, getWaterfallOrder } from '../src/utils/networth.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const r2 = n => Number(n.toFixed(2));

// --- seeding ---------------------------------------------------------------
const seeded = ensureAccounts([]);
check('empty storage gets a TNG account', seeded.length, 1);
check('and it is the default', seeded[0].isDefault, true);
check('and it watches the TNG packages', seeded[0].packages.length, 2);
check('defaultAccount finds it', defaultAccount(seeded).id, TNG_ACCOUNT_ID);

// An existing hand-made TNG account must be adopted, never duplicated —
// otherwise every real user wakes up with two TNG wallets.
const adopted = ensureAccounts([
  { id: 99, name: 'TNG eWallet', balance: 40.22, kind: 'own' },
  { id: 2, name: 'GX Bank', balance: 20, kind: 'own' },
]);
check('existing TNG is adopted, not duplicated', adopted.length, 2);
check('adopted TNG became the default', defaultAccount(adopted).id, 99);
check('adopted TNG picked up the packages', adopted[0].packages.length, 2);

// --- migrating a typed balance --------------------------------------------
const legacy = normalizeAccount({ id: 1, name: 'HLB', balance: 184.42, kind: 'own' });
check('typed balance becomes the opening balance', legacy.openingBalance, 184.42);
check('legacy account counts toward net worth', legacy.countsToNetWorth, true);

// The regression this guards: a hand-typed balance was ALREADY net of past
// spending. Baselining it at t=0 would subtract the whole expense history from
// it a second time and open the app on a number that was never real.
const history = [
  { id: 1, at: Date.now() - 86400000, accountId: 1, amount: 60 },
  { id: 2, at: Date.now() - 3600000, accountId: 1, amount: 40 },
];
check('an un-stamped account ignores everything logged before now',
  r2(derivedBalance(legacy, history)), 184.42);
check('but still counts anything logged after it',
  r2(derivedBalance(legacy, [...history, { id: 3, at: Date.now() + 1000, accountId: 1, amount: 4.42 }])), 180);

// The whole point of the epoch watermark: expenses already baked into a
// hand-typed balance must not be subtracted from it a second time.
const migrated = normalizeAccount({ id: 1, name: 'HLB', balance: 184.42, kind: 'own', openingAt: 5000 });
const spend = [
  { id: 1, at: 1000, accountId: 1, amount: 50 },   // before the watermark
  { id: 2, at: 9000, accountId: 1, amount: 20 },   // after
  { id: 3, at: 9500, accountId: 2, amount: 999 },  // different account
];
check('only movement after the watermark is subtracted', r2(derivedBalance(migrated, spend)), 164.42);

// --- refunds add back ------------------------------------------------------
const withRefund = [
  { id: 1, at: 100, accountId: 'tng', amount: 30 },
  { id: 2, at: 200, accountId: 'tng', amount: -10 },
];
const tng = normalizeAccount({ id: 'tng', name: 'TNG', openingBalance: 100, openingAt: 0 });
check('a refund puts the money back', r2(derivedBalance(tng, withRefund)), 80);

// --- reconcile -------------------------------------------------------------
const reconciled = reconcileAccount(tng, 42.10, 500);
check('reconcile sets the new opening balance', reconciled.openingBalance, 42.10);
check('reconcile moves the watermark', reconciled.openingAt, 500);
// Both movements above predate the reconcile at t=500, so neither counts —
// that IS the point: correcting a balance never re-applies history to it.
check('nothing before a reconcile counts', r2(derivedBalance(reconciled, withRefund)), 42.10);
check('spend after a reconcile does count',
  r2(derivedBalance(reconciled, [...withRefund, { id: 3, at: 900, accountId: 'tng', amount: 12.10 }])), 30);

// --- countsToNetWorth ------------------------------------------------------
const mixed = resolveAccounts([
  { id: 'tng', name: 'TNG', kind: 'own', openingBalance: 200, openingAt: 0 },
  { id: 2, name: 'Dad card', kind: 'own', countsToNetWorth: false, openingBalance: 5000, openingAt: 0 },
  { id: 3, name: 'PBE', kind: 'custodial', openingBalance: 13331.4, target: 15269, openingAt: 0 },
], []);

const pos = computeNetPosition(mixed, []);
check('excluded account stays out of own cash', r2(pos.ownCash), 200);
check('excluded balance is reported separately', r2(pos.excludedHeld), 5000);
check('one account is excluded', pos.excludedCount, 1);
check('custodial still reported as held', r2(pos.custodialHeld), 13331.4);
check('custodial shortfall is still a debt', r2(pos.custodialShortfall), 1937.60);
check('RM200 liquid trips survival mode despite RM5000 excluded', pos.inSurvivalMode, true);

// A tracked-only account must not make you feel rich. That's the whole ask.
check('net position ignores the RM5000', r2(pos.netPosition), r2(200 - 1937.60));

// --- spending from an excluded account still records -----------------------
const excludedSpend = resolveAccounts([
  { id: 2, name: 'Dad card', kind: 'own', countsToNetWorth: false, openingBalance: 5000, openingAt: 0 },
], [{ id: 1, at: 10, accountId: 2, amount: 120 }]);
check('excluded account balance still moves when spent',
  r2(accountById(excludedSpend, 2).balance), 4880);
check('and still contributes nothing to net worth',
  r2(computeNetPosition(excludedSpend.filter(a => a.id === 2), []).ownCash), 0);

// --- archived accounts drop out entirely -----------------------------------
const withArchived = resolveAccounts([
  { id: 'tng', name: 'TNG', kind: 'own', openingBalance: 100, openingAt: 0 },
  { id: 9, name: 'Old card', kind: 'own', openingBalance: 900, openingAt: 0, archived: true },
], []);
check('archived account excluded from own cash', r2(computeNetPosition(withArchived, []).ownCash), 100);

// --- per-account breakdown -------------------------------------------------
const accountsForBreakdown = resolveAccounts([
  { id: 'tng', name: 'TNG', kind: 'own', openingBalance: 0, openingAt: 0 },
  { id: 2, name: 'Maybank', kind: 'own', openingBalance: 0, openingAt: 0 },
], []);
const breakdown = spendByAccount([
  { id: 1, at: 1, accountId: 'tng', amount: 16.5 },
  { id: 2, at: 2, accountId: 'tng', amount: 3.2 },
  { id: 3, at: 3, accountId: 2, amount: 80 },
  { id: 4, at: 4, accountId: 'tng', amount: -5 },
  { id: 5, at: 5, amount: 12 }, // never said which account
], accountsForBreakdown);
check('breakdown sorted by spend, biggest first', breakdown.map(b => b.account.name),
  ['Maybank', 'TNG', '未指定户口']);
check('TNG gross spend excludes the refund', r2(breakdown.find(b => b.account.name === 'TNG').spent), 19.70);
check('TNG received counted separately', r2(breakdown.find(b => b.account.name === 'TNG').received), 5);
check('unassigned expenses are surfaced, not hidden',
  breakdown.some(b => b.account.id === '__unassigned'), true);

// --- package binding -------------------------------------------------------
const bound = ensureAccounts([
  { id: 'tng', name: 'TNG', kind: 'own', packages: ['my.com.tngdigital.ewallet'] },
  { id: 2, name: 'Maybank', kind: 'own', packages: ['com.maybank2u.life'] },
]);
check('package maps to the right account',
  accountForPackage(bound, 'com.maybank2u.life').name, 'Maybank');
check('unknown package maps to nothing', accountForPackage(bound, 'com.whatsapp'), null);
check('watch list is the union of every account', watchedPackages(bound).length, 2);
check('accountById tolerates string/number id mismatch', accountById(bound, '2').name, 'Maybank');

// --- transfers between your own accounts -----------------------------------
// The hole this fills: an unrecorded transfer breaks BOTH balances (the source
// keeps money it no longer has, the destination is missing money it does), and
// one recorded as a plain expense reads as RM100 of spending.
const transferAccounts = resolveAccounts([
  { id: 'tng', name: 'TNG', kind: 'own', openingBalance: 50, openingAt: 0 },
  { id: 2, name: 'Maybank', kind: 'own', openingBalance: 500, openingAt: 0 },
], []);

const pair = makeTransfer({
  fromAccountId: 2, toAccountId: 'tng', amount: 100,
  note: 'top up', accounts: transferAccounts, at: 1000,
});
check('a transfer is a linked PAIR of records', pair.length, 2);
check('money leaves the source as a positive amount', pair[0].amount, 100);
check('and arrives at the destination as a negative one', pair[1].amount, -100);
check('both halves share a transferId', pair[0].transferId === pair[1].transferId, true);
check('the two ids never collide', pair[0].id === pair[1].id, false);
check('both are flagged as transfers', pair.every(isTransferRecord), true);
check('the source row names where it went', pair[0].merchant, '转去 TNG');
check('the destination row names where it came from', pair[1].merchant, '从 Maybank 转入');

// The whole reason for the pair shape: both balances move correctly with no
// new arithmetic anywhere, because every balance is already a signed sum.
const afterTransfer = resolveAccounts([
  { id: 'tng', name: 'TNG', kind: 'own', openingBalance: 50, openingAt: 0 },
  { id: 2, name: 'Maybank', kind: 'own', openingBalance: 500, openingAt: 0 },
], pair);
check('the source is RM100 lighter', r2(accountById(afterTransfer, 2).balance), 400);
check('the destination is RM100 heavier', r2(accountById(afterTransfer, 'tng').balance), 150);
check('total money is unchanged',
  r2(accountById(afterTransfer, 2).balance + accountById(afterTransfer, 'tng').balance), 550);

// And it must not read as spending anywhere.
check('a transfer nets to zero in any signed total',
  r2(pair.reduce((sum, e) => sum + e.amount, 0)), 0);
check('and is excluded from the spend breakdown entirely',
  spendByAccount(pair, transferAccounts).length, 0);
check('while real spending alongside it still counts',
  r2(spendByAccount([...pair, { id: 9, at: 2000, accountId: 'tng', amount: 12 }], transferAccounts)
    .reduce((sum, b) => sum + b.spent, 0)), 12);

// Guards against a transfer that silently does nothing or invents money.
check('transferring to the same account is refused',
  makeTransfer({ fromAccountId: 2, toAccountId: 2, amount: 100, accounts: transferAccounts }), []);
check('a zero transfer is refused',
  makeTransfer({ fromAccountId: 2, toAccountId: 'tng', amount: 0, accounts: transferAccounts }), []);
check('a negative amount is normalised, never inverted',
  makeTransfer({ fromAccountId: 2, toAccountId: 'tng', amount: -100, accounts: transferAccounts, at: 1 })[0].amount, 100);
check('a plain expense is not mistaken for a transfer',
  isTransferRecord({ id: 1, amount: 10 }), false);

// --- normalization must not eat fields the balance maths reads -------------
//
// `normalizeAccount` builds an explicit object rather than spreading `...a`,
// which is right — but that makes an omission invisible. `autoShortfallDebt`
// was omitted, so the 「差额我自己记」 toggle wrote a flag that every single
// read then deleted before networth.js could see it: the setting saved, showed
// as saved, and did nothing. Worse, an account edit writes the normalized list
// back to storage, so the flag was destroyed on disk too.
//
// Tested through resolveAccounts, not normalizeAccount directly, because that
// is the path every screen actually uses — computeNetPosition's own tests pass
// hand-built objects that never go through normalization, which is exactly why
// they never caught this.
const optOut = resolveAccounts(
  [{ id: 'pbe', name: 'PBE', kind: 'custodial', openingBalance: 500, openingAt: 0, target: 3000, autoShortfallDebt: false }],
  []
);
const pbe = optOut.find(a => a.id === 'pbe');
check('an opted-out account keeps its flag through a read', pbe.autoShortfallDebt, false);
check('...so its shortfall is NOT counted as a debt',
  computeNetPosition(optOut, []).custodialShortfall, 0);
check('...and it stays out of the repayment waterfall',
  getWaterfallOrder(optOut, []).filter(i => i.id === 'reserve:pbe').length, 0);

const optIn = resolveAccounts(
  [{ id: 'pbe', name: 'PBE', kind: 'custodial', openingBalance: 500, openingAt: 0, target: 3000 }],
  []
);
check('an account that never asked still defaults to counting it',
  optIn.find(a => a.id === 'pbe').autoShortfallDebt, true);
check('...and its shortfall is a debt, as before',
  computeNetPosition(optIn, []).custodialShortfall, 2500);

// --- one classifier, six kinds ------------------------------------------------
// A record's kind was never stored — every total re-derived it by hand from
// four optional flags and the sign of the amount, and they drifted apart. See
// txType in accounts.js.
const kinds = (list) => list.map(txType);

check('a plain purchase', txType({ amount: 16.5 }), 'expense');
check('money arriving from outside', txType({ amount: -1000, isMoneyIn: true }), 'income');
check('someone paying you back', txType({ amount: -30 }), 'refund');
check('moving your own money', txType({ amount: 100, isAccountTransfer: true }), 'transfer');
check('...including the receiving half, which looks exactly like an arrival',
  txType({ amount: -100, isAccountTransfer: true, isMoneyIn: true }), 'transfer');
check('paying down a debt', txType({ amount: 200, repaysDebtId: 7 }), 'repayment');
check('paying a fixed monthly bill', txType({ amount: 500, allocationId: 'a1' }), 'bill');

// The overlaps are why the order in txType is not arbitrary.
check('a transfer outranks the sign', txType({ amount: -50, isAccountTransfer: true }), 'transfer');
check('an arrival outranks the sign', txType({ amount: -50, isMoneyIn: true }), 'income');
check('a repayment outranks a bare positive amount', txType({ amount: 50, repaysDebtId: 1 }), 'repayment');

// A stored type wins, so a record from a future build can say what it is even
// if this version has never heard of the flag that would imply it.
check('a stored type wins over the flags', txType({ amount: 50, type: 'bill' }), 'bill');
check('a nonsense stored type falls back to deriving',
  txType({ amount: -50, isMoneyIn: true, type: 'banana' }), 'income');
check('junk in is not a crash', kinds([null, undefined, 'x', {}]), ['expense', 'expense', 'expense', 'expense']);

// 「我这段时间真正花了多少钱」 — exactly one kind counts.
check('only a purchase is real spending',
  [
    isRealSpend({ amount: 16.5 }),
    isRealSpend({ amount: 500, allocationId: 'a1' }),
    isRealSpend({ amount: 200, repaysDebtId: 7 }),
    isRealSpend({ amount: -30 }),
    isRealSpend({ amount: -1000, isMoneyIn: true }),
    isRealSpend({ amount: 100, isAccountTransfer: true }),
  ],
  [true, false, false, false, false, false]);

// The account-facing predicate is a different question and keeps its answer:
// "did money leave my pocket" includes bills and repayments, and a refund's
// negative amount has to net against the spend it reimburses.
check('what moved my balance is a wider net than what I spent',
  [
    isSpendingRecord({ amount: 500, allocationId: 'a1' }),
    isSpendingRecord({ amount: 200, repaysDebtId: 7 }),
    isSpendingRecord({ amount: -30 }),
    isSpendingRecord({ amount: -1000, isMoneyIn: true }),
    isSpendingRecord({ amount: 100, isAccountTransfer: true }),
  ],
  [true, true, true, false, false]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
