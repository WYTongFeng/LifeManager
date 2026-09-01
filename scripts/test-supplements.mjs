// The supplement model, and the seed data as a proofreading pass.
//
// The seeds are transcriptions of physical labels, so a handful of the checks
// below are deliberately hard-coded to what the bottles say. If a bottle is
// re-read and corrected, these fail — which is the point: a silent change to
// what the app believes is in a product is exactly the thing worth catching.

import {
  normalizeSupplement, normalizeSupplements, normalizeNutrients,
  doseNutrients, describeDose, describeSchedule, describeStock, describeNutrient,
  statusFor, pendingTimes, isScheduledOn,
  dosesRemaining, isLowStock, afterDose,
  dailyTotals, findOverlaps, formatAmount,
  asMealRecord, hasMealValue, nutrientMeta,
} from '../src/utils/supplements.js';
import { buildSeedSupplements, seedSupplements, OPTIONAL_TEMPLATES } from '../src/utils/supplementSeeds.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

const TODAY = '2026-09-02';        // a Wednesday
const SATURDAY = '2026-09-05';
const seeds = buildSeedSupplements('2026-09-01');
const byName = (n) => seeds.find(s => s.name === n);

// --- normalization ----------------------------------------------------------
check('a non-object is dropped', normalizeSupplement(null), null);
check('an unknown nutrient key is discarded',
  normalizeNutrients({ vitaminC: 50, unobtanium: 999 }), { vitaminC: 50 });
check('a NaN amount is discarded, not stored as NaN',
  normalizeNutrients({ vitaminC: 'abc' }), {});
// A zero amount is not "0 mg of this", it is "this was never filled in".
check('a zero amount is discarded', normalizeNutrients({ zinc: 0 }), {});
check('duplicate times collapse and sort',
  normalizeSupplement({ id: 1, times: ['21:00', '09:00', '21:00'] }).times, ['09:00', '21:00']);
check('a garbage time is dropped rather than defaulted into the list',
  normalizeSupplement({ id: 1, times: ['nonsense', '08:00'] }).times, ['08:00']);
// The field-by-field normalizer trap every other module in this app documents.
check('an unlisted field is dropped on read',
  normalizeSupplement({ id: 1, name: 'x', smuggled: true }).smuggled, undefined);
check('reminders are OFF unless explicitly on',
  normalizeSupplement({ id: 1 }).remindEnabled, false);
check('active defaults to true', normalizeSupplement({ id: 1 }).active, true);

// --- the whole point: totals are DERIVED from per-unit amounts --------------
// The label prints "serving size: 3 caplets" and then lists PER CAPLET. Nobody
// has stored 1000 anywhere.
const calmag = byName('钙镁锌铜');
check('3 caplets of the mineral give the label serving', {
  calcium: formatAmount(doseNutrients(calmag).calcium),
  magnesium: formatAmount(doseNutrients(calmag).magnesium),
  zinc: formatAmount(doseNutrients(calmag).zinc),
  copper: formatAmount(doseNutrients(calmag).copper),
}, { calcium: '1000', magnesium: '350', zinc: '15', copper: '0.99' });

// Change the dose and the totals move — which no stored total could do. The
// RAW value stays exact; only the display rounds, and the two are checked apart
// so a change to the rounding rule can never quietly change the arithmetic.
check('2 caplets give two thirds of it, exactly',
  doseNutrients({ ...calmag, unitsPerDose: 2 }).calcium, 666.66);
check('1 caplet gives the printed per-caplet figure',
  doseNutrients({ ...calmag, unitsPerDose: 1 }).calcium, 333.33);
check('...and a figure over 100 is shown without its decimals',
  formatAmount(666.66), '667');

// Copper keeps its decimals: rounding 0.99 to 1 throws away everything it has.
check('a small amount keeps two decimals', formatAmount(0.99), '0.99');
check('a large amount loses them', formatAmount(999.99), '1000');
check('zero stays zero', formatAmount(0), '0');
check('a NaN amount formats as 0 rather than "NaN"', formatAmount(undefined), '0');

// --- the two label traps this module exists for -----------------------------
// 5 g of powder is not 5 g of creatine. Marketing says creatine; the label says
// 2.5 g per 5 g serving.
check('creatine is what the label says, not what the tub is called',
  doseNutrients(byName('肌酸')).creatine, 2.5);
check('...and the other half of the scoop is taurine',
  doseNutrients(byName('肌酸')).taurine, 500);

// 758 mg of fish body oil is NOT 758 mg of omega-3.
const fish = doseNutrients(byName('鱼油'));
check('EPA and DHA are separate values', [fish.epa, fish.dha], [185, 128]);
check('...and the oil total is kept apart from them', fish.fishOil, 758);
check('nothing invents an "omega3" total', fish.omega3, undefined);

