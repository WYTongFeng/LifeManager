// What goes into `dist/version.json`, and — the part that actually broke — what
// must NOT.
//
// A manifest saying `apk: null` under a bumped version number is not a harmless
// placeholder: every installed APK reads it, announces "there's a new version",
// and has nothing to download. That shipped on 2026-08-20 (M50), twice, because
// the manifest was written in two places that disagreed and `dist/` is
// deployable at every moment of its life.

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeVersionManifest, builtApkVersion, releaseNotesFor } from './manifest.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

/** A throwaway project tree: package.json, notes, a "built" APK, and dist. */
function fixture({ apkVersion = null, notes = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lm-manifest-'));
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'RELEASE_NOTES.json'), JSON.stringify(notes));

  if (apkVersion) {
    const out = join(root, 'android/app/build/outputs/apk/debug');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'app-debug.apk'), 'not a real apk, but a real file');
    writeFileSync(join(out, 'output-metadata.json'), JSON.stringify({
      elements: [{ versionCode: 10206, versionName: apkVersion, outputFile: 'app-debug.apk' }],
    }));
  }
  return root;
}

const read = (root) => JSON.parse(readFileSync(join(root, 'dist/version.json'), 'utf8'));
const roots = [];
const make = (opts) => { const r = fixture(opts); roots.push(r); return r; };

// --- the APK is published when, and only when, it is for THIS version -------
let root = make({ apkVersion: '1.2.6', notes: { '1.2.6': ['fixed sync'] } });
let m = writeVersionManifest({ root, dist: join(root, 'dist'), version: '1.2.6', buildAt: 'T' });
check('an APK for this version is published', Boolean(m.apk), true);
check('...at a URL naming the version', m.apk.url.endsWith('/downloads/lifemanager-1.2.6.apk'), true);
check('...and the file is really staged where the URL points',
  existsSync(join(root, 'dist/downloads/lifemanager-1.2.6.apk')), true);
check('...with the stable alias beside it, so a written-down link keeps working',
  existsSync(join(root, 'dist/downloads/lifemanager-latest.apk')), true);
check('release notes come along', m.notes, ['fixed sync']);
check('and the file on disk matches what was returned', read(root).apk.size, m.apk.size);

// THE VERSION-BUMP TRAP: package.json says 1.2.7, but Gradle hasn't run yet, so
// the APK sitting there is still 1.2.6. Publishing it as 1.2.7 would hand every
// phone an installer that silently does nothing (same versionCode as installed).
root = make({ apkVersion: '1.2.6', notes: {} });
m = writeVersionManifest({ root, dist: join(root, 'dist'), version: '1.2.7', buildAt: 'T' });
check('an APK from the PREVIOUS version is never published as the new one', m.apk, null);
check('and nothing is staged for it', existsSync(join(root, 'dist/downloads')), false);

// --- no APK at all: a web-only build ---------------------------------------
root = make({ notes: { '1.2.6': ['web only'] } });
m = writeVersionManifest({ root, dist: join(root, 'dist'), version: '1.2.6', buildAt: 'T' });
check('no APK on disk -> no apk block, but still a valid manifest', m.apk, null);
check('...and the notes are still there', m.notes, ['web only']);
check('...and the version and build time are still written', [m.version, m.buildAt], ['1.2.6', 'T']);

// --- metadata without the file it describes --------------------------------
// Gradle's metadata outlives a deleted APK. Trusting it alone would produce a
// manifest pointing at a download that 404s on every phone.
root = make({ apkVersion: '1.2.6' });
rmSync(join(root, 'android/app/build/outputs/apk/debug/app-debug.apk'));
check('metadata without an actual APK file reads as no APK', builtApkVersion(root), null);

// --- notes lookup ----------------------------------------------------------
root = make({ notes: { '1.2.6': ['a', 'b'] } });
check('notes are found by exact version', releaseNotesFor(root, '1.2.6'), ['a', 'b']);
check('a version with no notes is empty, not undefined', releaseNotesFor(root, '9.9.9'), []);

for (const r of roots) rmSync(r, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
