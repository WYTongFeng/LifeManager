import React, { useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, X, CalendarClock, ArrowDownToLine,
  ArrowUpFromLine, Lock, Check, AlertTriangle, Banknote,
} from '../utils/icons';
import { useLiveJSON, useToday, saveJSON, loadJSON } from '../utils/storage';
import { num, newId } from '../utils/num';
import { describeDate } from '../utils/datetime';
import {
  getCycle, computeCycleBudget, isInCycle, getPreviousCycle, grossSpentByDayIndex,
} from '../utils/cycle';
import {
  FREQUENCIES, frequencyMeta, normalizeAllocation, cycleCost, isEstimated,
  nextDueDate, daysUntilDue, upcoming,
} from '../utils/recurring';
import { nextInstalment } from '../utils/networth';
import { debtsForCycle, setCyclePlan, makeRepayment } from '../utils/debts';
import { resolveAccounts, defaultAccount, accountById, isRealSpend } from '../utils/accounts';
import { AccountSelect, AccountChip } from './AccountPicker';
import ImpulseSandbox from './ImpulseSandbox';
import SpendPie from './SpendPie';
import { ownSpendById, ownSpend } from '../utils/projects';
import {
  CATEGORY_PREFS_KEY, categoryLabel, resolveCategoryId,
} from '../utils/moneyCategories';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
  color: 'white', marginTop: '4px', fontSize: '0.85rem',
};
const labelStyle = { fontSize: '0.78rem', color: 'var(--text-secondary)' };
const money = (n) => `RM ${num(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Prefilled into a number input, where 246.05999999999997 would be absurd.
const round2 = (n) => Math.round(num(n) * 100) / 100;

const INCOME_KINDS = [
  { value: 'income', label: '真收入 — 可以花' },
  { value: 'passthrough', label: '代收代付 — 不可花' },
];

/**
 * The payday router: what came in, what's already spoken for, and what that
 * leaves per day for the rest of the cycle.
 *
 * The daily figure is derived, never typed. A budget you set yourself is a wish;
 * this one is arithmetic on money that actually exists.
 */
export default function CycleView({ expenses = [], onApproveExpense, onAddExpense }) {
  // Live-read + saveJSON, not usePersistentState. Both keys have a second
  // writer now: 记账 files an arrival against an income source, and marks a
  // logged payment as a fixed bill. Two usePersistentState instances for one
  // key drift apart until one of them remounts — see storage.js, and the
  // accounts/debts keys below, which are on this pattern for the same reason.
  const incomeSources = useLiveJSON('incomeSources', []);
  const setIncomeSources = (next) => saveJSON('incomeSources',
    typeof next === 'function' ? next(loadJSON('incomeSources', [])) : next);
  const allocations = useLiveJSON('allocations', []);
  const setAllocations = (next) => saveJSON('allocations',
    typeof next === 'function' ? next(loadJSON('allocations', [])) : next);
  // Debts are edited in 户口欠款 AND here (this cycle's repayment plan), so they
  // go through the single-write-path pattern rather than a second
  // usePersistentState instance that would drift from the other screen's.
  const debts = useLiveJSON('debts', []);
  const setDebts = (next) => saveJSON('debts', next);
  const rawAccounts = useLiveJSON('accounts', []);
  const accounts = useMemo(() => resolveAccounts(rawAccounts, expenses), [rawAccounts, expenses]);

  const [incomeModal, setIncomeModal] = useState(false);
  const [allocModal, setAllocModal] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [fLabel, setFLabel] = useState('');
  const [fAmount, setFAmount] = useState('');
  const [fKind, setFKind] = useState('income');
  const [fVariable, setFVariable] = useState(false);
  // Everything the old model had no room for: when it comes out, how often,
  // from which account, and whether an annual cost should be reserved monthly.
  const [fFrequency, setFFrequency] = useState('monthly');
  const [fDueDay, setFDueDay] = useState('1');
  const [fDueMonth, setFDueMonth] = useState('1');
  const [fOnceDate, setFOnceDate] = useState('');
  const [fAccountId, setFAccountId] = useState(null);
  const [fCosting, setFCosting] = useState('due');
  // 必要 / 非必要 — not a label. It splits 固定开销 into 一定要付 and 可以砍,
  // and the 现在能花 figure in 户口欠款 says what cutting the optional ones
  // would free up. See computeSpendable in networth.js.
  const [fEssential, setFEssential] = useState(true);

  // Confirming this cycle's real bill for a variable allocation is a separate,
  // much more frequent action than editing the allocation itself (label,
  // whether it's variable at all) — so it gets its own small modal rather than
  // being buried as one more field in the edit form.
  const [actualFor, setActualFor] = useState(null);
  const [fActual, setFActual] = useState('');

  // Keyed on the live date, never `[]`. Everything on this screen is derived
  // from `cycle`, including the daily safe limit's divisor (`daysRemaining`),
  // so a cycle frozen at mount hands out a stale allowance every day the app
  // stays open — and once the month turns it budgets the wrong cycle entirely.
  // See useToday() in storage.js.
  // `todayStr` is a dependency the body never reads on purpose: getCycle()
  // takes the clock itself, so the date is the cache key. The linter reports it
  // as unnecessary — dropping it restores the frozen-at-mount bug.
  const todayStr = useToday();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cycle = useMemo(() => getCycle(), [todayStr]);

  // Every debt with this cycle's figures resolved: what it wants, what you've
  // actually paid, what's left. One call so this screen and 户口欠款 can't
  // disagree about what "还了多少" means. See debts.js.
  const debtRows = useMemo(() => debtsForCycle(debts, expenses, cycle), [debts, expenses, cycle]);

  // Debt reserved out of this cycle's budget, BOTH kinds.
  //
  // It used to be instalments only, which meant a debt without a schedule
  // touched the budget in no way whatsoever — you could owe someone RM500,
  // decide to clear RM200 of it this month, and the app would keep offering a
  // daily allowance built on money that was already spoken for.
  //
  // Reserving is what makes a repayment spread across the cycle instead of
  // cratering one day, which is what the user asked for: "月头就先拿一笔钱还
  // 这个月的...是每一天花的钱变少". `reserved` is the larger of planned and
  // already-paid, so paying early is reflected rather than under-counted.
  const autoAllocations = useMemo(() => debtRows
    .filter(r => r.reserved > 0)
    .map(r => ({
      id: `debt:${r.debt.id}`,
      label: r.fixed ? `${r.debt.creditor} 分期` : `${r.debt.creditor} 还款`,
      amount: r.reserved, resolvedAmount: r.reserved,
      // Pre-resolved so computeCycleBudget doesn't have to know that a debt
      // isn't a recurring bill — see cycle.js.
      budgeted: r.reserved, charged: r.reserved,
      due: r.fixed ? nextInstalment(r.debt)?.due ?? null : null,
      accountId: r.debt.accountId ?? null,
      estimated: false, auto: true,
      // "Paid" here is derived from real repayments, not a checkbox — the
      // money either moved or it didn't.
      paid: r.repaid >= r.reserved,
      debtId: r.debt.id, repaid: r.repaid, planned: r.planned, fixed: r.fixed,
    })), [debtRows]);

  // `paidFor` stores which cycle a commitment was settled for, so "paid" clears
  // itself every payday instead of needing a manual reset. `budgeted`/`charged`
  // fold in the frequency and fixed/variable splits (recurring.js) so the render
  // code below never has to branch on which kind of bill it's looking at.
  //
  // `budgeted` ≠ `charged` on purpose for an annual bill set to be spread: it
  // reserves a slice every cycle but only actually leaves the account once a
  // year, and the screen shows both because both are true.
  const manualAllocations = useMemo(() => allocations.map(raw => {
    const a = normalizeAllocation(raw);
    const cost = cycleCost(a, cycle);
    return {
      ...a,
      paid: a.paidFor === cycle.start,
      resolvedAmount: cost.per,
      budgeted: cost.budgeted,
      charged: cost.charged,
      dueDates: cost.dates,
      spread: cost.spread,
      estimated: isEstimated(a, cycle),
      nextDue: nextDueDate(a),
      daysUntil: daysUntilDue(a),
    };
  }), [allocations, cycle]);

  const allAllocations = [...autoAllocations, ...manualAllocations];

  // One merged calendar of everything leaving an account this cycle. Bills and
  // debt instalments were two separate lists the user had to interleave in
  // their head to answer "what's coming out and when".
  const upcomingPayments = useMemo(
    () => upcoming(allocations, cycle, {
      // Only debts with a real due date belong on a calendar. A flexible
      // repayment has no date — you pay it when you pay it — and inventing one
      // would put a deadline on the screen that nobody set.
      extra: autoAllocations.filter(a => a.due).map(a => ({
        id: a.id, label: a.label, amount: a.amount, due: a.due,
        accountId: a.accountId, kind: 'debt',
      })),
      limit: 14,
    }),
    [allocations, cycle, autoAllocations]
  );

  const budget = useMemo(
    () => computeCycleBudget({ incomeSources, allocations: allAllocations, expenses, cycle }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [incomeSources, manualAllocations, autoAllocations, expenses, cycle]
  );

  // Average pace, for "am I on track" without doing the division in your head.
  const avgDailySpend = budget.grossSpentThisCycle / (cycle.dayIndex + 1);

  // Fair "vs last cycle" comparison: last cycle's spend up to the SAME day
  // index, not its final total — a cycle that isn't over yet will always look
  // artificially good against one that ran its full length.
  const previousCycle = useMemo(() => getPreviousCycle(cycle), [cycle]);
  const previousCycleSpendSoFar = useMemo(
    () => grossSpentByDayIndex(expenses, previousCycle, cycle.dayIndex),
    [expenses, previousCycle, cycle.dayIndex]
  );
  // Only shown once there's actually history predating this cycle — otherwise
  // "spent RM0 less than last cycle" reads as an achievement when really
  // there's just no data to compare against.
  const hasPriorHistory = expenses.some(e => (e.date ?? '') < cycle.start);
  const vsLastCycle = budget.grossSpentThisCycle - previousCycleSpendSoFar;

  // Cycle-scoped category breakdown — the existing "Spend by Category" card
  // elsewhere in Money only covers today, so a month in progress had nowhere
  // to show where its money actually went. Refunds are excluded from the
  // denominator and the slices themselves for the same reason M18 excludes
  // them from the daily breakdown: a negative slice reads as confusing, not
  // informative.
  // The user's own category names, so a rename in 管理分类 reaches the chart.
  const categoryPrefs = useLiveJSON(CATEGORY_PREFS_KEY, null);
  // Shared by the slices and their drill-down rows, so the two can't disagree.
  const cycleOwnSpendMap = useMemo(() => ownSpendById(expenses), [expenses]);

  const cycleCategoryBreakdown = useMemo(() => {
    // `!isAccountTransfer` matters here: the +X half of a transfer between your
    // own accounts is not a purchase, and would otherwise show up as a
    // "Transfer" category slice inflating the month's spend.
    // `repaysDebtId == null` — a repayment is NOT a spending category, and
    // counting it here charged the same ringgit to the circle twice: once
    // inside 「SPayLater 分期」 (the reservation autoAllocations contributes)
    // and again as a 「还款」 slice of its own. The month then read RM649.90
    // against RM549.90 of real claims.
    //
    // It also disagreed with the headline it sits under: `grossSpentThisCycle`
    // in cycle.js has always excluded repayments, on the grounds that debt is
    // not shopping and a month that cleared RM800 of SPayLater should not read
    // as a month of overspending. This chart never got the same treatment.
    const positive = expenses.filter(e =>
      isRealSpend(e) && isInCycle(e.date ?? cycle.start, cycle) && Number(e.amount) > 0);
    // A closed project counts only the share nobody paid back. Built from the
    // FULL list, not this cycle's slice: a repayment can land in a later cycle
    // than the dinner it settles, and filtering first would make the project
    // look unrepaid. See projects.js.
    const ownSpendMap = cycleOwnSpendMap;
    const totals = Object.values(
      positive.reduce((acc, e) => {
        const key = resolveCategoryId(e.category, 'expense');
        // `records` is what makes the chart openable. A category total answers
        // "how much on food" and nothing else; the question actually being
        // asked is "on WHAT", and that needs the rows.
        if (!acc[key]) acc[key] = { category: key, total: 0, records: [] };
        acc[key].total += ownSpend(e, ownSpendMap);
        acc[key].records.push(e);
        return acc;
      }, {})
    );
    // Newest first inside a category — the recent ones are the ones you're
    // trying to recognise.
    for (const t of totals) {
      t.records.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.at ?? 0) - (a.at ?? 0));
    }
    return totals.sort((a, b) => b.total - a.total);
  }, [expenses, cycle, cycleOwnSpendMap]);

  // "我的钱去哪里了" — the whole cycle in one circle, not just the shopping.
  //
  // Fixed commitments and debt were the biggest things happening to this
  // user's money and they lived in a different section entirely, so a chart of
  // where it went that showed only the day-to-day categories was a chart of the
  // small half. Everything that has a claim on the cycle's income goes in:
  // bills, debt, each spending category, and what is still unspent.
  //
  // The unspent slice is what makes the rest readable. Without it the circle
  // always reads "100% of what you spent", which is true every month and says
  // nothing; with it, a slice is a share of the money that actually existed.
  const moneyFlow = useMemo(() => {
    const slices = [
      ...manualAllocations.map(a => ({
        key: `alloc:${a.id}`,
        label: a.label,
        // `budgeted`, not `charged`: this is what the cycle set aside, which is
        // what shrank the daily allowance. An annual bill being spread has
        // taken its slice out of this month even though nothing leaves today.
        value: num(a.budgeted),
      })),
      ...autoAllocations.map(a => ({ key: a.id, label: a.label, value: num(a.amount) })),
      ...cycleCategoryBreakdown.map(c => ({
        key: `cat:${c.category}`,
        // The category's own name, in Chinese, resolved through the same table
        // the pickers use — so a renamed category is renamed here too, and an
        // old record's "Food & Dining" reads as 餐饮 without being rewritten.
        label: categoryLabel(c.category, 'expense', categoryPrefs),
        value: c.total,
        items: c.records.map(e => ({
          id: e.id,
          label: e.merchant || '未命名',
          // Date and note, because a bare shop name three weeks later is often
          // not enough to recognise a charge — which is the entire reason this
          // drill-down was asked for.
          sub: [describeDate(e.date ?? cycle.start, todayStr), e.note].filter(Boolean).join(' · '),
          // The row shows what this user paid, matching its slice — a closed
          // project's row would otherwise read RM100 inside a RM25 slice.
          amount: ownSpend(e, cycleOwnSpendMap),
        })),
      })),
    ];
    // Overspent cycles have nothing left over, and a negative slice is not a
    // shape a pie can draw. The circle then simply shows where it all went.
    if (budget.available > 0) {
      slices.push({ key: '__left', label: '还没花', value: budget.available, muted: true });
    }
    return slices;
  }, [manualAllocations, autoAllocations, cycleCategoryBreakdown, budget.available,
    cycle.start, todayStr, categoryPrefs, cycleOwnSpendMap]);

  // --- debt: this cycle's plan, and logging a repayment ---------------------
  //
  // The plan input is a draft rather than a direct write, so typing "2" on the
  // way to "200" doesn't briefly reserve RM2 and make the daily allowance jump
  // around under the user's fingers. Committed on blur.
  const [planDrafts, setPlanDrafts] = useState({});
  const clearDraft = (debtId) => setPlanDrafts(p => {
    const next = { ...p };
    delete next[debtId];
    return next;
  });
  const commitPlan = (debtId) => {
    const draft = planDrafts[debtId];
    if (draft === undefined) return;
    // An empty box is "no decision", which for a scheduled debt hands the cycle
    // back to the instalment table. Anything typed — 0 included — is an answer,
    // and `setCyclePlan` stores it as one. See debts.js.
    const value = String(draft).trim() === '' ? null : num(draft);
    setDebts(setCyclePlan(loadJSON('debts', []), debtId, cycle.start, value));
    clearDraft(debtId);
  };
  // Back to whatever the instalment table says. Only offered where there IS a
  // table — a flexible debt has nothing to fall back to.
  const resetPlan = (debtId) => {
    setDebts(setCyclePlan(loadJSON('debts', []), debtId, cycle.start, null));
    clearDraft(debtId);
  };

  const [repayFor, setRepayFor] = useState(null);
  const [repayAmount, setRepayAmount] = useState('');
  const [repayAccountId, setRepayAccountId] = useState(null);
  const [repayNote, setRepayNote] = useState('');
  // WHEN the money actually left. `makeRepayment` has always accepted a date;
  // this form never asked, so every repayment was stamped "now".
  //
  // That mattered because of how this user's money actually arrives: "我的钱
  // 什么时候进来是不固定的，我可能提前还，也可能之后才还". The statistical
  // cycle is the calendar month and stays that — but the DAY he pays is his,
  // and a repayment filed on the wrong day lands in the wrong cycle's 本月已还
  // and moves the wrong day's account balance.
  const [repayDate, setRepayDate] = useState(todayStr);

  const openRepay = (row) => {
    setRepayFor(row);
    // Prefilled with what's left of this cycle's plan — the answer most of the
    // time — but it is an editable default, not a fixed amount. Falling back to
    // blank rather than the whole outstanding balance: offering to clear an
    // entire debt by default is not a suggestion, it's a trap.
    setRepayAmount(row.remainingThisCycle > 0 ? String(round2(row.remainingThisCycle)) : '');
    setRepayAccountId(row.debt.accountId ?? defaultAccount(accounts)?.id ?? null);
    setRepayNote('');
    setRepayDate(todayStr);
  };
  const closeRepay = () => { setRepayFor(null); setRepayAmount(''); setRepayNote(''); };

  const submitRepay = (e) => {
    e.preventDefault();
    const amount = num(repayAmount);
    if (!repayFor || amount <= 0) return;
    // `at` has to move with the date, not stay at "now": accounts.js compares
    // it against an account's reconcile watermark, so a back-dated repayment
    // stamped with the current time would be counted against a balance that
    // was already corrected past it. Same rule the expense form follows.
    const date = repayDate || todayStr;
    const [yy, mm, dd] = date.split('-').map(Number);
    const now = new Date();
    const at = date === todayStr
      ? now.getTime()
      : new Date(yy, mm - 1, dd, 12, 0).getTime();
    onAddExpense?.(makeRepayment({
      debt: repayFor.debt,
      amount,
      accountId: repayAccountId,
      accountName: accountById(accounts, repayAccountId)?.name ?? null,
      note: repayNote.trim(),
      at,
      date,
    }));
    closeRepay();
  };

  const resetForm = () => {
    setEditingId(null); setFLabel(''); setFAmount(''); setFKind('income'); setFVariable(false);
    setFFrequency('monthly'); setFDueDay('1'); setFDueMonth('1'); setFOnceDate('');
    setFAccountId(defaultAccount(accounts)?.id ?? null); setFCosting('due');
    setFEssential(true);
  };

  const submitIncome = (e) => {
    e.preventDefault();
    const amount = Number(fAmount);
    if (!fLabel.trim() || !Number.isFinite(amount) || amount <= 0) return;
    const payload = { label: fLabel.trim(), amount, kind: fKind };
    setIncomeSources(editingId
      ? incomeSources.map(s => (s.id === editingId ? { ...s, ...payload } : s))
      : [...incomeSources, { id: newId(), ...payload }]);
    resetForm(); setIncomeModal(false);
  };

  const submitAlloc = (e) => {
    e.preventDefault();
    const amount = Number(fAmount);
    if (!fLabel.trim() || !Number.isFinite(amount) || amount <= 0) return;
    if (fFrequency === 'once' && !fOnceDate) return;

    // `variable` decides which field the cost resolver reads (see recurring.js);
    // the unused one is left alone rather than deleted, so flipping the toggle
    // back and forth doesn't throw away a previously entered estimate/amount.
    const money = fVariable
      ? { variable: true, estimate: amount }
      : { variable: false, amount };

    const payload = {
      label: fLabel.trim(),
      ...money,
      frequency: fFrequency,
      // Weekly stores a day of the WEEK here, everything monthly-or-longer a
      // day of the month — one field, because a bill only ever has one kind of
      // recurrence and two fields would let them contradict each other.
      dueDay: Number(fDueDay),
      dueMonth: ['quarterly', 'halfyearly', 'yearly'].includes(fFrequency) ? Number(fDueMonth) : null,
      onceDate: fFrequency === 'once' ? fOnceDate : null,
      accountId: fAccountId,
      costing: fCosting,
      essential: fEssential,
    };

    setAllocations(editingId
      ? allocations.map(a => (a.id === editingId ? { ...a, ...payload } : a))
      : [...allocations, { id: newId(), ...payload, paidFor: null, actuals: {} }]);
    resetForm(); setAllocModal(false);
  };

  // Changing the frequency changes what the other fields even mean, so the
  // defaults move with it: a weekly bill's "day" is a weekday, and a
  // yearly one defaults to being reserved monthly rather than dropped whole
  // on whichever cycle it happens to land in.
  // What "set aside monthly" actually works out to for the amount currently
  // typed in the form — shown on the option itself, because "spread it" means
  // nothing until you see the ringgit figure it turns into.
  const perYear = { quarterly: 4, halfyearly: 2, yearly: 1 }[fFrequency] ?? 12;
  const perCycleReserve = ((Number(fAmount) || 0) * perYear) / 12;

  const changeFrequency = (value) => {
    setFFrequency(value);
    if (value === 'weekly') setFDueDay('1');
    else if (fFrequency === 'weekly') setFDueDay('1');
    setFCosting(['quarterly', 'halfyearly', 'yearly'].includes(value) ? 'spread' : 'due');
  };

  const submitActual = (e) => {
    e.preventDefault();
    const amount = Number(fActual);
    if (!Number.isFinite(amount) || amount <= 0 || !actualFor) return;
    setAllocations(allocations.map(a => (a.id === actualFor.id
      ? { ...a, actuals: { ...(a.actuals || {}), [cycle.start]: amount } }
      : a)));
    setActualFor(null); setFActual('');
  };

  const togglePaid = (a) => {
    setAllocations(allocations.map(x =>
      x.id === a.id ? { ...x, paidFor: x.paidFor === cycle.start ? null : cycle.start } : x));
  };

  const hasSetup = incomeSources.length > 0 || allAllocations.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Always visible, unlike the daily-limit card below — that one needs
          income + allocations set up before it can compute anything, but "how
          much came in and went out this cycle" is answerable from day one,
          purely from the expense log, and shouldn't hide behind setup. */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

        {/* THE VERDICT, FIRST.
            This card used to open with 「本月总收入」 in large green type — a
            number that comes from a setting, not from anything that happened —
            and never once said whether the month was up or down. In a month the
            user knew he had lost money, the screen led with a big positive
            figure. The arithmetic was right and the reading was wrong.
            So: net first, and the three numbers it is made of underneath. */}
        {hasSetup && (
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              这个月到现在 · {budget.inDeficit ? '亏了' : '还剩'}
            </div>
            <div style={{
              fontSize: '1.9rem', fontWeight: '800', lineHeight: 1.1,
              color: budget.inDeficit ? 'var(--color-accent-red)' : 'var(--color-money)',
            }}>
              {budget.inDeficit ? '−' : ''}{money(Math.abs(budget.netThisCycle))}
            </div>
            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '3px', lineHeight: 1.5 }}>
              收入 {money(budget.spendableIncome)} − 固定开销 {money(budget.committed)} − 已经花的 {money(budget.spentThisCycle)}
              {budget.inDeficit ? ' · 超了' : ''}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '1.75rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>收入（设定）</div>
            <div style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--color-money)' }}>
              {money(budget.spendableIncome)}
            </div>
            {/* The setting and the reality, side by side, but only when they
                actually disagree — printing "arrived RM2,000 of RM2,000" every
                month is noise that teaches you to stop reading the line. */}
            {budget.arrivedThisCycle > 0 && Math.abs(budget.arrivedThisCycle - budget.spendableIncome) > 0.01 && (
              <div style={{ fontSize: '0.62rem', color: 'var(--color-accent-amber)', marginTop: '2px' }}>
                实际进账 {money(budget.arrivedThisCycle)}
              </div>
            )}
            {budget.receivedThisCycle > 0 && (
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                另收 {money(budget.receivedThisCycle)}（还款/礼金）
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>固定开销</div>
            <div style={{ fontSize: '1.1rem', fontWeight: '800' }}>
              {money(budget.committed)}
            </div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              房租/订阅/还款
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>花掉的</div>
            <div style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--color-accent-red)' }}>
              {money(budget.grossSpentThisCycle)}
            </div>
            {budget.repaidThisCycle > 0 && (
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                另还债 {money(budget.repaidThisCycle)}
              </div>
            )}
          </div>
        </div>

        {/* The bar now measures spend AND fixed commitments against income —
            it used to show only day-to-day spending, so a month whose rent and
            debt had already eaten 80% of the income displayed a comfortable
            little green sliver. */}
        {budget.spendableIncome > 0 && (() => {
          const used = budget.committed + budget.spentThisCycle;
          const pct = (used / budget.spendableIncome) * 100;
          const pctOf = (v) => Math.max(0, Math.min((v / budget.spendableIncome) * 100, 100));
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.66rem', color: 'var(--text-muted)', marginBottom: '3px' }}>
                <span>本月收入已用 {Math.round(pct)}%（含固定开销）</span>
                <span>{money(used)} / {money(budget.spendableIncome)}</span>
              </div>
              <div style={{ height: '6px', background: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', display: 'flex', overflow: 'hidden' }}>
                {/* Two segments, so "committed" and "spent" stay legible as
                    separate facts rather than one undifferentiated bar. */}
                <div style={{
                  height: '100%', width: `${pctOf(budget.committed)}%`,
                  background: 'var(--color-accent-amber)', transition: 'width 0.5s ease',
                }} />
                <div style={{
                  height: '100%', width: `${pctOf(budget.spentThisCycle)}%`,
                  background: pct > 100 ? 'var(--color-accent-red)' : 'var(--color-money)',
                  transition: 'width 0.5s ease',
                }} />
              </div>
              <div style={{ display: 'flex', gap: '12px', fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                <span><span style={{ color: 'var(--color-accent-amber)' }}>■</span> 固定开销</span>
                <span><span style={{ color: pct > 100 ? 'var(--color-accent-red)' : 'var(--color-money)' }}>■</span> 花掉的</span>
              </div>
            </div>
          );
        })()}

        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>每日平均 Avg/day</div>
            <div style={{ fontSize: '0.85rem', fontWeight: '700' }}>{money(avgDailySpend)}</div>
          </div>
          {hasPriorHistory && (
            <div>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                跟上个周期比（到第 {cycle.dayIndex + 1} 天为止）
              </div>
              <div style={{ fontSize: '0.85rem', fontWeight: '700', color: vsLastCycle > 0 ? 'var(--color-accent-red)' : 'var(--color-money)' }}>
                {vsLastCycle > 0 ? `多花 ${money(vsLastCycle)}` : vsLastCycle < 0 ? `少花 ${money(Math.abs(vsLastCycle))}` : '一样'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cycle-scoped category breakdown — where the month's money actually
          went, not just the flat total above. */}
      {moneyFlow.length > 0 && (
        <div className="glass-card">
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block' }}>
            钱去哪里了 Where it went
          </span>
          <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', margin: '4px 0 12px', lineHeight: 1.5 }}>
            这个月的钱全部在这里：固定开销、欠款、每一类花费，还有还没花的。
            <strong style={{ color: 'var(--color-money)' }}>点一类可以打开，看到每一笔。</strong>
          </p>
          <SpendPie
            slices={moneyFlow}
            // In a deficit month the circle's total is MORE than the income —
            // that is what a deficit is — so labelling the hole 「本月总收入」
            // put a number there that contradicted the ring around it.
            centerLabel={budget.inDeficit ? '这个月支出' : '本月总收入'}
            centerValue={budget.inDeficit
              ? null
              : (budget.spendableIncome > 0 ? budget.spendableIncome : null)}
          />
          {budget.inDeficit && (
            <p style={{ fontSize: '0.66rem', color: 'var(--color-accent-red)', marginTop: '10px', lineHeight: 1.5 }}>
              这个圈比收入还大 — 超出 {money(Math.abs(budget.netThisCycle))}，就是这个月亏的部分。
            </p>
          )}
        </div>
      )}

      {/* THE DAILY LIMIT, DEMOTED.
          This was the card the whole screen was built around: 2.2rem, glowing
          border, top billing. Module 1 of the original firewall spec.

          The user's verdict after living with it: "你其实不太需要复杂的 Daily
          Safe Limit / Daily Cap. 你真正需要的是「现在我到底还剩多少钱可以花？」
          ...不要为了做一个「看起来很专业」的数字，把系统搞复杂".

          He is right about what it was doing. An average that moves every time
          income or spending moves is not a limit you can plan against, and
          giving it top billing implied it was the answer to a question he was
          never asking. It is not deleted — it still does one useful job, which
          is stopping a single day from eating the month — it is just no longer
          pretending to be the point. The number he does want lives in 户口欠款
          as 「现在能花」, which is cash that exists rather than income ÷ days. */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            今天还可以花
          </span>
          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <CalendarClock size={11} /> 周期 {cycle.start} → {cycle.end}（第 {cycle.dayIndex + 1} / {cycle.totalDays} 天）
          </span>
        </div>

        {hasSetup ? (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '1.35rem', fontWeight: '800', lineHeight: 1.1,
                color: budget.todayRemaining < 0 ? 'var(--color-accent-red)' : 'var(--color-money)',
              }}>
                {budget.todayRemaining < 0
                  ? `−${money(Math.abs(budget.todayRemaining))}`
                  : money(budget.todayRemaining)}
              </span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                今天已花 {money(budget.spentToday)} · 每天平均可以花 {money(budget.dailySafeLimit)}（还剩 {cycle.daysRemaining} 天）
              </span>
            </div>

            <div style={{ display: 'flex', gap: '1.1rem', flexWrap: 'wrap' }}>
              {[
                ['可花收入', budget.spendableIncome, 'var(--color-money)'],
                ['固定支出', budget.committed, 'var(--color-diet)'],
                ['本周期已花', budget.spentThisCycle, 'var(--text-primary)'],
                ['剩下', budget.available, budget.available < 0 ? 'var(--color-accent-red)' : 'var(--color-money)'],
              ].map(([label, value, color]) => (
                <div key={label}>
                  <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>{label}</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: '700', color }}>{money(value)}</div>
                </div>
              ))}
            </div>

            <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
              这是<strong>这个周期的收入</strong>还剩多少，摊到剩下的日子。
              想知道「户口里现在真的有多少能花」，看「户口欠款」那页。
            </p>

            {budget.passthrough > 0 && (
              <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', lineHeight: 1.5, display: 'flex', gap: '5px', margin: 0 }}>
                <Lock size={11} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>另有 {money(budget.passthrough)} 是代收代付 — 没有算进可花额度。</span>
              </p>
            )}

            {budget.overspent && (
              <div style={{
                padding: '0.6rem 0.7rem',
                background: 'var(--color-accent-red-soft)', border: '1px solid var(--color-accent-red)',
                borderRadius: 'var(--radius-sm)', display: 'flex', gap: '7px', alignItems: 'flex-start',
              }}>
                <AlertTriangle size={14} color="var(--color-accent-red)" style={{ flexShrink: 0, marginTop: '1px' }} />
                <span style={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
                  这个周期已经超支 <strong>{money(Math.abs(budget.available))}</strong>。
                  这个月还剩 {cycle.daysRemaining} 天。
                </span>
              </div>
            )}
          </>
        ) : (
          <p style={{ fontSize: '0.73rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
            先加收入和固定支出，这个数字才算得出来。
          </p>
        )}
      </div>

      {/* Module 2: the impulse sandbox. Placed right after the headline number
          it borrows math from (projectImpact reads this same `budget`/`cycle`),
          and before income/bills — deciding whether to spend comes first. */}
      {onApproveExpense && <ImpulseSandbox budget={budget} cycle={cycle} onApprove={onApproveExpense} accounts={accounts} />}

      {/* Income.
          Each source now shows the SETTING and what actually landed against it,
          because they are one system: filing an arrival under a source is what
          makes the month's income move. Before this the two never met — you
          could log RM1,000 arriving and 本月收入 would not change by a sen. */}
      <Section
        icon={<ArrowDownToLine size={17} color="var(--color-money)" />}
        title="收入 Income"
        onAdd={() => { resetForm(); setIncomeModal(true); }}
        empty={incomeSources.length === 0 && '还没有收入来源。加一个（工作收入、房租、朋友还钱…），记账那边记的进账就能归到这里。'}
      >
        {(budget.incomeBreakdown ?? []).map(row => {
          const s = incomeSources.find(x => x.id === row.id) ?? row;
          const pass = row.kind === 'passthrough';
          return (
            <Row
              key={row.id}
              title={row.label}
              subtitle={
                <>
                  {pass ? '代收代付 · 不可花' : '可以花'}
                  {row.landed
                    ? <> · 已收到 {money(row.arrived)}
                        {/* Only after something lands. Before that, "short by
                            the whole amount" just means it has not come yet. */}
                        {row.shortfall > 0.005 && (
                          <strong style={{ color: 'var(--color-accent-red)' }}> · 少了 {money(row.shortfall)}</strong>
                        )}
                        {row.shortfall < -0.005 && (
                          <strong style={{ color: 'var(--color-money)' }}> · 多了 {money(-row.shortfall)}</strong>
                        )}
                      </>
                    : <> · 预计 {money(row.expected)}，还没到</>}
                </>
              }
              subtitleColor={pass ? 'var(--color-diet)' : 'var(--text-muted)'}
              // The figure that actually counts this cycle — the real one once
              // it has landed, the expectation until then.
              amount={money(row.counted)}
              amountColor={pass ? 'var(--text-muted)' : 'var(--color-money)'}
              dashed={pass || !row.landed}
              onEdit={() => {
                setEditingId(s.id); setFLabel(s.label);
                setFAmount(String(s.amount)); setFKind(s.kind); setIncomeModal(true);
              }}
              onDelete={() => setIncomeSources(incomeSources.filter(x => x.id !== row.id))}
            />
          );
        })}

        {/* Money that landed and was filed under nothing. It is NOT added to
            the budget — it may well be the salary already listed above, and
            adding it would count the same ringgit twice. Naming the gap is the
            fix; guessing at it is not. See computeCycleBudget. */}
        {budget.arrivedUnlinked > 0.005 && (
          <div style={{
            padding: '0.6rem 0.7rem', borderRadius: 'var(--radius-sm)',
            background: 'var(--color-accent-amber-soft)',
            border: '1px solid var(--color-accent-amber)',
            fontSize: '0.7rem', lineHeight: 1.55,
          }}>
            这个周期有 <strong style={{ color: 'var(--color-accent-amber)' }}>{money(budget.arrivedUnlinked)}</strong> 进账没有归类，
            所以<strong>没有算进上面的收入</strong> —— 因为它可能就是上面某一笔，算两次会让你以为钱比较多。
            去「今天」点开那笔进账，选一个来源，它就会自动算进这个月。
          </div>
        )}
      </Section>

      {/* What's coming out, and when. The single biggest thing the old model
          could not express: a "fixed monthly fee" was a number with no date on
          it, so the app could tell you RM 1,240 was committed and still not
          say that RM 500 of it leaves tomorrow. Bills and debt instalments are
          merged into one date-ordered list — they leave the same accounts on
          the same calendar, and splitting them made the user do the merge. */}
      {upcomingPayments.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '0.7rem' }}>
            <CalendarClock size={17} color="var(--color-diet)" />
            <h3 style={{ fontSize: '1rem', fontWeight: '700' }}>本期扣款日 Upcoming</h3>
          </div>
          <div className="glass-card" style={{ padding: '0.6rem 0.75rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {upcomingPayments.map((u, i) => {
                const passed = u.due < todayStr;
                const isToday = u.due === todayStr;
                const day = Number(u.due.slice(8, 10));
                const month = Number(u.due.slice(5, 7));
                return (
                  <div key={u.id} style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '0.5rem 0.15rem',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border-glass)',
                    opacity: passed ? 0.45 : 1,
                  }}>
                    <div style={{
                      flexShrink: 0, width: '38px', textAlign: 'center',
                      borderRadius: 'var(--radius-sm)', padding: '3px 0',
                      background: isToday ? 'var(--color-accent-red-soft)' : 'var(--bg-input)',
                      border: `1px solid ${isToday ? 'var(--color-accent-red)' : 'var(--border-glass)'}`,
                    }}>
                      <div style={{
                        fontSize: '0.82rem', fontWeight: '800', lineHeight: 1.1,
                        color: isToday ? 'var(--color-accent-red)' : 'var(--text-primary)',
                      }}>
                        {day}
                      </div>
                      <div style={{ fontSize: '0.52rem', color: 'var(--text-muted)' }}>{month}月</div>
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        {u.label}
                        {u.kind === 'debt' && (
                          <span style={{ fontSize: '0.56rem', fontWeight: '800', color: 'var(--color-accent-red)' }}>分期</span>
                        )}
                        {u.estimated && (
                          <span style={{ fontSize: '0.56rem', fontWeight: '800', color: 'var(--color-diet)' }}>预估</span>
                        )}
                      </div>
                      <div style={{ marginTop: '2px' }}>
                        <AccountChip accounts={accounts} accountId={u.accountId} size="xs" />
                      </div>
                    </div>
                    <span style={{
                      fontSize: '0.88rem', fontWeight: '800', flexShrink: 0,
                      color: u.kind === 'debt' ? 'var(--color-accent-red)' : 'var(--color-diet)',
                    }}>
                      {money(u.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bills with no account named are a hole: the app can tell you the
              money is going but not from where, which is exactly the state the
              user complained about. Named, not silently tolerated. */}
          {upcomingPayments.some(u => !u.accountId) && (
            <p style={{ fontSize: '0.66rem', color: 'var(--color-accent-red)', marginTop: '8px', lineHeight: 1.5 }}>
              有几笔还没说从哪个户口扣 — 点进去补一下，余额才算得准。
            </p>
          )}
        </div>
      )}

      {/* Recurring bills — keep counting every cycle until you remove them.
          Deliberately a SEPARATE section from debt instalments below: a
          subscription has no end date, an instalment does — conflating them
          was the exact complaint that led to this split. */}
      <Section
        icon={<ArrowUpFromLine size={17} color="var(--color-diet)" />}
        title="固定月费 Recurring"
        onAdd={() => { resetForm(); setAllocModal(true); }}
        empty={manualAllocations.length === 0 && '还没有固定月费。像房租、订阅、水电这种每期都要付的。'}
      >
        {manualAllocations.map(a => {
          const freq = frequencyMeta(a.frequency);
          // Three separate things a bill's subtitle has to say and previously
          // said none of: how often, when next, and out of which account.
          const when = a.frequency === 'once'
            ? (a.onceDate ? `${a.onceDate} 一次` : '还没设日期')
            : a.frequency === 'weekly'
              ? `每星期${WEEKDAYS[((a.dueDay % 7) + 7) % 7]}`
              : a.frequency === 'monthly'
                ? `每月 ${a.dueDay} 号`
                : `${MONTHS[(Number(a.dueMonth || 1) - 1) % 12]}起，每 ${freq.months} 个月的 ${a.dueDay} 号`;
          const soon = a.daysUntil != null && a.daysUntil >= 0
            ? (a.daysUntil === 0 ? '今天扣' : `${a.daysUntil} 天后扣`)
            : null;
          return (
            <Row
              key={a.id}
              title={a.label}
              subtitle={
                <>
                  {when}
                  {soon && <> · <strong style={{ color: a.daysUntil <= 3 ? 'var(--color-accent-red)' : 'var(--text-secondary)' }}>{soon}</strong></>}
                  {a.spread && a.charged !== a.budgeted && <> · 每期预留 {money(a.budgeted)}</>}
                  {a.estimated && ' · 预估金额'}
                  {a.essential === false && <> · <span style={{ color: 'var(--color-accent-amber)' }}>非必要</span></>}
                  {a.paid && ' · 本期已付'}
                </>
              }
              subtitleColor={a.estimated ? 'var(--color-diet)' : a.paid ? 'var(--color-money)' : 'var(--text-muted)'}
              badge={<AccountChip accounts={accounts} accountId={a.accountId} size="xs" />}
              amount={money(a.charged > 0 ? a.charged : a.budgeted)}
              amountColor="var(--color-diet)"
              dashed={a.estimated}
              onToggle={() => togglePaid(a)}
              toggled={a.paid}
              onConfirmActual={a.variable ? () => {
                setActualFor(a);
                setFActual(String(a.resolvedAmount));
              } : null}
              onEdit={() => {
                setEditingId(a.id); setFLabel(a.label);
                setFAmount(String(a.variable ? (a.estimate ?? '') : a.amount));
                setFVariable(Boolean(a.variable));
                setFFrequency(a.frequency);
                setFDueDay(String(a.dueDay));
                setFDueMonth(String(a.dueMonth ?? 1));
                setFOnceDate(a.onceDate ?? '');
                setFAccountId(a.accountId ?? null);
                setFCosting(a.costing);
                setFEssential(a.essential !== false);
                setAllocModal(true);
              }}
              onDelete={() => setAllocations(allocations.filter(x => x.id !== a.id))}
            />
          );
        })}
      </Section>

      {/* Debt — THE one place that answers "这个月我要还多少".
          户口欠款 lists what is owed in total and owns the instalment tables;
          it deliberately has no per-cycle box of its own any more, because two
          screens asking the same question in the same words is what made this
          feel 割裂. Both kinds of debt get the same box here: a schedule
          pre-fills it and is shown underneath, but the figure is his.
          See debts.js. */}
      {debtRows.some(r => !r.settled) && (
        <Section
          icon={<CalendarClock size={17} color="var(--color-accent-red)" />}
          title="这个月还债 Debt this month"
          empty={false}
        >
          {debtRows.filter(r => !r.settled).map(r => {
            const draft = planDrafts[r.debt.id];
            return (
              <div key={r.debt.id} style={{
                padding: '0.7rem 0.75rem', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
                display: 'flex', flexDirection: 'column', gap: '8px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {r.debt.creditor}
                      <span style={{
                        fontSize: '0.55rem', fontWeight: '800', padding: '1px 5px',
                        borderRadius: 'var(--radius-sm)',
                        background: r.fixed ? 'var(--color-accent-red-soft)' : 'var(--color-money-soft)',
                        color: r.fixed ? 'var(--color-accent-red)' : 'var(--color-money)',
                      }}>
                        {r.fixed ? '有分期表' : '想还多少还多少'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      还欠 {money(r.outstanding)}
                      {r.fixed && nextInstalment(r.debt) && ` · 下一期 ${nextInstalment(r.debt).due}`}
                    </div>
                  </div>
                  <AccountChip accounts={accounts} accountId={r.debt.accountId} size="xs" />
                </div>

                {r.progressPct != null && r.progressPct > 0 && (
                  <div style={{ height: '4px', background: 'var(--border-glass)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{
                      height: '100%', width: `${r.progressPct}%`,
                      background: 'var(--color-money)', borderRadius: 'var(--radius-sm)',
                    }} />
                  </div>
                )}

                {/* ONE box, both kinds — the figure this cycle actually
                    reserves. A schedule fills it in for you and keeps saying
                    what it wanted underneath; typing over it wins. */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.72rem' }}>
                  <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>这个月还</span>
                  <input
                    type="number" inputMode="decimal" min="0" placeholder="0.00"
                    // `chosen` matters: a deliberate 0 must render as "0", not
                    // as an empty box that reads like nothing was decided.
                    value={draft ?? (r.chosen || r.planned > 0 ? String(round2(r.planned)) : '')}
                    onChange={(e) => setPlanDrafts(p => ({ ...p, [r.debt.id]: e.target.value }))}
                    onBlur={() => commitPlan(r.debt.id)}
                    style={{
                      ...inputStyle, marginTop: 0, padding: '6px 9px',
                      fontSize: '0.78rem', textAlign: 'right',
                    }}
                  />
                </label>
                {r.suggested > 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: '8px', fontSize: '0.65rem', color: 'var(--text-muted)',
                  }}>
                    <span>
                      分期表这个月是 {money(r.suggested)}
                      {r.chosen && r.planned !== r.suggested && ' — 你改成上面那个了'}
                    </span>
                    {r.chosen && (
                      <button
                        type="button"
                        onClick={() => resetPlan(r.debt.id)}
                        style={{
                          flexShrink: 0, padding: '3px 7px', borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
                          color: 'var(--text-secondary)', fontSize: '0.63rem', cursor: 'pointer',
                        }}
                      >
                        用回分期表
                      </button>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>本月已还</span>
                  <span style={{ fontWeight: '700', color: r.repaid > 0 ? 'var(--color-money)' : 'var(--text-muted)' }}>
                    {money(r.repaid)}
                  </span>
                </div>

                {onAddExpense && (
                  <button
                    type="button"
                    onClick={() => openRepay(r)}
                    className="btn-secondary"
                    style={{ padding: '6px 10px', fontSize: '0.72rem', width: '100%' }}
                  >
                    <Banknote size={13} /> 记一笔还款
                  </button>
                )}
              </div>
            );
          })}
          <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            你填多少，这个月就先扣起来，摊到剩下的每一天 — 所以还款不会让某一天突然花不了钱，
            而是整个月每天少一点。还了之后不会再扣第二次。
            <strong>几时还、还多少，都是你自己决定</strong> — app 只负责记，不会催你。
            要改分期表或加新欠款，去「户口欠款」。
          </p>
        </Section>
      )}

      {/* Log a repayment. Deliberately its own small form rather than the
          general expense form: the debt, the category and the direction are all
          already known, so asking for them again is just friction. */}
      {repayFor && (
        <FormModal
          title={`还 ${repayFor.debt.creditor}`}
          onClose={closeRepay}
          onSubmit={submitRepay}
          submitLabel="记录这笔还款"
          disabled={!(num(repayAmount) > 0)}
        >
          <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            还欠 <strong>{money(repayFor.outstanding)}</strong>
            {repayFor.planned > 0 && <> · 这个月你填了 {money(repayFor.planned)}，已还 {money(repayFor.repaid)}</>}
          </p>
          <label style={labelStyle}>
            还多少
            <input
              type="number" inputMode="decimal" min="0" autoFocus
              value={repayAmount}
              onChange={(e) => setRepayAmount(e.target.value)}
              style={inputStyle}
            />
          </label>
          {/* Paying more than the plan is not an error — it is the only lever a
              fixed schedule gives you, so it gets said out loud rather than
              blocked. */}
          {num(repayAmount) > repayFor.remainingThisCycle && repayFor.remainingThisCycle > 0 && (
            <p style={{ fontSize: '0.66rem', color: 'var(--color-money)', lineHeight: 1.5 }}>
              比你这个月填的多 {money(num(repayAmount) - repayFor.remainingThisCycle)} — 多还没问题，欠款会更快清完，
              这个月的每日额度也会跟着少一点。
            </p>
          )}
          <label style={labelStyle}>
            几时还的
            <input
              type="date"
              value={repayDate}
              onChange={(e) => setRepayDate(e.target.value)}
              style={inputStyle}
            />
          </label>
          {repayDate && repayDate < cycle.start && (
            <p style={{ fontSize: '0.66rem', color: 'var(--color-accent-amber)', lineHeight: 1.5 }}>
              这个日期在上个周期 — 会算进上个月的「已还」，不是这个月的。
            </p>
          )}
          <label style={labelStyle}>
            从哪个户口出
            <AccountSelect
              accounts={accounts}
              value={repayAccountId}
              onChange={setRepayAccountId}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            备注（可以不填）
            <input
              type="text" value={repayNote}
              onChange={(e) => setRepayNote(e.target.value)}
              placeholder="例：提早还清"
              style={inputStyle}
            />
          </label>
        </FormModal>
      )}

      {incomeModal && (
        <FormModal
          title={editingId ? '编辑收入' : '加收入'}
          onClose={() => { setIncomeModal(false); resetForm(); }}
          onSubmit={submitIncome}
        >
          <Field label="名称" value={fLabel} onChange={setFLabel} placeholder="例：实习薪水" autoFocus required />
          <Field label="金额 (RM)" value={fAmount} onChange={setFAmount} placeholder="例：1000" type="number" required />
          <div>
            <label style={labelStyle}>这笔钱是你的吗?</label>
            <select value={fKind} onChange={(e) => setFKind(e.target.value)} style={inputStyle}>
              {INCOME_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <p style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '5px', lineHeight: 1.5 }}>
              选「代收代付」的话会显示但<strong>不算进可花额度</strong> —
              例如朋友给你、你要转出去的房租。当成收入花掉，下个月就垫不出来。
            </p>
          </div>
        </FormModal>
      )}

      {allocModal && (
        <FormModal
          title={editingId ? '编辑固定支出' : '加固定支出'}
          onClose={() => { setAllocModal(false); resetForm(); }}
          onSubmit={submitAlloc}
        >
          <Field label="名称" value={fLabel} onChange={setFLabel} placeholder="例：房租 / Netflix / 车保险" autoFocus required />

          {/* Frequency first: it decides what every field below even means. */}
          <div>
            <label style={labelStyle}>多久一次?</label>
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '5px' }}>
              {FREQUENCIES.map(f => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => changeFrequency(f.value)}
                  style={{
                    padding: '6px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    fontSize: '0.72rem', fontWeight: fFrequency === f.value ? '800' : '600',
                    background: fFrequency === f.value ? 'var(--color-diet-soft)' : 'var(--bg-input)',
                    border: `1px solid ${fFrequency === f.value ? 'var(--color-diet)' : 'var(--border-glass)'}`,
                    color: fFrequency === f.value ? 'var(--color-diet)' : 'var(--text-secondary)',
                  }}
                >
                  {f.label.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* WHEN it's deducted — the field the old form simply did not have. */}
          {fFrequency === 'once' ? (
            <div>
              <label style={labelStyle}>哪一天扣?</label>
              <input type="date" value={fOnceDate} onChange={(e) => setFOnceDate(e.target.value)} style={inputStyle} required />
            </div>
          ) : fFrequency === 'weekly' ? (
            <div>
              <label style={labelStyle}>每星期几扣?</label>
              <div style={{ display: 'flex', gap: '4px', marginTop: '5px' }}>
                {WEEKDAYS.map((d, i) => (
                  <button
                    key={d} type="button" onClick={() => setFDueDay(String(i))}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      fontSize: '0.76rem', fontWeight: Number(fDueDay) === i ? '800' : '600',
                      background: Number(fDueDay) === i ? 'var(--color-diet-soft)' : 'var(--bg-input)',
                      border: `1px solid ${Number(fDueDay) === i ? 'var(--color-diet)' : 'var(--border-glass)'}`,
                      color: Number(fDueDay) === i ? 'var(--color-diet)' : 'var(--text-secondary)',
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>每月几号扣?</label>
                <select value={fDueDay} onChange={(e) => setFDueDay(e.target.value)} style={inputStyle}>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>{d} 号</option>
                  ))}
                </select>
              </div>
              {['quarterly', 'halfyearly', 'yearly'].includes(fFrequency) && (
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>从哪个月开始算?</label>
                  <select value={fDueMonth} onChange={(e) => setFDueMonth(e.target.value)} style={inputStyle}>
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}

          {Number(fDueDay) > 28 && !['weekly', 'once'].includes(fFrequency) && (
            <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              二月没有 {fDueDay} 号 — 那几个月会自动算成该月最后一天，不会跳到下个月。
            </p>
          )}

          {/* WHICH ACCOUNT. */}
          <div>
            <label style={labelStyle}>从哪个户口扣?</label>
            <AccountSelect
              accounts={accounts}
              value={fAccountId}
              onChange={setFAccountId}
              style={inputStyle}
              allowEmpty
              emptyLabel="还没决定（之后要补）"
            />
          </div>

          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={fVariable}
              onChange={(e) => setFVariable(e.target.checked)}
              style={{ width: '15px', height: '15px' }}
            />
            每期金额不一样（像水电费）
          </label>

          <Field
            label={fVariable ? '预估金额 (RM) — 帐单来之前用这个' : '每次扣多少 (RM)'}
            value={fAmount} onChange={setFAmount}
            placeholder={fVariable ? '例：250（大概金额）' : '例：500'}
            type="number" required
          />

          {/* An annual cost can honestly be counted two ways, and neither is
              right for everything — so it is a choice, not a hidden rule. */}
          {['quarterly', 'halfyearly', 'yearly'].includes(fFrequency) && (
            <div>
              <label style={labelStyle}>这笔怎么算进每日额度?</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '5px' }}>
                {[
                  ['spread', '每期预留一点', `每个周期先扣起 ${money(perCycleReserve)}，到期时钱已经在了`],
                  ['due', '到期那期才扣', '平时不影响额度，但到期那个月会一次少一大笔'],
                ].map(([value, title, desc]) => (
                  <button
                    key={value} type="button" onClick={() => setFCosting(value)}
                    style={{
                      textAlign: 'left', padding: '0.6rem 0.7rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      background: fCosting === value ? 'var(--color-diet-soft)' : 'var(--bg-input)',
                      border: `1px solid ${fCosting === value ? 'var(--color-diet)' : 'var(--border-glass)'}`,
                      color: 'var(--text-primary)',
                    }}
                  >
                    <div style={{ fontSize: '0.78rem', fontWeight: fCosting === value ? '800' : '600', color: fCosting === value ? 'var(--color-diet)' : 'var(--text-primary)' }}>
                      {title}
                    </div>
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '2px', lineHeight: 1.4 }}>{desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 必要 / 非必要. Deliberately NOT a decorative tag: 户口欠款's
              「现在能花」 splits 固定开销 on this flag and says what cutting the
              optional ones would free up. A label nothing computes with is the
              kind of thing this module already had too much of. */}
          <div>
            <label style={labelStyle}>这笔是必要的吗?</label>
            <div style={{ display: 'flex', gap: '6px', marginTop: '5px' }}>
              {[
                [true, '必要', '房租、水电、保险 — 砍不掉的'],
                [false, '非必要', '订阅、会员 — 真的没钱时可以停'],
              ].map(([value, title, desc]) => (
                <button
                  key={String(value)} type="button" onClick={() => setFEssential(value)}
                  style={{
                    flex: 1, textAlign: 'left', padding: '0.55rem 0.65rem', borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer', lineHeight: 1.35,
                    background: fEssential === value ? 'var(--color-money-soft)' : 'var(--bg-input)',
                    border: `1px solid ${fEssential === value ? 'var(--color-money)' : 'var(--border-glass)'}`,
                    color: 'var(--text-primary)',
                  }}
                >
                  <div style={{ fontSize: '0.76rem', fontWeight: fEssential === value ? '800' : '600', color: fEssential === value ? 'var(--color-money)' : 'var(--text-primary)' }}>
                    {title}
                  </div>
                  <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)', marginTop: '2px' }}>{desc}</div>
                </button>
              ))}
            </div>
          </div>

          <p style={{ fontSize: '0.67rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {fVariable
              ? '帐单来了之后，在列表里按 💰 输入这期实际金额 — 每日额度会自动改用真实数字，不用重新建一笔。'
              : '不管有没有打勾「已付」，都会从可花额度里扣掉 — 还没付不代表不用付。'}
          </p>
        </FormModal>
      )}

      {actualFor && (
        <FormModal
          title={`确认本期金额 · ${actualFor.label}`}
          onClose={() => { setActualFor(null); setFActual(''); }}
          onSubmit={submitActual}
        >
          <Field label="这期实际金额 (RM)" value={fActual} onChange={setFActual} placeholder="帐单上的数字" type="number" autoFocus required />
          <p style={{ fontSize: '0.67rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            只会套用在<strong>这个周期</strong>（{cycle.start} → {cycle.end}）。
            下期没有帐单前，会先用预估金额。
          </p>
        </FormModal>
      )}
    </div>
  );
}

function Section({ icon, title, onAdd, empty, children }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.7rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '7px' }}>
          {icon} {title}
        </h3>
        {/* Debt instalments have no "add" here — they're managed in 户口欠款,
            not created directly on this screen. A button that did nothing
            would be worse than no button. */}
        {onAdd && (
          <button onClick={onAdd} className="btn-secondary" style={{ padding: '6px 11px', fontSize: '0.73rem' }}>
            <Plus size={13} /> 新增
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {empty ? (
          <div className="glass-card" style={{ textAlign: 'center', padding: '1.2rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
            {empty}
          </div>
        ) : children}
      </div>
    </div>
  );
}

function Row({
  title, subtitle, subtitleColor, amount, amountColor, dashed, badge,
  onEdit, onDelete, onToggle, toggled, onConfirmActual,
}) {
  return (
    <div
      className="glass-card"
      onClick={onEdit ?? undefined}
      style={{
        padding: '0.75rem 0.9rem', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', gap: '10px', cursor: onEdit ? 'pointer' : 'default',
        borderStyle: dashed ? 'dashed' : 'solid',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <h4 style={{ fontSize: '0.86rem', fontWeight: '700' }}>{title}</h4>
          {badge}
        </div>
        <span style={{ fontSize: '0.67rem', color: subtitleColor }}>{subtitle}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <span style={{ fontSize: '0.95rem', fontWeight: '800', color: amountColor }}>{amount}</span>
        {onConfirmActual && (
          <button
            onClick={(e) => { e.stopPropagation(); onConfirmActual(); }}
            aria-label="确认本期金额"
            title="确认本期实际金额"
            style={{
              background: 'var(--color-diet-soft)', border: '1px solid var(--color-diet)',
              color: 'var(--color-diet)', borderRadius: 'var(--radius-sm)', width: '22px', height: '22px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            }}
          >
            <Banknote size={12} />
          </button>
        )}
        {onToggle && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            aria-label="切换已付"
            title={toggled ? '已付' : '未付'}
            style={{
              background: toggled ? 'var(--color-money-soft)' : 'transparent',
              border: `1px solid ${toggled ? 'var(--color-money)' : 'var(--border-strong)'}`,
              color: toggled ? 'var(--color-money)' : 'var(--text-muted)',
              borderRadius: 'var(--radius-sm)', width: '22px', height: '22px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            }}
          >
            <Check size={12} />
          </button>
        )}
        {onEdit && <Pencil size={13} color="var(--text-muted)" />}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            aria-label={`删除 ${title}`}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function FormModal({ title, onClose, onSubmit, children, submitLabel = '保存', disabled = false }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {children}
          <div style={{ display: 'flex', gap: '10px', marginTop: '0.5rem' }}>
            <button type="button" onClick={onClose} className="btn-secondary" style={{ flex: 1 }}>取消</button>
            <button
              type="submit" className="btn-primary" disabled={disabled}
              style={{ flex: 1, opacity: disabled ? 0.45 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', ...rest }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type={type}
        {...(type === 'number' ? { step: '0.01', min: '0.01', inputMode: 'decimal' } : {})}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
        {...rest}
      />
    </div>
  );
}
