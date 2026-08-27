// One-time migration to the date-stamped record model (see SCHEMA.md).
//
// Before this, meals/workouts/expenses were "today's list" and the midnight
// rollover emptied them. Anything still sitting in storage belongs to
// `lastActiveDate` — the day it was logged — NOT to today. Stamping it with
// today would silently refile yesterday's dinner as this morning's.
//
// Runs at module load, before any component reads storage, for the same reason
// purgeDemoHistory does: a component reading during render would race it.

import { DEFAULT_ROUTINES, STOCK_ROUTINE_IDS } from './workoutRoutines.js';

const PREFIX = 'lifemanager:';
const SCHEMA_VERSION = 6;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

/** Stamp undated records with the day they were actually logged. */
function stampDates(key, fallbackDate) {
  const items = read(key, []);
  if (!Array.isArray(items) || items.length === 0) return 0;

  let changed = 0;
  const stamped = items.map(item => {
    if (item && typeof item === 'object' && !item.date) {
      changed++;
      return {
        ...item,
        date: fallbackDate,
        // `id` has been Date.now() all along, so it doubles as the timestamp
        // for anything logged before `at` existed.
        at: item.at ?? (typeof item.id === 'number' ? item.id : Date.now()),
      };
    }
    return item;
  });

  if (changed > 0) write(key, stamped);
  return changed;
}

/**
 * v3: file every existing expense against an account.
 *
 * Before accounts.js, every expense carried `paymentMethod: "Touch 'n Go
 * eWallet"` as a hardcoded display string and no link to anything. Leaving
 * those unassigned would be the honest-but-useless option: the whole back
 * catalogue would render "未指定户口" and every derived balance would ignore it.
 *
 * They're stamped with the TNG account instead, because that string is what
 * the app itself asserted at the time and TNG really was the only way to pay.
 * Anything whose paymentMethod says otherwise is left alone rather than
 * guessed at — an unassigned expense is visible and fixable, a wrongly
 * assigned one silently corrupts a balance.
 */
/**
 * v3: put the seeded Touch 'n Go account into storage, once.
 *
 * `ensureAccounts()` conjures one on read so the UI always has somewhere to
 * file an expense, but a purely in-memory account re-stamps its `openingAt`
 * every time the memo recomputes — the balance never settles on a real
 * baseline. Writing it here at the moment of upgrade gives it one.
 *
 * `openingAt: at` (not 0) matters for anyone upgrading with expenses already
 * logged and no accounts ever configured: those expenses are about to be filed
 * against this account, and a t=0 watermark would subtract every one of them
 * from an opening balance of zero.
 */
function seedAccounts(at) {
  const accounts = read('accounts', []);
  if (Array.isArray(accounts) && accounts.length > 0) return 0;
  write('accounts', [{
    id: 'tng',
    name: "Touch 'n Go eWallet",
    type: 'ewallet',
    kind: 'own',
    countsToNetWorth: true,
    openingBalance: 0,
    openingAt: at,
    target: null,
    isDefault: true,
    packages: ['my.com.tngdigital.ewallet', 'com.touchngo.ewallet'],
    archived: false,
  }]);
  return 1;
}

/**
 * v3: stamp every existing account with an explicit opening balance and
 * watermark, so the derived-balance model has a real baseline instead of
 * re-deriving one on every launch.
 *
 * The moment of upgrade is the honest baseline: the balance sitting in storage
 * was typed by hand and was current when it was typed, so it counts nothing
 * before now and everything after.
 */
function baselineAccounts(at) {
  const accounts = read('accounts', []);
  if (!Array.isArray(accounts) || accounts.length === 0) return 0;

  let changed = 0;
  const next = accounts.map(a => {
    if (!a || typeof a !== 'object' || a.openingAt != null) return a;
    changed++;
    return {
      ...a,
      openingBalance: a.openingBalance != null ? a.openingBalance : (Number(a.balance) || 0),
      openingAt: at,
    };
  });

  if (changed > 0) write('accounts', next);
  return changed;
}

