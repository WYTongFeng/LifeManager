# Building the APK on this machine

Two environment-specific problems stood between `android/` and a real APK. Both are worked around
below; neither is a problem with the app's own code.

## Problem 1: Gradle can't even start

```
java.io.IOException: Unable to establish loopback connection
```

Since JDK 17, `Selector.open()` on Windows tries a Unix domain socket internally before TCP
loopback (`sun.nio.ch.PipeImpl`, gated by `UnixDomainSockets.isSupported()`). In this sandbox,
binding that socket succeeds but the immediate self-connect fails, and there's no fallback for a
connect failure (only for a bind failure) — every JDK 17+ build on this machine hits it (confirmed
against 17.0.1, 17.0.20, 21, and 25). JDK 11 doesn't have the issue at all (`WindowsSelectorProvider`
uses plain TCP loopback), but Gradle's Android plugin refuses to run on anything older than JDK 17.

Fix: `build-agent/DisableAfUnix.java` — a tiny Java agent that force-flips
`UnixDomainSockets.supported` to `false` via `sun.misc.Unsafe` before any `Selector` opens, so
`PipeImpl` takes its normal TCP-loopback path. See that file's header comment for the full mechanism.

## Problem 2: the project needs JDK 21 specifically

`capacitor-android` (Capacitor 8.x) compiles against Java 21 language level. JDK 17 gets
`error: invalid source release: 21`. Use `C:\AndroidStudio\jbr` (Android Studio's bundled JDK, is
JDK 21) as `JAVA_HOME` — with the agent from Problem 1 applied, since JDK 21 has the exact same
AF_UNIX issue.

## The actual recipe

```bash
cd android/build-agent
"C:\AndroidStudio\jbr\bin\javac.exe" -d out DisableAfUnix.java
"C:\AndroidStudio\jbr\bin\jar.exe" cfm agent.jar MANIFEST.MF -C out .

cd ..
JAVA_HOME="C:\AndroidStudio\jbr" \
JAVA_TOOL_OPTIONS="-javaagent:/c/space-free/dir/agent.jar" \
./gradlew assembleDebug --no-daemon
```

## Problem 3: `JAVA_TOOL_OPTIONS` cannot express a path containing a space

The obvious `-javaagent:$(pwd)/build-agent/agent.jar` fails on this machine, because the project
lives under `C:\Users\MacBook Pro\...`:

```
Error opening zip file or JAR manifest missing : C:/Users/MacBook
agent library failed Agent_OnLoad: instrument
```

The JVM splits `JAVA_TOOL_OPTIONS` on whitespace before anything else reads it, and there is no
quoting or escaping that survives — the value is never shell-parsed, so quotes just end up as literal
characters inside the path. The only fix is to copy the jar somewhere without a space and point at
that copy:

```bash
cp android/build-agent/agent.jar /c/space-free/dir/agent.jar
```

Worth knowing because the failure is nearly silent: the JVM refuses to start, but **gradlew still
exits 0**, so a stale `app-debug.apk` from a previous run sits there looking like a fresh successful
build. Always check the APK's mtime, not just the exit code.

`JAVA_TOOL_OPTIONS` (not a `gradlew` flag) is deliberate — it's read directly by every JVM that
starts, including the single-use daemon Gradle forks internally as a *separate* `java` process. A
`-javaagent` flag passed only to the wrapper script's own JVM would never reach that daemon.

Output: `android/app/build/outputs/apk/debug/app-debug.apk`.

Verified 2026-08-14: real build, real DEX bytecode, real `AndroidManifest.xml`, the actual built web
app embedded under `assets/public/`. Not installed on a physical device or tested from here — that
needs the user's phone.
