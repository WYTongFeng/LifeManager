// The whole record, as plain text you can paste into a chat with an AI.
//
// WHY THIS EXISTS AND WHY IT IS NOT THE JSON BACKUP
// `backup.js` already writes every byte of state to a file. That file is for
// restoring an install: it is a machine format, it is thousands of lines of
// nested objects and internal ids, and pasting it at a language model spends
// most of the context window on `"updatedAt": 1787501965780` before reaching a
// single fact worth reasoning about.
//
// This is the other direction. It answers, in order, the questions someone
// would actually ask about this data — what came in, what went out, on what, on
// which day, from which account, what is still owed — in the fewest words that
// keep it unambiguous. Derived figures are printed rather than left to be
// recomputed, because a reader who has to re-derive a total will sometimes get
// it wrong, and a reader who is a language model will do so confidently.
//
// Three rules throughout:
//   1. Say the units. "RM 12.50", "620 kcal", never a bare number.
//   2. Never print a figure that was not derived from a real record. A section
//      with nothing in it says so and moves on.
//   3. Absolute dates, always. "yesterday" is wrong the moment the file is read
//      on any day but the one it was written.

import { num, sumBy } from './num.js';
import { isSpendingRecord, isTransferRecord, resolveAccounts, typeMeta } from './accounts.js';
import { getCycle, getPreviousCycle, isInCycle, computeCycleBudget } from './cycle.js';
import { describeDate, toHHMM, sortByTime, todayStr } from './datetime.js';
import { countSets } from './workoutPlan.js';
import { SESSION_INTENSITY } from './calories.js';

const rm = (n) => `RM ${num(n).toFixed(2)}`;
const line = (c = '-', w = 56) => c.repeat(w);

/**
 * Display width of a string in a monospaced column.
 *
 * A CJK character occupies two cells, so `'吃饭'.padEnd(10)` adds 8 spaces to
 * something already 4 cells wide and the column lands 4 cells right of where it
 * should. Every label in this file is Chinese, so plain padEnd produced a table
 * with no straight edges anywhere in it.
 */
function width(str) {
  let w = 0;
  for (const ch of String(str ?? '')) {
    const c = ch.codePointAt(0);
    // CJK, kana, full-width forms — the ranges that actually appear here.
    w += (c >= 0x1100 && (
      c <= 0x115f
      || (c >= 0x2e80 && c <= 0xa4cf)
      || (c >= 0xac00 && c <= 0xd7a3)
      || (c >= 0xf900 && c <= 0xfaff)
      || (c >= 0xfe30 && c <= 0xfe6f)
      || (c >= 0xff00 && c <= 0xff60)
      || (c >= 0xffe0 && c <= 0xffe6)
    )) ? 2 : 1;
  }
  return w;
}

const pad = (s, w) => {
  const str = String(s ?? '');
  return str + ' '.repeat(Math.max(1, w - width(str)));
};

/**
 * The window a report covers.
 *
 * WHY THIS IS NOT "THE LAST N DAYS"
 * It was, and "最近 30 天" is not a month in this app. The month starts on
 * payday, the 10th — so on the 25th a 30-day window reaches back into the
 * PREVIOUS cycle and mixes two budgets into one set of totals. Every figure
 * stays arithmetically true and the report answers a question nobody asked.
 *
 * `from` is inclusive and `to` is EXCLUSIVE, matching `isInCycle` and
 * `cycle.end`, so 本月 and 上个月 tile exactly with no day counted twice and no
 * day falling between them.
 */
export function reportRanges(now = new Date()) {
  const cycle = getCycle(now);
  const prev = getPreviousCycle(cycle);
  const threeCycles = getPreviousCycle(getPreviousCycle(prev));
  return [
    {
      key: 'cycle',
      label: '本月',
      hint: `${cycle.start} → ${cycle.end}`,
      from: cycle.start, to: cycle.end,
    },
    {
      key: 'prev',
      label: '上个月',
      hint: `${prev.start} → ${prev.end}`,
      from: prev.start, to: prev.end,
    },
    {
      key: 'three',
      label: '最近 3 个月',
      hint: `${threeCycles.start} 起`,
      from: threeCycles.start, to: cycle.end,
    },
    { key: 'all', label: '全部', hint: '有记录以来', from: null, to: null },
  ];
}

