import React, { useEffect, useState, useCallback } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Download, RefreshCw, X, Check } from '../utils/icons';
import { isNativePlatform } from '../utils/platform';
import {
  CURRENT_VERSION, BUILD_AT, checkForUpdate, dismissVersion, formatSize,
  MANIFEST_URL, UPDATE_EVENT,
} from '../utils/updates';

/**
 * "Is there a new version?" — surfaced automatically, on both platforms.
 *
 * TWO DIFFERENT UPDATE MECHANISMS, ONE BANNER
 * The web build and the APK genuinely update by different means, and pretending
 * otherwise produces a button that does nothing on one of them:
 *
 *   Web / PWA   The service worker downloads the new build in the background on
 *               its own. By the time `needRefresh` flips, the new version is
 *               already ON the device — all that's left is swapping it in, which
 *               `updateServiceWorker()` does with one tap. This really is
 *               automatic.
 *
 *   Android APK Sideloaded, so nothing updates it by itself. The app polls a
 *               hosted manifest, and offers a download. Android's package
 *               installer then asks its own question, which no app can skip —
 *               so the honest promise is "you'll be told, and it's one tap",
 *               not "it updates silently".
 *
 * The service-worker path is deliberately ignored inside the APK: Capacitor
 * serves the bundle from local files, so there is no newer copy for a service
 * worker to fetch, and a "重新载入" button there would do nothing at all.
 */
