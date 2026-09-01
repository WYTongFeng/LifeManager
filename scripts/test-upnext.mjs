import { occurrenceId, buildFeed, upNextRows, upcomingSpecialDays } from '../src/utils/upNext.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// Wed 26 Aug 2026, 10:00.
const NOW = new Date(2026, 7, 26, 10, 0).getTime();

const reminders = [
  { id: 11, title: '交文件', startDate: '2026-08-27', time: '20:00', repeat: 'once' },
  { id: 12, title: '吃药', startDate: '2026-01-01', time: '18:00', repeat: 'daily' },
  { id: 13, title: '关掉的', startDate: '2026-08-27', time: '09:00', repeat: 'once', enabled: false },
];
const specialDays = [
  { id: 21, title: '朋友生日', emoji: '🎂', date: '2000-09-05', remind: 'day', remindTime: '09:00' },
  { id: 22, title: '纪念日', emoji: '❤️', date: '2023-10-12', remind: 'none' },
];

// --- notification ids -----------------------------------------------------------
// Java ints: a millisecond timestamp does not fit, and a random id can't be
// recomputed on the next app open to work out what is already scheduled.
const id = occurrenceId('r', 11, '2026-08-27');
check('an id is a positive 31-bit int', id > 0 && id < 0x7fffffff && Number.isInteger(id), true);
check('the same occurrence always gets the same id', occurrenceId('r', 11, '2026-08-27'), id);
check('a different date is a different id', occurrenceId('r', 11, '2026-08-28') !== id, true);
check('a different source is a different id', occurrenceId('r', 12, '2026-08-27') !== id, true);
// Without the kind prefix a reminder and a special day sharing an id number
// would cancel each other in the OS.
check('a reminder and a special day never collide', occurrenceId('s', 11, '2026-08-27') !== id, true);
check('a string id works as well as a number', occurrenceId('r', 'abc', '2026-08-27') > 0, true);

// --- the merged feed ---------------------------------------------------------------
const feed = buildFeed({ reminders, specialDays, now: NOW, horizonDays: 60, perReminderLimit: 2 });
check('the feed is in time order', feed.map(f => f.at).every((v, i, a) => i === 0 || a[i - 1] <= v), true);
check('a disabled reminder contributes nothing', feed.some(f => f.sourceId === 13), false);
// 不提醒 means no notification, however close the date is.
check('a special day set to 不提醒 contributes nothing', feed.some(f => f.sourceId === 22), false);
check('提前 1 天 does contribute', feed.some(f => f.sourceId === 21), true);

check('perReminderLimit caps a daily reminder',
  feed.filter(f => f.sourceId === 12).length, 2);
check('the first thing due is today\'s 吃药', feed[0].title, '吃药');

const birthdayItem = feed.find(f => f.sourceId === 21);
check('a special day carries its emoji into the title', birthdayItem.title, '🎂 朋友生日');
// Counted from the day the alert LANDS. Counting from today would have a
// 1-day-before alert saying "还有 10 天" because it was scheduled ten days ago.
check('...and counts from the day the alert lands', birthdayItem.body, '就是明天');
check('a reminder with no note explains its own repeat',
  feed.find(f => f.sourceId === 12).body, '每天 · 18:00');
check('a reminder with a note uses the note',
  buildFeed({ reminders: [{ ...reminders[0], note: '记得盖章' }], now: NOW })[0].body, '记得盖章');

check('an empty world produces an empty feed', buildFeed({ now: NOW }), []);

// --- editing a reminder must reach the OS ---------------------------------------
// The scheduler leaves an alarm alone when its id is already pending. Keyed on
// identity alone, a renamed reminder would keep the OLD id, be seen as already
// scheduled, and fire with the OLD wording — the edit saving and then being
// silently ignored. So the content is part of the key.
const before = buildFeed({ reminders: [reminders[0]], now: NOW })[0].notifId;
const renamed = buildFeed({ reminders: [{ ...reminders[0], title: '交表格' }], now: NOW })[0].notifId;
const renoted = buildFeed({ reminders: [{ ...reminders[0], note: '带身份证' }], now: NOW })[0].notifId;
const retimed = buildFeed({ reminders: [{ ...reminders[0], time: '21:00' }], now: NOW })[0].notifId;
check('renaming a reminder changes its notification id', renamed !== before, true);
check('editing the note changes it too', renoted !== before, true);
check('moving the time changes it too', retimed !== before, true);
check('but an untouched reminder keeps the same id',
  buildFeed({ reminders: [reminders[0]], now: NOW })[0].notifId, before);

// --- upcoming special days ---------------------------------------------------------
// "What's coming up" and "what will ping me" are different questions; the card
// asks the first one, so a 不提醒 birthday still belongs on it.
const upcoming = upcomingSpecialDays(specialDays, { now: NOW, withinDays: 60 });
check('a 不提醒 special day is still upcoming', upcoming.map(u => u.sourceId), [21, 22]);
check('...soonest first', upcoming[0].days, 10);
check('...with a readable date', upcoming[0].when, '9月5日');
check('...and a countdown', upcoming[0].detail, '还有 10 天');
check('anything beyond the window is left out',
  upcomingSpecialDays(specialDays, { now: NOW, withinDays: 20 }).map(u => u.sourceId), [21]);

// --- the dashboard rows -------------------------------------------------------------
const rows = upNextRows({ reminders, specialDays, now: NOW, limit: 3 });
check('the card shows at most `limit` rows', rows.length, 3);
// Otherwise a daily reminder fills every slot: 吃药, 吃药, 吃药.
check('one row per source, however often it repeats',
  rows.filter(r => r.sourceId === 12).length, 1);
check('both kinds appear together, in time order',
  rows.map(r => `${r.source}:${r.sourceId}`), ['reminder:12', 'reminder:11', 'special:21']);
check('a reminder row says when it fires', rows[0].when, '今天 18:00');
check('a special day row says its date', rows[2].when, '9月5日');

check('nothing scheduled means no rows at all', upNextRows({ now: NOW }), []);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
