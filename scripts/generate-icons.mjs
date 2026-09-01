// Rasterises every icon the app needs from ONE SVG.
//
//   npm run icons
//
// WHY THIS EXISTS
// Android needs real PNGs to offer "install to home screen" reliably, and the
// launcher needs them at five densities in three variants. Checking fifteen
// binaries into the repo makes them impossible to review or update — you can
// see that a PNG changed, never what changed. `public/icon.svg` is the single
// source of truth and everything below is derived from it.
//
// WHY THE VARIANTS ARE COMPOSED HERE RATHER THAN BEING THEIR OWN FILES
// There used to be a hand-maintained `icon-maskable.svg` holding a second copy
// of the artwork. Two copies of a drawing drift: editing one and forgetting the
// other gives you an app whose home-screen icon and launcher icon are subtly
// different, and nothing fails — you just have two icons. So the art is
// extracted from `icon.svg` once and re-wrapped three ways:
//
//   web        the file as-authored, rounded corners and all
//   maskable   full-bleed background, art scaled into the 80% safe zone
//              (Android applies its own mask and will crop the corners off)
//   foreground the adaptive-icon layer: transparent, art scaled into the 66%
//              safe zone, drawn over @color/ic_launcher_background
//
// THE SAFE-ZONE SCALES ARE NOT DECORATIVE. An adaptive icon's 108dp canvas
// guarantees only the middle 72dp is visible — the rest is what the launcher
// eats when it crops to a circle, a squircle, or a teardrop. Art drawn to the
// edge loses its wallet and its dumbbell on exactly the devices that crop most.
//
// Fonts: sharp rasterises SVG through librsvg, which uses the system's fonts,
// not the web fonts the app loads at runtime. Keep the artwork to shapes.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const resDir = join(root, 'android/app/src/main/res');

/** The plate colour behind the art. Must match the `<rect>` in icon.svg and
 *  `@color/ic_launcher_background`, or the launcher shows a ring of the wrong
 *  colour where the adaptive background peeks out from under the foreground. */
const BACKGROUND = '#FAFAF7';

const source = await readFile(join(publicDir, 'icon.svg'), 'utf8');

/**
 * The artwork, without its background plate.
 *
 * Keyed on `<g id="art">` rather than "everything after the rect" so that
 * adding a second background element to icon.svg can't silently start pulling
 * a background into the transparent foreground layer.
 */
const art = source.match(/<g id="art">([\s\S]*)<\/g>\s*<\/svg>/)?.[1];
if (!art) {
  throw new Error('public/icon.svg has no <g id="art"> block — the variants are cut from it');
}

/** Wrap the art at a given scale about the centre, over an optional plate. */
function compose({ scale = 1, background = null, clip = null } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
${clip ?? ''}
${background ? `<rect width="512" height="512" fill="${background}"${clip ? ' clip-path="url(#c)"' : ''}/>` : ''}
<g transform="translate(256 256) scale(${scale}) translate(-256 -256)"${clip ? ' clip-path="url(#c)"' : ''}>${art}</g>
</svg>`;
}

const CIRCLE_CLIP = '<defs><clipPath id="c"><circle cx="256" cy="256" r="256"/></clipPath></defs>';

// The art spans roughly r=192 from centre. 0.88 puts it inside the maskable
// 80% safe zone (r=205); 0.84 puts it inside the adaptive 66% zone (r=171).
const MASKABLE_SCALE = 0.88;
const FOREGROUND_SCALE = 0.84;

const webIcon = source;
const maskable = compose({ scale: MASKABLE_SCALE, background: BACKGROUND });
const foreground = compose({ scale: FOREGROUND_SCALE });
const roundIcon = compose({ scale: MASKABLE_SCALE, background: BACKGROUND, clip: CIRCLE_CLIP });

const render = (svg, size) =>
  sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

// --- web / PWA ------------------------------------------------------------
const WEB = [
  { svg: webIcon, out: 'icon-192.png', size: 192 },
  { svg: webIcon, out: 'icon-512.png', size: 512 },
  { svg: webIcon, out: 'apple-touch-icon.png', size: 180 },
  { svg: maskable, out: 'icon-maskable-512.png', size: 512 },
];

for (const { svg, out, size } of WEB) {
  const png = await render(svg, size);
  await writeFile(join(publicDir, out), png);
  console.log(`public/${out.padEnd(26)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}

// --- Android launcher -----------------------------------------------------
//
// Legacy (`ic_launcher`, `ic_launcher_round`) is what pre-API-26 devices and a
// few launchers still read; the adaptive pair (`ic_launcher_foreground` over
// `@color/ic_launcher_background`) is what everything modern uses. Both are
// generated, because shipping only one leaves some devices on whatever the
// Capacitor template happened to include — which is exactly what this app did
// until now: those PNGs were the untouched scaffold defaults.
//
// Foreground densities are the 108dp canvas, so they are 2.25× the legacy
// 48dp ones at the same density.
const DENSITIES = [
  { dir: 'mipmap-mdpi', legacy: 48, foreground: 108 },
  { dir: 'mipmap-hdpi', legacy: 72, foreground: 162 },
  { dir: 'mipmap-xhdpi', legacy: 96, foreground: 216 },
  { dir: 'mipmap-xxhdpi', legacy: 144, foreground: 324 },
  { dir: 'mipmap-xxxhdpi', legacy: 192, foreground: 432 },
];

for (const { dir, legacy, foreground: fgSize } of DENSITIES) {
  const target = join(resDir, dir);
  await mkdir(target, { recursive: true });

  for (const [name, svg, size] of [
    ['ic_launcher.png', webIcon, legacy],
    ['ic_launcher_round.png', roundIcon, legacy],
    ['ic_launcher_foreground.png', foreground, fgSize],
  ]) {
    const png = await render(svg, size);
    await writeFile(join(target, name), png);
  }
  console.log(`${dir.padEnd(33)} ${legacy}px legacy · ${fgSize}px foreground`);
}

// The adaptive background is a flat colour resource, not an image — cheaper to
// render and it cannot disagree with itself across densities. It DOES have to
// agree with the plate in icon.svg, so it is written from the same constant.
await writeFile(
  join(resDir, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/generate-icons.mjs — edit BACKGROUND there, not here.
     Must match the background plate in public/icon.svg, or the launcher shows a
     rim of the wrong colour around the adaptive foreground. -->
<resources>
    <color name="ic_launcher_background">${BACKGROUND}</color>
</resources>
`,
);
console.log(`values/ic_launcher_background.xml  ${BACKGROUND}`);
