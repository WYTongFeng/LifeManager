// Estimating what a meal costs you. Two free paths, no API key anywhere:
//
//   1. lookupFood()      — the offline table. Instant, and it already knows the
//                          daily staples (nasi lemak, roti canai, 白饭…).
//   2. parsePastedFood() — foodPaste.js. Anything the table doesn't have goes
//                          to whichever free AI chat is on the phone, and the
//                          reply is pasted back in.
//
// There used to be a third path in here: two Gemini calls, one for text and one
// for photos, billed to a prepaid balance. It was removed when the credits ran
// out — see foodPaste.js for what replaced it and why.
//
// What stayed is the part that actually makes mixed plates (杂菜饭 / nasi
// campur) usable: every estimate arrives as a per-COMPONENT list rather than a
// single lump sum. One number for rice plus three unidentified dishes is a
// guess the user cannot check or correct. A list is one he can fix in seconds —
// delete the dish that isn't there, halve the portion, add the egg it missed.

import { lookupFood } from './foodDb.js';

/** Roll a component list up into the meal totals. */
export function sumItems(items) {
  return items.reduce(
    (acc, it) => ({
      kcal: acc.kcal + (it.kcal || 0),
      p: acc.p + (it.p || 0),
      c: acc.c + (it.c || 0),
      f: acc.f + (it.f || 0),
    }),
    { kcal: 0, p: 0, c: 0, f: 0 }
  );
}

/** Rescale one component — how the user fixes a portion that was misread. */
export function scaleItem(item, factor) {
  return {
    ...item,
    kcal: Math.round(item.kcal * factor),
    p: Math.round(item.p * factor),
    c: Math.round(item.c * factor),
    f: Math.round(item.f * factor),
  };
}

/**
 * Name -> nutrition, from the offline table only.
 *
 * Synchronous now that nothing here reaches the network. The result is wrapped
 * as a one-item list so callers see the same shape from every path — the review
 * UI does not need to special-case a table hit.
 *
 * @param {string} description e.g. "2 roti canai" or "鸡胸肉"
 * @throws {Error} naming the paste flow, which is where a miss has to go next
 */
export function estimateFoodFromText(description) {
  if (!description?.trim()) throw new Error('请先输入食物名称');

  const local = lookupFood(description);
  if (!local) {
    throw new Error('本地资料库没有这项 — 用上面的「问 AI · 贴结果」，或者直接手动填热量');
  }

  return {
    ...local,
    items: [{
      id: `${Date.now()}-0`,
      name: local.name,
      portion: local.qty > 1 ? `${local.qty} ${local.unit}` : local.unit,
      kcal: local.kcal, p: local.p, c: local.c, f: local.f,
    }],
    confidence: 'high',
    note: '',
  };
}
