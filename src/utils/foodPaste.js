// 把外面 AI 的回答贴进来 —— 这个 app 自己不再调用任何 AI API。
//
// WHY THIS REPLACED THE API CALL
// The app used to hold a Gemini key and call it directly: one text call to
// price a food the local table didn't know, one vision call per photo. That
// cost real money per meal, on prepaid credits that ran out. Every free chat
// app on the phone already does the same estimate for nothing, so the only
// part worth keeping in here is the part they can't do: turning their answer
// into records this app can add up, and letting the numbers be corrected.
//
// The flow is now: copy AI_FOOD_PROMPT -> paste it plus a photo into whichever
// free chat -> copy the reply back -> parsePastedFood() turns it into the SAME
// item-breakdown shape the vision call used to return, so the review-and-
// correct UI in DietModule did not have to change at all.
//
// THE PARSER IS DELIBERATELY FORGIVING
// The prompt asks for `名字 | 分量 | 热量 | 蛋白 | 碳水 | 脂肪`, but the person
// pasting has no control over what the model on the other side actually
// writes, and models love to "help" — wrapping the table in markdown pipes,
// adding a header row, a `|---|---|` separator, bold names, a 合计 row at the
// bottom, or answering in JSON because that looked more machine-readable.
// Every one of those is the RIGHT answer typed slightly differently, and
// rejecting it sends the user back to re-prompt a chat app he cannot fix. So
// markdown tables, bare pipes, commas and JSON all land in the same place.

import { sumItems } from './foodEstimate.js';

/**
 * The prompt to hand the outside AI. This is the whole "公式" — the paste modal
 * copies it to the clipboard, so what comes back is already in the shape
 * parsePastedFood() reads best.
 *
 * Malaysian hawker portions are named explicitly because that is the frame of
 * reference that makes the numbers usable here; a model defaulting to US
 * restaurant servings gets 杂菜饭 badly wrong.
 */
export const AI_FOOD_PROMPT = `你是营养估算助手。我会给你一张食物照片，或一句食物描述。
请按马来西亚熟食摊 / 嘛嘛档的常见分量来估算。

只回覆一个表格，前后不要任何解释文字：

食物 | 分量 | 热量 | 蛋白质 | 碳水 | 脂肪
白饭 | 一碗 | 200 | 4 | 45 | 0
炸鸡 | 一块 | 250 | 20 | 8 | 16

规则：
- 盘里每一样分开一行：饭一行，每一道菜一行，明显的酱汁或油也各一行。
- 后面四栏只写数字，不要写单位，也不要写范围（写 250，不要写 200-300）。
- 热量是 kcal，蛋白质 / 碳水 / 脂肪是克。
- 估的是整份的量，不是每 100 克。
- 不要写「合计」那一行，我的 app 会自己加。
- 名字用中文。
- 如果有很不确定的地方，表格后面加一行「备注：……」，20 字以内。`;

// A cell that is a number and nothing else. Deliberately strict about the
// "nothing else": a portion like「1碗」must NOT read as a number, or it joins
// the run of macro columns and shifts every value one place to the left. Only
// real measurement units are tolerated after the digits.
const UNIT = '(?:kcal|kcals|cal|calories|大卡|千卡|卡路里|卡|g|gram|grams|克|公克)?';
const NUM_CELL = new RegExp(`^[+-]?\\d+(?:\\.\\d+)?(?:\\s*[-~–—至]\\s*\\d+(?:\\.\\d+)?)?\\s*${UNIT}$`, 'i');

// Rows that are real output but not food. A 合计 row parses perfectly as an
// item — a name and four numbers — and would silently double the whole meal.
const TOTAL_ROW = /^(合计|总计|共计|总共|合共|小计|一共|total|totals|sum|subtotal)/i;

const DISH_LINE = /^(?:餐名|菜名|名称|这餐|dish|meal)\s*[:：]\s*(.+)$/i;
const NOTE_LINE = /^(?:备注|注|说明|note|notes)\s*[:：]\s*(.+)$/i;

