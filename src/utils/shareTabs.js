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
import { isInCycle, getCycle, getPreviousCycle } from './cycle.js';

/** Is this record filed under a share tab? Then it never counts on its own. */
export function inShareTab(expense) {
  return expense?.shareTabId != null;
}

// --- which month a tabbed record belongs to --------------------------------
//
// A record normally belongs to the month its `date` falls in. Friends' money
// breaks that in two ordinary ways, both raised 2026-09-28:
//
//   · 预付 — one housemate sent RM1,251.60 in one go for 10月 + 11月 + 12月.
//     Filed by date, the month it landed read as a windfall and the three
//     months after it each read RM417.20 worse than they were. The total was
//     right; no single month was, and "每个月花多少" is a question about
//     single months.
//   · 迟付 — last month's share arriving on the 3rd of this month.
//
// His answer: 「平均分到那几个月」. So a tabbed record can say which months it
// is FOR — `coversFrom` (a cycle start, YYYY-MM-DD) and `coversMonths` (≥ 1) —
// and its amount is split evenly across them. The ACCOUNT balance does not
// move with it: the money really did land on `date`, and accounts.js keeps
// reading `amount` exactly as before. Only the tab's month-by-month
// accounting is spread.

/** The longest spread offered. A year is already far past any real case. */
export const MAX_COVER_MONTHS = 12;

/** The cycle after this one. */
export function nextCycleOf(cycle) {
  return getCycle(new Date(cycle.endDate));
}

/**
 * The cycle starts a record is split across, oldest first — or null when it
 * simply belongs to the month of its own date.
 */
export function coveredCycleStarts(e) {
  const n = Math.min(Math.floor(num(e?.coversMonths)), MAX_COVER_MONTHS);
  if (!e?.coversFrom || n < 1) return null;
  const [y, m, d] = String(e.coversFrom).split('-').map(Number);
  if (!y || !m) return null;
  const out = [];
  for (let i = 0; i < n; i++) out.push(getCycle(new Date(y, m - 1 + i, d || 1)).start);
  return out;
}

/**
 * `amount` split into `parts` to the sen, the odd sen going to the earliest
 * months — so the pieces always add back up to exactly what was paid, never
 * RM0.01 short across a year of rounding.
 */
function splitEvenly(amount, parts) {
  const cents = Math.round(Math.abs(num(amount)) * 100);
  const base = Math.floor(cents / parts);
  const extra = cents - base * parts;
  const sign = num(amount) < 0 ? -1 : 1;
  return Array.from({ length: parts }, (_, i) => (sign * (base + (i < extra ? 1 : 0))) / 100);
}

/**
 * How much of this record belongs to `cycle`, signed the ledger's way: a
 * positive amount left the tab, a negative one came into it.
 */
export function portionIn(e, cycle) {
  const covered = coveredCycleStarts(e);
  if (covered) {
    const i = covered.indexOf(cycle.start);
    return i < 0 ? 0 : splitEvenly(e.amount, covered.length)[i];
  }
  return isInCycle(e.date ?? cycle.start, cycle) ? num(e.amount) : 0;
}

/** Is this record spread over months other than just its own date's? */
export function isSpread(e) {
  return coveredCycleStarts(e) != null;
}

/** Records in one tab that count toward one cycle — by date, or by what they cover. */
export function tabRecords(tab, expenses = [], cycle) {
  if (tab?.id == null || !cycle) return [];
  return expenses.filter(e => {
    if (!inShareTab(e) || String(e.shareTabId) !== String(tab.id)) return false;
    const covered = coveredCycleStarts(e);
    return covered ? covered.includes(cycle.start) : isInCycle(e.date ?? cycle.start, cycle);
  });
}

