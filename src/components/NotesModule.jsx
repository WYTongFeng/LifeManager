import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Plus, Search, Pin, Trash2, Archive, X, ChevronLeft,
  StickyNote, CheckSquare, Square, Check,
} from '../utils/icons';
import { usePersistentState, getTodayString } from '../utils/storage';
import { newId } from '../utils/num';
import { describeDate } from '../utils/datetime';
import {
  normalizeNotes, resolveCategories, categoryId, categoryMeta, noteTitle,
  notePreview, checklistProgress, isBlankNote, searchNotes, groupNotes,
  countByCategory, CATEGORY_EMOJI, FALLBACK_CATEGORY,
} from '../utils/notes';

/**
 * Write `value` through `save`, but not on every keystroke.
 *
 * There is no Save button here on purpose, which means the alternative is a
 * localStorage write (and a queued cloud push) per character typed. 400ms is
 * short enough that nothing is ever lost to a crash and long enough that a
 * sentence is one write, not forty.
 *
 * TWO THINGS IT HAS TO GET RIGHT
 *   · Never fire on mount. Opening a note and closing it without touching
 *     anything would otherwise stamp a fresh `updatedAt` on it, jumping it to
 *     the top of 最近 and pushing it to the cloud — an edit that never happened.
 *   · Always flush on unmount. Leaving the screen inside the 400ms window is
 *     the single most likely moment to lose the last few characters, since
 *     typing and then immediately hitting back is exactly how this gets used.
 */
function useAutoSave(value, save, delay = 400) {
  const latest = useRef(value);
  const saver = useRef(save);
  const pending = useRef(false);
  const first = useRef(true);
  latest.current = value;
  saver.current = save;

  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    pending.current = true;
    const t = setTimeout(() => {
      pending.current = false;
      saver.current(latest.current);
    }, delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  useEffect(() => () => {
    if (pending.current) saver.current(latest.current);
  }, []);
}

const card = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-glass)',
  borderRadius: 'var(--radius-md)',
};

const input = {
  width: '100%',
  background: 'var(--bg-input)',
  border: '1px solid var(--border-glass)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  padding: '9px 10px',
  fontSize: '0.85rem',
  fontFamily: 'var(--font-main)',
};

/**
 * A lightweight personal notebook — and deliberately nothing more.
 *
 * The brief ruled out Notion and Obsidian by name, so there is no nesting, no
 * links between notes, no rich text and no tags on top of categories. What is
 * here is what "I need to write this down" actually needs: type, it's saved,
 * find it again later.
 *
 * List and editor share one route (`/notes/:id?`) so this component — and the
 * one `usePersistentState('notes')` inside it — stays mounted across the
 * transition. Two routes would mean two instances of that hook for one key,
 * which drift apart until one remounts (see storage.js).
 */
export default function NotesModule() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [stored, setStored] = usePersistentState('notes', []);
  const [customCategories, setCustomCategories] = usePersistentState('noteCategories', []);

  const notes = useMemo(() => normalizeNotes(stored), [stored]);
  const categories = useMemo(() => resolveCategories(customCategories), [customCategories]);

  const upsert = (note) => setStored(prev => {
    const list = Array.isArray(prev) ? prev : [];
    // A note that has been emptied out is removed rather than kept as a blank
    // row — see isBlankNote in notes.js.
    if (isBlankNote(note)) return list.filter(n => String(n.id) !== String(note.id));
    const i = list.findIndex(n => String(n.id) === String(note.id));
    if (i === -1) return [...list, note];
    const next = [...list];
    next[i] = note;
    return next;
  });

  const remove = (noteId) => setStored(prev => (Array.isArray(prev) ? prev : []).filter(n => String(n.id) !== String(noteId)));

  if (id) {
    return (
      <NoteEditor
        // Keyed so switching between two notes re-initialises the draft
        // instead of carrying the previous note's text across.
        key={id}
        noteId={id}
        notes={notes}
        categories={categories}
        onSave={upsert}
        onDelete={remove}
        onBack={() => navigate('/notes')}
      />
    );
  }

  return (
    <NotesList
      notes={notes}
      categories={categories}
      customCategories={customCategories}
      setCustomCategories={setCustomCategories}
      onOpen={(noteId) => navigate(`/notes/${noteId}`)}
      onSave={upsert}
      onDelete={remove}
    />
  );
}

