// "Is there a new version?" — for both things this app ships as.
//
// WHAT AUTO-UPDATE CAN AND CANNOT MEAN HERE
// The app exists in two forms and they update completely differently:
//
//   Web / PWA   A service worker fetches the new build in the background. This
//               genuinely is automatic — the only thing needed from the user is
//               a reload, and even that we do for them on one tap.
//
//   Android APK Sideloaded, not from the Play Store. Android will NOT let an
//               app silently replace itself — the package installer always
//               asks, by design, and no permission unlocks that for a normal
//               app. So the honest feature is: detect automatically, download
//               on one tap, and let Android's own installer ask the last
//               question. Anything promising a silent update would be a lie.
//
// THE SUBTLE BUG THIS FILE IS SHAPED AROUND
// The APK bundles the whole `dist` folder, INCLUDING `version.json`. Fetching
// that manifest with a relative URL therefore reads the copy baked into the
// APK — which always matches the running version, so the app would report
// "already up to date" forever, no matter how many releases shipped. The
// manifest URL must be absolute and point at the hosted copy. Same reason the
// fetch is `no-store` with a cache-busting param: a stale cached manifest is
// indistinguishable from "no update", and fails in the silent direction.
//
// A NOTE ON HOW THE APK GETS HOSTED
// Firebase Hosting's free Spark tier refuses to serve `.apk` files at all
// ("Executable files are forbidden on the Spark billing plan" — hit live on
// this project on 2026-08-19). That restriction is Spark-specific; the project
// is on Blaze, so both `version.json` and the APK are served from the same
// Hosting deploy — see scripts/release.mjs. Blaze's free-tier quotas
// (10 GB stored / 360 MB transferred per day) comfortably cover a personal
// single-user app; this is not expected to generate any charge.
//
// version.json MUST BE SERVED WITH Access-Control-Allow-Origin
// The web build fetches this from the SAME origin it's served from, so this
// looked fine in every browser test. The Android APK does not: Capacitor's
// WebView runs the bundled app on `https://localhost` by default
// (capacitor.config.json's `server.androidScheme`), a DIFFERENT origin from
// `https://life-manager-a390b.web.app` where the manifest actually lives. A
// cross-origin `fetch()` without a CORS header on the response doesn't fail
// with anything that names CORS — the browser just refuses to let JS read the
// response, and `fetch()` rejects with a generic "Failed to fetch", which this
// file's catch block reports as a plain network error. So every check from
// inside the real app looked exactly like "offline", every single time — not
// intermittent, not the user's connection — until `firebase.json` added
// `Access-Control-Allow-Origin: *` on `/version.json` (safe: it's public,
// non-sensitive version metadata, not user data). Confirmed live 2026-08-19 by
// reproducing the exact cross-origin fetch from a real different-origin tab
// before and after the header was deployed.

import { ENV } from './env.js';
// Safe under Node: platform.js only reads `window.Capacitor` behind a `typeof`
// guard, so importing it doesn't cost this module its testability.
import { isNativePlatform } from './platform.js';

// Same local read/write convention as syncModel.js rather than importing
// storage.js: that pulls in React, and this module's whole decision layer is
// meant to be runnable — and testable — under plain Node with a stubbed
// localStorage. Nothing else in the app reads these keys reactively, so the
// change event storage.js fires would have no listener anyway.
const PREFIX = 'lifemanager:';

function read(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // A full or unavailable localStorage must not break an update check.
  }
}

/** Injected at build time — see vite.config.js. */
// `typeof` on an undeclared identifier is the one form that does NOT throw, so
// these still evaluate under plain Node (where Vite's define never ran) and in
// the dev server before a build has happened.
export const CURRENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? String(__APP_VERSION__) : '0.0.0';
export const BUILD_AT = typeof __BUILD_AT__ !== 'undefined' ? String(__BUILD_AT__) : '';

/**
 * Where the released manifest lives. Absolute for the reason in the header.
 * Overridable so a fork/self-host doesn't have to edit source.
 */
export const MANIFEST_URL =
  ENV.VITE_UPDATE_MANIFEST_URL || 'https://life-manager-a390b.web.app/version.json';

/** Don't hit the network on every single launch. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Fired whenever a check produces a result.
 *
 * There are two places that talk about updates — the banner and the version
 * panel in the backup sheet — and without this they keep independent copies of
 * the answer. Checking manually and being told "已经是最新版本" while a stale
 * "有新版本" banner sits above it is the app contradicting itself on screen.
 * Same pattern as storage.js's CHANGE_EVENT, and for the same reason.
 */
export const UPDATE_EVENT = 'lifemanager:update-state';

function announce(result) {
  try {
    globalThis.dispatchEvent?.(new CustomEvent(UPDATE_EVENT, { detail: result }));
  } catch {
    // No window (Node/test) — the return value is the whole answer there.
  }
  return result;
}

/**
 * Compare two dotted version strings.
 * @returns 1 if a > b, -1 if a < b, 0 if equal
 *
 * Segment-wise numeric, not string comparison — "1.10.0" is newer than "1.9.0",
 * which a lexicographic compare gets exactly backwards, and would then hide a
 * real update for as long as the minor version stayed in double digits.
 */
