// Spending and income categories.
//
// WHY THIS REPLACES THE ONE SHARED LIST
// There used to be a single 11-item English list in tngParser.js, used for
// expenses, income and the monthly pie alike. Two problems with that:
//
//   1. Income shared the expense list, so money arriving had to be filed under
//      "Food & Dining" or "Other". Salary, a friend paying you back, and a
//      refund are not shopping categories, and there was nowhere to say so.
//   2. Eleven categories is too coarse. Rent, subscriptions, coffee, petrol and
//      家用 all collapsed into "Bills & Utilities" or "Other", which is the same
//      as not categorising at all.
//
// IDS ARE NOT LABELS — the same rule notes.js follows, for the same reason.
// Every expense stores a category ID. The label is display text the user can
// rename, so if records stored the label, renaming a category would orphan
// every record filed under it.
//
// OLD RECORDS ARE NEVER REWRITTEN
// Records written before this change literally store "Food & Dining" on disk,
// and they still do — nothing migrates, nothing is touched. `LEGACY_ALIASES`
// maps those old strings onto the new ids at READ time only. That does two
// jobs at once: the old record displays as 餐饮 like everything else, AND it
// lands in the same pie slice as new 餐饮 records instead of sitting in a
// second slice with an identical-looking name.

/**
 * Built-in expense categories.
 *
 * Ids are ASCII slugs so they are stable and safe as object keys; the label is
 * what the user sees and may rename. Ordered roughly by how often this user
 * actually spends, because this list is rendered as a dropdown and the top of
 * it is the cheapest place to reach.
 */
export const BUILTIN_EXPENSE_CATEGORIES = [
  { id: 'food', emoji: '🍜', label: '餐饮' },
  { id: 'groceries', emoji: '🛒', label: '买菜' },
  { id: 'delivery', emoji: '🛵', label: '外卖' },
  { id: 'drinks', emoji: '🧋', label: '咖啡奶茶' },
  { id: 'transport', emoji: '🚇', label: '交通' },
  { id: 'fuel', emoji: '⛽', label: '油费' },
  { id: 'shopping', emoji: '🛍️', label: '购物' },
  { id: 'home', emoji: '🏠', label: '家居' },
  { id: 'rent', emoji: '🔑', label: '房租' },
  { id: 'utilities', emoji: '💡', label: '水电' },
  { id: 'telco', emoji: '📱', label: '通讯' },
  { id: 'subscription', emoji: '🔁', label: '订阅' },
  { id: 'health', emoji: '💊', label: '医疗' },
  { id: 'personal-care', emoji: '✂️', label: '个人护理' },
  { id: 'education', emoji: '📚', label: '教育' },
  { id: 'entertainment', emoji: '🎬', label: '娱乐' },
  { id: 'fitness', emoji: '🏋️', label: '运动健身' },
  { id: 'travel', emoji: '✈️', label: '旅行' },
  { id: 'gifts', emoji: '🎁', label: '礼物人情' },
  { id: 'family', emoji: '👨‍👩‍👦', label: '孝亲家用' },
  { id: 'insurance', emoji: '🛡️', label: '保险' },
  { id: 'pets', emoji: '🐾', label: '宠物' },
  { id: 'fees', emoji: '🧾', label: '手续费' },
  { id: 'transfer-person', emoji: '🤝', label: '转给别人' },
  { id: 'other', emoji: '📦', label: '其他' },
];

/**
 * Built-in income categories.
 *
 * Money arriving genuinely does not share a vocabulary with money leaving —
 * "工资" and "餐饮" are not two members of one list — which is why this is a
 * separate array rather than a few extra entries tacked onto the one above.
 */
export const BUILTIN_INCOME_CATEGORIES = [
  { id: 'salary', emoji: '💼', label: '工资' },
  { id: 'side-income', emoji: '💻', label: '兼职外快' },
  { id: 'friend-repay', emoji: '🤝', label: '朋友还钱' },
  { id: 'refund', emoji: '↩️', label: '退款' },
  { id: 'reimbursement', emoji: '🧾', label: '报销' },
  { id: 'red-packet', emoji: '🧧', label: '红包礼金' },
  { id: 'investment', emoji: '📈', label: '投资收益' },
  { id: 'interest', emoji: '🏦', label: '利息' },
  { id: 'sold-item', emoji: '🏷️', label: '卖东西' },
  { id: 'other-income', emoji: '📦', label: '其他' },
];

/**
 * The category `makeTransfer` stamps on both halves of an account transfer.
 *
 * Not offered in any picker — a transfer's category is written by the code
 * that creates the pair, never chosen — but it still needs a label, because
 * anything that renders a record's category will eventually be handed one.
 */
const SYSTEM_CATEGORIES = [
  { id: 'account-transfer', emoji: '🔄', label: '户口转账', system: true },
];

/**
 * Category strings written by versions of the app before this file existed.
 *
 * Resolved on read, never written back. Keeping the old string on disk is the
 * point: nothing about the user's existing records changes, and if this whole
 * change were reverted tomorrow every old record would still read correctly.
 */
