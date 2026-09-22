import React, { useState } from 'react';
import { Pencil, Trash2, Check, X } from '../utils/icons';
import { saveJSON } from '../utils/storage';
import { num } from '../utils/num';
import {
  renameTab, setTabArchived, tabRecordCount, deleteTab, detachTabRecords,
} from '../utils/shareTabs';

/**
 * 设置 for one 共摊本 — rename it, put it away, or get rid of it.
 *
 * WHY THIS EXISTS
 * 「我按进去不可以设置什么的吗，有点奇怪，然后也不可以取消，就删除不掉」
 * (2026-09-22). A tab was created inline from the 记账 form — type a name,
 * press save — and from that moment it was permanent. `archived` was read in
 * five places and written by nothing, there was no rename, and there was no
 * delete at all. The card showed numbers and offered no way to change anything
 * about the thing producing them.
 *
 * THE THREE ACTIONS ARE NOT EQUALLY SAFE, AND THE SCREEN SAYS SO
 * A record carries `shareTabId`, and `inShareTab` keeps it out of daily spend
 * on the strength of that field alone — it never looks at the tab. So:
 *
 *   · 改名 is free. The id is what records point at; the label is display text.
 *   · 封存 hides the tab from the pickers and the card list. It is safe now
 *     because `tabsForCycle` keeps an archived tab that still has records in
 *     the live cycle (it used to drop it, which made the month's net vanish).
 *   · 删除 orphans every record pointing at the tab — they stay excluded from
 *     spending by a tab that no longer exists to net them. So it is refused
 *     while anything is in there, and the way out is spelled out rather than
 *     hinted at: 放回普通开销 detaches them first, one real save each.
 *
 * Detaching goes through `onSaveExpense`, never a local setter: these records
 * can be dated any day, and the today-only slice silently no-ops on the rest.
 * Same reasoning as 归类中心 and MoneyModule's closeProject.
 */
export default function ShareTabSettings({ tab, shareTabs, expenses, onSaveExpense, onClose }) {
  const [name, setName] = useState(tab?.label ?? '');
  const [confirming, setConfirming] = useState(null); // null | 'detach' | 'delete'

  if (!tab) return null;

  const held = tabRecordCount(tab, expenses);
  const heldTotal = detachTabRecords(tab.id, expenses)
    .reduce((sum, e) => sum + Math.abs(num(e.amount)), 0);
  const archived = !!tab.archived;

  const save = (next) => saveJSON('shareTabs', next);

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === tab.label) return;
    save(renameTab(shareTabs, tab.id, trimmed));
  };

  const toggleArchive = () => save(setTabArchived(shareTabs, tab.id, !archived));

  // Every record out of the tab first, then the caller can delete it. Done in
  // this order deliberately: if a save fails partway the tab is still there,
  // still netting whatever is left, rather than gone with records pointing at
  // nothing.
  const detachAll = () => {
    for (const record of detachTabRecords(tab.id, expenses)) onSaveExpense(record);
    setConfirming(null);
  };

  const remove = () => {
    const { tabs, deleted } = deleteTab(shareTabs, tab.id, expenses);
    if (!deleted) { setConfirming(null); return; }
    save(tabs);
    onClose?.();
  };

  const rowBtn = {
    display: 'flex', alignItems: 'center', gap: '7px', width: '100%',
    padding: '8px 10px', borderRadius: 'var(--radius-sm)', textAlign: 'left',
    background: 'var(--bg-card)', border: '1px solid var(--border-glass)',
    color: 'var(--text-secondary)', fontSize: '0.74rem', cursor: 'pointer',
  };

  return (
    <div style={{
      marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-glass)',
      display: 'flex', flexDirection: 'column', gap: '8px',
    }}>
      <div>
        <label style={{ fontSize: '0.64rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
          名字
        </label>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
            placeholder="例：房友共摊"
            style={{
              flex: 1, padding: '7px 10px', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
              color: 'white', fontSize: '0.78rem',
            }}
          />
          <button
            type="button"
            onClick={commitName}
            disabled={!name.trim() || name.trim() === tab.label}
            className="btn-secondary"
            style={{ padding: '7px 11px', fontSize: '0.72rem', opacity: (!name.trim() || name.trim() === tab.label) ? 0.45 : 1 }}
          >
            <Check size={13} /> 改名
          </button>
        </div>
      </div>

      <button type="button" onClick={toggleArchive} style={rowBtn}>
        <Pencil size={13} />
        {archived ? '拿回来用（现在是封存的）' : '封存 — 不再出现在记账的选单里'}
      </button>
      {/* The reassurance that makes 封存 usable instead of frightening. */}
      {!archived && held > 0 && (
        <p style={{ fontSize: '0.63rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          封存不会动里面的 {held} 笔 — 这个月的净额照算，等这个月过了卡片才收起来。
        </p>
      )}

      {/* DELETE. Blocked while anything points at the tab, and it says what to
          do about it rather than just greying out. */}
      {held === 0 ? (
        confirming === 'delete' ? (
          <div style={{ display: 'flex', gap: '6px' }}>
            <button type="button" onClick={() => setConfirming(null)} className="btn-secondary" style={{ flex: 1, padding: '7px', fontSize: '0.72rem' }}>
              <X size={13} /> 算了
            </button>
            <button
              type="button"
              onClick={remove}
              style={{
                flex: 1, padding: '7px', fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer',
                borderRadius: 'var(--radius-sm)', background: 'var(--color-accent-red)',
                border: 'none', color: 'white',
              }}
            >
              真的删掉
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming('delete')}
            style={{ ...rowBtn, color: 'var(--color-accent-red)' }}
          >
            <Trash2 size={13} /> 删掉这个共摊本
          </button>
        )
      ) : (
        <div>
          <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', margin: '0 0 6px', lineHeight: 1.5 }}>
            现在删不掉 — 里面还有 <strong style={{ color: 'var(--text-primary)' }}>{held} 笔</strong>（共 RM {heldTotal.toFixed(2)}）。
            删了的话这些钱会卡在一个不存在的本子底下，哪个总数都算不到它。
            想清空的话，先把它们放回普通开销。
          </p>
          {confirming === 'detach' ? (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button type="button" onClick={() => setConfirming(null)} className="btn-secondary" style={{ flex: 1, padding: '7px', fontSize: '0.72rem' }}>
                <X size={13} /> 算了
              </button>
              <button
                type="button"
                onClick={detachAll}
                style={{
                  flex: 1, padding: '7px', fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer',
                  borderRadius: 'var(--radius-sm)', background: 'var(--color-accent-amber)',
                  border: 'none', color: '#1a1a1a',
                }}
              >
                放回去（{held} 笔）
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming('detach')} style={rowBtn}>
              把这 {held} 笔放回普通开销
            </button>
          )}
          {confirming === 'detach' && (
            <p style={{ fontSize: '0.63rem', color: 'var(--color-accent-amber)', margin: '6px 0 0', lineHeight: 1.5 }}>
              放回去之后它们会各自算数 — 付出去的算消费，收到的算收入，不再合成一个净额。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
