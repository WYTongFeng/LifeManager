// The one place `dist/version.json` is written.
//
// WHY THIS FILE EXISTS
// It used to be written twice, by two different pieces of code that disagreed:
// vite.config.js's plugin wrote a placeholder (`notes: []`, `apk: null`) on
// every build, and scripts/release.mjs rewrote it afterwards with the real
// notes and APK. That leaves two windows where `dist/` is a fully deployable
// directory containing a manifest that LIES:
//
//   1. During a release, between the web build finishing and the APK finishing
//      (~60s of Gradle). Deploy in that window and every installed APK is told
//      "there's a new version" with nothing to download.
//   2. After any later `npm run build` — including one run by a different
//      terminal or agent session in the same tree — because vite empties
//      `dist/`, taking `downloads/` with it and resetting the manifest.
//
// Both happened on 2026-08-20 and the phone showed an update banner whose only
// button was 重新载入, which inside Capacitor does nothing: the bundle is local,
// there is nothing to re-fetch. See MILESTONES.md M50.
//
// So the manifest is now derived from what is actually on disk, every time it
// is written: notes come from RELEASE_NOTES.json, and the APK block exists if
// and only if a built APK declaring THIS version is sitting in the Android
// output directory. A plain `npm run build` now produces the same complete,
// truthful manifest a release does.

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync,
} from 'node:fs';
import { resolve } from 'node:path';

/** Where the published copy lives. Must match VITE_UPDATE_MANIFEST_URL's origin
 *  (see src/utils/updates.js) or installed apps check one host and download
 *  from another. Read here rather than in vite.config.js, which has no
 *  `process` global. */
export const BASE_URL = process.env.RELEASE_BASE_URL || 'https://life-manager-a390b.web.app';

export const apkPath = (root) =>
  resolve(root, 'android/app/build/outputs/apk/debug/app-debug.apk');

const apkMetaPath = (root) =>
  resolve(root, 'android/app/build/outputs/apk/debug/output-metadata.json');

/**
 * The version the built APK actually declares, or null if there is no usable
 * APK. Read from Gradle's own output metadata rather than assumed from
 * package.json: after a version bump the APK on disk is the PREVIOUS version,
 * and publishing that one as the new release is exactly the kind of silent
 * mismatch this whole file exists to prevent.
 */
export function builtApkVersion(root) {
  if (!existsSync(apkPath(root)) || !existsSync(apkMetaPath(root))) return null;
  try {
    const meta = JSON.parse(readFileSync(apkMetaPath(root), 'utf8'));
    const name = meta?.elements?.[0]?.versionName;
    return typeof name === 'string' && name ? name : null;
  } catch {
    return null;
  }
}

export function releaseNotesFor(root, version) {
  const path = resolve(root, 'RELEASE_NOTES.json');
  if (!existsSync(path)) return [];
  try {
    const all = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(all[version]) ? all[version] : [];
  } catch {
    return [];
  }
}

/**
 * Write `dist/version.json`, and stage the APK next to it when there is one
 * for this exact version.
 *
 * @returns the manifest that was written
 */
export function writeVersionManifest({ root, dist, version, buildAt }) {
  let apk = null;

  if (builtApkVersion(root) === version) {
    const src = apkPath(root);
    const outDir = resolve(dist, 'downloads');
    mkdirSync(outDir, { recursive: true });
    const fileName = `lifemanager-${version}.apk`;
    copyFileSync(src, resolve(outDir, fileName));
    // A stable filename too, so a link written down once keeps working.
    copyFileSync(src, resolve(outDir, 'lifemanager-latest.apk'));
    apk = { url: `${BASE_URL}/downloads/${fileName}`, size: statSync(src).size };
  }

  const manifest = { version, buildAt, notes: releaseNotesFor(root, version), apk };
  writeFileSync(resolve(dist, 'version.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
