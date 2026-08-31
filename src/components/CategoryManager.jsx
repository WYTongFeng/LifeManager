import React, { useState } from 'react';
import { Plus, Trash2, X, Pencil, Check, Square, CheckSquare } from '../utils/icons';
import { useLiveJSON, saveJSON } from '../utils/storage';
import {
  CATEGORY_PREFS_KEY, BUILTIN_EXPENSE_CATEGORIES, BUILTIN_INCOME_CATEGORIES,
  resolveMoneyCategories, newCategoryId, emptyCategoryPrefs,
} from '../utils/moneyCategories';

const inputStyle = {
  width: '100%', padding: '9px 11px', borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
  color: 'white', fontSize: '0.85rem',
};

/**
 * 管理分类 — add your own categories, rename the built-in ones, hide the ones
 * you never use.
 *
 * WHY HIDING AND NOT DELETING
 * A built-in category cannot be deleted, only hidden. Records store a category
 * id forever, and deleting 宠物 would leave a year of pet spending pointing at
 * an id nothing can name — the pie would show a slug. Hiding takes it out of
 * every picker (so it stops cluttering a dropdown you use several times a day)
 * while `moneyCategoryMeta` keeps resolving its name for the records already
 * filed under it. A custom category you added yourself CAN be deleted, but the
 * same rule applies to anything already using it, which is why the button says
 * so before it does it.
 *
 * NOTHING HERE EVER REWRITES A RECORD. This screen only edits the small prefs
 * document; every expense on disk is left exactly as it was.
 */
