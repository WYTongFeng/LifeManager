// Net position: what you actually own, minus what you actually owe.
//
// THE MISTAKE THIS EXISTS TO PREVENT
// The first version summed every account balance and called it net worth. For
// this user that read RM 13,786 — comforting and completely wrong, because the
// biggest account is not his money. It's held on behalf of someone else, and
// anything taken out has to be put back.
//
// An account therefore has a `kind`:
//   'own'       — yours; the balance is an asset
//   'custodial' — held for someone else. The balance is NOT an asset, and any
//                 shortfall against `target` IS a debt, because you have to
//                 restore it.
//
// Getting this wrong in the reassuring direction is the worst failure mode for
// an app whose whole point is to stop overspending, so custodial is handled
// explicitly rather than inferred.

// A SECOND exclusion, added later: `countsToNetWorth: false`.
//
// 'custodial' answers "is this money mine". `countsToNetWorth` answers a
// different question — "should this balance count toward what I've got saved"
// — and the two genuinely come apart. An account can be entirely yours and
// still not belong in the savings figure: a float you keep topped up, a
// balance earmarked for something else, an account you can draw on but must
// never think of as wealth. Spending from it is still real spending and still
// gets logged; its debts are still debts. Only the asset side is excluded.
//
// Modelling this as a third `kind` value would have been wrong: it composes
// with 'own'/'custodial' rather than replacing either.

/** @typedef {{id:string|number,name:string,balance:number,target:number|null,
 *             kind:'own'|'custodial',countsToNetWorth?:boolean}} Account */

// Re-exported from accounts.js, which owns the account model now. Kept here so
// the several call sites that already import it from networth.js keep working.
export { ACCOUNT_KINDS } from './accounts.js';

// The instalment model lives in debts.js; the waterfall reads it to say what a
// debt asks for THIS cycle as opposed to in total.
import { commitmentOf, remainingPlanThisCycle } from './debts.js';
// Bills: what actually leaves an account this cycle, as opposed to what the
// budget reserves for it — see computeSpendable at the bottom of this file.
import { normalizeAllocation, cycleCost } from './recurring.js';
import { isInCycle } from './cycle.js';

/**
 * Module 3 of the firewall spec: red-alert survival mode. Below this much
 * ACTUALLY LIQUID cash (`ownCash` — custodial balances don't count, you can't
 * spend them), the app is supposed to confront you with it everywhere, not
 * just on the screen where you happen to be looking at accounts.
 */
export const SURVIVAL_THRESHOLD = 300;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * What is still owed on a debt: the scheduled instalments not yet settled (or a
 * flat `amount` for a debt with no schedule), minus every repayment logged
 * against it.
 *
 * The repayment half is why `expenses` is a parameter. Before it existed there
 * was no way to record paying part of a flat debt at all — the only way to show
 * progress was to hand-edit the amount down, which loses the fact that a
 * payment ever happened and makes "how much did I clear this month" unanswerable.
 * See debts.js. Defaults to no repayments so a caller that genuinely only has
 * the stated figure (a preview of a debt being edited, say) still works.
 */
export function debtOutstanding(debt, expenses = []) {
  const stated = Array.isArray(debt?.schedule) && debt.schedule.length > 0
    ? debt.schedule.filter(i => !i.paid).reduce((sum, i) => sum + num(i.amount), 0)
    : num(debt?.amount);

  const repaid = expenses.reduce(
    (sum, e) => (e?.repaysDebtId != null && String(e.repaysDebtId) === String(debt?.id)
      ? sum + Math.abs(num(e.amount))
      : sum),
    0
  );
  // Floored: overpaying clears the debt early, it never makes it owe you money.
  return Math.max(0, stated - repaid);
}

/** The next instalment due, or null. */
export function nextInstalment(debt) {
  if (!Array.isArray(debt?.schedule)) return null;
  return debt.schedule
    .filter(i => !i.paid)
    .sort((a, b) => String(a.due).localeCompare(String(b.due)))[0] ?? null;
}

