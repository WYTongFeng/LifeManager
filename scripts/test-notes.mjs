import {
  normalizeNote, normalizeNotes, resolveCategories, categoryId, categoryMeta,
  noteTitle, notePreview, checklistProgress, isBlankNote, searchNotes,
  groupNotes, countByCategory, DEFAULT_CATEGORIES, FALLBACK_CATEGORY,
} from '../src/utils/notes.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// --- normalize ----------------------------------------------------------------
check('a bare object gets every field filled in',
  normalizeNote({ id: 1, body: 'hi' }),
  {
    id: 1, title: '', body: 'hi', category: FALLBACK_CATEGORY, pinned: false,
    archived: false, checklist: [], date: null, at: 0, updatedAt: 0,
  });
check('garbage in, null out', normalizeNote('nope'), null);
check('a non-array note list is still a list', normalizeNotes(null), []);
check('checklist items are cleaned up, not trusted',
  normalizeNote({ checklist: [{ id: 1, text: 'a', done: 1 }, null, { id: 2 }] }).checklist,
  [{ id: 1, text: 'a', done: true }, { id: 2, text: '', done: false }]);
// The three-clock convention: `at` never moves, `updatedAt` is the edit.
check('both clocks survive normalize', normalizeNote({ at: 5, updatedAt: 9 }), {
  id: undefined, title: '', body: '', category: FALLBACK_CATEGORY, pinned: false,
  archived: false, checklist: [], date: null, at: 5, updatedAt: 9,
});

// --- categories -----------------------------------------------------------------
check('the defaults are all there', resolveCategories([]).length, DEFAULT_CATEGORIES.length);
check('custom categories come after the defaults',
  resolveCategories([{ id: 'travel', emoji: '✈️', label: 'Travel' }]).at(-1).id, 'travel');
// Two categories sharing an id makes every count ambiguous.
check('a custom category cannot shadow a default id',
  resolveCategories([{ id: 'work', label: 'Mine' }]).filter(c => c.id === 'work').length, 1);
check('junk in the custom list is ignored', resolveCategories([null, {}, 'x']).length, DEFAULT_CATEGORIES.length);

check('a typed name slugifies', categoryId('Gaming Stuff'), 'gaming-stuff');
check('a clash gets a suffix', categoryId('Work', DEFAULT_CATEGORIES), 'work-2');
// A Chinese name slugifies to nothing but still needs a stable id — the label
// is what the user sees, the id is bookkeeping.
check('a non-Latin name still gets an id', categoryId('旅行').startsWith('cat-'), true);

check('a known category resolves', categoryMeta('work', resolveCategories([])).emoji, '💼');
// A note whose category was deleted still has to render.
check('a deleted category still renders', categoryMeta('gone', resolveCategories([])).missing, true);

// --- titles and previews -----------------------------------------------------------
check('a real title wins', noteTitle({ title: '开会', body: 'x' }), '开会');
// "Untitled" on every body-first note makes the whole list useless.
check('no title falls back to the first line of the body',
  noteTitle({ body: '\n\n买牛奶\n还有鸡蛋' }), '买牛奶');
check('...and then to the first checklist item',
  noteTitle({ checklist: [{ text: '交作业' }] }), '交作业');
check('a truly empty note has no title', noteTitle({}), '');

check('the preview skips the line that became the title',
  notePreview({ body: '买牛奶\n还有鸡蛋' }), '还有鸡蛋');
check('...but keeps every line when there is a real title',
  notePreview({ title: '购物', body: '买牛奶\n还有鸡蛋' }), '买牛奶 · 还有鸡蛋');
check('a checklist previews with its ticks',
  notePreview({ checklist: [{ text: 'a', done: true }, { text: 'b' }] }), '✓ a · ○ b');

check('checklist progress counts the ticks',
  checklistProgress({ checklist: [{ text: 'a', done: true }, { text: 'b' }] }), { done: 1, total: 2 });
check('blank checklist rows are not counted',
  checklistProgress({ checklist: [{ text: '  ' }, { text: 'b' }] }), { done: 0, total: 1 });
check('no checklist means no progress bar', checklistProgress({ body: 'x' }), null);

// Tapping 新建 and backing straight out is the most common way to make one of
// these, and a list of blank rows is what makes a notes app feel broken.
check('an untouched note is blank', isBlankNote({ title: ' ', body: '\n' }), true);
check('one character makes it real', isBlankNote({ body: 'a' }), false);
check('a checklist item makes it real', isBlankNote({ checklist: [{ text: 'x' }] }), false);

// --- search -------------------------------------------------------------------
const cats = resolveCategories([]);
const notes = normalizeNotes([
  { id: 1, title: '房租', body: '每月 1200', category: 'finance', at: 300 },
  { id: 2, title: 'Gym plan', body: 'push pull legs', category: 'personal', at: 200, pinned: true },
  { id: 3, title: '', body: '', checklist: [{ id: 1, text: '买牛奶' }], category: 'misc', at: 100 },
  { id: 4, title: 'old', body: 'archived thing', category: 'work', at: 50, archived: true },
]);

check('search finds a body match', searchNotes(notes, '1200', cats).map(n => n.id), [1]);
check('search finds a checklist match', searchNotes(notes, '牛奶', cats).map(n => n.id), [3]);
check('search is case-insensitive', searchNotes(notes, 'GYM', cats).map(n => n.id), [2]);
check('search matches the category label too', searchNotes(notes, 'finance', cats).map(n => n.id), [1]);
// Adding a word is how people narrow a search, so every term must match.
check('two terms must both match', searchNotes(notes, 'push legs', cats).map(n => n.id), [2]);
check('...and one wrong term finds nothing', searchNotes(notes, 'push swim', cats).map(n => n.id), []);
check('an empty query returns everything', searchNotes(notes, '   ', cats).length, 4);

// --- grouping and counts ----------------------------------------------------------
const grouped = groupNotes(notes);
check('pinned notes come out separately', grouped.pinned.map(n => n.id), [2]);
// Archiving is how you say "not now" — one that keeps showing up has ignored you.
check('archived notes are out of recent entirely', grouped.recent.map(n => n.id), [1, 3]);
check('...and in their own list', grouped.archived.map(n => n.id), [4]);
check('recent is newest first', groupNotes(normalizeNotes([
  { id: 1, at: 100 }, { id: 2, at: 300 }, { id: 3, at: 200, updatedAt: 900 },
])).recent.map(n => n.id), [3, 2, 1]);

const counts = countByCategory(notes, cats);
check('counts skip archived notes', counts.get('work'), 0);
check('counts land in the right category', counts.get('finance'), 1);
// The totals must add up to the note count, so an orphan lands in the fallback.
check('a note in a deleted category counts under 杂项',
  countByCategory(normalizeNotes([{ id: 1, category: 'deleted-cat' }]), cats).get(FALLBACK_CATEGORY), 1);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
