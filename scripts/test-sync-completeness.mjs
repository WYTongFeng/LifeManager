// Guards against the exact bug the user caught by asking "what are the
// database tables" (see MILESTONES.md M27): a module adds a new persisted
// key via usePersistentState/useLiveJSON, nobody remembers to also register
// it with the sync layer, and it silently never reaches the cloud — no
// error anywhere, because there's no schema system to fail loudly.
//
// This scans every real call site in `src` and cross-checks each key against
// syncModel.js's own registries. A key must be EITHER synced (RECORD_COLLECTIONS
// / DAILY_STATS_LOCAL_KEY / META_DOCS) OR explicitly declared local-only
// (LOCAL_ONLY_KEYS, with a reason) — so leaving a key out is always a
// decision, never an oversight that only gets caught by asking.

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  RECORD_COLLECTIONS, DAILY_STATS_LOCAL_KEY, META_DOCS, LOCAL_ONLY_KEYS,
} from '../src/utils/syncModel.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.(js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// Matches usePersistentState('key', ...) and useLiveJSON('key', ...) —
// both take the storage key as a single-quoted or double-quoted literal
// first argument, by convention everywhere in this codebase.
//
// saveJSON/loadJSON were added to this pattern after an audit found them
// missing: they are a real persistence path (useTngCapture.js writes the
// capture log through saveJSON from outside React, where a hook can't run), so
// a key introduced only through them would never have been checked at all.
// Every such key happened to also be read via useLiveJSON, so nothing was
// actually unregistered — but the blind spot pointed in exactly the direction
// this test exists to guard, which is how M27 happened in the first place.
const CALL_PATTERN = /\b(?:usePersistentState|useLiveJSON|saveJSON|loadJSON)\(\s*['"]([^'"]+)['"]/g;

const foundKeys = new Map(); // key -> file it was first seen in
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(CALL_PATTERN)) {
    const key = m[1];
    if (!foundKeys.has(key)) foundKeys.set(key, file.split('src')[1] ?? file);
  }
}

// Sanity check the scanner itself isn't silently finding nothing (a broken
// regex or a moved `src` directory would otherwise make every check below
// pass vacuously).
check('scanner found a realistic number of persisted keys', foundKeys.size >= 15, true);
check('scanner actually found accounts (a known key)', foundKeys.has('accounts'), true);
check('scanner actually found incomeSources (the key that started this)', foundKeys.has('incomeSources'), true);

const registered = new Set([
  ...RECORD_COLLECTIONS,
  DAILY_STATS_LOCAL_KEY,
  ...Object.values(META_DOCS).flat(),
  ...Object.keys(LOCAL_ONLY_KEYS),
]);

const unregistered = [...foundKeys.entries()].filter(([key]) => !registered.has(key));
check('every persisted key is either synced or explicitly declared local-only',
  unregistered.map(([key, file]) => `${key} (${file})`),
  []);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
