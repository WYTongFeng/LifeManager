import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, BellRing, Check, ChevronRight, AlertTriangle, ShieldCheck, X,
} from '../utils/icons';
import { useLiveJSON, saveJSON, loadJSON } from '../utils/storage';
import { newId } from '../utils/num';
import { todayStr } from '../utils/datetime';
import { normalizeNotificationSettings, sourceMeta, NUDGE_KINDS } from '../utils/notifications';
import {
  notificationsSupported, checkPermission, requestPermission, pendingCount,
  explainReason, cancelAllScheduled, MAX_SCHEDULED,
} from '../utils/notify';
import { normalizeSupplements } from '../utils/supplements';

const card = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-glass)',
  borderRadius: 'var(--radius-md)',
};

/**
 * 通知中心 — one place that answers "what does the app want me to know or do".
 *
 * DELIBERATELY NOT A FEED. There is no history, no read/unread, no archive, and
 * nothing here is stored. Every row is DERIVED from the same records the
 * scheduler reads, so the screen and the phone can never disagree — and a row
 * disappears when the thing behind it is dealt with, rather than piling up as a
 * log of buzzes you already saw. A notification is a request for attention; once
 * it has your attention it has no further reason to exist.
 *
 * WHAT IT REPLACES
 * A dropdown in the header that listed three hard-coded conditions in English,
 * had no relationship to anything the OS ever announced, and could not be
 * tapped. Its three alerts are still here — they were real — but as one section
 * of something that also knows about reminders, special days, supplements,
 * bills and the logging nudges.
 */
export default function NotificationCenter({ groups }) {
  const navigate = useNavigate();
  const storedSettings = useLiveJSON('notificationSettings', null);
  const settings = useMemo(
    () => normalizeNotificationSettings(storedSettings), [storedSettings],
  );

  // --- the two actions a row can take without leaving this screen ----------
  //
  // Both write through `saveJSON` rather than a `usePersistentState` setter,
  // because the records they touch are owned by screens that are not mounted.
  // Two instances of the same key drift until one remounts — see storage.js —
  // so anything with more than one writer reads live and writes through here.

  const completeReminder = (id) => {
    const list = loadJSON('reminders', []);
    saveJSON('reminders', (Array.isArray(list) ? list : []).map(r =>
      String(r.id) === String(id) ? { ...r, done: true, updatedAt: Date.now() } : r
    ));
  };

  const takeSupplement = (id, time) => {
    const sup = normalizeSupplements(loadJSON('supplements', []))
      .find(s => String(s.id) === String(id));
    if (!sup) return;
    const log = loadJSON('supplementLog', []);
    const at = Date.now();
    saveJSON('supplementLog', [
      ...(Array.isArray(log) ? log : []),
      { id: newId(), supplementId: sup.id, date: todayStr(), time, units: sup.unitsPerDose, at, updatedAt: at },
    ]);
    // Stock only moves when it is being tracked. Writing 0 for an untracked
    // bottle would turn "I don't count these" into "I have none left", which
    // then raises a low-stock warning about a bottle that is probably full.
    if (sup.remainingQuantity != null) {
      const all = loadJSON('supplements', []);
      saveJSON('supplements', (Array.isArray(all) ? all : []).map(s =>
        String(s.id) === String(id)
          ? { ...s, remainingQuantity: Math.max(0, Number(s.remainingQuantity) - sup.unitsPerDose), updatedAt: at }
          : s
      ));
    }
    // NOTE: no meal prompt here, unlike the supplement screen's own tick. This
    // row exists because something was MISSED, and interrupting a catch-up tap
    // with a second question about the food log is one question too many at the
    // wrong moment. The shake can still be logged from 补充剂 itself.
  };

  const runAction = (action) => {
    if (!action) return;
    if (action.kind === 'completeReminder') completeReminder(action.id);
    if (action.kind === 'takeSupplement') takeSupplement(action.id, action.time);
  };

  const nothing = groups.attention.length === 0
    && groups.today.length === 0
    && groups.upcoming.length === 0;

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: '800' }}>通知中心</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>要我知道什么、要我做什么</p>
      </div>

      <PermissionBanner />

      {nothing && (
        <div style={{ ...card, padding: '20px', textAlign: 'center' }}>
          <ShieldCheck size={24} color="var(--color-money)" />
          <p style={{ fontSize: '0.85rem', fontWeight: '700', marginTop: '8px' }}>没什么事</p>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.6 }}>
            该记的都记了，也没有到期的东西。<br />
            有提醒、特别的日子、补充剂或账单到时间，会出现在这里。
          </p>
        </div>
      )}

      {groups.attention.length > 0 && (
        <Section title={`需要注意 · ${groups.attention.length}`} color="var(--color-accent-red)">
          {groups.attention.map(row => (
            <Row
              key={row.key}
              row={row}
              onOpen={() => navigate(row.route)}
              onAct={row.action ? () => runAction(row.action) : null}
            />
          ))}
        </Section>
      )}

      {groups.today.length > 0 && (
        <Section title={`今天 · ${groups.today.length}`} color="var(--color-remind)">
          {groups.today.map(row => (
            <Row key={row.key} row={row} onOpen={() => navigate(row.route)} />
          ))}
        </Section>
      )}

      {groups.upcoming.length > 0 && (
        <Section title={`接下来 · ${groups.upcoming.length}`} color="var(--text-secondary)">
          {groups.upcoming.map(row => (
            <Row key={row.key} row={row} onOpen={() => navigate(row.route)} showDate />
          ))}
        </Section>
      )}

      <SettingsPanel settings={settings} />
    </div>
  );
}