export default function UpdateBanner() {
  // Deliberately the general platform check, not tngNative's TNG-plugin-scoped
  // one — this decides "web reload button" vs "APK download button", which has
  // nothing to do with whether the notification listener plugin is compiled
  // in. See platform.js's header for the real bug that came from getting this
  // wrong: a genuine Android install correctly detected as native but with
  // TngNotification unavailable would have shown a useless reload button
  // instead of the actual download link.
  const native = isNativePlatform();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // The browser only re-checks a service worker on navigation, which a
      // single-page app installed to the home screen may not do for days.
      // An hourly poll is what makes "automatic" actually mean automatic.
      if (!registration) return;
      setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
    },
  });

  const runCheck = useCallback(async (force = false) => {
    const result = await checkForUpdate({ force });
    setInfo(result);
    return result;
  }, []);

  useEffect(() => {
    // On launch, and again whenever the app comes back to the foreground —
    // which on a phone is the moment that actually matters, since the app is
    // rarely "launched" so much as resumed.
    runCheck();
    const onVisible = () => { if (!document.hidden) runCheck(); };
    // A manual check from the backup sheet has to update this banner too, or
    // the app contradicts itself: "已经是最新版本" in the panel, "有新版本"
    // still sitting above it.
    const onUpdateState = (e) => setInfo(e.detail);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(UPDATE_EVENT, onUpdateState);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(UPDATE_EVENT, onUpdateState);
    };
  }, [runCheck]);

  // Web: the service worker has a new build staged and ready.
  const swReady = !native && needRefresh;
  // Either platform: the hosted manifest names a version newer than this one.
  const manifestNewer = Boolean(info?.available);

  if (!swReady && !manifestNewer) return null;

  const latest = info?.latest;
  const manifest = info?.manifest;
  const apkUrl = manifest?.apkUrl;
  const size = formatSize(manifest?.apkSize);

  const applyWebUpdate = async () => {
    setBusy(true);
    try {
      await updateServiceWorker();
    } catch {
      // updateServiceWorker normally reloads the page itself. If it didn't,
      // a hard reload gets the new build the SW already has on disk.
      window.location.reload();
    }
  };

  const dismiss = () => {
    // dismissVersion announces the new state, which this component's own
    // listener picks up — so `info` is not set here as well.
    dismissVersion(latest);
    setNeedRefresh(false);
  };

  return (
    <div style={{
      background: 'var(--color-money-soft)',
      borderBottom: '1px solid var(--color-money)',
      padding: '0.7rem 1rem',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
    }}>
      <div style={{
        width: '30px', height: '30px', flexShrink: 0, borderRadius: 'var(--radius-sm)',
        background: 'var(--color-money)', color: 'var(--color-money-ink)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Download size={16} />
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--color-money)' }}>
          {swReady ? '新版本已经下载好了' : `有新版本${latest ? ` v${latest}` : ''}`}
        </div>
        <div style={{ fontSize: '0.66rem', color: 'var(--text-secondary)', marginTop: '1px' }}>
          {swReady
            ? '点一下重开就套用 — 你的资料不会动'
            : native
              ? `下载后 Android 会问你要不要安装${size ? ` · ${size}` : ''}`
              : '重新载入就会拿到新版本'}
        </div>
        {manifest?.notes?.length > 0 && (
          <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginTop: '3px', lineHeight: 1.4 }}>
            {manifest.notes.slice(0, 2).join(' · ')}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        {swReady ? (
          <button onClick={applyWebUpdate} disabled={busy} className="btn-primary"
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.74rem', opacity: busy ? 0.6 : 1 }}>
            <RefreshCw size={13} /> {busy ? '更新中…' : '立刻更新'}
          </button>
        ) : native ? (apkUrl && (
          // A real anchor, not a scripted window.open: Capacitor's WebViewClient
          // hands an external link straight to the system browser, which is what
          // actually starts the download. A JS-driven open is one more thing that
          // can be blocked inside a WebView.
          //
          // No fallback button here on purpose. There used to be one — 重新载入 —
          // and inside Capacitor it does nothing whatsoever: the bundle is
          // local, there is no newer copy to re-fetch. When a release went out
          // with `apk: null` in its manifest, that dead button was the ONLY
          // thing the phone offered. `evaluate()` now refuses to call such a
          // release an update at all, so reaching this branch without an
          // `apkUrl` shouldn't be possible; if it somehow is, showing nothing
          // beats showing a button that lies.
          <a
            href={apkUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-primary"
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.74rem', textDecoration: 'none' }}
          >
            <Download size={13} /> 下载
          </a>
        )) : (
          <button onClick={() => window.location.reload()} className="btn-primary"
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.74rem' }}>
            <RefreshCw size={13} /> 重新载入
          </button>
        )}

        <button onClick={dismiss} aria-label="以后再说"
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

/**
 * The manual counterpart, for the backup/settings sheet: what version is
 * running, and a button to check right now.
 *
 * Exists because the automatic check is throttled to once every six hours, and
 * "I just released something, is my phone on it?" is a question you want
 * answered in the next five seconds, not the next six hours.
 */
export function UpdateStatus() {
  const [state, setState] = useState({ checking: false, result: null });
  const native = isNativePlatform();

  const check = async () => {
    setState({ checking: true, result: null });
    setState({ checking: false, result: await checkForUpdate({ force: true }) });
  };

  const r = state.result;
  const built = BUILD_AT ? new Date(BUILD_AT).toLocaleDateString() : null;
  // Present on every outcome that carried a manifest — including 'up-to-date'
  // and 'no-apk' — so the link doesn't blink out of existence exactly when
  // someone goes looking for it.
  const downloadUrl = r?.manifest?.apkUrl ?? null;
  const downloadSize = formatSize(r?.manifest?.apkSize);

  return (
    <div style={{
      padding: '0.75rem 0.85rem', borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.8rem', fontWeight: '700' }}>
            版本 v{CURRENT_VERSION}
            <span style={{ fontSize: '0.62rem', fontWeight: '500', color: 'var(--text-muted)', marginLeft: '6px' }}>
              {native ? 'Android APK' : '网页版'}
            </span>
          </div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            {built ? `构建于 ${built}` : '开发版本'}
          </div>
        </div>
        <button onClick={check} disabled={state.checking} className="btn-secondary"
          style={{ padding: '5px 11px', fontSize: '0.7rem', flexShrink: 0, opacity: state.checking ? 0.6 : 1 }}>
          <RefreshCw size={12} /> {state.checking ? '检查中…' : '检查更新'}
        </button>
      </div>

      {r && (
        <div style={{
          fontSize: '0.68rem', marginTop: '8px', lineHeight: 1.5,
          color: r.available ? 'var(--color-money)'
            : r.reason === 'error' ? 'var(--color-diet)'
            : 'var(--text-muted)',
          display: 'flex', gap: '5px', alignItems: 'flex-start',
        }}>
          {r.available ? <Download size={12} style={{ flexShrink: 0, marginTop: '2px' }} />
            : r.reason === 'up-to-date' ? <Check size={12} style={{ flexShrink: 0, marginTop: '2px' }} />
            : null}
          <span>
            {r.available ? `有新版本 v${r.latest} — 上面会跳出更新提示`
              : r.reason === 'up-to-date' ? '已经是最新版本'
              : r.reason === 'no-apk' ? `有新版本 v${r.latest}，但这次发布没有附 Android 安装包 — 等下一次发布，或跟发布的人要 APK`
              : r.reason === 'dismissed' ? `v${r.latest} 你选了以后再说 — 重开 app 会再问一次`
              : r.reason === 'error'
                ? `连不上更新伺服器（${r.error}）。没网络，或者新版还没发布 — 这不影响 app 本身。`
                : '暂时查不到更新资讯。'}
          </span>
        </div>
      )}

      {/* A download link that is ALWAYS here once a check has run — including
          when the app is already up to date. The only way to get the APK used
          to be a banner that appears on its own terms and hides itself again,
          so "just let me download it and install it myself" was not something
          the app allowed. It also covers re-installing the current version,
          which is the only self-service way back from a bad install. */}
      {native && downloadUrl && (
        <a
          href={downloadUrl}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary"
          style={{
            marginTop: '8px', width: '100%', padding: '0.45rem',
            fontSize: '0.72rem', textDecoration: 'none',
          }}
        >
          <Download size={13} />
          {r?.available ? `下载 v${r.latest} 安装包` : `下载安装包 v${r?.latest ?? CURRENT_VERSION}`}
          {downloadSize ? ` · ${downloadSize}` : ''}
        </a>
      )}

      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '8px', lineHeight: 1.5, wordBreak: 'break-all' }}>
        {native
          ? 'APK 不是从 Play Store 装的，所以 Android 不允许它自己悄悄换掉自己 — 只能帮你查到、帮你下载，最后那下安装要你自己按。'
          : '网页版会自己在背景下载新版本，装好了才提示你重开。'}
        <br />
        更新来源：{MANIFEST_URL}
      </div>
    </div>
  );
}
