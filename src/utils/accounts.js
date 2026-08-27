// Accounts: which pot of money a given ringgit actually came out of.
//
// THE GAP THIS FILLS
// Every expense in this app used to be hardcoded `paymentMethod: "Touch 'n Go
// eWallet"` — a display string, not a link to anything. So the expense log
// could never answer "which account did this come out of", account balances
// never moved when money was spent, and a recurring bill had no idea which
// account it would be deducted from. Accounts existed only as four numbers you
// retyped by hand on a screen nothing else read.
//
// Now an account is a real entity with an id, every expense carries
// `accountId`, and a balance is DERIVED rather than typed:
//
//     balance = openingBalance − (everything spent on this account since openingAt)
//
// `openingAt` is an epoch-ms watermark, not a date, so migrating an existing
// hand-typed balance can't retroactively subtract expenses that were already
// baked into that number. Correcting a balance later ("the bank says RM 42.10")
// is a RECONCILE: it writes a new openingBalance/openingAt pair, which is both
// the fix and an audit point, instead of silently overwriting history.
//
// THREE INDEPENDENT FLAGS, not one `kind` enum
//   kind: 'own' | 'custodial'   — is this money yours at all (see networth.js)
//   countsToNetWorth: boolean   — should the balance count toward savings
//   type: 'ewallet' | 'bank'…   — what it is, for icons/grouping only
//
// `countsToNetWorth` is the user's own ask: some accounts should be tracked and
// spendable-from, and show up in the expense log, but must NOT inflate "how
// much have I got". A parent's account you can draw on, a company card, a
// balance that's really someone else's. Spending from it still records, debts
// against it still count — only the *asset* side is excluded. Folding that into
// `kind` would have been wrong: it's orthogonal to whose money it is.

import { nowTimeStr } from './datetime.js';

/** @typedef {{id:string|number, name:string, type:string, kind:'own'|'custodial',
 *             countsToNetWorth:boolean, openingBalance:number, openingAt:number,
 *             target:number|null, isDefault:boolean, packages:string[],
 *             archived:boolean, color:string}} Account */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * The watermark an account gets when it has none — captured once, at module
 * load, deliberately NOT 0.
 *
 * An account saved before this file existed carried a hand-typed `balance`
 * that was already current: whoever typed "RM 40.22" typed it knowing what had
 * been spent. Treating that as an opening balance at t=0 would subtract the
 * entire expense history from it a second time and report a wildly negative
 * figure the first time the app opened after upgrading.
 *
 * So an un-stamped account behaves exactly as it did before — the typed number
 * IS the balance — until either the v3 migration stamps it properly or the
 * user reconciles. Constant for the whole session so a balance doesn't drift
 * between renders.
 */
const LEGACY_WATERMARK = Date.now();

/** Stable id for the seeded Touch 'n Go account — 99% of this user's spending. */
export const TNG_ACCOUNT_ID = 'tng';

export const ACCOUNT_TYPES = [
  { value: 'ewallet', label: '电子钱包 E-wallet', color: '#4ade80' },
  { value: 'bank', label: '银行户口 Bank', color: '#38bdf8' },
  { value: 'cash', label: '现金 Cash', color: '#facc15' },
  { value: 'credit', label: '信用卡 / 先买后付', color: '#f472b6' },
  { value: 'other', label: '其他 Other', color: '#a78bfa' },
];

export const ACCOUNT_KINDS = [
  { value: 'own', label: '我的钱 Mine' },
  { value: 'custodial', label: '代管 / 不能动 Not mine' },
];

export function typeMeta(type) {
  return ACCOUNT_TYPES.find(t => t.value === type) ?? ACCOUNT_TYPES[4];
}

/**
 * Android notification packages known to belong to an account.
 *
 * Deliberately only the two TNG ones are hardcoded. Every other bank/wallet
 * package name would be a GUESS — get one wrong and the app silently watches
 * nothing while claiming it's on, which is the single worst failure mode for
 * this feature. Other accounts learn their package through discovery mode
 * instead (see tngNative.js `startDiscovery`): the phone reports which app a
 * money notification actually came from, and you bind it to an account by tapping
 * it. No guessing, and it works for banks nobody thought to hardcode.
 */
export const TNG_PACKAGES = ['my.com.tngdigital.ewallet', 'com.touchngo.ewallet'];

/** Names that read as an e-wallet rather than a bank account. */
const WALLET_NAME_RE = /touch\s*'?n\s*go|tng|ewallet|e-wallet|钱包|wallet|boost|grabpay|shopeepay|bigpay/i;

