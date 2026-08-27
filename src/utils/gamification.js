import { num } from './num.js';

/**
 * XP for one archived day.
 *
 * Coerced through `num` because this reads `history` — records written by every
 * build this app has ever had, plus anything a restored backup or a cloud merge
 * put there. One day with a missing field made `totalXp` NaN, which made
 * `computeLevel` return `LV.NaN` and `NaN/100 XP` on the Overview badge, and
 * (because the level-up effect compares `level > lastSeenLevel`, always false
 * for NaN) quietly wedged levelling for good.
 */
export function computeDayXP({ mealsLogged, totalCalories, calorieLimit, totalSets, totalExpense, dailyBudget }) {
  let xp = num(mealsLogged) * 10 + num(totalSets) * 5;
  if (num(mealsLogged) > 0 && num(totalCalories) <= num(calorieLimit)) xp += 20;
  if (num(totalExpense) > 0 && num(totalExpense) <= num(dailyBudget)) xp += 15;
  return xp;
}

export const XP_PER_LEVEL = 100;

export function computeLevel(rawXp) {
  const totalXp = Math.max(0, num(rawXp));
  const level = Math.floor(totalXp / XP_PER_LEVEL) + 1;
  const xpIntoLevel = totalXp % XP_PER_LEVEL;
  return {
    level,
    xpIntoLevel,
    xpForNextLevel: XP_PER_LEVEL,
    progressPct: (xpIntoLevel / XP_PER_LEVEL) * 100,
  };
}
