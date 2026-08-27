import java.lang.instrument.Instrumentation;
import java.lang.reflect.Field;
import sun.misc.Unsafe;

/**
 * Works around a Gradle build failure specific to this dev environment:
 * `java.io.IOException: Unable to establish loopback connection` the instant
 * Gradle (or any JVM) calls `Selector.open()` on JDK 17+ on Windows.
 *
 * Root cause: since JDK 17, `sun.nio.ch.PipeImpl` — used internally by every
 * `Selector` for its wakeup mechanism, and by Gradle's own client/daemon
 * socket handshake — prefers a Unix domain socket over TCP loopback when
 * `UnixDomainSockets.isSupported()` is true. In this sandbox, binding an
 * AF_UNIX socket succeeds but the immediate self-connect fails with
 * `SocketException: Invalid argument: connect`, and PipeImpl has no fallback
 * for a connect failure (only for a bind failure) — see PipeImpl.createListener.
 *
 * `UnixDomainSockets.supported` is a native-probed `static final boolean`,
 * not backed by any system property, so it can't be toggled with a `-D` flag.
 * This agent forces it to `false` via `sun.misc.Unsafe` before any Selector
 * gets opened, so PipeImpl falls back to its normal TCP-loopback path — which
 * genuinely works here (confirmed independently of this whole AF_UNIX issue).
 *
 * USAGE — see BUILD_NOTES.md in this directory for the full recipe. Compile:
 *   javac -d out DisableAfUnix.java
 *   jar cfm agent.jar MANIFEST.MF -C out .
 * Then run any JVM (including Gradle) with:
 *   -javaagent:/path/to/agent.jar
 * or set it via JAVA_TOOL_OPTIONS so it also reaches Gradle's spawned daemon
 * subprocess, which is a separate `java` invocation and won't otherwise see
 * a `-javaagent` flag passed only to the wrapper script.
 */
public class DisableAfUnix {
  public static void premain(String args, Instrumentation inst) {
    try {
      Field unsafeField = Unsafe.class.getDeclaredField("theUnsafe");
      unsafeField.setAccessible(true);
      Unsafe unsafe = (Unsafe) unsafeField.get(null);

      Class<?> c = Class.forName("sun.nio.ch.UnixDomainSockets");
      Field f = c.getDeclaredField("supported");
      Object base = unsafe.staticFieldBase(f);
      long offset = unsafe.staticFieldOffset(f);
      unsafe.putBoolean(base, offset, false);

      System.err.println("[DisableAfUnix] forced UnixDomainSockets.supported=false (now: "
          + unsafe.getBoolean(base, offset) + ")");
    } catch (Throwable t) {
      System.err.println("[DisableAfUnix] failed: " + t);
      t.printStackTrace();
    }
  }
}
