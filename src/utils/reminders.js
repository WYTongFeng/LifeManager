// "Remind me to DO something" — the recurrence engine behind /reminders.
//
// A reminder is a thing you have to do at a time. That is a different object
// from a Special Day (see specialDays.js), which is a date you want the app to
// REMEMBER. Keeping them apart is deliberate: a birthday is not a task, and
// merging them would force one of the two into the wrong shape.
//
// WHY THE ANCHOR IS A SINGLE DATE
// The obvious model stores `repeat: 'weekly'` alongside a separate `weekday`
// field. Then they can disagree — a reminder anchored to a Tuesday with
// `weekday: 1` is representable, and nothing says which one wins. So the only
// stored anchor is `startDate` + `time`, and weekday / day-of-month / month are
// DERIVED from it. Picking "every Monday" in the UI moves startDate to the next
// Monday. One source of truth, no inconsistent state to handle.
//
// Everything here is pure and takes `now` as an argument, so
// `scripts/test-reminders.mjs` can run the whole calendar in Node.

import { todayStr, shiftDate, toHHMM } from './datetime.js';
import { num } from './num.js';

export const REPEATS = [
  { value: 'once', label: '只有一次', short: '一次' },
  { value: 'daily', label: '每天', short: '每天' },
  { value: 'weekly', label: '每星期', short: '每周' },
  { value: 'monthly', label: '每个月', short: '每月' },
  { value: 'yearly', label: '每年', short: '每年' },
];

export const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

/** Default fire time for a new reminder — evening, when you're free to act. */
export const DEFAULT_TIME = '20:00';

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

/**
 * A day-of-month that exists in this month.
 *
 * A monthly reminder anchored to the 31st has to do SOMETHING in February.
 * It fires on the last day of the month — the alternative, skipping February
 * entirely, means "every month" silently isn't. Clamping always measures from
 * the ANCHOR, never from the previous clamped result, so 31 → Feb 28 → Mar 31
 * rather than drifting down to the 28th forever.
 */
function clampDay(y, m, day) {
  return Math.min(day, daysInMonth(y, m));
}

/** Epoch ms for a local date + "HH:MM". Built from parts, so DST can't move it. */
export function occurrenceAt(dateStr, timeStr) {
  const p = parts(dateStr);
  if (!p) return null;
  const [hh, mm] = (toHHMM(timeStr) ?? DEFAULT_TIME).split(':').map(Number);
  return new Date(p.y, p.m - 1, p.d, hh, mm, 0, 0).getTime();
}

export function normalizeReminder(r) {
  if (!r || typeof r !== 'object') return null;
  const repeat = REPEATS.some(x => x.value === r.repeat) ? r.repeat : 'once';
  return {
    id: r.id,
    title: typeof r.title === 'string' ? r.title : '',
    note: typeof r.note === 'string' ? r.note : '',
    time: toHHMM(r.time) ?? DEFAULT_TIME,
    startDate: r.startDate ?? todayStr(),
    repeat,
    // Switched off rather than deleted — "not this month" shouldn't cost you
    // the reminder and everything you typed into it.
    enabled: r.enabled !== false,
    // Only meaningful for `once`. A repeating reminder is never "done": the
    // next one is always coming.
    done: Boolean(r.done),
    at: num(r.at),
    updatedAt: num(r.updatedAt),
    // MUST list every field — this builds the object field-by-field, so
    // anything unnamed here is dropped on every read. See notes.js.
  };
}

export function normalizeReminders(list) {
  return (Array.isArray(list) ? list : []).map(normalizeReminder).filter(Boolean);
}

/** Which weekday the anchor falls on (0 = Sunday), or null. */
export function anchorWeekday(reminder) {
  const p = parts(reminder?.startDate);
  return p ? new Date(p.y, p.m - 1, p.d).getDay() : null;
}

/**
 * Every time this reminder fires between now and the horizon.
 *
 * Already-passed occurrences are excluded — including one earlier TODAY, which
 * is why this compares full timestamps rather than dates. A reminder set for
 * 08:00 must not still be "coming up" at noon.
 *
 * @param {object} raw       reminder, normalized or not
 * @param {object} opts
 * @param {number} opts.now          epoch ms; defaults to the real clock
 * @param {number} opts.horizonDays  how far ahead to look
 * @param {number} opts.limit        cap on returned occurrences
 * @returns {{date: string, time: string, at: number}[]} ascending
 */
