// The conversational AI Coach. Plumbing (key, model, daily spend cap) lives in
// gemini.js and is shared with the food estimator, so both draw down one budget.

import { callGemini, isAiConfigured, isDailyBudgetExhausted } from './gemini.js';
import { num, sumBy } from './num.js';
import { comparableDomains } from './weekStats.js';

export { isAiConfigured, isDailyBudgetExhausted };

// Only recent turns go to the API — the persisted chat can be 200 messages
// long, and older turns add cost without adding useful context.
const HISTORY_WINDOW = 8;

/**
 * Itemise today's food. The coach used to get only a count and a total, so it
 * could not answer "what did I eat?" or "where did my protein go?" — the two
 * things a food log is actually for. Item names are short, so listing them
 * costs far less than the answers it unlocks.
 */
function describeMeals(meals) {
  if (!meals.length) return '还没记录任何食物。';
  return meals
    .map((m) => {
      const macros = [
        m.protein ? `蛋白${m.protein}g` : null,
        m.carbs ? `碳水${m.carbs}g` : null,
        m.fat ? `脂肪${m.fat}g` : null,
      ].filter(Boolean).join(' ');
      // A breakdown means the number came from a plate the user corrected —
      // worth showing, since the coach can then talk about the components.
      const parts = m.items?.length > 1
        ? `（${m.items.map((i) => i.name).join('、')}）`
        : '';
      return `  · ${m.category ?? ''} ${m.time ?? ''} ${m.name}${parts} ${m.calories} kcal${macros ? ` (${macros})` : ''}`;
    })
    .join('\n');
}

/** Group sets by exercise — 13 individual sets would be noise, not context. */
function describeWorkouts(workouts) {
  if (!workouts.length) return '今天还没有训练记录。';

  const strength = new Map();
  const cardio = [];
  for (const w of workouts) {
    if (w.type === 'cardio') {
      cardio.push(`  · ${w.activity ?? '有氧'} ${w.durationMin ?? '?'}分钟${w.calories ? ` ~${w.calories} kcal` : ''}`);
    } else {
      const e = strength.get(w.exercise) ?? { sets: 0, top: 0, kcal: 0 };
      e.sets += 1;
      e.top = Math.max(e.top, w.weightKg || 0);
      e.kcal += w.calories || 0;
      strength.set(w.exercise, e);
    }
  }

  const lines = [...strength.entries()].map(
    ([name, e]) => `  · ${name} ${e.sets}组${e.top ? ` 最重${e.top}kg` : ''}${e.kcal ? ` ~${e.kcal} kcal` : ''}`
  );
  return [...lines, ...cardio].join('\n');
}

/**
 * The week, as structured facts for the model to interpret.
 *
 * WHY THE APP DOES THE ARITHMETIC
 * The coach used to be handed TODAY and nothing else, so "am I eating enough
 * protein?" could only ever be answered about one day — the timescale on which
 * the answer is meaningless. The fix is not to hand it a week of raw records and
 * hope: that is more tokens, and it asks the model to do sums, which is exactly
 * what the system prompt below forbids it from improvising. computeWeekReview
 * has already done them, with the same filters the screens use, so the coach and
 * 本周回顾 cannot disagree about the same week.
 *
 * TWO THINGS THIS DELIBERATELY WITHHOLDS
 * · A comparison for a domain the app itself refuses to compare. If last week
 *   had no training logged, "3 days vs 0" is a fact about the log, not about
 *   training — see comparableDomains. Handing the model that subtraction is
 *   how it ends up congratulating him on an improvement that never happened.
 * · Any average without its denominator. `daysLogged` goes with every average,
 *   because "1,025 kcal/day" over two logged days and over seven are different
 *   claims and the number alone cannot tell them apart.
 */
function describeWeek(week) {
  if (!week?.current) return '（本周还没有可用的汇总。）';

  const { current: c, previous: p, partial, elapsed } = week;
  const can = comparableDomains(p);
  // Named honestly: on a Wednesday the "previous" figures are last week's first
  // three days, and a model told "last week" would describe them as a full week.
  const vs = partial ? `上周同期（前 ${elapsed} 天）` : '上周整周';
  const lines = [];

  lines.push(c.nutrition.daysLogged > 0
    ? `饮食：${c.nutrition.daysLogged} 天有记录 · 平均 ${c.nutrition.avgCalories} kcal/天 · 蛋白平均 ${c.nutrition.avgProtein} g/天`
    : '饮食：这周还没有记录，所以没有平均值可谈。');

  lines.push(`训练：${c.training.daysTrained} 天（力量 ${c.training.strengthDays} · 有氧 ${c.training.cardioSessions}）· ${c.training.totalSets} 组 · ${c.training.minutes} 分钟`
    + (can.training ? ` · ${vs}是 ${p.training.daysTrained} 天 / ${p.training.totalSets} 组` : ' · 上周没有训练记录，无法比较'));

  lines.push(`消费：RM ${c.money.totalSpend.toFixed(2)}（${c.money.entries} 笔，只算日常消费，不含账单/还款/转账）`
    + (can.money ? ` · ${vs}是 RM ${p.money.totalSpend.toFixed(2)}` : ' · 上周没有消费记录，无法比较'));

  lines.push(c.body.changeKg != null
    ? `体重：${c.body.startKg} → ${c.body.endKg} kg（${c.body.changeKg > 0 ? '+' : ''}${c.body.changeKg}kg，本周量了 ${c.body.readings} 次）`
    : c.body.latestKg != null
      ? `体重：最近一次 ${c.body.latestKg} kg，本周没有足够的记录算出变化。`
      : '体重：没有记录。');

  return lines.map((l) => `  · ${l}`).join('\n');
}

