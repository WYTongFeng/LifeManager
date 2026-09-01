// The bottles actually in the drawer, transcribed from their labels.
//
// SEPARATE FILE ON PURPOSE. `supplements.js` is the model and the maths, and it
// is tested against invented fixtures; this is DATA, and every number in it is
// a claim about a physical label. Keeping them apart means a correction to a
// bottle never touches logic, and reading this file is a proofreading job
// rather than a code review.
//
// THE TRANSCRIPTION RULES, which matter more than the numbers:
//
//   1. PER UNIT, NEVER PER SERVING. The Cal-Mag-Zn-Cu label prints "serving
//      size: 3 caplets" and then lists per caplet — so 333.33 goes in here, not
//      1000. The 1000 the user sees is `333.33 × 3`, computed at render. That
//      is the difference between a dose control that works and one that lies
//      the moment you change it.
//
//   2. NOTHING IS FILLED IN. The multivitamin label has a second column of
//      minerals that was not legible in what was supplied, so this file has no
//      minerals for it. A guessed value is indistinguishable from a read one
//      once it is stored, and would then be summed into an overlap warning as
//      if someone had checked it.
//
//   3. THE PRODUCT'S OWN CLAIMS ARE NOT REPEATED. "Niteworks" is described as
//      what its label lists — amino acids and vitamins — and not as a sleep
//      product, because the label's ingredients are a fact and the name is
//      marketing. Same reason nothing here says what a supplement is "for".
//
// Seeded ONCE, on first open, and never re-applied — see `seedSupplements()`.
// After that these are ordinary editable records; correcting a bottle in the UI
// must not be undone by the next app start.

import { newId } from './num.js';

/**
 * @returns {object[]} raw supplements, ready for `normalizeSupplement`
 */