/**
 * Flip one instalment's paid state within a debt's schedule. Pure — returns a
 * new `debts` array rather than mutating.
 *
 * Existed as a gap: the schema (`schedule[i].paid`) and every reader of it
 * (`debtOutstanding`, `nextInstalment`, `instalmentsDueIn`, `getWaterfallOrder`)
 * were built from the start, but nothing anywhere ever wrote `paid: true` —
 * there was no UI path to it at all, so a scheduled debt's outstanding total
 * could only ever grow, never shrink, no matter how many instalments were
 * actually paid off in real life.
 *
 * Identified by `due` (a date string), not array index — schedule order is
 * stable and `due` is already the natural per-instalment key everywhere else
 * in this file.
 */
export function toggleInstalmentPaid(debts, debtId, due) {
  return debts.map(d => {
    if (d.id !== debtId || !Array.isArray(d.schedule)) return d;
    return {
      ...d,
      schedule: d.schedule.map(i => (i.due === due ? { ...i, paid: !i.paid } : i)),
    };
  });
}

/** Everything owed in a given calendar month, across all debts. `month` is YYYY-MM. */
export function instalmentsDueIn(debts, month) {
  const out = [];
  for (const debt of debts) {
    for (const i of debt.schedule ?? []) {
      if (!i.paid && String(i.due).startsWith(month)) {
        out.push({ debt: debt.creditor, due: i.due, amount: num(i.amount) });
      }
    }
  }
  return out;
}

/**
 * The honest position.
 *
 * @param {Account[]} accounts
 * @param {object[]}  debts
 * @param {object[]}  expenses  full ledger — repayments in it reduce what's owed,
 *                              the same way it already derives account balances.
 *                              Omitting it reports every debt at its stated size.
 * @param {number}    survivalThreshold  overridable for tests; see SURVIVAL_THRESHOLD
 */
export function computeNetPosition(accounts = [], debts = [], expenses = [], survivalThreshold = SURVIVAL_THRESHOLD) {
  const active = accounts.filter(a => !a.archived);
  const custodial = active.filter(a => a.kind === 'custodial');
  // Yours AND meant to count. Anything excluded is still tracked, still
  // spendable, still shows in the log — it just isn't an asset.
  const own = active.filter(a => a.kind !== 'custodial' && a.countsToNetWorth !== false);
  const excluded = active.filter(a => a.kind !== 'custodial' && a.countsToNetWorth === false);

  const ownCash = own.reduce((sum, a) => sum + num(a.balance), 0);
  const custodialHeld = custodial.reduce((sum, a) => sum + num(a.balance), 0);
  const excludedHeld = excluded.reduce((sum, a) => sum + num(a.balance), 0);

  // Money taken out of an account that isn't yours is a debt to that account —
  // UNLESS the account says otherwise via `autoShortfallDebt: false`.
  //
  // WHY THAT OPT-OUT EXISTS
  // Deriving the debt from the balance only tells the truth when the balance
  // moves for one reason. The user's real PBE does not: an allowance of varying
  // size lands in it, rent leaves it, spendable money is transferred out, and
  // a salary parks there in transit. Against that, `target − balance` swings
  // wildly and means nothing — an allowance arriving makes the reserve read
  // "已经补满了" the day before RM 2,000 of it goes to a landlord.
  //
  // Their words: "pbe很多我不能懂的钱我自己记录最好". So an account can opt out
  // and the amount owed to it becomes a plain debt entry they maintain by hand,
  // which is exactly what `debts` already is. Default stays true, so nothing
  // changes for an account that hasn't asked.
  const custodialShortfall = custodial.reduce((sum, a) => {
    if (a.autoShortfallDebt === false) return sum;
    const target = a.target == null ? null : num(a.target);
    return sum + (target != null && target > num(a.balance) ? target - num(a.balance) : 0);
  }, 0);

  // An 'own' account below its target is a savings goal, not a debt — being
  // short of a goal you set yourself doesn't mean you owe anyone. Excluded
  // accounts are included here on purpose: not counting toward net worth
  // doesn't mean a savings goal on it stops existing.
  const ownShortfall = [...own, ...excluded].reduce((sum, a) => {
    const target = a.target == null ? null : num(a.target);
    return sum + (target != null && target > num(a.balance) ? target - num(a.balance) : 0);
  }, 0);

  const listedDebts = debts.reduce((sum, d) => sum + debtOutstanding(d, expenses), 0);
  const totalOwed = listedDebts + custodialShortfall;

  return {
    ownCash,
    custodialHeld,
    // Tracked but deliberately not counted as savings. Surfaced so the UI can
    // say so out loud — a number silently missing from a total is exactly the
    // kind of thing that makes an app feel like it's lying to you.
    excludedHeld,
    excludedCount: excluded.length,
    custodialShortfall,
    ownShortfall,
    listedDebts,
    totalOwed,
    netPosition: ownCash - totalOwed,
    inDebt: ownCash - totalOwed < 0,
    // Deliberately keyed on ownCash alone, not netPosition — being "in debt"
    // overall (a big custodial shortfall, say) is a different problem from
    // having almost no cash in hand *right now*. Survival mode is about the
    // second one: can you actually buy lunch today.
    inSurvivalMode: ownCash < survivalThreshold,
  };
}