// --- schedule ----------------------------------------------------------------
check('a daily supplement is due today', isScheduledOn(calmag, TODAY), true);
check('an as-needed one is never "due"', isScheduledOn(byName('乳清蛋白粉'), TODAY), false);
check('a weekdays-only one skips Saturday',
  isScheduledOn({ ...calmag, frequency: 'weekdays' }, SATURDAY), false);
check('...but not Wednesday',
  isScheduledOn({ ...calmag, frequency: 'weekdays' }, TODAY), true);
check('a paused supplement is never due', isScheduledOn({ ...calmag, active: false }, TODAY), false);
check('nothing is due before its start date',
  isScheduledOn({ ...calmag, startDate: '2026-10-01' }, TODAY), false);
check('nothing is due after its end date',
  isScheduledOn({ ...calmag, endDate: '2026-08-01' }, TODAY), false);

check('the schedule reads as words', describeSchedule(calmag), '每天 · 21:00');
check('an as-needed one says so', describeSchedule(byName('乳清蛋白粉')), '需要时');
check('a dose reads as words', describeDose(calmag), '3 粒');
check('a half dose keeps its decimal',
  describeDose({ ...byName('乳清蛋白粉'), unitsPerDose: 1.5 }), '1.5 份');

// --- taken / not taken -------------------------------------------------------
const twice = { ...calmag, id: 'twice', times: ['09:00', '21:00'] };
const log = (entries) => entries.map((e, i) => ({ id: i, date: TODAY, ...e }));

check('nothing logged means pending', statusFor(calmag, [], TODAY), 'pending');
check('one entry finishes a once-a-day supplement',
  statusFor(calmag, log([{ supplementId: calmag.id, time: '21:00', units: 3 }]), TODAY), 'taken');
// THREE states, not two: an as-needed product was never outstanding.
check('an as-needed supplement is n/a, not "not taken"',
  statusFor(byName('乳清蛋白粉'), [], TODAY), 'na');
check('...but logging one still shows as taken',
  statusFor(byName('乳清蛋白粉'), log([{ supplementId: byName('乳清蛋白粉').id, units: 1 }]), TODAY), 'taken');
check('a twice-a-day supplement is not done after one dose',
  statusFor(twice, log([{ supplementId: 'twice', time: '09:00', units: 3 }]), TODAY), 'pending');
check('...and is after two',
  statusFor(twice, log([
    { supplementId: 'twice', time: '09:00', units: 3 },
    { supplementId: 'twice', time: '21:00', units: 3 },
  ]), TODAY), 'taken');
check('yesterday\'s entry does not count for today',
  statusFor(calmag, [{ id: 1, supplementId: calmag.id, date: '2026-09-01', units: 3 }], TODAY), 'pending');

check('the outstanding times are the ones with no entry',
  pendingTimes(twice, log([{ supplementId: 'twice', time: '09:00', units: 3 }]), TODAY), ['21:00']);
// Tapping ✓ on the card logs no particular time; it must still satisfy a slot,
// or the card would say "taken" while leaving a phantom 09:00 outstanding.
check('an untimed entry satisfies the earliest outstanding slot',
  pendingTimes(twice, log([{ supplementId: 'twice', units: 3 }]), TODAY), ['21:00']);

// --- stock -------------------------------------------------------------------
const stocked = { ...calmag, remainingQuantity: 30, lowStockDoses: 7 };
check('doses left is stock divided by dose size', dosesRemaining(stocked), 10);
check('an untracked bottle has no count', dosesRemaining(calmag), null);
check('10 doses left is not low', isLowStock(stocked), false);
check('7 doses left is', isLowStock({ ...stocked, remainingQuantity: 21 }), true);
check('an untracked bottle is never low', isLowStock(calmag), false);
check('a paused one is never low', isLowStock({ ...stocked, remainingQuantity: 3, active: false }), false);
check('taking a dose subtracts the dose size', afterDose(stocked), 27);
// A negative bottle is not a state.
check('stock never goes below zero', afterDose({ ...stocked, remainingQuantity: 1 }), 0);
check('an untracked bottle has nothing to subtract', afterDose(calmag), null);
check('stock reads as remaining and days', describeStock(stocked), '剩 30 粒 · 约 10 天');

// --- overlap ------------------------------------------------------------------
const overlaps = findOverlaps(seeds, { date: TODAY });
const overlap = (label) => overlaps.find(o => o.label === label);

// The four that genuinely exist in this drawer. "Folate" on one bottle and
// "Folic Acid" on another are ONE key — if they were two, this one would be
// invisible, which is the exact failure the shared vocabulary prevents.
check('every real overlap is found',
  overlaps.map(o => o.label).sort(), ['叶酸', '牛磺酸', '维生素 C', '维生素 E']);
