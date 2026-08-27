// The coercion layer every total in the app now goes through, plus the record
// id generator. Small file, load-bearing: `sumBy` is what stops one malformed
// record from turning a whole day into NaN and having that NaN archived into
// `history`, which is never recomputed.

import { num, sumBy, newId } from '../src/utils/num.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// --- num -------------------------------------------------------------------
check('a number passes through', num(12.5), 12.5);
check('a negative passes through', num(-40), -40);
check('a numeric string is converted', num('12.5'), 12.5);
check('undefined is 0, not NaN', num(undefined), 0);
check('null is 0', num(null), 0);
check('an empty string is 0', num(''), 0);
check('a non-numeric string is 0, not NaN', num('abc'), 0);
check('NaN itself is 0', num(NaN), 0);
// Infinity is excluded as well as NaN: it formats as "RM ∞" and poisons a sum
// just as thoroughly, and no real amount is ever infinite.
check('Infinity is 0', num(Infinity), 0);
check('-Infinity is 0', num(-Infinity), 0);
check('an object is 0', num({}), 0);
check('an array is not silently coerced to its length', num([1, 2]), 0);

// --- sumBy -----------------------------------------------------------------
const meals = [
  { calories: 600 },
  { calories: 350 },
];
check('sums a clean list', sumBy(meals, m => m.calories), 950);

// The whole point: ONE bad row must cost one row, not the total.
const withJunk = [
  { calories: 600 },
  { name: 'no calories at all' },
  { calories: 'oops' },
  { calories: 350 },
];
check('one malformed record does not poison the sum', sumBy(withJunk, m => m.calories), 950);

check('an empty list is 0', sumBy([], m => m.calories), 0);
check('a non-array is 0, not a crash', sumBy(null, m => m.calories), 0);
check('a refund still nets negative', sumBy([{ amount: 30 }, { amount: -12 }], e => e.amount), 18);
check('the default picker sums bare numbers', sumBy([1, 2, 3]), 6);

// --- newId -----------------------------------------------------------------
// Ids are epoch-ms AND the record's timestamp, so they must stay numeric,
// close to now, and never collide — a collision makes two records share one
// Firestore document and one delete button.
const ids = Array.from({ length: 500 }, () => newId());
check('every id is unique even generated in one tick', new Set(ids).size, 500);
check('ids only ever increase', ids.every((v, i) => i === 0 || v > ids[i - 1]), true);
check('an id is a number', typeof ids[0], 'number');
check('and is still usable as a timestamp (within a second of now)',
  Math.abs(ids[0] - Date.now()) < 1000, true);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
