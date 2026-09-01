// The monthly money cycle.
//
// The cycle is the CALENDAR MONTH: 1st to end of month. It used to run payday
// to payday (the 10th), on the theory that a budget should start when the money
// lands. Living with it said otherwise — the user, on 1 Sep 2026: "钱确实是9月1
// 号算新的一天". A screen headed 本月 that still showed August on the 1st is
// wrong in the only way that matters, which is the way you read it.
//
// The money arriving on a different day is a separate fact, and it is already
// handled where it belongs: an income source counts from the moment it lands
// (`incomeSources` + the arrival record), and a repayment is dated by hand.
// Neither needs the month to be bent around it.
//
// Every "how much can I spend today" answer depends on which cycle we're in and
// how many days are left in it, so that maths lives here as pure functions and
// is unit-tested (`npm test`). `startDay` stays a parameter — the arithmetic
// below is general, and only the default moved.
//
// THE PASS-THROUGH PROBLEM
// Some money lands in the account without being yours to spend. The friends'
// rent share is the example: if you front the rent and they pay you back, that
// repayment is *recovering an outlay*, not income. Counting it as spendable
// makes the app confidently tell you there's money when there isn't, and you
// can't front the rent next month.
//
// So an income source carries a `kind`:
//   'income'      — genuinely yours, counts toward what you can spend
//   'passthrough' — passes through you to someone else; shown, never spendable
//
// The app can't work out which one applies from the amount alone, so it's a
// setting rather than a guess.

import { isRealSpend, isDailySpend } from './accounts.js';

/** Day of the month the cycle rolls over on. 1 = the calendar month. */
export const CYCLE_START_DAY = 1;

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The cycle containing `today`.
 *
 * At the default `startDay` of 1 this is simply "the month `today` is in".
 * The rollback branch below is kept because the arithmetic is general: for any
 * other start day, a date before it still belongs to the *previous* month's
 * cycle, and getting that backwards would reset the budget early every month.
 *
 * @returns {{start: string, end: string, startDate: Date, endDate: Date,
 *            totalDays: number, dayIndex: number, daysRemaining: number}}
 *          `end` is exclusive: the 1st of next month belongs to the next cycle.
 */
export function getCycle(today = new Date(), startDay = CYCLE_START_DAY) {
  const ref = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const startDate = new Date(ref);
  if (ref.getDate() >= startDay) {
    startDate.setDate(startDay);
  } else {
    startDate.setMonth(startDate.getMonth() - 1);
    startDate.setDate(startDay);
  }

  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 1);

  const DAY = 86400000;
  const totalDays = Math.round((endDate - startDate) / DAY);
  const dayIndex = Math.round((ref - startDate) / DAY);         // 0 on the 1st
  const daysRemaining = Math.max(1, totalDays - dayIndex);       // includes today

  return {
    start: ymd(startDate),
    end: ymd(endDate),
    startDate,
    endDate,
    totalDays,
    dayIndex,
    daysRemaining,
  };
}

/** Is this date inside the given cycle? `end` is exclusive. */
export function isInCycle(dateStr, cycle) {
  return dateStr >= cycle.start && dateStr < cycle.end;
}

/** The cycle immediately before this one — for "vs last cycle" comparisons. */
export function getPreviousCycle(cycle, startDay = CYCLE_START_DAY) {
  const dayBefore = new Date(cycle.startDate);
  dayBefore.setDate(dayBefore.getDate() - 1);
  return getCycle(dayBefore, startDay);
}

/**
 * Gross spend (positive amounts only) inside `cycle`, up to and including its
 * `dayIndex`-th day. Used to compare "how much had left the wallet by this
 * point" across two cycles — comparing today's partial cycle against a full
 * past cycle would always look artificially good, since a cycle that isn't
 * over yet can't have spent as much as one that ran its full length.
 */
export function grossSpentByDayIndex(expenses, cycle, dayIndex) {
  const cutoff = new Date(cycle.startDate);
  cutoff.setDate(cutoff.getDate() + dayIndex);
  const cutoffYmd = ymd(cutoff);
  return expenses
    .filter(e => !e.isAccountTransfer
      // Repayments excluded to keep this comparable with grossSpentThisCycle,
      // which excludes them too. A month where a debt was cleared would
      // otherwise read as a catastrophic overspend against the month before.
      && e.repaysDebtId == null
      && isInCycle(e.date ?? cycle.start, cycle)
      && (e.date ?? cycle.start) <= cutoffYmd
      && Number(e.amount) > 0)
    .reduce((sum, e) => sum + Number(e.amount), 0);
}

