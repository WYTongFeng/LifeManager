// The 48-hour impulse sandbox (Module 2 of the firewall spec).
//
// A non-essential purchase — game skins, a big meal out, a gadget — doesn't
// get logged straight into expenses. It becomes a pending request that sits
// in a mandatory cooldown, and can only be approved once COOLDOWN_HOURS have
// actually elapsed on the wall clock. The friction is the entire point: there
// is no "skip the wait" button, and reopening the app doesn't reset a timer,
// because the check is always against `createdAt`, a fixed timestamp — not
// against a counter that ticks down only while the app happens to be open.
//
// Kept as pure functions, separate from the UI, so "has 48 hours really
// passed" is testable without mocking React or faking a clock inside a
// component.

export const COOLDOWN_HOURS = 48;

/** Hours left before a request can be approved. Never negative. */
export function hoursRemaining(request, now = Date.now()) {
  const elapsedHours = (now - request.createdAt) / 3600000;
  return Math.max(0, COOLDOWN_HOURS - elapsedHours);
}

/** True once the cooldown has actually elapsed. */
export function isUnlocked(request, now = Date.now()) {
  return hoursRemaining(request, now) <= 0;
}

/** "23 小时 12 分" while locked, or null once unlocked (nothing left to count). */
export function formatRemaining(request, now = Date.now()) {
  const hrs = hoursRemaining(request, now);
  if (hrs <= 0) return null;
  const h = Math.floor(hrs);
  const m = Math.round((hrs - h) * 60);
  // Rounding minutes up to 60 at the top of an hour must not print "1 小时 60 分".
  if (m === 60) return `${h + 1} 小时 0 分`;
  if (h === 0) return `${m} 分钟`;
  return `${h} 小时 ${m} 分`;
}
