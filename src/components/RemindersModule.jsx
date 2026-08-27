import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Plus, Bell, BellRing, Trash2, Check, ChevronLeft, X, AlertTriangle,
  Clock, Pencil, ShieldCheck,
} from '../utils/icons';
import { usePersistentState, useToday } from '../utils/storage';
import { newId } from '../utils/num';
import { todayStr, shiftDate } from '../utils/datetime';
import {
  REPEATS, WEEKDAY_NAMES, DEFAULT_TIME, normalizeReminders, normalizeReminder,
  nextOccurrence, isOverdue, describeRepeat, describeWhen, occurrenceAt,
  anchorWeekday, anchorDateForWeekday, anchorDateForMonthDay,
} from '../utils/reminders';
import {
  notificationsSupported, checkPermission, requestPermission, pendingCount, explainReason,
} from '../utils/notify';

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
 * Things you have to DO, at a time.
 *
 * List and form share `/reminders/:id?` for the same reason Notes does: one
 * mounted `usePersistentState('reminders')`, and the Android back button gets
 * "form → list → wherever you came from" for free because each step is a real
 * route.
 */
export default function RemindersModule() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [stored, setStored] = usePersistentState('reminders', []);
  const reminders = useMemo(() => normalizeReminders(stored), [stored]);

  const save = (reminder) => setStored(prev => {
    const list = Array.isArray(prev) ? prev : [];
    const i = list.findIndex(r => String(r.id) === String(reminder.id));
    if (i === -1) return [...list, reminder];
    const next = [...list];
    next[i] = reminder;
    return next;
  });

  const remove = (rid) => setStored(prev => (Array.isArray(prev) ? prev : []).filter(r => String(r.id) !== String(rid)));

  if (id) {
    return (
      <ReminderForm
        key={id}
        reminderId={id}
        reminders={reminders}
        onSave={(r) => { save(r); navigate('/reminders'); }}
        onCancel={() => navigate('/reminders')}
      />
    );
  }

  return <RemindersList reminders={reminders} onSave={save} onDelete={remove} />;
}

// --------------------------------------------------------------------------
// Permission banner
// --------------------------------------------------------------------------

/**
 * Says, out loud, whether this device can actually deliver.
 *
 * The worst possible version of this feature is one that looks like it works
 * and silently never fires — you find out by missing something. So the state is
 * on the screen rather than buried, and the ask happens HERE, in the one place
 * where "let LifeManager notify you" obviously means something, instead of
 * being fired at app start where the reflex is to hit Deny.
 */
function PermissionBanner() {
  const [state, setState] = useState('checking');
  const [pending, setPending] = useState(null);

  const refresh = async () => {
    const s = await checkPermission();
    setState(s);
    setPending(await pendingCount());
  };

  useEffect(() => { refresh(); }, []);

  if (state === 'checking') return null;

  if (!notificationsSupported()) {
    return (
      <Banner tone="muted" icon={<AlertTriangle size={14} />}>
        这里是浏览器版 —— 提醒只在 App 开着的时候看得到。要在关掉 App 后也响，得用 Android App。
      </Banner>
    );
  }

  if (state === 'granted') {
    return (
      <Banner tone="good" icon={<ShieldCheck size={14} />}>
        通知已开{pending != null ? ` · 已排程 ${pending} 个` : ''}
      </Banner>
    );
  }

  return (
    <Banner tone={state === 'denied' ? 'bad' : 'warn'} icon={<BellRing size={14} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' }}>
        <span>{explainReason(state)}</span>
        {state !== 'denied' && (
          <button
            onClick={async () => { await requestPermission(); refresh(); }}
            className="btn-primary"
            style={{ padding: '4px 10px', fontSize: '0.72rem' }}
          >
            开启通知
          </button>
        )}
      </div>
    </Banner>
  );
}

const TONES = {
  good: ['var(--color-money)', 'var(--color-money-soft)'],
  warn: ['var(--color-remind)', 'var(--color-remind-soft)'],
  bad: ['var(--color-accent-red)', 'var(--color-accent-red-soft)'],
  muted: ['var(--text-muted)', 'var(--bg-input)'],
};

function Banner({ tone, icon, children }) {
  const [color, soft] = TONES[tone] ?? TONES.muted;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '7px',
      background: soft, border: `1px solid ${color}`, color,
      borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: '0.72rem',
      lineHeight: 1.5,
    }}>
      <span style={{ display: 'flex', flexShrink: 0, marginTop: '1px' }}>{icon}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

// --------------------------------------------------------------------------
// List
// --------------------------------------------------------------------------

