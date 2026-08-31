import {
  BUILTIN_EXPENSE_CATEGORIES, BUILTIN_INCOME_CATEGORIES, LEGACY_ALIASES,
  resolveCategoryId, resolveMoneyCategories, moneyCategoryMeta, categoryLabel,
  categoryKindFor, newCategoryId, emptyCategoryPrefs,
} from '../src/utils/moneyCategories.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// --- the lists themselves ----------------------------------------------------
check('expense and income are separate lists',
  BUILTIN_EXPENSE_CATEGORIES === BUILTIN_INCOME_CATEGORIES, false);
check('every expense category id is unique',
  new Set(BUILTIN_EXPENSE_CATEGORIES.map(c => c.id)).size, BUILTIN_EXPENSE_CATEGORIES.length);
check('every income category id is unique',
  new Set(BUILTIN_INCOME_CATEGORIES.map(c => c.id)).size, BUILTIN_INCOME_CATEGORIES.length);
check('every category has a Chinese label',
  [...BUILTIN_EXPENSE_CATEGORIES, ...BUILTIN_INCOME_CATEGORIES].every(c => /[一-鿿]/.test(c.label)), true);
// Ids are what get written to records forever, so a stray non-ASCII id would be
// a permanent wart. The LABEL is the Chinese half; the id stays a slug.
check('every id is a plain ASCII slug',
  [...BUILTIN_EXPENSE_CATEGORIES, ...BUILTIN_INCOME_CATEGORIES].every(c => /^[a-z0-9-]+$/.test(c.id)), true);

// --- which list a transaction type reads from --------------------------------
check('an expense picks from the expense list', categoryKindFor('expense'), 'expense');
check('income picks from the income list', categoryKindFor('income'), 'income');
check('a refund is money arriving, so it picks from the income list',
  categoryKindFor('refund'), 'income');
check('a bill is money leaving', categoryKindFor('bill'), 'expense');
check('a debt repayment is money leaving', categoryKindFor('repayment'), 'expense');

// --- old records are read, never rewritten -----------------------------------
// The whole backward-compatibility contract in one block: records written
// before this file existed literally store "Food & Dining" on disk.
check('a legacy English category resolves to the new id',
  resolveCategoryId('Food & Dining'), 'food');
check('...and displays in Chinese', categoryLabel('Food & Dining'), '餐饮');
check('a current id passes through untouched', resolveCategoryId('groceries'), 'groceries');
check('every legacy alias points at a real category',
  Object.values(LEGACY_ALIASES).every(id =>
    [...BUILTIN_EXPENSE_CATEGORIES, ...BUILTIN_INCOME_CATEGORIES].some(c => c.id === id)
    || id === 'account-transfer'), true);

// THE POINT of aliasing rather than migrating: an old record and a new one must
// land in the SAME pie slice. Two slices both labelled 餐饮 would be worse than
// leaving it in English.
check('old and new records group under one id',
  resolveCategoryId('Food & Dining') === resolveCategoryId('food'), true);

// A missing category must not crash, and must not read as "undefined".
check('no category at all falls back to 其他', resolveCategoryId(null), 'other');
check('no category on an income record falls back to the income 其他',
  resolveCategoryId(undefined, 'income'), 'other-income');
check('an unknown id still renders as itself rather than undefined',
  moneyCategoryMeta('some-deleted-thing').label, 'some-deleted-thing');
check('an unknown id is flagged missing so the UI can mark it',
  moneyCategoryMeta('some-deleted-thing').missing, true);

// The category makeTransfer stamps on both halves of an account transfer.
check('the system transfer category has a label', categoryLabel('Transfer'), '户口转账');

// --- the user's own categories -----------------------------------------------
const prefs = {
  custom: [
    { id: 'boba-fund', label: '波霸基金', emoji: '🧋', kind: 'expense' },
    { id: 'angpow-in', label: '过年红包', emoji: '🧧', kind: 'income' },
  ],
  hidden: ['pets', 'insurance'],
  renamed: { food: '吃饭' },
};

const expenseList = resolveMoneyCategories(prefs, 'expense');
check('a hidden built-in drops out of the picker',
  expenseList.some(c => c.id === 'pets'), false);
check('a custom expense category appears', expenseList.some(c => c.id === 'boba-fund'), true);
check('a renamed built-in shows the new name',
  expenseList.find(c => c.id === 'food').label, '吃饭');
check('custom categories come last',
  expenseList[expenseList.length - 1].id, 'boba-fund');

const incomeList = resolveMoneyCategories(prefs, 'income');
check('an income custom category only shows in the income list',
  incomeList.some(c => c.id === 'angpow-in'), true);
check('...and not in the expense list', expenseList.some(c => c.id === 'angpow-in'), false);

// Hiding a category must not orphan the records already filed under it — the
// name has to survive, or a year of 宠物 spending silently becomes "pets".
check('a hidden category keeps its proper label for existing records',
  categoryLabel('pets', 'expense', prefs), '宠物');
check('...and is flagged hidden rather than missing',
  moneyCategoryMeta('pets', 'expense', prefs).hidden, true);

// A custom category may not shadow a built-in: one id, two picker rows, and a
// pie that groups them together would disagree with the list the user sees.
const shadowing = { custom: [{ id: 'food', label: 'HIJACKED', kind: 'expense' }], hidden: [], renamed: {} };
check('a custom category cannot shadow a built-in id',
  resolveMoneyCategories(shadowing, 'expense').filter(c => c.id === 'food').length, 1);
check('...and the built-in wins',
  resolveMoneyCategories(shadowing, 'expense').find(c => c.id === 'food').label, '餐饮');

// Degenerate prefs must not throw — this is user-editable, synced data.
check('null prefs give the plain built-in list',
  resolveMoneyCategories(null, 'expense').length, BUILTIN_EXPENSE_CATEGORIES.length);
check('garbage in custom is ignored, not crashed on',
  resolveMoneyCategories({ custom: [null, 'nope', {}, { id: '' }] }, 'expense').length,
  BUILTIN_EXPENSE_CATEGORIES.length);
check('emptyCategoryPrefs is a usable empty shape',
  resolveMoneyCategories(emptyCategoryPrefs(), 'income').length, BUILTIN_INCOME_CATEGORIES.length);

// --- new ids -----------------------------------------------------------------
check('a typed English name slugifies', newCategoryId('Boba Fund'), 'boba-fund');
check('a new id never collides with a built-in', newCategoryId('Food') === 'food', false);
check('a collision with an existing custom id gets a suffix',
  newCategoryId('Boba Fund', [{ id: 'boba-fund' }]), 'boba-fund-2');
// Chinese slugifies to nothing — it still needs a stable id rather than a refusal.
const zhId = newCategoryId('波霸基金');
check('a Chinese name still produces a usable ascii id', /^cat-\d+$/.test(zhId), true);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
