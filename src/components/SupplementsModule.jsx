import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Plus, Check, Trash2, ChevronLeft, Pencil, Bell, Info, Package, X,
} from '../utils/icons';
import { useLiveJSON, useToday, saveJSON, loadJSON } from '../utils/storage';
import { newId, num } from '../utils/num';
import { todayStr } from '../utils/datetime';
import {
  CATEGORIES, FORMS, FREQUENCIES, NUTRIENTS, DEFAULT_TIME, DEFAULT_LOW_STOCK_DOSES,
  normalizeSupplements, normalizeSupplement, normalizeLog,
  doseNutrients, describeDose, describeSchedule, describeStock, describeNutrient,
  statusFor, pendingTimes, isScheduledOn, isLowStock, dosesRemaining,
  findOverlaps, categoryMeta, formMeta, formatAmount, nutrientMeta,
  hasMealValue, asMealRecord,
} from '../utils/supplements';
import { seedSupplements, OPTIONAL_TEMPLATES } from '../utils/supplementSeeds';
import { notificationsSupported } from '../utils/notify';

const card = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-glass)',
  borderRadius: 'var(--radius-md)',
};

const input = {
  width: '100%',
  background: 'var(--bg-input)',
  border: '1px solid var(--border-glass)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  padding: '9px 10px',
  fontSize: '0.85rem',
  fontFamily: 'var(--font-main)',
};

const iconBtn = {
  background: 'none', border: 'none', color: 'var(--text-muted)',
  cursor: 'pointer', padding: '3px', display: 'flex',
};

/**
 * 补充剂 — what I take, did I take it, and what is actually in it.
 *
 * NOT A PHARMACY SCREEN. No interaction checker, no upper limits, no advice.
 * The first screen answers one question in under a second — 今天吃了没 — and
 * everything else is one tap behind it.
 *
 * `supplements` and `supplementLog` are read live and written through
 * `saveJSON` rather than through a `usePersistentState` setter, because the
 * notification centre writes both too (ticking a dose off from there). Two
 * `usePersistentState` instances of one key drift apart until one remounts —
 * see storage.js — so anything with several writers uses this pair.
 */
export default function SupplementsModule({ onLogMeal }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const today = useToday();

  const stored = useLiveJSON('supplements', []);
  const storedLog = useLiveJSON('supplementLog', []);
  const seeded = useLiveJSON('supplementsSeeded', false);

  const supplements = useMemo(() => normalizeSupplements(stored), [stored]);
  const log = useMemo(() => normalizeLog(storedLog), [storedLog]);

  // The drawer, put in once. Guarded by a FLAG and not by "is the list empty",
  // because deleting every supplement is a decision and an empty-list check
  // would undo it on the next app start — same shape as `purgeDemoHistory` in
  // App.jsx, which uses a flag for exactly this reason.
  useEffect(() => {
    const seeds = seedSupplements({ stored, alreadySeeded: seeded, today });
    if (!seeds) return;
    saveJSON('supplements', seeds);
    saveJSON('supplementsSeeded', true);
  }, [stored, seeded, today]);

  const save = (supplement) => {
    const list = loadJSON('supplements', []);
    const arr = Array.isArray(list) ? list : [];
    const i = arr.findIndex(s => String(s.id) === String(supplement.id));
    saveJSON('supplements', i === -1 ? [...arr, supplement] : arr.map((s, n) => (n === i ? supplement : s)));
  };

  const remove = (sid) => {
    const list = loadJSON('supplements', []);
    saveJSON('supplements', (Array.isArray(list) ? list : []).filter(s => String(s.id) !== String(sid)));
    // The taken-log is NOT purged. It records what was actually swallowed, and
    // deleting a bottle you finished should not rewrite the history of having
    // taken it. Orphan entries are simply never matched to a supplement again.
  };

  /**
   * Record a dose.
   *
   * Three things happen and they are deliberately separate: the log entry is
   * the fact, the stock decrement is bookkeeping that only applies when stock
   * is tracked, and the diet record is offered rather than written — see
   * `MealPrompt` for why that one asks.
   */
  const take = (supplement, time = null) => {
    const at = Date.now();
    const list = loadJSON('supplementLog', []);
    saveJSON('supplementLog', [
      ...(Array.isArray(list) ? list : []),
      {
        id: newId(), supplementId: supplement.id, date: today, time,
        units: supplement.unitsPerDose, at, updatedAt: at,
      },
    ]);

    // Only when it is being tracked. Writing 0 for an untracked bottle turns
    // "I don't count these" into "I have none left", which then raises a
    // low-stock warning about a bottle that is probably full.
    if (supplement.remainingQuantity != null) {
      save({
        ...supplement,
        remainingQuantity: Math.max(0, num(supplement.remainingQuantity) - num(supplement.unitsPerDose)),
        updatedAt: at,
      });
    }
  };

  const undo = (supplement) => {
    const list = normalizeLog(loadJSON('supplementLog', []));
    // The most recent entry for today only — undo means "that tap was a
    // mistake", not "erase this from history".
    const mine = list.filter(e => String(e.supplementId) === String(supplement.id) && e.date === today);
    if (mine.length === 0) return;
    const newest = mine.reduce((a, b) => (b.at > a.at ? b : a));
    saveJSON('supplementLog', list.filter(e => e.id !== newest.id));
    if (supplement.remainingQuantity != null) {
      save({
        ...supplement,
        remainingQuantity: num(supplement.remainingQuantity) + num(newest.units),
        updatedAt: Date.now(),
      });
    }
  };

  if (id) {
    return (
      <SupplementForm
        key={id}
        supplementId={id}
        supplements={supplements}
        onSave={(s) => { save(s); navigate('/diet/supplements'); }}
        onDelete={() => { remove(id); navigate('/diet/supplements'); }}
        onCancel={() => navigate('/diet/supplements')}
      />
    );
  }

  return (
    <SupplementsList
      supplements={supplements}
      log={log}
      today={today}
      onTake={take}
      onUndo={undo}
      onAdd={(raw) => save(normalizeSupplement(raw))}
      onLogMeal={onLogMeal}
    />
  );
}

