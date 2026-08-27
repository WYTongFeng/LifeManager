// Estimating what a meal costs you, in three tiers of increasing expense:
//
//   1. lookupFood()          — free, offline, instant. Handles the daily staples.
//   2. estimateFoodFromText  — one cheap text call for anything not in the table.
//   3. estimateFoodFromPhoto — a vision call, only when the user actually takes
//                              a photo (the most expensive path, so never automatic).
//
// Tier 1 is tried first everywhere. That ordering is the whole point: the user
// is credit-conscious, and most meals are repeat orders the table already knows.

import { callGemini, isAiConfigured } from './gemini.js';
import { lookupFood } from './foodDb.js';

// Photos are downscaled before upload: a phone camera JPEG is several MB, and
// the model reads a 768px image just as well for "what food is this" while
// costing far less to send.
const MAX_IMAGE_EDGE = 768;
const JPEG_QUALITY = 0.8;

// The model returns a per-COMPONENT breakdown, never a single lump sum.
//
// This is the answer to mixed plates (杂菜饭 / nasi campur): one number for a
// plate of rice + three unidentified dishes is a guess the user cannot check or
// correct. A list they can see is one they can fix in seconds — delete the dish
// the model invented, halve the portion it over-read, add the egg it missed.
// Accuracy on such plates comes from the user's five-second correction, not
// from the model being right first try, so the UI is built around correcting.
const FOOD_SYSTEM = `You estimate nutrition for meals, with Malaysian hawker/mamak portions as the
default frame of reference. Reply ONLY with JSON matching this shape:

{"isFood": boolean, "dish": string, "items": [{"name": string, "portion": string, "calories": number, "protein": number, "carbs": number, "fat": number}], "confidence": "high"|"medium"|"low", "note": string}

Rules:
- isFood: false if the input is not food or drink at all. Set it BEFORE anything else.
- items: ONE ENTRY PER COMPONENT you can distinguish. A plate of mixed rice
  becomes separate entries for the rice and for EACH dish on it — never one
  combined entry. A single simple food is just one entry.
- List every component you can see, including sauce/gravy and cooking oil when
  they are clearly present. Do not merge two different dishes into one entry.
- portion: short, concrete, in the user's language ("一碗", "一块", "两汤匙").
- calories in kcal; protein/carbs/fat in grams; all numbers, no units, no ranges.
- Estimate the WHOLE portion shown or described, not per 100g.
- dish: a short name for the meal as a whole, in the user's language.
- confidence: "low" whenever portions are genuinely unclear — a mixed plate
  photographed from above usually IS low. Do not overstate it.
- note: at most 15 words on your biggest assumption, in the user's language.
  Empty string if nothing to say.
- dish and every name/portion must be in the SAME language the user wrote in.`;

/** Strip ```json fences some models add, then parse. */
function parseFoodJson(raw) {
  const cleaned = String(raw).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let data;
  try {
    data = JSON.parse(cleaned);
  } catch {
    throw new Error('AI 返回的格式看不懂，请手动输入');
  }

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  };

  // An explicit boolean, not a sentinel string in `note` — the note is written
  // in the user's language, so matching on its text would break the moment the
  // model answers in Chinese.
  if (data.isFood === false) throw new Error('这看起来不是食物');

  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items = rawItems
    .map((it, i) => ({
      id: `${Date.now()}-${i}`,
      name: typeof it?.name === 'string' && it.name.trim() ? it.name.trim() : '未命名',
      portion: typeof it?.portion === 'string' ? it.portion.trim().slice(0, 20) : '',
      kcal: num(it?.calories),
      p: num(it?.protein),
      c: num(it?.carbs),
      f: num(it?.fat),
    }))
    .filter((it) => it.kcal > 0);

  if (!items.length) throw new Error('AI 估不出热量，请手动输入');

  const dish = typeof data.dish === 'string' && data.dish.trim()
    ? data.dish.trim()
    : items.map((i) => i.name).join(' + ');

  return {
    name: dish,
    ...sumItems(items),
    items,
    confidence: ['high', 'medium', 'low'].includes(data.confidence) ? data.confidence : 'medium',
    note: typeof data.note === 'string' ? data.note.slice(0, 90) : '',
    source: 'ai',
  };
}

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

/** Rescale one component — how the user fixes a portion the model misread. */
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
 * Text -> nutrition. Checks the local table first and returns that for free
 * when it hits, so callers can use this as the single entry point.
 *
 * @param {string} description e.g. "2 roti canai" or "麦当劳双层牛肉堡"
 * @param {{forceAi?: boolean}} [opts] skip the local table (user rejected the match)
 */
export async function estimateFoodFromText(description, { forceAi = false } = {}) {
  if (!description?.trim()) throw new Error('请先输入食物名称');

  if (!forceAi) {
    const local = lookupFood(description);
    // Wrapped as a one-item list so callers see the same shape from every
    // tier — the review UI does not need to special-case table hits.
    if (local) {
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
  }

  if (!isAiConfigured()) throw new Error('本地资料库没有这项，而 AI 估算未设置');

  const raw = await callGemini({
    contents: [{ role: 'user', parts: [{ text: `估算这份食物的热量和三大营养素：${description}` }] }],
    system: FOOD_SYSTEM,
    maxOutputTokens: 500, // itemised replies are longer than a single lump sum
    json: true,
  });
  return parseFoodJson(raw);
}

/**
 * Downscale + re-encode an image File to a base64 JPEG payload for the API.
 * Returns { data, mimeType } with `data` base64 (no data: prefix).
 */
export function fileToInlineImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);

      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      const comma = dataUrl.indexOf(',');
      if (comma < 0) return reject(new Error('图片处理失败'));
      resolve({ data: dataUrl.slice(comma + 1), mimeType: 'image/jpeg' });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('读不到这张图片'));
    };

    img.src = url;
  });
}

/**
 * Photo -> nutrition. The expensive tier, so it only ever runs on an explicit
 * user action (taking/choosing a photo), never as an automatic fallback.
 *
 * @param {File} file image from a camera or the gallery
 * @param {string} [hint] optional extra context the user typed
 */
export async function estimateFoodFromPhoto(file, hint = '') {
  if (!file) throw new Error('没有选到图片');
  if (!isAiConfigured()) throw new Error('AI 未设置：缺少 API key');

  const image = await fileToInlineImage(file);
  const prompt = [
    '看这张照片，把盘里每一样东西分开列出来（饭、每一道菜、酱汁都各算一项），',
    '并估算各自的热量和三大营养素。',
    hint.trim() ? `补充说明：${hint.trim()}` : '',
  ].filter(Boolean).join('');

  const raw = await callGemini({
    contents: [{
      role: 'user',
      parts: [{ text: prompt }, { inlineData: image }],
    }],
    system: FOOD_SYSTEM,
    maxOutputTokens: 700, // a mixed plate can run to half a dozen components
    json: true,
  });
  return parseFoodJson(raw);
}
