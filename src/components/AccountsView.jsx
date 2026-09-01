import React, { useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, X, AlertTriangle, Landmark, Lock, Check,
  Wallet, Radio, Archive, Banknote,
} from '../utils/icons';
import { useLiveJSON, saveJSON, loadJSON, useToday } from '../utils/storage';
import { num, newId } from '../utils/num';
import {
  computeNetPosition, computeSpendable, debtOutstanding, SURVIVAL_THRESHOLD,
  getWaterfallOrder, toggleInstalmentPaid,
} from '../utils/networth';
import {
  ACCOUNT_TYPES, ACCOUNT_KINDS, typeMeta, resolveAccounts, reconcileAccount,
  sameId, TNG_ACCOUNT_ID,
} from '../utils/accounts';
import { getCycle } from '../utils/cycle';
import {
  INSTALMENT_FREQUENCIES, buildInstalments, rebuildSchedule, setInstalmentAmount,
  removeInstalment, scheduleSummary,
} from '../utils/debts';

// Deliberately empty. Real balances used to be hardcoded here, which meant
// anyone who opened the deployed site's JS bundle could read them — the app is
// built to be hosted publicly, so account figures must never live in source.
// Opening balances are delivered as a backup file and loaded through
// Header → 备份 → 汇入 instead. See lifemanager-opening-balances.json.
const OPENING_ACCOUNTS = [];

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

