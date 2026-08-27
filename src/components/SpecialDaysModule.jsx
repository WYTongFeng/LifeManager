import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Plus, Star, Trash2, Check, ChevronLeft, Pencil, Bell,
} from '../utils/icons';
import { usePersistentState, useToday } from '../utils/storage';
import { newId } from '../utils/num';
import { todayStr } from '../utils/datetime';
import { notificationsSupported } from '../utils/notify';
import {
  SPECIAL_EMOJI, DEFAULT_EMOJI, REMIND_OPTIONS, DEFAULT_REMIND_TIME,
  normalizeSpecialDays, normalizeSpecialDay, nextDate, daysUntil,
  describeCountdown, describeMonthDay, occurrenceNumber, sortUpcoming,
} from '../utils/specialDays';

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
 * Dates worth remembering — birthdays, anniversaries, the day something
 * happened.
 *
 * Kept apart from 提醒 on purpose (see specialDays.js): a reminder is a task
 * with a deadline that you tick off, and a birthday is neither. Sharing one
 * screen would mean explaining why some rows have a checkbox and some don't.
 */
export default function SpecialDaysModule() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [stored, setStored] = usePersistentState('specialDays', []);
  const days = useMemo(() => normalizeSpecialDays(stored), [stored]);

  const save = (day) => setStored(prev => {
    const list = Array.isArray(prev) ? prev : [];
    const i = list.findIndex(d => String(d.id) === String(day.id));
    if (i === -1) return [...list, day];
    const next = [...list];
    next[i] = day;
    return next;
  });

  const remove = (did) => setStored(prev => (Array.isArray(prev) ? prev : []).filter(d => String(d.id) !== String(did)));

  if (id) {
    return (
      <SpecialDayForm
        key={id}
        dayId={id}
        days={days}
        onSave={(d) => { save(d); navigate('/special'); }}
        onCancel={() => navigate('/special')}
      />
    );
  }

  return <SpecialDaysList days={days} onDelete={remove} />;
}

// --------------------------------------------------------------------------
// List
// --------------------------------------------------------------------------