// --- what a tab is EXPECTED to cost him -------------------------------------
//
// THE HOLE THIS CLOSES (found 2026-09-28)
// The 2026-09-20 rule was 「不压，月底才结算」: a live month ignores the tab and
// an ended one settles on its real net. The arithmetic did exactly that — and
// nothing ever SHOWED an ended month. 本月 only ever displays the live cycle,
// and the text export never passed the tab in at all. So his real share of
// rent + TIME + Spotify, about RM266 a month, reached no figure anywhere, and
// 「这个月还剩」 read RM3,500 of income every month when the truth was
// RM3,233.75.
//
// His fix, picked from the options put to him: 「月初先预留」. Each friend's
// monthly amount lives on the tab (`members`), the bills already did
// (`bills`), and the difference is reserved from the 1st like any other bill.
// A friend paying early or late changes nothing mid-month — that part of
// 「不压」 survives intact — and the month still settles on what really
// happened once it is over.

/**
 * What this tab is expected to cost in one cycle.
 *
 * Null when the tab has no members. Without them nothing is expected back,
 * and reserving the full bills would drop the month by RM2,000+ the moment a
 * bill was added, before he'd had a chance to say who pays what.
 *
 * The bills side takes the LARGER of the planned bills and what actually went
 * out this cycle — the same rule cycle.js applies to every other bill. Rent
 * going up, or a one-off shared purchase, is money that really left, so the
 * reserve rises with it at once. The friends' side gets no such treatment:
 * counting money that has not arrived yet is the reassuring direction, the
 * one this app exists to refuse.
 */
export function expectedForCycle(tab, paidOut = 0) {
  const members = Array.isArray(tab?.members) ? tab.members : [];
  if (members.length === 0) return null;
  const expectedIn = sumBy(members, m => num(m.amount));
  const expectedOut = sumBy(Array.isArray(tab?.bills) ? tab.bills : [], b => num(b.amount));
  return {
    expectedIn,
    expectedOut,
    expectedNet: expectedIn - Math.max(expectedOut, num(paidOut)),
  };
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
 * accounts.js). So the net is simply the negated sum — of each record's
 * PORTION in this cycle, which is its whole amount unless it is spread.
 */
export function tabCycle(tab, expenses = [], cycle) {
  const rows = tabRecords(tab, expenses, cycle);
  const portions = rows.map(e => portionIn(e, cycle));
  const paidOut = sumBy(portions.filter(p => p > 0), p => p);
  const received = sumBy(portions.filter(p => p < 0), p => -p);
  const net = received - paidOut;
  const expected = expectedForCycle(tab, paidOut);
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
    // The month as planned, or all three null for a tab with no members.
    expectedIn: expected?.expectedIn ?? null,
    expectedOut: expected?.expectedOut ?? null,
    expectedNet: expected?.expectedNet ?? null,
  };
}

/**
 * Every tab's cycle. Archived tabs drop out — but only once they are actually
 * empty for this cycle.
 *
 * WHY THE SECOND HALF OF THAT SENTENCE EXISTS
 * A plain `!t.archived` filter is a hole big enough to lose money through.
 * `inShareTab` excludes a record from daily spend purely on `shareTabId != null`
 * — it never looks at the tab — so archiving a tab mid-cycle left its records
 * excluded from spending AND its net excluded from `budgetLinesForCycle`. The
 * RM2,000 of rent that passed through it simply stopped existing anywhere in
 * the month. Same family of bug as the earmark/share-tab double count, running
 * the other way.
 *
 * Archiving means "stop offering this for new records", not "erase the month".
 * So a tab that still has activity in this cycle keeps its card and its line in
 * the budget, and disappears on its own the moment the cycle rolls past it.
 */
export function tabsForCycle(tabs = [], expenses = [], cycle) {
  return tabs
    .filter(t => !t.archived || tabRecords(t, expenses, cycle).length > 0)
    .map(t => tabCycle(t, expenses, cycle));
}

// --- managing the tabs themselves ------------------------------------------
//
// A tab could be created (inline, from the 记账 form) and then never renamed,
// put away or removed — "我按进去不可以设置什么的吗，有点奇怪，然后也不可以
// 取消，就删除不掉" (2026-09-22). `archived` was read in five places and
// written by nothing.

