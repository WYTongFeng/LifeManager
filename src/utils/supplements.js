// 补充剂 — what you actually swallow, and what is in it.
//
// DELIBERATELY NOT A MEDICAL MODULE. It does not diagnose, does not recommend
// doses, and does not repeat a product's marketing back at you. It answers two
// questions a bottle can't: "did I take this today", and "how much of X am I
// getting across everything at once".
//
// THE MODEL IS PER-UNIT, TOTALS ARE DERIVED
// Every label in the drawer states its numbers differently. The Cal-Mag-Zn
// bottle prints "serving size: 3 caplets" and then lists PER CAPLET; the fish
// oil lists per softgel; the protein prints per 33 g serving. Storing the
// totals would mean re-typing every number the moment the dose changes, and a
// stored total silently disagrees with its own label the first time it does.
//
// So `perUnit` is always "what ONE of this unit contains", straight off the
// label, and everything shown is `perUnit × unitsPerDose`. Three caplets is
// then 999.99 mg of calcium because that is what three of them contain — not
// because someone typed 1000.
//
// WHAT IS NOT INVENTED
// A nutrient that cannot be read confidently off the label is simply absent.
// The multivitamin has a mineral column that was never transcribed, so it has
// no minerals here. An absent nutrient is honest; a guessed one is a number
// that looks exactly as authoritative as a real one.
//
// Pure — `scripts/test-supplements.mjs` runs the whole thing in Node.

import { num } from './num.js';
import { todayStr, toHHMM } from './datetime.js';

// --------------------------------------------------------------------------
// Nutrients
// --------------------------------------------------------------------------

/**
 * The canonical nutrient vocabulary.
 *
 * A KEY, never a label, is what a supplement stores — same reasoning as note
 * categories (notes.js): the display text is translatable and renameable, and
 * overlap detection compares keys. Two products that spell the same nutrient
 * differently on their labels ("Folate" vs "Folic Acid") must land on ONE key
 * or the overlap they create is the exact thing this module fails to see.
 *
 * `unit` is fixed per nutrient. Mixing mg and mcg under one key would make the
 * summed total meaningless, so a label printing mcg for something stored in mg
 * has to be converted on the way in — never stored in its own unit.
 */
