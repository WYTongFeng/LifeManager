// Runs as firebase.json's `predeploy` hook. A non-zero exit aborts the deploy.
//
// WHAT IT IS PROTECTING AGAINST
// `dist/` is deployable at every moment of its life, including the moments when
// it is wrong. On 2026-08-20 a deploy landed in the ~60s window between the web
// build and the APK finishing, publishing a manifest with `apk: null` under a
// bumped version number. Every installed APK then saw "there's a new version"
// and had nothing to download — the banner fell through to a 重新载入 button,
// which inside Capacitor does nothing at all, because the bundle is local.
//
// The version bump is the dangerous half: `dist` from a plain `npm run build`
// is perfectly fine to publish as long as it doesn't ANNOUNCE something it
// can't hand over. So that is exactly what this checks, and nothing more.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtApkVersion, releaseNotesFor } from './manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

const problems = [];
const manifestPath = resolve(DIST, 'version.json');

if (!existsSync(manifestPath)) {
  problems.push('dist/version.json is missing — run `npm run release` before deploying.');
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  if (manifest.version !== pkg.version) {
    problems.push(
      `dist/version.json says v${manifest.version}, package.json says v${pkg.version}. `
      + 'The build in dist/ is from a different version — rebuild before deploying.'
    );
  }

  // The core rule: if an APK for this version exists, it must be published with
  // it. Otherwise phones are told about a version they cannot install.
  const apkVersion = builtApkVersion(ROOT);
  if (apkVersion === pkg.version && !manifest.apk) {
    problems.push(
      `An APK for v${pkg.version} is built, but dist/version.json has no apk block. `
      + 'The manifest was overwritten by a plain `vite build` after the release '
      + '(that empties dist/downloads/ too). Re-run `npm run release`.'
    );
  }

  if (manifest.apk) {
    const file = manifest.apk.url.split('/').pop();
    if (!existsSync(resolve(DIST, 'downloads', file))) {
      problems.push(
        `The manifest points at downloads/${file}, which is not in dist/. `
        + 'The download link would 404 on every phone. Re-run `npm run release`.'
      );
    }
  }

  // Not fatal on its own, but a release whose notes vanished is a release
  // nobody can tell apart from the last one.
  const expected = releaseNotesFor(ROOT, pkg.version);
  if (expected.length && !manifest.notes?.length) {
    problems.push(
      `RELEASE_NOTES.json has notes for v${pkg.version} but the manifest carries none — `
      + 'same overwritten-manifest cause as above. Re-run `npm run release`.'
    );
  }
}

if (problems.length) {
  console.error('\n  Deploy blocked — dist/ would publish an update nobody can install:\n');
  for (const p of problems) console.error(`   • ${p}`);
  console.error('');
  process.exit(1);
}

console.log('  release check: dist/version.json is consistent with the build on disk.');