/** Rename a tab. Blank names are refused rather than saved as an empty card. */
export function renameTab(tabs = [], tabId, label) {
  const name = String(label ?? '').trim();
  if (!name) return tabs;
  return tabs.map(t => (String(t.id) === String(tabId) ? { ...t, label: name } : t));
}

/** Put a tab away, or bring it back. */
export function setTabArchived(tabs = [], tabId, archived) {
  return tabs.map(t => {
    if (String(t.id) !== String(tabId)) return t;
    if (!archived) {
      const { archived: _drop, ...rest } = t;
      return rest;
    }
    return { ...t, archived: true };
  });
}

/**
 * How many records have EVER been filed under this tab — the whole ledger, not
 * one cycle. What decides whether deleting it is a safe thing to offer.
 */
export function tabRecordCount(tab, expenses = []) {
  if (tab?.id == null) return 0;
  return expenses.filter(e => inShareTab(e) && String(e.shareTabId) === String(tab.id)).length;
}

/**
 * Delete a tab outright.
 *
 * ONLY SAFE WHEN NOTHING POINTS AT IT. A record carries `shareTabId`, and
 * `inShareTab` keeps it out of daily spend on the strength of that field alone.
 * Delete the tab underneath and those records are excluded from spending by a
 * tab that no longer exists to net them — money that is in the ledger and in no
 * total. So this refuses, and the caller offers 封存 instead; `detachTabRecords`
 * is the honest way to empty a tab first.
 */
export function deleteTab(tabs = [], tabId, expenses = []) {
  const tab = tabs.find(t => String(t.id) === String(tabId));
  if (!tab) return { tabs, deleted: false, blockedBy: 0 };
  const count = tabRecordCount(tab, expenses);
  if (count > 0) return { tabs, deleted: false, blockedBy: count };
  return { tabs: tabs.filter(t => String(t.id) !== String(tabId)), deleted: true, blockedBy: 0 };
}

/**
 * One record, taken out of whatever tab it was in — an ordinary record again.
 *
 * Every tab-scoped field goes with the tab, not just `shareTabId`: a bill link
 * or a member link pointing into a tab the record no longer belongs to is the
 * same dangling-pointer bug one level down, and a month-spread means nothing
 * outside a tab (only tabs are accounted by month rather than by date).
 */
export function withoutTab(e) {
  return {
    ...e,
    shareTabId: null, shareTabBillId: null, shareTabMemberId: null,
    coversFrom: null, coversMonths: null,
  };
}

/**
 * One record, filed into `tabId`. Moving between tabs drops the links that
 * named the OLD tab's bills and members; the month-spread stays, because
 * "this was for 10–12月" is still true whichever tab it lands in.
 */
export function intoTab(e, tabId) {
  if (String(e?.shareTabId) === String(tabId)) return e;
  return { ...e, shareTabId: tabId, shareTabBillId: null, shareTabMemberId: null };
}

/**
 * Every record in this tab, with the tab link removed — they go back to being
 * ordinary spending and income. Returns the CHANGED records only, so the caller
 * can save them one at a time through the real save path (see the today-slice
 * setter trap: `setExpenses` silently no-ops on anything not dated today).
 */
export function detachTabRecords(tabId, expenses = []) {
  return expenses
    .filter(e => inShareTab(e) && String(e.shareTabId) === String(tabId))
    .map(withoutTab);
}

/**
 * What the cycle budget has to be told, in the shape computeCycleBudget wants:
 * each tab's actual net AND its expected one. Which of the two counts is the
 * budget's decision (live month → expected, ended month → actual), made in one
 * place — see computeCycleBudget.
 *
 * A tab with nothing in it and nothing expected is not a RM0 commitment, it is
 * simply absent. A tab with members but no records yet IS present: on the 1st,
 * before the rent has gone out, the month still has to reserve his share.
 */