export function compareVersions(a, b) {
  const parse = (v) => String(v ?? '')
    .trim()
    .replace(/^v/i, '')
    // Drop any pre-release/build suffix ("1.2.0-beta.1") before comparing.
    .split(/[-+]/)[0]
    .split('.')
    .map(n => Number.parseInt(n, 10) || 0);

  const x = parse(a);
  const y = parse(b);
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const dx = x[i] ?? 0;
    const dy = y[i] ?? 0;
    if (dx !== dy) return dx > dy ? 1 : -1;
  }
  return 0;
}

/** Is `latest` newer than what's running? */
export function isNewer(latest, current = CURRENT_VERSION) {
  return compareVersions(latest, current) > 0;
}

/**
 * Read a release manifest into a predictable shape.
 *
 * Tolerant on purpose: this parses a file fetched off the network, and a
 * malformed manifest must degrade to "no update" rather than throwing inside
 * whatever component happened to trigger the check.
 */
export function parseManifest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const version = typeof raw.version === 'string' ? raw.version.trim() : '';
  if (!version) return null;
  return {
    version,
    buildAt: typeof raw.buildAt === 'string' ? raw.buildAt : null,
    notes: Array.isArray(raw.notes) ? raw.notes.filter(n => typeof n === 'string') : [],
    apkUrl: typeof raw.apk?.url === 'string' ? raw.apk.url : null,
    apkSize: Number.isFinite(Number(raw.apk?.size)) ? Number(raw.apk.size) : null,
    // A build so broken that older versions must not stay on it. Nothing sets
    // this today; it exists so a future bad release has a way to say so
    // instead of relying on the user noticing a dismissible banner.
    mandatory: raw.mandatory === true,
  };
}

/**
 * Decide what to show, given a manifest and what the user has already done.
 * Pure, so the whole decision is testable without a network.
 */
export function evaluate(manifest, {
  current = CURRENT_VERSION, dismissedVersion = null, native = false,
} = {}) {
  if (!manifest) return { available: false, reason: 'no-manifest' };
  if (!isNewer(manifest.version, current)) {
    // The manifest travels with the "nothing to do" answer too: an installed
    // APK still wants a way to re-download the copy it's already on, which is
    // the only self-service route back from a bad install.
    return { available: false, reason: 'up-to-date', latest: manifest.version, manifest };
  }
  // A newer version with no APK behind it is not an update THIS device can
  // take. Saying so is the whole point: the banner used to announce it anyway
  // and fall through to a 重新载入 button, which inside Capacitor does nothing
  // — the bundle is local, there is nothing to re-fetch. An announcement with
  // no action is worse than silence, because it looks like the app is broken.
  if (native && !manifest.apkUrl) {
    return { available: false, reason: 'no-apk', latest: manifest.version, manifest };
  }
  // Dismissal is per-version, never permanent: saying "not now" to 1.2.0 must
  // not also hide 1.3.0. A mandatory release ignores it entirely.
  if (!manifest.mandatory && dismissedVersion && compareVersions(dismissedVersion, manifest.version) >= 0) {
    return { available: false, reason: 'dismissed', latest: manifest.version };
  }
  return { available: true, reason: 'update', latest: manifest.version, manifest };
}

/** Has enough time passed to be worth another network call? */
export function shouldCheck(lastCheckedAt, now = Date.now(), interval = CHECK_INTERVAL_MS) {
  if (!lastCheckedAt) return true;
  // A clock that jumped backwards (timezone change, manual set) would otherwise
  // park `lastCheckedAt` in the future and suppress checks indefinitely.
  if (lastCheckedAt > now) return true;
  return now - lastCheckedAt >= interval;
}

/**
 * Fetch the manifest and work out whether there's something newer.
 *
 * Never throws — a failed check is a normal condition (offline, hosting not
 * deployed yet, DNS hiccup) and must not surface as an error in a screen the
 * user opened to do something else.
 */
export async function checkForUpdate({ force = false, now = Date.now() } = {}) {
  const lastCheckedAt = read('updateLastCheckedAt', 0);
  if (!force && !shouldCheck(lastCheckedAt, now)) {
    const cached = read('updateLastResult', null);
    return announce(cached ?? { available: false, reason: 'throttled' });
  }

  try {
    // `no-store` AND a cache-busting param: a service worker, a CDN or the
    // WebView's own HTTP cache could each serve a stale manifest, and a stale
    // manifest looks exactly like "no update available".
    const res = await fetch(`${MANIFEST_URL}?t=${now}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = parseManifest(await res.json());
    const result = evaluate(manifest, {
      dismissedVersion: read('updateDismissedVersion', null),
      native: isNativePlatform(),
    });

    write('updateLastCheckedAt', now);
    write('updateLastResult', result);
    return announce(result);
  } catch (e) {
    // Deliberately not cached — an offline check must not suppress the next
    // one for six hours. Not announced either: a failed check is not new
    // information about the version, and must not clear a banner that a
    // previous, successful check correctly put up.
    return { available: false, reason: 'error', error: String(e?.message ?? e) };
  }
}

/** "Not now" for this version only. */
export function dismissVersion(version) {
  if (version) write('updateDismissedVersion', version);
  const result = { available: false, reason: 'dismissed', latest: version };
  write('updateLastResult', result);
  return announce(result);
}

/** Human-readable download size for the button. */
export function formatSize(bytes) {
  if (!bytes) return null;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
