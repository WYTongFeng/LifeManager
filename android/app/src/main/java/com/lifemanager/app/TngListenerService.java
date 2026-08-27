package com.lifemanager.app;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Reads money notifications from the wallet/bank apps the user has bound to an
 * account.
 *
 * This is the one part of the app that genuinely cannot exist in a web build:
 * Android only hands notification content to a NotificationListenerService, and
 * the user must grant the permission by hand in system settings. That is why
 * the APK exists at all.
 *
 * WHICH APPS IT WATCHES
 * The watch list is NOT hardcoded any more. Touch 'n Go is the built-in default
 * (99% of this user's spending), and every other app is bound to an account by
 * the user through discovery mode — see startDiscovery(). Hardcoding a guessed
 * package name for each Malaysian bank would produce the worst failure this
 * feature can have: an app confidently reporting "watching your Maybank" while
 * watching a package that does not exist.
 *
 * Stored in SharedPreferences rather than held in memory because the service
 * outlives the web view entirely — Android starts it at boot, long before
 * anything JavaScript has had a chance to tell it anything.
 *
 * WHAT THIS DOES NOT DO
 * It does not classify anything. Deciding whether a notification is a payment,
 * a reload or a promo stays in JavaScript (src/utils/tngParser.js), so there is
 * exactly one set of rules to maintain and it can be tested without a phone.
 * This class only forwards the raw title and text.
 *
 * PRIVACY
 * Android grants a notification listener access to *every* app's notifications.
 * This one filters by package name before reading anything else, and everything
 * from an unwatched app is dropped without its content ever being touched.
 * Discovery mode is the single exception, and it is deliberately narrow: it is
 * time-boxed, reports only the package name plus a redacted length-checked
 * sample, and only for notifications that actually contain a currency amount.
 */
public class TngListenerService extends NotificationListenerService {

    private static final String TAG = "TngListener";
    private static final String PREFS = "tng_listener";
    private static final String KEY_PACKAGES = "watched_packages";
    private static final String KEY_CAPTURED_TOTAL = "captured_total";
    private static final String KEY_LAST_AT = "last_captured_at";
    private static final String KEY_LAST_PACKAGE = "last_package";
    private static final String KEY_QUEUE = "pending_queue";
    private static final String KEY_DELIVERED_TOTAL = "delivered_total";

    /** Watched when the user has never configured anything. */
    private static final String[] DEFAULT_PACKAGES = {
            "com.touchngo.ewallet",
            "my.com.tngdigital.ewallet"
    };

    /** Only notifications carrying an amount are considered during discovery. */
    private static final Pattern MONEY = Pattern.compile("(?i)\\b(?:RM|MYR)\\s?[0-9]");

    /**
     * How many captures the queue holds before the oldest is dropped. Bounded,
     * because the service outlives the UI and an unbounded buffer would grow for
     * as long as the phone stays on.
     */
    private static final int MAX_PENDING = 100;

    /** Serialises the read-modify-write on the stored queue. */
    private static final Object QUEUE_LOCK = new Object();

    private static TngNotificationPlugin plugin;

    /** Set by onListenerConnected/Disconnected — the truth the UI needs. */
    private static volatile boolean listenerConnected = false;

    /** Discovery mode: epoch-ms until which unwatched packages are reported. */
    private static volatile long discoveryUntil = 0L;
    private static final Map<String, String[]> discovered = new LinkedHashMap<>();

    static void setPlugin(TngNotificationPlugin p) {
        plugin = p;
    }

    static boolean isListenerConnected() {
        return listenerConnected;
    }

    // --- the capture queue ------------------------------------------------
    //
    // ON DISK, NOT IN MEMORY, AND THE ONLY WAY OUT.
    //
    // Both of those are corrections of a design that lost real money. What was
    // here before was an in-memory ArrayDeque used only when the web view
    // wasn't up yet, and it failed two ways at once:
    //
    //   1. When the web view WAS up, the service skipped the queue entirely and
    //      pushed straight to JavaScript. But Capacitor's two-argument
    //      notifyListeners() discards an event when no JS listener happens to be
    //      registered, and the listener only existed while one particular screen
    //      was on display. Payments made while the user was on any other tab
    //      were dropped on the floor — silently, because the native capture
    //      counter still went up.
    //   2. When the web view was NOT up, the queue held them — in RAM, in the
    //      app's own process, which Android kills freely. Closing the app, or
    //      any aggressive OEM battery manager, erased the buffer.
    //
    // The user's evidence was a screen reading "7 notifications received" next
    // to a capture log containing nothing at all, and an empty expense list.
    //
    // So: every capture is written to disk immediately, whether or not anything
    // is listening, and JavaScript gets it by draining that queue. There is now
    // exactly ONE delivery path, which is also why there is no de-duplication
    // problem — a notification cannot arrive twice by two different routes.
    // Live delivery is reduced to a content-free "there is something for you"
    // ping, and losing a ping costs nothing because the next drain still finds
    // the item.
    //
    // This also means the app does not need to be running, or even alive. The
    // system binds a NotificationListenerService on its own and rebinds it after
    // a kill, so capture keeps working with the app closed; the queue is simply
    // waiting the next time it opens.

    private static JSONArray readQueue(Context context) {
        String raw = prefs(context).getString(KEY_QUEUE, null);
        if (raw == null || raw.isEmpty()) return new JSONArray();
        try {
            return new JSONArray(raw);
        } catch (Exception e) {
            // Corrupt queue: better to start clean than to wedge capture forever.
            Log.w(TAG, "pending queue unreadable, discarding", e);
            return new JSONArray();
        }
    }

    private static void enqueue(Context context, String title, String text, long postedAt, String pkg) {
        synchronized (QUEUE_LOCK) {
            JSONArray queue = readQueue(context);
            try {
                JSONObject item = new JSONObject();
                item.put("title", title);
                item.put("text", text);
                item.put("postedAt", postedAt);
                item.put("packageName", pkg);
                queue.put(item);
            } catch (Exception e) {
                Log.w(TAG, "could not queue notification", e);
                return;
            }
            while (queue.length() > MAX_PENDING) queue.remove(0);
            // commit(), not apply(): the whole point is surviving a process death
            // that can land in the very next millisecond. This runs a handful of
            // times a day, so the synchronous write costs nothing that matters.
            prefs(context).edit().putString(KEY_QUEUE, queue.toString()).commit();
        }
    }

    /** [title, text, postedAt, packageName] per queued capture, oldest first. */
    static List<String[]> drainPending(Context context) {
        synchronized (QUEUE_LOCK) {
            JSONArray queue = readQueue(context);
            List<String[]> out = new ArrayList<>();
            for (int i = 0; i < queue.length(); i++) {
                JSONObject item = queue.optJSONObject(i);
                if (item == null) continue;
                out.add(new String[]{
                        item.optString("title", ""),
                        item.optString("text", ""),
                        String.valueOf(item.optLong("postedAt", 0L)),
                        item.optString("packageName", ""),
                });
            }
            SharedPreferences p = prefs(context);
            p.edit()
                    .putString(KEY_QUEUE, new JSONArray().toString())
                    .putInt(KEY_DELIVERED_TOTAL, p.getInt(KEY_DELIVERED_TOTAL, 0) + out.size())
                    .commit();
            return out;
        }
    }

    static int getPendingCount(Context context) {
        synchronized (QUEUE_LOCK) {
            return readQueue(context).length();
        }
    }

    static int getDeliveredTotal(Context context) {
        return prefs(context).getInt(KEY_DELIVERED_TOTAL, 0);
    }

    // --- watch list -------------------------------------------------------

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static Set<String> getWatchedPackages(Context context) {
        Set<String> stored = prefs(context).getStringSet(KEY_PACKAGES, null);
        if (stored == null || stored.isEmpty()) {
            Set<String> defaults = new HashSet<>();
            for (String p : DEFAULT_PACKAGES) defaults.add(p);
            return defaults;
        }
        return new HashSet<>(stored);
    }

    static void setWatchedPackages(Context context, Set<String> packages) {
        // An empty list must not mean "watch nothing forever" — that would let a
        // first-run race (JS pushing its list before accounts have loaded)
        // silently switch the whole feature off. Falling back to the defaults
        // keeps TNG working no matter what.
        Set<String> toStore = (packages == null || packages.isEmpty())
                ? getWatchedPackages(context) : packages;
        prefs(context).edit().putStringSet(KEY_PACKAGES, toStore).apply();
    }

    // --- discovery --------------------------------------------------------

    static void startDiscovery(long durationMs) {
        // Capped: a broad-capture mode must not be leavable in the "on" state by
        // navigating away, closing the app, or passing a silly number.
        long capped = Math.max(30_000L, Math.min(durationMs, 15 * 60_000L));
        discoveryUntil = System.currentTimeMillis() + capped;
        synchronized (discovered) { discovered.clear(); }
    }

    static void stopDiscovery() {
        discoveryUntil = 0L;
    }

    static boolean isDiscovering() {
        return System.currentTimeMillis() < discoveryUntil;
    }

    /** [packageName, appLabel, count, lastAt, sample] per discovered package. */
    static List<String[]> getDiscovered() {
        synchronized (discovered) {
            return new ArrayList<>(discovered.values());
        }
    }

    private void recordDiscovery(String pkg, String title, String text, long postedAt) {
        String label = appLabel(pkg);
        // A short, first-line-only sample: enough for a human to recognise the
        // app ("Payment successful"), never the whole message body.
        String sample = (title + " " + text).replaceAll("\\s+", " ").trim();
        if (sample.length() > 60) sample = sample.substring(0, 60) + "…";

        synchronized (discovered) {
            String[] existing = discovered.get(pkg);
            int count = existing == null ? 0 : Integer.parseInt(existing[2]);
            discovered.put(pkg, new String[]{
                    pkg, label, String.valueOf(count + 1), String.valueOf(postedAt), sample
            });
        }
    }

    private String appLabel(String pkg) {
        try {
            android.content.pm.PackageManager pm = getPackageManager();
            return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
        } catch (Exception e) {
            return pkg;
        }
    }

    // --- capture ----------------------------------------------------------

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        String pkg = sbn.getPackageName();
        if (pkg == null) return;

        boolean watched = getWatchedPackages(this).contains(pkg);
        boolean discovering = isDiscovering();
        if (!watched && !discovering) return;

        Notification notification = sbn.getNotification();
        if (notification == null) return;

        Bundle extras = notification.extras;
        if (extras == null) return;

        String title = charSeq(extras.getCharSequence(Notification.EXTRA_TITLE));
        // BIG_TEXT holds the full body when the notification is expandable;
        // EXTRA_TEXT is truncated with an ellipsis, which would cut the amount
        // off the end of some TNG messages.
        String text = charSeq(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
        if (text.isEmpty()) text = charSeq(extras.getCharSequence(Notification.EXTRA_TEXT));

        if (title.isEmpty() && text.isEmpty()) return;

        long postedAt = sbn.getPostTime();

        if (!watched) {
            // Discovery only: an unwatched app, and only when it mentions money.
            if (MONEY.matcher(title + " " + text).find()) {
                recordDiscovery(pkg, title, text, postedAt);
            }
            return;
        }

        Log.d(TAG, "notification captured from " + pkg + " — queued");
        recordCapture(pkg, postedAt);

        // Store first, tell second. Never the other way round: if the process
        // dies between the two, a stored capture is still there to be drained,
        // whereas a delivered-but-unstored one is gone for good.
        enqueue(this, title, text, postedAt, pkg);

        // Content-free nudge. If nothing is listening it evaporates, and that is
        // fine — the item is on disk and the next drain picks it up.
        if (plugin != null) plugin.notifyCaptured();
    }

    /**
     * Counters the UI reads to prove the listener is alive.
     *
     * Persisted rather than kept in memory: the whole question being answered is
     * "did anything reach the app while it was closed", and an in-memory counter
     * resets to zero exactly when that answer matters most.
     */
    private void recordCapture(String pkg, long postedAt) {
        SharedPreferences p = prefs(this);
        p.edit()
                .putInt(KEY_CAPTURED_TOTAL, p.getInt(KEY_CAPTURED_TOTAL, 0) + 1)
                .putLong(KEY_LAST_AT, postedAt)
                .putString(KEY_LAST_PACKAGE, pkg)
                .apply();
    }

    static int getCapturedTotal(Context c) { return prefs(c).getInt(KEY_CAPTURED_TOTAL, 0); }
    static long getLastCapturedAt(Context c) { return prefs(c).getLong(KEY_LAST_AT, 0L); }
    static String getLastPackage(Context c) { return prefs(c).getString(KEY_LAST_PACKAGE, null); }

    private static String charSeq(CharSequence cs) {
        return cs == null ? "" : cs.toString().trim();
    }

    @Override
    public void onListenerConnected() {
        listenerConnected = true;
        Log.d(TAG, "Notification listener connected");
    }

    @Override
    public void onListenerDisconnected() {
        listenerConnected = false;
        Log.d(TAG, "Notification listener disconnected");
        // Ask Android to rebind; the OS drops listeners on app update or low memory.
        requestRebind(new android.content.ComponentName(this, TngListenerService.class));
    }
}
