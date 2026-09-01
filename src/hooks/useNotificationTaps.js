import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isNativePlatform } from '../utils/platform.js';

/**
 * Tapping a notification opens the thing it is about.
 *
 * THE GAP THIS CLOSES
 * Every alarm this app has ever scheduled carried an `extra` payload naming the
 * record behind it — and nothing anywhere read it. The comment in notify.js
 * said so out loud ("Nothing consumes it yet"). So a 20:00 「交文件」 notification
 * opened the app on whatever screen it happened to be left on, which on a phone
 * is usually the last thing you were doing and never the reminder. The user had
 * to find it themselves, which for a one-line reminder is most of the work.
 *
 * WHY THE ROUTE IS CARRIED RATHER THAN DERIVED
 * The handler could switch on `source` and build a path. It would then be a
 * second place that has to agree with the SOURCES registry about where each
 * module lives, and the two would drift the first time a route was renamed —
 * silently, because a wrong deep link looks like a working one until you tap it.
 * The route is decided once, in notifications.js, and travels with the alarm.
 *
 * WHY IT TOLERATES A ROUTE IT DOESN'T RECOGNISE
 * The alarm sitting in the OS was scheduled by whatever version of the app was
 * installed when it was scheduled — which, after an APK upgrade, is not this
 * one. A route that has since been renamed would otherwise navigate into a
 * blank screen. Anything unfamiliar falls back to the notification centre,
 * which can always say something useful about why the phone just buzzed.
 */
export function useNotificationTaps() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNativePlatform()) return undefined;

    let handle = null;
    let cancelled = false;

    // Dynamically imported for the same reason notify.js does it: the web build
    // must never pull the plugin into the main chunk, and the web implementation
    // throws on several of these calls.
    import('@capacitor/local-notifications')
      .then(({ LocalNotifications }) => {
        if (!LocalNotifications || cancelled) return;
        return LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
          const route = event?.notification?.extra?.route;
          navigate(isSafeRoute(route) ? route : '/alerts');
        });
      })
      .then((listener) => {
        if (cancelled) listener?.remove?.();
        else handle = listener ?? null;
      })
      .catch(e => console.warn('notification tap listener unavailable', e));

    return () => {
      cancelled = true;
      handle?.remove?.();
    };
  }, [navigate]);
}

/**
 * An in-app path and nothing else.
 *
 * The payload comes back through the OS, which is not a boundary worth
 * trusting blindly: it survived an app upgrade, a reboot and a restore. A
 * leading single slash keeps this to a HashRouter path — `//host` would be a
 * protocol-relative URL and `javascript:` speaks for itself.
 */
function isSafeRoute(route) {
  return typeof route === 'string'
    && route.startsWith('/')
    && !route.startsWith('//');
}