// --------------------------------------------------------------------------
// Rows
// --------------------------------------------------------------------------

function Section({ title, color, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <h3 style={{ fontSize: '0.75rem', fontWeight: '700', color, letterSpacing: '0.03em' }}>{title}</h3>
      {children}
    </div>
  );
}

const TONE_COLOR = {
  bad: 'var(--color-accent-red)',
  warn: 'var(--color-diet)',
  good: 'var(--color-money)',
  info: 'var(--border-glass)',
};

function Row({ row, onOpen, onAct, showDate }) {
  const meta = sourceMeta(row.source);
  const when = new Date(row.at);
  const time = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const date = `${when.getMonth() + 1}月${when.getDate()}日`;

  return (
    <div style={{
      ...card,
      borderColor: TONE_COLOR[row.tone] ?? 'var(--border-glass)',
      display: 'flex', alignItems: 'center', gap: '9px', padding: '10px 11px',
    }}>
      {/* The tick is only offered where acting from HERE is genuinely the whole
          job — "I already did that" for an overdue reminder, "just took it" for
          a supplement. Everything else opens its module, because everything else
          needs a decision this screen has no room to present. */}
      {onAct && (
        <button
          onClick={onAct}
          title="标记完成"
          style={{
            background: 'var(--color-money-soft)', border: '1px solid var(--color-money)',
            color: 'var(--color-money)', borderRadius: 'var(--radius-sm)',
            padding: '5px', display: 'flex', cursor: 'pointer', flexShrink: 0,
          }}
        >
          <Check size={15} />
        </button>
      )}

      <button
        onClick={onOpen}
        style={{
          flex: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          textAlign: 'left', color: 'var(--text-primary)', minWidth: 0,
          display: 'flex', alignItems: 'center', gap: '9px',
        }}
      >
        <span style={{ fontSize: '1rem', flexShrink: 0 }}>{row.emoji}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'block', fontSize: '0.82rem', fontWeight: '700',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {row.title}
          </span>
          {row.body && (
            <span style={{
              display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {row.body}
            </span>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.64rem', color: meta.color, marginTop: '3px' }}>
            <span>{meta.label}</span>
            {row.tone === 'info' && (
              <span style={{ color: 'var(--text-muted)' }}>
                · {showDate ? `${date} ${time}` : time}
              </span>
            )}
            {row.recurrence && <span style={{ color: 'var(--text-muted)' }}>· {row.recurrence}</span>}
          </span>
        </span>
        <ChevronRight size={13} color="var(--text-muted)" />
      </button>
    </div>
  );
}

// --------------------------------------------------------------------------
// Permission
// --------------------------------------------------------------------------

/**
 * Says out loud whether this device can actually deliver.
 *
 * The worst possible version of this feature is one that looks like it works
 * and silently never fires — you find out by missing something. Moved here from
 * the reminders screen, which is where it used to be the ONLY copy: a user who
 * only ever opened 补充剂 or 记账 had no way to discover the permission was off.
 */
function PermissionBanner() {
  const [state, setState] = useState('checking');
  const [pending, setPending] = useState(null);

  const refresh = async () => {
    setState(await checkPermission());
    setPending(await pendingCount());
  };

  useEffect(() => { refresh(); }, []);

  if (state === 'checking') return null;

  if (!notificationsSupported()) {
    return (
      <Banner tone="muted" icon={<AlertTriangle size={14} />}>
        这里是浏览器版 —— 通知只在 App 开着的时候看得到。要在关掉 App 后也响，得用 Android App。
      </Banner>
    );
  }

  if (state === 'granted') {
    return (
      <Banner tone="good" icon={<ShieldCheck size={14} />}>
        通知已开{pending != null ? ` · 已排程 ${pending} 个` : ''}
        {/* The window is finite and the cap is not obvious. Said only when it
            is actually reached, because a limit you are nowhere near is noise. */}
        {pending != null && pending >= MAX_SCHEDULED && (
          <div style={{ marginTop: '3px', color: 'var(--color-diet)' }}>
            已经排满了（上限 {MAX_SCHEDULED} 个）—— 最近的会先响。
          </div>
        )}
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
// Settings
// --------------------------------------------------------------------------

/**
 * Which sources may notify.
 *
 * 提醒 and 特别的日子 have no switch on purpose: they are modules whose entire
 * job is to notify, and a switch that turns them off would leave two screens
 * that quietly do nothing. Everything added since is off until switched on —
 * an upgrade that starts buzzing about things nobody asked for is the fastest
 * way to have the whole app silenced at the OS level.
 */
function SettingsPanel({ settings }) {
  const [open, setOpen] = useState(false);
  const write = (next) => saveJSON('notificationSettings', next);

  const patch = (fields) => write({ ...settings, ...fields });

  return (
    <div style={{ ...card, padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '7px', background: 'none',
          border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-primary)',
        }}
      >
        <Bell size={14} color="var(--text-secondary)" />
        <span style={{ flex: 1, textAlign: 'left', fontSize: '0.8rem', fontWeight: '700' }}>通知设定</span>
        <ChevronRight
          size={14}
          color="var(--text-muted)"
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
        />
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
          <Toggle
            label="全部通知"
            hint="关掉的话，手机上一个都不会响"
            checked={settings.enabled}
            onChange={async (v) => {
              patch({ enabled: v });
              // The one place `cancelAllScheduled` has ever been called. Without
              // it, switching off would stop NEW alarms while the OS kept every
              // one it already held — up to 60 days of notifications from a
              // feature the user just turned off.
              if (!v) await cancelAllScheduled();
            }}
          />

          <div style={{ height: '1px', background: 'var(--border-glass)' }} />

          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: '600' }}>
            提醒 · 特别的日子 一直开着
          </div>

          <Toggle
            label="补充剂到时间"
            hint="同一个时间的合成一个通知"
            checked={settings.supplements.enabled}
            onChange={(v) => patch({ supplements: { ...settings.supplements, enabled: v } })}
          />
          <Toggle
            label="补充剂快没了"
            hint="剩下的份数低过设定时说一次"
            checked={settings.supplements.lowStock}
            onChange={(v) => patch({ supplements: { ...settings.supplements, lowStock: v } })}
          />

          <div style={{ height: '1px', background: 'var(--border-glass)' }} />

          <Toggle
            label="账单到期"
            hint={`固定开销扣钱前 ${settings.bills.daysBefore} 天提醒`}
            checked={settings.bills.enabled}
            onChange={(v) => patch({ bills: { ...settings.bills, enabled: v } })}
          />
          {settings.bills.enabled && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', paddingLeft: '4px' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>提前</span>
              <input
                type="number" min={0} max={14}
                value={settings.bills.daysBefore}
                onChange={(e) => patch({ bills: { ...settings.bills, daysBefore: Number(e.target.value) } })}
                style={{
                  width: '52px', background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', padding: '5px 7px',
                  fontSize: '0.78rem', fontFamily: 'var(--font-main)',
                }}
              />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>天 ·</span>
              <input
                type="time"
                value={settings.bills.time}
                onChange={(e) => patch({ bills: { ...settings.bills, time: e.target.value } })}
                style={{
                  background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', padding: '5px 7px',
                  fontSize: '0.78rem', fontFamily: 'var(--font-main)',
                }}
              />
            </div>
          )}

          <div style={{ height: '1px', background: 'var(--border-glass)' }} />

          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: '600' }}>
            记录提醒 —— 只有在真的没记的时候才响
          </div>

          {NUDGE_KINDS.map(kind => (
            <div key={kind.id} style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <Toggle
                label={`${kind.emoji} ${kind.label}`}
                checked={settings.nudges[kind.id].enabled}
                onChange={(v) => patch({
                  nudges: { ...settings.nudges, [kind.id]: { ...settings.nudges[kind.id], enabled: v } },
                })}
              />
              {settings.nudges[kind.id].enabled && (
                <input
                  type="time"
                  value={settings.nudges[kind.id].time}
                  onChange={(e) => patch({
                    nudges: { ...settings.nudges, [kind.id]: { ...settings.nudges[kind.id], time: e.target.value } },
                  })}
                  style={{
                    alignSelf: 'flex-start', marginLeft: '4px',
                    background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
                    borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', padding: '5px 7px',
                    fontSize: '0.78rem', fontFamily: 'var(--font-main)',
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex', alignItems: 'center', gap: '9px', background: 'none',
        border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%',
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
          <span style={{ display: 'block', fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '1px' }}>
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}
