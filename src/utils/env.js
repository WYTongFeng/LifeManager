// Vite's build-time env vars, readable outside Vite too.
//
// `import.meta.env` exists only because Vite puts it there: the build
// substitutes the whole object into the bundle, and the dev server assigns it
// onto `import.meta` in every module that mentions it. Under plain Node —
// which is how `npm test` runs everything in `scripts/` — nothing substitutes
// anything and `import.meta.env` is simply `undefined`.
//
// That is fatal rather than merely awkward, because these reads happen at
// MODULE SCOPE. `test-foodestimate.mjs` imported foodEstimate.js, which imported
// the old gemini.js, which read a key straight off `import.meta.env` on the way
// up; the TypeError landed during import, before a single assertion ran, and
// killed the process. package.json's `test` script is one long `&&` chain, so
// that took the last two suites down with it — they passed fine when run on
// their own, which is exactly why it went unnoticed. (gemini.js is gone now, but
// the rule below is what keeps the next module from repeating it.)
//
// Reading through here costs nothing in the browser. Vite replaces the bare
// `import.meta.env` below with the same fully-serialized object of VITE_*
// values it would otherwise have inlined at each individual call site, so the
// built app and the dev server see identical values to before. Node just gets
// an empty object and every caller falls through to its offline default.
//
// New rule for anything under src/: read env vars from here, never from
// `import.meta.env` directly, or the suite breaks again the same way.

export const ENV = import.meta.env || {};