export const NUTRIENTS = {
  // Fats / omega
  fishOil:      { label: '鱼油',        en: 'Fish Body Oil',  unit: 'mg', group: 'omega' },
  epa:          { label: 'EPA',         en: 'EPA',            unit: 'mg', group: 'omega' },
  dha:          { label: 'DHA',         en: 'DHA',            unit: 'mg', group: 'omega' },
  // Minerals
  calcium:      { label: '钙',          en: 'Calcium',        unit: 'mg', group: 'mineral' },
  magnesium:    { label: '镁',          en: 'Magnesium',      unit: 'mg', group: 'mineral' },
  zinc:         { label: '锌',          en: 'Zinc',           unit: 'mg', group: 'mineral' },
  copper:       { label: '铜',          en: 'Copper',         unit: 'mg', group: 'mineral' },
  sodium:       { label: '钠',          en: 'Sodium',         unit: 'mg', group: 'mineral' },
  // Vitamins
  vitaminA:     { label: '维生素 A',    en: 'Vitamin A',      unit: 'IU',  group: 'vitamin' },
  vitaminC:     { label: '维生素 C',    en: 'Vitamin C',      unit: 'mg',  group: 'vitamin' },
  vitaminD:     { label: '维生素 D',    en: 'Vitamin D',      unit: 'IU',  group: 'vitamin' },
  vitaminE:     { label: '维生素 E',    en: 'Vitamin E',      unit: 'IU',  group: 'vitamin' },
  b1:           { label: '维生素 B1',   en: 'Thiamine',       unit: 'mg',  group: 'vitamin' },
  b2:           { label: '维生素 B2',   en: 'Riboflavin',     unit: 'mg',  group: 'vitamin' },
  niacinamide:  { label: '烟酰胺',      en: 'Niacinamide',    unit: 'mg',  group: 'vitamin' },
  b6:           { label: '维生素 B6',   en: 'Vitamin B6',     unit: 'mg',  group: 'vitamin' },
  // "Folate" and "Folic Acid" are printed on two different bottles in this
  // drawer. One key, or the overlap between them is invisible.
  folate:       { label: '叶酸',        en: 'Folate / Folic Acid', unit: 'mcg', group: 'vitamin' },
  b12:          { label: '维生素 B12',  en: 'Vitamin B12',    unit: 'mcg', group: 'vitamin' },
  biotin:       { label: '生物素',      en: 'Biotin',         unit: 'mcg', group: 'vitamin' },
  // Amino acids and performance
  arginine:     { label: 'L-精氨酸',    en: 'L-Arginine',     unit: 'mg', group: 'amino' },
  citrulline:   { label: 'L-瓜氨酸',    en: 'L-Citrulline',   unit: 'mg', group: 'amino' },
  taurine:      { label: '牛磺酸',      en: 'Taurine',        unit: 'mg', group: 'amino' },
  creatine:     { label: '肌酸',        en: 'Creatine Monohydrate', unit: 'g', group: 'amino' },
  // Macros — the ones a protein powder actually declares. Shared vocabulary
  // with the diet module's meal shape, so a serving can be logged as food.
  energy:       { label: '热量',        en: 'Energy',         unit: 'kcal', group: 'macro' },
  protein:      { label: '蛋白质',      en: 'Protein',        unit: 'g', group: 'macro' },
  carbs:        { label: '碳水',        en: 'Carbohydrate',   unit: 'g', group: 'macro' },
  sugars:       { label: '糖',          en: 'Sugars',         unit: 'g', group: 'macro' },
  fibre:        { label: '膳食纤维',    en: 'Dietary Fibre',  unit: 'g', group: 'macro' },
  fat:          { label: '脂肪',        en: 'Fat',            unit: 'g', group: 'macro' },
  // Herbal actives — only ever what a label states as an amount.
  turmeric:     { label: '姜黄',        en: 'Turmeric',       unit: 'mg', group: 'herbal' },
  curcumin:     { label: '姜黄素',      en: 'Curcumin',       unit: 'mg', group: 'herbal' },
};

export const NUTRIENT_KEYS = Object.keys(NUTRIENTS);

export function nutrientMeta(key) {
  return NUTRIENTS[key] ?? { label: String(key), en: String(key), unit: '', group: 'other' };
}

/**
 * Which nutrient keys map onto a meal record's fields.
 *
 * The bridge to the diet module, and the reason `protein`/`carbs`/`fat` are
 * spelled exactly as `DietModule` spells them: a protein shake logged as a meal
 * must land in the same four numbers every other meal uses, not in a parallel
 * set of supplement macros the calorie screen knows nothing about. See
 * `asMealRecord()` below.
 */
export const MEAL_MACRO_KEYS = { energy: 'calories', protein: 'protein', carbs: 'carbs', fat: 'fat' };

// --------------------------------------------------------------------------
// Categories and units
// --------------------------------------------------------------------------

export const CATEGORIES = [
  { id: 'omega',       emoji: '🐟', label: '鱼油 / 脂肪酸',     color: 'var(--color-diet)' },
  { id: 'mineral',     emoji: '🦴', label: '矿物质',            color: 'var(--color-notes)' },
  { id: 'vitamin',     emoji: '💊', label: '维生素',            color: 'var(--color-remind)' },
  { id: 'amino',       emoji: '🧬', label: '氨基酸',            color: 'var(--color-special)' },
  { id: 'protein',     emoji: '🥤', label: '蛋白质 / 运动营养', color: 'var(--color-sports)' },
  { id: 'performance', emoji: '⚡', label: '运动表现',          color: 'var(--color-sports)' },
  { id: 'herbal',      emoji: '🌿', label: '草本',              color: 'var(--color-money)' },
  { id: 'other',       emoji: '📦', label: '其他',              color: 'var(--text-muted)' },
];

export const FALLBACK_CATEGORY = 'other';