function RemindersList({ reminders, onSave, onDelete }) {
  const navigate = useNavigate();
  // Re-read so a reminder's "今天 20:00" doesn't stay frozen at whatever day
  // this screen mounted on — the app stays open for days on Android.
  //
  // Both dependencies are ones the body doesn't name, on purpose: Date.now()
  // reads the clock itself, so the day rolling over and the list changing are
  // what should move it. The linter can't see that; removing them is the bug.
  const today = useToday();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [today, reminders]);

  const { overdue, upcoming, off } = useMemo(() => {
    const withNext = reminders.map(r => ({ r, next: nextOccurrence(r, { now, horizonDays: 400 }) }));
    return {
      overdue: withNext.filter(x => isOverdue(x.r, now)),
      upcoming: withNext.filter(x => x.next).sort((a, b) => a.next.at - b.next.at),
      // Deliberately one bucket: a switched-off reminder and a ticked-off
      // one-off are both "not waiting for me", and two near-identical sections
      // would be more to read for no extra meaning.
      off: withNext.filter(x => !x.next && !isOverdue(x.r, now)),
    };
  }, [reminders, now]);

  const row = ({ r, next }) => (
    <ReminderRow
      key={r.id}
      reminder={r}
      next={next}
      now={now}
      onEdit={() => navigate(`/reminders/${r.id}`)}
      onToggle={() => onSave({ ...r, enabled: !r.enabled, updatedAt: Date.now() })}
      onDone={() => onSave({ ...r, done: !r.done, updatedAt: Date.now() })}
      onDelete={() => onDelete(r.id)}
    />
  );

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: '800' }}>提醒</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>叫我去做某件事</p>
      </div>

      <PermissionBanner />

      <button
        onClick={() => navigate('/reminders/new')}
        className="btn-primary"
        style={{ width: '100%', background: 'linear-gradient(135deg, #f5a524 0%, #d98a10 100%)', boxShadow: '0 4px 14px rgba(245, 165, 36, 0.3)' }}
      >
        <Plus size={16} /> 新提醒
      </button>

      {reminders.length === 0 && (
        <div style={{ ...card, padding: '18px', textAlign: 'center' }}>
          <Bell size={22} color="var(--color-remind)" />
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
            还没有提醒
          </p>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.5 }}>
            「明天交文件」「每个月 10 号看账」「每星期一洗衣服」<br />
            生日和纪念日请用 ⭐ 特别的日子
          </p>
        </div>
      )}

      {overdue.length > 0 && (
        <Group title={`已过期 · ${overdue.length}`} color="var(--color-accent-red)">
          {overdue.map(row)}
        </Group>
      )}

      {upcoming.length > 0 && (
        <Group title={`接下来 · ${upcoming.length}`} color="var(--color-remind)">
          {upcoming.map(row)}
        </Group>
      )}

      {off.length > 0 && (
        <Group title={`已完成 / 已关闭 · ${off.length}`} color="var(--text-muted)">
          {off.map(row)}
        </Group>
      )}
    </div>
  );
}

function Group({ title, color, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <h3 style={{ fontSize: '0.75rem', fontWeight: '700', color, letterSpacing: '0.03em' }}>{title}</h3>
      {children}
    </div>
  );
}

function ReminderRow({ reminder: r, next, now, onEdit, onToggle, onDone, onDelete }) {
  const overdue = isOverdue(r, now);
  const dim = !r.enabled || r.done;

  return (
    <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '9px', padding: '10px 11px', opacity: dim ? 0.55 : 1 }}>
      {/* A one-off gets a tick box; a repeating reminder never can, because the
          next one is always coming. Switching it off is the equivalent. */}
      <button
        onClick={r.repeat === 'once' ? onDone : onToggle}
        title={r.repeat === 'once' ? (r.done ? '取消完成' : '完成') : (r.enabled ? '关掉' : '打开')}
        style={{
          ...iconBtn,
          color: r.done ? 'var(--color-accent-green)' : overdue ? 'var(--color-accent-red)' : 'var(--color-remind)',
        }}
      >
        {r.done ? <Check size={18} /> : r.enabled ? <Bell size={18} /> : <X size={18} />}
      </button>

      <button
        onClick={onEdit}
        style={{ flex: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)', minWidth: 0 }}
      >
        <div style={{
          fontSize: '0.85rem', fontWeight: '700',
          textDecoration: r.done ? 'line-through' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {r.title || '（没有标题）'}
        </div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <Clock size={11} /> {describeRepeat(r)}
          </span>
          {overdue
            ? <span style={{ color: 'var(--color-accent-red)' }}>· 已过期</span>
            : next
              ? <span style={{ color: 'var(--color-remind)' }}>· {describeWhen(next.at, now)}</span>
              : r.done ? <span>· 已完成</span> : <span>· 已关闭</span>}
        </div>
        {r.note && (
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.note}
          </div>
        )}
      </button>

      <button onClick={onEdit} style={iconBtn} title="修改"><Pencil size={14} /></button>
      <button onClick={onDelete} style={{ ...iconBtn, color: 'var(--color-accent-red)' }} title="删除"><Trash2 size={14} /></button>
    </div>
  );
}

// --------------------------------------------------------------------------
// Form
// --------------------------------------------------------------------------

/**
 * A sensible default that is still obviously changeable.
 *
 * Tonight if there is still time before 20:00, otherwise tomorrow — which is
 * what "remind me" almost always means when typed in the evening. The form
 * keeps saying what it picked (see the hint under the date), so the suggestion
 * never turns into a decision made behind your back.
 */