// --- fixed vs variable allocations ------------------------------------------
//
// A fixed cost (rent, a subscription, an instalment) is the same every cycle.
// A variable one — electricity, water, a mobile data top-up — genuinely
// changes, and the real figure usually isn't known until the bill arrives
// partway through the cycle. Forcing a single `amount` on both meant a
// variable bill either sat wrong all cycle or had to be re-typed as a brand
// new allocation every month, losing its history.
//
// A variable allocation instead carries an `estimate` (used before the real
// number is known, so the daily limit is still computable from day one) and
// an `actuals` map keyed by `cycle.start`, filled in once the bill lands. Nothing
// is overwritten across cycles — a running actuals history is a byproduct.

/** What this allocation contributes to THIS cycle's budget. */
export function resolveAllocationAmount(allocation, cycle) {
  if (!allocation.variable) return Number(allocation.amount) || 0;
  const actual = allocation.actuals?.[cycle.start];
  if (actual != null) return Number(actual) || 0;
  return Number(allocation.estimate) || 0;
}

/** True when a variable allocation is still running on its estimate for this cycle. */
export function isEstimated(allocation, cycle) {
  return Boolean(allocation.variable) && allocation.actuals?.[cycle.start] == null;
}

/**
 * Work out the spending position for a cycle.
 *
 * @param {object} args
 * @param {Array}  args.incomeSources  [{ id, label, amount, kind }]
 * @param {Array}  args.allocations    [{ id, label, amount, paid }] or
 *                                     [{ id, label, variable:true, estimate, actuals, paid }]
 * @param {Array}  args.expenses       all expense records (filtered here by cycle)
 * @param {object} args.cycle          from getCycle()
 */
