import React, { useEffect, useState } from 'react';
import { ClipboardPaste } from '../utils/icons';
import { usePersistentState } from '../utils/storage';
import { parseTngNotification, worthSurfacing } from '../utils/tngParser';

/**
 * The closest a plain web app can get to Android's real notification listener
 * (M12) without needing the native APK: copy a TNG notification, switch back
 * to LifeManager (already open), and it checks the clipboard the moment the
 * tab/window regains focus — no manual "open reader, paste" step.
 *
 * Deliberately opt-in and off by default. Silently polling the clipboard is
 * not something a finance app should do without being asked, and most
 * browsers require a direct user gesture before granting clipboard-read
 * access anyway — flipping the toggle IS that gesture.
 *
 * No AI here either, same as the rest of tngParser.js — this only decides
 * WHEN to run the existing pattern-matching parser, never adds a second way
 * of reading the text.
 */
export default function ClipboardWatch({ learned, onDetected }) {
  const [enabled, setEnabled] = usePersistentState('clipboardWatchEnabled', false);
  // Raw clipboard text, kept only to tell "the same thing I already checked"
  // from "something new was just copied" — device-local by nature (see
  // LOCAL_ONLY_KEYS in syncModel.js), a synced clipboard would just leak
  // whatever unrelated text either device happened to have copied.
  const [lastSeen, setLastSeen] = usePersistentState('clipboardLastSeen', '');
  const [permissionDenied, setPermissionDenied] = useState(false);

  const supported = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText);

  const checkClipboard = async () => {
    if (!supported) return;
    try {
      const text = await navigator.clipboard.readText();
      setPermissionDenied(false);
      if (!text || text === lastSeen) return;
      setLastSeen(text);

      const parsed = parseTngNotification(text, learned);
      if (worthSurfacing(parsed)) onDetected(text);
    } catch {
      // Permission not granted (yet), or the clipboard API refused — this
      // runs silently on every focus, so there's nothing to show for a
      // background check failing beyond the status line below.
      setPermissionDenied(true);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => { if (!document.hidden) checkClipboard(); };
    window.addEventListener('focus', checkClipboard);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', checkClipboard);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lastSeen, learned]);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    // Turning it on IS the direct user gesture — ask for permission right
    // here instead of waiting for the next focus event, which some browsers
    // won't count as a strong enough gesture to grant clipboard access.
    if (next) await checkClipboard();
  };

  if (!supported) return null; // nothing to offer on a browser without the API

  return (
    <div className="glass-card" style={{
      padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between',
      alignItems: 'center', gap: '10px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <div style={{
          width: '36px', height: '36px', borderRadius: 'var(--radius-sm)', flexShrink: 0,
          background: enabled ? 'var(--color-money-soft)' : 'var(--bg-card-hover)',
          color: enabled ? 'var(--color-money)' : 'var(--text-muted)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ClipboardPaste size={19} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: '700' }}>剪贴板自动侦测</div>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            {enabled
              ? (permissionDenied
                ? '没有剪贴板权限 — 浏览器设定里检查一下'
                : '复制 TNG 通知后切回来会自动弹出确认')
              : '复制通知、切回这个 app，自动跳出确认，不用手动开阅读器'}
          </span>
        </div>
      </div>
      <button
        onClick={toggle}
        role="switch"
        aria-checked={enabled}
        aria-label="切换剪贴板自动侦测"
        style={{
          width: '42px', height: '24px', borderRadius: 'var(--radius-md)', flexShrink: 0,
          background: enabled ? 'var(--color-money)' : 'var(--bg-input)',
          border: `1px solid ${enabled ? 'var(--color-money)' : 'var(--border-glass)'}`,
          position: 'relative', cursor: 'pointer', padding: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: '2px', left: enabled ? '20px' : '2px',
          width: '18px', height: '18px', borderRadius: '50%', background: 'white',
          transition: 'left 0.15s ease',
        }} />
      </button>
    </div>
  );
}