export function budgetLinesForCycle(tabs = [], expenses = [], cycle) {
  return tabsForCycle(tabs, expenses, cycle)
    .filter(t => t.isIncome || t.isSpend || t.expectedNet != null)
    .map(t => ({ id: t.id, label: t.label, net: t.net, expectedNet: t.expectedNet }));
}

/**
 * Who has put money in this cycle, largest first, by the name on the record.
 *
 * Still used for a tab with no members, and for money in a tab with members
 * that was not matched to one of them — reporting what happened, whoever it
 * came from. For the planned side (who was supposed to pay what) see
 * `membersStatus`.
 */
export function contributors(tab, expenses = [], cycle) {
  const by = new Map();
  for (const e of tabRecords(tab, expenses, cycle)) {
    const portion = portionIn(e, cycle);
    if (portion >= 0) continue;
    const name = (e.merchant || '').trim() || '没写名字';
    by.set(name, (by.get(name) ?? 0) + -portion);
  }
  return [...by.entries()]
    .map(([name, paid]) => ({ name, paid }))
    .sort((a, b) => b.paid - a.paid);
}

/**
 * What went out this cycle, largest first — the bills side of the tab. Each
 * row carries `portion`, its share of THIS cycle, which is what a chip should
 * print: TIME prepaid for three months is RM210.95 of this month, not RM632.85.
 */
export function outgoings(tab, expenses = [], cycle) {
  return tabRecords(tab, expenses, cycle)
    .map(e => ({ ...e, portion: portionIn(e, cycle) }))
    .filter(e => e.portion > 0)
    .sort((a, b) => b.portion - a.portion);
}

// --- the members: who pays what, every month --------------------------------
//
// THIS REVERSES A DECISION, ON HIS SAY. Twice before he declined a list of who
// owes what — 「不需要懂谁欠我多少…我知道谁还没给的」 — and contributors()
// above was built to report, never to plan. On 2026-09-28 he gave the five
// amounts himself (448 / 417.20 / 413.20 / 327.20 / 360) and, asked outright,
// chose to store them. They are what makes the rest possible: the expected
// net that 「月初先预留」 reserves, "who hasn't paid this month", and knowing
// that RM1,251.60 is 3 × RM417.20 — a prepayment, not a windfall.
//
// A member is `{ id, name, amount, aliases? }`, stored on the tab the same way
// its bills are, so nothing new needs registering with sync. `aliases` are
// sender names learned from records he has already matched to that member —
// what a TNG notification calls someone is rarely what he calls them.

/** Add one member. Returns a new tabs array; never mutates. */
export function addTabMember(tabs = [], tabId, member) {
  return tabs.map(t => (String(t.id) === String(tabId)
    ? { ...t, members: [...(t.members ?? []), member] }
    : t));
}

/** Edit one member by id. Unknown ids are a no-op. */
export function updateTabMember(tabs = [], tabId, memberId, patch) {
  return tabs.map(t => (String(t.id) === String(tabId)
    ? { ...t, members: (t.members ?? []).map(m => (String(m.id) === String(memberId) ? { ...m, ...patch } : m)) }
    : t));
}

/**
 * Remove one member. Records already linked to them keep their
 * `shareTabMemberId` — the money still arrived, still counts in the tab's net —
 * and simply stop being attributed to anyone in `membersStatus`, the same way
 * `removeTabBill` treats a payment whose bill is gone.
 */
export function removeTabMember(tabs = [], tabId, memberId) {
  return tabs.map(t => (String(t.id) === String(tabId)
    ? { ...t, members: (t.members ?? []).filter(m => String(m.id) !== String(memberId)) }
    : t));
}

/** How a name is compared: case, spacing and stray whitespace don't matter. */
function nameKey(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Remember that a sender name belongs to a member, once he has confirmed it by
 * saving a record that way. Only ever adds; a name that is already the
 * member's own, or already learned, returns the list unchanged (same
 * reference), so callers can skip a pointless write.
 */
