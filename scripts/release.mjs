// One command that produces a releasable set: web build, APK, and the manifest
// that tells already-installed copies a new version exists.
//
// EVERYTHING GOES THROUGH FIREBASE HOSTING
// Firebase Hosting's free Spark tier refuses to serve certain file types —
// `.apk` included — with a flat 400 error: "Executable files are forbidden on
// the Spark billing plan." Confirmed live against this project on 2026-08-19.
// That restriction is Spark-specific; it does not apply on Blaze (pay-as-you-go,
// but still free under the same generous no-cost quotas Hosting has always had
// — 10 GB stored / 360 MB transferred per day — which a single-user personal
// app downloading a ~5 MB APK now and then will never come close to). The
// project is on Blaze as of 2026-08-19, so the APK is served straight from
// Hosting like everything else — one deploy command, no manual per-release
// upload step.
//
// WHY THE BUILD ORDER MATTERS
// The APK is built FROM `dist`, and then copied INTO `dist` for hosting. Doing
// those the other way round would embed the previous release's 5 MB APK inside
// the new one — every release carrying the last one around with it. So:
//
//   1. vite build               -> dist/ + a manifest describing whatever APK
//                                  is already on disk for this version
//   2. build-apk.mjs            -> clears dist/downloads, cap sync,
//                                  assembleDebug (built from that clean dist)
//   3. verify + rewrite dist/version.json around the fresh APK
//   4. firebase deploy --only hosting
//
// Step 4 is left to the user: it needs their Firebase login, and publishing is
// the one step here that is visible to the outside world. It runs
// `check-release.mjs` first (firebase.json's predeploy hook), which refuses to
// publish a manifest that promises an update it can't deliver.
//
// `--web-only` skips rebuilding the APK. The manifest still publishes an
// existing APK for this exact version if there is one — what it must never do
// is publish a version bump with no APK and let installed copies show an update
// banner with nothing behind it.

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeVersionManifest, builtApkVersion, BASE_URL } from './manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const webOnly = args.includes('--web-only');
const skipBuild = args.includes('--skip-build');

const APK_PATH = resolve(ROOT, 'android/app/build/outputs/apk/debug/app-debug.apk');
const DIST = resolve(ROOT, 'dist');

const run = (cmd, opts = {}) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
};

function buildWeb() {
  run('npx vite build');
}

/** `cap sync` lives inside build-apk.mjs, which clears the staged APK from
 *  `dist/downloads` first — see that file for why the order matters. */
function buildApk() {
  run('node scripts/build-apk.mjs');
}

/**
 * Check the APK is real, then rewrite the manifest so it picks it up.
 *
 * The staleness guard is the point: a broken `JAVA_TOOL_OPTIONS` makes gradlew
 * exit 0 while producing nothing (android/BUILD_NOTES.md, problem 3), leaving
 * the previous APK sitting there looking like a fresh successful build. An APK
 * older than the web build it is supposed to contain cannot be the right one.
 */
function verifyApk() {
  if (!existsSync(APK_PATH)) {
    throw new Error(`APK not found at ${APK_PATH} — run the APK build first, or pass --web-only.`);
  }
  if (builtApkVersion(ROOT) !== pkg.version) {
    throw new Error(
      `The built APK declares v${builtApkVersion(ROOT)}, but package.json says v${pkg.version}. `
      + 'Gradle did not rebuild after the version bump — refusing to publish a mismatched APK.'
    );
  }
  if (statSync(APK_PATH).mtimeMs < statSync(resolve(DIST, 'index.html')).mtimeMs) {
    throw new Error(
      'The APK is OLDER than the web build it should contain — the Gradle build almost '
      + 'certainly did nothing (see android/BUILD_NOTES.md, problem 3). Refusing to publish it.'
    );
  }
}

/** Rewrite the manifest now the APK exists. The build time stays the web
 *  build's, which is what the running app compares against. */
function writeManifest() {
  const existing = JSON.parse(readFileSync(resolve(DIST, 'version.json'), 'utf8'));
  return writeVersionManifest({
    root: ROOT, dist: DIST, version: pkg.version, buildAt: existing.buildAt,
  });
}

try {
  if (!skipBuild) buildWeb();
  if (!webOnly) buildApk();

  if (!webOnly) verifyApk();
  const manifest = writeManifest();
  const apk = manifest.apk;

  console.log('\n─────────────────────────────────────────');
  console.log(` v${manifest.version} ready to publish`);
  console.log(`  manifest : dist/version.json`);
  if (apk) console.log(`  apk      : dist/downloads/ (${(apk.size / 1024 / 1024).toFixed(1)} MB)`);
  else console.log('  apk      : none — web-only release');
  if (manifest.notes.length) console.log(`  notes    : ${manifest.notes.join(' · ')}`);
  console.log('\n Publish it with:');
  console.log('   firebase deploy --only hosting');
  console.log('\n Installed copies check ' + BASE_URL + '/version.json');
  console.log('─────────────────────────────────────────\n');
} catch (e) {
  console.error(`\nRelease failed: ${e.message}\n`);
  process.exit(1);
}
