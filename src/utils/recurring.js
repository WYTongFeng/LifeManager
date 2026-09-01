// Recurring commitments: rent, subscriptions, insurance, road tax.
//
// WHAT WAS WRONG BEFORE
// A "fixed monthly fee" was `{ label, amount }` and nothing else. That meant:
//   · no due date        — you could never see WHEN it comes out
//   · monthly only       — an annual insurance premium had nowhere to live
//   · no account         — nothing said which pot of money it leaves from
//   · one flat deduction — a weekly cost hit the cycle once, not four times
//
// So a bill was really just a number you subtracted from the month, with the
// timing — the part you actually plan around — nowhere in the model at all.
//
// THE TWO WAYS A NON-MONTHLY BILL CAN COUNT
// A RM 600 annual premium can be treated two ways, and both are legitimate:
//
//   'due'    — costs RM 600 in the one cycle it actually lands in, RM 0 in the
//              other eleven. Truthful about cash flow, brutal on that cycle.
//   'spread' — costs RM 50 every cycle, set aside so the RM 600 is already
//              there when it lands. Truthful about what it really costs you.
//
// Neither is right for everything, so it's a per-bill choice, defaulting to
// 'spread' for yearly/quarterly (a firewall app exists to stop the RM 600
// surprise) and 'due' for monthly/weekly (where they're identical anyway).
//
// All dates are local YYYY-MM-DD strings — never Date objects across a
// boundary, and never toISOString(), which shifts the day near midnight.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export const FREQUENCIES = [
  { value: 'monthly', label: '每月 Monthly', months: 1 },
  { value: 'quarterly', label: '每3个月 Quarterly', months: 3 },
  { value: 'halfyearly', label: '每半年 Half-yearly', months: 6 },
  { value: 'yearly', label: '每年 Yearly', months: 12 },
  { value: 'weekly', label: '每星期 Weekly', months: 0 },
  { value: 'once', label: '只有一次 One-off', months: 0 },
];

export function frequencyMeta(value) {
  return FREQUENCIES.find(f => f.value === value) ?? FREQUENCIES[0];
}

/** How many times a year this recurs — what 'spread' divides by. */
export function occurrencesPerYear(frequency) {
  switch (frequency) {
    case 'weekly': return 52;
    case 'monthly': return 12;
    case 'quarterly': return 4;
    case 'halfyearly': return 2;
    case 'yearly': return 1;
    default: return 0; // 'once' — never spread, it happens when it happens
  }
}

/**
 * Fill in every field a bill might be missing, on READ.
 *
 * Bills saved before this file existed are plain `{label, amount}` monthlies
 * with no due day. They're normalized to a monthly bill due on the first day of
 * the cycle, which is where the old model implicitly put everything anyway, so
 * an existing setup's numbers don't move the day this ships.
 */
