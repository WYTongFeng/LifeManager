// A notebook, deliberately not a knowledge base.
//
// The brief for this one was explicit: "I need to write something down
// quickly", and NOT Notion/Obsidian. So there are no backlinks, no nesting,
// no rich text, no tags-on-top-of-categories. A note is a title, a category,
// a body, and optionally a few checkboxes.
//
// Everything here is pure so `scripts/test-notes.mjs` can run it in Node with
// no DOM — the same arrangement every other logic module in this app uses.

import { num } from './num.js';

/**
 * The categories a fresh install starts with.
 *
 * Ids are stable ASCII slugs, never the label: the label is display text that
 * a user may well rename ("Work" -> "公司"), and every note stores the id. If
 * notes stored the label, renaming a category would orphan every note in it.
 */
export const DEFAULT_CATEGORIES = [
  { id: 'work', emoji: '💼', label: '工作 Work' },
  { id: 'study', emoji: '📚', label: '学习 Study' },
  { id: 'projects', emoji: '🧩', label: '项目 Projects' },
  { id: 'ideas', emoji: '🧠', label: '灵感 Ideas' },
  { id: 'finance', emoji: '💰', label: '财务 Finance' },
  { id: 'personal', emoji: '📝', label: '个人 Personal' },
  { id: 'misc', emoji: '📦', label: '杂项 Misc' },
];

/** Where a note with no category — or a category since deleted — lands. */
export const FALLBACK_CATEGORY = 'misc';

/** Emoji offered when creating a category, so nobody has to find a picker. */
export const CATEGORY_EMOJI = [
  '📦', '💼', '📚', '🧩', '🧠', '💰', '📝', '✈️', '🎮', '🏠',
  '🍜', '🎵', '🎬', '🏥', '🐱', '🎁', '🔧', '⚡', '🌱', '📌',
];

/**
 * Fill in every field a note might be missing, on READ.
 *
 * MUST list every field explicitly — this builds a new object rather than
 * spreading `...n`, so anything not named here is DELETED on every read. That
 * is the same trap `normalizeAccount` and `normalizeAllocation` document, and
 * it bites silently: the field survives one session in React state and
 * vanishes the next time storage is read.
 */
export function normalizeNote(n) {
  if (!n || typeof n !== 'object') return null;
  return {
    id: n.id,
    title: typeof n.title === 'string' ? n.title : '',
    body: typeof n.body === 'string' ? n.body : '',
    category: n.category ?? FALLBACK_CATEGORY,
    pinned: Boolean(n.pinned),
    archived: Boolean(n.archived),
    checklist: Array.isArray(n.checklist)
      ? n.checklist
        .filter(i => i && typeof i === 'object')
        .map(i => ({ id: i.id, text: typeof i.text === 'string' ? i.text : '', done: Boolean(i.done) }))
      : [],
    // Same three-clock convention as every other record in this app:
    // `date`/`at` are when it was CREATED and never move, `updatedAt` is the
    // last edit. Sync reads the later of at/updatedAt — see syncModel.js — so
    // an edit that forgets to stamp `updatedAt` never leaves the device.
    date: n.date ?? null,
    at: num(n.at),
    updatedAt: num(n.updatedAt),
  };
}

export function normalizeNotes(list) {
  return (Array.isArray(list) ? list : []).map(normalizeNote).filter(Boolean);
}

/**
 * The full category list: built-ins plus the user's own.
 *
 * Custom ones come last and cannot shadow a default id — two categories with
 * the same id would make `categoryMeta` ambiguous and the counts wrong.
 */
export function resolveCategories(custom) {
  const seen = new Set(DEFAULT_CATEGORIES.map(c => c.id));
  const extra = (Array.isArray(custom) ? custom : [])
    .filter(c => c && typeof c === 'object' && c.id && !seen.has(c.id))
    .map(c => ({
      id: String(c.id),
      emoji: c.emoji || '📦',
      label: c.label || String(c.id),
      custom: true,
    }));
  return [...DEFAULT_CATEGORIES, ...extra];
}