export function categoryMeta(id) {
  return CATEGORIES.find(c => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}

/**
 * How one dose is counted.
 *
 * `unit` is the noun the UI puts after a number ("2 粒"), and it is per-product
 * because "2 scoops" and "2 tablets" are not interchangeable words even though
 * both are just a count. `step` allows the half-scoop doses that powders
 * actually use; a tablet can't be taken in halves here, which is a deliberate
 * limit rather than an oversight — splitting tablets is a dosing decision.
 */
export const FORMS = [
  { id: 'softgel', unit: '粒',   label: '软胶囊', step: 1 },
  { id: 'caplet',  unit: '粒',   label: '片剂',   step: 1 },
  { id: 'tablet',  unit: '粒',   label: '锭剂',   step: 1 },
  { id: 'capsule', unit: '粒',   label: '胶囊',   step: 1 },
  { id: 'scoop',   unit: '勺',   label: '勺',     step: 0.5 },
  { id: 'spoon',   unit: '茶匙', label: '茶匙',   step: 0.5 },
  { id: 'serving', unit: '份',   label: '份',     step: 0.5 },
  { id: 'gram',    unit: 'g',    label: '克',     step: 1 },
];

export function formMeta(id) {
  return FORMS.find(f => f.id === id) ?? FORMS[FORMS.length - 1];
}

export const FREQUENCIES = [
  { value: 'daily',    label: '每天',       short: '每天' },
  { value: 'weekdays', label: '星期一到五', short: '平日' },
  { value: 'asneeded', label: '需要时',     short: '需要时' },
];

export function frequencyMeta(value) {
  return FREQUENCIES.find(f => f.value === value) ?? FREQUENCIES[0];
}

/** Evening is wrong for most of these; morning is the honest default. */
export const DEFAULT_TIME = '09:00';

/**
 * Doses left before 快没了 fires. DOSES, not units — 7 units of a 3-caplet dose
 * is two days, and "7 left" reading as a week would be the wrong alarm.
 */
export const DEFAULT_LOW_STOCK_DOSES = 7;

// --------------------------------------------------------------------------
// Normalization
// --------------------------------------------------------------------------

/** Only known keys, only finite positive amounts. An unknown key can't be
 *  summed or compared, and a NaN amount poisons every total it touches. */
export function normalizeNutrients(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!NUTRIENTS[key]) continue;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    out[key] = amount;
  }
  return out;
}

/**
 * Fill in every field a supplement might be missing, on READ.
 *
 * MUST list every field explicitly — this builds a new object rather than
 * spreading `...s`, so anything not named here is DELETED on every read. Same
 * trap `normalizeAccount`, `normalizeAllocation` and `normalizeNote` all
 * document, and it bites silently: the field survives one session in React
 * state and is gone the next time storage is read.
 */
export function normalizeSupplement(s) {
  if (!s || typeof s !== 'object') return null;
  const form = FORMS.some(f => f.id === s.form) ? s.form : 'serving';
  const frequency = FREQUENCIES.some(f => f.value === s.frequency) ? s.frequency : 'daily';
  return {
    id: s.id,
    name: typeof s.name === 'string' ? s.name : '',
    brand: typeof s.brand === 'string' ? s.brand : '',
    category: CATEGORIES.some(c => c.id === s.category) ? s.category : FALLBACK_CATEGORY,
    form,
    // What ONE unit contains, straight off the label. Never a computed total.
    perUnit: normalizeNutrients(s.perUnit),
    // What the label itself calls a serving, kept so the UI can say
    // 「标签：3 粒」 next to a dose the user has changed to something else.
    labelServing: s.labelServing != null ? num(s.labelServing) : 1,
    // What the user actually takes.
    unitsPerDose: s.unitsPerDose != null ? num(s.unitsPerDose) : 1,
    // Free text off the label, e.g. "1.5 勺 / 33 g" — printed as-is, never parsed.
    servingNote: typeof s.servingNote === 'string' ? s.servingNote : '',
    frequency,
    // Every clock time a dose is due. More than one is normal, and the
    // notification layer groups by these ACROSS products — which is what turns
    // four 09:00 supplements into one notification instead of four.
    times: Array.isArray(s.times)
      ? [...new Set(s.times.map(t => toHHMM(t)).filter(Boolean))].sort()
      : [DEFAULT_TIME],
    notes: typeof s.notes === 'string' ? s.notes : '',
    // Stock, in UNITS. null means "not tracking", which is not the same as 0.
    totalQuantity: s.totalQuantity != null ? num(s.totalQuantity) : null,
    remainingQuantity: s.remainingQuantity != null ? num(s.remainingQuantity) : null,
    lowStockDoses: s.lowStockDoses != null ? num(s.lowStockDoses) : DEFAULT_LOW_STOCK_DOSES,
    startDate: s.startDate ?? null,
    endDate: s.endDate ?? null,
    // OFF by default, and stays off unless switched on per product — the brief
    // was explicit that adding a supplement must not start a notification.
    remindEnabled: Boolean(s.remindEnabled),
    // Stopped rather than deleted, so pausing something doesn't lose what you
    // typed about it. Same reasoning as a reminder's `enabled`.
    active: s.active !== false,
    at: num(s.at),
    updatedAt: num(s.updatedAt),
  };
}