// --------------------------------------------------------------------------
// List
// --------------------------------------------------------------------------

function SupplementsList({ supplements, log, today, onTake, onUndo, onAdd, onLogMeal }) {
  const navigate = useNavigate();
  // The one supplement waiting on a "log this as food too?" answer.
  const [mealPrompt, setMealPrompt] = useState(null);

  const { active, paused } = useMemo(() => ({
    active: supplements.filter(s => s.active),
    paused: supplements.filter(s => !s.active),
  }), [supplements]);

  const overlaps = useMemo(() => findOverlaps(supplements, { date: today }), [supplements, today]);

  const doneToday = active.filter(s => statusFor(s, log, today) === 'taken').length;
  const dueToday = active.filter(s => isScheduledOn(s, today)).length;

  const handleTake = (s) => {
    onTake(s, pendingTimes(s, log, today)[0] ?? null);
    // Asked, not assumed — see MealPrompt.
    if (hasMealValue(s) && onLogMeal) setMealPrompt(s);
  };

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      {/* The one-second answer. Not a progress bar with a percentage — the
          number of things left is the thing you want, and a ring at 83% is a
          worse way to say "one to go". */}
      {dueToday > 0 && (
        <div style={{
          ...card, padding: '11px 12px', display: 'flex', alignItems: 'center', gap: '10px',
          borderColor: doneToday >= dueToday ? 'var(--color-money)' : 'var(--border-glass)',
        }}>
          <span style={{ fontSize: '1.3rem' }}>{doneToday >= dueToday ? '✅' : '💊'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.85rem', fontWeight: '700' }}>
              {doneToday >= dueToday ? '今天的都吃了' : `今天还有 ${dueToday - doneToday} 个没吃`}
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '1px' }}>
              今天要吃 {dueToday} 个 · 已经吃了 {doneToday} 个
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => navigate('/diet/supplements/new')}
        className="btn-primary"
        style={{ width: '100%' }}
      >
        <Plus size={16} /> 加补充剂
      </button>

      {supplements.length === 0 && (
        <div style={{ ...card, padding: '18px', textAlign: 'center' }}>
          <Package size={22} color="var(--color-diet)" />
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
            还没有补充剂
          </p>
        </div>
      )}

      {active.map(s => (
        <SupplementCard
          key={s.id}
          supplement={s}
          log={log}
          today={today}
          onTake={() => handleTake(s)}
          onUndo={() => onUndo(s)}
          onEdit={() => navigate(`/diet/supplements/${s.id}`)}
        />
      ))}

      {/* Only where the data actually shows one. States a fact and stops —
          no upper limits, no "too much", no advice about what to do. */}
      {overlaps.length > 0 && <OverlapCard overlaps={overlaps} />}

      {paused.length > 0 && (
        <>
          <h3 style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)' }}>
            停了的 · {paused.length}
          </h3>
          {paused.map(s => (
            <SupplementCard
              key={s.id}
              supplement={s}
              log={log}
              today={today}
              onEdit={() => navigate(`/diet/supplements/${s.id}`)}
            />
          ))}
        </>
      )}

      {/* Offered, never seeded — the brief was explicit that turmeric is
          something the user might add, not something the app decides he takes. */}
      <OptionalTemplates supplements={supplements} onAdd={onAdd} />

      {mealPrompt && (
        <MealPrompt
          supplement={mealPrompt}
          onConfirm={() => {
            const record = asMealRecord(mealPrompt, { id: newId(), date: today });
            if (record) onLogMeal(record);
            setMealPrompt(null);
          }}
          onClose={() => setMealPrompt(null)}
        />
      )}
    </div>
  );
}

