// JS side of the native notification listener.
//
// On Android (Capacitor) this receives real notifications as they arrive. In a
// browser everything here degrades to "unavailable", so the same code runs in
// both places and the web build keeps working with the paste box.
//
// Nothing is classified here — captured text goes through the same
// parseTngNotification() the paste box uses. One set of rules, testable without
// a phone.
//
// FORWARD/BACKWARD COMPATIBILITY
// The APK on the phone and the web bundle it loads are updated separately: a
// user can be running a months-old APK against a freshly deployed bundle. So
// every method added after the first release is called defensively and falls
// back to a safe default when the installed plugin doesn't have it. An older
// APK therefore keeps working — it just doesn't offer the newer diagnostics —
// instead of throwing and taking the whole Money tab down with it.

import { App as CapApp } from '@capacitor/app';
import { isNativePlatform } from './platform.js';

let cachedPlugin = null;
let cachedAvailable = null;

/**
 * True only inside the Android app WITH the TNG notification plugin compiled
 * in. Narrower than "is this the Android app" on purpose — see platform.js's
 * header for the bug that came from a different file treating this as if it
 * answered that broader question. Use `isNativePlatform()` from platform.js
 * for anything that isn't specifically about the TNG listener.
 */
export function isNativeAvailable() {
  if (cachedAvailable !== null) return cachedAvailable;
  const cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
  cachedAvailable = Boolean(isNativePlatform() && cap?.Plugins?.TngNotification);
  return cachedAvailable;
}

/** Running in the Android shell, but WITHOUT the notification plugin compiled in. */
export function isStaleApk() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
  return Boolean(isNativePlatform() && !cap?.Plugins?.TngNotification);
}

function plugin() {
  if (!isNativeAvailable()) return null;
  if (!cachedPlugin) cachedPlugin = window.Capacitor.Plugins.TngNotification;
  return cachedPlugin;
}

/** Call a plugin method that may not exist on an older APK. */
async function callSafe(method, args, fallback) {
  const p = plugin();
  if (!p || typeof p[method] !== 'function') return fallback;
  try {
    return await p[method](args ?? {});
  } catch (e) {
    console.warn(`TngNotification.${method} failed`, e);
    return fallback;
  }
}

/**
 * Has the user granted notification access?
 * Android offers no way to request this programmatically — the switch has to be
 * flipped by hand in system settings, by design.
 */
export async function isPermissionGranted() {
  const { granted } = await callSafe('isPermissionGranted', null, { granted: false });
  return Boolean(granted);
}

/** Opens the system notification-access screen. */
export async function openPermissionSettings() {
  await callSafe('openPermissionSettings', null, null);
}

/**
 * Everything needed to tell the user whether this is ACTUALLY working.
 *
 * The old UI could only say "permission granted" — which is not the same thing
 * as "notifications are reaching the app", and when the two came apart there
 * was no way to tell from inside the app. Android silently drops a listener
 * binding after an app update or under memory pressure; the permission switch
 * stays on and nothing arrives. `listenerConnected` and `lastCapturedAt` are
 * what distinguish "on and working" from "on and dead", and "on but you simply
 * haven't spent anything since".
 *
 * @returns {Promise<{granted:boolean, listenerConnected:boolean,
 *                    capturedTotal:number, lastCapturedAt:number|null,
 *                    lastPackage:string|null, watched:string[],
 *                    supported:boolean}>}
 */
export async function getStatus() {
  if (!isNativeAvailable()) {
    return {
      granted: false, listenerConnected: false, capturedTotal: 0,
      lastCapturedAt: null, lastPackage: null, watched: [], supported: false,
    };
  }
  const granted = await isPermissionGranted();
  const res = await callSafe('getStatus', null, null);
  return {
    granted,
    supported: true,
    listenerConnected: Boolean(res?.listenerConnected),
    capturedTotal: Number(res?.capturedTotal ?? 0),
    lastCapturedAt: res?.lastCapturedAt ? Number(res.lastCapturedAt) : null,
    lastPackage: res?.lastPackage ?? null,
    // What the phone captured vs what this side actually received. They must
    // agree once `pendingCount` is accounted for; a gap is captures that went
    // missing in between, which is exactly what used to happen invisibly.
    deliveredTotal: Number(res?.deliveredTotal ?? 0),
    pendingCount: Number(res?.pendingCount ?? 0),
    watched: Array.isArray(res?.watched) ? res.watched : [],
    // An APK too old to have getStatus() at all. Worth saying out loud rather
    // than silently reporting zeros that look like a broken listener.
    legacy: res === null,
  };
}

