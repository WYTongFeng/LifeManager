import {
  normalizeWeightLog, latestWeight, recordWeight, removeWeight,
  weightSeries, weightChangeOver, MAX_ENTRIES,
} from '../src/utils/bodyWeight.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// --- normalizeWeightLog --------------------------------------------------
check('a non-array is an empty log', normalizeWeightLog(null), []);
check('rows without a date are dropped',
  normalizeWeightLog([{ kg: 67 }, { date: '2026-08-01', kg: 67, at: 1 }]),
  [{ date: '2026-08-01', kg: 67, at: 1 }]);
check('a zero or missing weight is not a reading',
  normalizeWeightLog([{ date: '2026-08-01', kg: 0 }, { date: '2026-08-02' }]), []);
check('a garbage weight cannot poison the log',
  normalizeWeightLog([{ date: '2026-08-01', kg: 'sixty-seven' }]), []);
check('readings come back oldest first, whatever order they went in',
  normalizeWeightLog([
    { date: '2026-08-05', kg: 66.6, at: 2 },
    { date: '2026-08-01', kg: 67, at: 1 },
  ]).map(w => w.date),
  ['2026-08-01', '2026-08-05']);
check('weights are stored to one decimal',
  normalizeWeightLog([{ date: '2026-08-01', kg: 66.6666, at: 0 }])[0].kg, 66.7);

// --- recordWeight --------------------------------------------------------
const log1 = recordWeight([], { kg: 67, date: '2026-08-01', at: 100 });
check('the first weigh-in is recorded', log1, [{ date: '2026-08-01', kg: 67, at: 100 }]);

const log2 = recordWeight(log1, { kg: 66.6, date: '2026-08-08', at: 200 });
check('a different weight on a later date appends', log2.length, 2);
check('...in date order', log2.map(w => w.kg), [67, 66.6]);

// THE HONESTY RULE. Saving the body-profile modal to fix a height must not
// deposit a weigh-in that never happened.
const unchanged = recordWeight(log2, { kg: 66.6, date: '2026-08-20', at: 300 });
check('the same number on a later date records NOTHING', unchanged, log2);
check('...so no phantom reading appears on a day nobody weighed',
  unchanged.some(w => w.date === '2026-08-20'), false);

// A real change on that day is recorded normally.
const changed = recordWeight(log2, { kg: 66.2, date: '2026-08-20', at: 300 });
check('a changed number on a later date is recorded', changed.length, 3);
check('...with the new value', changed[changed.length - 1].kg, 66.2);

// Same day, corrected value: replace, never two readings for one date.
const corrected = recordWeight(log2, { kg: 66.9, date: '2026-08-08', at: 250 });
check('re-weighing the same day replaces that day', corrected.length, 2);
check('...keeping the later reading', corrected.find(w => w.date === '2026-08-08').kg, 66.9);

check('an invalid weight changes nothing', recordWeight(log2, { kg: 0 }), log2);
check('a NaN weight changes nothing', recordWeight(log2, { kg: 'abc' }), log2);

// The cap keeps a META_DOCS document bounded, dropping the OLDEST.
const long = [];
for (let i = 0; i < MAX_ENTRIES + 50; i++) {
  const d = new Date(2020, 0, 1 + i);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  long.push({ date, kg: 60 + (i % 100) / 10, at: i });
}
const capped = recordWeight(long, { kg: 99.9, date: '2030-01-01', at: 1 });
check('the log is capped', capped.length, MAX_ENTRIES);
check('the newest reading survives the cap', capped[capped.length - 1].kg, 99.9);
check('the oldest are the ones dropped', capped[0].date > '2020-01-01', true);

// --- latestWeight / removeWeight / weightSeries --------------------------
check('latest is the most recent reading', latestWeight(log2).kg, 66.6);
check('an empty log has no latest', latestWeight([]), null);
check('a reading can be deleted', removeWeight(log2, '2026-08-08').length, 1);
check('deleting a date that is not there changes nothing', removeWeight(log2, '2026-01-01').length, 2);

check('the series is chart-shaped, newest last',
  weightSeries(log2), [
    { date: '2026-08-01', label: '08-01', kg: 67 },
    { date: '2026-08-08', label: '08-08', kg: 66.6 },
  ]);
check('the series is limited to the most recent N',
  weightSeries(long, 3).length, 3);

// --- weightChangeOver ----------------------------------------------------
const now = new Date(2026, 7, 25); // 2026-08-25

check('one reading is not a change', weightChangeOver([{ date: '2026-08-01', kg: 67 }], 30, now), null);
check('an empty log is not a change', weightChangeOver([], 30, now), null);

const month = [
  { date: '2026-07-20', kg: 68.0 },  // before the 30-day window
  { date: '2026-08-01', kg: 67.5 },
  { date: '2026-08-20', kg: 66.6 },
];
check('the 30-day change is measured from the reading BEFORE the window',
  weightChangeOver(month, 30, now),
  { startKg: 67.5, startDate: '2026-08-01', endKg: 66.6, endDate: '2026-08-20', changeKg: -0.9 });

// A window with only ONE reading inside it still measures against the prior one.
check('a single reading in the window is measured against the prior reading',
  weightChangeOver(month, 10, now),
  { startKg: 67.5, startDate: '2026-08-01', endKg: 66.6, endDate: '2026-08-20', changeKg: -0.9 });

check('a window with no readings at all reports nothing',
  weightChangeOver([{ date: '2026-01-01', kg: 70 }, { date: '2026-01-02', kg: 69 }], 30, now), null);

check('gaining weight reports a positive change',
  weightChangeOver([{ date: '2026-08-01', kg: 66 }, { date: '2026-08-20', kg: 67.2 }], 30, now).changeKg, 1.2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
