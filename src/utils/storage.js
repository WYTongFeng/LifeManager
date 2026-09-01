import { useState, useEffect } from 'react';

const PREFIX = 'lifemanager:';

// Fired after any persisted write. Cloud sync listens for this to know when
// there is something new to push, instead of polling or diffing on a timer.
export const CHANGE_EVENT = 'lifemanager:changed';

// Keys that describe sync/backup bookkeeping rather than user data. Writing
// them must not schedule another push, or every push triggers a fresh push.
const META_KEYS = ['lastBackupAt', 'lastSyncedAt', 'deviceId', 'cloudSyncEnabled'];

export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Write a persisted key from outside a `usePersistentState` hook, firing the
 * same change event so every `useLiveJSON` reader updates immediately.
 *
 * Exists because `accounts` now has more than one writer: AccountsView edits
 * them, and the notification-capture card binds a phone app to one. Two
 * independent `usePersistentState` instances for the same key silently drift
 * apart until one remounts — so anything with several writers reads through
 * `useLiveJSON` and writes through here instead, giving exactly one write path
 * and no stale copies.
 */
export function saveJSON(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    if (!META_KEYS.includes(key)) {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key } }));
    }
  } catch (e) {
    console.warn('Failed to persist', key, e);
  }
}

export function usePersistentState(key, initialValue) {
  const [state, setState] = useState(() => loadJSON(key, initialValue));

  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(state));
      if (!META_KEYS.includes(key)) {
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key } }));
      }
    } catch (e) {
      console.warn('Failed to persist', key, e);
    }
  }, [key, state]);

  return [state, setState];
}

/**
 * Read-only view of a persisted key that stays live even when the write
 * happens through a DIFFERENT `usePersistentState` instance for the same key
 * (e.g. accounts edited inside AccountsView, read here by App.jsx for the
 * survival-mode banner). Plain `usePersistentState` only syncs its own writes
 * — two independent instances of it for the same key drift out of sync until
 * one of them remounts. This one re-reads on the CHANGE_EVENT every write
 * already fires, so it never goes stale without needing a tab switch.
 */
export function useLiveJSON(key, fallback) {
  const [state, setState] = useState(() => loadJSON(key, fallback));

  useEffect(() => {
    const onChange = (e) => {
      if (e.detail?.key === key) setState(loadJSON(key, fallback));
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

// Local calendar date as YYYY-MM-DD (not toISOString, which is UTC and shifts near midnight)
export function getTodayString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Today's date, kept CURRENT while the app stays open.
 *
 * THE BUG THIS EXISTS TO KILL, IN THREE PLACES AT ONCE
 * Several screens captured the date once and never let go:
 *
 *   Dashboard   `useMemo(() => getTodayString(), [])` — the 7-day strip and the
 *               "today" pill froze at whatever day the component mounted on.
 *   CycleView   `useMemo(() => getCycle(), [])` — the whole monthly budget. Its
 *               `daysRemaining` is the divisor for the daily safe limit, so a
 *               stale one hands out yesterday's allowance; and left open across
 *               a month boundary it kept budgeting the PREVIOUS cycle entirely.
 *   App.jsx     the same `getCycle()`, feeding the survival banner's
 *               "这个月还剩 N 天".
 *
 * On a desktop tab you'd get away with it. This ships as an Android APK, where
 * "the app was never actually closed" is the normal state — the WebView is
 * suspended and resumed for days on end — so mount time and now are routinely
 * different days. App.jsx's rollover already re-checked the date on a timer and
 * on visibilitychange for exactly this reason; these screens just had no way to
 * hear about it.
 *
 * Deliberately a hook rather than a prop threaded down from App.jsx: CycleView
 * sits three components deep behind MoneyModule, and a screen that renders a
 * date-dependent number should be able to stay honest without its parents
 * having to cooperate.
 *
 * Both signals, same pair App.jsx's rollover uses: the interval covers a device
 * left awake on this screen, visibilitychange covers the far more common case of
 * a suspended WebView coming back.
 */
export function useToday() {
  const [today, setToday] = useState(getTodayString);

  useEffect(() => {
    const check = () => setToday(prev => {
      const now = getTodayString();
      // Same string means the same render, so React bails out — this can tick
      // once a minute forever without causing a single re-render.
      return prev === now ? prev : now;
    });
    const interval = setInterval(check, 60_000);
    const onVisible = () => { if (!document.hidden) check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return today;
}

/**
 * A Date that re-reads the clock once a minute.
 *
 * For figures that move on their own with no user action and no new record —
 * resting calories burned so far today being the one that forced this to exist.
 * Same shape and the same reasons as useToday() above: the app stays open for
 * days on a phone (see MILESTONES.md), so anything computed from `new Date()`
 * at render time is frozen at whenever that render happened to be.
 *
 * Rounded down to the minute so the returned value is stable within a minute
 * and every consumer's useMemo actually caches.
 */
export function useNowMinute() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const check = () => setNow(prev => {
      const next = new Date();
      // Same minute means the same render — React bails out on an identical
      // value, so this ticks forever without re-rendering anything.
      const sameMinute = prev.getFullYear() === next.getFullYear()
        && prev.getMonth() === next.getMonth()
        && prev.getDate() === next.getDate()
        && prev.getHours() === next.getHours()
        && prev.getMinutes() === next.getMinutes();
      return sameMinute ? prev : next;
    });
    const interval = setInterval(check, 30_000);
    const onVisible = () => { if (!document.hidden) check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return now;
}