/**
 * Every outstanding obligation — real debts AND the shortfall owed back to a
 * custodial account's target — laid out **smallest-outstanding-first**.
 *
 * NOTE ON THE NAME: this was Module 4 of the firewall spec, the debt
 * "waterfall", and 户口欠款 rendered it as one — a suggested payoff order with
 * a per-cycle repayment box on every row. That screen is now a plain list of
 * what is owed. Both halves of the waterfall went on 1 Sep 2026, for the same
 * reason: the box duplicated 本月's word for word, and the order was the app
 * volunteering an opinion about a decision the user had just said was his
 * ("这个月我要还多少我会自己去算的"). The `plan` argument is what the removed
 * UI wrote; every current caller passes null, and it is kept because a restored
 * backup can still carry one.
 *
 * That's the "snowball" method, not "avalanche" (highest-interest-first):
 * this app has no interest-rate field to rank by cost, but more to the
 * point, smallest-first is the method literally built around the dopamine
 * effect the whole firewall spec exists for — knocking a whole line off the
 * list reads as a bigger win than a bigger dent in a bigger one, even when
 * the ringgit amount is smaller.
 *
 * WHAT THE ORDER ALONE COULD NOT SAY, AND THE COMPLAINT IT CAUSED
 * Every item used to be one number: what's still owed. Under that, an
 * instalment plan and money owed to a friend look identical — both a big red
 * total with a "每月还" box beside it — so a RM1,864.28 SPayLater plan read as
 * a demand to hand over RM1,864.28, when the only thing actually due is
 * RM368.70 this month. The user's words: "不应该因为有一笔总欠款，就建议我把
 * 全部现金一次拿去还掉".
 *
 * So each item now also carries HOW MUCH CHOICE YOU HAVE:
 *
 *   commitment 'scheduled' — someone else set the amount and the date. You can
 *                            pay early; you cannot pay less.
 *              'flexible'  — you decide, per cycle, and may decide differently
 *                            next cycle.
 *              'reserve'   — money owed back to your own custodial account.
 *                            Real, but nobody is chasing you for it.
 *   dueThisCycle           — what this cycle actually asks for. THIS is the
 *                            figure that answers "我现在实际需要拿多少钱出来"
 *                            and it is deliberately separate from `outstanding`,
 *                            which answers "我总共欠多少".
 *
 * The sort is untouched: it is the suggestion for where SPARE money goes, and
 * spare money is exactly the thing a deadline doesn't apply to. Grouping by
 * `commitment` is the UI's job.
 *
 * @param {Account[]} accounts
 * @param {object[]}  debts
 * @param {object|null} plan   the user's own order/rates (`debtPlan`)
 * @param {object[]}  expenses full ledger, so repayments shrink each item
 * @param {object|null} cycle  from getCycle(); omit and `dueThisCycle` is 0
 * @returns {{id:string, label:string, kind:'debt'|'reserve', outstanding:number,
 *            commitment:'scheduled'|'flexible'|'reserve', dueThisCycle:number,
 *            nextDue:string|null, original:number|null, progressPct:number|null,
 *            remainingAfter:number}[]}
 *          `original`/`progressPct` are null for a flat (unscheduled) debt — it has
 *          no tracked starting point, only whatever `amount` was last edited to.
 *          `remainingAfter` is everything still owed once this item is cleared —
 *          the "staircase" shrinking as the list is worked top to bottom.
 */