export function normalizeSupplements(list) {
  return (Array.isArray(list) ? list : []).map(normalizeSupplement).filter(Boolean);
}

// --------------------------------------------------------------------------
// Dose maths
// --------------------------------------------------------------------------

/**
 * What one dose actually delivers: `perUnit × unitsPerDose`.
 *
 * THE WHOLE POINT OF THE MODULE, in four lines. The label says 333.33 mg of
 * calcium per caplet and 3 caplets per serving; this is what makes the screen
 * able to say 1000 mg without anyone having stored 1000 anywhere. Change the
 * dose to 2 and it says 666.66 — which no stored total could have done.
 */
export function doseNutrients(raw) {
  const s = normalizeSupplement(raw);
  if (!s) return {};
  const units = num(s.unitsPerDose);
  const out = {};
  for (const [key, perUnit] of Object.entries(s.perUnit)) {
    out[key] = perUnit * units;
  }
  return out;
}

/**
 * Round a nutrient amount the way a label would print it.
 *
 * Three caplets of 333.33 mg is 999.99 mg, and printing that is technically
 * exact and practically absurd. Larger amounts lose the decimals; small ones
 * (copper at 0.99 mg) keep two, because rounding 0.99 to 1 would throw away
 * the only significant digits it has.
 */
export function formatAmount(value) {
  const n = num(value);
  if (n === 0) return '0';
  if (n >= 100) return String(Math.round(n));
  if (n >= 10) return String(Math.round(n * 10) / 10);
  return String(Math.round(n * 100) / 100);
}

/** "钙 1000 mg" — one nutrient line. */
export function describeNutrient(key, amount) {
  const meta = nutrientMeta(key);
  return `${meta.label} ${formatAmount(amount)} ${meta.unit}`.trim();
}

/** "3 粒" / "1.5 份" — a dose in words. A trailing .0 is trimmed. */
export function describeDose(raw) {
  const s = normalizeSupplement(raw);
  if (!s) return '';
  const units = num(s.unitsPerDose);
  const shown = Number.isInteger(units) ? String(units) : String(Number(units.toFixed(2)));
  return `${shown} ${formMeta(s.form).unit}`;
}

/** "每天 · 09:00" — the grey line under the name. */
export function describeSchedule(raw) {
  const s = normalizeSupplement(raw);
  if (!s) return '';
  if (s.frequency === 'asneeded') return '需要时';
  const when = s.times.length ? s.times.join(' / ') : '没设时间';
  return `${frequencyMeta(s.frequency).short} · ${when}`;
}

// --------------------------------------------------------------------------
// Is it due, and was it taken
// --------------------------------------------------------------------------

/** Does this supplement expect a dose on this date at all? */
export function isScheduledOn(raw, date = todayStr()) {
  const s = normalizeSupplement(raw);
  if (!s || !s.active) return false;
  if (s.startDate && date < s.startDate) return false;
  if (s.endDate && date > s.endDate) return false;
  if (s.frequency === 'asneeded') return false;
  if (s.frequency === 'weekdays') {
    const [y, m, d] = String(date).split('-').map(Number);
    if (!y) return false;
    const dow = new Date(y, m - 1, d).getDay();
    if (dow === 0 || dow === 6) return false;
  }
  return true;
}