/** Is this record inside [from, to)? An open end means "no limit that side". */
function inRange(date, from, to) {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date >= to) return false;
  return true;
}

/** Section heading, or nothing at all when there is nothing under it. */
function section(title, body) {
  const rows = (Array.isArray(body) ? body : [body]).filter(Boolean);
  if (rows.length === 0) return null;
  return [``, title, line(), ...rows].join('\n');
}

/** Group records by their date, newest day first. */
function byDate(records = []) {
  const map = new Map();
  for (const r of records) {
    const d = r?.date;
    if (!d) continue;
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(r);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

/**
 * Every expense, grouped by day, with the day's own total.
 *
 * The per-day total is the SPENDING total (isSpendingRecord), which excludes
 * transfers between your own accounts and money arriving from outside — both of
 * which are stored as expense records and neither of which is spending. Getting
 * this wrong is the single most common way a figure in this app goes wrong; see
 * accounts.js.
 */
function dailyLog(expenses, { today = todayStr() } = {}) {
  const rows = [];
  // No slice: the caller has already narrowed to the window it wants. Cutting
  // to "the most recent N days" on top of that would silently drop the oldest
  // days of the very month being exported.
  for (const [date, records] of byDate(expenses)) {
    const spend = sumBy(records.filter(isSpendingRecord), e => e.amount);
    rows.push(``);
    // `describeDate` returns 「今天」/「昨天」 for the recent days and a full
    // date otherwise — appending it unconditionally produced 「2026-08-20（8月
    // 20日（四））」, a date inside a date inside a bracket.
    const rel = describeDate(date, today);
    const head = rel.startsWith('今') || rel.startsWith('昨') || rel.startsWith('前')
      ? `${date}（${rel}）` : date;
    rows.push(`${head}  花了 ${rm(spend)}  共 ${records.length} 笔`);

    for (const e of sortByTime(records)) {
      const time = toHHMM(e.time) ?? '--:--';
      const amount = num(e.amount);
      // Sign carries meaning that the amount alone cannot: a negative record is
      // a refund, an arrival, or half a transfer, and those are three different
      // things. Spelled out rather than left to the reader.
      const kind = isTransferRecord(e) ? (amount > 0 ? '转出' : '转入')
        : e.isMoneyIn ? '进账'
        : e.repaysDebtId != null ? '还债'
        : amount < 0 ? '退款/别人还我'
        : '支出';
      const parts = [
        `  ${time}`,
        pad(kind, 14),
        pad(e.merchant || e.label || '（无名称）', 22),
        pad(rm(Math.abs(amount)), 12),
        e.category || '',
      ];
      const note = [e.paymentMethod, e.note].filter(Boolean).join(' · ');
      rows.push(parts.join(' ').trimEnd() + (note ? `  [${note}]` : ''));
    }
  }
  return rows;
}

/** Totals per category over the given records. */
function categoryTotals(expenses) {
  const totals = new Map();
  for (const e of expenses.filter(isSpendingRecord)) {
    if (num(e.amount) <= 0) continue;
    const key = e.category || 'Other';
    totals.set(key, (totals.get(key) ?? 0) + num(e.amount));
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const grand = sorted.reduce((s, [, v]) => s + v, 0);
  if (grand <= 0) return [];
  return sorted.map(([cat, v]) =>
    `  ${pad(cat, 24)} ${pad(rm(v), 12)} ${Math.round((v / grand) * 100)}%`);
}

/**
 * A money report: balances, this cycle's position, category totals, and the
 * day-by-day log.
 */
export function buildMoneyReport({
  expenses = [], accounts: rawAccounts = [], debts = [],
  incomeSources = [], allocations = [], dailyBudget = 0,
  from = null, to = null, rangeLabel = null, now = new Date(),
} = {}) {
  const today = todayStr(now);

  // Which cycle the budget block describes.
  //
  // If the window still contains today, it is the CURRENT cycle — and it must
  // be derived from `now`, not from the window's start date. Deriving it from
  // `from` produced the right cycle with the wrong position in it: exporting
  // 本月 on the 25th printed 「第 1 / 31 天，还剩 31 天」, because day zero of the
  // cycle is where the window begins, not where the user is standing.
  //
  // Only a window that lies entirely in the past reports on its own cycle —
  // exporting 上个月 must state last month's income and commitments, not this
  // month's, which is the kind of wrong that reads as right.
  const current = getCycle(now);
  const windowHasToday = !from || (today >= from && (!to || today < to));
  const cycle = windowHasToday ? current : getCycle(new Date(`${from}T12:00:00`));
  const windowed = (from || to)
    ? expenses.filter(e => inRange(e.date, from, to))
    : expenses;

  // Balances are ALWAYS derived from every record ever logged, never from the
  // window. A balance is the running result of the whole history; computing it
  // from one month would report what the account would hold if the user had
  // come into existence on the 10th.
  const accounts = resolveAccounts(rawAccounts, expenses);
  const budget = computeCycleBudget({ incomeSources, allocations, expenses, cycle });
  const inCycle = expenses.filter(e => isInCycle(e.date ?? cycle.start, cycle));

  const isCurrent = isInCycle(today, cycle);

  const out = [
    `LifeManager 记账资料`,
    `导出时间：${today} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    `货币：MYR（RM）`,
    `记账周期：每月 10 号发薪日为一个周期（不是 1 号）`,
    rangeLabel || (from ? `这份涵盖：${from} → ${to ?? '今天'}` : `这份涵盖：全部记录`),
    isCurrent
      ? `所属周期：${cycle.start} → ${cycle.end}（第 ${cycle.dayIndex + 1} / ${cycle.totalDays} 天，还剩 ${cycle.daysRemaining} 天，还没过完）`
      : `所属周期：${cycle.start} → ${cycle.end}（共 ${cycle.totalDays} 天，已结束）`,
  ];

  out.push(section('【本周期状况】', [
    `  ${pad('收入（设定）', 18)}${rm(budget.spendableIncome)}`,
    budget.arrivedThisCycle > 0 ? `  ${pad('实际进账', 18)}${rm(budget.arrivedThisCycle)}` : null,
    `  ${pad('固定开销', 18)}${pad(rm(budget.committed), 14)}（房租/订阅/欠款，已预留）`,
    `  ${pad('已经花掉', 18)}${rm(budget.grossSpentThisCycle)}`,
    budget.receivedThisCycle > 0 ? `  ${pad('收到退款/还款', 18)}${rm(budget.receivedThisCycle)}` : null,
    budget.repaidThisCycle > 0 ? `  ${pad('还债', 18)}${rm(budget.repaidThisCycle)}` : null,
    `  ${pad(budget.inDeficit ? '本周期亏损' : '还可以花', 18)}${rm(Math.abs(budget.netThisCycle))}${budget.inDeficit ? '   ← 超支' : ''}`,
    `  ${pad('每日安全额度', 18)}${rm(budget.dailySafeLimit)}`,
    dailyBudget > 0 ? `  ${pad('自订每日上限', 18)}${rm(dailyBudget)}` : null,
  ]));

  out.push(section('【户口余额】', accounts.length === 0 ? null : [
    ...accounts.filter(a => !a.archived).map(a =>
      `  ${pad(a.name, 26)} ${pad(rm(a.balance), 14)} ${typeMeta(a.type).label}${a.kind === 'custodial' ? '（代管，不可花）' : ''}`),
    ``,
    `  ${pad('可动用合计', 18)}${rm(sumBy(
      accounts.filter(a => !a.archived && a.kind !== 'custodial'), a => a.balance))}`,
  ]));

  out.push(section('【欠款】', debts.length === 0 ? null : debts.map(d => {
    const paid = sumBy(expenses.filter(e => e.repaysDebtId === d.id), e => Math.abs(num(e.amount)));
    const total = num(d.amount ?? d.principal);
    return `  ${pad(d.creditor || '（未命名）', 22)} 欠 ${pad(rm(total), 12)} 已还 ${pad(rm(paid), 12)} 剩 ${rm(Math.max(0, total - paid))}`;
  })));

  out.push(section('【固定月费】', allocations.length === 0 ? null :
    allocations.map(a => `  ${pad(a.label || '（未命名）', 26)} ${rm(a.amount ?? a.estimate)}${a.variable ? '（浮动，估算）' : ''}`)));

  out.push(section(`【这个周期的分类支出】（${cycle.start} → ${cycle.end}）`, categoryTotals(inCycle)));
  // Only worth printing when the window is not already the whole history —
  // otherwise it is the section above, repeated verbatim.
  if (from || to) {
    out.push(section(`【全部分类支出】（有记录以来，不限这个范围）`, categoryTotals(expenses)));
  }

  const log = dailyLog(windowed, { today });
  // Two different facts, and conflating them would hide the more important
  // one: "you logged nothing in August" and "you have never logged anything"
  // want completely different reactions from whoever reads this.
  out.push(section(`【每日明细】`,
    log.length > 0 ? log
      : (from || to) ? '  （这个范围内没有记录）'
      : '  （还没有任何记录）'));

  out.push('');
  out.push(line('='));
  out.push((from || to)
    ? `这个范围 ${windowed.length} 笔 · 全部记录共 ${expenses.length} 笔`
    : `共 ${expenses.length} 笔记录`);

  return out.filter(s => s != null).join('\n');
}

/** How one workout record reads on a line. */
function workoutLine(w) {
  const time = toHHMM(w.time) ?? '--:--';
  const kcal = w.calories == null ? '卡路里未知' : `~${num(w.calories)} kcal`;
  if (w.type === 'cardio') {
    return `  ${time}  有氧    ${pad(w.activity || '', 22)} ${pad(`${num(w.durationMin)} 分钟`, 10)}${w.distanceKm ? pad(`${w.distanceKm} km`, 10) : pad('', 10)}${kcal}`;
  }
  if (w.type === 'session') {
    const how = SESSION_INTENSITY[w.intensity]?.label ?? '';
    return `  ${time}  整场    ${pad(w.routineName || '', 22)} ${pad(`${num(w.durationMin)} 分钟`, 10)}${pad(`${num(w.setsPlanned)} 组`, 10)}${kcal}${how ? `  [${how}]` : ''}`;
  }
  const effort = w.mode === 'time' || num(w.holdSec) > 0
    ? `${num(w.holdSec)} 秒`
    : `${num(w.weightKg)}kg × ${num(w.reps)}`;
  return `  ${time}  力量    ${pad(w.exercise || '', 22)} ${pad(effort, 20)}${kcal}${w.isNewPR ? '  ← 新纪录' : ''}`;
}

/**
 * A health report: body profile, per-day intake vs burn, and the full log of
 * everything eaten and trained.
 *
 * Meals and workouts are deliberately in ONE report rather than two. The
 * question worth asking of this data is almost always about both at once — did
 * I eat more on training days, is the deficit real — and two files that have to
 * be mentally joined by date is exactly the work a report should have already
 * done.
 */
export function buildHealthReport({
  meals: allMeals = [], workouts: allWorkouts = [], history = [],
  bodyWeightKg = null, heightCm = null, ageYears = null, sex = null,
  calorieLimit = null, bmr = null,
  from = null, to = null, rangeLabel = null, now = new Date(),
} = {}) {
  const today = todayStr(now);

  // The same window as the money side, deliberately — including the fact that
  // 本月 here means the payday cycle, not the calendar month. Two different
  // definitions of "month" in one export screen would be worse than one
  // slightly unusual definition that the header states outright.
  const meals = (from || to) ? allMeals.filter(m => inRange(m.date, from, to)) : allMeals;
  const workouts = (from || to) ? allWorkouts.filter(w => inRange(w.date, from, to)) : allWorkouts;

  const out = [
    `LifeManager 饮食 & 健身资料`,
    `导出时间：${today} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    rangeLabel || (from ? `这份涵盖：${from} → ${to ?? '今天'}` : `这份涵盖：全部记录`),
  ];

  out.push(section('【身体资料】', [
    bodyWeightKg ? `  体重          ${bodyWeightKg} kg` : null,
    heightCm ? `  身高          ${heightCm} cm` : null,
    ageYears ? `  年龄          ${ageYears} 岁` : null,
    sex ? `  性别          ${sex === 'female' ? '女' : '男'}` : null,
    bmr ? `  基础代谢 BMR  ${bmr} kcal/天（静息，不含活动）` : null,
    calorieLimit ? `  每日热量目标  ${calorieLimit} kcal` : null,
  ]) ?? section('【身体资料】', '  （还没填体重/身高/年龄，所以没有卡路里估算）'));

  // One row per day: what went in, what came out, and the gap. This is the
  // table the whole file exists to produce.
  const dates = [...new Set([
    ...meals.map(m => m.date),
    ...workouts.map(w => w.date),
  ].filter(Boolean))].sort((a, b) => b.localeCompare(a));

  const summary = dates.map(date => {
    const dayMeals = meals.filter(m => m.date === date);
    const dayWorkouts = workouts.filter(w => w.date === date);
    const intake = sumBy(dayMeals, m => m.calories);
    const burn = sumBy(dayWorkouts, w => w.calories);
    const sets = countSets(dayWorkouts);
    const archived = history.find(h => h.date === date);
    return `  ${date}  吃 ${pad(`${intake} kcal`, 12)} 练 ${pad(`${burn} kcal`, 12)} ${pad(`${sets} 组`, 8)} ${pad(`${dayMeals.length} 餐`, 8)}${archived?.calorieLimit ? `目标 ${archived.calorieLimit}` : ''}`;
  });
  out.push(section(`【每日总结】`,
    summary.length ? summary
      : (from || to) ? '  （这个范围内没有记录）'
      : '  （还没有任何记录）'));

  // Full detail, day by day, meals and training interleaved under the date.
  const detail = [];
  for (const date of dates) {
    const dayMeals = sortByTime(meals.filter(m => m.date === date));
    const dayWorkouts = sortByTime(workouts.filter(w => w.date === date));
    detail.push(``);
    const rel = describeDate(date, today);
    detail.push(rel.startsWith('今') || rel.startsWith('昨') || rel.startsWith('前')
      ? `${date}（${rel}）` : date);
    if (dayMeals.length) {
      detail.push(`  — 吃的 —`);
      for (const m of dayMeals) {
        const macros = [
          m.protein != null ? `蛋白 ${num(m.protein)}g` : null,
          m.carbs != null ? `碳水 ${num(m.carbs)}g` : null,
          m.fat != null ? `脂肪 ${num(m.fat)}g` : null,
        ].filter(Boolean).join(' · ');
        detail.push(`  ${toHHMM(m.time) ?? '--:--'}  ${pad(m.name || '（无名称）', 26)} ${pad(`${num(m.calories)} kcal`, 12)}${macros}`);
      }
    }
    if (dayWorkouts.length) {
      detail.push(`  — 练的 —`);
      for (const w of dayWorkouts) detail.push(workoutLine(w));
    }
  }
  out.push(section(`【每日明细】`,
    detail.length ? detail
      : (from || to) ? '  （这个范围内没有记录）'
      : '  （还没有任何记录）'));

  out.push('');
  out.push(line('='));
  out.push((from || to)
    ? `这个范围 ${meals.length} 笔饮食、${workouts.length} 笔运动 · 全部共 ${allMeals.length} / ${allWorkouts.length} 笔`
    : `共 ${meals.length} 笔饮食、${workouts.length} 笔运动记录`);

  return out.filter(s => s != null).join('\n');
}

/**
 * Filename for a saved report.
 *
 * The range is in the name because two exports taken a minute apart — 本月 and
 * 上个月 — would otherwise differ only by the clock time in the filename, and be
 * indistinguishable in a Downloads folder a week later.
 */
export function reportFilename(kind, date = new Date(), rangeKey = null) {
  const d = todayStr(date);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const range = rangeKey ? `-${rangeKey}` : '';
  return `lifemanager-${kind}${range}-${d}-${hh}${mm}.txt`;
}