export default function CategoryManager({ onClose }) {
  const stored = useLiveJSON(CATEGORY_PREFS_KEY, null);
  const prefs = { ...emptyCategoryPrefs(), ...(stored ?? {}) };
  const save = (next) => saveJSON(CATEGORY_PREFS_KEY, next);

  const [kind, setKind] = useState('expense');
  const [newLabel, setNewLabel] = useState('');
  const [newEmoji, setNewEmoji] = useState('');
  const [editing, setEditing] = useState(null);      // category id being renamed
  const [draftLabel, setDraftLabel] = useState('');

  const builtins = kind === 'income' ? BUILTIN_INCOME_CATEGORIES : BUILTIN_EXPENSE_CATEGORIES;
  const custom = (prefs.custom ?? []).filter(c => c.kind === kind);
  const hidden = new Set(prefs.hidden ?? []);

  const addCategory = () => {
    const label = newLabel.trim();
    if (!label) return;
    const id = newCategoryId(label, prefs.custom ?? []);
    save({
      ...prefs,
      custom: [...(prefs.custom ?? []), { id, label, emoji: newEmoji.trim() || '📦', kind }],
    });
    setNewLabel('');
    setNewEmoji('');
  };

  const toggleHidden = (id) => {
    const next = new Set(prefs.hidden ?? []);
    if (next.has(id)) next.delete(id); else next.add(id);
    save({ ...prefs, hidden: [...next] });
  };

  const commitRename = (id) => {
    const label = draftLabel.trim();
    const renamed = { ...(prefs.renamed ?? {}) };
    // Renaming back to the original name removes the override rather than
    // storing a copy of the built-in label — otherwise a future change to the
    // shipped name would silently never reach this user.
    const original = [...BUILTIN_EXPENSE_CATEGORIES, ...BUILTIN_INCOME_CATEGORIES]
      .find(c => c.id === id)?.label;
    if (!label || label === original) delete renamed[id]; else renamed[id] = label;
    save({ ...prefs, renamed });
    setEditing(null);
  };

  const deleteCustom = (id) => {
    save({
      ...prefs,
      custom: (prefs.custom ?? []).filter(c => c.id !== id),
      hidden: (prefs.hidden ?? []).filter(h => h !== id),
    });
  };

  const renamedLabel = (c) => (prefs.renamed?.[c.id]) || c.label;
  const visibleCount = resolveMoneyCategories(prefs, kind).length;

  const row = (c, isCustom) => {
    const isHidden = hidden.has(c.id);
    const isEditing = editing === c.id;
    return (
      <div key={c.id} style={{
        display: 'flex', alignItems: 'center', gap: '9px',
        padding: '0.5rem 0.6rem', borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
        opacity: isHidden ? 0.45 : 1,
      }}>
        <span style={{ fontSize: '1rem', flexShrink: 0 }}>{c.emoji}</span>

        {isEditing ? (
          <input
            autoFocus
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(c.id); }}
            style={{ ...inputStyle, flex: 1, padding: '4px 8px', fontSize: '0.8rem' }}
          />
        ) : (
          <span style={{ fontSize: '0.82rem', flex: 1, minWidth: 0 }}>
            {renamedLabel(c)}
            {isCustom && (
              <span style={{ fontSize: '0.62rem', color: 'var(--color-sports)', marginLeft: '6px' }}>自己加的</span>
            )}
            {prefs.renamed?.[c.id] && !isCustom && (
              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginLeft: '6px' }}>已改名</span>
            )}
          </span>
        )}

        {isEditing ? (
          <button onClick={() => commitRename(c.id)} aria-label="保存"
            style={{ background: 'none', border: 'none', color: 'var(--color-money)', cursor: 'pointer', padding: '2px' }}>
            <Check size={16} />
          </button>
        ) : (
          <>
            <button
              onClick={() => { setEditing(c.id); setDraftLabel(renamedLabel(c)); }}
              aria-label={`改名 ${renamedLabel(c)}`}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
            >
              <Pencil size={14} />
            </button>
            {/* Checked = offered in the pickers. A checkbox rather than a
                delete, because hiding is exactly "stop showing me this",
                and the records already filed under it are untouched. */}
            <button
              onClick={() => toggleHidden(c.id)}
              aria-label={isHidden ? `显示 ${renamedLabel(c)}` : `隐藏 ${renamedLabel(c)}`}
              title={isHidden ? '现在是隐藏的，按一下放回选单' : '在选单里 — 按一下隐藏（旧记录不受影响）'}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
                color: isHidden ? 'var(--text-muted)' : 'var(--color-money)',
              }}
            >
              {isHidden ? <Square size={14} /> : <CheckSquare size={14} />}
            </button>
            {isCustom && (
              <button
                onClick={() => deleteCustom(c.id)}
                aria-label={`删除 ${renamedLabel(c)}`}
                style={{ background: 'none', border: 'none', color: 'var(--color-accent-red)', cursor: 'pointer', padding: '2px' }}
              >
                <Trash2 size={14} />
              </button>
            )}
          </>
        )}
      </div>
    );
  };

  // Above the standard modal layer on purpose: this one is reachable FROM
  // another modal (the 记一笔 form has a 管理分类 link), and at the shared
  // z-index it opened silently behind the form that opened it — the tap looked
  // like it had done nothing at all.
  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 300 }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '86vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: '700' }}>管理分类</h3>
          <button onClick={onClose} aria-label="关闭"
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: '0.9rem' }}>
          改这里<strong>不会动到已经记好的账</strong> — 旧记录还是原本那笔，只是名字换个显示方式。
          内置分类只能隐藏不能删，因为以前记在那一类底下的账还要认得出它叫什么。
        </p>

        {/* 支出 / 支入 — two genuinely different vocabularies, so they are two
            tabs rather than one long list with a divider in it. */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '0.9rem' }}>
          {[['expense', '支出'], ['income', '支入']].map(([k, label]) => (
            <button
              key={k}
              onClick={() => { setKind(k); setEditing(null); }}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem',
                fontWeight: kind === k ? '700' : '500', cursor: 'pointer',
                background: kind === k ? 'var(--color-money-soft)' : 'var(--bg-input)',
                color: kind === k ? 'var(--color-money)' : 'var(--text-secondary)',
                border: `1px solid ${kind === k ? 'var(--color-money)' : 'var(--border-glass)'}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {builtins.map(c => row(c, false))}
          {custom.map(c => row(c, true))}
        </div>

        <div style={{ marginTop: '1rem', paddingTop: '0.9rem', borderTop: '1px solid var(--border-glass)' }}>
          <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            加一个自己的{kind === 'income' ? '支入' : '支出'}分类
          </label>
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
            <input
              value={newEmoji}
              onChange={(e) => setNewEmoji(e.target.value)}
              placeholder="🎯"
              aria-label="图示"
              style={{ ...inputStyle, width: '52px', textAlign: 'center', flexShrink: 0 }}
            />
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addCategory(); }}
              placeholder="例：波霸基金"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={addCategory}
              disabled={!newLabel.trim()}
              className="btn-primary"
              style={{ flexShrink: 0, padding: '0 0.9rem', opacity: newLabel.trim() ? 1 : 0.45 }}
            >
              <Plus size={15} />
            </button>
          </div>
          <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '7px' }}>
            现在这一类有 {visibleCount} 个分类可以选。
          </p>
        </div>
      </div>
    </div>
  );
}