check('folate and folic acid are added together', overlap('叶酸').total, 233);
check('...from both products', overlap('叶酸').sources.map(s => s.name), ['综合维他命', 'Niteworks 粉']);
check('vitamin C sums across two products', overlap('维生素 C').total, 100);
check('taurine sums across niteworks and the creatine tub', overlap('牛磺酸').total, 646);
check('vitamin E too', formatAmount(overlap('维生素 E').total), '24.3');

// Zinc comes from ONE product, so it is not an overlap. The multivitamin's
// mineral column was never transcribed and nothing invented one.
check('a single-source nutrient is not flagged', overlap('锌'), undefined);
// As-needed products are not part of a normal day and must not create a
// phantom overlap the user never actually takes.
check('an as-needed product is left out of daily totals',
  dailyTotals(seeds, { date: TODAY }).some(t => t.key === 'sugars'), false);
check('...unless asked for', dailyTotals(seeds, { date: TODAY, includeAsNeeded: true }).some(t => t.key === 'sugars'), true);
// Twice a day is twice the nutrients.
check('a twice-daily product counts both doses',
  dailyTotals([{ ...calmag, times: ['09:00', '21:00'] }], { date: TODAY })
    .find(t => t.key === 'zinc').total, 30);
check('an overlap states a fact and gives no advice',
  /应该|太多|停止|不要吃/.test(overlap('维生素 C').text), false);

// --- the diet bridge -----------------------------------------------------------
check('only a product with calories is food', seeds.filter(hasMealValue).map(s => s.name), ['乳清蛋白粉']);
check('a multivitamin produces no meal record', asMealRecord(byName('综合维他命'), { id: 1, date: TODAY }), null);
const meal = asMealRecord(byName('乳清蛋白粉'), { id: 7, date: TODAY, at: 123 });
check('the shake becomes a meal in the diet module\'s own shape',
  { id: meal.id, calories: meal.calories, protein: meal.protein, carbs: meal.carbs, fat: meal.fat, date: meal.date, at: meal.at },
  { id: 7, calories: 125, protein: 24, carbs: 4, fat: 2, date: TODAY, at: 123 });
check('...labelled so an estimate and a printed label are distinguishable', meal.source, 'supplement');
check('...and carrying its serving so the log says what was drunk',
  meal.name, '乳清蛋白粉（1.5 勺 / 33 g）');
// SCHEMA.md: if `items` is present its sum must equal the totals. A supplement
// has no food components, so it must not claim a breakdown at all.
check('a supplement meal carries no items[] breakdown', meal.items, undefined);
check('a double serving doubles the calories',
  asMealRecord({ ...byName('乳清蛋白粉'), unitsPerDose: 2 }, { id: 1, date: TODAY }).calories, 250);

// --- seeding --------------------------------------------------------------------
check('six bottles are seeded', seeds.length, 6);
check('nothing is seeded with reminders already on', seeds.some(s => s.remindEnabled), false);
check('every seed has a name and a category',
  seeds.every(s => s.name && s.category), true);
check('every seeded nutrient is a known key',
  seeds.every(s => Object.keys(s.perUnit).every(k => nutrientMeta(k).unit !== '')), true);
// Rule 2 of supplementSeeds.js: nothing is filled in that wasn't legible.
check('the multivitamin has no minerals invented for it',
  ['calcium', 'magnesium', 'zinc', 'copper', 'iron'].some(k => k in byName('综合维他命').perUnit), false);
// Rule 3: the product's own name is not treated as evidence.
check('niteworks is not described as a sleep aid',
  /助眠|睡眠|sleep/i.test(byName('Niteworks 粉').notes.replace('不代表助眠效果', '')), false);

check('a fresh install seeds', seedSupplements({ stored: [], alreadySeeded: false, today: TODAY })?.length, 6);
// Guarded by a flag, not by "is the list empty" — deleting everything is a
// decision, and an empty-list check would undo it on the next app start.
check('an emptied shelf is not re-seeded',
  seedSupplements({ stored: [], alreadySeeded: true, today: TODAY }), null);
check('an existing shelf is never overwritten',
  seedSupplements({ stored: [{ id: 1 }], alreadySeeded: false, today: TODAY }), null);

// Turmeric is offered, never seeded.
check('turmeric is not one of the seeds', seeds.some(s => s.category === 'herbal'), false);
check('...but is available as a template', OPTIONAL_TEMPLATES.map(t => t.key), ['turmeric']);
check('...with its amounts left empty rather than guessed',
  Object.values(OPTIONAL_TEMPLATES[0].build().perUnit).every(v => v === 0), true);
check('...so it stores no nutrients until they are typed in',
  normalizeSupplement(OPTIONAL_TEMPLATES[0].build()).perUnit, {});

check('describeNutrient reads as a label line', describeNutrient('calcium', 1000), '钙 1000 mg');
check('a normalized list drops the junk', normalizeSupplements([null, { id: 1 }, 'x']).length, 1);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