export function nextOccurrences(raw, { now = Date.now(), horizonDays = 60, limit = 12 } = {}) {
  const r = normalizeReminder(raw);
  if (!r || !r.enabled) return [];
  if (r.repeat === 'once' && r.done) return [];

  const start = parts(r.startDate);
  if (!start) return [];

  const from = todayStr(new Date(now));
  const until = shiftDate(from, horizonDays);
  const dates = [];

  // The window never begins before the reminder itself does — a monthly bill
  // reminder created today has no occurrences last month.
  const windowStart = r.startDate > from ? r.startDate : from;

  if (r.repeat === 'once') {
    dates.push(r.startDate);
  } else if (r.repeat === 'daily') {
    for (let d = windowStart; d <= until; d = shiftDate(d, 1)) dates.push(d);
  } else if (r.repeat === 'weekly') {
    const want = anchorWeekday(r);
    // Walk forward at most 6 days to land on the right weekday, then stride.
    let d = windowStart;
    for (let i = 0; i < 7; i++) {
      const p = parts(d);
      if (new Date(p.y, p.m - 1, p.d).getDay() === want) break;
      d = shiftDate(d, 1);
    }
    for (; d <= until; d = shiftDate(d, 7)) dates.push(d);
  } else if (r.repeat === 'monthly') {
    // Iterate MONTHS, not days: a 60-day horizon is two or three occurrences,
    // and stepping day by day to find them is 60 wasted comparisons.
    const w = parts(windowStart);
    let y = w.y, m = w.m;
    for (let i = 0; i < 14; i++) {
      const d = ymd(y, m, clampDay(y, m, start.d));
      if (d > until) break;
      if (d >= windowStart) dates.push(d);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  } else if (r.repeat === 'yearly') {
    const w = parts(windowStart);
    for (let y = w.y; y <= w.y + 1; y++) {
      const d = ymd(y, start.m, clampDay(y, start.m, start.d));
      if (d >= windowStart && d <= until) dates.push(d);
    }
  }

  const out = [];
  for (const date of dates) {
    if (date < r.startDate) continue;
    const at = occurrenceAt(date, r.time);
    if (at == null || at <= now) continue;   // already gone by
    out.push({ date, time: r.time, at });
    if (out.length >= limit) break;
  }
  return out;
}

/** The single next firing, or null when there isn't one in the horizon. */
export function nextOccurrence(raw, opts = {}) {
  return nextOccurrences(raw, { ...opts, limit: 1 })[0] ?? null;
}

/**
 * A one-off whose moment has passed without being ticked off.
 *
 * Repeating reminders can never be overdue — the next one is always ahead —
 * so calling a missed Monday "overdue" on Tuesday would just be permanent red
 * text nobody can clear.
 */
export function isOverdue(raw, now = Date.now()) {
  const r = normalizeReminder(raw);
  if (!r || !r.enabled || r.repeat !== 'once' || r.done) return false;
  const at = occurrenceAt(r.startDate, r.time);
  return at != null && at <= now;
}

/**
 * The anchor date for "every Monday", picked from a weekday.
 *
 * The form offers weekday buttons; the model stores only `startDate` (see the
 * header). This is the bridge: the soonest date, today included, that falls on
 * that weekday.
 */
export function anchorDateForWeekday(weekday, from = todayStr()) {
  let d = from;
  for (let i = 0; i < 7; i++) {
    const p = parts(d);
    if (!p) return from;
    if (new Date(p.y, p.m - 1, p.d).getDay() === Number(weekday)) return d;
    d = shiftDate(d, 1);
  }
  return from;
}

/**
 * The anchor date for "every month on the Nth", picked from a day number.
 *
 * SKIPS MONTHS THAT DON'T HAVE THAT DAY rather than clamping into them. Picking
 * the 31st in February and storing 2027-02-28 would make 28 the anchor forever,
 * so "every month on the 31st" would quietly become "every month on the 28th" —
 * the exact drift `clampDay` exists to prevent, reintroduced at the moment the
 * reminder is created. It lands on March 31 instead, and February is clamped
 * later, at read time, from an anchor that still says 31.
 */
export function anchorDateForMonthDay(day, from = todayStr()) {
  const target = Number(day);
  const start = parts(from);
  if (!start || !target) return from;
  let y = start.y, m = start.m;
  for (let i = 0; i < 14; i++) {
    const fitsThisMonth = target <= daysInMonth(y, m);
    const notInThePast = i > 0 || target >= start.d;
    if (fitsThisMonth && notInThePast) return ymd(y, m, target);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return from;
}

/** "每星期一 · 20:00" — the grey line under a reminder's title. */
export function describeRepeat(raw) {
  const r = normalizeReminder(raw);
  if (!r) return '';
  const p = parts(r.startDate);
  switch (r.repeat) {
    case 'daily': return `每天 · ${r.time}`;
    case 'weekly': return `每星期${WEEKDAY_NAMES[anchorWeekday(r) ?? 0]} · ${r.time}`;
    case 'monthly': return `每个月 ${p ? p.d : '?'} 号 · ${r.time}`;
    case 'yearly': return `每年 ${p ? MONTH_NAMES[p.m - 1] : '?'}${p ? p.d : '?'} 日 · ${r.time}`;
    default: return `${r.startDate} · ${r.time}`;
  }
}

/**
 * "今天 20:00" / "明天 08:00" / "9月5日 09:00" — how a firing time reads.
 *
 * Relative words only for today and tomorrow, the two days people actually
 * think in. "3 天后" for a date is vaguer than the date itself.
 */
export function describeWhen(at, now = Date.now()) {
  if (at == null) return '';
  const d = new Date(at);
  const date = todayStr(d);
  const today = todayStr(new Date(now));
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (date === today) return `今天 ${time}`;
  if (date === shiftDate(today, 1)) return `明天 ${time}`;
  if (date === shiftDate(today, 2)) return `后天 ${time}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
}