export function getWaterfallOrder(accounts = [], debts = [], plan = null, expenses = [], cycle = null) {
  const items = [];

  for (const d of debts) {
    const outstanding = debtOutstanding(d, expenses);
    // A debt cleared by repayments drops off the plan on its own, the same way
    // a fully-paid schedule always did.
    if (outstanding <= 0) continue;
    const scheduled = Array.isArray(d.schedule) && d.schedule.length > 0;
    // A flat debt has a starting point now that repayments are recorded against
    // it — `amount` is what was owed before any of them. It used to have none,
    // so it could never show progress.
    const original = scheduled
      ? d.schedule.reduce((sum, i) => sum + num(i.amount), 0)
      : (num(d.amount) > 0 ? num(d.amount) : null);
    const next = nextInstalment(d);
    items.push({
      id: `debt:${d.id}`,
      label: d.creditor,
      kind: 'debt',
      outstanding,
      commitment: commitmentOf(d),
      // Never more than is actually still owed: a plan of RM200 against a debt
      // with RM80 left must ask for RM80, or the screen sends you to pay money
      // that would bounce straight back.
      dueThisCycle: cycle ? Math.min(outstanding, remainingPlanThisCycle(d, expenses, cycle)) : 0,
      nextDue: next?.due ?? d.dueDate ?? null,
      original,
      progressPct: original ? Math.min(100, ((original - outstanding) / original) * 100) : null,
    });
  }

  for (const a of accounts) {
    if (a.archived) continue;
    if (a.kind !== 'custodial' || a.target == null) continue;
    // Opted out of the derived shortfall (see computeNetPosition) — it isn't
    // counted as owed, so it must not appear in the repayment plan either, or
    // the plan would total more than `totalOwed` says exists.
    if (a.autoShortfallDebt === false) continue;
    const target = num(a.target);
    const outstanding = target - num(a.balance);
    if (outstanding <= 0) continue;
    items.push({
      id: `reserve:${a.id}`,
      label: a.name,
      kind: 'reserve',
      outstanding,
      // Nobody sends a reminder about money you owe your own reserve, so it
      // never carries a deadline. Whatever you decide to put back this cycle
      // comes from the plan, the same as a flexible debt.
      commitment: 'reserve',
      dueThisCycle: Math.min(outstanding, num(plan?.monthly?.[`reserve:${a.id}`])),
      nextDue: null,
      original: target,
      progressPct: Math.min(100, (num(a.balance) / target) * 100),
    });
  }

  // Smallest-first is the SUGGESTION, kept on every item as `suggestedRank` so
  // the UI can still show what the app would have picked even after the user
  // overrides it. The suggestion was never a calculation of what's cheapest —
  // it's the momentum argument in this function's header — so presenting it as
  // an order to obey would be overstating it.
  items.sort((x, y) => x.outstanding - y.outstanding);
  items.forEach((item, i) => { item.suggestedRank = i; });

  // The user's own order wins where they've expressed one. Anything they
  // haven't ranked keeps its suggested position and lands after the ranked
  // items, so adding a new debt later can never silently drop off the list or
  // force a full re-ordering just to see it.
  const order = Array.isArray(plan?.order) ? plan.order : [];
  if (order.length > 0) {
    const rank = new Map(order.map((id, i) => [id, i]));
    items.sort((x, y) => {
      const rx = rank.has(x.id) ? rank.get(x.id) : Infinity;
      const ry = rank.has(y.id) ? rank.get(y.id) : Infinity;
      if (rx !== ry) return rx - ry;
      return x.suggestedRank - y.suggestedRank;
    });
  }

  const monthly = plan?.monthly ?? {};

  let remaining = items.reduce((sum, i) => sum + i.outstanding, 0);
  return items.map((item, i) => {
    remaining -= item.outstanding;
    const planned = num(monthly[item.id]);
    return {
      ...item,
      // Subtracting floats down from a float total leaves the last item at
      // -0.00 rather than 0, which renders as "清完还剩 -RM 0.00".
      remainingAfter: Math.max(0, remaining),
      // Whether this item sits where the suggestion put it, so an overridden
      // list can be labelled honestly instead of implying the app chose it.
      followsSuggestion: i === item.suggestedRank,
      // Only the derived answer is returned. `plannedMonthly` used to ride
      // along here too and nothing ever read it — the form owns the raw input
      // in `debtPlan.monthly`, and a second copy on this object would just be
      // one more thing that can disagree with it.
      monthsToClear: planned > 0 ? monthsToClear(item.outstanding, planned) : null,
    };
  });
}