const money = (n) => `RM ${num(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Where I actually stand — and, new here, WHICH POT each ringgit sits in.
 *
 * Balances are no longer typed. They're derived from an opening balance plus
 * everything the expense log says has left that account since (accounts.js),
 * so logging a payment and the account it came out of are the same action.
 * The old screen let you type RM 40.22 into a box that nothing else on earth
 * read, which is why spending never moved a balance.
 */
export default function AccountsView({ expenses = [] }) {
  // Read live, written through saveJSON: `accounts` has more than one writer
  // now (this screen, and the notification card that binds a phone app to an
  // account), and two usePersistentState instances for one key drift apart
  // until something remounts. See storage.js.
  const rawAccounts = useLiveJSON('accounts', OPENING_ACCOUNTS);
  const setAccounts = (next) => saveJSON('accounts', next);
  // Live-read + saveJSON for the same reason accounts above are: CycleView now
  // writes debts too (this cycle's repayment plan), and two usePersistentState
  // instances for one key drift apart until one of them remounts. See storage.js.
  const debts = useLiveJSON('debts', []);
  const setDebts = (next) => saveJSON('debts', typeof next === 'function' ? next(loadJSON('debts', [])) : next);

  const [accountModal, setAccountModal] = useState(false);
  const [debtModal, setDebtModal] = useState(false);
  const [reconcileFor, setReconcileFor] = useState(null);
  const [reconcileDraft, setReconcileDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const [fName, setFName] = useState('');
  const [fBalance, setFBalance] = useState('');
  const [fTarget, setFTarget] = useState('');
  const [fKind, setFKind] = useState('own');
  const [fType, setFType] = useState('bank');
  const [fCounts, setFCounts] = useState(true);
  const [fAutoShortfall, setFAutoShortfall] = useState(true);

  const [dCreditor, setDCreditor] = useState('');
  const [dAmount, setDAmount] = useState('');
  const [dNote, setDNote] = useState('');
  const [dDue, setDDue] = useState('');
  const [dAccountId, setDAccountId] = useState('');
  // 一次性 vs 分期 — the single thing the debt form could never express. A debt
  // added by hand always became a flat lump sum, so a RM1,864.28 instalment
  // plan showed as one number to clear. See debts.js.
  const [dShape, setDShape] = useState('flat');
  const [dCount, setDCount] = useState('');
  const [dPer, setDPer] = useState('');
  const [dFirstDue, setDFirstDue] = useState('');
  const [dFreq, setDFreq] = useState('monthly');
  const [dFinal, setDFinal] = useState('');

  // Live balances, folded in once here so every consumer below (net position,
  // the debt list, the account list itself) reads the same derived number.
  const accounts = useMemo(() => resolveAccounts(rawAccounts, expenses), [rawAccounts, expenses]);

  // Keyed on the live date, never `[]` — the app stays open for days on the
  // phone, and a cycle frozen at mount reports the wrong 本期应还 every day
  // after the first, and the wrong CYCLE entirely once the month turns. Same
  // reasoning as CycleView's; see useToday() in storage.js.
  const todayStr = useToday();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cycle = useMemo(() => getCycle(), [todayStr]);
  const visible = accounts.filter(a => showArchived || !a.archived);

  // Custodial balances are excluded from net worth and their shortfall is
  // counted as a debt; `countsToNetWorth: false` accounts are excluded from
  // the asset side only — see networth.js for why those are two different
  // exclusions rather than one.
  // `expenses` because repayments logged against a debt reduce it, the same
  // way they already move an account balance — see debts.js.
  const pos = computeNetPosition(accounts, debts, expenses);

  // Bills are owned by 本月 (CycleView writes them); this screen only reads
  // them, through useLiveJSON so an edit two screens away shows up here without
  // a remount. A second usePersistentState for the same key would drift — see
  // storage.js.
  const allocations = useLiveJSON('allocations', []);
  // 「我现在真正有多少钱能花」 — cash that exists, minus what is already
  // promised this cycle. See computeSpendable in networth.js for what is
  // deliberately NOT subtracted (custodial money, the reserve shortfall, a
  // spread annual bill's slice, anything already paid).
  const sp = useMemo(
    () => computeSpendable({ accounts, allocations, debts, expenses, cycle }),
    [accounts, allocations, debts, expenses, cycle],
  );

  // Re-derived fresh from `debts` every render (not captured once when the
  // modal opened), so toggling an instalment's paid state below updates this
  // modal's own schedule list immediately instead of showing stale data.
  const editingDebt = editingId ? debts.find(d => d.id === editingId) : null;

  // Every outstanding obligation — real debts plus what a custodial account is
  // short of its target — smallest first.
  //
  // `null` for the plan argument, where `debtPlan` used to go: this screen no
  // longer stores a payoff order or a per-cycle rate. Both were the app having
  // an opinion about "how much am I paying this month", which now has exactly
  // one home (本月). The stored key is left alone rather than deleted — an old
  // backup restoring one costs nothing when nothing reads it.
  //
  // `expenses` matters: without it this reports debts at their STATED size and
  // every repayment logged against one is invisible here, while the 真实净值
  // card directly above (computeNetPosition) counts them — the same debt, two
  // figures, one screen.
  const debtList = useMemo(
    () => getWaterfallOrder(accounts, debts, null, expenses, cycle),
    [accounts, debts, expenses, cycle],
  );

  // --- accounts ---
  // `balance`/`spentSinceOpening` are computed on read (resolveAccounts) — they
  // must never be written back to storage, or a stale copy would outrank the
  // live derivation on the next load.
  const stripDerived = ({ balance: _b, spentSinceOpening: _s, ...rest }) => rest;

  const resetAccountForm = () => {
    setEditingId(null); setFName(''); setFBalance(''); setFTarget('');
    setFKind('own'); setFType('bank'); setFCounts(true); setFAutoShortfall(true);
  };

  const openAddAccount = () => { resetAccountForm(); setAccountModal(true); };

  const openEditAccount = (a) => {
    setEditingId(a.id);
    setFName(a.name);
    setFBalance(String(a.openingBalance));
    setFTarget(a.target != null ? String(a.target) : '');
    setFKind(a.kind ?? 'own');
    setFType(a.type ?? 'bank');
    setFCounts(a.countsToNetWorth !== false);
    setFAutoShortfall(a.autoShortfallDebt !== false);
    setAccountModal(true);
  };

  const submitAccount = (e) => {
    e.preventDefault();
    const balance = Number(fBalance);
    if (!fName.trim() || !Number.isFinite(balance)) return;
    const target = fTarget.trim() === '' ? null : Number(fTarget);
    const payload = {
      name: fName.trim(),
      type: fType,
      target: Number.isFinite(target) ? target : null,
      kind: fKind,
      countsToNetWorth: fCounts,
      autoShortfallDebt: fAutoShortfall,
    };

    if (editingId) {
      setAccounts(accounts.map(a => (sameId(a.id, editingId)
        // Editing the opening balance re-baselines from NOW, not from the
        // account's original watermark — otherwise typing a corrected figure
        // would immediately have every past expense subtracted from it again.
        ? { ...stripDerived(a), ...payload, openingBalance: balance, openingAt: Date.now() }
        : stripDerived(a))));
    } else {
      setAccounts([...accounts.map(stripDerived), {
        id: newId(), ...payload,
        openingBalance: balance, openingAt: Date.now(),
        isDefault: false, packages: [], archived: false,
      }]);
    }
    resetAccountForm();
    setAccountModal(false);
  };

  const submitReconcile = (e) => {
    e.preventDefault();
    const actual = Number(reconcileDraft);
    if (!Number.isFinite(actual) || !reconcileFor) return;
    setAccounts(accounts.map(a => (sameId(a.id, reconcileFor.id)
      ? reconcileAccount(stripDerived(a), actual)
      : stripDerived(a))));
    setReconcileFor(null); setReconcileDraft('');
  };

  const setDefaultAccount = (id) =>
    setAccounts(accounts.map(a => ({ ...stripDerived(a), isDefault: sameId(a.id, id) })));

  // Archiving, not deleting. A deleted account would orphan every expense that
  // pointed at it — the log would go back to not knowing where the money came
  // from, which is the exact problem this screen exists to fix.
  const toggleArchived = (id) =>
    setAccounts(accounts.map(a => (sameId(a.id, id)
      ? { ...stripDerived(a), archived: !a.archived, isDefault: a.archived ? a.isDefault : false }
      : stripDerived(a))));

  // --- debts ---
  const resetDebtForm = () => {
    setEditingId(null); setDCreditor(''); setDAmount(''); setDNote(''); setDDue(''); setDAccountId('');
    setDShape('flat'); setDCount(''); setDPer(''); setDFirstDue(''); setDFreq('monthly'); setDFinal('');
  };

  const openAddDebt = () => { resetDebtForm(); setDebtModal(true); };

  const openEditDebt = (d) => {
    setEditingId(d.id);
    setDCreditor(d.creditor);
    setDAmount(String(debtOutstanding(d, expenses)));
    setDNote(d.note || '');
    setDDue(d.dueDate || '');
    setDAccountId(d.accountId != null ? String(d.accountId) : '');

    // The generator fields open EMPTY on an existing plan, and empty means
    // "leave the schedule alone".
    //
    // THE DEFAULT THIS REPLACES DESTROYED DATA. They used to prefill from the
    // plan's next instalment — count 21, amount RM368.70 — which is only
    // coherent if every instalment is the same size. This user's are not:
    // 368.70 / 262.66 / 262.68 then RM20.73 eighteen times. So the form opened
    // previewing "21 期，总共 RM7,394.73" against a real debt of RM1,267.18,
    // and opening the debt and pressing 保存 without touching anything would
    // have overwritten the true schedule with that fiction.
    //
    // A prefill is a suggestion, and a suggestion that is wrong for the actual
    // data is worse than no suggestion. Correcting a live plan belongs to the
    // row editor at the bottom of the form, which edits what is really there.
    const summary = scheduleSummary(d);
    setDShape(summary ? 'instalment' : 'flat');
    setDCount(''); setDPer(''); setDFirstDue(''); setDFinal('');
    setDFreq(d.instalmentFrequency ?? 'monthly');
    setDebtModal(true);
  };

  // What the form would generate, recomputed as you type. Shown in the form so
  // "21 期 × RM88.77" is a plan you can see before you commit to it, instead of
  // a list you only meet after saving.
  const instalmentSpec = {
    firstDue: dFirstDue,
    count: Number(dCount),
    amount: Number(dPer),
    frequency: dFreq,
    finalAmount: dFinal.trim() === '' ? null : Number(dFinal),
  };
  const instalmentPreview = dShape === 'instalment' ? buildInstalments(instalmentSpec) : [];
  const previewTotal = instalmentPreview.reduce((t, i) => t + num(i.amount), 0);

  const submitDebt = (e) => {
    e.preventDefault();
    const existing = editingId ? debts.find(d => d.id === editingId) : null;
    if (!dCreditor.trim()) return;

    const base = {
      creditor: dCreditor.trim(),
      note: dNote.trim(),
      dueDate: dDue,
      // Which account the instalments come out of. Without this the payday
      // router could tell you RM 20.73 was due and still not say from where.
      accountId: dAccountId || null,
    };

    let payload;
    if (dShape === 'instalment') {
      // An empty generator on a debt that already HAS a plan means "I came in
      // to change the name / account / a single row, not to re-plan" — so the
      // existing schedule is kept exactly as it is. Without this branch,
      // saving after any unrelated edit would wipe the plan.
      const regenerating = instalmentPreview.length > 0;
      if (!regenerating && !existing?.schedule?.length) return;
      // Editing goes through rebuildSchedule so instalments already marked paid
      // survive — regenerating the whole plan would resurrect them as debt.
      const schedule = regenerating
        ? (existing ? rebuildSchedule(existing, instalmentSpec) : buildInstalments(instalmentSpec))
        : existing.schedule;
      if (schedule.length === 0) return;
      // `amount` is meaningless once a schedule exists — statedRemaining reads
      // the schedule — and a stale one left behind is a second, contradictory
      // total sitting on the same debt.
      payload = { ...base, schedule, instalmentFrequency: dFreq, amount: undefined };
    } else {
      const amount = Number(dAmount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      // Dropping a schedule is a real choice ("this isn't instalments after
      // all"), so the schedule goes rather than lingering where isFixedDebt
      // would still find it.
      payload = { ...base, amount, schedule: undefined, instalmentFrequency: undefined };
    }

    if (editingId) {
      setDebts(debts.map(d => (d.id === editingId ? { ...d, ...payload } : d)));
    } else {
      setDebts([...debts, { id: newId(), ...payload }]);
    }
    resetDebtForm();
    setDebtModal(false);
  };

  // Editing one row of a live plan. A generated schedule is a starting point,
  // never the answer: this user's real SPayLater is 365.70 / 262.66 / 262.68 /
  // then 20.73 eighteen times — several overlapping purchases, not one plan.
  const editInstalment = (debtId, due, amount) =>
    setDebts(setInstalmentAmount(loadJSON('debts', []), debtId, due, amount));
  const dropInstalment = (debtId, due) =>
    setDebts(removeInstalment(loadJSON('debts', []), debtId, due));

  const toggleDebtInstalment = (debtId, due) =>
    setDebts(prev => toggleInstalmentPaid(prev, debtId, due));

  const renderAccountCard = (a) => {
    const meta = typeMeta(a.type);
    const isCustodial = a.kind === 'custodial';
    const excluded = !isCustodial && a.countsToNetWorth === false;
    const isTng = sameId(a.id, TNG_ACCOUNT_ID) || /touch\s*'?n\s*go|tng/i.test(a.name);

    return (
      <div key={a.id} className="glass-card" style={{
        padding: '0.85rem 1rem',
        opacity: a.archived ? 0.5 : 1,
        borderLeft: `3px solid ${a.archived ? 'var(--border-glass)' : meta.color}`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '10px', minWidth: 0 }}>
            <div style={{
              width: '34px', height: '34px', borderRadius: 'var(--radius-sm)', flexShrink: 0,
              background: `${meta.color}22`, color: meta.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {isCustodial ? <Lock size={16} /> : a.type === 'bank' ? <Landmark size={16} /> : <Wallet size={16} />}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <h4 style={{ fontSize: '0.9rem', fontWeight: '700' }}>{a.name}</h4>
                {a.isDefault && (
                  <span style={{
                    fontSize: '0.56rem', fontWeight: '800', letterSpacing: '0.03em',
                    color: 'var(--color-money)', background: 'var(--color-money-soft)',
                    border: '1px solid var(--color-money)', borderRadius: 'var(--radius-sm)', padding: '1px 5px',
                  }}>
                    预设 · 记账默认用这个
                  </span>
                )}
                {isTng && a.packages?.length > 0 && (
                  <span title="自动侦测这个 app 的通知" style={{
                    fontSize: '0.56rem', fontWeight: '800', color: 'var(--color-sports)',
                    background: 'var(--color-sports-soft)', border: '1px solid var(--color-sports)',
                    borderRadius: 'var(--radius-sm)', padding: '1px 5px',
                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                  }}>
                    <Radio size={9} /> 自动
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                {meta.label.split(' ')[0]}
                {isCustodial && ' · 代管，不是你的钱'}
                {excluded && ' · 只记录，不算进储蓄'}
                {a.archived && ' · 已封存'}
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{
              fontSize: '1.05rem', fontWeight: '800',
              color: a.balance < 0 ? 'var(--color-accent-red)'
                : excluded || isCustodial ? 'var(--text-secondary)' : 'var(--color-money)',
            }}>
              {money(a.balance)}
            </div>
            {/* `spentSinceOpening` is NET movement, not gross spending — a
                refund, an arrival or the incoming half of a transfer all make
                it negative. Labelling that "已花" printed lines like
                「已花 RM -1,087.50」, which is not a sentence about money. The
                sign picks the word instead. */}
            {a.spentSinceOpening !== 0 && (
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                起始 {money(a.openingBalance)} ·{' '}
                {a.spentSinceOpening > 0
                  ? `已花 ${money(a.spentSinceOpening)}`
                  : `净入 ${money(-a.spentSinceOpening)}`}
              </div>
            )}
            {/* How much to trust the number above — the first thing you want
                to know when a balance looks off. */}
            {a.reconciledAt && (
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                上次对账 {new Date(a.reconciledAt).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>

        {a.target != null && a.target > 0 && (
          <div style={{ marginTop: '8px' }}>
            <div style={{ height: '5px', background: 'var(--border-glass)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{
                height: '100%', borderRadius: 'var(--radius-sm)',
                width: `${Math.max(0, Math.min(100, (a.balance / a.target) * 100))}%`,
                background: a.balance >= a.target ? 'var(--color-money)' : 'var(--color-diet)',
              }} />
            </div>
            <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)', marginTop: '3px' }}>
              目标 {money(a.target)}
              {a.balance < a.target && ` · 还差 ${money(a.target - a.balance)}`}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
          <MiniButton onClick={() => { setReconcileFor(a); setReconcileDraft(a.balance.toFixed(2)); }}>
            <Banknote size={11} /> 对账
          </MiniButton>
          <MiniButton onClick={() => openEditAccount(a)}><Pencil size={11} /> 编辑</MiniButton>
          {/* Custodial money is never offered as the default to spend from —
              defaulting new expenses to money that isn't yours is exactly the
              mistake the custodial flag exists to prevent. */}
          {!a.isDefault && !a.archived && !isCustodial && (
            <MiniButton onClick={() => setDefaultAccount(a.id)}>设为预设</MiniButton>
          )}
          <MiniButton onClick={() => toggleArchived(a.id)}>
            <Archive size={11} /> {a.archived ? '取消封存' : '封存'}
          </MiniButton>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* WHAT THIS SCREEN LEADS WITH, AND WHY IT CHANGED.
          It used to open on 「真实净值 RM -3,666.29」 — arithmetically correct
          and unreadable, because it is four different kinds of money added
          together: cash you can spend, money held for someone else, debt, and
          a reserve you owe yourself. The user: "虽然数学可能没错，但把「可动用的
          钱、欠款、代管资金、储备金」混在一起，用户很难理解".

          So the four are separated and the one he actually asks for goes first:
          「现在能花」. Net position survives as a footnote, labelled as the
          all-in figure it always was rather than as the headline. */}
      <div className="glass-card glass-card-glow" style={{
        borderLeftColor: pos.inSurvivalMode || sp.shortOfCommitments
          ? 'var(--color-accent-red)' : 'var(--accent)',
      }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          现在能花 · Free to spend
        </span>
        <div style={{
          fontSize: '2rem', fontWeight: '800', marginTop: '2px', lineHeight: 1.1,
          color: sp.shortOfCommitments ? 'var(--color-accent-red)' : 'var(--color-money)',
        }}>
          {money(sp.spendable)}
        </div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '3px', lineHeight: 1.5 }}>
          户口现金 {money(sp.ownCash)} − 这个周期还要付 {money(sp.committedNow)}
        </div>

        {/* His call, in his words: "两个都显示". The reserve shortfall is real
            and owed, but nobody asks for it this month — folding it into the
            figure above would park it permanently in the negative and teach him
            to stop reading it. So it sits beside, never inside. */}
        {sp.reserveShortfall > 0 && (
          <div style={{
            marginTop: '9px', padding: '0.5rem 0.65rem', borderRadius: 'var(--radius-sm)',
            background: 'var(--color-diet-soft)', border: '1px solid var(--color-diet)',
            fontSize: '0.7rem', lineHeight: 1.5,
          }}>
            另外要补回储备金 <strong style={{ color: 'var(--color-diet)' }}>{money(sp.reserveShortfall)}</strong>
            {' '}— 不是这个月要给，但那笔钱不是你的。
          </div>
        )}

        {sp.optionalDue > 0 && (
          <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '8px', lineHeight: 1.5 }}>
            砍掉「非必要」的固定开销可以多 <strong style={{ color: 'var(--color-money)' }}>{money(sp.optionalDue)}</strong>
            {' '}（变成 {money(sp.spendableIfCut)}）。
          </p>
        )}

        {/* The four kinds, each on its own, so none of them can hide inside
            another. This is the whole point of the card. */}
        <div style={{
          display: 'flex', gap: '1.25rem', marginTop: '12px', flexWrap: 'wrap',
          paddingTop: '11px', borderTop: '1px solid var(--border-glass)',
        }}>
          <div>
            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>户口现金 Cash</div>
            <div style={{
              fontSize: '0.92rem', fontWeight: '700',
              color: pos.inSurvivalMode ? 'var(--color-accent-red)' : 'var(--text-primary)',
            }}>
              {money(sp.ownCash)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>这周期还要付</div>
            <div style={{ fontSize: '0.92rem', fontWeight: '700', color: 'var(--color-accent-amber)' }}>
              {money(sp.committedNow)}
            </div>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '1px' }}>
              账单 {money(sp.billsDue)} · 还债 {money(sp.debtDue)}
            </div>
          </div>
          {pos.custodialHeld > 0 && (
            <div>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>代管 · 不能动</div>
              <div style={{ fontSize: '0.92rem', fontWeight: '700', color: 'var(--text-secondary)' }}>
                {money(pos.custodialHeld)}
              </div>
            </div>
          )}
          <div>
            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>总共欠 Owed</div>
            <div style={{ fontSize: '0.92rem', fontWeight: '700', color: pos.totalOwed > 0 ? 'var(--color-accent-red)' : 'var(--text-secondary)' }}>
              {money(pos.totalOwed)}
            </div>
          </div>
          {pos.excludedHeld !== 0 && (
            <div>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>只记录 Tracked</div>
              <div style={{ fontSize: '0.92rem', fontWeight: '700', color: 'var(--text-secondary)' }}>
                {money(pos.excludedHeld)}
              </div>
            </div>
          )}
        </div>

        {(pos.custodialHeld > 0 || pos.excludedHeld !== 0) && (
          <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '10px', lineHeight: 1.5 }}>
            {/* The shortfall clause used to be optional in the MIDDLE of the
                sentence, so with nothing owed it rendered the dangling
                「那不是你的。动用的。」 — now reachable in normal use, because
                an account can switch the derived shortfall off. Each branch is
                a whole sentence on its own. */}
            {pos.custodialHeld > 0 && (
              pos.custodialShortfall > 0 ? (
                <>代管的钱<strong>不算你的，也不能花</strong>。动用掉的{' '}
                  <strong style={{ color: 'var(--color-accent-red)' }}>
                    {money(pos.custodialShortfall)}</strong> 算成欠款，因为要补回去。</>
              ) : (
                <>代管的钱<strong>不算你的，也不能花</strong>。</>
              )
            )}
            {pos.excludedHeld !== 0 && (
              <> 另外 {pos.excludedCount} 个户口你设成「只记录」 — 花的钱照样记，
                但 <strong>{money(pos.excludedHeld)}</strong> 不算进储蓄。</>
            )}
          </p>
        )}

        {/* Demoted, not deleted. It is still the honest all-in answer to "what
            am I worth" — it was just never the answer to "what can I spend",
            and printing it in 2rem type at the top of the screen said it was. */}
        <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '10px', lineHeight: 1.5 }}>
          净值 <strong style={{ color: pos.inDebt ? 'var(--color-accent-red)' : 'var(--text-secondary)' }}>
            {money(pos.netPosition)}</strong> — 全部加起来（我的钱 − 全部欠的）。
          这是「我整体上是正是负」，不是你现在能花的钱。
        </p>

        {pos.inSurvivalMode && (
          <div style={{
            marginTop: '10px', padding: '0.6rem 0.7rem',
            background: 'var(--color-accent-red-soft)', border: '1px solid var(--color-accent-red)',
            borderRadius: 'var(--radius-sm)', display: 'flex', gap: '7px', alignItems: 'flex-start',
          }}>
            <AlertTriangle size={14} color="var(--color-accent-red)" style={{ flexShrink: 0, marginTop: '1px' }} />
            <span style={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
              生存模式 — 可动用现金低于 <strong>{money(SURVIVAL_THRESHOLD)}</strong>。
              这个警告会一直显示在每个分页顶部，直到这个数字真的回到 {money(SURVIVAL_THRESHOLD)} 以上。
            </span>
          </div>
        )}
      </div>

      {/* Accounts */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '7px' }}>
            <Wallet size={17} color="var(--color-money)" /> 我的户口 Accounts
          </h3>
          <div style={{ display: 'flex', gap: '6px' }}>
            {accounts.some(a => a.archived) && (
              <button onClick={() => setShowArchived(v => !v)} className="btn-secondary" style={{ padding: '6px 10px', fontSize: '0.7rem' }}>
                {showArchived ? '隐藏封存' : '看封存的'}
              </button>
            )}
            <button onClick={openAddAccount} className="btn-secondary" style={{ padding: '6px 11px', fontSize: '0.73rem' }}>
              <Plus size={13} /> 新增
            </button>
          </div>
        </div>

        <p style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
          余额是<strong>算出来的</strong>，不是手打的：起始金额 − 记账里从这个户口花掉的钱。
          实际数字对不上就按「对账」输入真实余额，之后重新从那里算起。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {visible.length === 0 ? (
            <div className="glass-card" style={{ textAlign: 'center', padding: '1.2rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              还没有户口。
            </div>
          ) : visible.map(renderAccountCard)}
        </div>
      </div>

      {/* 储备金进度 lived here as its own section and was the FOURTH place PBE
          appeared on this one screen: the 现在能花 card names it as 代管·不能动,
          its account card already prints 目标 RM15,269 · 还差 RM2,596.91, and the
          debt list below lists it as 欠自己的储备金. A progress bar repeating a
          number three other blocks already carry is the "同一笔东西到处重复"
          the user asked to be rid of, so it is gone — the account card is where
          a per-account figure belongs, and the debt list is where "how much do
          I still owe it" belongs. */}

      {/* 欠款 — WHAT IS OWED. Not what to do about it this month.

          This was 还款规划, the waterfall: the same debts as 本月's, with the
          same per-cycle box beside them and an order the app suggested. The
          user, 1 Sep 2026: "户口欠款跟本月…好像那个还款瀑布，就跟本月的欠款
          一样…我更喜欢本月的。这个月我要还多少我会自己去算的，这个 app 就是帮
          我记录一下".

          So the two screens stopped asking the same question. This one owns
          「我总共欠多少」 and the instalment tables — tap a row to edit one.
          「这个月还多少」 now exists once, in 本月. The suggested payoff order
          went with the box: it was the app holding an opinion about a decision
          he had just said was his, and it was the thing making one debt look
          like two different demands on two different screens. */}
      {(() => {
        const totalOwed = debtList.reduce((t, i) => t + num(i.outstanding), 0);
        const KIND = {
          scheduled: { label: '分期', color: 'var(--color-accent-red)', soft: 'var(--color-accent-red-soft)' },
          flexible: { label: '一次过', color: 'var(--color-money)', soft: 'var(--color-money-soft)' },
          reserve: { label: '欠自己的储备金', color: 'var(--color-diet)', soft: 'var(--color-diet-soft)' },
        };
        return (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '7px' }}>
              <Banknote size={17} color="var(--color-accent-red)" /> 欠款 Debts
            </h3>
            <button onClick={openAddDebt} className="btn-secondary" style={{ padding: '6px 11px', fontSize: '0.73rem' }}>
              <Plus size={13} /> 新增欠款
            </button>
          </div>

          {/* NOT a big 总共还欠 card. 「总共欠」 is already one of the four
              figures at the top of this same screen, and printing it twice in
              two sizes is the repetition this rewrite exists to remove — so the
              list says it in one line and says out loud that it is the same
              number, rather than leaving the reader to reconcile them.
              「这个周期一定要还」 is gone with the waterfall: a deadline figure
              belongs on the screen about this month, not the one about standing. */}
          {debtList.length > 0 && (
            <p style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
              {debtList.length} 笔，加起来 <strong>{money(totalOwed)}</strong> — 就是上面那个「总共欠」。
              慢慢还的，不是现在要给。
            </p>
          )}

          {debtList.length === 0 && (
            <div className="glass-card" style={{ textAlign: 'center', padding: '1.2rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              没有欠款。分期（SPayLater、Atome）和欠朋友的钱都加在这里。
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {debtList.map((item) => {
              const meta = KIND[item.commitment] ?? KIND.flexible;
              const debtId = item.kind === 'debt' ? item.id.slice('debt:'.length) : null;
              const debtRow = debtId ? debts.find(d => String(d.id) === debtId) : null;
              const planSummary = debtRow ? scheduleSummary(debtRow) : null;
              return (
              <div
                key={item.id}
                className="glass-card"
                style={{ padding: '0.8rem 0.9rem', cursor: debtRow ? 'pointer' : 'default' }}
                // A reserve row has no `debts` entry to open, so only real
                // debts are clickable.
                onClick={debtRow ? () => openEditDebt(debtRow) : undefined}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <h4 style={{ fontSize: '0.85rem', fontWeight: '700' }}>{item.label}</h4>
                      <span style={{
                        fontSize: '0.55rem', fontWeight: '800', padding: '1px 5px',
                        borderRadius: 'var(--radius-sm)', background: meta.soft, color: meta.color,
                      }}>
                        {meta.label}
                      </span>
                    </div>
                    {/* The SHAPE of what is left — how many more, until when.
                        Without it a row shows one big total and nothing else,
                        which is what made a RM1,864.28 plan read as a demand
                        for RM1,864.28. */}
                    <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                      {item.nextDue ? `下一期 ${item.nextDue}` : item.kind === 'reserve' ? '没有期限' : '几时还你自己决定'}
                      {planSummary && planSummary.remainingCount > 1 && (
                        <> · 还有 {planSummary.remainingCount} 期，最后一期 {planSummary.last?.due}</>
                      )}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: '800', color: 'var(--color-accent-red)' }}>
                      {money(item.outstanding)}
                    </div>
                    <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>还欠</div>
                  </div>
                </div>

                {item.progressPct != null && (
                  <div style={{ height: '4px', background: 'var(--border-glass)', borderRadius: '2px', marginTop: '8px' }}>
                    <div style={{
                      height: '100%', width: `${item.progressPct}%`, borderRadius: '2px',
                      background: 'var(--color-money)',
                    }} />
                  </div>
                )}
              </div>
              );
            })}
          </div>

          {debtList.length > 0 && (
            <p style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '10px', lineHeight: 1.5 }}>
              这里只管「总共欠多少」和分期表 — <strong>点一行</strong>可以改内容或分期表。
              这个月要还多少、几时还，在「本月」那边填和记，一个地方就够了。
            </p>
          )}
        </div>
        );
      })()}

      {/* Account modal */}
      {accountModal && (
        <Modal title={editingId ? '编辑户口' : '新增户口'} onClose={() => { setAccountModal(false); resetAccountForm(); }} onSubmit={submitAccount}>
          <div>
            <label style={labelStyle}>名称</label>
            <input type="text" autoFocus value={fName} onChange={e => setFName(e.target.value)}
              placeholder="例：Maybank MAE" style={inputStyle} required />
          </div>

          <div>
            <label style={labelStyle}>类型</label>
            <select value={fType} onChange={e => setFType(e.target.value)} style={inputStyle}>
              {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>{editingId ? '起始金额 (RM) — 从现在重新算起' : '现在有多少 (RM)'}</label>
            <input type="number" step="0.01" inputMode="decimal" value={fBalance}
              onChange={e => setFBalance(e.target.value)} placeholder="例：40.22" style={inputStyle} required />
            <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '5px', lineHeight: 1.5 }}>
              之后余额会自己扣 — 每一笔记在这个户口的开销都会从这里减掉。
              {editingId && ' 改这个数字等于重新对账：以前的记录不会被重算。'}
            </p>
          </div>

          <div>
            <label style={labelStyle}>这笔钱是谁的?</label>
            <select value={fKind} onChange={e => setFKind(e.target.value)} style={inputStyle}>
              {ACCOUNT_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>

          {/* The user's own ask: track it, spend from it, but keep it out of
              "how much have I got". Only meaningful for money that IS yours —
              custodial is already excluded by definition. */}
          {fKind !== 'custodial' && (
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', lineHeight: 1.5 }}>
              <input type="checkbox" checked={!fCounts} onChange={e => setFCounts(!e.target.checked)}
                style={{ width: '15px', height: '15px', marginTop: '2px', flexShrink: 0 }} />
              <span>
                <strong>只记录，不算进储蓄</strong><br />
                <span style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                  从这个户口花的钱照样记账、照样看得到，但余额不会算进「我的钱」和净值。
                  欠款还是会算。适合别人的卡、公司的钱、不该当成自己身家的余额。
                </span>
              </span>
            </label>
          )}

          <div>
            <label style={labelStyle}>目标金额 (RM，选填)</label>
            <input type="number" step="0.01" inputMode="decimal" value={fTarget}
              onChange={e => setFTarget(e.target.value)} placeholder="要存到多少 / 要补回多少" style={inputStyle} />
          </div>

          {/* Only meaningful where the derived shortfall actually becomes a
              debt: a custodial account with a target. See networth.js for the
              reason this can be turned off. */}
          {fKind === 'custodial' && fTarget.trim() !== '' && (
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', lineHeight: 1.5 }}>
              <input type="checkbox" checked={!fAutoShortfall} onChange={e => setFAutoShortfall(!e.target.checked)}
                style={{ width: '15px', height: '15px', marginTop: '2px', flexShrink: 0 }} />
              <span>
                <strong>差额我自己记，不要自动算成欠款</strong><br />
                <span style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                  预设是「目标 − 余额」自动算成欠你自己的钱。但如果这个户口进出很杂
                  （生活费进来、房租出去、能动的又转走），那个差额会一下补满一下掉回去，
                  看了也没用。勾这个之后差额只当参考，欠多少你自己在下面「欠款」加一笔。
                </span>
              </span>
            </label>
          )}
        </Modal>
      )}

      {/* Reconcile modal */}
      {reconcileFor && (
        <Modal title={`对账 · ${reconcileFor.name}`} onClose={() => { setReconcileFor(null); setReconcileDraft(''); }} onSubmit={submitReconcile}>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            app 现在算出来是 <strong>{money(reconcileFor.balance)}</strong>。
            打开真正的 app / 银行看一眼，把实际数字填进来。
          </p>
          <div>
            <label style={labelStyle}>实际余额 (RM)</label>
            <input type="number" step="0.01" inputMode="decimal" autoFocus value={reconcileDraft}
              onChange={e => setReconcileDraft(e.target.value)} style={inputStyle} required />
          </div>
          <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            以前的记录一笔都不会被改动 — 只是从现在这一刻开始，用这个数字重新往下扣。
            对不上通常是有几笔忘了记，或是有笔钱不是从这个户口出的。
          </p>
        </Modal>
      )}

      {/* Debt modal */}
      {debtModal && (
        <Modal title={editingId ? '编辑欠款' : '新增欠款'} onClose={() => { setDebtModal(false); resetDebtForm(); }} onSubmit={submitDebt}>
          <div>
            <label style={labelStyle}>欠谁 / 什么</label>
            <input type="text" autoFocus value={dCreditor} onChange={e => setDCreditor(e.target.value)}
              placeholder="例：SPayLater" style={inputStyle} required />
          </div>

          {/* THE QUESTION THE FORM NEVER ASKED.
              Every debt added by hand became a flat lump sum, because there was
              nowhere to say otherwise — so an instalment plan showed as one big
              number to clear. The user's words: "不能只显示 RM1,864.28 然后叫我
              一次还掉；它本身就是分期债务，要按照实际分期处理". */}
          <div>
            <label style={labelStyle}>怎么还?</label>
            <div style={{ display: 'flex', gap: '6px', marginTop: '5px' }}>
              {[['flat', '一次过 / 想还多少还多少'], ['instalment', '分期，每期固定']].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDShape(value)}
                  style={{
                    flex: 1, padding: '9px 8px', borderRadius: 'var(--radius-sm)',
                    fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer', lineHeight: 1.35,
                    background: dShape === value ? 'var(--color-money-soft)' : 'var(--bg-input)',
                    border: `1px solid ${dShape === value ? 'var(--color-money)' : 'var(--border-glass)'}`,
                    color: dShape === value ? 'var(--color-money)' : 'var(--text-secondary)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {dShape === 'flat' ? (
            <div>
              <label style={labelStyle}>还欠多少 (RM)</label>
              <input type="number" step="0.01" inputMode="decimal" value={dAmount}
                onChange={e => setDAmount(e.target.value)} style={inputStyle} required />
              <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '5px', lineHeight: 1.5 }}>
                这种欠款没有「本月要还多少」—— 每个月你自己决定，在「本月」那边填。
              </p>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>还有几期</label>
                  <input type="number" min="1" step="1" inputMode="numeric" value={dCount}
                    onChange={e => setDCount(e.target.value)} placeholder="例：21" style={inputStyle}
                    required={!editingDebt?.schedule?.length} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>每期多少 (RM)</label>
                  <input type="number" step="0.01" inputMode="decimal" value={dPer}
                    onChange={e => setDPer(e.target.value)} placeholder="例：20.73" style={inputStyle}
                    required={!editingDebt?.schedule?.length} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>下一期几时</label>
                  <input type="date" value={dFirstDue}
                    onChange={e => setDFirstDue(e.target.value)} style={inputStyle}
                    required={!editingDebt?.schedule?.length} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>多久一期</label>
                  <select value={dFreq} onChange={e => setDFreq(e.target.value)} style={inputStyle}>
                    {INSTALMENT_FREQUENCIES.map(f => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* A plan almost never divides evenly: 21 × RM88.77 is RM1,864.17,
                  not RM1,864.28. The real ones put the remainder on the last
                  instalment, so this exists rather than leaving the schedule
                  eleven sen short of what is actually owed. */}
              <div>
                <label style={labelStyle}>最后一期不一样? (RM，选填)</label>
                <input type="number" step="0.01" inputMode="decimal" value={dFinal}
                  onChange={e => setDFinal(e.target.value)} placeholder="留空 = 每期都一样" style={inputStyle} />
              </div>

              {editingDebt?.schedule?.length > 0 && instalmentPreview.length === 0 && (
                <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
                  上面几格<strong>留空就不会动</strong>现有的分期表 —— 只想改名字、户口或某一期金额的话，
                  不用填。要整个重排剩下的期数才填。
                </p>
              )}

              {instalmentPreview.length > 0 && (
                <div style={{
                  padding: '0.6rem 0.7rem', borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-money-soft)', border: '1px solid var(--color-money)',
                  fontSize: '0.72rem', lineHeight: 1.6,
                }}>
                  <strong style={{ color: 'var(--color-money)' }}>
                    {editingDebt?.schedule?.length > 0 ? '重排成 ' : ''}
                    {instalmentPreview.length} 期，总共 {money(previewTotal)}
                  </strong>
                  <br />
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {instalmentPreview[0].due} 起，最后一期 {instalmentPreview[instalmentPreview.length - 1].due}
                  </span>
                  {editingDebt?.schedule?.some(i => i.paid) && (
                    <>
                      <br />
                      <span style={{ color: 'var(--text-muted)' }}>
                        已经付掉的 {editingDebt.schedule.filter(i => i.paid).length} 期不会动。
                      </span>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          <div>
            <label style={labelStyle}>从哪个户口扣?</label>
            <select value={dAccountId} onChange={e => setDAccountId(e.target.value)} style={inputStyle}>
              <option value="">还没决定</option>
              {accounts.filter(a => !a.archived).map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {dShape === 'flat' && (
            <div>
              <label style={labelStyle}>到期日（选填）</label>
              <input type="date" value={dDue} onChange={e => setDDue(e.target.value)} style={inputStyle} />
            </div>
          )}

          <div>
            <label style={labelStyle}>备注（选填）</label>
            <input type="text" value={dNote} onChange={e => setDNote(e.target.value)} style={inputStyle} />
          </div>

          {/* THE LIVE PLAN, editable row by row.
              A generated schedule is where you start, not the answer: this
              user's real SPayLater is 365.70 / 262.66 / 262.68 and then 20.73
              eighteen times — several overlapping Shopee purchases, not one
              even plan. A generator you cannot correct afterwards would have
              been one more workflow he doesn't follow. */}
          {editingDebt?.schedule?.length > 0 && (
            <div>
              <label style={labelStyle}>分期表 · 改金额、打勾=已付、垃圾桶=删掉这期</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px', maxHeight: '210px', overflowY: 'auto' }}>
                {editingDebt.schedule.map(i => (
                  <div
                    key={i.due}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '5px 8px', borderRadius: 'var(--radius-sm)',
                      background: i.paid ? 'var(--color-money-soft)' : 'var(--bg-input)',
                      border: `1px solid ${i.paid ? 'var(--color-money)' : 'var(--border-glass)'}`,
                    }}
                  >
                    <span style={{
                      flex: 1, fontSize: '0.74rem',
                      color: i.paid ? 'var(--color-money)' : 'var(--text-secondary)',
                    }}>
                      {i.due}
                    </span>
                    <input
                      type="number" step="0.01" inputMode="decimal"
                      value={i.amount}
                      onChange={(e) => editInstalment(editingDebt.id, i.due, e.target.value)}
                      style={{
                        width: '84px', padding: '4px 7px', textAlign: 'right',
                        borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)',
                        border: '1px solid var(--border-glass)', color: 'white', fontSize: '0.74rem',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => toggleDebtInstalment(editingDebt.id, i.due)}
                      aria-label={`${i.due} ${i.paid ? '取消已付' : '标记已付'}`}
                      style={{
                        width: '26px', height: '24px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        background: i.paid ? 'var(--color-money)' : 'var(--bg-card)',
                        border: `1px solid ${i.paid ? 'var(--color-money)' : 'var(--border-glass)'}`,
                        color: i.paid ? 'var(--bg-card)' : 'var(--text-muted)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Check size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => dropInstalment(editingDebt.id, i.due)}
                      aria-label={`删掉 ${i.due} 这一期`}
                      style={{
                        background: 'none', border: 'none', color: 'var(--text-muted)',
                        cursor: 'pointer', padding: '0 2px', display: 'flex', alignItems: 'center',
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.5 }}>
                改这里是马上生效的，不用等按保存。上面那几格是「重新排剩下的期数」——
                按了保存才会把还没付的部分整个换掉。
              </p>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function MiniButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
        color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)',
        padding: '4px 9px', fontSize: '0.66rem', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: '4px',
      }}
    >
      {children}
    </button>
  );
}

function Modal({ title, onClose, onSubmit, children }) {
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
            <button type="submit" className="btn-primary" style={{ flex: 1 }}>保存</button>
          </div>
        </form>
      </div>
    </div>
  );
}