export function normalizeAllocation(a, cycleStartDay = 1) {
  if (!a || typeof a !== 'object') return null;
  const frequency = a.frequency ?? 'monthly';
  return {
    id: a.id,
    label: a.label ?? '未命名',
    variable: Boolean(a.variable),
    amount: num(a.amount),
    estimate: num(a.estimate),
    actuals: a.actuals && typeof a.actuals === 'object' ? a.actuals : {},
    frequency,
    // Day of the MONTH for monthly/quarterly/halfyearly/yearly.
    // Day of the WEEK (0=Sun) for weekly. Ignored for 'once'.
    dueDay: a.dueDay != null ? Number(a.dueDay) : cycleStartDay,
    // Anchor month (1-12) for anything longer than monthly: a quarterly bill
    // anchored to March recurs in Mar/Jun/Sep/Dec, not Jan/Apr/Jul/Oct.
    dueMonth: a.dueMonth != null ? Number(a.dueMonth) : null,
    // The single date a 'once' bill happens on.
    onceDate: a.onceDate ?? null,
    // Which pot it leaves from. null = not yet said, which the UI nags about.
    accountId: a.accountId ?? null,
    // 'due' | 'spread' — see the header. Defaults by frequency.
    costing: a.costing ?? (occurrencesPerYear(frequency) < 12 && frequency !== 'once' ? 'spread' : 'due'),
    paidFor: a.paidFor ?? null,
    // 必要 / 非必要. Not a label — it splits 固定开销 into "一定要付" and
    // "可以砍", so the spendable figure can say what cutting the optional ones
    // would actually free up. A label nothing computes with is decoration, and
    // this module already had one of those.
    //
    // Only ever false when explicitly turned off: a bill that predates the flag
    // is treated as essential, which is the safe direction — it keeps being
    // subtracted from what you can spend rather than quietly becoming optional.
    //
    // MUST be listed here. This normalizer builds an explicit object rather
    // than spreading `...a`, so any field not named is deleted on every read —
    // exactly how `autoShortfallDebt` stayed silently dead in accounts.js.
    essential: a.essential !== false,
    // Bills stop. A cancelled subscription shouldn't need deleting (which
    // would lose its history) — it just ends.
    endDate: a.endDate ?? null,
    startDate: a.startDate ?? null,
  };
}

/** This cycle's per-occurrence amount: the real bill if known, else the estimate. */
export function resolveAmount(allocation, cycle) {
  if (!allocation.variable) return num(allocation.amount);
  const actual = allocation.actuals?.[cycle.start];
  if (actual != null) return num(actual);
  return num(allocation.estimate);
}

/** True while a variable bill is still running on a guess for this cycle. */
export function isEstimated(allocation, cycle) {
  return Boolean(allocation.variable) && allocation.actuals?.[cycle.start] == null;
}

/**
 * Clamp a day-of-month onto a real date in that month.
 * "The 31st" in February is the 28th/29th, not the 3rd of March — rolling over
 * is how a bill silently jumps into the next cycle four times a year.
 */
function dateOn(year, monthIndex, day) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(Math.max(1, day), lastDay));
}

/**
 * Every date this bill is deducted on inside `[from, to)`.
 *
 * Returns an array because a weekly bill legitimately hits four or five times
 * in one cycle — the old single-amount model got that silently wrong, counting
 * a RM 30/week cost as RM 30/month.
 *
 * @param {object} allocation  normalized
 * @param {string} from  YYYY-MM-DD inclusive
 * @param {string} to    YYYY-MM-DD exclusive
 */