export function learnMemberAlias(tabs = [], tabId, memberId, senderName) {
  const key = nameKey(senderName);
  if (!key) return tabs;
  const tab = tabs.find(t => String(t.id) === String(tabId));
  const member = tab?.members?.find(m => String(m.id) === String(memberId));
  if (!member) return tabs;
  if (nameKey(member.name) === key || (member.aliases ?? []).includes(key)) return tabs;
  return updateTabMember(tabs, tabId, memberId, { aliases: [...(member.aliases ?? []), key] });
}

/**
 * Each member's month: what they were due, what they actually sent for THIS
 * cycle (spread payments counted by their portion), and where that leaves them.
 *
 *   state 'paid'     sent exactly their amount
 *         'partial'  sent something, not all of it
 *         'unpaid'   nothing yet
 *         'over'     sent more than one month's worth — usually a prepayment
 *                    that has not been spread yet, which is the screen's cue
 *                    to offer spreading it
 */
export function membersStatus(tab, expenses = [], cycle) {
  const members = Array.isArray(tab?.members) ? tab.members : [];
  if (members.length === 0) return [];
  const rows = tabRecords(tab, expenses, cycle);
  return members.map(m => {
    const mine = rows.filter(e => String(e.shareTabMemberId) === String(m.id));
    const paid = sumBy(mine, e => -portionIn(e, cycle));
    const due = num(m.amount);
    const diff = paid - due;
    const state = paid <= 0.005 ? 'unpaid'
      : diff < -0.005 ? 'partial'
      : diff > 0.005 ? 'over'
      : 'paid';
    return { ...m, due, paid, short: Math.max(0, -diff), extra: Math.max(0, diff), state, records: mine };
  });
}

/**
 * How many whole months of this member's amount `amount` is exactly — 3 for
 * RM1,251.60 against RM417.20 — or null when it is not a clean multiple.
 */
export function monthsWorth(member, amount) {
  const per = num(member?.amount);
  const value = Math.abs(num(amount));
  if (per <= 0 || value <= 0) return null;
  const k = Math.round(value / per);
  return k >= 1 && k <= MAX_COVER_MONTHS && Math.abs(k * per - value) < 0.005 ? k : null;
}

/**
 * Which member a sum of incoming money probably came from, and how many
 * months it is worth. Null when nothing fits — never a guess dressed up as a
 * match; see "suggest, don't decide".
 *
 * By name first (the member's own name, or a sender name learned from an
 * earlier match), then by amount: an exact whole number of months of exactly
 * one member's amount. Two members whose amounts both fit is a coin toss, so
 * it answers nothing rather than picking one.
 */
export function suggestMember(tab, { amount, merchant } = {}) {
  const members = Array.isArray(tab?.members) ? tab.members : [];
  if (members.length === 0) return null;
  const monthsOf = (m) => monthsWorth(m, amount);

  const key = nameKey(merchant);
  if (key) {
    const byName = members.find(m => nameKey(m.name) === key || (m.aliases ?? []).includes(key));
    if (byName) return { memberId: byName.id, months: monthsOf(byName) ?? 1, by: 'name' };
  }

  const fits = members.map(m => ({ m, k: monthsOf(m) })).filter(x => x.k != null);
  if (fits.length !== 1) return null;
  return { memberId: fits[0].m.id, months: fits[0].k, by: 'amount' };
}

/**
 * Which months a member's payment of `months` months should be spread over:
 * from the first month — the payment's own month onward — that this member has
 * not already fully paid, not counting the record being saved (`excludeId`).
 *
 * Forward only, deliberately. Looking backward for an unpaid month would, on
 * the day this shipped, find every friend "unpaid" for every earlier month —
 * their old records carry no member link — and file each new payment against
 * September. A late payment for last month is one tap in the form instead.
 *
 * Returns `{ coversFrom, coversMonths }`, or null when the answer is just "the
 * month it was paid in", which needs no fields at all.
 */