export const LEGACY_ALIASES = {
  'Food & Dining': 'food',
  Groceries: 'groceries',
  Transportation: 'transport',
  Shopping: 'shopping',
  'Bills & Utilities': 'utilities',
  Entertainment: 'entertainment',
  Health: 'health',
  'Personal Care': 'personal-care',
  Education: 'education',
  'Transfer to person': 'transfer-person',
  Other: 'other',
  Transfer: 'account-transfer',
};

/** Storage key for the user's own additions, renames and hidden built-ins. */
export const CATEGORY_PREFS_KEY = 'moneyCategoryPrefs';

export const FALLBACK_EXPENSE_CATEGORY = 'other';
export const FALLBACK_INCOME_CATEGORY = 'other-income';

/**
 * Which list a transaction type picks from.
 *
 * `refund` is money arriving (someone paying you back), so it reads from the
 * income list. `repayment` and `bill` are money leaving and read from the
 * expense list. `transfer` is neither and never asks.
 */
export function categoryKindFor(txType) {
  return txType === 'income' || txType === 'refund' ? 'income' : 'expense';
}

/**
 * Map any stored category value onto a current id.
 *
 * Handles the three things that can be on a record: a current id, a legacy
 * English string, or nothing at all.
 */
export function resolveCategoryId(raw, kind = 'expense') {
  if (raw == null || raw === '') {
    return kind === 'income' ? FALLBACK_INCOME_CATEGORY : FALLBACK_EXPENSE_CATEGORY;
  }
  const key = String(raw);
  return LEGACY_ALIASES[key] ?? key;
}

/**
 * The list a picker should offer: built-ins the user hasn't hidden, plus their
 * own, with any renames applied.
 *
 * @param {object} prefs  { custom: [], hidden: [], renamed: {} }
 * @param {'expense'|'income'} kind
 */
export function resolveMoneyCategories(prefs, kind = 'expense') {
  const builtins = kind === 'income' ? BUILTIN_INCOME_CATEGORIES : BUILTIN_EXPENSE_CATEGORIES;
  const hidden = new Set(Array.isArray(prefs?.hidden) ? prefs.hidden : []);
  const renamed = (prefs?.renamed && typeof prefs.renamed === 'object') ? prefs.renamed : {};

  const visible = builtins
    .filter(c => !hidden.has(c.id))
    .map(c => (renamed[c.id] ? { ...c, label: renamed[c.id] } : c));

  // Custom ones come last and cannot shadow a built-in id — two categories
  // sharing an id would make the pie group them together while the picker
  // showed two separate rows.
  const taken = new Set(builtins.map(c => c.id));
  const custom = (Array.isArray(prefs?.custom) ? prefs.custom : [])
    .filter(c => c && typeof c === 'object' && c.id && c.kind === kind && !taken.has(String(c.id)))
    .filter(c => !hidden.has(String(c.id)))
    .map(c => ({
      id: String(c.id),
      emoji: c.emoji || '📦',
      label: renamed[c.id] || c.label || String(c.id),
      kind,
      custom: true,
    }));

  return [...visible, ...custom];
}

/**
 * Look up one category for display.
 *
 * A record filed under a category the user later hid or deleted still has to
 * render. Falling back to the raw id with a neutral icon is honest; showing
 * "undefined" or dropping the row is not — same rule as notes.js.
 */
export function moneyCategoryMeta(rawId, kind = 'expense', prefs = null) {
  const id = resolveCategoryId(rawId, kind);
  const all = [
    ...resolveMoneyCategories(prefs, 'expense'),
    ...resolveMoneyCategories(prefs, 'income'),
    ...SYSTEM_CATEGORIES,
  ];
  const found = all.find(c => c.id === id);
  if (found) return found;

  // Hidden built-ins are still real categories — a record filed under one
  // before it was hidden must keep its proper name, not fall through to the
  // raw slug.
  const builtin = [...BUILTIN_EXPENSE_CATEGORIES, ...BUILTIN_INCOME_CATEGORIES]
    .find(c => c.id === id);
  if (builtin) return { ...builtin, hidden: true };

  return { id, emoji: '📦', label: id, missing: true };
}

/** Just the display text — by far the most common thing call sites want. */
export function categoryLabel(rawId, kind = 'expense', prefs = null) {
  return moneyCategoryMeta(rawId, kind, prefs).label;
}

/** Turn a typed name into a slug id that won't collide with anything existing. */
export function newCategoryId(label, existing = []) {
  const base = String(label ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Chinese names slugify to nothing. They still need a stable id, so fall
  // back to a timestamp rather than refusing the name — the label is what the
  // user reads, the id is bookkeeping they never see.
  const stem = base || `cat-${Date.now()}`;
  const taken = new Set([
    ...BUILTIN_EXPENSE_CATEGORIES.map(c => c.id),
    ...BUILTIN_INCOME_CATEGORIES.map(c => c.id),
    ...SYSTEM_CATEGORIES.map(c => c.id),
    ...existing.map(c => c.id),
  ]);
  if (!taken.has(stem)) return stem;
  let i = 2;
  while (taken.has(`${stem}-${i}`)) i++;
  return `${stem}-${i}`;
}

/** Empty prefs, so callers never have to null-check the shape. */
export function emptyCategoryPrefs() {
  return { custom: [], hidden: [], renamed: {} };
}
