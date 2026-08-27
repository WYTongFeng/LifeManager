// Update detection: version comparison, what to show, and when to re-check.
//
// All the interesting logic here is pure precisely so it can be tested without
// a network — the failure modes (a stale manifest, a backwards comparison, a
// dismissal that sticks forever) are all silent ones that would otherwise only
// show up as "the app never told me there was an update".

import {
  compareVersions, isNewer, parseManifest, evaluate, shouldCheck, formatSize,
} from '../src/utils/updates.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// --- version comparison ----------------------------------------------------
check('equal versions', compareVersions('1.2.3', '1.2.3'), 0);
check('patch newer', compareVersions('1.2.4', '1.2.3'), 1);
check('patch older', compareVersions('1.2.3', '1.2.4'), -1);
check('minor beats patch', compareVersions('1.3.0', '1.2.99'), 1);
check('major beats minor', compareVersions('2.0.0', '1.99.99'), 1);

// The one a string comparison gets exactly backwards — and it would then hide
// every update for as long as the minor stayed in double digits.
check('1.10.0 is newer than 1.9.0', compareVersions('1.10.0', '1.9.0'), 1);
check('1.9.0 is older than 1.10.0', compareVersions('1.9.0', '1.10.0'), -1);
// Spelled out via a variable so the linter doesn't fold it away as a constant
// comparison — the whole point is to demonstrate the wrong answer next to the
// right one.
const naiveStringCompare = (a, b) => a > b;
check('and a plain string sort would get it wrong', naiveStringCompare('1.10.0', '1.9.0'), false);

check('missing segments count as zero', compareVersions('1.2', '1.2.0'), 0);
check('a leading v is ignored', compareVersions('v1.3.0', '1.2.0'), 1);
check('a pre-release suffix is ignored for ordering', compareVersions('1.3.0-beta.1', '1.3.0'), 0);
check('garbage sorts as 0.0.0, never as newer', compareVersions('nonsense', '0.0.1'), -1);
check('undefined is not newer than anything', isNewer(undefined, '1.0.0'), false);

// --- manifest parsing ------------------------------------------------------
const good = parseManifest({
  version: ' 1.2.0 ',
  buildAt: '2026-08-19T00:00:00.000Z',
  notes: ['户口转账', 42, '13 组'],
  apk: { url: 'https://example.test/app.apk', size: 4933358 },
});
check('version is trimmed', good.version, '1.2.0');
check('non-string notes are dropped rather than rendered as junk', good.notes, ['户口转账', '13 组']);
check('apk url read', good.apkUrl, 'https://example.test/app.apk');
check('apk size read', good.apkSize, 4933358);
check('not mandatory unless it says so', good.mandatory, false);

// A manifest fetched off the network must degrade to "no update", never throw
// inside whatever screen happened to trigger the check.
check('null manifest', parseManifest(null), null);
check('a string is not a manifest', parseManifest('1.2.0'), null);
check('no version means no manifest', parseManifest({ notes: ['hi'] }), null);
check('empty version means no manifest', parseManifest({ version: '   ' }), null);
check('a manifest with no apk still parses (web-only release)',
  parseManifest({ version: '1.2.0' }).apkUrl, null);

// --- what to show ----------------------------------------------------------
const m = parseManifest({ version: '1.2.0' });
check('newer version is offered',
  evaluate(m, { current: '1.1.0' }).available, true);
check('same version is not', evaluate(m, { current: '1.2.0' }).available, false);
check('older remote version is not (a rollback must not look like an update)',
  evaluate(m, { current: '1.3.0' }).available, false);
check('reason is reported so the UI can say "已是最新"',
  evaluate(m, { current: '1.2.0' }).reason, 'up-to-date');
check('a broken fetch reports no-manifest', evaluate(null, { current: '1.0.0' }).reason, 'no-manifest');

// Dismissal is per-version. Saying "not now" to 1.2.0 must not also silence
// 1.3.0 — that's how an update prompt quietly stops working forever.
check('dismissing this version hides it',
  evaluate(m, { current: '1.1.0', dismissedVersion: '1.2.0' }).available, false);
check('but the NEXT version still shows',
  evaluate(parseManifest({ version: '1.3.0' }), { current: '1.1.0', dismissedVersion: '1.2.0' }).available, true);
check('dismissing a newer version than the one offered also hides it',
  evaluate(m, { current: '1.1.0', dismissedVersion: '1.5.0' }).available, false);
check('a mandatory release ignores dismissal',
  evaluate(parseManifest({ version: '1.2.0', mandatory: true }),
    { current: '1.1.0', dismissedVersion: '1.2.0' }).available, true);

// --- throttling ------------------------------------------------------------
const now = 1_000_000_000_000;
const SIX_HOURS = 6 * 60 * 60 * 1000;
check('never checked before -> check', shouldCheck(0, now), true);
check('checked just now -> skip', shouldCheck(now - 1000, now), false);
check('checked 5 hours ago -> skip', shouldCheck(now - 5 * 60 * 60 * 1000, now), false);
check('checked 6 hours ago -> check', shouldCheck(now - SIX_HOURS, now), true);
check('checked 2 days ago -> check', shouldCheck(now - 48 * 60 * 60 * 1000, now), true);

// A clock that jumped backwards (timezone change, manual set) would otherwise
// park the last-checked stamp in the future and suppress checks indefinitely.
check('a last-check stamp in the future does not wedge the checker',
  shouldCheck(now + 99999999, now), true);

// --- an update the phone can't actually install ----------------------------
// The release that shipped as `apk: null` (2026-08-20, M50). The APK announced
// "有新版本 v1.2.6" and the only button under it was 重新载入, which inside
// Capacitor does nothing at all — the bundle is local, there is nothing to
// re-fetch. On native, a version with no APK behind it is not an update.
const noApk = parseManifest({ version: '1.3.0' });
const withApk = parseManifest({
  version: '1.3.0', apk: { url: 'https://example.test/downloads/x.apk', size: 4700000 },
});
check('native: a release with no APK is not offered as an update',
  evaluate(noApk, { current: '1.2.0', native: true }).available, false);
check('...and says why, rather than looking like a failed check',
  evaluate(noApk, { current: '1.2.0', native: true }).reason, 'no-apk');
check('native: a release WITH an APK still is an update',
  evaluate(withApk, { current: '1.2.0', native: true }).available, true);
check('web is unaffected — it updates through the service worker, not an APK',
  evaluate(noApk, { current: '1.2.0', native: false }).available, true);

// The settings sheet's permanent download link reads the manifest off the
// result, so "nothing to do" has to carry one too — otherwise the only way to
// get the APK is a banner that appears on its own terms and hides itself again.
check('being up to date still hands back the manifest',
  evaluate(withApk, { current: '1.3.0', native: true }).manifest?.apkUrl,
  'https://example.test/downloads/x.apk');
check('...and so does the no-apk answer',
  evaluate(noApk, { current: '1.2.0', native: true }).manifest?.version, '1.3.0');

// --- display ---------------------------------------------------------------
check('size formatted for the button', formatSize(4933358), '4.7 MB');
check('no size, no text', formatSize(null), null);
check('zero is treated as unknown, not "0.0 MB"', formatSize(0), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