/** Turn a typed category name into a slug id that won't collide with a default. */
export function categoryId(label, existing = []) {
  const base = String(label ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Non-Latin names (中文, emoji-only) slugify to nothing. They still need a
  // stable id, so fall back to a timestamp rather than refusing the name —
  // the label is what the user sees, the id is bookkeeping.
  const stem = base || `cat-${Date.now()}`;
  const taken = new Set(existing.map(c => c.id));
  if (!taken.has(stem)) return stem;
  let i = 2;
  while (taken.has(`${stem}-${i}`)) i++;
  return `${stem}-${i}`;
}

export function categoryMeta(id, categories) {
  return categories.find(c => c.id === id)
    // A note whose category was deleted still has to render. Showing the raw
    // id with a neutral icon is honest; crashing or showing "undefined" is not.
    ?? { id, emoji: '📦', label: id ?? FALLBACK_CATEGORY, missing: true };
}

/**
 * What to call a note in a list.
 *
 * A note typed body-first has no title, and "Untitled" for every one of them
 * makes the list useless. So the first non-empty line of the body stands in —
 * which is what the user would have called it anyway.
 */
export function noteTitle(note) {
  const title = (note?.title ?? '').trim();
  if (title) return title;
  const firstLine = (note?.body ?? '').split('\n').map(s => s.trim()).find(Boolean);
  if (firstLine) return firstLine.slice(0, 60);
  const firstItem = (note?.checklist ?? []).map(i => i.text?.trim()).find(Boolean);
  if (firstItem) return firstItem.slice(0, 60);
  return '';
}

/** The grey second line under the title. Skips whatever became the title. */
export function notePreview(note, max = 70) {
  const lines = (note?.body ?? '').split('\n').map(s => s.trim()).filter(Boolean);
  const used = (note?.title ?? '').trim() ? 0 : 1;
  const rest = lines.slice(used).join(' · ');
  if (rest) return rest.slice(0, max);
  const items = (note?.checklist ?? []).filter(i => i.text?.trim());
  if (items.length) return items.map(i => `${i.done ? '✓' : '○'} ${i.text}`).join(' · ').slice(0, max);
  return '';
}

/** `{ done, total }` for the checklist, or null when there isn't one. */
export function checklistProgress(note) {
  const items = (note?.checklist ?? []).filter(i => (i.text ?? '').trim());
  if (!items.length) return null;
  return { done: items.filter(i => i.done).length, total: items.length };
}

/**
 * A note nobody has typed anything into.
 *
 * Tapping 新建 and then backing out immediately is the single most common way
 * to create one of these, and a list full of blank rows is exactly the kind of
 * mess that makes a notes app feel unreliable. The editor discards these on
 * exit rather than saving them.
 */
export function isBlankNote(note) {
  return !(note?.title ?? '').trim()
    && !(note?.body ?? '').trim()
    && !(note?.checklist ?? []).some(i => (i.text ?? '').trim());
}

/**
 * Search across title, body, checklist text and category label.
 *
 * Case-insensitive substring, not fuzzy: with a personal notebook you are
 * looking for a word you know you wrote, and fuzzy matching mostly produces
 * confident wrong answers. Multiple words must ALL appear (AND), which is how
 * people narrow a search by adding a word.
 */
export function searchNotes(notes, query, categories = []) {
  const terms = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return notes;
  return notes.filter(n => {
    const cat = categoryMeta(n.category, categories);
    const hay = [
      n.title, n.body, cat.label,
      ...(n.checklist ?? []).map(i => i.text),
    ].join('\n').toLowerCase();
    return terms.every(t => hay.includes(t));
  });
}

/** Most recently touched first — an edit is what makes a note "recent". */
export function byRecency(a, b) {
  return Math.max(b.updatedAt, b.at) - Math.max(a.updatedAt, a.at);
}

/**
 * The three lists the notes screen renders, from one pass.
 *
 * Archived notes are excluded from pinned/recent entirely rather than sorted
 * to the bottom: archiving is how you say "not now", and a note that keeps
 * appearing after you archived it has ignored you.
 */
export function groupNotes(notes) {
  const live = notes.filter(n => !n.archived).sort(byRecency);
  return {
    pinned: live.filter(n => n.pinned),
    recent: live.filter(n => !n.pinned),
    archived: notes.filter(n => n.archived).sort(byRecency),
  };
}

/** How many live notes sit in each category, for the browse grid. */
export function countByCategory(notes, categories) {
  const counts = new Map(categories.map(c => [c.id, 0]));
  for (const n of notes) {
    if (n.archived) continue;
    // A note in a deleted category is counted under the fallback rather than
    // dropped, so the category totals always add up to the note count.
    const key = counts.has(n.category) ? n.category : FALLBACK_CATEGORY;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