export function suggestCoverage(tab, memberId, months, dateStr, expenses = [], excludeId = null) {
  const member = tab?.members?.find(m => String(m.id) === String(memberId));
  const n = Math.min(Math.floor(num(months)), MAX_COVER_MONTHS);
  if (!member || n < 1 || !dateStr) return null;
  const others = excludeId == null ? expenses : expenses.filter(e => e.id !== excludeId);
  const own = getCycle(new Date(`${dateStr}T12:00:00`));
  let cursor = own;
  for (let i = 0; i < MAX_COVER_MONTHS; i++) {
    const st = membersStatus(tab, others, cursor).find(m => String(m.id) === String(memberId));
    if (!st || st.paid < st.due - 0.005) break;
    cursor = nextCycleOf(cursor);
  }
  if (n === 1 && cursor.start === own.start) return null;
  return { coversFrom: cursor.start, coversMonths: n };
}

/**
 * 「10–12 月」 — how a spread reads on a row. Null for an unspread record.
 */
export function coverageLabel(e) {
  const covered = coveredCycleStarts(e);
  if (!covered) return null;
  const month = (start) => Number(start.slice(5, 7));
  const first = covered[0];
  const last = covered[covered.length - 1];
  if (covered.length === 1) return `${month(first)} 月的`;
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  return sameYear
    ? `${month(first)}–${month(last)} 月`
    : `${first.slice(0, 4)}年${month(first)}月–${last.slice(0, 4)}年${month(last)}月`;
}

// --- 结算 — acknowledging a cycle that has already settled itself ----------
//
// computeCycleBudget (cycle.js) needs no stamp at all: a cycle past its own
// `end` folds its net into the budget automatically, the instant it's over.
// So NOTHING here gates any arithmetic. What this section exists for is a
// narrower, purely human question — "have I actually LOOKED at what last
// month's tab came to" — because a net that quietly becomes true in the
// background is exactly the kind of thing this whole app exists to surface,
// not hide. His own words: "可以有一些手动确认的吗，我比较安心一点".
//
// The stamp lives ON THE TAB (`tab.settled[cycleStart]`), the same shape
// recurring.js already uses for `actuals`/`skipped` — one more field on an
// object already synced, not a new persisted key needing its own
// registration. See syncModel.js's META_DOCS and the sync-registration-
// required lesson this sidesteps by construction.

/** Has this tab's cycle been acknowledged? */
export function isSettled(tab, cycleStart) {
  return tab?.settled?.[cycleStart] != null;
}

/**
 * Stamp (or un-stamp) one cycle as acknowledged. Returns a new tabs array;
 * never mutates. Unsettling is a real, supported way back — pressing 就这样结
 * by mistake, or wanting to look at the breakdown again, must not be a
 * one-way door.
 */
export function setSettled(tabs = [], tabId, cycleStart, settled) {
  return tabs.map(t => {
    if (String(t.id) !== String(tabId)) return t;
    const next = { ...(t.settled ?? {}) };
    if (settled) next[cycleStart] = Date.now();
    else delete next[cycleStart];
    return { ...t, settled: next };
  });
}

/**
 * Every ended cycle this tab actually had activity in, most recent first,
 * each carrying whether it's been acknowledged — the shared walk behind
 * `unsettledCycles` and `settledCycles` below.
 *
 * Walks backward from the cycle before `liveCycle` (the current one is never
 * settleable — it hasn't ended, by construction, as long as the caller passes
 * a genuine "now" cycle — every screen that calls this gets one from
 * `getCycle()`) and stops at the first EMPTY cycle: a tab that collected
 * nothing that far back has nothing further back worth surfacing either, so a
 * tab created last week doesn't make this scan crawl through years of cycles
 * that never had it. `maxBack` is a second, smaller safety net for the same
 * reason debts.js's repaymentOutlook caps at 12.
 */