function defaultStart(now = Date.now()) {
  const today = todayStr(new Date(now));
  return occurrenceAt(today, DEFAULT_TIME) > now ? today : shiftDate(today, 1);
}

function ReminderForm({ reminderId, reminders, onSave, onCancel }) {
  const existing = reminders.find(r => String(r.id) === String(reminderId));
  const [draft, setDraft] = useState(() => existing ?? normalizeReminder({
    id: newId(),
    title: '',
    note: '',
    time: DEFAULT_TIME,
    startDate: defaultStart(),
    repeat: 'once',
    at: Date.now(),
  }));

  const patch = (fields) => setDraft(prev => ({ ...prev, ...fields }));
  const preview = nextOccurrence(draft, { horizonDays: 400 });
  const usingDefaults = !existing && draft.startDate === defaultStart() && draft.time === DEFAULT_TIME;

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={onCancel}
          style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'none', border: 'none', color: 'var(--color-remind)', cursor: 'pointer', fontSize: '0.82rem', padding: 0 }}
        >
          <ChevronLeft size={18} /> 提醒
        </button>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          {existing ? '修改提醒' : '新提醒'}
        </span>
      </div>

      <input
        autoFocus
        value={draft.title}
        onChange={(e) => patch({ title: e.target.value })}
        placeholder="要做什么？（交文件、买东西…）"
        style={{ ...input, fontSize: '1rem', fontWeight: '700' }}
      />

      <Field label="重复">
        <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', paddingBottom: '2px' }}>
          {REPEATS.map(rep => (
            <Chip
              key={rep.value}
              active={draft.repeat === rep.value}
              color="var(--color-remind)"
              soft="var(--color-remind-soft)"
              onClick={() => patch({ repeat: rep.value })}
            >
              {rep.label}
            </Chip>
          ))}
        </div>
      </Field>

      {/* The anchor control changes shape with the repeat, because "which day"
          means something different for each — and only one of them is a
          calendar date. All four write the same single `startDate` field. */}
      {draft.repeat === 'weekly' ? (
        <Field label="星期几">
          <div style={{ display: 'flex', gap: '4px' }}>
            {WEEKDAY_NAMES.map((name, i) => (
              <Chip
                key={i}
                active={anchorWeekday(draft) === i}
                color="var(--color-remind)"
                soft="var(--color-remind-soft)"
                onClick={() => patch({ startDate: anchorDateForWeekday(i) })}
                style={{ flex: 1, justifyContent: 'center', padding: '7px 0' }}
              >
                {name}
              </Chip>
            ))}
          </div>
        </Field>
      ) : draft.repeat === 'monthly' ? (
        <Field label="每个月几号">
          <input
            type="number"
            min={1}
            max={31}
            value={Number(draft.startDate.split('-')[2])}
            onChange={(e) => {
              const day = Math.min(31, Math.max(1, Number(e.target.value) || 1));
              patch({ startDate: anchorDateForMonthDay(day) });
            }}
            style={input}
          />
        </Field>
      ) : draft.repeat === 'daily' ? null : (
        <Field label={draft.repeat === 'yearly' ? '每年的哪一天' : '哪一天'}>
          <input
            type="date"
            value={draft.startDate}
            onChange={(e) => patch({ startDate: e.target.value || todayStr() })}
            style={input}
          />
        </Field>
      )}

      <Field label="几点">
        <input
          type="time"
          value={draft.time}
          onChange={(e) => patch({ time: e.target.value || DEFAULT_TIME })}
          style={input}
        />
      </Field>

      <Field label="备注（可以不写）">
        <input
          value={draft.note}
          onChange={(e) => patch({ note: e.target.value })}
          placeholder="记得带身份证…"
          style={input}
        />
      </Field>

      {/* What it will actually do, in words, before you commit to it. */}
      <div style={{ ...card, padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{describeRepeat(draft)}</div>
        <div style={{ fontSize: '0.82rem', fontWeight: '700', color: preview ? 'var(--color-remind)' : 'var(--color-accent-red)' }}>
          {preview ? `下次：${describeWhen(preview.at)}` : '这个时间已经过了 —— 改一下日期或时间'}
        </div>
        {usingDefaults && (
          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
            预设时间，可以改
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={onCancel} className="btn-secondary" style={{ flex: 1 }}>取消</button>
        <button
          onClick={() => onSave({ ...draft, updatedAt: Date.now() })}
          className="btn-primary"
          disabled={!draft.title.trim() || !preview}
          style={{ flex: 2, opacity: (!draft.title.trim() || !preview) ? 0.5 : 1 }}
        >
          <Check size={15} /> {existing ? '储存' : '建立提醒'}
        </button>
      </div>
    </div>
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

function Chip({ active, color, soft, onClick, children, style }) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: '4px',
        background: active ? soft : 'var(--bg-input)',
        border: `1px solid ${active ? color : 'var(--border-glass)'}`,
        color: active ? color : 'var(--text-secondary)',
        borderRadius: 'var(--radius-sm)', padding: '6px 10px',
        fontSize: '0.74rem', cursor: 'pointer', whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