/** Markdown noise around a cell's text: **bold**, `code`, a leading "- " or "1. ". */
function cleanCell(raw) {
  return String(raw)
    .replace(/[*`_]/g, '')
    .replace(/^\s*(?:[-–—•]|\d+[.)])\s+/, '')
    .trim();
}

/**
 * A cell's numeric value, or null when the cell isn't purely a number.
 * A range ("200-300") becomes its midpoint — the model was asked not to write
 * one, but when it does anyway the midpoint beats refusing the row.
 */
function toNum(cell) {
  // Thousands separators only: the cell was already split on commas whenever
  // commas were the column separator, so a comma surviving to here sits inside
  // one number.
  const s = String(cell).replace(/[,，]/g, '');
  if (!NUM_CELL.test(s)) return null;
  const parts = s.match(/\d+(?:\.\d+)?/g);
  if (!parts) return null;
  const avg = parts.reduce((a, b) => a + Number(b), 0) / parts.length;
  return Number.isFinite(avg) ? Math.round(Math.abs(avg)) : null;
}

/** Assemble one item from a name, an optional portion, and its numbers. */
function makeItem(name, portion, nums, index) {
  // Read right-to-left: the documented tail is 热量/蛋白/碳水/脂肪, so when a
  // model prefixes an extra numeric column (a row number, a quantity) the four
  // that matter are still the last four.
  const [kcal = 0, p = 0, c = 0, f = 0] = nums.slice(-4);
  return {
    id: `${Date.now()}-${index}`,
    name: String(name).slice(0, 40),
    portion: String(portion).slice(0, 20),
    kcal, p, c, f,
  };
}

/** Line-based branch: markdown tables, bare pipes, or comma/tab separated. */
function parseRows(lines) {
  const items = [];
  for (const line of lines) {
    // Pipes win when present, so a comma inside 「1,200」 can't split a column.
    const cells = /[|｜]/.test(line) ? line.split(/[|｜]/) : line.split(/[,，\t]/);
    const cleaned = cells.map(cleanCell);
    while (cleaned.length && cleaned[0] === '') cleaned.shift();
    while (cleaned.length && cleaned[cleaned.length - 1] === '') cleaned.pop();
    if (cleaned.length < 2) continue;

    // `|---|:---:|` and friends.
    if (cleaned.every((c) => /^[-–—:\s]*$/.test(c))) continue;

    const name = cleaned[0];
    if (!name || TOTAL_ROW.test(name)) continue;

    // Walk in from the right while the cells are numbers. A header row
    // (食物|分量|热量|…) ends that run at zero and is skipped for free.
    let start = cleaned.length;
    while (start > 1 && toNum(cleaned[start - 1]) !== null) start--;
    if (start === cleaned.length) continue;

    const nums = cleaned.slice(start).map(toNum);
    const portion = cleaned.slice(1, start).join(' ');
    items.push(makeItem(name, portion, nums, items.length));
  }
  return items;
}

/** JSON branch — some models answer in JSON however the prompt is worded. */
function parseJsonItems(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
  if (!list) return null;

  const pick = (obj, keys) => {
    for (const k of keys) {
      const n = toNum(String(obj?.[k] ?? ''));
      if (n !== null) return n;
    }
    return 0;
  };

  const items = list.map((it, i) => makeItem(
    String(it?.name ?? it?.食物 ?? it?.dish ?? '未命名').trim() || '未命名',
    String(it?.portion ?? it?.分量 ?? '').trim(),
    [
      pick(it, ['calories', 'kcal', 'cal', '热量']),
      pick(it, ['protein', 'p', '蛋白质', '蛋白']),
      pick(it, ['carbs', 'carbohydrates', 'c', '碳水']),
      pick(it, ['fat', 'f', '脂肪']),
    ],
    i,
  ));

  return {
    items,
    dish: typeof data?.dish === 'string' ? data.dish.trim() : '',
    note: typeof data?.note === 'string' ? data.note.trim() : '',
  };
}

/**
 * Turn whatever the outside AI replied into a correctable meal estimate.
 *
 * @param {string} text the pasted reply
 * @returns {{name: string, kcal: number, p: number, c: number, f: number, items: object[], confidence: null, note: string, source: 'paste'}}
 * @throws {Error} with a message that says what to do next, not what went wrong
 */
export function parsePastedFood(text) {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('先把 AI 的回答贴进来');

  // Strip ``` fences, which a chat app puts around a table more often than not.
  const body = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();

  let items = [];
  let dish = '';
  let note = '';

  const json = /^[[{]/.test(body) ? parseJsonItems(body) : null;
  if (json) {
    ({ items, dish, note } = json);
  } else {
    const rows = [];
    for (const line of body.split(/\r?\n/)) {
      const t = cleanCell(line);
      if (!t) continue;
      const d = t.match(DISH_LINE);
      if (d) { dish = dish || d[1].trim(); continue; }
      const n = t.match(NOTE_LINE);
      if (n) { note = note || n[1].trim(); continue; }
      rows.push(t);
    }
    items = parseRows(rows);
  }

  // 0 kcal is either a parse that went wrong or a row worth nothing; 9000 in a
  // single component is a stray year/price/id that happened to land in the last
  // column. Neither belongs in a calorie total that gets archived at midnight.
  items = items.filter((it) => it.kcal > 0 && it.kcal <= 9000);

  if (!items.length) {
    throw new Error('看不懂这段文字 — 每一行要像「白饭 | 一碗 | 200 | 4 | 45 | 0」。先点上面「复制提示词」，连照片一起发给 AI 再试。');
  }

  return {
    name: (dish || items.map((i) => i.name).join(' + ')).slice(0, 60),
    ...sumItems(items),
    items,
    // No confidence badge: the model that wrote this was never asked how sure
    // it was, and inventing a level here would be the app making one up.
    confidence: null,
    note: note.slice(0, 90),
    source: 'paste',
  };
}