/**
 * Whole months to clear `outstanding` at `monthly` per month.
 *
 * Rounded UP, because a final part-month is still a month you are paying in —
 * reporting 12 when the last RM3 lands in month 13 would be the reassuring
 * kind of wrong. Returns null for a non-positive rate rather than Infinity, so
 * the UI has one "no answer" case instead of two.
 */
export function monthsToClear(outstanding, monthly) {
  const owed = num(outstanding);
  const rate = num(monthly);
  if (rate <= 0 || owed <= 0) return null;
  return Math.ceil(owed / rate);
}

/**
 * Move one item up or down in the user's repayment order.
 *
 * Takes the CURRENTLY RENDERED list, not the stored order, and returns a
 * complete id list. That matters: a stored order can be empty (nothing
 * overridden yet) or partial (a debt added since), and reordering from it
 * would move an item relative to a list the user isn't looking at. Seeding
 * from what's on screen means the first nudge pins everything exactly where it
 * already appears, and only the nudged item moves.
 *
 * @param {{id:string}[]} currentItems  the rendered waterfall, in display order
 * @param {string} id                   item to move
 * @param {-1|1} delta                  -1 up, +1 down
 * @returns {string[]} the new complete order
 */
export function moveInOrder(currentItems, id, delta) {
  const ids = currentItems.map(i => i.id);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

// `buildSchedule` moved to debts.js, which owns the instalment model — it is
// re-exported here because networth.js was its home and the tests still import
// it from this path. The move was forced by direction: the waterfall below now
// needs debts.js (for what a debt actually costs THIS cycle), and a schedule
// builder sitting on the other side of that import would have made the two
// files import each other.
export { buildSchedule } from './debts.js';

/**
 * 「我现在真正有多少钱能花？」
 *
 * THE QUESTION THE APP COULD NOT ANSWER, AND WHY THAT WAS NOT OBVIOUS
 * Two figures existed and neither was this one:
 *
 *   ownCash             every ringgit in your own accounts. True, and useless
 *                       on its own — rent has not left yet, this month's
 *                       instalment has not left yet, so it flatters you by
 *                       exactly the amount you are about to owe.
 *   budget.available    income − commitments − spent, from cycle.js. Also true,
 *                       but it is a statement about the CYCLE, built on income
 *                       you told the app you earn. If the allowance came late,
 *                       or smaller, or never, that number does not move.
 *
 * The user's actual question is neither: "我现在到底还剩多少钱可以花". Money
 * that exists, right now, that is not already promised to someone.
 *
 *     spendable = 自己的现金 − 本期还没付的账单 − 本期还没还的债
 *
 * WHAT IS DELIBERATELY NOT SUBTRACTED
 *   · a custodial balance — it was never in `ownCash` to begin with. PBE's
 *     RM12,672.09 has never been counted as spendable and is not now.
 *   · the reserve shortfall — real, and owed, but nobody is asking for it this
 *     month. Folding it in would park this figure permanently in the negative
 *     and teach the user to ignore it. It is returned separately so the screen
 *     can say it out loud without mixing it in. That was his call: "两个都显示".
 *   · a bill already marked paid — the money is gone and `ownCash` already
 *     reflects it. Subtracting again would charge it twice.
 *   · a 'spread' annual bill's monthly slice — `charged`, not `budgeted`. This
 *     is a CASH figure: what actually leaves the account inside this cycle.
 *     A RM600 premium being set aside at RM50/month reserves RM50 in the
 *     budget but takes nothing out of the bank until the month it lands.
 *
 * @param {object} args
 * @param {Account[]} args.accounts    resolved (balances folded in)
 * @param {object[]}  args.allocations raw recurring bills
 * @param {object[]}  args.debts
 * @param {object[]}  args.expenses    full ledger
 * @param {object|null} args.cycle     from getCycle(); without it nothing is
 *                                     committed and `spendable` is just cash
 */
export function computeSpendable({ accounts = [], allocations = [], debts = [], expenses = [], cycle = null }) {
  const pos = computeNetPosition(accounts, debts, expenses);

  let essentialDue = 0;
  let optionalDue = 0;
  let billsPaid = 0;

  if (cycle) {
    // What has actually been paid against each bill this cycle, from linked
    // expense records. Derived rather than trusting the `paidFor` tick alone:
    // the tick is a flag someone has to set, and a payment restored from a
    // backup — or one whose tick was cleared by hand — would otherwise be
    // subtracted twice, once as cash already gone from the balance and again
    // as a bill still to pay.
    const paidByAllocation = new Map();
    for (const e of expenses) {
      if (e?.allocationId == null) continue;
      if (!isInCycle(e.date ?? cycle.start, cycle)) continue;
      const key = String(e.allocationId);
      paidByAllocation.set(key, (paidByAllocation.get(key) ?? 0) + Math.abs(num(e.amount)));
    }

    for (const raw of allocations) {
      const a = normalizeAllocation(raw);
      const { charged } = cycleCost(a, cycle);
      if (charged <= 0) continue;
      const paid = a.paidFor === cycle.start
        ? charged
        : Math.min(charged, paidByAllocation.get(String(a.id)) ?? 0);
      billsPaid += paid;
      // Only what is STILL to come out reduces what you can spend — whatever
      // has already left is missing from `ownCash` by definition.
      const stillDue = Math.max(0, charged - paid);
      if (stillDue <= 0) continue;
      if (a.essential) essentialDue += stillDue;
      else optionalDue += stillDue;
    }
  }

  const billsDue = essentialDue + optionalDue;
  // Repayments already made this cycle are ordinary expense records, so they
  // have already come out of `ownCash` — only what is STILL to be paid counts.
  const debtDue = cycle
    ? debts.reduce((sum, d) => sum + remainingPlanThisCycle(d, expenses, cycle), 0)
    : 0;

  const committedNow = billsDue + debtDue;
  const spendable = pos.ownCash - committedNow;

  return {
    ...pos,
    essentialDue,
    optionalDue,
    billsDue,
    billsPaid,
    debtDue,
    committedNow,
    spendable,
    // What is left if every non-essential commitment goes. The whole point of
    // marking a bill 非必要: without this the flag would be a label.
    spendableIfCut: spendable + optionalDue,
    // Owed, real, and not due this month. Named separately so the UI can print
    // it beside the spendable figure rather than inside it.
    reserveShortfall: pos.custodialShortfall,
    shortOfCommitments: spendable < 0,
  };
}
