// "A date I want LifeManager to remember" — birthdays, anniversaries, the day
// you graduated.
//
// Deliberately NOT a reminder (see reminders.js). A reminder is a task with a
// deadline and it can be overdue; a special day is a date that comes round
// every year and cannot be "done". They share a notification pipe and nothing
// else — the moment you merge them you have to explain why a birthday has a
// checkbox.
//
// THE YEAR IN THE DATE IS LOAD-BEARING
// A birthday could be stored as just month + day, and for the countdown that
// would be enough. It stores the full original date because that is what makes
// the app able to say 「26 岁」 or 「第 3 年」 — the one thing a paper calendar
// can't do for you. The year is optional in the UI for anyone who'd rather not
// say; `occurrenceNumber` returns null instead of guessing.

import { todayStr, daysBetween } from './datetime.js';
import { num } from './num.js';

/** Offered when creating one, so nobody has to hunt through an emoji picker. */
export const SPECIAL_EMOJI = [
  '🎂', '❤️', '🎓', '🎉', '💼', '⭐', '🎁', '💍', '👶', '🏆',
  '🕯️', '✈️', '🏠', '🐱', '📅', '🌸', '🎄', '🙏', '💐', '🔔',
];

export const DEFAULT_EMOJI = '⭐';

/**
 * When to be told. Not forced — the brief was explicit that a special day
 * should be allowed to just sit there being remembered — but one tap away.
 */
export const REMIND_OPTIONS = [
  { value: 'none', label: '不提醒', days: null },
  { value: 'same', label: '当天', days: 0 },
  { value: 'day', label: '提前 1 天', days: 1 },
  { value: 'week', label: '提前 1 星期', days: 7 },
];

/** Morning, not evening: a birthday greeting at 20:00 is a late one. */
export const DEFAULT_REMIND_TIME = '09:00';

function parts(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return (y && m && d) ? { y, m, d } : null;
}

function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

function ymd(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function normalizeSpecialDay(s) {
  if (!s || typeof s !== 'object') return null;
  const remind = REMIND_OPTIONS.some(o => o.value === s.remind) ? s.remind : 'none';
  return {
    id: s.id,
    title: typeof s.title === 'string' ? s.title : '',
    emoji: s.emoji || DEFAULT_EMOJI,
    date: s.date ?? null,
    // Yearly by default — that is what "special day" means here. A one-off
    // important date is still allowed (a graduation you don't want to
    // celebrate annually), it just isn't the default.
    yearly: s.yearly !== false,
    remind,
    remindTime: s.remindTime || DEFAULT_REMIND_TIME,
    at: num(s.at),
    updatedAt: num(s.updatedAt),
    // MUST list every field — built field-by-field, so anything unnamed is
    // dropped on every read. See notes.js.
  };
}

export function normalizeSpecialDays(list) {
  return (Array.isArray(list) ? list : []).map(normalizeSpecialDay).filter(Boolean);
}

/**
 * The next date this falls on, as YYYY-MM-DD, or null if it's a one-off that
 * has already happened.
 *
 * Today counts as "next" — a birthday is not over at 00:01 on the day.
 *
 * FEBRUARY 29 lands on the 28th in the three years out of four that don't have
 * one. The alternative is a birthday the app skips for three years running,
 * which is worse than being one day early.
 */
export function nextDate(raw, today = todayStr()) {
  const s = normalizeSpecialDay(raw);
  const p = parts(s?.date);
  if (!p) return null;

  if (!s.yearly) return s.date >= today ? s.date : null;

  const t = parts(today);
  if (!t) return null;
  for (let y = t.y; y <= t.y + 1; y++) {
    const candidate = ymd(y, p.m, Math.min(p.d, daysInMonth(y, p.m)));
    if (candidate >= today) return candidate;
  }
  return null;
}

/** Whole days from today to the next occurrence. 0 = today. */
export function daysUntil(raw, today = todayStr()) {
  const next = nextDate(raw, today);
  return next ? daysBetween(today, next) : null;
}

/** "今天" / "明天" / "还有 9 天" — the countdown line. */
export function describeCountdown(raw, today = todayStr()) {
  const days = daysUntil(raw, today);
  if (days == null) return '已经过了';
  if (days === 0) return '就是今天';
  if (days === 1) return '明天';
  if (days === 2) return '后天';
  return `还有 ${days} 天`;
}

/**
 * Which one this will be: someone's 26th birthday, a 3rd anniversary.
 *
 * Null when the stored year is at or after the next occurrence's — a date
 * added without a real year, or a future milestone, has no count to give and
 * inventing "0th" would be worse than saying nothing.
 */
export function occurrenceNumber(raw, today = todayStr()) {
  const s = normalizeSpecialDay(raw);
  if (!s?.yearly) return null;
  const p = parts(s.date);
  const next = nextDate(s, today);
  if (!p || !next) return null;
  const n = parts(next).y - p.y;
  return n > 0 ? n : null;
}

/**
  * "9月5日" — the date badge, without a year nobody needs on screen.
  *
  * NOT `describeDate`: datetime.js already exports one of those, and it means
  * something different (「今天」/「8月22日（五）」, for a list of past days).
  * Two same-named functions one import apart is a mis-import waiting to happen.
  */
export function describeMonthDay(raw, today = todayStr()) {
  const next = nextDate(raw, today);
  const p = parts(next);
  return p ? `${p.m}月${p.d}日` : '—';
}

/** Soonest first. Ones that have already passed for good sort to the end. */
export function sortUpcoming(list, today = todayStr()) {
  return [...list].sort((a, b) => {
    const da = daysUntil(a, today);
    const db = daysUntil(b, today);
    if (da == null && db == null) return 0;
    if (da == null) return 1;
    if (db == null) return -1;
    return da - db;
  });
}

export function remindOffsetDays(remind) {
  return REMIND_OPTIONS.find(o => o.value === remind)?.days ?? null;
}

/**
 * When to actually fire a notification for this, as epoch ms.
 *
 * WHY THIS LOOKS TWO YEARS AHEAD
 * "Remind me 1 week before" on a birthday that is 3 days away has a remind
 * moment that is ALREADY IN THE PAST. Taking this year's occurrence and
 * stopping would schedule nothing at all — and then silently nothing next year
 * either, because the same thing happens every time the app is opened inside
 * that final week. So it walks forward until it finds a remind moment that is
 * still ahead: this year's if there's time, otherwise next year's.
 *
 * @returns {{date: string, at: number}[]} at most one entry, empty if none
 */
export function notificationsFor(raw, { now = Date.now(), horizonDays = 60 } = {}) {
  const s = normalizeSpecialDay(raw);
  if (!s) return [];
  const offset = remindOffsetDays(s.remind);
  if (offset == null) return [];

  const today = todayStr(new Date(now));
  const [hh, mm] = String(s.remindTime || DEFAULT_REMIND_TIME).split(':').map(Number);
  const horizonMs = now + horizonDays * 86400000;

  // Two candidates is always enough: this occurrence and the following one.
  let cursor = today;
  for (let i = 0; i < 2; i++) {
    const occurrence = nextDate(s, cursor);
    if (!occurrence) return [];
    const p = parts(occurrence);
    const fire = new Date(p.y, p.m - 1, p.d, hh || 0, mm || 0, 0, 0);
    fire.setDate(fire.getDate() - offset);
    const at = fire.getTime();
    if (at > now) {
      return at <= horizonMs ? [{ date: occurrence, at }] : [];
    }
    // This occurrence's warning has been and gone — try the next one.
    if (!s.yearly) return [];
    cursor = `${p.y + 1}-01-01`;
  }
  return [];
}
