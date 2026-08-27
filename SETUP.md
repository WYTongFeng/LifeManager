# Setup — the bits that need you

Three things need an account or a tool I can't create for you. Each is independent; the app works
without any of them.

| | What it gives you | Needed? |
|---|---|---|
| [1. Deploy](#1-deploy-the-web-app) | Opening the app on your phone at all | Yes, if you want it on the phone |
| [2. Firebase](#2-firebase-sync) | Phone ↔ PC auto-sync | Optional — export/import works without it |
| [3. Android APK](#3-android-apk--tng-auto-detect) | **Real TNG auto-detect** | Only for auto-detect |

Until then: 备份 → 汇出 on one device, 汇入 on the other. That is a complete, working manual sync.

---

## 1. Deploy the web app

**Any static host works** — `npm run build` produces a self-contained `dist` folder (`base: './'`
means no build config needed) you can upload to Cloudflare Pages, Netlify, GitHub Pages, or anywhere
else.

**This deployment specifically uses Firebase Hosting**, because the same project already provides
Firestore sync (§2) and hosts the auto-update manifest the app checks on its own (`src/utils/updates.js`,
M44). Shipping an update to *this* deployment:

```bash
# 1. bump "version" in package.json, add notes to RELEASE_NOTES.json
npm run release              # web build + APK, writes dist/version.json
firebase deploy --only hosting
```

**Bumping the version is not optional when an APK is involved.** `versionCode` is derived from the
semver (`android/app/build.gradle`), and Android refuses to install an APK whose `versionCode` isn't
greater than the installed one — a rebuilt "same version" is simply rejected on the phone.

**Don't deploy while `npm run release` is still running.** It builds the web bundle first and the APK
second (~60s of Gradle in between), and `dist/` is uploadable during that gap. Publishing then would
have shipped a manifest with no APK in it — installed phones announce an update and have nothing to
download. `firebase deploy` now runs `scripts/check-release.mjs` first (firebase.json's `predeploy`
hook) and refuses to publish in that state, but waiting for the script to print *"ready to publish"*
is still the point at which it's safe.

> **The project must be on Firebase's Blaze (pay-as-you-go) plan, not the free Spark plan.**
> Spark refuses to serve `.apk` files at all — `firebase deploy --only hosting` fails outright with
> `HTTP Error: 400, Executable files are forbidden on the Spark billing plan` the moment the deploy
> tries to upload one, even though every other file in the release succeeds. This is a hard Firebase
> platform restriction, not a bug in this app or its release script — see
> [Firebase Hosting FAQ: executable file restrictions](https://firebase.google.com/docs/hosting/faq-and-troubleshooting).
> Blaze's free-tier quotas (10 GB stored / 360 MB transferred per day) are unaffected — a single-user
> app checking for and occasionally downloading a ~5 MB APK will not generate a charge. Confirmed live
> on 2026-08-19: fails on Spark, succeeds on Blaze once the upgrade has actually propagated (it did
> not take effect instantly — the first deploy attempt right after upgrading still failed with the
> same Spark-plan error; a retry a short while later succeeded).
>
> Don't try to work around this by moving the APK to Cloud Storage instead — **the same restriction
> applies there too**, for Spark projects. Blaze removes it from both.

Once deployed: on the phone, open the URL → browser menu → **Add to Home Screen**. It installs as a
real app: own icon, no browser chrome, works offline. The already-installed app (web or APK) will
pick up the new version on its own within a few hours, or immediately via 备份 → 检查更新.

> The URL is public. Your *data* isn't (it lives in your browser's localStorage), but anyone with
> the link can open the app itself.

---

## 2. Firebase sync

Free tier, no credit card. Roughly 15 minutes.

1. **Create the project** — [console.firebase.google.com](https://console.firebase.google.com) →
   Add project. Google Analytics is not needed.
2. **Enable sign-in** — Authentication → Get started → **Google** → Enable → Save.
3. **Create the database** — Firestore Database → Create database → **Production mode**
   (not test mode — test mode is world-readable for 30 days).
4. **Register a web app** — Project settings (gear) → Your apps → Web (`</>`) → register.
   Copy the `firebaseConfig` values.
5. **Fill in `.env.local`** (already created for you, currently empty):

   ```
   VITE_FIREBASE_API_KEY=AIza...
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project
   VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
   VITE_FIREBASE_APP_ID=1:123456789012:web:abc123
   ```

6. **⚠️ Deploy the security rules — do this before signing in.** Copy [`firestore.rules`](firestore.rules)
   into Firebase Console → Firestore Database → **Rules** → Publish.

   The config above is **not secret** — Firebase web config is designed to ship in the client and
   anyone can read it from your deployed JS. The rules are the only thing that stops a stranger
   reading your accounts and debts. Without them, production mode denies everything (safe but
   broken); with test mode instead, your financial data is world-readable.

7. **Authorised domains** — Authentication → Settings → Authorised domains → add your deployed
   domain, or sign-in will be rejected.

8. `npm run build` again so the values are baked in, and redeploy.

Then: 备份 → 云端同步 → sign in with the **same email and password** on both devices. (Google sign-in
is desktop-only — Google refuses its consent screen inside the Android WebView, so the APK can only
use email/password. Both land on the same uid either way, which is what the data hangs off.)

**Uploads are automatic; downloads are not.** Every change is pushed a couple of seconds after you
make it, but nothing arrives from the other device until you press 载入云端 on this one. 立即上传 only
ever sends data away from the device you press it on — it can never be what brings the other
device's data here. Both buttons are always on screen, with the direction written under each.

**How conflicts behave.** Per record, last write wins, compared on when each side was last edited —
so two devices editing *different* records both survive, because the merge happens record by record
rather than by replacing everything. Remote changes are never applied without you asking. Settings
and accounts are whole values rather than records, so they can't merge that way: a pull leaves them
alone if this device has edits it hasn't uploaded yet. Editing both devices offline at the same time
is still the one case that can lose an edit, which is why the export file stays the real safety net.

**When the two devices disagree and you don't want to work out why:** 全部重新同步. It uploads
everything this device has, then reads the whole cloud back. Safe to press at any time — both
directions merge, neither throws a copy away.

---

## 3. Android APK — TNG auto-detect

**This is the only way TNG auto-detect can ever work.** A web page cannot read notifications;
Android only hands them to a bound `NotificationListenerService`. That service is in
`android/app/src/main/java/com/lifemanager/app/`.

### What is and isn't verified

Verified:
- `TngListenerService` **compiles clean against the real `android.jar`** (API 36). Every Android
  API it uses resolves — `NotificationListenerService`, `StatusBarNotification`,
  `Notification.EXTRA_BIG_TEXT`, `requestRebind`, `ComponentName`.
- Every Capacitor API used was checked against the actual signatures in
  `node_modules/@capacitor/android/.../com/getcapacitor/`: `Plugin.load()`,
  `handleOnDestroy()`, `getContext()`, the protected `notifyListeners(String, JSObject)`,
  `PluginCall.resolve(JSObject)`, the `JSObject.put` overloads, and
  `BridgeActivity.registerPlugin(Class<? extends Plugin>)`.
- `AndroidManifest.xml` parses and registers the service with the right permission.

Not verified:
- **A full Gradle build has never run here** — the Gradle daemon needs a loopback socket that this
  environment blocks. So the APK has not been produced and has never run on a device.
- Anything that only shows up at runtime: whether TNG's notifications match the expected package
  names on your phone, and whether the listener rebinds reliably after an app update.

So: it should compile, but treat the first build as a real test rather than a formality.

### Build it

Android Studio **2025.2.1 is already installed** at `C:\AndroidStudio`, with the SDK at `C:\android`
(platforms 34 + 36, build-tools 35.0.0 + 36.1.0) and a bundled **JDK 21** — exactly what the Android
Gradle Plugin wants. `android/local.properties` already points Gradle at it.

```bash
npm run build && npx cap sync android && npx cap open android
```

Then in Android Studio: let Gradle sync, plug in the phone with USB debugging on, and hit Run.
Build → Build APK(s) if you'd rather sideload the file.

> **The first sync should be quick.** Everything this project needs is already on the machine:
> AGP 8.13.0 is in the Gradle cache (~2.1 GB of prior Android builds), Gradle 8.14.3 is downloaded,
> and `compileSdk 36` matches the installed `platforms/android-36`. `minSdk` is 24.

### Turn it on, on the phone

After installing, open Money → **TNG 自动侦测** → 去开启. That opens
Settings → Notifications → Notification access. Switch on LifeManager.

Android does not let an app grant itself this permission — you must flip the switch. There's no way
around it, and any app claiming otherwise is lying.

### What it does

- Reads **only** `com.touchngo.ewallet` / `my.com.tngdigital.ewallet`. Every other app's
  notifications are ignored before anything is read.
- Forwards raw text to the same `parseTngNotification()` the paste box uses — one set of rules.
- **Auto-logs only unambiguous payments** to a recognised merchant.
- Anything needing a decision (transfer to a person, unknown shop) goes to **待确认** instead of
  being guessed at.
- Promos and reloads are dropped silently.
- Notifications arriving while the app is closed are buffered (max 50) and delivered on next open.

If a real notification lands in the wrong bucket, paste it into the reader to see the verdict, then
add a line to `src/utils/tngParser.js`. That is the whole maintenance story — no retraining, no API.
