import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Smartphone, Plus, Trash2, Pencil, X, Check, AlertTriangle,
  Info, ArrowDownLeft, Wallet, HelpCircle, ArrowRightLeft, Copy,
} from '../utils/icons';
import confetti from 'canvas-confetti';
import { usePersistentState, useLiveJSON, saveJSON, useToday } from '../utils/storage';
import { num, sumBy, newId } from '../utils/num';
import { nowTimeStr, toHHMM, shiftDate, describeDate, sortByTime } from '../utils/datetime';
import {
  resolveAccounts, defaultAccount, accountById, spendByAccount, typeMeta, sameId,
  makeTransfer, isTransferRecord, isDailySpend, isRealSpend, txType, txTypeMeta,
} from '../utils/accounts';
import { AccountPicker, AccountChip, AccountSelect } from './AccountPicker';
import AccountsView from './AccountsView';
import CycleView from './CycleView';
import TngAutoCapture from './TngAutoCapture';
import { TNG_LOGGED_EVENT } from '../hooks/useTngCapture';
import ClipboardWatch from './ClipboardWatch';
import TextExportModal from './TextExportModal';
import {
  parseTngNotification, categorise, merchantKey, SAMPLE_NOTIFICATIONS
} from '../utils/tngParser';
import { CategorySelect, CategoryText, useMoneyCategories } from './CategoryPicker';
import CategoryManager from './CategoryManager';
import {
  FALLBACK_EXPENSE_CATEGORY, FALLBACK_INCOME_CATEGORY, resolveCategoryId, categoryKindFor,
} from '../utils/moneyCategories';
import {
  getProjects, getOpenProjects, getClosedProjects, getDebtorStatus, ownSpendById, ownSpend,
} from '../utils/projects';
import { isNativeAvailable } from '../utils/tngNative';
import { getCycle } from '../utils/cycle';

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-input)',
  border: '1px solid var(--border-glass)',
  color: 'white',
  marginTop: '4px',
  fontSize: '0.85rem',
};

const labelStyle = { fontSize: '0.78rem', color: 'var(--text-secondary)' };

