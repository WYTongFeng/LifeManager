// Runs the Android build with the two workarounds this machine needs.
//
// Both are documented in full in android/BUILD_NOTES.md; this script exists so
// they can't be forgotten, because forgetting the second one fails SILENTLY:
// the JVM refuses to start, but gradlew still exits 0, leaving the previous
// APK sitting there looking like a fresh successful build.
//
//   1. JDK 21 specifically (capacitor-android compiles at Java 21 language
//      level; JDK 17 fails with "invalid source release: 21").
//   2. A java agent that disables AF_UNIX sockets, which Gradle's own
//      client/daemon handshake otherwise trips over on this machine.
//   3. That agent's jar must live at a path with NO SPACES — the JVM splits
//      JAVA_TOOL_OPTIONS on whitespace and no quoting survives, and this
//      project lives under "C:\Users\MacBook Pro\".

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = resolve(ROOT, 'android');
const AGENT_SRC = resolve(ANDROID, 'build-agent/agent.jar');
const APK = resolve(ANDROID, 'app/build/outputs/apk/debug/app-debug.apk');

const JAVA_HOME = process.env.LIFEMANAGER_JDK21 || 'C:\\AndroidStudio\\jbr';

function spaceFreeAgent() {
  if (!existsSync(AGENT_SRC)) {
    throw new Error(
      `Build agent missing at ${AGENT_SRC}. Rebuild it — see android/BUILD_NOTES.md.`
    );
  }
  // tmpdir() can itself contain a space on some setups; the 8.3-style path
  // Windows reports for %TEMP% usually doesn't, but check rather than assume.
  const candidates = [join(tmpdir(), 'lifemanager-build'), 'C:\\lm-build'];
  for (const dir of candidates) {
    if (dir.includes(' ')) continue;
    try {
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, 'agent.jar');
      copyFileSync(AGENT_SRC, dest);
      return dest.replace(/\\/g, '/');
    } catch {
      // Try the next candidate rather than failing on a permissions problem.
    }
  }
  throw new Error(
    'Could not place the build agent at a space-free path. '
    + 'Copy android/build-agent/agent.jar somewhere without spaces and set '
    + 'JAVA_TOOL_OPTIONS yourself — see android/BUILD_NOTES.md.'
  );
}

/**
 * The APK is built FROM `dist`, and the manifest writer stages a copy of the
 * previous APK in `dist/downloads/`. Syncing that into the Android assets would
 * embed the last APK inside the new one — every release carrying its
 * predecessor around, 4.5 MB at a time. Clearing it first is what keeps the
 * "any build writes a complete manifest" rule from costing anything: the fresh
 * APK is staged again straight after this, by release.mjs.
 */
function clearStagedApks() {
  const staged = resolve(ROOT, 'dist/downloads');
  if (existsSync(staged)) rmSync(staged, { recursive: true, force: true });
}

const before = existsSync(APK) ? statSync(APK).mtimeMs : 0;
const agent = spaceFreeAgent();

clearStagedApks();
// Run here rather than as a separate npm step, so the clearing above can never
// be skipped by calling the sync directly.
execSync('npx cap sync android', { cwd: ROOT, stdio: 'inherit' });

console.log(`\nBuilding APK\n  JDK   : ${JAVA_HOME}\n  agent : ${agent}\n`);

// execSync runs through cmd.exe on Windows, which needs the .bat wrapper AND
// an explicit path — unlike a POSIX shell, cmd does not have "." on PATH, so a
// bare `gradlew.bat` in the working directory is "not recognized". Quoted
// because this project lives under "C:\Users\MacBook Pro\\".
const gradlew = process.platform === 'win32'
  ? `"${resolve(ANDROID, 'gradlew.bat')}"`
  : './gradlew';

execSync(`${gradlew} assembleDebug --no-daemon`, {
  cwd: ANDROID,
  stdio: 'inherit',
  env: { ...process.env, JAVA_HOME, JAVA_TOOL_OPTIONS: `-javaagent:${agent}` },
});

/**
 * Did this build actually produce an APK containing the web build we just made?
 *
 * mtime alone cannot answer that here. Windows updates a file's last-write time
 * lazily — the gradle daemon is a separate, short-lived `java` process, and this
 * one can stat the APK it wrote and still see the OLD timestamp for a moment
 * after it exits. That false negative failed a perfectly good build on
 * 2026-09-06. So ask the question that actually matters instead: vite gives the
 * entry chunk a content hash, `cap sync` copies it to assets/public/, and a zip
 * stores every entry's name as plain bytes — so a substring search over the APK
 * proves the current dist is inside it, with no zip parsing and no clock.
 */
function embedsCurrentWebBuild() {
  const html = resolve(ROOT, 'dist/index.html');
  if (!existsSync(html)) return null; // nothing to compare against
  const entry = readFileSync(html, 'utf8').match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  if (!entry) return null;
  return readFileSync(APK).includes(`assets/public/${entry[0]}`);
}

// gradlew exits 0 even when the JVM never started, so the exit code proves
// nothing.
if (!existsSync(APK)) throw new Error(`No APK produced at ${APK}.`);
const embedded = embedsCurrentWebBuild();
if (embedded === false) {
  throw new Error(
    'gradlew exited 0 but the APK does not contain the web build in dist/ — the build '
    + 'did nothing and the previous APK is still sitting there. Almost always the java '
    + 'agent failing to load; check the output above for "agent library failed '
    + 'Agent_OnLoad". See android/BUILD_NOTES.md.'
  );
}
if (embedded === null && statSync(APK).mtimeMs === before) {
  // No dist to check against, so mtime is all there is — and it can lie (above).
  console.warn('\nWARNING: could not confirm the APK was rebuilt (no dist/index.html '
    + 'to match against, and its mtime did not move). Verify it by hand.\n');
}

console.log(`\nAPK built: ${APK} (${(statSync(APK).size / 1024 / 1024).toFixed(1)} MB)\n`);
