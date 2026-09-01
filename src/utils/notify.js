// The only place that talks to the OS notification scheduler.
//
// WHY A ROLLING WINDOW INSTEAD OF "REPEAT FOREVER"
// Capacitor can schedule a repeating alarm (`schedule: { repeats: true, every:
// 'day' }`) and it looks like less work. It isn't usable here, for two reasons:
//
//   1. A Special Day's "remind me 1 week before" is not a repeat of anything —
//      it's a date computed from another date, once a year. There is no
//      `every:` value that expresses it.
//   2. An OS repeat is fire-and-forget: edit the reminder's text or time and
//      the alarm the system holds still has the old one.
//
// So this keeps a rolling 60-day window of CONCRETE alarms and re-syncs it
// every time the app opens. The app is opened most days, and 60 days of slack
// means it would have to go unopened for two months before anything is missed.
//
// WHY THE NOTIFICATION IDS ARE CONTENT-DERIVED
// `occurrenceId` (upNext.js) hashes kind + source + date + title + body. That
// makes the diff below self-healing: an untouched reminder keeps its id and is
// left alone, while an EDITED one hashes to a new id, so the stale alarm falls
// out of the desired set and gets cancelled while the new text is scheduled.
// No bookkeeping of "what did I schedule last time" to get out of step.
//
// WHY isExactNotification IS FALSE
// The plugin defaults it to TRUE, and on Android 12+ scheduling an exact alarm
// without the permission makes it launch the system "Alarms & reminders"
// settings screen. That would happen on app open, unprompted, every time the
// window is re-synced — a hostile experience for a feature the user may not
// even have opened yet. Inexact means `setAndAllowWhileIdle`: still wakes the
// device out of Doze, but the OS may hold it up to ~15 minutes. For "submit the
// document at 20:00" that is a trade worth making; for an alarm clock it would
// not be, and this is not an alarm clock.

import { isNativePlatform } from './platform.js';

const CHANNEL_ID = 'lifemanager-reminders';

/**
 * Android's own limit is generous, but every pending alarm is a real system
 * resource. 48 covers a 60-day window comfortably once `perReminderLimit`
 * has already trimmed the daily ones.
 */
export const MAX_SCHEDULED = 48;

let pluginPromise = null;
let channelReady = false;

/**
 * The plugin, or null when this device can't do OS notifications.
 *
 * Dynamically imported so the web build never pulls it into the main chunk —
 * and, more importantly, so a browser can't throw at module load. The web
 * implementation of this plugin throws `unimplemented` for createChannel and
 * several others, which is why web is refused outright rather than half
 * supported: a "reminder" that only fires while the tab is open is not one.
 */
async function getPlugin() {
  if (!isNativePlatform()) return null;
  if (!pluginPromise) {
    pluginPromise = import('@capacitor/local-notifications')
      .then(m => m.LocalNotifications ?? null)
      .catch((e) => { console.warn('LocalNotifications unavailable', e); return null; });
  }
  return pluginPromise;
}

/** Can this device deliver a reminder while the app is closed? */
export function notificationsSupported() {
  return isNativePlatform();
}

/** 'granted' | 'denied' | 'prompt' | 'unsupported' */
export async function checkPermission() {
  const p = await getPlugin();
  if (!p) return 'unsupported';
  try {
    const { display } = await p.checkPermissions();
    return display ?? 'prompt';
  } catch (e) {
    console.warn('checkPermissions failed', e);
    return 'unsupported';
  }
}

/** Ask, once. Android 13+ shows the system sheet; older versions resolve granted. */
export async function requestPermission() {
  const p = await getPlugin();
  if (!p) return 'unsupported';
  try {
    const { display } = await p.requestPermissions();
    return display ?? 'denied';
  } catch (e) {
    console.warn('requestPermissions failed', e);
    return 'denied';
  }
}

/**
 * Android 8+ files every notification under a channel. Without an explicit one
 * the user has no per-app switch for these specifically, only "all LifeManager
 * notifications" — which would also silence the TNG capture work.
 */
async function ensureChannel(p) {
  if (channelReady) return;
  try {
    await p.createChannel({
      id: CHANNEL_ID,
      // ONE channel for all five sources, not one each. Per-source channels
      // would put the on/off switches in Android's settings, two levels deep
      // and in a different language from the rest of the app — while the
      // notification centre already has them, in context, next to what they
      // control. The channel exists so there is a single OS-level switch for
      // "LifeManager's scheduled notifications" that does not also silence the
      // TNG capture work; splitting it further buys nothing.
      //
      // The ID MUST NOT CHANGE. Android treats a new id as a new channel with
      // default settings, so anyone who had turned the sound down would find it
      // back on. That is why it still says "reminders" after growing to cover
      // supplements and bills.
      name: '提醒 · 日子 · 补充剂 · 账单',
      description: '提醒事项、特别日子、补充剂、账单到期与记录提醒',
      importance: 4,   // HIGH — makes a sound and appears as a heads-up
      visibility: 1,   // public: readable on the lock screen, which is the point
    });
  } catch (e) {
    // Not fatal: without a channel the plugin still posts under the app's
    // default one. Losing the dedicated toggle is better than losing the
    // notification.
    console.warn('createChannel failed', e);
  }
  channelReady = true;
}