/**
 * Tell the listener which app packages to watch.
 *
 * Sent on every startup and whenever accounts change, so the native side never
 * holds a stale list. Only these packages are read — everything else the phone
 * shows is ignored before it's even looked at.
 */
export async function setWatchedPackages(packages) {
  await callSafe('setWatchedPackages', { packages: packages ?? [] }, null);
}

/**
 * Discovery mode: temporarily report the PACKAGE NAME of any notification that
 * looks like it involves money, from any app.
 *
 * This exists because hardcoding bank package names is guesswork, and a wrong
 * guess produces the worst possible outcome — an app that says "watching your
 * Maybank" while watching nothing. Instead: turn this on, make one payment (or
 * wait for one notification), and the phone tells you exactly which app it came
 * from. You bind it to an account by tapping it.
 *
 * Time-boxed on the native side, so leaving the screen can't leave a
 * broad-capture mode running.
 */
export async function startDiscovery(durationMs = 5 * 60 * 1000) {
  return callSafe('startDiscovery', { durationMs }, null);
}

export async function stopDiscovery() {
  return callSafe('stopDiscovery', null, null);
}

/** Packages seen during discovery: [{ packageName, appLabel, count, lastAt, sample }]. */
export async function getDiscovered() {
  const res = await callSafe('getDiscovered', null, { packages: [] });
  return Array.isArray(res?.packages) ? res.packages : [];
}

/**
 * Subscribe to incoming notifications.
 *
 * Content NEVER rides on the event. The native side writes every capture to a
 * queue on disk and then pings; this drains that queue. The event is only a
 * nudge, so losing one is harmless — the next drain still finds the item, and
 * there are three other things that trigger a drain:
 *
 *   · subscribing (catches everything banked while the app was closed or dead)
 *   · the ping (a payment made with the app open, on any screen)
 *   · returning to the foreground (the ping can't reach a suspended web view)
 *
 * The old version took the payload straight off the event, which meant a
 * payment was only recorded if the one screen holding the listener happened to
 * be mounted at that exact moment. It usually wasn't.
 *
 * @param {(payload: {raw: string, title: string, text: string, postedAt: number,
 *                    packageName?: string}) => void} onNotification
 * @returns {() => void} unsubscribe
 */
export function subscribeToNotifications(onNotification) {
  const p = plugin();
  if (!p) return () => {};

  let handle;
  let cancelled = false;
  let draining = false;

  // Serialised: two overlapping drains would both read the queue before either
  // cleared it, and the same payment would be logged twice.
  const drain = async () => {
    if (cancelled || draining) return;
    draining = true;
    try {
      const res = await p.drainPending();
      for (const item of res?.notifications ?? []) {
        if (!cancelled) onNotification(item);
      }
    } catch (e) {
      console.warn('TNG drain failed', e);
    } finally {
      draining = false;
    }
  };

  // addListener's return type depends on how the plugin was obtained: plugins
  // registered with registerPlugin() give a Promise<PluginListenerHandle>, but
  // the legacy `Capacitor.Plugins.X` accessor used here returns the handle
  // synchronously. Promise.resolve() accepts either, so this works on both.
  Promise.resolve(p.addListener('tngCaptured', () => { drain(); }))
    .then((h) => {
      handle = h;
      // Registered first, so a capture landing mid-drain still gets a ping.
      return drain();
    })
    .catch((e) => console.warn('TNG listener setup failed', e));

  // Android suspends the web view in the background, so a ping fired while the
  // phone was showing the wallet app can arrive nowhere. Coming back to the
  // foreground is the reliable moment to check the queue — and it is the normal
  // case, because you are looking at the wallet app when you pay, not at this
  // one. Both signals are used: the native resume event is the accurate one,
  // visibilitychange covers the web view being hidden without the app leaving
  // the foreground at all.
  const onVisible = () => { if (!document.hidden) drain(); };
  document.addEventListener('visibilitychange', onVisible);

  let resumeHandle;
  Promise.resolve(CapApp.addListener('resume', () => { drain(); }))
    .then((h) => { resumeHandle = h; })
    .catch(() => { /* web build: no native app events, visibilitychange covers it */ });

  return () => {
    cancelled = true;
    document.removeEventListener('visibilitychange', onVisible);
    resumeHandle?.remove?.();
    handle?.remove?.();
  };
}