function tabCycleHistory(tab, expenses, liveCycle, maxBack) {
  const out = [];
  let cursor = getPreviousCycle(liveCycle);
  for (let i = 0; i < maxBack; i++) {
    const resolved = tabCycle(tab, expenses, cursor);
    if (resolved.rows.length === 0) break;
    out.push({
      ...resolved,
      cycleStart: cursor.start,
      cycleEnd: cursor.end,
      settled: isSettled(tab, cursor.start),
      // Who fell short that month — what turns 「比预计多出 RM417.20」 into
      // a name. Empty for a tab with no members.
      members: membersStatus(tab, expenses, cursor),
    });
    cursor = getPreviousCycle(cursor);
  }
  return out;
}

/**
 * Ended cycles with real activity that haven't been acknowledged yet — most
 * recent first. This is what the 就这样结 banner lists.
 */
export function unsettledCycles(tab, expenses = [], liveCycle, maxBack = 12) {
  return tabCycleHistory(tab, expenses, liveCycle, maxBack).filter(c => !c.settled);
}

/**
 * Ended cycles already acknowledged, within the same lookback window — what
 * a 取消结算 control lists, so settling one is never a one-way door just
 * because the banner that offered it has already gone quiet.
 */
export function settledCycles(tab, expenses = [], liveCycle, maxBack = 12) {
  return tabCycleHistory(tab, expenses, liveCycle, maxBack).filter(c => c.settled);
}

// --- a tab's own bills — what replaces 固定月费 for the things inside it ----
//
// Before this, 房租/Time/Spotify had to live as ordinary 固定月费 allocations
// even after their payments moved into a 共摊本 — the "几号交" reminder had
// nowhere else to be. A tab bill is that reminder, moved: `{id, label,
// amount, dueDay}`, always monthly, always simple — none of an allocation's
// frequency/variable/custodial machinery, because none of it applies to
// something whose whole cost is about to be netted against housemates
// anyway. It reserves nothing on its own; see computeCycleBudget, which
// never looks at `bills` at all — only the tab's NET still reaches the
// budget, same as ever.

/** Add one bill to a tab. Returns a new tabs array; never mutates. */
export function addTabBill(tabs = [], tabId, bill) {
  return tabs.map(t => (String(t.id) === String(tabId)
    ? { ...t, bills: [...(t.bills ?? []), bill] }
    : t));
}

/** Edit one bill on a tab by id. Unknown ids are a no-op. */
export function updateTabBill(tabs = [], tabId, billId, patch) {
  return tabs.map(t => (String(t.id) === String(tabId)
    ? { ...t, bills: (t.bills ?? []).map(b => (String(b.id) === String(billId) ? { ...b, ...patch } : b)) }
    : t));
}

/**
 * Remove one bill from a tab. Expenses already logged against it (via
 * `shareTabBillId`) are left exactly as they are — same as an allocation
 * deleted out from under a payment that already claimed it (cycle.js's
 * `liveAllocationIds`), a dangling id is not something anything here rewrites
 * to cover up; `billsStatus` below simply never mentions a bill that is gone.
 */
export function removeTabBill(tabs = [], tabId, billId) {
  return tabs.map(t => (String(t.id) === String(tabId)
    ? { ...t, bills: (t.bills ?? []).filter(b => String(b.id) !== String(billId)) }
    : t));
}

/**
 * Each of a tab's bills, with whether THIS cycle's payment has been logged
 * against it yet.
 *
 * "Paid" is derived, the same way a 固定月费's `paidFor` really means "a
 * linked expense exists this cycle" underneath — asked by looking for a
 * tabbed record carrying this bill's id, not stored as a flag that could
 * fall out of step with the ledger itself.
 */
export function billsStatus(tab, expenses = [], cycle) {
  const bills = Array.isArray(tab?.bills) ? tab.bills : [];
  const rows = tabRecords(tab, expenses, cycle);
  return bills.map(bill => {
    const paidRecord = rows.find(e => String(e.shareTabBillId) === String(bill.id)) ?? null;
    return { ...bill, paid: paidRecord != null, paidRecord };
  });
}
