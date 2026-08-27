// "Is this the real Android app at all" — deliberately its own file.
//
// THE BUG THIS EXISTS TO PREVENT FROM HAPPENING AGAIN
// `tngNative.js`'s `isNativeAvailable()` sounds general but isn't: it checks
// `cap?.isNativePlatform?.() && cap?.Plugins?.TngNotification` — Android AND
// the TNG notification plugin specifically. That's the right question for
// TngAutoCapture (should it try to talk to the notification listener?), and
// the wrong one for anything else, because it can be legitimately false on a
// genuine Android install — see `isStaleApk()` in that file, which documents
// exactly the case of "running the Android shell but the plugin isn't there".
//
// UpdateBanner.jsx imported it anyway to decide "web reload button" vs.
// "download the APK" button, and on a real phone that answered a completely
// different question than the one being asked: it showed 重新载入 (reload —
// meaningless in a Capacitor WebView loading local bundled files, there's
// nothing to fetch) instead of 下载 (download the APK). The fix isn't a
// one-line change at the call site; it's making sure this question has its
// own name so nothing reaches for the TNG-specific check by habit again.
export function isNativePlatform() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
  return Boolean(cap?.isNativePlatform?.());
}