// --------------------------------------------------------------------------
// List
// --------------------------------------------------------------------------

function NotesList({ notes, categories, customCategories, setCustomCategories, onOpen, onSave, onDelete }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);

  const { pinned, recent, archived } = useMemo(() => groupNotes(notes), [notes]);
  const counts = useMemo(() => countByCategory(notes, categories), [notes, categories]);

  const searching = query.trim().length > 0;
  const results = useMemo(
    () => searchNotes(notes.filter(n => !n.archived), query, categories),
    [notes, query, categories],
  );
  // Pinned notes are in their category too — a pin says "keep this handy", not
  // "file this somewhere else". Read from `pinned` FIRST so they stay on top
  // here as well, then the rest in recency order.
  const inCategory = useMemo(() => {
    if (!activeCategory) return [];
    // A note whose category was deleted is counted under 杂项, so it has to be
    // findable there too or the count would point at nothing.
    const bucket = n => (categories.some(c => c.id === n.category) ? n.category : FALLBACK_CATEGORY);
    return [...pinned, ...recent].filter(n => bucket(n) === activeCategory);
  }, [activeCategory, recent, pinned, categories]);

  const togglePin = (note) => onSave({ ...note, pinned: !note.pinned, updatedAt: Date.now() });
  const toggleArchive = (note) => onSave({ ...note, archived: !note.archived, updatedAt: Date.now() });

  const addCategory = (label, emoji) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setCustomCategories(prev => {
      const list = Array.isArray(prev) ? prev : [];
      return [...list, { id: categoryId(trimmed, categories), emoji, label: trimmed }];
    });
    setShowCategoryForm(false);
  };

  const deleteCategory = (catId) => {
    setCustomCategories(prev => (Array.isArray(prev) ? prev : []).filter(c => c.id !== catId));
    if (activeCategory === catId) setActiveCategory(null);
  };

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      <div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: '800' }}>记事本</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {notes.length ? `${notes.filter(n => !n.archived).length} 则笔记 · 自动储存` : '写点东西 · 自动储存，不用按储存'}
        </p>
      </div>

      {/* Search — first, because with more than a screenful of notes it is the
          fastest route to any of them. */}
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex' }}>
          <Search size={15} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索笔记…"
          style={{ ...input, paddingLeft: '32px', paddingRight: query ? '32px' : '10px' }}
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
          >
            <X size={15} />
          </button>
        )}
      </div>

      <button
        onClick={() => navigate('/notes/new')}
        className="btn-primary"
        style={{ width: '100%', background: 'linear-gradient(135deg, #4ac8ff 0%, #2b9fe0 100%)', boxShadow: '0 4px 14px rgba(74, 200, 255, 0.3)' }}
      >
        <Plus size={16} /> 新建笔记
      </button>

      {searching ? (
        <Section title={`搜索结果 · ${results.length}`}>
          {results.length === 0
            ? <Empty text={`没有找到「${query.trim()}」`} />
            : results.map(n => (
              <NoteRow key={n.id} note={n} categories={categories} onOpen={onOpen} onTogglePin={togglePin} />
            ))}
        </Section>
      ) : activeCategory ? (
        <>
          <button
            onClick={() => setActiveCategory(null)}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', color: 'var(--color-notes)', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}
          >
            <ChevronLeft size={16} /> 所有分类
          </button>
          <Section title={`${categoryMeta(activeCategory, categories).emoji} ${categoryMeta(activeCategory, categories).label} · ${inCategory.length}`}>
            {inCategory.length === 0
              ? <Empty text="这个分类还没有笔记" />
              : inCategory.map(n => (
                <NoteRow key={n.id} note={n} categories={categories} onOpen={onOpen} onTogglePin={togglePin} />
              ))}
          </Section>
        </>
      ) : (
        <>
          {pinned.length > 0 && (
            <Section title="📌 置顶">
              {pinned.map(n => (
                <NoteRow key={n.id} note={n} categories={categories} onOpen={onOpen} onTogglePin={togglePin} />
              ))}
            </Section>
          )}

          <Section
            title="分类"
            action={(
              <button
                onClick={() => setShowCategoryForm(true)}
                style={{ background: 'none', border: 'none', color: 'var(--color-notes)', cursor: 'pointer', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '3px', padding: 0 }}
              >
                <Plus size={13} /> 新分类
              </button>
            )}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {categories.map(c => (
                <button
                  key={c.id}
                  onClick={() => setActiveCategory(c.id)}
                  style={{
                    ...card,
                    display: 'flex', alignItems: 'center', gap: '7px',
                    padding: '9px 10px', cursor: 'pointer', textAlign: 'left',
                    color: 'var(--text-primary)',
                  }}
                >
                  <span style={{ fontSize: '1rem', flexShrink: 0 }}>{c.emoji}</span>
                  <span style={{ fontSize: '0.75rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.label}
                  </span>
                  <span style={{
                    fontSize: '0.7rem', fontFamily: 'var(--font-pixel-retro)',
                    color: counts.get(c.id) ? 'var(--color-notes)' : 'var(--text-muted)',
                  }}>
                    {counts.get(c.id) ?? 0}
                  </span>
                </button>
              ))}
            </div>

            {customCategories?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '8px' }}>
                {customCategories.map(c => (
                  <button
                    key={c.id}
                    onClick={() => deleteCategory(c.id)}
                    // Deleting a custom category never deletes its notes —
                    // they fall back to 杂项. Losing writing because you tidied
                    // up a label would be indefensible.
                    title={`删除分类「${c.label}」· 笔记会移到杂项`}
                    style={{
                      background: 'none', border: '1px solid var(--border-glass)',
                      borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
                      fontSize: '0.66rem', padding: '3px 7px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '4px',
                    }}
                  >
                    <Trash2 size={11} /> {c.emoji} {c.label}
                  </button>
                ))}
              </div>
            )}
          </Section>

          <Section title="最近">
            {recent.length === 0
              ? <Empty text="还没有笔记 —— 按上面的按钮写第一则" />
              : recent.slice(0, 8).map(n => (
                <NoteRow key={n.id} note={n} categories={categories} onOpen={onOpen} onTogglePin={togglePin} />
              ))}
          </Section>

          {archived.length > 0 && (
            <Section
              title={`已归档 · ${archived.length}`}
              action={(
                <button
                  onClick={() => setShowArchived(v => !v)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.72rem', padding: 0 }}
                >
                  {showArchived ? '收起' : '展开'}
                </button>
              )}
            >
              {showArchived && archived.map(n => (
                <NoteRow
                  key={n.id} note={n} categories={categories} onOpen={onOpen}
                  onTogglePin={togglePin} onUnarchive={() => toggleArchive(n)} onDelete={() => onDelete(n.id)}
                />
              ))}
            </Section>
          )}
        </>
      )}

      {showCategoryForm && (
        <CategoryForm onAdd={addCategory} onClose={() => setShowCategoryForm(false)} />
      )}
    </div>
  );
}