// Two or three characters that identify an account at 36px. Latin names give
// up their initials ("Maybank MAE" -> "MM"); a Chinese name has no word
// boundaries to read, so its first two characters are already the short form.
function initials(name = '') {
  if (/[一-鿿]/.test(name)) return name.replace(/\s+/g, '').slice(0, 2);
  // Tokens shorter than two letters are dropped, so "Touch 'n Go eWallet"
  // reads TG rather than T'G — the apostrophe-n is a connector, not a word.
  const words = name.replace(/[^A-Za-z0-9\s]/g, ' ').trim().split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return name.trim().slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

// How each parser verdict is presented. Colour and wording are driven by the
// bucket so a reload or a promo can never look like a logged expense.
const VERDICT = {
  spend: { title: 'Payment detected', color: 'var(--color-money)', tone: 'var(--color-money-soft)' },
  income: { title: 'Money in — not spending', color: 'var(--color-diet)', tone: 'var(--color-diet-soft)' },
  noise: { title: 'Promo — ignored', color: 'var(--text-muted)', tone: 'var(--bg-card-hover)' },
  unknown: { title: 'Not recognised', color: 'var(--color-accent-red)', tone: 'var(--color-accent-red-soft)' },
};

export default function MoneyModule({
  expenses, setExpenses, allExpenses,
  // Writes that are allowed to touch a day other than today. `setExpenses`
  // deliberately cannot — see useTodayRecords in App.jsx — which is correct for
  // auto-capture and useless for "I forgot to log yesterday's lunch".
  onSaveExpense, onDeleteExpenses,
  dailyBudget, setDailyBudget, today,
}) {
  // 'today' is the daily spend tracker; 'accounts' is the balances + debts view.
  // Kept in one tab because they answer different questions about the same
  // money: what did I spend today, versus where do I actually stand.
  // View lives in the URL (/money, /money/cycle, /money/accounts) instead of
  // local state — same shim pattern as SportsModule's activeSection. Every
  // existing call site below still just calls setView(key).
  const { view: viewParam } = useParams();
  const view = viewParam ?? 'today';
  const navigate = useNavigate();
  const setView = (key) => navigate(key === 'today' ? '/money' : `/money/${key}`);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [showReader, setShowReader] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [banner, setBanner] = useState(null);

  // Merchant -> category, learned from your own corrections. Every expense you
  // save teaches this map, and it outranks the parser's built-in keyword rules.
  const [learned, setLearned] = usePersistentState('merchantCategories', {});

  // Owned by AccountsView, read live here — a balance edited two screens away
  // has to be right the moment you open the expense form, or you'd be choosing
  // which pot to spend from against a stale number. Resolved against the FULL
  // expense list (every date), never today's slice: a balance is the running
  // result of everything ever logged, not of today.
  const rawAccounts = useLiveJSON('accounts', []);
  const accounts = useMemo(
    () => resolveAccounts(rawAccounts, allExpenses ?? expenses),
    [rawAccounts, allExpenses, expenses]
  );
  const fallbackAccountId = defaultAccount(accounts)?.id ?? null;
  // Single write path for a multi-writer key — see storage.js. The derived
  // `balance` must never be written back, so callers hand over stripped rows.
  const writeAccounts = (next) => saveJSON('accounts', next);
  // Owned by 本月 (CycleView), read and written here too — so both go through
  // the single-write-path pattern rather than a second usePersistentState that
  // would drift. See storage.js.
  const incomeSources = useLiveJSON('incomeSources', []);
  const allocations = useLiveJSON('allocations', []);
  const liveToday = useToday();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cycle = useMemo(() => getCycle(), [liveToday]);
  // Whether this device can capture notifications by itself. Drives the wording
  // everywhere below — on a phone the paste box is a fallback, in a browser
  // it's the only route, and conflating the two is what made the web build look
  // like the whole product.
  const nativeCapture = isNativeAvailable();

  // Entry form
  const [formMerchant, setFormMerchant] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formCategory, setFormCategory] = useState(FALLBACK_EXPENSE_CATEGORY);
  const [formNote, setFormNote] = useState('');
  // A reimbursement (a friend paying back a meal you fronted) is stored as a
  // NEGATIVE expense rather than as income — every total in this app is a
  // plain sum of `amount`, so a negative entry nets against the original
  // spend automatically, everywhere, without each summation site needing to
  // know refunds exist. Logging it as income instead would double-count the
  // money: once as the original expense, again as "new" income.
  // Three ways money moves, not two. Kept as one enum rather than a pair of
  // booleans so "refund AND arrival" can't be represented at all.
  //   'out'    我出的钱   — an expense
  //   'refund' 别人还我   — money back from spending already logged; nets
  //                        against this cycle, because that spend is in it
  //   'in'     钱进来了   — an arrival from outside (allowance, salary,
  //                        top-up). Credits the account, budget-neutral —
  //                        see cycle.js `isMoneyIn` for why it must not net.
  const [formDirection, setFormDirection] = useState('out');
  // Everything that renders the "money is coming in" side of the form keys off
  // this, so both incoming kinds share the same field labels for free.
  const formRefund = formDirection !== 'out';
  const formMoneyIn = formDirection === 'in';
  const setFormRefund = (isIn) => setFormDirection(isIn ? 'refund' : 'out');
  // Which vocabulary the category picker should offer. Money arriving reads
  // from the income list (工资, 朋友还钱), money leaving from the expense one —
  // stated once here rather than at the picker, so the two can't drift.
  const formTxType = formMoneyIn ? 'income' : formRefund ? 'refund' : 'expense';
  // Only meaningful on the "我出的钱" side — marks this expense as one others
  // owe money back on, so later repayments can be filed under it.
  const [formIsProject, setFormIsProject] = useState(false);
  // Optional per-person shares for a project — [{ name, share }]. Entirely
  // additive: a project with none of these still works, just without a
  // "who hasn't paid" breakdown (see getDebtorStatus).
  const [formDebtors, setFormDebtors] = useState([]);
  // Only meaningful on the "别人还我" side — which project this repayment
  // pays down, or '' for a standalone refund with no project.
  const [formRepaysProjectId, setFormRepaysProjectId] = useState('');
  // WHICH POT. Every expense carries this now; it used to be a hardcoded
  // `paymentMethod: "Touch 'n Go eWallet"` display string that nothing read,
  // which is why the log could never say where the money actually came from.
  const [formAccountId, setFormAccountId] = useState(null);
  // WHEN. Both of these are new, and the reason is the same for each: an
  // expense you enter the next morning was not spent this morning.
  //
  //   formDate  YYYY-MM-DD — which day this belongs to. Every total, every
  //             cycle, the whole day browser and the archive read this field,
  //             so getting it wrong files real money on the wrong day.
  //   formTime  HH:MM — the clock time. It was already being stored, but as a
  //             locale display string generated at save time ("11:45 PM"), so
  //             it could never be corrected and could never be sorted. Kept as
  //             a plain 24h string now, which sorts and edits.
  const [formDate, setFormDate] = useState(today);
  const [formTime, setFormTime] = useState('');
  // WHICH INCOME SOURCE this arrival belongs to. 「今天记收入」 and 「本月收入」
  // used to be two systems that never met: you could log RM1,000 arriving and
  // the month's income would not move by a sen, because the budget was built
  // from a list of amounts typed into 本月 once. This link is what joins them —
  // see computeCycleBudget in cycle.js. '' means unfiled, which is reported as
  // 未归类进账 rather than silently added (it may BE the salary already listed).
  const [formIncomeSourceId, setFormIncomeSourceId] = useState('');
  // Naming a brand-new source inline, so filing an arrival never means leaving
  // the form, going to 本月, creating a source, and coming back.
  const [formNewSource, setFormNewSource] = useState('');
  // WHICH FIXED BILL this payment is. Without it a logged rent payment was
  // charged twice: once as the allocation's reservation, once as spending.
  const [formAllocationId, setFormAllocationId] = useState('');

  // Moving money between your own accounts. Deliberately a separate action from
  // "add expense": it isn't spending, and the one thing it must never do is
  // land in the budget or a category breakdown. See makeTransfer in accounts.js.
  const [showTextExport, setShowTextExport] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [tFrom, setTFrom] = useState(null);
  const [tTo, setTTo] = useState(null);
  const [tAmount, setTAmount] = useState('');
  const [tNote, setTNote] = useState('');

  // A repayment can land on a later day than the original expense, so this
  // has to scan every date, not just today — otherwise a friend paying you
  // back next week would silently fail to count against the project.
  const projects = useMemo(() => getProjects(allExpenses ?? expenses), [allExpenses, expenses]);
  const openProjects = useMemo(() => getOpenProjects(allExpenses ?? expenses), [allExpenses, expenses]);
  const closedProjects = useMemo(() => getClosedProjects(allExpenses ?? expenses), [allExpenses, expenses]);
  const projectsById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);
  // What each expense actually cost THIS user — a closed project counts only
  // the share nobody paid back. Built once here rather than per row.
  const ownSpendMap = useMemo(() => ownSpendById(allExpenses ?? expenses), [allExpenses, expenses]);

  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [confirmCloseProject, setConfirmCloseProject] = useState(null);

  /**
   * The expense behind a project row, AS STORED.
   *
   * `getProjects()` hands back the expense spread with derived fields on top
   * (repaidAmount, outstanding, myShare, isSettled…). Those are recomputed from
   * the whole ledger on every read, so writing one back would persist — and
   * sync — a snapshot that goes stale the next time a repayment lands. Every
   * write below starts from the stored record, never from the row the UI holds.
   */
  const storedExpense = (id) => (allExpenses ?? expenses).find(e => e.id === id);

  /**
   * End a project: nothing more is coming back, and whatever is left was mine.
   *
   * Stamps `closedAt` on the original expense — it does NOT create, delete or
   * adjust any record. The money already moved correctly; this only settles
   * the question of how much of it was ever the user's to count.
   *
   * WHY THIS GOES THROUGH onSaveExpense AND NOT setExpenses
   * `setExpenses` is the today-only view (useTodayRecords in App.jsx): it hands
   * a module the records dated today and splices the result back, so a `.map`
   * over it can only ever see today. A project is fronted on one day and closed
   * days later, once the repayments have stopped coming — so the id was never
   * in the list being mapped, the map returned it unchanged, and the button did
   * nothing at all, silently. Only a project created and closed on the SAME day
   * ever worked, which is why this looked fine when it was built.
   */
  const closeProject = (project) => {
    const stored = storedExpense(project.id);
    if (stored) onSaveExpense({ ...stored, closedAt: Date.now() });
    setConfirmCloseProject(null);
  };

  const reopenProject = (project) => {
    const stored = storedExpense(project.id);
    if (!stored) return;
    // Dropped rather than set to null: `isClosed` tests `closedAt != null`, and
    // a reopened project must look exactly like one that was never closed.
    // eslint-disable-next-line no-unused-vars
    const { closedAt: _closedAt, ...reopened } = stored;
    onSaveExpense(reopened);
  };

  // Notification reader
  const [pasteText, setPasteText] = useState('');
  const parsed = parseTngNotification(pasteText, learned);

  // The parsed result is editable before logging, so a misread shop name or a
  // wrong category gets corrected before it ever reaches the expense log.
  const [readerMerchant, setReaderMerchant] = useState('');
  const [readerAmount, setReaderAmount] = useState('');
  const [readerCategory, setReaderCategory] = useState(FALLBACK_EXPENSE_CATEGORY);
  const [readerNote, setReaderNote] = useState('');
  const [readerAccountId, setReaderAccountId] = useState(null);

  useEffect(() => {
    if (parsed.kind !== 'spend') return;
    setReaderMerchant(parsed.merchant || '');
    setReaderAmount(parsed.amount != null ? String(parsed.amount) : '');
    setReaderCategory(parsed.category || FALLBACK_EXPENSE_CATEGORY);
    setReaderNote('');
    setReaderAccountId(prev => prev ?? fallbackAccountId);
    // Keyed on the parser's output, so typing that doesn't change the verdict
    // won't wipe an edit you just made to these fields.
  }, [parsed.kind, parsed.merchant, parsed.amount, parsed.category, fallbackAccountId]);

  // Flipping 出/入 swaps which category list the picker offers, and an expense
  // id means nothing in the income list — leaving 餐饮 selected on an arrival
  // would file a salary under it. Reset to that list's 其他 instead, but only
  // when the current pick genuinely doesn't belong, so reopening an existing
  // record to edit its note never quietly recategorises it.
  const formCategoryKind = categoryKindFor(formTxType);
  const { categories: formCategoryOptions } = useMoneyCategories(formCategoryKind);
  useEffect(() => {
    const fallback = formCategoryKind === 'income' ? FALLBACK_INCOME_CATEGORY : FALLBACK_EXPENSE_CATEGORY;
    setFormCategory(prev => {
      const id = resolveCategoryId(prev, formCategoryKind);
      return formCategoryOptions.some(c => c.id === id) ? id : fallback;
    });
  }, [formCategoryKind, formCategoryOptions]);

  // A transfer to a person, or a shop no rule recognises, tells you the amount
  // but not what it bought — so the note is required before it can be logged.
  const purposeMissing = parsed.needsPurpose && !readerNote.trim();

  // Budget field keeps its own draft string so clearing it to retype doesn't
  // snap back to a default mid-keystroke (it used to jump to 100).
  const [budgetDraft, setBudgetDraft] = useState(String(dailyBudget));
  useEffect(() => { setBudgetDraft(String(dailyBudget)); }, [dailyBudget]);

  const commitBudget = () => {
    const value = Number(budgetDraft);
    if (Number.isFinite(value) && value > 0) setDailyBudget(value);
    else setBudgetDraft(String(dailyBudget));
  };

  // Signed sum — a refund's negative amount nets against the spend it
  // reimburses, so this is the true out-of-pocket total for the day.
  // Signed sum of real movement only. A transfer pair already nets to zero, so
  // excluding it changes nothing arithmetically — it's excluded so that a
  // half-logged pair (one record deleted by hand) can't quietly skew the day.
  // `isSpendingRecord` also drops arrivals (钱进来了), which are stored negative
  // so they credit an account — counting one here made the day's spend negative
  // and the remaining budget balloon by the whole amount. See accounts.js.
  const totalTodaySpend = sumBy(expenses.filter(isDailySpend), e => e.amount);
  const remainingBudget = num(dailyBudget) - totalTodaySpend;
  const isOverBudget = totalTodaySpend > num(dailyBudget);

  // --- which day am I looking at -------------------------------------------
  //
  // The screen was always "today" and only today. Every record has carried its
  // own date since the schema-v2 migration, and the archive keeps them
  // forever — but there was nowhere in Money to look at yesterday, which is
  // the first thing you want when checking whether something got logged.
  //
  // Today comes from `expenses` (the live today-slice, so auto-capture appears
  // immediately) and any other day from the full list. Same shape either way,
  // so everything below reads `dayExpenses` and doesn't care which.
  const [viewDate, setViewDate] = useState(today);
  const isToday = viewDate === today;
  const dayExpenses = useMemo(
    () => (isToday ? expenses : (allExpenses ?? []).filter(e => (e.date ?? today) === viewDate)),
    [isToday, expenses, allExpenses, viewDate, today]
  );
  // Earliest first: a day reads as the order it happened in. The stored `time`
  // used to be a locale string that sorted as text ("9:05 AM" after "10:30
  // PM"), so a day's list came out in array order — see datetime.js.
  const daySorted = useMemo(() => sortByTime(dayExpenses), [dayExpenses]);

  const dayTotalSpend = sumBy(dayExpenses.filter(isDailySpend), e => e.amount);
  const dayOverBudget = dayTotalSpend > num(dailyBudget);
  // Which days have anything at all, newest first — the day picker only offers
  // days there is something to see.
  const loggedDates = useMemo(() => {
    const set = new Set((allExpenses ?? []).map(e => e.date ?? today));
    set.add(today);
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [allExpenses, today]);

  // "Expenses" means money going out. A repayment is money coming in — mixing
  // it into a list titled "Expenses Log" reads as a contradiction even though
  // the underlying math (a negative amount netting against the original
  // spend) is correct. So the two are kept in the same array for the sums —
  // splitting the array would mean re-deriving totals in two places — but
  // rendered as two separate lists: spending here, money received below.
  // Transfers are pulled out of both lists: a +RM100 leaving Maybank is not a
  // purchase and the matching -RM100 arriving in TNG is not income. They get
  // their own section below so the movement is still visible.
  const transferEntries = daySorted.filter(isTransferRecord);
  const realExpenses = daySorted.filter(item => !isTransferRecord(item));
  // 「今天买了什么」 — purchases only. A rent payment or a debt repayment is
  // real money out but is not shopping, and letting either into the category
  // breakdown is what made a month with rent in it read as a spending spree.
  // Stated through the one classifier — see accounts.js.
  const positiveExpenses = realExpenses.filter(item => isRealSpend(item) && item.amount > 0);
  // Everything else that left an account today, kept visible but apart.
  const committedEntries = realExpenses.filter(item => !isRealSpend(item) && item.amount > 0);
  const repaymentEntries = realExpenses.filter(item => item.amount < 0);
  const totalPositiveSpend = sumBy(positiveExpenses, e => e.amount);
  // Which pots the day's money actually came out of. The single most-asked
  // question this module could not previously answer at all.
  const accountBreakdown = useMemo(
    () => spendByAccount(dayExpenses, accounts),
    [dayExpenses, accounts]
  );
  const categoryBreakdown = Object.values(
    positiveExpenses.reduce((acc, item) => {
      // A record with no category used to key this map on `undefined`, which
      // then rendered a slice literally labelled "undefined".
      const key = resolveCategoryId(item.category, 'expense');
      if (!acc[key]) acc[key] = { category: key, total: 0 };
      // `ownSpend`, not `item.amount`: a closed project counts only the share
      // nobody paid back, so a RM100 group dinner three friends settled shows
      // as the RM25 that was actually this user's.
      acc[key].total += num(ownSpend(item, ownSpendMap));
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total);

  const flash = (title, message) => {
    setBanner({ title, message });
    setTimeout(() => setBanner(null), 4000);
  };

  // Capture itself now runs at the app root (see hooks/useTngCapture.js), so it
  // can no longer call in here directly — this screen is usually not mounted
  // when a payment lands. It announces itself instead, and if this screen
  // happens to be open the confirmation still shows.
  useEffect(() => {
    const onAutoLogged = (e) => {
      const { amount, merchant, accountName } = e.detail ?? {};
      flash('自动记录', `RM ${Number(amount).toFixed(2)} — ${merchant || '未知'}${accountName ? ` · ${accountName}` : ''}`);
    };
    window.addEventListener(TNG_LOGGED_EVENT, onAutoLogged);
    return () => window.removeEventListener(TNG_LOGGED_EVENT, onAutoLogged);
  }, []);

  // Remember this merchant's category so the next notification from them is
  // filed correctly without being asked.
  const teach = (merchant, category) => {
    const key = merchantKey(merchant);
    if (!key || !category) return;
    setLearned(prev => (prev[key] === category ? prev : { ...prev, [key]: category }));
  };

  const resetForm = () => {
    setEditingId(null);
    setFormMerchant('');
    setFormAmount('');
    setFormCategory(FALLBACK_EXPENSE_CATEGORY);
    setFormNote('');
    setFormRefund(false);
    setFormIsProject(false);
    setFormDebtors([]);
    setFormRepaysProjectId('');
    setFormAccountId(fallbackAccountId);
    // Defaults to today and now, so the common case is still zero taps. The
    // fields exist for the case that isn't common and used to be impossible.
    setFormDate(today);
    setFormTime(nowTimeStr());
    setFormIncomeSourceId('');
    setFormNewSource('');
    setFormAllocationId('');
  };

  const openAddModal = () => {
    resetForm();
    setShowEntryModal(true);
  };

  // Same form, opened on a day you're browsing rather than on today — so
  // 「补记」 on 8月22日 opens pre-dated to the 22nd instead of making you set
  // the date every time.
  const openAddModalForDate = (dateStr) => {
    resetForm();
    setFormDate(dateStr);
    // No sensible "now" for a past day: an unset time sorts to the end of the
    // day rather than claiming midnight. See sortByTime in datetime.js.
    setFormTime(dateStr === today ? nowTimeStr() : '');
    setShowEntryModal(true);
  };

  const openEditModal = (expense) => {
    setEditingId(expense.id);
    setFormMerchant(expense.merchant);
    // The field always holds a positive magnitude — formRefund carries the
    // sign — so a refund's stored negative amount is shown as its absolute
    // value, matching how it was typed in the first place.
    setFormAmount(String(Math.abs(expense.amount)));
    setFormCategory(resolveCategoryId(expense.category, categoryKindFor(txType(expense))));
    setFormNote(expense.note || '');
    // Both incoming kinds are stored negative, so the sign alone can't tell
    // them apart — an arrival reopened as a refund would silently start
    // netting against the cycle budget on save.
    setFormDirection(expense.isMoneyIn ? 'in' : expense.amount < 0 ? 'refund' : 'out');
    setFormIsProject(Boolean(expense.isProject));
    setFormDebtors(expense.debtors ?? []);
    setFormRepaysProjectId(expense.repaysExpenseId != null ? String(expense.repaysExpenseId) : '');
    // An expense saved before accounts existed has no accountId. It opens
    // pre-selected on the default account rather than blank, so simply
    // re-saving an old row is enough to file it correctly.
    setFormAccountId(expense.accountId ?? fallbackAccountId);
    // A record written before this field existed has a locale display string
    // ("11:45 PM"); toHHMM reads it so an old row opens with its real time
    // rather than blank. See datetime.js.
    setFormDate(expense.date ?? today);
    setFormTime(toHHMM(expense.time) ?? '');
    setFormIncomeSourceId(expense.incomeSourceId != null ? String(expense.incomeSourceId) : '');
    setFormNewSource('');
    setFormAllocationId(expense.allocationId != null ? String(expense.allocationId) : '');
    setShowEntryModal(true);
  };

  const addDebtorRow = () => setFormDebtors([...formDebtors, { name: '', share: '' }]);
  const updateDebtorRow = (i, field, value) =>
    setFormDebtors(formDebtors.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)));
  const removeDebtorRow = (i) => setFormDebtors(formDebtors.filter((_, idx) => idx !== i));

  // Suggest a category as you type the merchant, but only while adding — an
  // edit means you're deliberately setting it, so it must not be overridden.
  const handleMerchantChange = (value) => {
    setFormMerchant(value);
    if (!editingId) setFormCategory(categorise(value, learned));
  };

  const handleSubmitEntry = (e) => {
    e.preventDefault();
    const magnitude = Number(formAmount);
    if (!formMerchant.trim() || !Number.isFinite(magnitude) || magnitude <= 0) return;
    // Stored signed: a refund nets against spend everywhere in the app
    // automatically, because every total here is a plain sum of `amount`.
    const amount = formRefund ? -magnitude : magnitude;
    // isProject only makes sense on the fronting (我出的钱) side; a repayment
    // links back via repaysExpenseId instead, on the refund side only.
    const isProject = !formRefund && formIsProject;
    // An arrival isn't repaying anything, so it never carries a project link.
    const repaysExpenseId = formRefund && !formMoneyIn && formRepaysProjectId
      ? Number(formRepaysProjectId) : null;
    // Blank rows (typed a name, never filled a share, or vice versa) are
    // dropped rather than saved as noise getDebtorStatus would have to guard
    // against later.
    const debtors = isProject
      ? formDebtors.filter(d => d.name.trim() && Number(d.share) > 0)
        .map(d => ({ name: d.name.trim(), share: Number(d.share) }))
      : undefined;

    const accountId = formAccountId ?? fallbackAccountId;
    const date = formDate || today;
    // Blank is allowed and stays blank. An unset time sorts to the end of its
    // day (see sortByTime) rather than being invented as 00:00, which would
    // claim the expense was the first thing that happened that day.
    const time = toHHMM(formTime) ?? '';

    // `at` is the EVENT time — when the money moved — so back-dating has to
    // move it. It's what accounts.js compares against an account's reconcile
    // watermark, so leaving it at "now" for a record filed three days ago
    // would make a reconciled balance silently wrong.
    const [yy, mm, dd] = date.split('-').map(Number);
    const [hh, mi] = (time || '12:00').split(':').map(Number);
    const at = new Date(yy, mm - 1, dd, hh, mi).getTime();

    const existing = editingId ? (allExpenses ?? expenses).find(item => item.id === editingId) : null;

    // Filing an arrival under a source is what makes 本月收入 move — see
    // cycle.js. A brand-new source is created inline rather than sending the
    // user to 本月 and back; its expected amount starts at 0, which is right
    // for the ad-hoc kind (朋友还钱, a gift) — before anything lands it claims
    // nothing, and once this arrival lands the real figure is what counts.
    let incomeSourceId = formMoneyIn && formIncomeSourceId ? formIncomeSourceId : null;
    if (formMoneyIn && formIncomeSourceId === '__new' && formNewSource.trim()) {
      const created = { id: newId(), label: formNewSource.trim(), amount: 0, kind: 'income' };
      saveJSON('incomeSources', [...incomeSources, created]);
      incomeSourceId = created.id;
    } else if (incomeSourceId === '__new') {
      incomeSourceId = null;
    }

    // Marking a payment as a fixed bill also settles that bill for this cycle.
    // The two are the same statement — "this went out, it was the rent" — and
    // leaving the tick to be done separately is how a bill ends up counted as
    // both paid and outstanding.
    const allocationId = !formRefund && formAllocationId ? formAllocationId : null;
    if (allocationId) {
      saveJSON('allocations', allocations.map(a => (String(a.id) === String(allocationId)
        ? { ...a, paidFor: cycle.start } : a)));
    }

    // onSaveExpense, not setExpenses. `setExpenses` can only write today by
    // construction (useTodayRecords in App.jsx), so saving a record dated
    // yesterday through it would either be silently refiled to today or
    // duplicated. This is the whole reason that second write path exists.
    onSaveExpense({
      ...(existing ?? {}),
      id: editingId ?? newId(),
      merchant: formMerchant.trim(),
      amount,
      category: formCategory,
      note: formNote.trim(),
      isProject,
      debtors,
      repaysExpenseId,
      accountId,
      isMoneyIn: formMoneyIn,
      incomeSourceId,
      allocationId,
      // Stamped at birth, same as makeTransfer and makeRepayment do. `txType`
      // would derive the same answer from the flags either way — that fallback
      // is permanent — but a record that says what it is beats one that has to
      // be worked out, and it is what the user asked for by name.
      type: formMoneyIn ? 'income'
        : allocationId ? 'bill'
        : formRefund ? 'refund'
        : 'expense',
      // Kept alongside accountId as a human-readable snapshot of the account's
      // name AT THE TIME. Renaming an account later shouldn't silently rewrite
      // what a two-month-old receipt says, and a backup restored onto a device
      // with different accounts still reads sensibly.
      paymentMethod: accountById(accounts, accountId)?.name
        ?? existing?.paymentMethod ?? '未指定户口',
      source: existing?.source ?? 'Manual entry',
      date,
      time,
      at,
    });

    teach(formMerchant, formCategory);
    resetForm();
    setShowEntryModal(false);
  };

  // onDeleteExpenses, not setExpenses: the day browser can be showing any day,
  // and `setExpenses` only ever rewrites today's partition — deleting a row
  // from last Tuesday through it would have done nothing at all.
  const handleDeleteExpense = (id) => {
    onDeleteExpenses([id]);
  };

  const openTransferModal = () => {
    const usable = accounts.filter(a => !a.archived);
    setTFrom(fallbackAccountId);
    setTTo(usable.find(a => !sameId(a.id, fallbackAccountId))?.id ?? null);
    setTAmount('');
    setTNote('');
    setShowTransferModal(true);
  };

  const handleSubmitTransfer = (e) => {
    e.preventDefault();
    const amount = Number(tAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (!tFrom || !tTo || sameId(tFrom, tTo)) return;
    const pair = makeTransfer({
      fromAccountId: tFrom, toAccountId: tTo, amount, note: tNote.trim(), accounts,
    });
    if (pair.length !== 2) return;
    setExpenses([...pair, ...expenses]);
    setShowTransferModal(false);
    flash('已记录转账', `RM ${amount.toFixed(2)} · ${accountById(accounts, tFrom)?.name} → ${accountById(accounts, tTo)?.name}`);
  };

  // Deleting one half of a pair would leave both balances wrong in opposite
  // directions — the worst possible state for a ledger, because each account
  // looks individually plausible. Both halves always go together.
  const handleDeleteTransfer = (transferId) => {
    onDeleteExpenses(
      (allExpenses ?? []).filter(e => e.transferId === transferId).map(e => e.id)
    );
  };

  // Log what the reader found. Values come from the (editable) result fields,
  // so a wrong merchant or category is corrected before it ever hits the log.
  const handleLogParsed = () => {
    if (parsed.kind !== 'spend' || !parsed.amount || purposeMissing) return;
    const merchant = (readerMerchant || 'Unknown merchant').trim();

    const accountId = readerAccountId ?? fallbackAccountId;
    setExpenses([{
      id: newId(),
      merchant,
      amount: Number(readerAmount) || parsed.amount,
      category: readerCategory,
      note: readerNote.trim(),
      accountId,
      paymentMethod: accountById(accounts, accountId)?.name ?? '未指定户口',
      source: '通知读取',
      // A captured payment is a purchase until told otherwise — marking it as a
      // fixed bill happens by opening it and choosing one, which rewrites this.
      type: 'expense',
      time: nowTimeStr(),
    }, ...expenses]);

    // Transfers deliberately don't teach a category: the same person can be
    // dinner one week and rent the next, so a remembered guess would be wrong
    // as often as right, and would stop the app asking.
    if (!parsed.isTransfer) teach(merchant, readerCategory);
    confetti({ particleCount: 30, spread: 55 });
    flash('Logged from notification', `RM ${(Number(readerAmount) || parsed.amount).toFixed(2)} — ${merchant}`);
    setPasteText('');
    setShowReader(false);
  };

  // Money-in from a TNG notification is never self-evident: it reads the same
  // whether it's your own reload, a friend paying back something you fronted,
  // or a gift. The parser can only tell you money came in — which of those it
  // was still needs a human, same as needsPurpose does for money going out.
  const dismissIncome = () => {
    setPasteText('');
    setShowReader(false);
  };

  // Routed as a refund (別人還我), never as a recurring income source — a
  // one-off deposit isn't proof of a repeating income, and incomeSources in
  // the payday router (M16) is summed into every future cycle unconditionally.
  // Filing it there would keep counting today's one-off gift as income forever.
  const routeIncomeAsRepayment = () => {
    resetForm();
    setFormRefund(true);
    setFormAmount(parsed.amount != null ? String(parsed.amount) : '');
    setPasteText('');
    setShowReader(false);
    setShowEntryModal(true);
  };

  const verdict = VERDICT[parsed.kind];

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Module Title */}
      <div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: '800' }}>Money Management</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {view === 'today' ? (isToday ? "今天花了多少 · Today's spending" : `${describeDate(viewDate, today)}花了多少`)
            : view === 'cycle' ? '这个月还能花多少 · 1 号到月底'
            : '我现在的状况 · Where I stand'}
        </p>
      </div>

      {/* View switcher */}
      <div style={{ display: 'flex', gap: '6px', background: 'var(--bg-card)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-sm)', padding: '4px' }}>
        {[['today', '今天'], ['cycle', '本月'], ['accounts', '户口欠款']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            style={{
              flex: 1,
              background: view === key ? 'var(--color-money-soft)' : 'transparent',
              border: view === key ? '1px solid var(--color-money)' : '1px solid transparent',
              color: view === key ? 'var(--color-money)' : 'var(--text-secondary)',
              padding: '7px 6px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.74rem',
              fontWeight: '700',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'accounts' ? <AccountsView expenses={allExpenses ?? expenses} /> : view === 'cycle' ? (
        <CycleView
          expenses={allExpenses ?? expenses}
          // Approving an impulse request logs it as today's expense — using
          // the "today" setter is deliberate: the purchase happens today, on
          // the day it's actually confirmed, not the day it was first typed
          // into the sandbox up to 48 hours earlier.
          // Approved impulse buys default to the same account everything else
          // does — an expense with no account is a hole in the ledger, and the
          // sandbox is the one path that used to create them silently.
          onApproveExpense={(exp) => setExpenses([{
            id: newId(),
            accountId: fallbackAccountId,
            paymentMethod: accountById(accounts, fallbackAccountId)?.name ?? '未指定户口',
            ...exp,
          }, ...expenses])}
          // A debt repayment arrives fully formed (id, date, account, the
          // repaysDebtId link) so it is added as-is rather than being filled
          // in here. It carries its own date, which useTodayRecords preserves.
          onAddExpense={(record) => setExpenses([record, ...expenses])}
        />
      ) : (
      <>
      {/* WHICH DAY. Arrows step one day at a time, the strip jumps to a day
          that actually has records, and 「回到今天」 only appears when you have
          left today — a control that does nothing 95% of the time is noise.
          Modelled on the same date nav the sports screen already uses, so the
          two halves of the app browse history the same way. */}
      <div className="glass-card" style={{ padding: '0.6rem 0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setViewDate(shiftDate(viewDate, -1))}
            aria-label="前一天"
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-glass)',
              color: 'white', width: '30px', height: '30px', borderRadius: 'var(--radius-sm)',
              cursor: 'pointer', flexShrink: 0, fontSize: '0.9rem',
            }}
          >‹</button>

          <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
            <div style={{ fontSize: '0.85rem', fontWeight: '700' }}>
              {describeDate(viewDate, today)}
            </div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
              {viewDate} · {dayExpenses.length} 笔 · 花了 RM {Math.abs(dayTotalSpend).toFixed(2)}
            </div>
          </div>

          <button
            onClick={() => setViewDate(shiftDate(viewDate, 1))}
            aria-label="后一天"
            disabled={isToday}
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-glass)',
              color: 'white', width: '30px', height: '30px', borderRadius: 'var(--radius-sm)',
              cursor: isToday ? 'default' : 'pointer', opacity: isToday ? 0.3 : 1,
              flexShrink: 0, fontSize: '0.9rem',
            }}
          >›</button>
        </div>

        {/* Days that actually have something in them. Scrolls, newest first,
            capped at two weeks — beyond that the 历史记录 screen is the tool. */}
        {loggedDates.length > 1 && (
          <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', marginTop: '8px', paddingBottom: '2px' }}>
            {loggedDates.slice(0, 14).map(d => (
              <button
                key={d}
                onClick={() => setViewDate(d)}
                style={{
                  flexShrink: 0, padding: '3px 9px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  background: viewDate === d ? 'var(--color-money-soft)' : 'transparent',
                  border: `1px solid ${viewDate === d ? 'var(--color-money)' : 'var(--border-glass)'}`,
                  color: viewDate === d ? 'var(--color-money)' : 'var(--text-secondary)',
                  fontSize: '0.66rem', fontWeight: '600', whiteSpace: 'nowrap',
                }}
              >
                {describeDate(d, today)}
              </button>
            ))}
          </div>
        )}

        {!isToday && (
          <button
            onClick={() => setViewDate(today)}
            style={{
              width: '100%', marginTop: '8px', padding: '6px',
              background: 'transparent', border: '1px solid var(--border-glass)',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
              fontSize: '0.7rem', fontWeight: '700', cursor: 'pointer',
            }}
          >
            回到今天
          </button>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        {/* Only offered once there's somewhere to transfer TO — with one
            account the button would open a form that can't be submitted. */}
        {/* Reachable from 备份 too, but this is where the thought occurs —
            you are looking at the spending, and you want to ask something
            about it. Making him navigate to a backup sheet for that is the
            kind of thing that means it never gets used. */}
        <button
          onClick={() => setShowTextExport(true)}
          className="btn-secondary"
          style={{ padding: '8px 12px', fontSize: '0.78rem' }}
          title="导出成文字，贴给 AI 看"
        >
          <Copy size={14} /> 导出
        </button>
        {accounts.filter(a => !a.archived).length > 1 && (
          <button
            onClick={openTransferModal}
            className="btn-secondary"
            style={{ padding: '8px 12px', fontSize: '0.78rem' }}
          >
            <ArrowRightLeft size={14} /> 户口转账
          </button>
        )}
        <button
          onClick={() => openAddModalForDate(viewDate)}
          style={{
            background: 'var(--color-money)',
            border: 'none',
            color: 'var(--color-money-ink)',
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.8rem',
            fontWeight: '700',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Plus size={15} /> {isToday ? '记一笔' : `补记 ${describeDate(viewDate, today)}`}
        </button>
      </div>

      {/* Confirmation banner */}
      {banner && (
        <div className="tng-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Check size={20} color="var(--color-money)" />
            <div>
              <h4 style={{ fontSize: '0.88rem', fontWeight: '700' }}>{banner.title}</h4>
              <p style={{ fontSize: '0.75rem', opacity: 0.9 }}>{banner.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Financial Overview Card */}
      <div className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {isToday ? '今天花的 vs 每日额度' : `${describeDate(viewDate, today)}花的 vs 每日额度`}
          </span>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Daily Cap:
            <input
              type="number"
              inputMode="decimal"
              value={budgetDraft}
              onChange={(e) => setBudgetDraft(e.target.value)}
              onBlur={commitBudget}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              style={{
                width: '64px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-glass)',
                color: 'white',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 4px',
                textAlign: 'center',
                marginLeft: '4px',
                fontSize: '0.78rem',
              }}
            /> RM
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '2rem', fontWeight: '800', color: dayOverBudget ? 'var(--color-accent-red)' : 'white' }}>
            RM {dayTotalSpend.toFixed(2)}
          </span>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>/ RM {dailyBudget.toFixed(2)}</span>
        </div>

        <div style={{ height: '6px', background: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', margin: '12px 0 8px 0' }}>
          <div style={{
            height: '100%',
            // Floored at 0 too — a day where refunds outweigh spend makes
            // totalTodaySpend negative, which a bare Math.min would pass
            // straight into a negative CSS width.
            width: `${Math.max(0, Math.min((dayTotalSpend / dailyBudget) * 100, 100))}%`,
            background: dayOverBudget ? 'var(--color-accent-red)' : 'var(--color-money)',
            borderRadius: 'var(--radius-sm)',
            transition: 'width 0.5s ease',
          }}></div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
          <span style={{ color: 'var(--text-secondary)' }}>{isToday ? '还剩' : '那天超支/剩下'}</span>
          <span style={{ fontWeight: '700', color: dayOverBudget ? 'var(--color-accent-red)' : 'var(--color-money)' }}>
            {dayOverBudget
              ? `- RM ${Math.abs(num(dailyBudget) - dayTotalSpend).toFixed(2)} 超支`
              : `RM ${(num(dailyBudget) - dayTotalSpend).toFixed(2)}`}
          </span>
        </div>
        {/* Today's own figure, kept visible while browsing another day — the
            point of looking back is usually to decide something about today,
            and losing that number while you do is the wrong trade. */}
        {!isToday && (
          <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '8px' }}>
            今天到现在花了 RM {totalTodaySpend.toFixed(2)}
            {isOverBudget
              ? `，已经超 RM ${Math.abs(remainingBudget).toFixed(2)}`
              : `，还剩 RM ${remainingBudget.toFixed(2)}`}
          </p>
        )}
      </div>

      {/* Balances, on the screen you spend from. They used to live only on the
          户口 sub-tab, which meant the answer to "can I afford this" was one
          navigation away from the place you decide it. */}
      {accounts.filter(a => !a.archived).length > 0 && (
        <div className="glass-card" style={{ padding: '0.8rem 0.9rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '9px' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>户口余额 Balances</span>
            <button onClick={() => setView('accounts')} className="btn-secondary" style={{ padding: '3px 9px', fontSize: '0.65rem' }}>
              管理户口
            </button>
          </div>
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '2px' }}>
            {accounts.filter(a => !a.archived).map(a => {
              const c = typeMeta(a.type).color;
              const spentToday = accountBreakdown.find(b => sameId(b.account.id, a.id))?.spent ?? 0;
              return (
                <div key={a.id} style={{
                  flexShrink: 0, minWidth: '118px', padding: '0.55rem 0.7rem',
                  borderRadius: 'var(--radius-sm)', background: 'var(--bg-input)',
                  borderLeft: `3px solid ${c}`, border: '1px solid var(--border-glass)',
                  borderLeftWidth: '3px', borderLeftColor: c, borderLeftStyle: 'solid',
                }}>
                  <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.name}
                  </div>
                  <div style={{
                    fontSize: '0.95rem', fontWeight: '800', marginTop: '1px',
                    color: a.balance < 0 ? 'var(--color-accent-red)' : c,
                  }}>
                    RM {a.balance.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                    {a.kind === 'custodial' ? '代管 · 不是你的'
                      : a.countsToNetWorth === false ? '只记录 · 不算储蓄'
                      : spentToday > 0 ? `今天花了 RM ${spentToday.toFixed(2)}` : '今天还没动'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Android: the real thing. This is the headline now — it used to be a
          one-line strip below a big "paste a notification here" card, which
          read as "pasting IS the feature" even on a phone where capture was
          working. The paste box below is the fallback, and says so. */}
      <TngAutoCapture
        expenses={expenses}
        setExpenses={setExpenses}
        setLearned={setLearned}
        accounts={accounts}
        setAccounts={writeAccounts}
        onNeedPaste={() => setShowReader(true)}
      />

      {/* The web-only stand-in for TngAutoCapture above: no Android listener
          needed, just the Clipboard API checking on focus. Renders nothing on
          a browser without clipboard-read support. */}
      {!nativeCapture && (
        <ClipboardWatch
          learned={learned}
          onDetected={(text) => { setPasteText(text); setShowReader(true); }}
        />
      )}

      {/* Manual reader. On a phone with capture working this is a fallback for
          the odd notification that got missed; in a browser it's the only way
          in, and saying so plainly is the difference between "this app is
          primitive" and "this is the web version of a phone feature". */}
      <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: 'var(--radius-sm)', flexShrink: 0,
              background: 'var(--bg-card-hover)', color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Smartphone size={20} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: '700' }}>
                {nativeCapture ? '手动读取通知' : '贴上通知（网页版）'}
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {nativeCapture
                  ? '漏掉的那一则，复制过来贴进去'
                  : '网页读不到手机通知 — 要自动记账得装 Android APK'}
              </span>
            </div>
          </div>
          <button
            onClick={() => setShowReader(true)}
            className="btn-secondary"
            style={{ padding: '0.5rem 0.85rem', fontSize: '0.78rem', flexShrink: 0 }}
          >
            打开
          </button>
        </div>
        {!nativeCapture && (
          <p style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '9px', lineHeight: 1.5 }}>
            浏览器规定网页不能读别的 app 的通知 — 这是系统层面的限制，不是这个 app 少做了什么。
            装了 APK 之后，付款一跳通知就会自己记好，连贴都不用贴。
          </p>
        )}
      </div>

      {/* Spend by Category Breakdown */}
      {categoryBreakdown.length > 0 && (
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>今天花在哪几类</span>
            <button
              onClick={() => setShowCategoryManager(true)}
              className="btn-secondary"
              style={{ padding: '3px 9px', fontSize: '0.64rem' }}
            >
              管理分类
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {categoryBreakdown.map((c) => (
              <div key={c.category}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '3px' }}>
                  <CategoryText value={c.category} style={{ color: 'var(--text-primary)' }} />
                  <span style={{ color: 'var(--text-secondary)' }}>RM {c.total.toFixed(2)} ({Math.round((c.total / totalPositiveSpend) * 100)}%)</span>
                </div>
                <div style={{ height: '5px', background: 'var(--border-glass)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ height: '100%', width: `${(c.total / totalPositiveSpend) * 100}%`, background: 'var(--color-money)', borderRadius: 'var(--radius-sm)' }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Spend by account — the category breakdown's twin. "RM 60 on food" and
          "RM 60 out of Maybank" are different questions and the app should be
          able to answer both. Only rendered once more than one account was
          actually used today; with one account it's just the total again. */}
      {accountBreakdown.length > 1 && (
        <div className="glass-card">
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '10px', display: 'block' }}>
            今天从哪些户口出 Spend by account
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {accountBreakdown.map((b) => {
              const c = b.account.type ? typeMeta(b.account.type).color : 'var(--color-accent-red)';
              return (
                <div key={b.account.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '3px' }}>
                    <span style={{ color: 'var(--text-primary)' }}>{b.account.name}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      RM {b.spent.toFixed(2)}
                      {b.received > 0 && ` · 收回 RM ${b.received.toFixed(2)}`}
                    </span>
                  </div>
                  <div style={{ height: '5px', background: 'var(--border-glass)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{
                      height: '100%', borderRadius: 'var(--radius-sm)', background: c,
                      width: `${totalPositiveSpend > 0 ? (b.spent / totalPositiveSpend) * 100 : 0}%`,
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Open projects — money fronted for others that isn't fully repaid yet.
          Deliberately NOT scoped to today: a project created three days ago
          with a friend still owing money must keep showing up here until
          settled, or there'd be nowhere left to see it once its original
          expense rolls out of "today". */}
      {openProjects.length > 0 && (
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '0.75rem' }}>进行中的项目</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {openProjects.map(p => {
              const debtorStatus = getDebtorStatus(p, allExpenses ?? expenses);
              return (
              <div key={p.id} className="glass-card" style={{ padding: '0.8rem 1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '0.86rem', fontWeight: '700' }}>{p.merchant}</span>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{p.date}</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  已还 RM {p.repaidAmount.toFixed(2)} / RM {p.amount.toFixed(2)} ·{' '}
                  <strong style={{ color: 'var(--color-diet)' }}>还差 RM {p.outstanding.toFixed(2)}</strong>
                </div>
                <div style={{ height: '5px', background: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', marginTop: '6px' }}>
                  <div style={{
                    height: '100%', width: `${Math.min(100, (p.repaidAmount / p.amount) * 100)}%`,
                    background: 'var(--color-money)', borderRadius: 'var(--radius-sm)',
                  }}></div>
                </div>
                {/* Who hasn't paid — only shown when the project actually
                    named its debtors; a project without them still works,
                    just with aggregate progress only (see getDebtorStatus). */}
                {debtorStatus.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '8px' }}>
                    {debtorStatus.map(d => (
                      <span key={d.id} style={{
                        fontSize: '0.68rem', padding: '3px 8px', borderRadius: 'var(--radius-sm)',
                        background: d.isPaid ? 'var(--color-money-soft)' : 'var(--color-diet-soft)',
                        color: d.isPaid ? 'var(--color-money)' : 'var(--color-diet)',
                        border: `1px solid ${d.isPaid ? 'var(--color-money)' : 'var(--color-diet)'}`,
                      }}>
                        {d.name} {d.isPaid ? '✓' : `还差 RM ${d.owing.toFixed(2)}`}
                      </span>
                    ))}
                  </div>
                )}

                {/* 结束项目 — the way out.
                    Repayments essentially never reach the full amount, because
                    the person fronting the money is usually one of the people
                    eating. Without this the project sits here forever showing
                    「还差 RM 25」 for a share nobody owes. Closing says the rest
                    was mine, and that share becomes this user's own spending. */}
                <button
                  onClick={() => setConfirmCloseProject(p)}
                  className="btn-secondary"
                  style={{ marginTop: '10px', width: '100%', fontSize: '0.72rem', padding: '0.45rem' }}
                >
                  <Check size={13} /> 结束这个项目（剩下的 RM {p.outstanding.toFixed(2)} 算我自己花的）
                </button>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Closed projects — kept visible and reversible.
          A close is a judgement call ("nobody else is paying"), and judgement
          calls get made wrongly, so this is not a one-way door: reopening puts
          the project back with its full amount and every repayment intact. */}
      {closedProjects.length > 0 && (
        <details>
          <summary style={{
            fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-secondary)',
            cursor: 'pointer', padding: '0.35rem 0',
          }}>
            已结束的项目（{closedProjects.length}）
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
            {closedProjects.map(p => (
              <div key={p.id} className="glass-card" style={{ padding: '0.7rem 0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: '700', minWidth: 0 }}>{p.merchant}</span>
                  <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', flexShrink: 0 }}>{p.date}</span>
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  垫了 RM {p.amount.toFixed(2)} · 收回 RM {p.repaidAmount.toFixed(2)} ·{' '}
                  <strong style={{ color: 'var(--color-accent-red)' }}>我自己出 RM {p.myShare.toFixed(2)}</strong>
                </div>
                <button
                  onClick={() => reopenProject(p)}
                  className="btn-secondary"
                  style={{ marginTop: '8px', fontSize: '0.66rem', padding: '3px 9px' }}
                >
                  重新打开
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Closing changes what counts as this user's own spending, so it says
          the resulting number out loud before doing it rather than after. */}
      {confirmCloseProject && (
        <div className="modal-overlay" onClick={() => setConfirmCloseProject(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem' }}>
              <h3 style={{ fontSize: '1.02rem', fontWeight: '700' }}>结束「{confirmCloseProject.merchant}」?</h3>
              <button onClick={() => setConfirmCloseProject(null)} aria-label="取消"
                style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{
              padding: '0.7rem 0.85rem', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
              fontSize: '0.76rem', lineHeight: 1.9,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>我垫的</span>
                <span>RM {confirmCloseProject.amount.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>朋友还的</span>
                <span style={{ color: 'var(--color-money)' }}>− RM {confirmCloseProject.repaidAmount.toFixed(2)}</span>
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between', fontWeight: '700',
                borderTop: '1px solid var(--border-glass)', marginTop: '4px', paddingTop: '4px',
              }}>
                <span>我自己花的</span>
                <span style={{ color: 'var(--color-accent-red)' }}>RM {confirmCloseProject.myShare.toFixed(2)}</span>
              </div>
            </div>

            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.6, marginTop: '0.8rem' }}>
              结束之后，这笔在<strong>分类统计和本月的圆圈</strong>里只算 RM {confirmCloseProject.myShare.toFixed(2)} —
              朋友那部分本来就不是你的钱。户口余额和已经记好的每一笔都不会动，
              随时可以在「已结束的项目」里重新打开。
            </p>

            <div style={{ display: 'flex', gap: '10px', marginTop: '1.1rem' }}>
              <button onClick={() => setConfirmCloseProject(null)} className="btn-secondary" style={{ flex: 1 }}>
                取消
              </button>
              <button onClick={() => closeProject(confirmCloseProject)} className="btn-primary" style={{ flex: 1 }}>
                <Check size={15} /> 结束项目
              </button>
            </div>
          </div>
        </div>
      )}

      {showCategoryManager && <CategoryManager onClose={() => setShowCategoryManager(false)} />}

      {/* Expenses Log — PURCHASES only, and now strictly so.
          Four other things live in this same array and each is money moving for
          a different reason: a repayment, a fixed bill payment, a transfer
          between your own accounts, money arriving. Every one of them used to
          be able to land in a list titled "expenses" depending on which flag it
          happened to carry, which is exactly what the user meant by
          「交易类型必须严格区分」. Each now has its own section below, and
          `isRealSpend` is the single line that decides. See accounts.js. */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem', gap: '10px', flexWrap: 'wrap' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: '700' }}>今天买了什么 Purchases</h3>
          {positiveExpenses.length > 0 && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              真正消费 RM {totalPositiveSpend.toFixed(2)}
            </span>
          )}
        </div>

        {positiveExpenses.length === 0 ? (
          <div className="glass-card" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)' }}>
            <p style={{ fontSize: '0.82rem' }}>No expenses recorded today.</p>
            <button onClick={openAddModal} className="btn-primary" style={{ margin: '1rem auto 0 auto', fontSize: '0.8rem' }}>
              <Plus size={16} /> Add your first expense
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {positiveExpenses.map((item) => (
              <div
                key={item.id}
                className="glass-card"
                onClick={() => openEditModal(item)}
                style={{ padding: '0.85rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  {/* Used to read a hardcoded "TNG" on every single row,
                      including expenses paid from a completely different
                      account. It's the account's own colour and initials now. */}
                  {(() => {
                    const acc = accountById(accounts, item.accountId);
                    const c = acc ? typeMeta(acc.type).color : 'var(--color-accent-red)';
                    return (
                      <div style={{
                        width: '36px', height: '36px', borderRadius: 'var(--radius-sm)', flexShrink: 0,
                        background: acc ? `${c}22` : 'var(--color-accent-red-soft)', color: c,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: '800', fontSize: '0.62rem', textAlign: 'center', lineHeight: 1.05,
                      }}>
                        {acc ? initials(acc.name) : '?'}
                      </div>
                    );
                  })()}
                  <div style={{ minWidth: 0 }}>
                    <h4 style={{ fontSize: '0.88rem', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.merchant}
                    </h4>
                    {item.note && (
                      <p style={{
                        fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '1px',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {item.note}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '3px', flexWrap: 'wrap' }}>
                      <AccountChip accounts={accounts} accountId={item.accountId} size="xs" />
                      <CategoryText value={item.category} txType={txType(item)} />
                      <span>•</span>
                      <span>{item.time}</span>
                      {item.source && <span style={{ color: 'var(--color-money)' }}>• {item.source}</span>}
                    </div>
                    {item.isProject && projectsById.get(item.id) && (() => {
                      const p = projectsById.get(item.id);
                      return (
                        <div style={{ marginTop: '5px' }}>
                          <div style={{ fontSize: '0.66rem', color: p.isSettled ? 'var(--color-money)' : 'var(--color-diet)' }}>
                            {/* A closed project reports what it actually cost
                                this user, because that is the number the
                                category totals now use — showing only 收回 here
                                would leave the row disagreeing with the chart. */}
                            {p.isClosed
                              ? `已结束 · 收回 RM ${p.repaidAmount.toFixed(2)} · 我自己出 RM ${p.myShare.toFixed(2)}`
                              : p.isSettled
                                ? `已结清 · 收回 RM ${p.repaidAmount.toFixed(2)}`
                                : `已还 RM ${p.repaidAmount.toFixed(2)} / RM ${p.amount.toFixed(2)}`}
                          </div>
                          <div style={{ height: '4px', background: 'var(--border-glass)', borderRadius: '2px', marginTop: '3px', maxWidth: '160px' }}>
                            <div style={{
                              height: '100%', width: `${Math.min(100, (p.repaidAmount / p.amount) * 100)}%`,
                              background: 'var(--color-money)', borderRadius: '2px',
                            }}></div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--color-accent-red)' }}>
                    - RM {item.amount.toFixed(2)}
                  </span>
                  <Pencil size={13} color="var(--text-muted)" />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteExpense(item.id); }}
                    aria-label={`Delete ${item.merchant}`}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Money that LEFT today but was not shopping: a fixed bill, a debt
          repayment. Real ringgit out — so hiding it would be dishonest — but
          it is already reported under its own name in 本月 (固定开销 / 还债),
          and letting it into the purchase list above is what made a month with
          rent in it read as a spending spree. Shown, labelled, kept apart. */}
      {committedEntries.length > 0 && (
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '0.35rem' }}>固定开销 · 还款</h3>
          <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.7rem', lineHeight: 1.5 }}>
            这些是真的付出去了，但不算「消费」 — 本月那边已经当成固定开销/还债算过一次。
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {committedEntries.map((item) => {
              const meta = txTypeMeta(txType(item));
              return (
                <div
                  key={item.id}
                  className="glass-card"
                  onClick={() => openEditModal(item)}
                  style={{ padding: '0.7rem 0.9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <h4 style={{ fontSize: '0.85rem', fontWeight: '600' }}>{item.merchant}</h4>
                      <span style={{
                        fontSize: '0.55rem', fontWeight: '800', padding: '1px 5px',
                        borderRadius: 'var(--radius-sm)', border: `1px solid ${meta.color}`, color: meta.color,
                      }}>
                        {meta.label}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '3px', flexWrap: 'wrap' }}>
                      <AccountChip accounts={accounts} accountId={item.accountId} size="xs" />
                      {item.time && <span>{item.time}</span>}
                      {item.note && <span>· {item.note}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: '700', color: meta.color }}>
                      - RM {num(item.amount).toFixed(2)}
                    </span>
                    <Pencil size={13} color="var(--text-muted)" />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteExpense(item.id); }}
                      aria-label={`Delete ${item.merchant}`}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Money received — repayments and refunds. Kept OUT of Expenses Log
          entirely: they're money coming in, and "expense" should only ever
          mean money going out. Still the same underlying records (a negative
          `amount`, same array) — this is a display split, not a data split,
          so every total upstream (budget, category breakdown, cycle spend)
          is unaffected. */}
      {repaymentEntries.length > 0 && (
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '0.75rem' }}>收到的款项 Money received</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {repaymentEntries.map((item) => (
              <div
                key={item.id}
                className="glass-card"
                onClick={() => openEditModal(item)}
                style={{ padding: '0.85rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  {/* Was a hardcoded 「退」 on every row in this section, which
                      covers BOTH refunds and arrivals — so a salary landing was
                      labelled as someone paying you back. Two different kinds of
                      money wearing one badge is precisely the confusion the type
                      system exists to end. */}
                  {(() => {
                    const meta = txTypeMeta(txType(item));
                    return (
                      <div style={{
                        width: '36px', height: '36px', borderRadius: 'var(--radius-sm)', flexShrink: 0,
                        background: 'var(--color-diet-soft)', color: meta.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: '800', fontSize: '0.7rem',
                      }}>
                        {meta.short}
                      </div>
                    );
                  })()}
                  <div style={{ minWidth: 0 }}>
                    <h4 style={{ fontSize: '0.88rem', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.merchant}
                    </h4>
                    {item.note && (
                      <p style={{
                        fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '1px',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {item.note}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '3px', flexWrap: 'wrap' }}>
                      <AccountChip accounts={accounts} accountId={item.accountId} size="xs" />
                      <CategoryText value={item.category} txType={txType(item)} />
                      <span>•</span>
                      <span>{item.time}</span>
                      {item.repaysExpenseId != null && projectsById.get(item.repaysExpenseId) && (
                        <span style={{ color: 'var(--color-money)' }}>• 还「{projectsById.get(item.repaysExpenseId).merchant}」的钱</span>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--color-money)' }}>
                    + RM {Math.abs(item.amount).toFixed(2)}
                  </span>
                  <Pencil size={13} color="var(--text-muted)" />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteExpense(item.id); }}
                    aria-label={`Delete ${item.merchant}`}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Account transfers — shown, but kept out of Expenses Log and 收到的款项
          entirely. Moving your own money is neither spending nor income; the
          only thing it changes is which account holds it. One row per pair,
          not two, because "RM100 Maybank → TNG" is one event. */}
      {transferEntries.length > 0 && (
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '0.75rem' }}>户口之间转账</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {transferEntries.filter(item => item.amount > 0).map((item) => {
              const incoming = transferEntries.find(t => t.transferId === item.transferId && t.amount < 0);
              return (
                <div key={item.transferId} className="glass-card" style={{
                  padding: '0.8rem 1rem', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', gap: '10px',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <AccountChip accounts={accounts} accountId={item.accountId} size="xs" />
                      <ArrowRightLeft size={12} color="var(--text-muted)" />
                      <AccountChip accounts={accounts} accountId={incoming?.accountId} size="xs" />
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {item.note ? `${item.note} · ` : ''}{item.time} · 不算开销
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <span style={{ fontSize: '0.92rem', fontWeight: '700', color: 'var(--text-secondary)' }}>
                      RM {Math.abs(item.amount).toFixed(2)}
                    </span>
                    <button
                      onClick={() => handleDeleteTransfer(item.transferId)}
                      aria-label="删除这笔转账"
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add / Edit Expense Modal */}
      {showEntryModal && (
        <div className="modal-overlay" onClick={() => { setShowEntryModal(false); resetForm(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Wallet size={20} color="var(--color-money)" />
                {editingId ? 'Edit Expense' : 'Add Expense'}
              </h3>
              <button onClick={() => { setShowEntryModal(false); resetForm(); }} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmitEntry} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* 我出的钱 vs 别人还我: which way the money moved. A friend paying
                  back their share of a meal you fronted is stored as a
                  negative amount so it nets against the original spend
                  instead of quietly counting as new income. */}
              <div>
                <label style={labelStyle}>这笔钱怎么动的?</label>
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                  {[
                    { value: 'out', label: '我出的钱', tint: 'var(--color-accent-red)', soft: 'var(--color-accent-red-soft)' },
                    { value: 'refund', label: '别人还我', tint: 'var(--color-money)', soft: 'var(--color-money-soft)' },
                    { value: 'in', label: '钱进来了', tint: 'var(--color-diet)', soft: 'var(--color-diet-soft)' },
                  ].map(opt => {
                    const on = formDirection === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setFormDirection(opt.value)}
                        style={{
                          flex: 1, padding: '9px 6px', borderRadius: 'var(--radius-sm)', fontSize: '0.76rem', fontWeight: '700',
                          cursor: 'pointer',
                          background: on ? opt.soft : 'var(--bg-input)',
                          border: `1px solid ${on ? opt.tint : 'var(--border-glass)'}`,
                          color: on ? opt.tint : 'var(--text-secondary)',
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {formDirection === 'refund' && (
                  <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '5px', lineHeight: 1.5 }}>
                    像朋友还你分摊的餐费。会从今天的花费里扣掉，不会当成新收入 — 不然这笔钱会被算两次。
                  </p>
                )}
                {formMoneyIn && (
                  <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '5px', lineHeight: 1.5 }}>
                    外面进来的钱：生活费、薪水、别的户口转进来。会加进这个户口的余额，
                    但<strong>不会</strong>推高你的每日额度 — 每月固定的进账请在「本月」设成收入来源，
                    在这里记等于算两次。
                  </p>
                )}
              </div>

              {/* The question the whole expense log used to be unable to
                  answer. Placed second, right after "which way did the money
                  move" — before the shop name, because on a phone this is the
                  field most likely to be wrong if it's buried at the bottom. */}
              <AccountPicker
                accounts={accounts}
                value={formAccountId}
                onChange={setFormAccountId}
                label={formRefund ? '钱进了哪个户口?' : '从哪个户口出?'}
              />

              <div>
                <label style={labelStyle}>{formMoneyIn ? '这笔钱哪来的?' : formRefund ? '谁还的钱?' : 'Shop / Description'}</label>
                <input
                  type="text"
                  autoFocus
                  placeholder={formMoneyIn ? '例：爸爸生活费 / 实习薪水' : formRefund ? '例：Ah Meng' : 'e.g. Restoran Pelita'}
                  value={formMerchant}
                  onChange={(e) => handleMerchantChange(e.target.value)}
                  style={inputStyle}
                  required
                />
              </div>

              <div>
                <label style={labelStyle}>{formMoneyIn ? '进了多少 (RM)' : formRefund ? '还了多少 (RM)' : 'Amount (RM)'}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  inputMode="decimal"
                  placeholder="e.g. 16.50"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  style={inputStyle}
                  required
                />
              </div>

              {/* Money in and money out read from different lists — 工资 is not
                  a member of the same vocabulary as 餐饮. `formTxType` is what
                  decides, so the picker follows the 出/入 toggle above it. */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <label style={labelStyle}>分类</label>
                  <button
                    type="button"
                    onClick={() => setShowCategoryManager(true)}
                    style={{
                      background: 'none', border: 'none', color: 'var(--color-money)',
                      fontSize: '0.68rem', cursor: 'pointer', padding: 0,
                    }}
                  >
                    管理分类
                  </button>
                </div>
                <CategorySelect
                  txType={formTxType}
                  value={formCategory}
                  onChange={setFormCategory}
                  style={inputStyle}
                />
                {!formRefund && (
                  <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '5px' }}>
                    存了之后会记住这家店属于哪一类，下次自动填。
                  </p>
                )}
              </div>

              {/* WHICH INCOME SOURCE. The link that makes 「今天记收入」 and
                  「本月收入」 one system instead of two that never met — file it
                  here and this cycle's income moves; leave it unfiled and 本月
                  says so out loud rather than guessing (it may well be the
                  salary already listed there, and adding it would count the
                  same ringgit twice). See cycle.js. */}
              {formMoneyIn && (
                <div>
                  <label style={labelStyle}>这笔算哪一种收入?</label>
                  <select
                    value={formIncomeSourceId}
                    onChange={(e) => setFormIncomeSourceId(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">还没归类（不会算进本月收入）</option>
                    {incomeSources.map(src => (
                      <option key={src.id} value={String(src.id)}>
                        {src.label}{src.kind === 'passthrough' ? '（代收代付）' : ''}
                      </option>
                    ))}
                    <option value="__new">+ 新的收入来源…</option>
                  </select>

                  {formIncomeSourceId === '__new' && (
                    <>
                      <input
                        type="text"
                        placeholder="例：工作收入 / 房租收入 / 朋友还钱"
                        value={formNewSource}
                        onChange={(e) => setFormNewSource(e.target.value)}
                        style={inputStyle}
                      />
                      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '6px' }}>
                        {['工作收入', '房租收入', '朋友还钱', '其他收入'].map(name => (
                          <button
                            key={name}
                            type="button"
                            onClick={() => setFormNewSource(name)}
                            style={{
                              padding: '4px 9px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                              fontSize: '0.68rem',
                              background: formNewSource === name ? 'var(--color-money-soft)' : 'var(--bg-input)',
                              border: `1px solid ${formNewSource === name ? 'var(--color-money)' : 'var(--border-glass)'}`,
                              color: formNewSource === name ? 'var(--color-money)' : 'var(--text-secondary)',
                            }}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '5px', lineHeight: 1.5 }}>
                    {formIncomeSourceId && formIncomeSourceId !== '__new'
                      ? '归类之后，本月那边的收入会用这个真实数字，不再用你设定的预计金额。'
                      : '不归类也可以记 — 户口余额照样会加。只是本月的收入不会动，因为 app 不知道这是不是你已经列过的那一笔。'}
                  </p>
                </div>
              )}

              {/* WHICH FIXED BILL, if any. Before this there was no way to say
                  "this payment IS my rent", so a logged bill payment was charged
                  twice — once as the allocation's reservation at the top of the
                  cycle, once as spending on the day it left. Saying so here also
                  ticks that bill off for this cycle, because it is the same
                  statement. */}
              {!formRefund && allocations.length > 0 && (
                <div>
                  <label style={labelStyle}>这笔是固定月费吗?</label>
                  <select
                    value={formAllocationId}
                    onChange={(e) => setFormAllocationId(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">不是，普通开销</option>
                    {allocations.map(a => (
                      <option key={a.id} value={String(a.id)}>{a.label}</option>
                    ))}
                  </select>
                  {formAllocationId && (
                    <p style={{ fontSize: '0.68rem', color: 'var(--color-money)', marginTop: '5px', lineHeight: 1.5 }}>
                      会算成这个周期的固定开销（不会再当成一般消费扣一次），
                      同时把这笔月费标记成「本期已付」。
                    </p>
                  )}
                </div>
              )}

              {/* 项目 (project): marks a fronted expense as one others owe you
                  back on, so later repayments — however many, however late —
                  can be filed under it instead of floating unlinked. */}
              {!formRefund && (
                <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={formIsProject}
                    onChange={(e) => setFormIsProject(e.target.checked)}
                    style={{ width: '15px', height: '15px' }}
                  />
                  别人会还我这笔钱（设成项目，之后的还款可以归类在这底下）
                </label>
              )}

              {!formRefund && formIsProject && (
                <div>
                  <label style={labelStyle}>谁要还钱?（可选，之后能看出谁还没还）</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                    {formDebtors.map((d, i) => (
                      <div key={i} style={{ display: 'flex', gap: '6px' }}>
                        <input
                          type="text"
                          placeholder="名字"
                          value={d.name}
                          onChange={(e) => updateDebtorRow(i, 'name', e.target.value)}
                          style={{ ...inputStyle, flex: 2, marginTop: 0 }}
                        />
                        <input
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          placeholder="分摊 RM"
                          value={d.share}
                          onChange={(e) => updateDebtorRow(i, 'share', e.target.value)}
                          style={{ ...inputStyle, flex: 1, marginTop: 0 }}
                        />
                        <button
                          type="button"
                          onClick={() => removeDebtorRow(i)}
                          aria-label="移除"
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={addDebtorRow} className="btn-secondary" style={{ fontSize: '0.75rem', padding: '6px 10px' }}>
                      <Plus size={13} /> 加一个人
                    </button>
                  </div>
                  <p style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.5 }}>
                    分摊金额不用刚好加起来等于总额。不填名字也没关系 — 项目照样能用，只是看不到「谁还没还」。
                  </p>
                </div>
              )}

              {/* Arrivals repay nothing, so the project link is hidden for
                  them rather than shown and ignored. */}
              {formRefund && !formMoneyIn && (
                <div>
                  <label style={labelStyle}>这是还哪个项目的钱?（可选）</label>
                  <select
                    value={formRepaysProjectId}
                    onChange={(e) => setFormRepaysProjectId(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">不属于任何项目</option>
                    {openProjects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.merchant}（{p.date}）· 还差 RM {p.outstanding.toFixed(2)}
                      </option>
                    ))}
                  </select>
                  {openProjects.length === 0 && (
                    <p style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '5px', lineHeight: 1.5 }}>
                      现在没有未结清的项目。要先在「我出的钱」那笔开销上勾选「别人会还我」，才能在这里归类。
                    </p>
                  )}
                  {/* Tapping a name fills 谁还的钱 with the exact spelling on
                      the debtor list — matching is by name string, so a typo
                      here ("ahmeng" vs "Ah Meng") would silently fail to mark
                      that person as paid. */}
                  {formRepaysProjectId && (() => {
                    const project = projectsById.get(Number(formRepaysProjectId));
                    const owing = project ? getDebtorStatus(project, allExpenses ?? expenses).filter(d => !d.isPaid) : [];
                    return owing.length > 0 && (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                        {owing.map(d => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => setFormMerchant(d.name)}
                            style={{
                              background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
                              color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)', padding: '4px 10px',
                              fontSize: '0.72rem', cursor: 'pointer',
                            }}
                          >
                            {d.name} · 还差 RM {d.owing.toFixed(2)}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              <div>
                <label style={labelStyle}>{formRefund ? '备注（可选）' : 'What was this for? (optional)'}</label>
                <input
                  type="text"
                  placeholder={formMoneyIn ? '例：8 月生活费' : formRefund ? '例：上次晚餐分摊' : 'e.g. split dinner with Ah Meng'}
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  style={inputStyle}
                />
              </div>

              {/* WHEN. Defaulted to now, so nothing gets slower for the normal
                  case — but a payment you only remember the next morning was
                  not spent the next morning, and until this existed there was
                  no way to say so. The date drives every total, cycle and
                  archive, so it is the field that actually matters. */}
              <div>
                <label style={labelStyle}>什么时候</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="date"
                    value={formDate}
                    max={today}
                    onChange={(e) => setFormDate(e.target.value || today)}
                    style={{ ...inputStyle, flex: 2 }}
                  />
                  <input
                    type="time"
                    value={formTime}
                    onChange={(e) => setFormTime(e.target.value)}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                  {[
                    { label: '今天', date: today },
                    { label: '昨天', date: shiftDate(today, -1) },
                    { label: '前天', date: shiftDate(today, -2) },
                  ].map(opt => (
                    <button
                      type="button"
                      key={opt.date}
                      onClick={() => setFormDate(opt.date)}
                      style={{
                        padding: '4px 11px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        background: formDate === opt.date ? 'var(--color-money-soft)' : 'var(--bg-card)',
                        border: `1px solid ${formDate === opt.date ? 'var(--color-money)' : 'var(--border-glass)'}`,
                        color: formDate === opt.date ? 'var(--color-money)' : 'var(--text-secondary)',
                        fontSize: '0.7rem', fontWeight: '700',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {formDate !== today && (
                  <p style={{ fontSize: '0.66rem', color: 'var(--color-accent-amber)', marginTop: '6px', lineHeight: 1.5 }}>
                    这笔会算在 <strong>{describeDate(formDate, today)}</strong>，不是今天 — 今天的额度不受影响。
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => { setShowEntryModal(false); resetForm(); }} className="btn-secondary" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>
                  {editingId ? 'Save Changes' : formMoneyIn ? '记录这笔进账' : formRefund ? '记录这笔退款' : 'Add Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTextExport && <TextExportModal onClose={() => setShowTextExport(false)} />}

      {/* Transfer modal */}
      {showTransferModal && (
        <div className="modal-overlay" onClick={() => setShowTransferModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ArrowRightLeft size={19} color="var(--color-money)" /> 户口转账
              </h3>
              <button onClick={() => setShowTransferModal(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '1rem' }}>
              把自己的钱从一个户口搬到另一个（例如从银行 top up TNG）。
              <strong>这不算开销</strong> — 不会进预算、不会进分类，只是两边余额跟着动。
            </p>

            <form onSubmit={handleSubmitTransfer} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>从</label>
                <AccountSelect accounts={accounts} value={tFrom} onChange={setTFrom} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>到</label>
                <AccountSelect accounts={accounts} value={tTo} onChange={setTTo} style={inputStyle} />
                {sameId(tFrom, tTo) && (
                  <p style={{ fontSize: '0.68rem', color: 'var(--color-accent-red)', marginTop: '5px' }}>
                    要选两个不同的户口。
                  </p>
                )}
              </div>
              <div>
                <label style={labelStyle}>金额 (RM)</label>
                <input
                  type="number" step="0.01" min="0.01" inputMode="decimal" autoFocus
                  placeholder="例：100" value={tAmount}
                  onChange={(e) => setTAmount(e.target.value)}
                  style={inputStyle} required
                />
              </div>
              <div>
                <label style={labelStyle}>备注（可选）</label>
                <input
                  type="text" placeholder="例：top up TNG" value={tNote}
                  onChange={(e) => setTNote(e.target.value)} style={inputStyle}
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setShowTransferModal(false)} className="btn-secondary" style={{ flex: 1 }}>取消</button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={sameId(tFrom, tTo)}>记录转账</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TNG Notification Reader Modal */}
      {showReader && (
        <div className="modal-overlay" onClick={() => setShowReader(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Smartphone size={20} color="var(--color-money)" /> TNG Notification Reader
              </h3>
              <button onClick={() => setShowReader(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{
              background: 'var(--bg-card)',
              borderLeft: '3px solid var(--color-money)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.6rem 0.75rem',
              fontSize: '0.72rem',
              lineHeight: 1.45,
              color: 'var(--text-secondary)',
              marginBottom: '1rem',
            }}>
              复制一则通知贴进来。用固定的规则读出金额和商家 — 没有 AI，没有把任何东西送出去。
              {nativeCapture
                ? ' 手机上通常会自己收到，这里是补漏用的。'
                : ' 网页没办法自己读手机通知（这是浏览器的限制），要全自动就得装 Android APK。'}
            </div>

            <label style={labelStyle}>Notification text</label>
            <textarea
              autoFocus
              rows={4}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="把通知贴进来…"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.45 }}
            />

            {/* Verdict */}
            {pasteText.trim() && (
              <div style={{
                marginTop: '1rem',
                background: verdict.tone,
                border: `1px solid ${verdict.color}`,
                borderRadius: 'var(--radius-md)',
                padding: '0.85rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '6px' }}>
                  {parsed.kind === 'spend' ? <Check size={16} color={verdict.color} />
                    : parsed.kind === 'income' ? <ArrowDownLeft size={16} color={verdict.color} />
                    : parsed.kind === 'noise' ? <Info size={16} color={verdict.color} />
                    : <AlertTriangle size={16} color={verdict.color} />}
                  <span style={{ fontSize: '0.82rem', fontWeight: '700', color: verdict.color }}>
                    {parsed.isTransfer ? 'Transfer out detected' : verdict.title}
                  </span>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  {parsed.reason}
                </p>

                {parsed.kind === 'spend' && (
                  <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <div style={{ flex: 2 }}>
                        <label style={{ ...labelStyle, fontSize: '0.7rem' }}>Shop</label>
                        <input
                          type="text"
                          value={readerMerchant}
                          onChange={(e) => setReaderMerchant(e.target.value)}
                          placeholder="Who was paid?"
                          style={{ ...inputStyle, padding: '8px 10px', fontSize: '0.8rem' }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ ...labelStyle, fontSize: '0.7rem' }}>RM</label>
                        <input
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          value={readerAmount}
                          onChange={(e) => setReaderAmount(e.target.value)}
                          style={{ ...inputStyle, padding: '8px 10px', fontSize: '0.8rem' }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ ...labelStyle, fontSize: '0.7rem' }}>分类</label>
                      {/* Always the expense list: the reader only ever offers
                          to log a `spend` verdict — an income notification is
                          reported, never turned into a record here. */}
                      <CategorySelect
                        txType="expense"
                        value={readerCategory}
                        onChange={setReaderCategory}
                        style={{ ...inputStyle, padding: '8px 10px', fontSize: '0.8rem' }}
                      />
                    </div>

                    {/* A pasted notification doesn't say which wallet it came
                        from any more reliably than a typed expense does, so it
                        gets asked here too rather than silently assuming TNG. */}
                    <AccountPicker
                      accounts={accounts}
                      value={readerAccountId}
                      onChange={setReaderAccountId}
                      label="从哪个户口出?"
                      showBalance={false}
                    />

                    {/* The notification says how much left the wallet, but not
                        what it bought. Ask, rather than filing it as "Other". */}
                    {parsed.needsPurpose ? (
                      <div style={{
                        background: 'var(--color-diet-soft)',
                        border: '1px solid var(--color-diet)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0.7rem',
                      }}>
                        <label style={{ ...labelStyle, fontSize: '0.72rem', color: 'var(--color-diet)', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <HelpCircle size={13} /> What was this for?
                        </label>
                        <input
                          type="text"
                          value={readerNote}
                          onChange={(e) => setReaderNote(e.target.value)}
                          placeholder={parsed.isTransfer ? 'e.g. split dinner, carpool, rent' : 'e.g. phone case, groceries'}
                          style={{ ...inputStyle, padding: '8px 10px', fontSize: '0.8rem' }}
                        />
                        <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '5px', lineHeight: 1.4 }}>
                          {parsed.isTransfer
                            ? "A person's name doesn't say what you bought, so this is asked every time."
                            : 'Not a shop the app knows yet — set the category above and it stops asking.'}
                        </p>
                      </div>
                    ) : (
                      <div>
                        <label style={{ ...labelStyle, fontSize: '0.7rem' }}>Note (optional)</label>
                        <input
                          type="text"
                          value={readerNote}
                          onChange={(e) => setReaderNote(e.target.value)}
                          placeholder="Anything worth remembering"
                          style={{ ...inputStyle, padding: '8px 10px', fontSize: '0.8rem' }}
                        />
                      </div>
                    )}

                    <button
                      onClick={handleLogParsed}
                      disabled={purposeMissing}
                      className="btn-primary"
                      style={{
                        fontSize: '0.85rem',
                        opacity: purposeMissing ? 0.45 : 1,
                        cursor: purposeMissing ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <Check size={16} /> {purposeMissing ? 'Type what it was for first' : 'Log this expense'}
                    </button>
                  </div>
                )}

                {parsed.kind === 'unknown' && (
                  <button
                    onClick={() => {
                      resetForm();
                      setFormMerchant(parsed.merchant || '');
                      setFormAmount(parsed.amount != null ? String(parsed.amount) : '');
                      setFormCategory(categorise(parsed.merchant, learned));
                      setShowReader(false);
                      setShowEntryModal(true);
                    }}
                    className="btn-secondary"
                    style={{ marginTop: '0.85rem', width: '100%', fontSize: '0.8rem' }}
                  >
                    <Plus size={15} /> Enter it manually instead
                  </button>
                )}

                {/* Money in is never self-evident from the wording alone — a
                    reload and a friend paying you back both read as "received".
                    Ask which it was instead of silently doing nothing. */}
                {parsed.kind === 'income' && (
                  <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p style={{ fontSize: '0.71rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      这是谁的钱？自己转的钱不用记；别人给的钱（还款、礼金等）要记一笔，冲抵今天的花费。
                    </p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={dismissIncome}
                        className="btn-secondary"
                        style={{ flex: 1, fontSize: '0.76rem', padding: '0.55rem' }}
                      >
                        自己转的钱 · 不用记
                      </button>
                      <button
                        type="button"
                        onClick={routeIncomeAsRepayment}
                        className="btn-primary"
                        style={{ flex: 1, fontSize: '0.76rem', padding: '0.55rem' }}
                      >
                        别人给的钱 · 去记一笔
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Samples */}
            <div style={{ marginTop: '1.25rem' }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Try it with a sample — including two that must <em>not</em> become expenses:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {SAMPLE_NOTIFICATIONS.map((sample) => (
                  <button
                    key={sample.label}
                    onClick={() => setPasteText(sample.text)}
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-glass)',
                      color: 'var(--text-secondary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      textAlign: 'left',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    {sample.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      </>
      )}

    </div>
  );
}
