import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { writeVersionManifest } from './scripts/manifest.mjs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const BUILD_AT = new Date().toISOString()

/**
 * Writes `dist/version.json` — the manifest the running app fetches to find out
 * whether it's out of date (see src/utils/updates.js).
 *
 * Generated rather than hand-kept so the released version can never disagree
 * with the version compiled into the bundle.
 *
 * It writes the COMPLETE manifest — release notes and the APK block included —
 * rather than a placeholder for `scripts/release.mjs` to fill in later. That
 * placeholder was deployable, and it got deployed: an `apk: null` manifest
 * tells every installed APK there's a new version and gives it nothing to
 * download. See scripts/manifest.mjs for the full account.
 */
function versionManifest() {
  return {
    name: 'version-manifest',
    apply: 'build',
    closeBundle() {
      // Resolved from this config file rather than `process.cwd()`: the output
      // must land next to the project regardless of which directory the build
      // was launched from, and `process` isn't a declared global here (it was
      // the one lint ERROR in the repo).
      writeVersionManifest({
        root: fileURLToPath(new URL('.', import.meta.url)),
        dist: fileURLToPath(new URL('./dist', import.meta.url)),
        version: pkg.version,
        buildAt: BUILD_AT,
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Compiled into the bundle so the app knows its own version without a fetch.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_AT__: JSON.stringify(BUILD_AT),
  },
  // Relative asset paths, so the built app works from any sub-path — a project
  // page on GitHub Pages, a preview URL, or opened straight off the filesystem.
  base: './',
  plugins: [
    react(),
    versionManifest(),
    VitePWA({
      // 'prompt', not 'autoUpdate': autoUpdate reloads the page the moment a
      // new service worker takes over, which on a phone means the app can blank
      // and restart mid-sentence while you're typing an expense. The new build
      // is still fetched in the background exactly the same way — the only
      // difference is that WE choose the moment to swap it in, on a tap.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'LifeManager',
        short_name: 'LifeManager',
        description: '饮食、健身与 Touch \'n Go 开销记录',
        lang: 'zh-CN',
        theme_color: '#0c0c0e',
        background_color: '#0c0c0e',
        display: 'standalone',
        orientation: 'portrait',
        // Relative, so the installed app resolves correctly wherever it's hosted.
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          // Android crops icons to its own shape; the maskable variant keeps
          // "LM" inside the safe zone so it survives a circle mask.
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app is a handful of small files, so everything is precached —
        // once installed it opens with no network at all, which matters on a
        // phone with patchy signal.
        // Note the absence of `json`: `version.json` must NEVER be precached.
        // A cached manifest reports the version that shipped with the build
        // that cached it, so the app would permanently believe it's current —
        // a failure in the silent direction, which is the worst kind here.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Google Fonts are the one external request. Cached on first use so a
        // second, offline launch still renders in the right typeface instead
        // of falling back to a system font.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
