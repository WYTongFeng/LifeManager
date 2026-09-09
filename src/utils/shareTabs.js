// 共摊本 — a running tab for money that passes through you.
//
// THE RULE, IN HIS WORDS (2026-09-09)
// 「他们给了我那些全部加起来然后扣掉房租、扣掉 time wifi、那些 spotify，
//   多的算收入，少的算支出，就是结果才算，中间不用算」
//
// So a share tab is not a budget for each bill. It is ONE NET FIGURE per cycle:
//
//     净额 = 收到的 − 付出去的
//     净额 > 0  → that cycle's income
//     净额 < 0  → that cycle's spending, and that is what he actually paid
//
// Every record inside the tab — the RM2,000 rent, the RM26.90 Spotify, the
// RM354 a housemate sent back — is BUDGET-NEUTRAL ON ITS OWN. None of them is
// income, none of them is spending. Only the net crosses over.
//
// WHY THIS IS RIGHT AND THE PER-BILL VERSION WAS NOT
// The first design hung each person's share off each individual bill: a share
// of the rent, a share of Spotify, a share of the wifi. That is more precise
// and it is not how he lives. He collects one lump from five housemates
// covering all three bills, and what he wants to know at the end of the month
// is one number: 我实际出了多少. Splitting the lump back out across three
// bills to produce that number is work the app was asking HIM to do.
//
// It also dissolves three questions that had no good answer:
//   · reserve the gross or the net?      — neither; nothing inside is reserved
//   · does it matter which account paid? — no; PBE and TNG land in one tab
//   · is a housemate's transfer income?  — no; only a positive NET is
//
// IT SELF-CORRECTS ACROSS MONTHS, which is the part worth protecting. Two
// people pay late: this cycle's net is badly negative (true — he really is out
// of pocket), and next cycle their money arrives with no matching bill, so that
// net goes positive and hands it back. Nothing to chase, nothing to carry over
// by hand, and no cycle ever lies about the month it is describing.
//
// A TAB IS A LIST OF NAMES; the records are ordinary expenses carrying
// `shareTabId`. Same decision projects.js and debts.js made, for the same
// reason: the ledger, history, account balances, sync and backup keep working
// untouched, and "what is in this tab" is a filter rather than a second set of
// books to keep in step with the first.

import { num, sumBy } from './num.js';
import { isInCycle } from './cycle.js';

/** Is this record filed under a share tab? Then it never counts on its own. */
export function inShareTab(expense) {
  return expense?.shareTabId != null;
}

/** Records in one tab, in one cycle. */
export function tabRecords(tab, expenses = [], cycle) {
  if (tab?.id == null || !cycle) return [];
  return expenses.filter(e =>
    inShareTab(e)
    && String(e.shareTabId) === String(tab.id)
    && isInCycle(e.date ?? cycle.start, cycle));
}

/**
 * One cycle of one tab, resolved.
 *
 * `paidOut` and `received` are gross halves, kept separate because the screen
 * shows both — a net of −350 built from RM2,126 out and RM1,776 in is a very
 * different month from one built from RM350 out and nothing in, and the net
 * alone cannot tell them apart.
 *
 * Sign convention is the ledger's, unchanged: a positive `amount` is money
 * leaving, a negative one is money arriving (see the negative-amount trap in
 * accounts.js). So the net is simply the negated sum.
 */
export function tabCycle(tab, expenses = [], cycle) {
  const rows = tabRecords(tab, expenses, cycle);
  const paidOut = sumBy(rows.filter(e => num(e.amount) > 0), e => num(e.amount));
  const received = sumBy(rows.filter(e => num(e.amount) < 0), e => -num(e.amount));
  const net = received - paidOut;
  return {
    id: tab.id,
    label: tab.label ?? '共摊',
    rows,
    paidOut,
    received,
    net,
    // Named rather than left to every caller to re-derive from the sign, so
    // the two directions cannot drift apart across the screens that show them.
    isIncome: net > 0.005,
    isSpend: net < -0.005,
    // What he actually paid this cycle. Zero when the tab came out ahead —
    // that case is income, not negative spending.
    ownShare: net < 0 ? -net : 0,
  };
}

/** Every tab's cycle, skipping archived ones. */
export function tabsForCycle(tabs = [], expenses = [], cycle) {
  return tabs.filter(t => !t.archived).map(t => tabCycle(t, expenses, cycle));
}

/**
 * What the cycle budget has to be told, in the shape computeCycleBudget wants.
 * Only tabs that moved: a tab with nothing in it this cycle is not a RM0
 * commitment, it is simply absent.
 */
export function budgetLinesForCycle(tabs = [], expenses = [], cycle) {
  return tabsForCycle(tabs, expenses, cycle)
    .filter(t => t.isIncome || t.isSpend)
    .map(t => ({ id: t.id, label: t.label, net: t.net }));
}

/**
 * Who has put money in this cycle, largest first.
 *
 * Grouped by the name on the record, which is what he types when logging it —
 * 「里面可以看到这个项目谁给了多少钱」. Deliberately NOT a list of expected
 * shares: he was asked and said he does not want one
 * (「不需要懂谁欠我多少…我知道谁还没给的」). So this reports what happened, and
 * never what was supposed to happen.
 */
export function contributors(tab, expenses = [], cycle) {
  const by = new Map();
  for (const e of tabRecords(tab, expenses, cycle)) {
    const amount = num(e.amount);
    if (amount >= 0) continue;
    const name = (e.merchant || '').trim() || '没写名字';
    by.set(name, (by.get(name) ?? 0) + -amount);
  }
  return [...by.entries()]
    .map(([name, paid]) => ({ name, paid }))
    .sort((a, b) => b.paid - a.paid);
}

/** What went out this cycle, largest first — the bills side of the tab. */
export function outgoings(tab, expenses = [], cycle) {
  return tabRecords(tab, expenses, cycle)
    .filter(e => num(e.amount) > 0)
    .sort((a, b) => num(b.amount) - num(a.amount));
}