export function buildSeedSupplements(startDate) {
  const at = Date.now();
  const base = { at, updatedAt: at, startDate, remindEnabled: false, active: true };

  return [
    {
      ...base,
      id: newId(),
      name: '鱼油',
      brand: '',
      category: 'omega',
      form: 'softgel',
      labelServing: 1,
      unitsPerDose: 1,
      // EPA and DHA are listed SEPARATELY and are not summed into an
      // "Omega-3" figure. 758 mg of fish body oil is the oil, of which 185 is
      // EPA and 128 DHA; calling the whole 758 "omega-3" would overstate it by
      // more than double, and it is the number people quote at each other.
      perUnit: { fishOil: 758, epa: 185, dha: 128 },
      servingNote: '每粒 758 mg 鱼油',
      frequency: 'daily',
      times: ['09:00'],
      notes: 'EPA 与 DHA 分开算，758 mg 是鱼油总量，不是 Omega-3 含量。',
    },
    {
      ...base,
      id: newId(),
      name: '钙镁锌铜',
      brand: '',
      category: 'mineral',
      form: 'caplet',
      // The label's own serving, kept so the form can show 「标签：3 粒」.
      labelServing: 3,
      unitsPerDose: 3,
      // PER CAPLET, exactly as printed. Three of them make 999.99 / 349.98 /
      // 15 / 0.99 — computed, never stored.
      perUnit: { calcium: 333.33, magnesium: 116.66, zinc: 5, copper: 0.33 },
      servingNote: '标签一份 = 3 粒',
      frequency: 'daily',
      times: ['21:00'],
      notes: '标签上的数字是「每一粒」，不是一份。',
    },
    {
      ...base,
      id: newId(),
      name: '综合维他命',
      brand: '',
      category: 'vitamin',
      form: 'tablet',
      labelServing: 1,
      unitsPerDose: 1,
      // Only what was legible. The mineral column on the right of the label
      // is deliberately absent — see rule 2 at the top of this file.
      perUnit: {
        vitaminA: 1000, vitaminC: 50, vitaminD: 80, vitaminE: 10,
        b1: 6.7, b2: 6, niacinamide: 33.3, b6: 10,
        folate: 133, b12: 2, biotin: 100,
      },
      servingNote: '每锭',
      frequency: 'daily',
      times: ['09:00'],
      notes: '标签右边还有一栏矿物质没抄进来 —— 看得清楚再自己加，不要用猜的。',
    },
    {
      ...base,
      id: newId(),
      name: 'Niteworks 粉',
      brand: 'Herbalife',
      category: 'amino',
      form: 'scoop',
      labelServing: 1,
      unitsPerDose: 1,
      // 5 g scoop. Arginine is printed in grams and stored in mg, because the
      // key's unit is mg and a key with two units cannot be summed.
      perUnit: {
        arginine: 2500, vitaminC: 50, taurine: 146,
        citrulline: 100, vitaminE: 14.3, folate: 100,
      },
      servingNote: '1 勺 / 5 g',
      frequency: 'daily',
      times: ['21:00'],
      // States the label, claims nothing. The name is not evidence.
      notes: '含氨基酸（精氨酸、瓜氨酸、牛磺酸）与维生素 C、E、叶酸的补充剂。产品名字里的 Nite 不代表助眠效果。',
    },
    {
      ...base,
      id: newId(),
      name: '乳清蛋白粉',
      brand: '',
      category: 'protein',
      form: 'serving',
      labelServing: 1,
      unitsPerDose: 1,
      // Printed per 33 g serving, so the unit IS the serving.
      perUnit: {
        energy: 125, fat: 2.0, sodium: 40,
        carbs: 4.0, sugars: 1.1, fibre: 1.3, protein: 24.0,
      },
      servingNote: '1.5 勺 / 33 g',
      // Not on a schedule — it is food, taken when it is taken. That is what
      // keeps it off the "not taken yet" list every evening.
      frequency: 'asneeded',
      times: [],
      notes: '浓缩乳清蛋白 95%。可以直接记进饮食里，热量和蛋白质会算进当天总数。',
    },
    {
      ...base,
      id: newId(),
      name: '肌酸',
      brand: '',
      category: 'performance',
      form: 'spoon',
      labelServing: 1,
      unitsPerDose: 1,
      // THE POINT OF THIS ENTRY: one 5 g teaspoon contains 2.5 g of creatine,
      // not 5 g. Storing "5" because the tub says creatine is the mistake the
      // module exists to avoid.
      perUnit: { creatine: 2.5, taurine: 500 },
      servingNote: '1 茶匙 / 5 g 粉',
      frequency: 'daily',
      times: ['09:00'],
      notes: '一份 5 g 粉里面只有 2.5 g 肌酸 —— 粉的重量不等于肌酸的重量。',
    },
  ];
}

/**
 * Offered in the UI, NOT seeded.
 *
 * The brief was explicit that turmeric is something the user might add, not
 * something the app should decide he is taking. It ships as a blank template
 * with the shape filled in and the amounts left at zero, so adding it is a
 * matter of copying two numbers off a bottle rather than building a record.
 */
export const OPTIONAL_TEMPLATES = [
  {
    key: 'turmeric',
    label: '姜黄 / 姜黄素',
    hint: '自己填标签上的含量',
    build: () => ({
      id: newId(),
      name: '姜黄素',
      brand: '',
      category: 'herbal',
      form: 'capsule',
      labelServing: 1,
      unitsPerDose: 1,
      // Zero, not a plausible-looking guess. An empty field asks to be filled;
      // a wrong number does not.
      perUnit: { turmeric: 0, curcumin: 0 },
      servingNote: '',
      frequency: 'daily',
      times: ['09:00'],
      notes: '',
      remindEnabled: false,
      active: true,
      at: Date.now(),
      updatedAt: Date.now(),
    }),
  },
];

/**
 * Put the drawer in on first open, once.
 *
 * Guarded by a flag rather than by "is the list empty", because deleting every
 * supplement is a decision, and an empty-list check would undo it on the next
 * app start — the same shape of bug as `purgeDemoHistory` in App.jsx, which
 * uses a flag for exactly this reason.
 *
 * @returns {object[]|null} the seeds to store, or null when nothing to do
 */
export function seedSupplements({ stored, alreadySeeded, today }) {
  if (alreadySeeded) return null;
  if (Array.isArray(stored) && stored.length > 0) return null;
  return buildSeedSupplements(today);
}