function describeExpenses(expenses) {
  if (!expenses.length) return '今天还没有消费记录。';
  return expenses
    .map((e) => `  · ${e.category ?? ''} ${e.merchant ?? e.name ?? ''} RM ${Number(e.amount ?? 0).toFixed(2)}`)
    .join('\n');
}

function buildSystemPrompt({ meals, calorieLimit, macroTargets, workouts, expenses, dailyBudget, balance, week = null }) {
  // Coerced, like everywhere else: the system prompt tells the model "NEVER
  // invent a number", so a "NaN kcal" in the brief it is handed would be the
  // app inventing one for it.
  const totalCalories = sumBy(meals, m => m.calories);
  const totalProtein = sumBy(meals, m => m.protein);
  const totalCarbs = sumBy(meals, m => m.carbs);
  const totalFat = sumBy(meals, m => m.fat);
  const totalExp = sumBy(expenses, e => e.amount);
  const t = macroTargets ?? {};

  return `You are the LifeManager AI Coach: a blunt, no-nonsense personal manager for a
cash-strapped university student who is deliberately using this app as a spending
firewall. Your job is behavioral coaching grounded in their actual logged numbers —
not generic encouragement, and not personalized financial/investment/legal advice.

Style: short, direct, a little confronting. State the real numbers plainly. If
they're overspending or slacking, say so plainly instead of softening it. Reply in
the language the user writes in.

NEVER invent a number. Everything you know is below — TODAY in detail, plus this
WEEK as totals. If the user asks about something that isn't here (a specific past
day, a food they didn't log, a measurement you weren't given), say you don't have
it and tell them where to log it. Where a section says a comparison can't be made
because last week has no records, do NOT make one anyway — "you trained more than
last week" against an unlogged week is a claim about the log, not about training. Calorie
figures for logged food are ESTIMATES from a lookup table or a photo — treat them
as approximate, and say so if the user leans on a small difference.

=== 今天的饮食 ===
合计 ${totalCalories} kcal / 目标 ${num(calorieLimit)} kcal（还剩 ${num(calorieLimit) - totalCalories}）
蛋白 ${totalProtein}g${t.protein ? `/${t.protein}g` : ''} · 碳水 ${totalCarbs}g${t.carbs ? `/${t.carbs}g` : ''} · 脂肪 ${totalFat}g${t.fat ? `/${t.fat}g` : ''}
${describeMeals(meals)}

=== 今天的训练 ===
${describeWorkouts(workouts)}
${balance ? `
=== 热量收支 ===
摄入 ${balance.intake} − 消耗 ${balance.burn}（基础代谢+日常活动+训练）= ${balance.net > 0 ? `盈余 ${balance.net}` : `赤字 ${Math.abs(balance.net)}`} kcal` : ''}

=== 今天的消费 ===
合计 RM ${totalExp.toFixed(2)} / 每日预算 RM ${num(dailyBudget).toFixed(2)}
${describeExpenses(expenses)}

=== 本周（周一起算） ===
${describeWeek(week)}

Averages above are per day WITH A RECORD, not per day of the week — if only two
days were logged, say so rather than treating it as the whole week.

Keep replies under ~120 words unless the user asks for detail.`;
}

/**
 * @param {{sender: 'user'|'ai', text: string}[]} history - full persisted chat, oldest first
 * @param {object} appData - { meals, calorieLimit, workouts, expenses, dailyBudget }
 * @returns {Promise<string>} the assistant's reply text
 */
export async function askAiCoach(history, appData) {
  const contents = history.slice(-HISTORY_WINDOW).map((m) => ({
    role: m.sender === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }],
  }));

  return callGemini({
    contents,
    system: buildSystemPrompt(appData),
    maxOutputTokens: 300,
  });
}