function toNotification(item) {
  return {
    id: item.notifId,
    title: item.title,
    body: item.body,
    channelId: CHANNEL_ID,
    schedule: {
      at: new Date(item.at),
      // Wake the device out of Doze. See the header for why not exact.
      allowWhileIdle: true,
    },
    isExactNotification: false,
    // Read back by `useNotificationTaps` when the notification is tapped —
    // `route` is a hash-router path and is what makes a tap land on the thing
    // the notification is about instead of on whatever screen the app was last
    // left on.
    //
    // This payload was written for two versions before anything read it (the
    // comment here used to say "nothing consumes it yet"). `route` is the field
    // that finished the job: without it the handler would have to re-derive a
    // destination from `source` + `sourceId`, which is a second place that has
    // to agree with the registry about where each source lives.
    extra: {
      source: item.source,
      type: item.type,
      sourceId: item.sourceId,
      date: item.date,
      route: item.route,
    },
  };
}

/**
 * Make the OS hold exactly the alarms in `feed`, and no others.
 *
 * Idempotent: calling it twice with the same feed schedules nothing the second
 * time. That matters because it runs on every app open and every edit.
 *
 * Never throws — a notification problem must not take a screen down with it.
 * The returned `reason` is what the UI shows instead of pretending it worked.
 *
 * @returns {{ok: boolean, scheduled: number, cancelled: number, reason: string|null}}
 */
export async function syncScheduled(feed = []) {
  const idle = { ok: false, scheduled: 0, cancelled: 0, reason: null };

  const p = await getPlugin();
  if (!p) return { ...idle, reason: 'unsupported' };

  try {
    const permission = await checkPermission();
    // Deliberately does NOT request here. Asking for a permission out of the
    // blue on app start is how people learn to hit Deny; the reminders screen
    // asks in context, where the answer means something.
    if (permission !== 'granted') return { ...idle, reason: permission };

    await ensureChannel(p);

    const desired = new Map();
    for (const item of feed) {
      if (desired.size >= MAX_SCHEDULED) break;
      if (!Number.isFinite(item?.at) || item.at <= Date.now()) continue;
      desired.set(item.notifId, item);
    }

    const pending = await p.getPending();
    const pendingIds = new Set(
      (pending?.notifications ?? []).map(n => Number(n.id)).filter(Number.isFinite)
    );

    const toCancel = [...pendingIds].filter(id => !desired.has(id));
    const toSchedule = [...desired.values()].filter(item => !pendingIds.has(item.notifId));

    if (toCancel.length) {
      await p.cancel({ notifications: toCancel.map(id => ({ id })) });
    }
    if (toSchedule.length) {
      await p.schedule({ notifications: toSchedule.map(toNotification) });
    }

    return { ok: true, scheduled: toSchedule.length, cancelled: toCancel.length, reason: null };
  } catch (e) {
    console.warn('Notification sync failed', e);
    return { ...idle, reason: 'error' };
  }
}

/** Drop every alarm this app holds. Used when notifications are switched off. */
export async function cancelAllScheduled() {
  const p = await getPlugin();
  if (!p) return false;
  try {
    const pending = await p.getPending();
    const ids = (pending?.notifications ?? []).map(n => ({ id: Number(n.id) }));
    if (ids.length) await p.cancel({ notifications: ids });
    return true;
  } catch (e) {
    console.warn('cancelAllScheduled failed', e);
    return false;
  }
}

/** How many alarms the OS is currently holding for us — for the settings line. */
export async function pendingCount() {
  const p = await getPlugin();
  if (!p) return null;
  try {
    const pending = await p.getPending();
    return (pending?.notifications ?? []).length;
  } catch {
    return null;
  }
}

/**
 * Why this device can't deliver, in the user's words. `null` means it can.
 *
 * Stated plainly rather than hidden, because the alternative — a reminder
 * screen that looks like it works and silently never fires — is the single
 * worst outcome this feature has.
 */
export function explainReason(reason) {
  switch (reason) {
    case null: case undefined: return null;
    case 'unsupported': return '这个浏览器不能在关掉 App 后提醒你 —— 装 Android App 才行。';
    case 'denied': return '通知权限被拒绝了。到手机设定 → 应用程式 → LifeManager → 通知，打开它。';
    case 'prompt': return '还没开通知权限 —— 按上面的按钮开。';
    case 'error': return '排程通知时出错了，提醒可能不会响。';
    default: return null;
  }
}