export function computeCycleBudget({ incomeSources = [], allocations = [], expenses = [], cycle }) {
  const sum = (list, pick = x => x.amount) =>
    list.reduce((total, item) => total + (Number(pick(item)) || 0), 0);

  // --- income: the setting and the reality, resolved into ONE figure --------
  //
  // THE TWO SYSTEMS THAT DID NOT TALK
  // 「本月收入」 was `incomeSources` — a list of amounts the user typed once,
  // summed into every cycle forever. 「今天记收入」 wrote an `isMoneyIn` expense
  // record, which credited an account balance and was deliberately kept OUT of
  // the budget so it couldn't double-count the setting. Both were defensible;
  // together they meant logging RM1,000 arriving changed the month's income by
  // nothing at all. The user: "「今天记收入」和「本月收入」必须是同一个系统".
  //
  // They are one system now, joined by `incomeSourceId` on the arrival record.
  // The rule, per source:
  //
  //   nothing arrived yet   -> count what you EXPECT. The budget has to work on
  //                            the 1st, before the allowance lands.
  //   something arrived     -> count what ACTUALLY arrived, and stop using the
  //                            expectation. An allowance that came RM200 short
  //                            must reduce the month, not keep quoting the
  //                            hoped-for figure — that is the reassuring
  //                            direction, which is the one that hurts.
  //
  // `Math.max` would have been the tempting rule and is wrong for exactly that
  // case. An arrival linked to no source (a gift, a one-off) counts as itself.
  const arrivals = expenses.filter(e =>
    e.isMoneyIn && !e.isAccountTransfer && isInCycle(e.date ?? cycle.start, cycle));
  const arrivedBySource = new Map();
  let arrivedUnlinked = 0;
  for (const e of arrivals) {
    const amount = Math.abs(Number(e.amount) || 0);
    if (e.incomeSourceId == null) { arrivedUnlinked += amount; continue; }
    const key = String(e.incomeSourceId);
    arrivedBySource.set(key, (arrivedBySource.get(key) ?? 0) + amount);
  }

  const resolveSource = (s) => {
    const arrived = arrivedBySource.get(String(s.id));
    return arrived != null ? arrived : (Number(s.amount) || 0);
  };

  const spendableSources = incomeSources.filter(s => s.kind !== 'passthrough');
  const passthroughSources = incomeSources.filter(s => s.kind === 'passthrough');
  // Only LINKED arrivals move the budget. An unlinked one is ambiguous in the
  // one direction that matters: it may well BE the salary already listed as a
  // source, in which case adding it would count the same ringgit twice and hand
  // out a daily allowance built on money that arrived once. That is the
  // reassuring-direction error this file spends most of its length avoiding.
  //
  // So `arrivedUnlinked` is returned rather than added, and the income list
  // shows it as 「未归类进账」 with a prompt to file it. Naming the gap is the
  // fix; guessing at it is not. The moment it is filed against a source it
  // starts counting, through `resolveSource` above.
  const spendableIncome = spendableSources.reduce((t, s) => t + resolveSource(s), 0);
  const passthrough = passthroughSources.reduce((t, s) => t + resolveSource(s), 0);

  // Per-source detail, so the income list can show 预计 vs 实际到账 per line
  // instead of one total that hides which one was short.
  const incomeBreakdown = incomeSources.map(s => {
    const arrived = arrivedBySource.get(String(s.id)) ?? 0;
    const expected = Number(s.amount) || 0;
    const landed = arrivedBySource.has(String(s.id));
    return {
      id: s.id,
      label: s.label,
      kind: s.kind,
      expected,
      arrived,
      landed,
      counted: landed ? arrived : expected,
      // Only meaningful once something has actually landed — before that,
      // "short by the whole amount" is just "it hasn't come yet".
      shortfall: landed ? expected - arrived : 0,
    };
  });

  // `budgeted` is what recurring.js worked out this allocation costs THIS
  // cycle — which is not simply its amount any more: a weekly bill lands four
  // or five times, a yearly one usually lands zero times, and a 'spread' one
  // reserves a slice every cycle regardless of when it actually leaves. It's
  // passed in pre-resolved rather than computed here so debt instalments
  // (which have a fixed amount and no schedule of their own) can flow through
  // the same sum without recurring.js needing to know about debts.
  const expensesThisCycle = expenses.filter(e => isInCycle(e.date ?? cycle.start, cycle));

  // What was actually PAID against each bill this cycle, from linked expenses.
  //
  // THE HOLE THIS CLOSES, WHICH THE DOUBLE-COUNT FIX OPENED
  // `allocationId` keeps a logged bill payment out of `spentThisCycle`, because
  // the allocation already reserved that money. That is right only while the
  // allocation really does claim that much this cycle — and there are three
  // ordinary ways it doesn't:
  //
  //   · paying EARLY. A quarterly premium set to 'spread' reserves RM200 a
  //     cycle and charges RM0 until November. Pay the RM600 in August and the
  //     reservation claims RM200 while the payment claims nothing: RM400 of
  //     real money simply left the month's accounting.
  //   · a bill coming in HIGHER than expected. RM120 reserved, RM180 paid,
  //     RM60 gone.
  //   · a bill DELETED after being paid — the reservation is gone entirely, so
  //     every payment ever made against it silently stops counting.
  //
  // All three fail in the reassuring direction, which is the one that hurts.
  // The fix is the rule `reservedForCycle` already uses for debts (debts.js):
  // hold back the LARGER of what was planned and what was actually paid. Paying
  // the expected amount changes nothing; paying more is money that really has
  // gone, and the budget has to know.
  const paidByAllocation = new Map();
  for (const e of expensesThisCycle) {
    if (e.allocationId == null) continue;
    const key = String(e.allocationId);
    paidByAllocation.set(key, (paidByAllocation.get(key) ?? 0) + Math.abs(Number(e.amount) || 0));
  }
  // A payment pointing at a bill that no longer exists has nothing to be
  // reserved against, so it falls back to being ordinary spending — see
  // `linkedToLiveBill` below.
  const liveAllocationIds = new Set(allocations.map(a => String(a.id)));

  // `budgeted` is what recurring.js worked out this allocation costs THIS
  // cycle — which is not simply its amount any more: a weekly bill lands four
  // or five times, a yearly one usually lands zero times, and a 'spread' one
  // reserves a slice every cycle regardless of when it actually leaves. It's
  // passed in pre-resolved rather than computed here so debt instalments
  // (which have a fixed amount and no schedule of their own) can flow through
  // the same sum without recurring.js needing to know about debts.
  const plannedThisCycle = a => (a.budgeted != null ? a.budgeted : resolveAllocationAmount(a, cycle));
  const amountThisCycle = a =>
    Math.max(plannedThisCycle(a), paidByAllocation.get(String(a.id)) ?? 0);
  // What actually LEAVES the accounts this cycle. Differs from `committed`
  // for a spread bill, and the difference is the whole point of showing both:
  // "RM100 set aside" and "RM0 actually going out this month" are two true
  // statements about the same annual premium.
  const chargedThisCycle = a => Math.max(
    a.charged != null ? a.charged : plannedThisCycle(a),
    paidByAllocation.get(String(a.id)) ?? 0);
  const committed = sum(allocations, amountThisCycle);
  const committedCharged = sum(allocations, chargedThisCycle);
  const committedUnpaid = sum(allocations.filter(a => !a.paid), amountThisCycle);

  // 进账 (`isMoneyIn`) — money genuinely arriving into an account from outside:
  // an allowance, a salary landing, a top-up from elsewhere. Stored as a
  // negative amount so it credits the account balance, exactly like a refund.
  //
  // But it must NOT touch the cycle budget, and that is the whole reason it
  // exists as its own flag rather than being filed under 别人还我. A refund is
  // money coming back from spending you ALREADY logged, so netting it against
  // `spentThisCycle` is right. An arrival is not that — its budget effect is
  // already owned by `incomeSources`, which is summed into every cycle. Letting
  // it net here would count the same ringgit twice: once as income, once as
  // negative spend, inflating the daily safe limit by the full amount.
  //
  // Worse in this user's actual case: a salary that lands in a custodial
  // account he cannot spend from would have raised his daily allowance as if
  // it were pocket money.
  // A repayment (`repaysDebtId`) is excluded for a third, different reason.
  // Debt is reserved at the top of the cycle and spread across every remaining
  // day, exactly like rent — see debts.js. That reservation has already come
  // out of `committed`, so charging the payment again on the day it leaves
  // subtracts the same ringgit twice, and in the punishing direction: paying
  // RM200 off a debt would read as blowing two and a half days of budget on top
  // of the amount already held back for it.
  // A THIRD exclusion, same shape as the repayment one and the same bug.
  // `allocationId` marks a logged payment as "this IS my rent / my Netflix".
  // The allocation already reserved that money in `committed` at the top of the
  // cycle, so counting the payment again on the day it leaves subtracts the
  // same ringgit twice — and in the punishing direction. Before the link
  // existed there was no way to say it, so anyone who logged their rent
  // payment silently lost the amount from their budget twice over.
  const linkedToLiveBill = e => e.allocationId != null && liveAllocationIds.has(String(e.allocationId));
  const budgetMovement = expensesThisCycle.filter(e =>
    !e.isMoneyIn && e.repaysDebtId == null && !linkedToLiveBill(e));
  const spentThisCycle = sum(budgetMovement);

  // Two different questions that `spentThisCycle` alone can't answer, because
  // it's a net figure (a refund's negative amount already cancels part of it
  // out). "How much actually left the wallet this cycle" and "how much came
  // back in from refunds/repayments this cycle" are each their own number —
  // the monthly view shows them so income and spend are both visible at a
  // glance, not just their net.
  // Transfers between your own accounts are excluded from BOTH. The pair
  // (+X leaving one account, -X arriving at another) nets to zero in every
  // signed total automatically, but gross figures like these would otherwise
  // report a RM100 top-up as RM100 spent AND RM100 received. See makeTransfer
  // in accounts.js.
  const realMovement = expensesThisCycle.filter(e => !e.isAccountTransfer && !e.isMoneyIn);
  const repaymentsThisCycle = realMovement.filter(e => e.repaysDebtId != null);
  // Repayments are real money leaving, so they belong in "where did it all go"
  // — but as their own figure, not folded into 花掉的. Debt is not shopping,
  // and a month where RM800 went to clearing SPayLater should not look like a
  // month of overspending.
  const repaidThisCycle = sum(repaymentsThisCycle, e => Math.abs(Number(e.amount) || 0));
  // A bill payment is not shopping. It is real money leaving — and it is
  // already reported, under its own name, in 固定开销 — so folding it into
  // 花掉的 would make a month where rent went out look like a spending spree.
  // Day-to-day money: buying things, and getting money back for things you
  // bought. Those two are the same conversation and net against each other —
  // which is why this is `expense | refund` rather than `isRealSpend` alone.
  // Narrowing it to purchases only silently zeroed 另收 (「received」), because
  // that figure is this list's negative half.
  //
  // Everything else is excluded because it is reported under its own name:
  // bills as 固定开销, repayments as 还债, transfers not at all, arrivals as
  // income. Stated through the one classifier rather than another hand-rolled
  // filter — this line has been wrong three separate times, once for arrivals,
  // once for transfers, once for repayments, each time because a new kind of
  // record appeared and this filter alone did not hear about it.
  const daily = realMovement.filter(e => isDailySpend(e) || (e.allocationId != null && !liveAllocationIds.has(String(e.allocationId))));
  const billPaymentsThisCycle = sum(
    realMovement.filter(linkedToLiveBill), e => Math.abs(Number(e.amount) || 0));
  // 「这个周期我真正消费掉多少钱」 — purchases, nothing else. The positive
  // half of `daily` is the same set, but saying it through the classifier means
  // a future kind of positive record cannot quietly join it.
  const grossSpentThisCycle = sum(daily.filter(isRealSpend));
  const receivedThisCycle = sum(daily.filter(e => Number(e.amount) < 0), e => -Number(e.amount));

  // Money that ACTUALLY landed in an account this cycle, from the records —
  // as opposed to `spendableIncome`, which is what the user once told the app
  // he earns.
  //
  // WHY BOTH NUMBERS HAVE TO EXIST
  // 「本月总收入」 was `spendableIncome` alone: a setting, displayed large and
  // green at the top of the screen, in a month the user knew he had lost money.
  // It is not wrong — the budget is genuinely built on it — but shown by itself
  // it reads as a measurement, and it answers a question nobody asked. If the
  // allowance was late, or smaller, or never came, the screen said the same
  // thing either way. So the arrivals are counted separately and the screen can
  // say when the two disagree.
  //
  // Transfers excluded: moving your own RM100 from Maybank to TNG is not income
  // arriving, even though the receiving half is stored exactly like one.
  const arrivedThisCycle = sum(
    expensesThisCycle.filter(e => e.isMoneyIn && !e.isAccountTransfer),
    e => Math.abs(Number(e.amount) || 0)
  );

  // What's genuinely free to spend: income you actually own, minus every fixed
  // outgoing (paid or not — an unpaid one is still owed), minus what's gone.
  const available = spendableIncome - committed - spentThisCycle;

  // Am I up or down this cycle — the plainest possible reading of the same
  // arithmetic, and the one figure the monthly screen never printed.
  //
  // Identical to `available` by construction; it exists under its own name
  // because "还能花 RM 300" and "这个月亏了 RM 300" are the same number wearing
  // two different faces, and only one of them is honest when it goes negative.
  // A daily allowance floors at zero (you cannot spend negative money); a
  // verdict must not, or a losing month renders exactly like a break-even one.
  const netThisCycle = available;
  const inDeficit = netThisCycle < 0;

  // Spread across the days left, today included. Floored at 0 so an overspent
  // cycle reads as "nothing left", not a negative allowance.
  const dailySafeLimit = Math.max(0, available) / cycle.daysRemaining;

  // Today's spend, measured the SAME way as the cycle's — off `realMovement`,
  // not off the raw expense list.
  //
  // TWO BUGS THIS FIXES, BOTH IN THE REASSURING DIRECTION
  // 1. `isMoneyIn` was not excluded. An arrival is stored as a negative amount
  //    (it credits the account), so an RM 1,200 allowance landing today made
  //    `spentToday` -1200 and `todayRemaining` = dailySafeLimit + 1200 — the app
  //    cheerfully reporting over a thousand ringgit of headroom for one day.
  //    That is precisely the double-count `budgetMovement` above exists to stop,
  //    and this line was the one place that didn't get the memo.
  // 2. Transfers were not excluded. Each half nets the other out on the day they
  //    are both logged, but a transfer whose halves straddle midnight (or one
  //    half deleted by hand) left today short or long by the full amount.
  //
  // Also now scoped to the cycle, via `realMovement`. `computeCycleBudget` is
  // called for a PAST cycle too (the "vs last cycle" comparison), and there
  // today's spending is not part of the answer at all — it correctly falls to 0.
  // `daily`, not `realMovement` — a repayment must not eat today's allowance
  // either, for the same reason it doesn't eat the cycle's. This is the number
  // the user sees most often, so getting it wrong here would be the version of
  // this bug they'd actually notice.
  const todayStr = ymd(new Date());
  const spentToday = sum(daily.filter(e => e.date === todayStr));

  return {
    spendableIncome,
    passthrough,
    incomeBreakdown,
    arrivedUnlinked,
    billPaymentsThisCycle,
    grossSpentThisCycle,
    receivedThisCycle,
    repaidThisCycle,
    committed,
    committedCharged,
    committedUnpaid,
    spentThisCycle,
    arrivedThisCycle,
    netThisCycle,
    inDeficit,
    available,
    dailySafeLimit,
    spentToday,
    todayRemaining: dailySafeLimit - spentToday,
    overspent: available < 0,
  };
}

/**
 * What accepting a purchase would do to the rest of the cycle.
 * This is the number the 48-hour sandbox exists to put in front of you.
 */
export function projectImpact(budget, cycle, amount) {
  const value = Number(amount) || 0;
  const after = budget.available - value;
  return {
    amount: value,
    availableAfter: after,
    dailyBefore: budget.dailySafeLimit,
    dailyAfter: Math.max(0, after) / cycle.daysRemaining,
    goesNegative: after < 0,
  };
}