/**
 * A taken-record: appended, never edited — the same shape every other log in
 * this app uses (SCHEMA.md). `units` is stored ON the record rather than read
 * back off the supplement, because changing tomorrow's dose must not silently
 * rewrite what you swallowed last week.
 */
export function normalizeLogEntry(e) {
  if (!e || typeof e !== 'object') return null;
  return {
    id: e.id,
    supplementId: e.supplementId,
    date: e.date ?? null,
    // Which of the day's scheduled times this satisfies. null for an
    // as-needed dose, which answers to no particular time.
    time: toHHMM(e.time),
    units: num(e.units),
    at: num(e.at),
    updatedAt: num(e.updatedAt),
  };
}

export function normalizeLog(list) {
  return (Array.isArray(list) ? list : []).map(normalizeLogEntry).filter(Boolean);
}

/** Every entry on one date, grouped by supplement id. */
export function takenOn(log, date) {
  const map = new Map();
  for (const e of normalizeLog(log)) {
    if (e.date !== date) continue;
    const key = String(e.supplementId);
    const list = map.get(key) ?? [];
    list.push(e);
    map.set(key, list);
  }
  return map;
}

/**
 * Today's status per supplement, which is the whole first screen.
 *
 * THREE STATES, NOT TWO. An as-needed protein shake is not "not taken yet";
 * there was nothing to take. Showing it as an unticked box would put a
 * permanent unfinished item on a screen whose job is to be scannable.
 */
export function statusFor(raw, log, date = todayStr()) {
  const s = normalizeSupplement(raw);
  if (!s || !s.active) return 'na';
  const entries = takenOn(log, date).get(String(s.id)) ?? [];
  if (!isScheduledOn(s, date)) return entries.length > 0 ? 'taken' : 'na';
  // A multi-time supplement is done only when every time has an entry.
  const needed = Math.max(1, s.times.length);
  return entries.length >= needed ? 'taken' : 'pending';
}

/** The day's scheduled times that still have no entry against them. */
export function pendingTimes(raw, log, date = todayStr()) {
  const s = normalizeSupplement(raw);
  if (!s || !isScheduledOn(s, date)) return [];
  const entries = takenOn(log, date).get(String(s.id)) ?? [];
  const done = new Set(entries.map(e => e.time).filter(Boolean));
  const untimed = entries.filter(e => !e.time).length;
  const remaining = s.times.filter(t => !done.has(t));
  // An entry logged with no time satisfies the earliest outstanding slot —
  // tapping ✓ on the card must not leave a phantom "still due at 09:00".
  return remaining.slice(untimed);
}

// --------------------------------------------------------------------------
// Stock
// --------------------------------------------------------------------------

/** How many whole doses are left, or null when stock isn't tracked. */
export function dosesRemaining(raw) {
  const s = normalizeSupplement(raw);
  if (!s || s.remainingQuantity == null) return null;
  const perDose = num(s.unitsPerDose);
  if (perDose <= 0) return null;
  return Math.floor(num(s.remainingQuantity) / perDose);
}

/** Running out, and tracked, and actually being taken. */
export function isLowStock(raw) {
  const s = normalizeSupplement(raw);
  if (!s || !s.active) return false;
  const left = dosesRemaining(s);
  return left != null && left <= num(s.lowStockDoses);
}

/** "剩 20 粒 · 约 6 天" — doses left, said as days where that's meaningful. */
export function describeStock(raw) {
  const s = normalizeSupplement(raw);
  if (!s || s.remainingQuantity == null) return '';
  const left = dosesRemaining(s);
  const unit = formMeta(s.form).unit;
  const dosesPerDay = s.frequency === 'asneeded' ? 0 : Math.max(1, s.times.length);
  const days = dosesPerDay > 0 && left != null ? Math.floor(left / dosesPerDay) : null;
  return `剩 ${formatAmount(s.remainingQuantity)} ${unit}${days != null ? ` · 约 ${days} 天` : ''}`;
}

