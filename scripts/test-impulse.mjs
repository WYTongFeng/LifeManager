import { COOLDOWN_HOURS, hoursRemaining, isUnlocked, formatRemaining } from '../src/utils/impulse.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

const HOUR = 3600000;
const now = Date.now();

// --- a fresh request is fully locked ---------------------------------------
const fresh = { createdAt: now };
check('a brand new request has the full 48h remaining', hoursRemaining(fresh, now), COOLDOWN_HOURS);
check('a brand new request is locked', isUnlocked(fresh, now), false);
check('a brand new request shows a countdown', formatRemaining(fresh, now), '48 小时 0 分');

// --- partway through the cooldown -------------------------------------------
const halfway = { createdAt: now - 24 * HOUR };
check('24h in, 24h remain', hoursRemaining(halfway, now), 24);
check('24h in, still locked', isUnlocked(halfway, now), false);

const almostDone = { createdAt: now - (47 * HOUR + 45 * 60000) };
check('almost done shows minutes-only, not "0 小时 X 分"', formatRemaining(almostDone, now), '15 分钟');

// --- exactly at the boundary -------------------------------------------------
const exact = { createdAt: now - COOLDOWN_HOURS * HOUR };
check('exactly 48h later has 0 remaining', hoursRemaining(exact, now), 0);
check('exactly 48h later is unlocked', isUnlocked(exact, now), true);
check('exactly 48h later has no countdown to show', formatRemaining(exact, now), null);

// --- well past the cooldown --------------------------------------------------
const old = { createdAt: now - 5 * 24 * HOUR };
check('remaining never goes negative for an old request', hoursRemaining(old, now), 0);
check('an old request is unlocked', isUnlocked(old, now), true);
check('an old request has no countdown', formatRemaining(old, now), null);

// --- the friction can't be reset by reopening the app -----------------------
// Simulates checking a request "later" — the elapsed time is measured against
// the fixed createdAt timestamp, so a later `now` only ever counts down, it
// never resets, regardless of how many times the check runs.
const requestedYesterday = { createdAt: now - 20 * HOUR };
check('checking again 1h later only advances the countdown, never resets it',
  hoursRemaining(requestedYesterday, now + HOUR), 27);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