function SpecialDaysList({ days, onDelete }) {
  const navigate = useNavigate();
  // The countdowns are the whole screen, and this app stays open for days on a
  // phone — frozen at mount they would count down to the wrong number.
  const today = useToday();

  const { upcoming, past } = useMemo(() => {
    const sorted = sortUpcoming(days, today);
    return {
      upcoming: sorted.filter(d => daysUntil(d, today) != null),
      // Only a non-yearly date can ever end up here; a yearly one always has a
      // next occurrence.
      past: sorted.filter(d => daysUntil(d, today) == null),
    };
  }, [days, today]);

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: '800' }}>特别的日子</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>生日 · 纪念日 · 重要日期</p>
      </div>

      <button
        onClick={() => navigate('/special/new')}
        className="btn-primary"
        style={{ width: '100%', background: 'linear-gradient(135deg, #ff7ab8 0%, #e3559a 100%)', boxShadow: '0 4px 14px rgba(255, 122, 184, 0.3)' }}
      >
        <Plus size={16} /> 加一个日子
      </button>

      {days.length === 0 && (
        <div style={{ ...card, padding: '18px', textAlign: 'center' }}>
          <Star size={22} color="var(--color-special)" />
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
            还没有记下任何日子
          </p>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.5 }}>
            🎂 朋友生日 · ❤️ 纪念日 · 🎓 毕业<br />
            预设每年重复，提醒可开可不开
          </p>
        </div>
      )}

      {upcoming.map(d => (
        <SpecialRow
          key={d.id}
          day={d}
          today={today}
          onEdit={() => navigate(`/special/${d.id}`)}
          onDelete={() => onDelete(d.id)}
        />
      ))}

      {past.length > 0 && (
        <>
          <h3 style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)' }}>已经过了</h3>
          {past.map(d => (
            <SpecialRow
              key={d.id}
              day={d}
              today={today}
              onEdit={() => navigate(`/special/${d.id}`)}
              onDelete={() => onDelete(d.id)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function SpecialRow({ day, today, onEdit, onDelete }) {
  const days = daysUntil(day, today);
  const nth = occurrenceNumber(day, today);
  const remind = REMIND_OPTIONS.find(o => o.value === day.remind);
  // Today and tomorrow get the accent; anything further out is just a date, and
  // colouring every row makes none of them stand out.
  const soon = days != null && days <= 1;

  return (
    <div style={{
      ...card,
      display: 'flex', alignItems: 'center', gap: '11px', padding: '11px 12px',
      borderColor: soon ? 'var(--color-special)' : 'var(--border-glass)',
      opacity: days == null ? 0.55 : 1,
    }}>
      {/* The date, as a block — this screen is read by scanning down the dates,
          so they line up in a fixed-width column rather than inside a sentence. */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minWidth: '48px', padding: '5px 6px', flexShrink: 0,
        background: 'var(--color-special-soft)', borderRadius: 'var(--radius-sm)',
      }}>
        <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>{day.emoji || DEFAULT_EMOJI}</span>
        <span style={{ fontSize: '0.62rem', color: 'var(--color-special)', marginTop: '3px', fontFamily: 'var(--font-pixel-retro)' }}>
          {describeMonthDay(day, today)}
        </span>
      </div>

      <button
        onClick={onEdit}
        style={{ flex: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)', minWidth: 0 }}
      >
        <div style={{ fontSize: '0.88rem', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {day.title || '（没有名字）'}
        </div>
        <div style={{ fontSize: '0.68rem', color: soon ? 'var(--color-special)' : 'var(--text-muted)', marginTop: '2px' }}>
          {describeCountdown(day, today)}
          {day.yearly ? ' · 每年' : ''}
          {/* The one thing a paper calendar can't tell you. */}
          {nth ? ` · 第 ${nth} 年` : ''}
        </div>
        {remind?.days != null && (
          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <Bell size={10} /> {remind.label} {day.remindTime}
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

function SpecialDayForm({ dayId, days, onSave, onCancel }) {
  const existing = days.find(d => String(d.id) === String(dayId));
  const [draft, setDraft] = useState(() => existing ?? normalizeSpecialDay({
    id: newId(),
    title: '',
    emoji: '🎂',
    date: todayStr(),
    yearly: true,
    remind: 'day',
    remindTime: DEFAULT_REMIND_TIME,
    at: Date.now(),
  }));

  const patch = (fields) => setDraft(prev => ({ ...prev, ...fields }));
  const next = nextDate(draft, todayStr());
  const nth = occurrenceNumber(draft, todayStr());

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={onCancel}
          style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'none', border: 'none', color: 'var(--color-special)', cursor: 'pointer', fontSize: '0.82rem', padding: 0 }}
        >
          <ChevronLeft size={18} /> 特别的日子
        </button>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          {existing ? '修改' : '新的日子'}
        </span>
      </div>

      <input
        autoFocus
        value={draft.title}
        onChange={(e) => patch({ title: e.target.value })}
        placeholder="是什么日子？（阿明生日、我们的纪念日…）"
        style={{ ...input, fontSize: '1rem', fontWeight: '700' }}
      />

      <Field label="图案">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {SPECIAL_EMOJI.map(e => (
            <button
              key={e}
              onClick={() => patch({ emoji: e })}
              style={{
                fontSize: '1.05rem', lineHeight: 1, padding: '6px',
                background: draft.emoji === e ? 'var(--color-special-soft)' : 'var(--bg-input)',
                border: `1px solid ${draft.emoji === e ? 'var(--color-special)' : 'var(--border-glass)'}`,
                borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              }}
            >
              {e}
            </button>
          ))}
        </div>
      </Field>

      <Field label="日期">
        <input
          type="date"
          value={draft.date ?? todayStr()}
          onChange={(e) => patch({ date: e.target.value || todayStr() })}
          style={input}
        />
        {/* The year is what makes 「第 N 年」 and 「N 岁」 possible at all — worth
            one line explaining, since a birthday form asking for a year looks
            like a pointless question otherwise. */}
        <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
          填原本那一年（出生年、在一起那年），App 才算得出第几年
        </span>
      </Field>

      <Field label="重复">
        <div style={{ display: 'flex', gap: '5px' }}>
          <Chip active={draft.yearly} onClick={() => patch({ yearly: true })}>每年</Chip>
          <Chip active={!draft.yearly} onClick={() => patch({ yearly: false })}>只有这一次</Chip>
        </div>
      </Field>

      <Field label="提醒">
        <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', paddingBottom: '2px' }}>
          {REMIND_OPTIONS.map(o => (
            <Chip key={o.value} active={draft.remind === o.value} onClick={() => patch({ remind: o.value })}>
              {o.label}
            </Chip>
          ))}
        </div>
      </Field>

      {draft.remind !== 'none' && (
        <Field label="几点提醒">
          <input
            type="time"
            value={draft.remindTime}
            onChange={(e) => patch({ remindTime: e.target.value || DEFAULT_REMIND_TIME })}
            style={input}
          />
          {!notificationsSupported() && (
            <span style={{ fontSize: '0.66rem', color: 'var(--color-diet)' }}>
              浏览器版不会在关掉后提醒 —— 用 Android App 才会响
            </span>
          )}
        </Field>
      )}

      <div style={{ ...card, padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <div style={{ fontSize: '0.82rem', fontWeight: '700', color: next ? 'var(--color-special)' : 'var(--text-muted)' }}>
          {next
            ? `${draft.emoji} ${describeMonthDay(draft, todayStr())} · ${describeCountdown(draft, todayStr())}`
            : '这个日子已经过了，而且不重复'}
        </div>
        {nth ? <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>那天是第 {nth} 年</div> : null}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={onCancel} className="btn-secondary" style={{ flex: 1 }}>取消</button>
        <button
          onClick={() => onSave({ ...draft, updatedAt: Date.now() })}
          className="btn-primary"
          disabled={!draft.title.trim()}
          style={{ flex: 2, opacity: draft.title.trim() ? 1 : 0.5 }}
        >
          <Check size={15} /> {existing ? '储存' : '记下来'}
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

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0,
        background: active ? 'var(--color-special-soft)' : 'var(--bg-input)',
        border: `1px solid ${active ? 'var(--color-special)' : 'var(--border-glass)'}`,
        color: active ? 'var(--color-special)' : 'var(--text-secondary)',
        borderRadius: 'var(--radius-sm)', padding: '6px 10px',
        fontSize: '0.74rem', cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}
