package com.lifemanager.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Bridges the native notification listener to JavaScript.
 *
 * Deliberately thin: it forwards raw notification text and reports permission
 * state. All parsing and classification lives in src/utils/tngParser.js, so the
 * rules stay in one place and remain testable without an Android device.
 */
@CapacitorPlugin(name = "TngNotification")
public class TngNotificationPlugin extends Plugin {

    @Override
    public void load() {
        TngListenerService.setPlugin(this);
    }

    @Override
    protected void handleOnDestroy() {
        TngListenerService.setPlugin(null);
    }

    /**
     * Tells JS that the queue has something in it. Carries no content.
     *
     * This used to hand the notification itself to JS, which is how payments
     * went missing: the two-argument notifyListeners() throws the event away
     * when no JS listener is registered at that instant, and the listener lived
     * on a single screen. Content now travels only through drainPending(),
     * reading a queue on disk, so a lost ping costs nothing.
     *
     * retainUntilConsumed is set because a ping fired microseconds before the
     * web view attaches its listener would otherwise be the one that never
     * arrives, leaving a real payment sitting in the queue until the next one
     * happened to nudge it loose.
     */
    void notifyCaptured() {
        notifyListeners("tngCaptured", new JSObject(), true);
    }

    /**
     * Whether the user has granted notification access. Android exposes this
     * only as a flat colon-separated string of enabled listener components.
     */
    @PluginMethod
    public void isPermissionGranted(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasNotificationAccess());
        call.resolve(result);
    }

    private boolean hasNotificationAccess() {
        Context context = getContext();
        String enabled = Settings.Secure.getString(
                context.getContentResolver(), "enabled_notification_listeners");

        if (enabled == null || enabled.isEmpty()) return false;
        ComponentName me = new ComponentName(context, TngListenerService.class);
        for (String entry : enabled.split(":")) {
            ComponentName parsed = ComponentName.unflattenFromString(entry);
            if (parsed != null && parsed.equals(me)) return true;
        }
        return false;
    }

    /**
     * Opens the system notification-access screen.
     *
     * There is no programmatic way to grant this — Android requires the user to
     * flip the switch themselves, by design. The app can only take them there.
     */
    @PluginMethod
    public void openPermissionSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /**
     * Everything the UI needs to say whether this is ACTUALLY working, not just
     * switched on.
     *
     * "Permission granted" and "notifications are arriving" are different facts,
     * and Android routinely lets them come apart — it drops a listener binding
     * on app update or under memory pressure while leaving the permission switch
     * on. Without `listenerConnected` and `lastCapturedAt`, a silently dead
     * listener is indistinguishable from a quiet week, which is exactly the
     * state that makes the feature look broken.
     */
    @PluginMethod
    public void getStatus(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("granted", hasNotificationAccess());
        result.put("listenerConnected", TngListenerService.isListenerConnected());
        result.put("capturedTotal", TngListenerService.getCapturedTotal(context));
        result.put("lastCapturedAt", TngListenerService.getLastCapturedAt(context));
        result.put("lastPackage", TngListenerService.getLastPackage(context));
        result.put("discovering", TngListenerService.isDiscovering());

        // The three numbers that make a loss provable rather than suspected.
        // capturedTotal counts what the phone handed us; deliveredTotal counts
        // what JavaScript actually took; pendingCount is what is waiting right
        // now. captured - delivered - pending should be zero, and any other
        // answer means captures went missing between the two halves of the app
        // — which is precisely the failure that ran undetected before, because
        // only the first number was ever shown.
        result.put("deliveredTotal", TngListenerService.getDeliveredTotal(context));
        result.put("pendingCount", TngListenerService.getPendingCount(context));

        JSONArray watched = new JSONArray();
        for (String p : TngListenerService.getWatchedPackages(context)) watched.put(p);
        result.put("watched", watched);

        call.resolve(result);
    }

    /** Replace the set of app packages the listener reads. */
    @PluginMethod
    public void setWatchedPackages(PluginCall call) {
        JSArray incoming = call.getArray("packages");
        Set<String> packages = new HashSet<>();
        if (incoming != null) {
            try {
                for (Object o : incoming.toList()) {
                    if (o != null && !o.toString().trim().isEmpty()) packages.add(o.toString().trim());
                }
            } catch (Exception e) {
                call.reject("Bad packages array", e);
                return;
            }
        }
        TngListenerService.setWatchedPackages(getContext(), packages);
        call.resolve();
    }

    /**
     * Temporarily report which app any money-mentioning notification came from.
     *
     * The alternative was hardcoding a package name per Malaysian bank, which is
     * guesswork — and a wrong guess yields an app that claims to be watching an
     * account while watching nothing at all. This asks the phone instead.
     */
    @PluginMethod
    public void startDiscovery(PluginCall call) {
        long durationMs = call.getLong("durationMs", 5L * 60L * 1000L);
        TngListenerService.startDiscovery(durationMs);
        call.resolve();
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        TngListenerService.stopDiscovery();
        call.resolve();
    }

    @PluginMethod
    public void getDiscovered(PluginCall call) {
        JSONArray out = new JSONArray();
        for (String[] item : TngListenerService.getDiscovered()) {
            JSObject o = new JSObject();
            o.put("packageName", item[0]);
            o.put("appLabel", item[1]);
            o.put("count", Integer.parseInt(item[2]));
            o.put("lastAt", Long.parseLong(item[3]));
            o.put("sample", item[4]);
            out.put(o);
        }
        JSObject result = new JSObject();
        result.put("packages", out);
        result.put("discovering", TngListenerService.isDiscovering());
        call.resolve(result);
    }

    /**
     * Hands over every captured notification and empties the queue.
     *
     * This is now the ONLY way notification content reaches JavaScript — not a
     * catch-up path for things missed while the app was closed, which is all it
     * used to be. Everything arrives this way, whether the app was running at
     * the time or not, so there is one path to get right instead of two that
     * could each lose a payment on their own.
     */
    @PluginMethod
    public void drainPending(PluginCall call) {
        List<String[]> items = TngListenerService.drainPending(getContext());
        JSONArray out = new JSONArray();
        for (String[] item : items) {
            JSObject o = new JSObject();
            o.put("title", item[0]);
            o.put("text", item[1]);
            o.put("postedAt", Long.parseLong(item[2]));
            o.put("packageName", item.length > 3 ? item[3] : null);
            o.put("raw", (item[0] + "\n" + item[1]).trim());
            out.put(o);
        }
        JSObject result = new JSObject();
        result.put("notifications", out);
        call.resolve(result);
    }
}