/** The account seeded on first run. Everything defaults to spending from here. */
export function makeTngAccount(openingBalance = 0) {
  return {
    id: TNG_ACCOUNT_ID,
    name: "Touch 'n Go eWallet",
    type: 'ewallet',
    kind: 'own',
    countsToNetWorth: true,
    openingBalance: num(openingBalance),
    // A freshly seeded account starts from this moment: whatever the user has
    // already logged today happened before this account existed as far as the
    // ledger is concerned, and subtracting it would open the app on a balance
    // that was never real.
    openingAt: Date.now(),
    target: null,
    isDefault: true,
    packages: [...TNG_PACKAGES],
    archived: false,
  };
}

/**
 * Fill in every field an account might be missing.
 *
 * Called on READ, never as a one-shot migration, for the same reason
 * SportsModule normalizes exercises on read: an account saved by an older
 * build (or restored from an old backup file months from now) has to keep
 * working forever, not just until one migration ran once.
 */
export function normalizeAccount(a) {
  if (!a || typeof a !== 'object') return null;
  // Pre-accounts.js shape carried a hand-typed `balance` and nothing else.
  const hasOpening = a.openingBalance != null;
  return {
    id: a.id,
    name: a.name ?? '未命名户口',
    // An account from before `type` existed only has a name to go on. A wallet
    // named like a wallet is an e-wallet; everything else defaults to bank,
    // which is what the great majority of un-typed accounts actually are.
    type: a.type ?? (a.id === TNG_ACCOUNT_ID || WALLET_NAME_RE.test(a.name ?? '') ? 'ewallet' : 'bank'),
    kind: a.kind === 'custodial' ? 'custodial' : 'own',
    // Only ever false when explicitly turned off. An older account that
    // predates the flag counted toward net worth, and must keep doing so.
    countsToNetWorth: a.countsToNetWorth !== false,
    // "差额我自己记" — see computeNetPosition in networth.js for what it turns
    // off and why an account with messy inflows needs it.
    //
    // THIS WAS SILENTLY DEAD. Normalization builds an explicit object rather
    // than spreading `...a`, which is the right call (an unknown field from a
    // future build must not reach the balance maths pretending to be one of
    // ours) — but it means every field the app actually uses has to be listed
    // here, and this one never was. AccountsView wrote it, networth.js read it,
    // and in between `resolveAccounts` deleted it on every single read. So the
    // toggle saved, showed as saved when reopened (the form reads storage
    // directly), and changed nothing: the shortfall was still counted as a
    // debt. Worse, every account edit writes the normalized list straight back
    // to storage, so the flag was destroyed on disk the first time any account
    // was touched.
    //
    // Not caught by tests because test-networth.mjs calls computeNetPosition
    // with hand-built account objects, which never pass through here.
    autoShortfallDebt: a.autoShortfallDebt !== false,
    openingBalance: num(hasOpening ? a.openingBalance : a.balance),
    // See LEGACY_WATERMARK: an account with no watermark had its balance typed
    // by hand, already net of everything spent, so nothing before now counts.
    openingAt: a.openingAt == null ? LEGACY_WATERMARK : num(a.openingAt),
    target: a.target == null || a.target === '' ? null : num(a.target),
    isDefault: Boolean(a.isDefault),
    packages: Array.isArray(a.packages) ? a.packages : [],
    archived: Boolean(a.archived),
    // When the balance was last confirmed against the real app/bank. Carried
    // through normalization on purpose: it's the answer to "how much should I
    // trust this number", which is the first thing you want when it looks off.
    reconciledAt: a.reconciledAt == null ? null : num(a.reconciledAt),
  };
}

/**
 * Seed the TNG account when there isn't one, and guarantee exactly one default.
 *
 * Pure: returns a new array, or the SAME array reference when nothing needed
 * changing — callers use that identity check to avoid an infinite
 * write→read→write loop when this runs inside a render.
 */