function Section({ title, action, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-secondary)', letterSpacing: '0.03em' }}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }) {
  return (
    <div style={{ ...card, padding: '14px', textAlign: 'center', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
      {text}
    </div>
  );
}

function NoteRow({ note, categories, onOpen, onTogglePin, onUnarchive, onDelete }) {
  const cat = categoryMeta(note.category, categories);
  const title = noteTitle(note);
  const preview = notePreview(note);
  const progress = checklistProgress(note);

  return (
    <div style={{ ...card, display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 11px' }}>
      <button
        onClick={() => onOpen(note.id)}
        style={{ flex: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)', minWidth: 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ fontSize: '0.8rem' }}>{cat.emoji}</span>
          <span style={{ fontSize: '0.85rem', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title || '（空笔记）'}
          </span>
        </div>
        {preview && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {preview}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '4px', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
          <span>{note.date ? describeDate(note.date) : ''}</span>
          {progress && (
            <span style={{ color: progress.done === progress.total ? 'var(--color-accent-green)' : 'var(--text-muted)' }}>
              ✓ {progress.done}/{progress.total}
            </span>
          )}
        </div>
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
        {onUnarchive ? (
          <>
            <button onClick={onUnarchive} title="取消归档" style={iconBtn}><Archive size={14} /></button>
            <button onClick={onDelete} title="删除" style={{ ...iconBtn, color: 'var(--color-accent-red)' }}><Trash2 size={14} /></button>
          </>
        ) : (
          <button
            onClick={() => onTogglePin(note)}
            title={note.pinned ? '取消置顶' : '置顶'}
            style={{ ...iconBtn, color: note.pinned ? 'var(--color-notes)' : 'var(--text-muted)' }}
          >
            <Pin size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

const iconBtn = {
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  padding: '2px',
  display: 'flex',
};

function CategoryForm({ onAdd, onClose }) {
  const [label, setLabel] = useState('');
  const [emoji, setEmoji] = useState('📦');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: '700' }}>新分类</h3>
          <button onClick={onClose} style={{ ...iconBtn, color: 'white' }}><X size={18} /></button>
        </div>

        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAdd(label, emoji)}
          placeholder="分类名字（Travel、实习、Gaming…）"
          style={input}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', margin: '12px 0' }}>
          {CATEGORY_EMOJI.map(e => (
            <button
              key={e}
              onClick={() => setEmoji(e)}
              style={{
                fontSize: '1.05rem', lineHeight: 1, padding: '6px',
                background: emoji === e ? 'var(--color-notes-soft)' : 'var(--bg-input)',
                border: `1px solid ${emoji === e ? 'var(--color-notes)' : 'var(--border-glass)'}`,
                borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              }}
            >
              {e}
            </button>
          ))}
        </div>

        <button onClick={() => onAdd(label, emoji)} className="btn-primary" style={{ width: '100%' }} disabled={!label.trim()}>
          <Check size={15} /> 建立
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Editor
// --------------------------------------------------------------------------

function NoteEditor({ noteId, notes, categories, onSave, onDelete, onBack }) {
  const existing = notes.find(n => String(n.id) === String(noteId));

  const [draft, setDraft] = useState(() => existing ?? {
    id: newId(),
    title: '',
    body: '',
    category: FALLBACK_CATEGORY,
    pinned: false,
    archived: false,
    checklist: [],
    date: getTodayString(),
    at: Date.now(),
    updatedAt: Date.now(),
  });
  const [showChecklist, setShowChecklist] = useState(() => (existing?.checklist?.length ?? 0) > 0);

  useAutoSave(draft, onSave);

  const patch = (fields) => setDraft(prev => ({ ...prev, ...fields, updatedAt: Date.now() }));

  const setItem = (itemId, fields) => patch({
    checklist: draft.checklist.map(i => (i.id === itemId ? { ...i, ...fields } : i)),
  });
  const addItem = () => patch({ checklist: [...draft.checklist, { id: newId(), text: '', done: false }] });
  const removeItem = (itemId) => patch({ checklist: draft.checklist.filter(i => i.id !== itemId) });

  const cat = categoryMeta(draft.category, categories);

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={onBack}
          style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'none', border: 'none', color: 'var(--color-notes)', cursor: 'pointer', fontSize: '0.82rem', padding: 0 }}
        >
          <ChevronLeft size={18} /> 记事本
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* No Save button, by design. This is what tells you so — otherwise
              the absence of one reads as "did that save?" every single time. */}
          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <Check size={12} /> 自动储存
          </span>
          <button
            onClick={() => patch({ pinned: !draft.pinned })}
            title={draft.pinned ? '取消置顶' : '置顶'}
            style={{ ...iconBtn, color: draft.pinned ? 'var(--color-notes)' : 'var(--text-muted)' }}
          >
            <Pin size={16} />
          </button>
          <button
            onClick={() => { patch({ archived: !draft.archived }); }}
            title={draft.archived ? '取消归档' : '归档'}
            style={{ ...iconBtn, color: draft.archived ? 'var(--color-diet)' : 'var(--text-muted)' }}
          >
            <Archive size={16} />
          </button>
          <button
            onClick={() => { onDelete(draft.id); onBack(); }}
            title="删除"
            style={{ ...iconBtn, color: 'var(--color-accent-red)' }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <input
        autoFocus={!existing}
        value={draft.title}
        onChange={(e) => patch({ title: e.target.value })}
        placeholder="标题（可以不写）"
        style={{ ...input, fontSize: '1.05rem', fontWeight: '700', border: 'none', background: 'none', padding: '2px 0' }}
      />

      {/* Category as a scrolling chip row rather than a <select>: it's one tap
          instead of two, and every option is visible without opening anything. */}
      <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', paddingBottom: '2px' }}>
        {categories.map(c => (
          <button
            key={c.id}
            onClick={() => patch({ category: c.id })}
            style={{
              flexShrink: 0,
              background: draft.category === c.id ? 'var(--color-notes-soft)' : 'var(--bg-input)',
              border: `1px solid ${draft.category === c.id ? 'var(--color-notes)' : 'var(--border-glass)'}`,
              color: draft.category === c.id ? 'var(--color-notes)' : 'var(--text-secondary)',
              borderRadius: 'var(--radius-sm)', padding: '5px 9px',
              fontSize: '0.7rem', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {c.emoji} {c.label}
          </button>
        ))}
      </div>

      <textarea
        value={draft.body}
        onChange={(e) => patch({ body: e.target.value })}
        placeholder="写点什么…"
        rows={10}
        style={{
          ...input,
          resize: 'vertical',
          minHeight: '180px',
          lineHeight: '1.55',
          fontSize: '0.88rem',
        }}
      />

      {/* Checklist stays hidden until asked for. Most notes are prose, and a
          permanent empty checkbox area is clutter on every one of them. */}
      {showChecklist || draft.checklist.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {draft.checklist.map(item => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <button
                onClick={() => setItem(item.id, { done: !item.done })}
                style={{ ...iconBtn, color: item.done ? 'var(--color-accent-green)' : 'var(--text-muted)' }}
              >
                {item.done ? <CheckSquare size={17} /> : <Square size={17} />}
              </button>
              <input
                value={item.text}
                onChange={(e) => setItem(item.id, { text: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && addItem()}
                placeholder="项目…"
                style={{
                  ...input, padding: '5px 8px', fontSize: '0.8rem',
                  textDecoration: item.done ? 'line-through' : 'none',
                  color: item.done ? 'var(--text-muted)' : 'var(--text-primary)',
                }}
              />
              <button onClick={() => removeItem(item.id)} style={{ ...iconBtn, color: 'var(--text-muted)' }}>
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            onClick={addItem}
            style={{
              background: 'none', border: '1px dashed var(--border-glass)',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
              padding: '7px', fontSize: '0.74rem', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
            }}
          >
            <Plus size={13} /> 加一项
          </button>
        </div>
      ) : (
        <button
          onClick={() => { setShowChecklist(true); addItem(); }}
          style={{
            background: 'none', border: '1px dashed var(--border-glass)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
            padding: '8px', fontSize: '0.74rem', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
          }}
        >
          <CheckSquare size={14} /> 加清单
        </button>
      )}

      <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
        <StickyNote size={12} />
        {cat.emoji} {cat.label}
        {draft.date ? ` · 建立于 ${draft.date}` : ''}
        {draft.archived ? ' · 已归档' : ''}
      </div>
    </div>
  );
}
