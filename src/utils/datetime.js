// Dates and clock times, in the two shapes this app actually stores.
//
// WHAT WAS WRONG
// Every record carried `time: new Date().toLocaleTimeString(...)` — a DISPLAY
// string, generated at save, in whatever locale the device happened to be in
// ("11:45 PM" here, "23:45" elsewhere). Three consequences, all of them bad:
//
//   1. It could not be edited. There was no field for it and no format to put
//      back, so a payment entered the next morning said "08:12" forever.
//   2. It could not be sorted. "9:05 AM" sorts after "10:30 PM" as text, so a
//      day's transactions came out in whatever order the array happened to be.
//   3. It could not be compared across devices, which is exactly the situation
//      this app is in — a phone and a laptop signed into the same account.
//
// So the stored shape is now a plain 24-hour "HH:MM", which sorts as text,
// round-trips through an <input type="time"> unchanged, and means the same
// thing on every device. Everything here tolerates the old locale strings too:
// there are weeks of them in storage and rewriting real records to fix a
// display bug is not a trade worth making.

/** Today as YYYY-MM-DD, in LOCAL time. Never toISOString — that's UTC. */
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Now as "HH:MM", 24-hour. */
export function nowTimeStr(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Shift a YYYY-MM-DD by whole days. Built from parts, so DST can't move it. */
export function shiftDate(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return todayStr(dt);
}

/** Whole days between two YYYY-MM-DD strings (b − a). */
export function daysBetween(a, b) {
  const [ay, am, ad] = String(a).split('-').map(Number);
  const [by, bm, bd] = String(b).split('-').map(Number);
  if (!ay || !by) return 0;
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
}

/**
 * Any stored time to "HH:MM", or null when it can't be read.
 *
 * Handles the three shapes in storage: the new 24-hour one, the old
 * en-US locale one ("11:45 PM"), and absent.
 */
export function toHHMM(time) {
  if (!time || typeof time !== 'string') return null;

  const plain = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (plain) {
    const h = Number(plain[1]);
    return h < 24 ? `${String(h).padStart(2, '0')}:${plain[2]}` : null;
  }

  const twelve = time.trim().match(/^(\d{1,2}):(\d{2})\s*([APap])\.?[Mm]\.?$/);
  if (twelve) {
    let h = Number(twelve[1]) % 12;
    if (twelve[3].toLowerCase() === 'p') h += 12;
    return `${String(h).padStart(2, '0')}:${twelve[2]}`;
  }

  return null;
}

/**
 * Minutes since midnight, for sorting. Records with no readable time sort to
 * the END of the day rather than to 00:00 — an unknown time is not midnight,
 * and putting it first would claim it was the day's first transaction.
 */
export function timeToMinutes(time) {
  const hhmm = toHHMM(time);
  if (!hhmm) return 24 * 60 + 1;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Order records within a day: earliest first.
 *
 * Falls back to `at` (the event timestamp) when neither has a readable clock
 * time, then to insertion order. Pure — returns a new array.
 */
export function sortByTime(records = [], { newestFirst = false } = {}) {
  const key = r => {
    const mins = timeToMinutes(r?.time);
    // A record with no time at all still has `at`, which is a real instant —
    // use its clock time rather than dumping every legacy row at the bottom.
    if (mins > 24 * 60 && r?.at) {
      const d = new Date(r.at);
      if (!Number.isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
    }
    return mins;
  };
  const sorted = [...records].sort((a, b) => key(a) - key(b) || (a?.at ?? 0) - (b?.at ?? 0));
  return newestFirst ? sorted.reverse() : sorted;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * "今天" / "昨天" / "8月22日（五）" — how a date reads in a list of days.
 * Relative labels only for the two days people actually think of that way.
 */
export function describeDate(dateStr, today = todayStr()) {
  if (dateStr === today) return '今天';
  if (dateStr === shiftDate(today, -1)) return '昨天';
  if (dateStr === shiftDate(today, -2)) return '前天';
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y) return dateStr;
  const dt = new Date(y, m - 1, d);
  const sameYear = y === new Date(today.slice(0, 4) + '-01-01').getFullYear();
  return `${sameYear ? '' : `${y}年`}${m}月${d}日（${WEEKDAYS[dt.getDay()]}）`;
}