export function ensureAccounts(raw) {
  const list = (Array.isArray(raw) ? raw : []).map(normalizeAccount).filter(Boolean);

  let changed = list.length !== (Array.isArray(raw) ? raw.length : 0);
  const before = JSON.stringify(raw ?? []);

  // A pre-existing hand-made "TNG eWallet" account gets adopted rather than
  // duplicated — otherwise everyone with real data suddenly has two TNGs.
  let tng = list.find(a => a.id === TNG_ACCOUNT_ID)
    ?? list.find(a => /touch\s*'?n\s*go|tng/i.test(a.name));

  if (!tng) {
    tng = makeTngAccount(0);
    list.unshift(tng);
    changed = true;
  } else if (!tng.packages.length) {
    tng.packages = [...TNG_PACKAGES];
  }

  // Exactly one default, and it's TNG unless the user picked another.
  const defaults = list.filter(a => a.isDefault && !a.archived);
  if (defaults.length !== 1) {
    for (const a of list) a.isDefault = false;
    (defaults[0] ?? tng).isDefault = true;
  }

  if (!changed && JSON.stringify(list) === before) return raw;
  return list;
}

/** Ids compare loosely — 'tng' is a string, user-added ids are Date.now() numbers. */
export function sameId(a, b) {
  return a != null && b != null && String(a) === String(b);
}

export function accountById(accounts, id) {
  return accounts.find(a => sameId(a.id, id)) ?? null;
}

export function defaultAccount(accounts) {
  return accounts.find(a => a.isDefault && !a.archived)
    ?? accounts.find(a => !a.archived)
    ?? null;
}

/**
 * Everything this account has spent since its opening watermark.
 * Signed — a refund's negative amount adds the money back, exactly as it does
 * everywhere else in the app.
 */
export function movementSince(expenses, account) {
  const openingAt = num(account.openingAt);
  return expenses.reduce((sum, e) => {
    if (!sameId(e.accountId, account.id)) return sum;
    if (num(e.at ?? e.id) <= openingAt) return sum;
    return sum + num(e.amount);
  }, 0);
}

/** What's actually in the account right now: opening balance minus what's gone. */
export function derivedBalance(account, expenses = []) {
  return num(account.openingBalance) - movementSince(expenses, account);
}

/**
 * Accounts with a live `balance` folded in, so every existing reader
 * (computeNetPosition, the survival banner, the waterfall) keeps working
 * unchanged against a number that is now derived instead of typed.
 */
export function resolveAccounts(rawAccounts, expenses = []) {
  return ensureAccounts(rawAccounts)
    .map(a => ({ ...a, balance: derivedBalance(a, expenses), spentSinceOpening: movementSince(expenses, a) }));
}

/**
 * Reconcile: the real-world balance says something different from ours.
 * Writes a fresh watermark rather than editing history — every expense already
 * logged stays exactly as logged, and everything from this moment on counts
 * against the corrected figure.
 */
export function reconcileAccount(account, actualBalance, at = Date.now()) {
  return {
    ...account,
    openingBalance: num(actualBalance),
    openingAt: at,
    reconciledAt: at,
  };
}

/**
 * Moving money between your own accounts.
 *
 * THE HOLE THIS FILLS
 * Once balances are derived from the expense log, a transfer that isn't
 * recorded silently breaks BOTH accounts — the source keeps money it no longer
 * has, the destination is missing money it does. And recording it as a plain
 * expense is worse: topping up TNG from Maybank would read as RM100 of
 * spending, blow the daily budget, and land in a category breakdown.
 *
 * So a transfer is a PAIR of linked records sharing a `transferId`: a positive
 * amount leaving the source and a negative one arriving at the destination.
 * That shape is deliberate — every balance in the app is already a signed sum
 * of `amount` per account, so the pair moves both balances correctly with no
 * new arithmetic anywhere. And because the two net to exactly zero, every
 * whole-wallet total (today's spend, the cycle's net spend) is also correct
 * without knowing transfers exist.
 *
 * `isAccountTransfer` then marks them for the places that DO need to know:
 * anything counting gross spending or building a category breakdown, where an
 * unfiltered +RM100 would show up as a purchase.
 *
 * Named `isAccountTransfer`, not `isTransfer`, because the parser already uses
 * `isTransfer` for "a payment to a person" — the opposite case, money genuinely
 * leaving your hands.
 */
export function makeTransfer({ fromAccountId, toAccountId, amount, note = '', accounts = [], at = Date.now(), date, time }) {
  const value = Math.abs(num(amount));
  if (!value || sameId(fromAccountId, toAccountId)) return [];
  const from = accountById(accounts, fromAccountId);
  const to = accountById(accounts, toAccountId);
  const transferId = at;
  const stamp = time ?? nowTimeStr(new Date(at));
  const common = {
    // Both the flag and the explicit type. The flag is what every existing
    // reader checks; the type is what new ones ask for. They must never
    // disagree, which is why they are written together, here, once.
    type: 'transfer',
    isAccountTransfer: true,
    transferId,
    category: 'Transfer',
    note,
    source: '户口转账',
    time: stamp,
    ...(date ? { date } : {}),
  };
  return [
    {
      ...common,
      id: at,
      at,
      amount: value,
      accountId: fromAccountId,
      merchant: `转去 ${to?.name ?? '另一个户口'}`,
      paymentMethod: from?.name ?? '未指定户口',
    },
    {
      ...common,
      // +1 so the two never collide as ids or sort ambiguously; `transferId`
      // is what actually links them.
      id: at + 1,
      at: at + 1,
      amount: -value,
      accountId: toAccountId,
      merchant: `从 ${from?.name ?? '另一个户口'} 转入`,
      paymentMethod: to?.name ?? '未指定户口',
    },
  ];
}

/** True for either half of a transfer pair. */
export function isTransferRecord(e) {
  return Boolean(e?.isAccountTransfer);
}

// --- what kind of money movement is this? ------------------------------------
//
// THE PROBLEM: SIX MEANINGS, NO NAME
// A record's kind was never stored. It was inferred, at each call site, from a
// combination of four optional fields and the SIGN of the amount:
//
//   isAccountTransfer      moving your own money between your own accounts
//   isMoneyIn              money arriving from outside
//   repaysDebtId != null   paying down a debt
//   allocationId != null   paying a fixed monthly bill
//   amount < 0             ...one of: a refund, an arrival, or a transfer half
//   amount > 0             ...one of: an expense, a bill, a repayment, or a
//                                     transfer half
//
// Every total in the app therefore re-derived the classification by hand, with
// its own filter, and they drifted: the cycle's 花掉的 excluded repayments while
// the 钱去哪里了 chart did not, so one screen said RM549.90 and the one below it
// said RM649.90 about the same month. The daily budget excluded transfers but
// not arrivals, and handed out RM1,267.50 of headroom against an RM80 budget
// the day an allowance landed.
//
// Those were fixed one at a time, which is the problem: there was no single
// place that could be right. The user asked for the distinction to be explicit
// — "交易类型必须严格区分" — and he is asking for the thing that stops this
// class of bug rather than the next instance of it.
//
// `type` is now stored on every record (migration v6) and read through
// `txType`, which falls back to deriving it from the old flags. That fallback
// is permanent, not transitional: a record can arrive from a backup file
// written by an older build, or a cloud merge from a device on a different
// version, long after any migration has run — the same reason normalizeAccount
// runs on read rather than once.

/** The six things a money record can be. Order is display order. */
export const TX_TYPES = [
  { value: 'expense', label: '支出', short: '出', color: 'var(--color-accent-red)' },
  { value: 'bill', label: '固定月费', short: '月费', color: 'var(--color-diet)' },
  { value: 'repayment', label: '还款', short: '还', color: 'var(--color-accent-amber)' },
  { value: 'income', label: '收入', short: '进', color: 'var(--color-money)' },
  { value: 'refund', label: '别人还我', short: '退', color: 'var(--color-money)' },
  { value: 'transfer', label: '户口转账', short: '转', color: 'var(--text-secondary)' },
];

export function txTypeMeta(value) {
  return TX_TYPES.find(t => t.value === value) ?? TX_TYPES[0];
}

/**
 * The one classifier. Everything that needs to know what a record IS asks here.
 *
 * Order matters and is not arbitrary — the cases overlap in the data:
 *   · a transfer half carries a sign like a refund does, so it must be caught
 *     first or half of every transfer reads as money coming back;
 *   · an arrival carries a negative amount for the same reason, and is checked
 *     before the sign for the same reason;
 *   · a repayment and a bill payment are both positive amounts leaving an
 *     account, indistinguishable from shopping without their link.
 *
 * A stored `type` wins, so a record can say what it is even if a future kind of
 * record has no flag this function knows about.
 */
export function txType(e) {
  if (!e || typeof e !== 'object') return 'expense';
  if (typeof e.type === 'string' && TX_TYPES.some(t => t.value === e.type)) return e.type;
  if (e.isAccountTransfer) return 'transfer';
  if (e.isMoneyIn) return 'income';
  if (e.repaysDebtId != null) return 'repayment';
  if (e.allocationId != null) return 'bill';
  if (Number(e.amount) < 0) return 'refund';
  return 'expense';
}

/**
 * Does this count toward 「我这段时间真正花了多少钱」?
 *
 * Exactly one type does. The user's ask: "消费、还款、转账不能混在「我花了多少
 * 钱」里面 ... 我要看到的是这个周期我真正消费掉多少钱".
 *
 *   expense    yes — this is the question
 *   refund     no  — it is money coming BACK from an expense already counted;
 *                    it nets against the total elsewhere, but it is not spend
 *   bill       no  — real money out, but already reported as 固定开销. Counting
 *                    it here too is how a month with rent read as a spree
 *   repayment  no  — debt is not shopping, and it was reserved up front
 *   income     no  — money arriving is not negative spending
 *   transfer   no  — your own money changing pockets
 */
export function isRealSpend(e) {
  return txType(e) === 'expense';
}

/**
 * Day-to-day money: buying things, and getting money back for things you
 * bought. The pair that a DAILY budget is actually about.
 *
 * Why not just `isRealSpend`: a refund has to net against the spend it
 * reimburses, or returning yesterday's RM40 shirt leaves the RM40 sitting in
 * today's total forever. Why not `isSpendingRecord`: that one includes bills
 * and repayments, which are real money out but were budgeted for months ago —
 * paying RM500 of rent should not read as blowing six days of food money.
 *
 * The user's ask, and the whole of point 9: "消费、还款、转账不能混在「我花了
 * 多少钱」里面 ... 我要看到的是这个周期我真正消费掉多少钱".
 */
export function isDailySpend(e) {
  const kind = txType(e);
  return kind === 'expense' || kind === 'refund';
}

/**
 * Does this record count toward "how much have I spent"?
 *
 * Two kinds of negative amount live in the expense list and they mean opposite
 * things for a budget:
 *
 *   a REFUND (`amount < 0`)         — money back from spending already logged.
 *                                     Nets against the total. That is the whole
 *                                     reason refunds are stored negative.
 *   an ARRIVAL (`isMoneyIn: true`)  — an allowance, a salary, a top-up from
 *                                     outside. Stored negative too, because it
 *                                     credits the account balance — but it is
 *                                     NOT negative spending.
 *
 * THE BUG THIS EXISTS TO STOP, WHICH WAS LIVE
 * `cycle.js` argues this out at length for the monthly budget and gets it
 * right. The DAILY budget never got the same treatment: every "today's spend"
 * site filtered `isAccountTransfer` and nothing else. So the day an allowance
 * landed, the app computed today's spend as a large NEGATIVE number and handed
 * out its full value as extra headroom — RM 1,267.50 of "budget left" against a
 * RM 80 budget, on the one screen whose entire job is to say stop. It also went
 * into the midnight rollover, which writes that day into `history` permanently.
 *
 * Transfers are excluded for the separate reason in `makeTransfer` above: a
 * pair nets to zero anyway, so this only guards against a half-logged one.
 */
export function isSpendingRecord(e) {
  // Deliberately NOT `isRealSpend`. This is the ACCOUNT-facing predicate: it
  // answers "did this move money out of my pocket", so a refund belongs in it
  // (its negative amount nets against the spend it reimburses) and so do bill
  // payments and repayments, which are real ringgit leaving. `isRealSpend`
  // answers the narrower question "was this me buying something", which is what
  // the cycle's 花掉的 figure and the category breakdown want.
  const kind = txType(e);
  return kind !== 'transfer' && kind !== 'income';
}

/**
 * Per-account spend inside a date window, for the breakdowns.
 * Transfers are excluded: moving your own money is not spending, and showing
 * RM100 "spent" on the account it left is exactly the confusion the pair shape
 * exists to avoid.
 */
export function spendByAccount(expenses, accounts, filter = () => true) {
  const totals = new Map();
  for (const e of expenses) {
    if (isTransferRecord(e)) continue;
    if (!filter(e)) continue;
    const key = e.accountId == null ? '__unassigned' : String(e.accountId);
    const rec = totals.get(key) ?? { spent: 0, received: 0, count: 0 };
    if (num(e.amount) >= 0) rec.spent += num(e.amount);
    else rec.received += -num(e.amount);
    rec.count += 1;
    totals.set(key, rec);
  }
  return accounts
    .map(a => ({ account: a, ...(totals.get(String(a.id)) ?? { spent: 0, received: 0, count: 0 }) }))
    .concat(
      totals.has('__unassigned')
        ? [{ account: { id: '__unassigned', name: '未指定户口', type: 'other' }, ...totals.get('__unassigned') }]
        : []
    )
    .filter(r => r.count > 0)
    .sort((x, y) => y.spent - x.spent);
}

/** Which account an Android notification package belongs to, if any. */
export function accountForPackage(accounts, packageName) {
  if (!packageName) return null;
  return accounts.find(a => a.packages?.includes(packageName)) ?? null;
}

/** Every package name any account is bound to — what the listener watches. */
export function watchedPackages(accounts) {
  const out = new Set();
  for (const a of accounts) {
    for (const p of a.packages ?? []) out.add(p);
  }
  return [...out];
}
