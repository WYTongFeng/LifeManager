// Rasterises the app icons from SVG.
//
// Android needs real PNGs to offer "install to home screen" reliably, but
// checking binaries into the repo makes them impossible to review or update.
// This regenerates them from public/icon.svg, so the SVG stays the single
// source of truth for the icon.
//
//   npm run icons
//
// Fonts: sharp rasterises SVG through librsvg, which uses the system's fonts,
// not the web fonts the app loads at runtime. The icon SVG therefore lists a
// generic sans-serif fallback so "LM" renders on any machine.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');

const TARGETS = [
  { src: 'icon.svg', out: 'icon-192.png', size: 192 },
  { src: 'icon.svg', out: 'icon-512.png', size: 512 },
  { src: 'icon.svg', out: 'apple-touch-icon.png', size: 180 },
  { src: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512 },
];

for (const { src, out, size } of TARGETS) {
  const svg = await readFile(join(publicDir, src));
  const png = await sharp(svg, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(publicDir, out), png);
  console.log(`${out.padEnd(24)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}
