// Tests for the item-breakdown maths that makes mixed plates (杂菜饭) correctable.
// The network paths aren't covered here — these are the pure functions the UI
// leans on every time the user fixes a portion.
import { sumItems, scaleItem } from '../src/utils/foodEstimate.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// A typical mixed-rice plate as the model would break it down.
const plate = [
  { id: 'a', name: '白饭', portion: '一碗', kcal: 200, p: 4, c: 45, f: 0 },
  { id: 'b', name: '炸鸡', portion: '一块', kcal: 250, p: 20, c: 8, f: 16 },
  { id: 'c', name: '炒青菜', portion: '一份', kcal: 60, p: 3, c: 6, f: 3 },
  { id: 'd', name: '咖喱汁', portion: '两汤匙', kcal: 80, p: 1, c: 4, f: 7 },
];

// --- sumItems ----------------------------------------------------------------
check('totals are the sum of every component', sumItems(plate), { kcal: 590, p: 28, c: 63, f: 26 });
check('an empty plate totals zero, not NaN', sumItems([]), { kcal: 0, p: 0, c: 0, f: 0 });
check('a missing macro counts as zero rather than poisoning the sum',
  sumItems([{ kcal: 100 }, { kcal: 50, p: 5 }]), { kcal: 150, p: 5, c: 0, f: 0 });

// --- scaleItem ---------------------------------------------------------------
check('halving a component halves all four numbers',
  scaleItem(plate[1], 0.5), { id: 'b', name: '炸鸡', portion: '一块', kcal: 125, p: 10, c: 4, f: 8 });

check('doubling a component doubles all four numbers',
  scaleItem(plate[0], 2), { id: 'a', name: '白饭', portion: '一碗', kcal: 400, p: 8, c: 90, f: 0 });

check('scaling keeps name and portion untouched',
  [scaleItem(plate[2], 0.5).name, scaleItem(plate[2], 0.5).portion], ['炒青菜', '一份']);

check('scaling rounds to whole numbers, never fractions on screen',
  scaleItem({ id: 'x', name: 'n', portion: '', kcal: 75, p: 3, c: 7, f: 5 }, 0.5),
  { id: 'x', name: 'n', portion: '', kcal: 38, p: 2, c: 4, f: 3 });

// --- the correction workflow, end to end -------------------------------------
// This is the actual user story: the model over-read the rice and hallucinated
// a curry that wasn't there. Two taps should land on the right total.
let working = plate;
working = working.map((it) => (it.id === 'a' ? scaleItem(it, 0.5) : it)); // rice was half portion
working = working.filter((it) => it.id !== 'd');                          // no curry on the plate
// rice 100/2/23/0 (45g carbs halved rounds up) + chicken 250/20/8/16 + veg 60/3/6/3
check('after halving the rice and deleting the curry, totals follow',
  sumItems(working), { kcal: 410, p: 25, c: 37, f: 19 });

check('correcting leaves the remaining components untouched',
  working.map((i) => i.name), ['白饭', '炸鸡', '炒青菜']);

// Deleting everything must leave a clean zero — the save-time guard compares
// this against the typed total, so it has to be a real number.
check('deleting every component totals zero', sumItems([]), { kcal: 0, p: 0, c: 0, f: 0 });

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
