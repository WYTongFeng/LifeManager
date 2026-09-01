// Tests for the paste-from-an-outside-AI parser.
//
// This is the ONLY thing standing between a free chat app's reply and the
// calorie log, now that nothing here calls an API. The person pasting cannot
// control how the model on the other side formats its answer, so almost every
// case below is a real shape a chat app produces when asked for that table:
// markdown pipes, a header row, a separator row, bold names, a 合计 row, a
// range instead of a number, JSON because it felt more machine-readable.
//
// The failure that matters most is the QUIET one — a 合计 row read as food, or
// a portion column read as a number, either of which produces a total that is
// wrong but plausible, gets saved, and is archived into `history` at midnight
// where nothing ever recomputes it.
import { parsePastedFood } from '../src/utils/foodPaste.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const throws = (name, fn) => {
  try { fn(); fail++; console.log(`FAIL  ${name} (did not throw)`); }
  catch { pass++; console.log(`PASS  ${name}`); }
};
/** Items as [name, portion, kcal, p, c, f] — the shape assertions read best in. */
const rows = (r) => r.items.map((i) => [i.name, i.portion, i.kcal, i.p, i.c, i.f]);

// --- the documented format ---------------------------------------------------
const plain = parsePastedFood(`白饭 | 一碗 | 200 | 4 | 45 | 0
炸鸡 | 一块 | 250 | 20 | 8 | 16`);
check('plain pipes parse into components', rows(plain), [
  ['白饭', '一碗', 200, 4, 45, 0],
  ['炸鸡', '一块', 250, 20, 8, 16],
]);
check('totals are the sum of the components',
  [plain.kcal, plain.p, plain.c, plain.f], [450, 24, 53, 16]);
check('the meal name falls back to the components joined', plain.name, '白饭 + 炸鸡');
check('a pasted estimate is marked as such, not as a table hit', plain.source, 'paste');
check('no confidence is invented for a model that was never asked', plain.confidence, null);

// --- what a chat app ACTUALLY sends back --------------------------------------
// Markdown table, header row, separator row, bold names, a total, and a fence.
const markdown = parsePastedFood(`当然可以！这是估算：

\`\`\`
| 食物 | 分量 | 热量 | 蛋白质 | 碳水 | 脂肪 |
|------|------|------|--------|------|------|
| **白饭** | 一碗 | 200 | 4 | 45 | 0 |
| **咖喱鸡** | 一份 | 280 | 22 | 6 | 18 |
| 合计 | | 480 | 26 | 51 | 18 |
\`\`\`
备注：分量按一般份量估算`);
check('a full markdown table survives fences, header, separator and bold', rows(markdown), [
  ['白饭', '一碗', 200, 4, 45, 0],
  ['咖喱鸡', '一份', 280, 22, 6, 18],
]);
// The one that would silently double every meal.
check('the 合计 row is not eaten as a component',
  [markdown.kcal, markdown.items.length], [480, 2]);
check('a 备注 line becomes the note, not a food row', markdown.note, '分量按一般份量估算');

check('an English total row is skipped too',
  parsePastedFood('Rice | 1 bowl | 200 | 4 | 45 | 0\nTotal | | 200 | 4 | 45 | 0').items.length, 1);

// --- the column-shift trap ----------------------------------------------------
// A portion written as「1碗」must not read as a number: if it joins the numeric
// run every macro shifts one place left and the fat column vanishes.
check('a portion like 1碗 stays a portion, not a fifth number',
  rows(parsePastedFood('白饭 | 1碗 | 200 | 4 | 45 | 0')),
  [['白饭', '1碗', 200, 4, 45, 0]]);
check('a unit-suffixed number is still a number',
  rows(parsePastedFood('白饭 | 一碗 | 200 kcal | 4g | 45g | 0g')),
  [['白饭', '一碗', 200, 4, 45, 0]]);
check('a leading numeric column is ignored — the last four still win',
  rows(parsePastedFood('1 | 白饭 | 一碗 | 200 | 4 | 45 | 0')),
  [['1', '白饭 一碗', 200, 4, 45, 0]]);

// --- looser things models do --------------------------------------------------
check('a range becomes its midpoint rather than being refused',
  rows(parsePastedFood('炸鸡 | 一块 | 200-300 | 20 | 8 | 16')),
  [['炸鸡', '一块', 250, 20, 8, 16]]);
check('a missing portion column still parses',
  rows(parsePastedFood('白饭 | 200 | 4 | 45 | 0')),
  [['白饭', '', 200, 4, 45, 0]]);
check('calories alone, with no macros, is a valid row',
  rows(parsePastedFood('白饭 | 一碗 | 200')),
  [['白饭', '一碗', 200, 0, 0, 0]]);
check('commas work as separators when there are no pipes',
  rows(parsePastedFood('白饭,一碗,200,4,45,0')),
  [['白饭', '一碗', 200, 4, 45, 0]]);
check('a thousands separator inside a pipe cell is not a column break',
  rows(parsePastedFood('大餐 | 一份 | 1,200 | 40 | 120 | 50')),
  [['大餐', '一份', 1200, 40, 120, 50]]);
check('a list marker in front of the name is stripped',
  rows(parsePastedFood('- 白饭 | 一碗 | 200 | 4 | 45 | 0')),
  [['白饭', '一碗', 200, 4, 45, 0]]);
check('a 餐名 line names the meal instead of becoming a row',
  parsePastedFood('餐名：杂菜饭\n白饭 | 一碗 | 200 | 4 | 45 | 0').name, '杂菜饭');

// --- JSON, because some models answer that way whatever the prompt says --------
const json = parsePastedFood(`{"dish":"椰浆饭","items":[
  {"name":"白饭","portion":"一碗","calories":200,"protein":4,"carbs":45,"fat":0},
  {"name":"炸鸡","portion":"一块","calories":250,"protein":20,"carbs":8,"fat":16}
]}`);
check('a JSON reply lands in the same shape as a table', rows(json), [
  ['白饭', '一碗', 200, 4, 45, 0],
  ['炸鸡', '一块', 250, 20, 8, 16],
]);
check('a JSON dish name is used', json.name, '椰浆饭');
check('a bare JSON array works too',
  parsePastedFood('[{"name":"白饭","kcal":200}]').kcal, 200);

// --- rows that must not become food ------------------------------------------
check('a zero-calorie row is dropped rather than logged as nothing',
  parsePastedFood('白饭 | 一碗 | 200 | 4 | 45 | 0\n水 | 一杯 | 0 | 0 | 0 | 0').items.length, 1);
// A stray year/price/id landing in the last column would otherwise be eaten as
// calories, and a five-figure kcal poisons every total downstream of it.
check('an absurd calorie figure is dropped, not logged',
  parsePastedFood('白饭 | 一碗 | 200 | 4 | 45 | 0\n收据编号 | | 20260901').items.length, 1);

throws('empty paste is refused', () => parsePastedFood('   '));
throws('prose with no table is refused', () => parsePastedFood('这看起来像是一盘杂菜饭，大概七百多卡吧。'));
throws('a header row alone is refused rather than logged as a meal',
  () => parsePastedFood('食物 | 分量 | 热量 | 蛋白质 | 碳水 | 脂肪'));

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