function SupplementCard({ supplement: s, log, today, onTake, onUndo, onEdit }) {
  const status = statusFor(s, log, today);
  const dose = doseNutrients(s);
  const low = isLowStock(s);

  // The two or three numbers worth showing without opening anything, IN LABEL
  // ORDER — the order they were entered, which is the order the bottle prints.
  //
  // Sorting these by amount looks obviously right and is wrong: the amounts are
  // in different units, so it compares 500 mg of taurine against 2.5 g of
  // creatine and puts taurine first. On the creatine tub specifically that
  // reads as "this is mostly taurine", which is exactly the misreading this
  // module exists to prevent. A label's own order already leads with what the
  // product is.
  const headline = Object.entries(dose)
    .filter(([key]) => key !== 'energy')
    .slice(0, 3);

  const meta = categoryMeta(s.category);

  return (
    <div style={{
      ...card, padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: '8px',
      opacity: s.active ? 1 : 0.55,
      borderColor: low ? 'var(--color-diet)' : 'var(--border-glass)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{
          width: '34px', height: '34px', flexShrink: 0, fontSize: '1.05rem',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)',
        }}>
          {meta.emoji}
        </span>

        <button
          onClick={onEdit}
          style={{
            flex: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            textAlign: 'left', color: 'var(--text-primary)', minWidth: 0,
          }}
        >
          <div style={{ fontSize: '0.88rem', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.name || '（没有名字）'}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
            <span>{describeDose(s)}</span>
            <span>· {describeSchedule(s)}</span>
            {s.remindEnabled && <Bell size={10} style={{ marginTop: '2px' }} />}
          </div>
        </button>

        {/* Three states, three controls. An as-needed product gets a plain
            「记一次」 rather than an unticked box, because there was nothing
            scheduled to leave unticked. */}
        {onTake && (
          status === 'taken' ? (
            <button
              onClick={onUndo}
              title="取消"
              style={{
                display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
                background: 'var(--color-money-soft)', border: '1px solid var(--color-money)',
                color: 'var(--color-money)', borderRadius: 'var(--radius-sm)',
                padding: '6px 9px', fontSize: '0.72rem', cursor: 'pointer',
              }}
            >
              <Check size={13} /> 吃了
            </button>
          ) : (
            <button
              onClick={onTake}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
                background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
                color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)',
                padding: '6px 9px', fontSize: '0.72rem', cursor: 'pointer',
              }}
            >
              {status === 'na' ? '记一次' : '还没吃'}
            </button>
          )
        )}

        <button onClick={onEdit} style={iconBtn} title="修改"><Pencil size={14} /></button>
      </div>

      {headline.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {headline.map(([key, amount]) => (
            <span
              key={key}
              style={{
                fontSize: '0.66rem', padding: '3px 7px',
                background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
              }}
            >
              {describeNutrient(key, amount)}
            </span>
          ))}
          {Object.keys(dose).length > headline.length && (
            <span style={{ fontSize: '0.66rem', padding: '3px 7px', color: 'var(--text-muted)' }}>
              +{Object.keys(dose).length - headline.length}
            </span>
          )}
        </div>
      )}

      {s.remainingQuantity != null && (
        <div style={{ fontSize: '0.66rem', color: low ? 'var(--color-diet)' : 'var(--text-muted)' }}>
          {describeStock(s)}{low ? ' · 快没了' : ''}
        </div>
      )}
    </div>
  );
}