/** Stock after one dose. Never below zero — a negative bottle is not a state. */
export function afterDose(raw) {
  const s = normalizeSupplement(raw);
  if (!s || s.remainingQuantity == null) return null;
  return Math.max(0, num(s.remainingQuantity) - num(s.unitsPerDose));
}

// --------------------------------------------------------------------------
// Totals and overlap
// --------------------------------------------------------------------------

/**
 * What one day's scheduled doses add up to, per nutrient.
 *
 * `sources` is carried alongside the total because the total on its own is a
 * number with no way to check it — and checking it is the only thing this is
 * for. It lists which products contributed, and how much each one did.
 */
export function dailyTotals(supplements, { includeAsNeeded = false, date = todayStr() } = {}) {
  const totals = new Map();
  for (const s of normalizeSupplements(supplements)) {
    const counts = s.frequency === 'asneeded' ? includeAsNeeded : isScheduledOn(s, date);
    if (!counts) continue;
    const perDose = doseNutrients(s);
    // Two scheduled times a day means two doses a day.
    const dosesPerDay = s.frequency === 'asneeded' ? 1 : Math.max(1, s.times.length);
    for (const [key, amount] of Object.entries(perDose)) {
      const entry = totals.get(key) ?? { key, total: 0, sources: [] };
      const contribution = amount * dosesPerDay;
      entry.total += contribution;
      entry.sources.push({ id: s.id, name: s.name, amount: contribution });
      totals.set(key, entry);
    }
  }
  return [...totals.values()].sort(
    (a, b) => b.sources.length - a.sources.length || a.key.localeCompare(b.key)
  );
}

/**
 * Nutrients arriving from more than one product.
 *
 * STATES A FACT, RECOMMENDS NOTHING. There is no upper limit here, no RDA, no
 * "too much" — those are clinical judgements this app is in no position to
 * make, and a red warning beside a number the app cannot interpret would be
 * scarier and less useful than the number itself. It says which products
 * overlap and what they come to; what to do about that is not its call.
 */
export function findOverlaps(supplements, opts = {}) {
  return dailyTotals(supplements, opts)
    .filter(entry => entry.sources.length > 1)
    .map(entry => ({
      key: entry.key,
      label: nutrientMeta(entry.key).label,
      unit: nutrientMeta(entry.key).unit,
      total: entry.total,
      sources: entry.sources,
      text: `${entry.sources.map(s => s.name).join(' + ')} 都含有${nutrientMeta(entry.key).label}`,
    }));
}

// --------------------------------------------------------------------------
// The diet bridge
// --------------------------------------------------------------------------

/** Does this product have anything worth putting in the food log? */
export function hasMealValue(raw) {
  return num(doseNutrients(raw).energy) > 0;
}

/**
 * One dose as a meal record, for the diet log.
 *
 * Returns null for anything with no calories on its label — a multivitamin is
 * not food, and a 0 kcal "meal" in the day's list is noise. The field names are
 * the meal shape's own (SCHEMA.md), so this lands in the same four totals every
 * other meal does rather than in a parallel set of numbers the calorie screen
 * knows nothing about.
 *
 * NO `items[]`: the schema's invariant is that a breakdown must sum to its own
 * totals, and a supplement's nutrient list is not a list of food components.
 */
export function asMealRecord(raw, { date = todayStr(), time = null, id, at } = {}) {
  const s = normalizeSupplement(raw);
  if (!s) return null;
  const dose = doseNutrients(s);
  const calories = Math.round(num(dose.energy));
  if (calories <= 0) return null;
  return {
    id,
    name: `${s.name}${s.servingNote ? `（${s.servingNote}）` : ''}`,
    calories,
    protein: Math.round(num(dose.protein)),
    carbs: Math.round(num(dose.carbs)),
    fat: Math.round(num(dose.fat)),
    category: '补充剂',
    // Straight off a printed label — better evidence than an AI estimate, and
    // worth distinguishing from one. See `source` in SCHEMA.md.
    source: 'supplement',
    supplementId: s.id,
    date,
    time,
    at: at ?? Date.now(),
  };
}