export function dueDatesBetween(allocation, from, to) {
  const a = normalizeAllocation(allocation);
  const out = [];
  const start = parseYmd(from);
  const end = parseYmd(to);
  if (!(start < end)) return out;

  const notYetStarted = (dateStr) => a.startDate && dateStr < a.startDate;
  const alreadyEnded = (dateStr) => a.endDate && dateStr > a.endDate;
  const keep = (dateStr) => {
    if (dateStr < from || dateStr >= to) return;
    if (notYetStarted(dateStr) || alreadyEnded(dateStr)) return;
    out.push(dateStr);
  };

  if (a.frequency === 'once') {
    if (a.onceDate) keep(a.onceDate);
    return out;
  }

  if (a.frequency === 'weekly') {
    const targetDow = ((a.dueDay % 7) + 7) % 7;
    const cursor = new Date(start);
    // Walk forward to the first matching weekday, then step 7 days.
    while (cursor.getDay() !== targetDow) cursor.setDate(cursor.getDate() + 1);
    while (cursor < end) {
      keep(ymd(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
    return out;
  }

  const step = frequencyMeta(a.frequency).months || 1;
  // Anchor: which months of the year it lands in. Without one, every `step`th
  // month counting from January, which is what a plain "every 3 months" means.
  const anchorMonth = a.dueMonth != null ? ((a.dueMonth - 1) % step + step) % step : 0;

  // Start a month early so a due date at the very beginning of the window
  // isn't skipped by starting the scan mid-month.
  const cursor = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  const guard = new Date(end.getFullYear(), end.getMonth() + 1, 1);
  while (cursor < guard) {
    const monthIndex = cursor.getMonth();
    const inPhase = step === 1 || (((monthIndex % step) + step) % step) === anchorMonth;
    if (inPhase) keep(ymd(dateOn(cursor.getFullYear(), monthIndex, a.dueDay)));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

/** The next time this comes out of your account, on or after `fromDate`. */
export function nextDueDate(allocation, fromDate) {
  const from = fromDate ?? ymd(new Date());
  const horizon = parseYmd(from);
  horizon.setFullYear(horizon.getFullYear() + 2); // far enough for a yearly bill
  return dueDatesBetween(allocation, from, ymd(horizon))[0] ?? null;
}

/** Whole days until the next deduction, or null when there isn't one. */
export function daysUntilDue(allocation, fromDate) {
  const due = nextDueDate(allocation, fromDate);
  if (!due) return null;
  const from = parseYmd(fromDate ?? ymd(new Date()));
  return Math.round((parseYmd(due) - from) / 86400000);
}

/**
 * What this bill costs THIS cycle, and why.
 *
 * `charged` is what actually leaves the account inside the cycle.
 * `budgeted` is what the daily-limit maths should subtract — the same thing
 * for a 'due' bill, and the amortised slice for a 'spread' one.
 */
export function cycleCost(allocation, cycle) {
  const a = normalizeAllocation(allocation);
  const per = resolveAmount(a, cycle);
  const dates = dueDatesBetween(a, cycle.start, cycle.end);
  const charged = per * dates.length;

  if (a.costing !== 'spread') {
    return { per, dates, charged, budgeted: charged, spread: false };
  }

  // Set aside one cycle's share of the annual cost, every cycle, forever —
  // including the cycle it actually lands in (the money set aside in the
  // eleven cycles before is what pays it, so double-counting the twelfth
  // would over-reserve).
  const perYear = occurrencesPerYear(a.frequency);
  const budgeted = perYear > 0 ? (per * perYear) / 12 : charged;
  return { per, dates, charged, budgeted, spread: true };
}

/**
 * Everything due inside a window, newest-first-by-date, ready to render as a
 * calendar strip. Debt instalments come in through `extra` so the upcoming
 * list is one list, not two lists the user has to merge in their head.
 */
export function upcoming(allocations, cycle, { extra = [], limit = 12 } = {}) {
  const out = [];
  for (const raw of allocations) {
    const a = normalizeAllocation(raw);
    const per = resolveAmount(a, cycle);
    for (const due of dueDatesBetween(a, cycle.start, cycle.end)) {
      out.push({
        id: `${a.id}:${due}`,
        allocationId: a.id,
        label: a.label,
        amount: per,
        due,
        accountId: a.accountId,
        kind: 'bill',
        estimated: isEstimated(a, cycle),
        frequency: a.frequency,
      });
    }
  }
  out.push(...extra);
  out.sort((x, y) => String(x.due).localeCompare(String(y.due)));
  return out.slice(0, limit);
}

/** Sum of what every bill contributes to this cycle's budget. */
export function totalBudgeted(allocations, cycle) {
  return allocations.reduce((sum, a) => sum + cycleCost(a, cycle).budgeted, 0);
}

/** Sum of what actually leaves your accounts this cycle. */
export function totalCharged(allocations, cycle) {
  return allocations.reduce((sum, a) => sum + cycleCost(a, cycle).charged, 0);
}

/** Per-account totals for this cycle — "RM 380 comes out of Maybank on the 15th". */
export function chargedByAccount(allocations, cycle) {
  const map = new Map();
  for (const raw of allocations) {
    const a = normalizeAllocation(raw);
    const { charged } = cycleCost(a, cycle);
    if (charged <= 0) continue;
    const key = a.accountId == null ? '__unassigned' : String(a.accountId);
    map.set(key, (map.get(key) ?? 0) + charged);
  }
  return map;
}
