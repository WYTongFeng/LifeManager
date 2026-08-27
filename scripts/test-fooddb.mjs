import { FOOD_DB, lookupFood, parseQuantity, searchFoods } from '../src/utils/foodDb.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// --- parseQuantity -----------------------------------------------------------
check('bare name is quantity 1', parseQuantity('roti canai'), { qty: 1, rest: 'roti canai' });
check('leading digit', parseQuantity('2 roti canai'), { qty: 2, rest: 'roti canai' });
check('leading digit with a unit word', parseQuantity('3 片 roti canai'), { qty: 3, rest: 'roti canai' });
check('trailing x2', parseQuantity('teh tarik x2'), { qty: 2, rest: 'teh tarik' });
check('decimal quantity, with the unit word stripped off the name',
  parseQuantity('1.5 碗白饭'), { qty: 1.5, rest: '白饭' });
check('chinese numeral', parseQuantity('两个鸡蛋'), { qty: 2, rest: '鸡蛋' });
check('chinese half', parseQuantity('半碗白饭'), { qty: 0.5, rest: '白饭' });
check('a name that merely starts with a letter is untouched', parseQuantity('milo'), { qty: 1, rest: 'milo' });

// --- lookupFood: the free path -----------------------------------------------
const nl = lookupFood('nasi lemak');
check('exact english alias hits', [nl.name, nl.kcal, nl.source], ['椰浆饭 Nasi Lemak', 650, 'local']);

check('case and spacing are ignored', lookupFood('Nasi   Lemak').kcal, 650);
check('chinese alias hits the same entry', lookupFood('椰浆饭').kcal, 650);

// The longest-alias rule: a more specific dish must beat its own prefix.
check('"nasi lemak ayam goreng" resolves to the fried-chicken entry, not plain nasi lemak',
  lookupFood('nasi lemak ayam goreng').name, '椰浆饭 + 炸鸡');

check('quantity scales calories', lookupFood('2 roti canai').kcal, 600);
check('quantity scales macros too', [lookupFood('2 roti canai').p, lookupFood('2 roti canai').c], [12, 80]);
check('quantity is reported back for the UI', lookupFood('3 teh tarik').qty, 3);
check('half portions round sensibly', lookupFood('半碗白饭').kcal, 100);

check('a substring of an alias still matches', lookupFood('canai').name, '印度煎饼 Roti Canai');
check('extra words around the alias still match', lookupFood('roti canai panas').name, '印度煎饼 Roti Canai');

// The mixed-plate trap: a long description that merely MENTIONS a known dish
// must not be priced as that dish. Handing it to the AI tier is the right
// answer; a confident 500 kcal for "KFC 炸鸡" here would be silently wrong.
check('a long mixed-plate description does not match on one incidental word',
  lookupFood('杂菜饭 白饭加炸鸡炒长豆和咖喱汁'), null);
check('another incidental mention is rejected too',
  lookupFood('今天午餐吃了很多东西还有一点点鸡蛋'), null);
check('but a short qualifier around a dish name still matches',
  lookupFood('午餐 椰浆饭').name, '椰浆饭 Nasi Lemak');

check('unknown food returns null so the caller can offer AI', lookupFood('宫保鸡丁配藜麦'), null);
check('empty query returns null', lookupFood(''), null);
check('whitespace-only query returns null', lookupFood('   '), null);
check('null query does not throw', lookupFood(null), null);

// --- searchFoods -------------------------------------------------------------
check('search finds partial matches', searchFoods('teh').length > 0, true);
check('search returns nothing for an empty query', searchFoods(''), []);
check('search respects the limit', searchFoods('a', 3).length <= 3, true);

// --- data integrity ----------------------------------------------------------
const missingFields = FOOD_DB.filter(
  (f) => !f.name || !Number.isFinite(f.kcal) || !Number.isFinite(f.p) ||
         !Number.isFinite(f.c) || !Number.isFinite(f.f) || !f.aliases?.length
);
check('every entry has a name, four numbers, and at least one alias', missingFields.map(f => f.name), []);

// Macro calories should land near the stated total. Real foods include fibre,
// alcohol, and rounding, so this only catches entries that are plainly wrong
// (a transposed digit), not honest estimate noise.
const wildlyOff = FOOD_DB.filter((f) => {
  if (f.kcal < 60) return false; // rounding dominates at tiny portions
  const fromMacros = f.p * 4 + f.c * 4 + f.f * 9;
  return Math.abs(fromMacros - f.kcal) / f.kcal > 0.30;
});
check('no entry has macros that contradict its calorie count by >30%', wildlyOff.map(f => f.name), []);

const dupes = [];
const seen = new Map();
for (const f of FOOD_DB) {
  for (const a of f.aliases) {
    const key = a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (seen.has(key) && seen.get(key) !== f.name) dupes.push(`${a} (${seen.get(key)} vs ${f.name})`);
    seen.set(key, f.name);
  }
}
check('no alias points at two different foods', dupes, []);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