function assignAccounts() {
  const expenses = read('expenses', []);
  if (!Array.isArray(expenses) || expenses.length === 0) return 0;

  const accounts = read('accounts', []);
  const tng = (Array.isArray(accounts) ? accounts : [])
    .find(a => a?.id === 'tng' || /touch\s*'?n\s*go|tng/i.test(a?.name ?? ''));
  const tngId = tng?.id ?? 'tng';

  let changed = 0;
  const next = expenses.map(e => {
    if (!e || typeof e !== 'object' || e.accountId != null) return e;
    const method = String(e.paymentMethod ?? '');
    if (method && !/touch\s*'?n\s*go|tng/i.test(method)) return e;
    changed++;
    return { ...e, accountId: tngId };
  });

  if (changed > 0) write('expenses', next);
  return changed;
}

/**
 * v4: install the user's REAL 4-day split.
 *
 * WHY THIS NEEDS A MIGRATION AT ALL
 * `usePersistentState('routines', DEFAULT_ROUTINES)` only reaches for the
 * default when nothing is stored. This user has been training for weeks, so
 * his localStorage holds the four routines the app made up — and shipping a
 * corrected DEFAULT_ROUTINES would have changed precisely nothing on the one
 * device that mattered. The routines had to be replaced where they already sit.
 *
 * WHAT IT TOUCHES, AND WHAT IT REFUSES TO
 * Only routines with a stock id (1-4, the four the app shipped) are replaced,
 * plus the four no-equipment ones are added. A routine the user created himself
 * has a `newId()` id and is left exactly as it is — deleting somebody's own
 * training plan to install one you prefer is not a migration, it's data loss.
 *
 * Logged workout records are NOT touched. They name exercises that no longer
 * appear in any routine ("卧推", "杠铃深蹲"), and that is correct: he did those
 * sets, on those days, and history should say so. The plan changes going
 * forward; the past stays true.
 */
function installRealRoutines() {
  const existing = read('routines', null);
  if (!Array.isArray(existing)) return 0;

  const stock = new Set(STOCK_ROUTINE_IDS);
  const custom = existing.filter(r => r && !stock.has(r.id));
  const next = [...DEFAULT_ROUTINES, ...custom];

  write('routines', next);
  return existing.filter(r => r && stock.has(r.id)).length;
}


/**
 * The cycle `d` falls in, as YYYY-MM-DD. Restates CYCLE_START_DAY rather than
 * importing cycle.js: this file runs at module load before anything else reads
 * storage, and is deliberately kept to zero app imports beyond the routine
 * defaults it installs.
 */
function cycleStartOn(d) {
  const CYCLE_START_DAY = 10;
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (start.getDate() >= CYCLE_START_DAY) start.setDate(CYCLE_START_DAY);
  else { start.setMonth(start.getMonth() - 1); start.setDate(CYCLE_START_DAY); }
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
}

/**
 * v5: fold the waterfall's per-debt monthly rate into the one plan that is real.
 *
 * There were TWO places to say how much you repay a debt each month and they
 * never spoke to each other:
 *
 *   debtPlan.monthly['debt:7']   written by the waterfall in 户口欠款. Fed
 *                                `monthsToClear` and NOTHING ELSE — it changed
 *                                no budget, reserved no money, and the number
 *                                you typed there had no effect on the app.
 *   debt.plan['2026-08-10']      written by 本月. This one is real: cycle.js
 *                                reserves it out of the cycle so a repayment
 *                                is spread across the days instead of gutting
 *                                one of them.
 *
 * Same words, same debt, one of them decorative. That is the "重复且混乱" the
 * user reported, and the fix is to have one — so the decorative value moves
 * into the real one and the waterfall now writes there too.
 *
 * Filed against the CURRENT cycle only. `debt.plan` is deliberately per-cycle
 * ("RM200 this month says nothing about next month" — debts.js), and a standing
 * rate carries no evidence about any month but the one you are in. An existing
 * decision for this cycle is never overwritten: the screen that actually
 * reserved money outranks the one that did not.
 *
 * Reserve entries (`reserve:pbe`) stay in `debtPlan.monthly` — a custodial
 * account's shortfall is not a `debts` row and has no `plan` of its own.
 */
function unifyDebtPlans(cycleStart) {
  const plan = read('debtPlan', null);
  const monthly = plan?.monthly;
  if (!monthly || typeof monthly !== 'object') return 0;

  const debtEntries = Object.entries(monthly).filter(([key]) => key.startsWith('debt:'));
  if (debtEntries.length === 0) return 0;

  const debts = read('debts', []);
  if (!Array.isArray(debts)) return 0;

  let moved = 0;
  const next = debts.map(d => {
    const raw = monthly[`debt:${d.id}`];
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return d;
    // A scheduled debt already knows what it costs this cycle; a rate typed
    // against it was never the figure that mattered.
    if (Array.isArray(d.schedule) && d.schedule.length > 0) return d;
    if (d.plan?.[cycleStart] != null) return d;
    moved++;
    return { ...d, plan: { ...(d.plan ?? {}), [cycleStart]: value } };
  });

  const keptMonthly = Object.fromEntries(
    Object.entries(monthly).filter(([key]) => !key.startsWith('debt:'))
  );

  if (moved > 0) write('debts', next);
  write('debtPlan', { ...plan, monthly: keptMonthly });
  return moved;
}

/**
 * v6: stamp every existing record with its explicit `type`.
 *
 * The kind of a money record was never stored — it was re-derived at each call
 * site from four optional flags and the sign of the amount, and the call sites
 * drifted apart (see the header of the classifier section in accounts.js).
 * Stamping it makes the classification a fact about the record instead of an
 * opinion each screen forms on its own.
 *
 * Uses exactly the same precedence as `txType`, restated rather than imported:
 * this file runs at module load before anything else touches storage and is
 * kept free of app imports. `txType` keeps its derivation permanently anyway —
 * a record can still arrive unstamped from an old backup or a cloud merge long
 * after this has run — so the two must agree, and the order below is the order
 * there. Records already carrying a `type` are left alone.
 */
function stampTypes() {
  const items = read('expenses', []);
  if (!Array.isArray(items) || items.length === 0) return 0;

  let changed = 0;
  const stamped = items.map(e => {
    if (!e || typeof e !== 'object' || typeof e.type === 'string') return e;
    let type;
    if (e.isAccountTransfer) type = 'transfer';
    else if (e.isMoneyIn) type = 'income';
    else if (e.repaysDebtId != null) type = 'repayment';
    else if (e.allocationId != null) type = 'bill';
    else if (Number(e.amount) < 0) type = 'refund';
    else type = 'expense';
    changed++;
    return { ...e, type };
  });

  if (changed > 0) write('expenses', stamped);
  return changed;
}

export function runMigrations() {
  try {
    const current = read('schemaVersion', 1);
    if (current >= SCHEMA_VERSION) return null;

    // Fall back to today only when there is no recorded last-active day.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const loggedOn = read('lastActiveDate', today) || today;

    // Order matters throughout: seed an account to file against, file the
    // expenses, then baseline — so nothing just filed is subtracted from a
    // balance that already accounted for it.
    const migratedAt = Date.now();
    const result = {
      meals: stampDates('meals', loggedOn),
      workouts: stampDates('workouts', loggedOn),
      expenses: stampDates('expenses', loggedOn),
      accountsSeeded: seedAccounts(migratedAt),
      accountsAssigned: assignAccounts(),
      accountsBaselined: baselineAccounts(migratedAt),
      routinesReplaced: installRealRoutines(),
      debtPlansUnified: unifyDebtPlans(cycleStartOn(now)),
      typesStamped: stampTypes(),
    };

    write('schemaVersion', SCHEMA_VERSION);

    const total = result.meals + result.workouts + result.expenses
      + result.accountsSeeded + result.accountsAssigned + result.accountsBaselined
      + result.routinesReplaced + result.debtPlansUnified + result.typesStamped;
    if (total > 0) {
      console.info(`LifeManager: migrated ${total} records to the dated schema`, result);
    }
    return result;
  } catch (e) {
    // A failed migration must not stop the app booting — the worst case is
    // undated records, which the date filter treats as "not today" rather than
    // deleting.
    console.warn('Schema migration failed', e);
    return null;
  }
}