/**
 * 可能重复的营养 — a fact, and nothing more.
 *
 * NO RECOMMENDATION, BY DESIGN. It does not say "too much", does not colour
 * anything red, and does not suggest stopping one of them. Upper limits are a
 * clinical judgement this app is in no position to make, and a scary-looking
 * warning next to a number it cannot interpret would be worse than the number
 * on its own. It shows what overlaps and what the day adds up to; reading it is
 * the user's job, and now possible.
 */
function OverlapCard({ overlaps }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ ...card, padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '7px', background: 'none',
          border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-primary)', textAlign: 'left',
        }}
      >
        <Info size={14} color="var(--color-notes)" />
        <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: '700' }}>
          有 {overlaps.length} 种营养素重复
        </span>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{open ? '收起' : '看看'}</span>
      </button>

      <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
        不同产品里有一样的东西。这里只列出加起来是多少，要不要调整由你自己决定。
      </p>

      {open && overlaps.map(o => (
        <div key={o.key} style={{
          background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
          borderRadius: 'var(--radius-sm)', padding: '8px 9px',
          display: 'flex', flexDirection: 'column', gap: '3px',
        }}>
          <div style={{ fontSize: '0.76rem', fontWeight: '700' }}>
            {o.label} · 一天共 {formatAmount(o.total)} {o.unit}
          </div>
          {o.sources.map(src => (
            <div key={src.id} style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
              {src.name} — {formatAmount(src.amount)} {o.unit}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function OptionalTemplates({ supplements, onAdd }) {
  const existing = new Set(supplements.map(s => s.name));
  const available = OPTIONAL_TEMPLATES.filter(t => !existing.has(t.build().name));
  if (available.length === 0) return null;

  return (
    <div style={{ ...card, padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
      <div style={{ fontSize: '0.74rem', fontWeight: '700', color: 'var(--text-secondary)' }}>
        要加的话
      </div>
      {available.map(t => (
        <button
          key={t.key}
          onClick={() => onAdd(t.build())}
          style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
            borderRadius: 'var(--radius-sm)', padding: '8px 9px', cursor: 'pointer',
            color: 'var(--text-primary)', textAlign: 'left',
          }}
        >
          <Plus size={13} color="var(--text-muted)" />
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: '0.76rem', fontWeight: '600' }}>{t.label}</span>
            <span style={{ display: 'block', fontSize: '0.64rem', color: 'var(--text-muted)' }}>{t.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * "This one has calories — put it in the food log too?"
 *
 * ASKED, NOT ASSUMED. A protein shake is food and belongs in the day's total;
 * a scoop of creatine is not, and neither is a multivitamin. The app can tell
 * the difference from the label (only products with an energy value get here at
 * all) — but the reason this asks rather than deciding is double counting: if
 * the shake was already logged in 饮食 by hand, writing it again silently makes
 * the day read 250 kcal heavier with nothing on screen to explain it.
 *
 * One tap either way, and it only ever appears for the two products in the
 * drawer that actually have calories.
 */
function MealPrompt({ supplement, onConfirm, onClose }) {
  const dose = doseNutrients(supplement);
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 90 }}
      />
      <div style={{
        position: 'fixed', left: '50%', bottom: '16%', transform: 'translateX(-50%)',
        width: 'min(92vw, 380px)', zIndex: 91,
        ...card, padding: '15px 16px', display: 'flex', flexDirection: 'column', gap: '11px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <span style={{ fontSize: '1.2rem' }}>🥤</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.9rem', fontWeight: '700' }}>也记进饮食？</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '3px', lineHeight: 1.6 }}>
              {supplement.name} · {Math.round(num(dose.energy))} kcal
              {dose.protein ? ` · 蛋白质 ${formatAmount(dose.protein)} g` : ''}
              <br />
              如果你已经在饮食里记过了，就按「不用」，免得算两次。
            </div>
          </div>
          <button onClick={onClose} style={iconBtn}><X size={15} /></button>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onClose} className="btn-secondary" style={{ flex: 1 }}>不用</button>
          <button onClick={onConfirm} className="btn-primary" style={{ flex: 1.4 }}>
            <Check size={14} /> 记进饮食
          </button>
        </div>
      </div>
    </>
  );
}

// --------------------------------------------------------------------------
// Form
// --------------------------------------------------------------------------

function SupplementForm({ supplementId, supplements, onSave, onDelete, onCancel }) {
  const existing = supplements.find(s => String(s.id) === String(supplementId));
  const [draft, setDraft] = useState(() => existing ?? normalizeSupplement({
    id: newId(),
    name: '',
    category: 'other',
    form: 'capsule',
    perUnit: {},
    labelServing: 1,
    unitsPerDose: 1,
    frequency: 'daily',
    times: [DEFAULT_TIME],
    startDate: todayStr(),
    at: Date.now(),
  }));

  const patch = (fields) => setDraft(prev => ({ ...prev, ...fields }));
  const dose = doseNutrients(draft);
  const unit = formMeta(draft.form).unit;
  const step = formMeta(draft.form).step;

  const setNutrient = (key, value) => {
    const next = { ...draft.perUnit };
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) delete next[key];
    else next[key] = n;
    patch({ perUnit: next });
  };

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={onCancel}
          style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'none', border: 'none', color: 'var(--color-diet)', cursor: 'pointer', fontSize: '0.82rem', padding: 0 }}
        >
          <ChevronLeft size={18} /> 补充剂
        </button>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          {existing ? '修改' : '新的补充剂'}
        </span>
      </div>

      <input
        autoFocus
        value={draft.name}
        onChange={(e) => patch({ name: e.target.value })}
        placeholder="叫什么？（鱼油、综合维他命…）"
        style={{ ...input, fontSize: '1rem', fontWeight: '700' }}
      />

      <Field label="牌子（可以不写）">
        <input value={draft.brand} onChange={(e) => patch({ brand: e.target.value })} style={input} />
      </Field>

      <Field label="种类">
        <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', paddingBottom: '2px' }}>
          {CATEGORIES.map(c => (
            <Chip key={c.id} active={draft.category === c.id} onClick={() => patch({ category: c.id })}>
              {c.emoji} {c.label}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="单位">
        <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', paddingBottom: '2px' }}>
          {FORMS.map(f => (
            <Chip key={f.id} active={draft.form === f.id} onClick={() => patch({ form: f.id })}>
              {f.label}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label={`一次吃几${unit}`}>
        <input
          type="number" min={step} step={step}
          value={draft.unitsPerDose}
          onChange={(e) => patch({ unitsPerDose: Number(e.target.value) || 0 })}
          style={input}
        />
        {/* The label's own serving, kept visible next to a dose the user may
            have changed. Without it, "3" is a number with no provenance. */}
        {draft.labelServing > 0 && (
          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
            标签一份 = {draft.labelServing} {unit}
            {draft.servingNote ? ` · ${draft.servingNote}` : ''}
          </span>
        )}
      </Field>

      <Field label="多常吃">
        <div style={{ display: 'flex', gap: '5px' }}>
          {FREQUENCIES.map(f => (
            <Chip key={f.value} active={draft.frequency === f.value} onClick={() => patch({ frequency: f.value })}>
              {f.label}
            </Chip>
          ))}
        </div>
      </Field>

      {draft.frequency !== 'asneeded' && (
        <Field label="几点吃">
          <TimeList
            times={draft.times}
            onChange={(times) => patch({ times })}
          />
          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
            同一个时间的补充剂会合成一个通知，不会一个一个响。
          </span>
        </Field>
      )}

      {/* --- what is in one unit ------------------------------------------- */}
      <div style={{ ...card, padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
        <div>
          <div style={{ fontSize: '0.8rem', fontWeight: '700' }}>每 1 {unit} 的含量</div>
          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '2px', lineHeight: 1.6 }}>
            照标签上「每一{unit}」的数字填，不是一份的总量。App 会自己乘上面的份量。
          </div>
        </div>

        <NutrientEditor perUnit={draft.perUnit} onChange={setNutrient} />

        {Object.keys(dose).length > 0 && (
          <div style={{
            background: 'var(--color-diet-soft)', border: '1px solid var(--color-diet)',
            borderRadius: 'var(--radius-sm)', padding: '8px 9px',
          }}>
            <div style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--color-diet)', marginBottom: '4px' }}>
              吃 {describeDose(draft)} 等于
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {Object.entries(dose).map(([key, amount]) => (
                <span key={key} style={{ fontSize: '0.68rem', color: 'var(--text-primary)' }}>
                  {describeNutrient(key, amount)}
                </span>
              )).reduce((acc, el, i) => (i === 0 ? [el] : [...acc, <span key={`sep${i}`} style={{ color: 'var(--text-muted)' }}>·</span>, el]), [])}
            </div>
          </div>
        )}
      </div>

      {/* --- stock --------------------------------------------------------- */}
      <Field label="剩多少（可以不管）">
        <div style={{ display: 'flex', gap: '7px', alignItems: 'center' }}>
          <input
            type="number" min={0}
            value={draft.remainingQuantity ?? ''}
            placeholder="不算"
            onChange={(e) => patch({
              remainingQuantity: e.target.value === '' ? null : Number(e.target.value),
            })}
            style={{ ...input, flex: 1 }}
          />
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', flexShrink: 0 }}>{unit}</span>
        </div>
        {draft.remainingQuantity != null && (
          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
            还够 {dosesRemaining(draft)} 次 · 吃一次自动扣 {draft.unitsPerDose} {unit}
          </span>
        )}
      </Field>

      {draft.remainingQuantity != null && (
        <Field label="剩几次的时候提醒">
          <input
            type="number" min={0}
            value={draft.lowStockDoses}
            onChange={(e) => patch({ lowStockDoses: Number(e.target.value) || DEFAULT_LOW_STOCK_DOSES })}
            style={input}
          />
        </Field>
      )}

      <Field label="备注（可以不写）">
        <textarea
          value={draft.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          rows={2}
          style={{ ...input, resize: 'vertical', lineHeight: 1.5 }}
        />
      </Field>

      {/* --- switches ------------------------------------------------------ */}
      <div style={{ ...card, padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <SwitchRow
          label="到时间提醒我"
          hint={draft.frequency === 'asneeded'
            ? '「需要时」没有固定时间，不会提醒'
            : '还要在通知中心把「补充剂到时间」打开'}
          checked={draft.remindEnabled && draft.frequency !== 'asneeded'}
          disabled={draft.frequency === 'asneeded'}
          onChange={(v) => patch({ remindEnabled: v })}
        />
        <SwitchRow
          label="还在吃"
          hint="关掉就当停了，资料还留着"
          checked={draft.active}
          onChange={(v) => patch({ active: v })}
        />
        {draft.remindEnabled && !notificationsSupported() && (
          <span style={{ fontSize: '0.66rem', color: 'var(--color-diet)' }}>
            浏览器版不会在关掉后提醒 —— 用 Android App 才会响
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={onCancel} className="btn-secondary" style={{ flex: 1 }}>取消</button>
        <button
          onClick={() => onSave({ ...draft, updatedAt: Date.now() })}
          className="btn-primary"
          disabled={!draft.name.trim()}
          style={{ flex: 2, opacity: draft.name.trim() ? 1 : 0.5 }}
        >
          <Check size={15} /> {existing ? '储存' : '加进去'}
        </button>
      </div>

      {existing && (
        <button
          onClick={onDelete}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
            background: 'none', border: '1px solid var(--color-accent-red)',
            color: 'var(--color-accent-red)', borderRadius: 'var(--radius-sm)',
            padding: '8px', fontSize: '0.76rem', cursor: 'pointer',
          }}
        >
          <Trash2 size={13} /> 删掉
        </button>
      )}
    </div>
  );
}

/**
 * The nutrient rows.
 *
 * Existing nutrients first, then a picker for the rest — because a flat list of
 * all thirty would make a fish oil's two numbers a scrolling exercise, and an
 * empty box for every vitamin invites filling them in with guesses.
 */
function NutrientEditor({ perUnit, onChange }) {
  const [adding, setAdding] = useState(false);
  const present = Object.keys(perUnit);
  const absent = Object.keys(NUTRIENTS).filter(k => !present.includes(k));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {present.map(key => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span style={{ flex: 1, fontSize: '0.74rem', minWidth: 0 }}>{nutrientMeta(key).label}</span>
          <input
            type="number" min={0} step="any"
            value={perUnit[key]}
            onChange={(e) => onChange(key, e.target.value)}
            style={{ ...input, width: '92px', padding: '6px 8px', fontSize: '0.78rem' }}
          />
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', width: '30px', flexShrink: 0 }}>
            {nutrientMeta(key).unit}
          </span>
          <button onClick={() => onChange(key, 0)} style={{ ...iconBtn, color: 'var(--color-accent-red)' }}>
            <X size={13} />
          </button>
        </div>
      ))}

      {adding ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '3px' }}>
          {absent.map(key => (
            <button
              key={key}
              onClick={() => { onChange(key, 1); setAdding(false); }}
              style={{
                fontSize: '0.68rem', padding: '4px 8px', cursor: 'pointer',
                background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
              }}
            >
              {nutrientMeta(key).label}
            </button>
          ))}
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{
            alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '4px',
            background: 'none', border: 'none', color: 'var(--color-diet)',
            fontSize: '0.72rem', cursor: 'pointer', padding: '3px 0',
          }}
        >
          <Plus size={12} /> 加一个营养素
        </button>
      )}
    </div>
  );
}

function TimeList({ times, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      {times.map((t, i) => (
        <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="time"
            value={t}
            onChange={(e) => onChange(times.map((x, n) => (n === i ? (e.target.value || DEFAULT_TIME) : x)))}
            style={{ ...input, flex: 1 }}
          />
          {times.length > 1 && (
            <button
              onClick={() => onChange(times.filter((_, n) => n !== i))}
              style={{ ...iconBtn, color: 'var(--color-accent-red)' }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
      {times.length < 4 && (
        <button
          onClick={() => onChange([...times, DEFAULT_TIME])}
          style={{
            alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '4px',
            background: 'none', border: 'none', color: 'var(--color-diet)',
            fontSize: '0.72rem', cursor: 'pointer', padding: '3px 0',
          }}
        >
          <Plus size={12} /> 再加一个时间
        </button>
      )}
    </div>
  );
}

function SwitchRow({ label, hint, checked, disabled, onChange }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      style={{
        display: 'flex', alignItems: 'center', gap: '9px', background: 'none',
        border: 'none', padding: 0, cursor: disabled ? 'default' : 'pointer',
        textAlign: 'left', width: '100%', opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        width: '18px', height: '18px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: checked ? 'var(--color-money-soft)' : 'var(--bg-input)',
        border: `1px solid ${checked ? 'var(--color-money)' : 'var(--border-glass)'}`,
        borderRadius: 'var(--radius-sm)',
        color: checked ? 'var(--color-money)' : 'var(--text-muted)',
      }}>
        {checked ? <Check size={12} /> : <X size={11} />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-primary)' }}>
          {label}
        </span>
        {hint && (
          <span style={{ display: 'block', fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '1px', lineHeight: 1.5 }}>
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: '600' }}>{label}</label>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0,
        background: active ? 'var(--color-diet-soft)' : 'var(--bg-input)',
        border: `1px solid ${active ? 'var(--color-diet)' : 'var(--border-glass)'}`,
        color: active ? 'var(--color-diet)' : 'var(--text-secondary)',
        borderRadius: 'var(--radius-sm)', padding: '6px 10px',
        fontSize: '0.74rem', cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}
