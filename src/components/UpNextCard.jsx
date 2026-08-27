import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, ChevronRight } from '../utils/icons';
import { useLiveJSON, useToday } from '../utils/storage';
import { upNextRows } from '../utils/upNext';

/**
 * The next few things due, on the landing screen.
 *
 * DELIBERATELY SMALL. The brief said not to grow the dashboard, and it is
 * already the densest screen in the app — so this is three rows with no chart,
 * no totals and no controls, and it renders NOTHING at all when there is
 * nothing coming. An empty "UP NEXT" card teaching you that you have no
 * reminders is worse than no card, which is the same rule 本周 follows.
 *
 * Reads through `useLiveJSON` rather than props: reminders and special days are
 * owned by their own screens, and a reminder created there has to appear here
 * without waiting for a tab switch to remount anything (see storage.js).
 */
export default function UpNextCard() {
  const navigate = useNavigate();
  const reminders = useLiveJSON('reminders', []);
  const specialDays = useLiveJSON('specialDays', []);
  // The app is left open for days on Android, so "今天 20:00" has to be
  // recomputed as the date moves, not frozen at whenever this mounted.
  const today = useToday();

  const rows = useMemo(
    () => upNextRows({ reminders, specialDays, now: Date.now(), limit: 3 }),
    // `today` is a dependency the body doesn't name on purpose: Date.now() reads
    // the clock itself, so the date IS the cache key. Removing it is the bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reminders, specialDays, today],
  );

  if (rows.length === 0) return null;

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Bell size={14} color="var(--color-remind)" />
        <h3 style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--color-remind)', letterSpacing: '0.03em' }}>
          UP NEXT · 接下来
        </h3>
      </div>

      {rows.map(row => (
        <button
          key={`${row.kind}:${row.sourceId}`}
          onClick={() => navigate(row.kind === 'reminder' ? '/reminders' : '/special')}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
            borderRadius: 'var(--radius-sm)', padding: '7px 9px',
            cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)',
          }}
        >
          <span style={{ fontSize: '0.95rem', flexShrink: 0 }}>{row.emoji}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.title}
            </span>
            <span style={{
              display: 'block', fontSize: '0.66rem', marginTop: '1px',
              color: row.kind === 'reminder' ? 'var(--color-remind)' : 'var(--color-special)',
            }}>
              {row.when}{row.detail ? ` · ${row.detail}` : ''}
            </span>
          </span>
          <ChevronRight size={13} color="var(--text-muted)" />
        </button>
      ))}
    </div>
  );
}
