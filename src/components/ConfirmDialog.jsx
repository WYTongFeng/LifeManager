import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, AlertTriangle } from '../utils/icons';
import { useBackDismiss } from '../hooks/useBackDismiss';

/**
 * The one "are you sure" in the app.
 *
 * WHY THIS EXISTS
 * 「里面很多 delete 没有确认的啊可以直接 delete 我每次按错」 (2026-09-25).
 * Every trash icon in the app deleted on the first tap, and most of them sit
 * right next to something you tap all the time — a row you open to edit, an
 * 已付 tick. The one screen that did ask (共摊本) had its own inline two-button
 * row, so even the fix was per-screen and looked different each time.
 *
 * HOW TO USE IT
 *   const ok = await confirmDelete({ title: '删掉这笔欠款？', subject: {...} });
 *   if (ok) remove(id);
 *
 * Imperative on purpose, not a hook: half the trash icons live in small row
 * components several levels below any state, and a promise lets a call site
 * stay one line instead of growing a `pendingDelete` state per screen.
 *
 * WHAT MAKES IT HARD TO HIT BY ACCIDENT
 *   · Centred, not where the trash icon was — a double tap can't land on it.
 *   · The red button arms after ARM_MS; a tap before that does nothing. The
 *     fill sweeping across it is that delay, made visible.
 *   · 算了 has focus, Escape / Android back / tapping outside all cancel.
 *     Enter is deliberately NOT bound to confirm.
 *
 * Rendered through a portal into <body>: an ancestor with a transform turns
 * `position: fixed` into "fixed to that ancestor" (see index.css's
 * .tab-page-transition note), and a confirm that opens off-screen is worse
 * than none.
 */

const ARM_MS = 420;
const EXIT_MS = 160;

let pending = null; // { opts, resolve, key }
const listeners = new Set();
const emit = () => listeners.forEach(l => l());
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => pending;

/**
 * Ask before doing something. Resolves true only on an explicit confirm.
 *
 * @param {object}  opts
 * @param {string}  opts.title          the question — 「删掉这笔欠款？」
 * @param {{label: string, meta?: string, amount?: string}} [opts.subject]
 *                                      WHAT is about to go, so a wrong row is
 *                                      caught here rather than after
 * @param {React.ReactNode} [opts.body] consequences worth knowing first
 * @param {string}  [opts.confirmLabel] default 删掉
 * @param {string}  [opts.cancelLabel]  default 算了
 * @param {'danger'|'warn'} [opts.tone] red for deletes, amber for undoable changes
 * @param {boolean} [opts.irreversible] show 「删了就找不回来」; default: tone === 'danger'
 * @returns {Promise<boolean>}
 */
export function confirmAction(opts = {}) {
  return new Promise((resolve) => {
    // A second request while one is open replaces it — the first caller hears
    // "no", which is the only safe answer to a question nobody finished.
    if (pending) pending.resolve(false);
    pending = { opts, resolve, key: `${Date.now()}:${Math.random()}` };
    emit();
  });
}

/** confirmAction with delete defaults. The common case by far. */
export function confirmDelete(opts = {}) {
  return confirmAction({ tone: 'danger', confirmLabel: '删掉', ...opts });
}

function settle(result) {
  if (!pending) return;
  const { resolve } = pending;
  pending = null;
  emit();
  resolve(result);
}

/** Mount once, near the root. Renders nothing until something asks. */
export function ConfirmHost() {
  const live = useSyncExternalStore(subscribe, snapshot, snapshot);
  // The last request stays on screen for EXIT_MS after it settles, so the
  // dialog fades out instead of vanishing mid-tap.
  const [shown, setShown] = useState(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (live) {
      setShown(live);
      setLeaving(false);
      return undefined;
    }
    if (!shown) return undefined;
    setLeaving(true);
    const t = setTimeout(() => { setShown(null); setLeaving(false); }, EXIT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  useBackDismiss(!!live, () => settle(false));

  if (!shown || typeof document === 'undefined') return null;
  return createPortal(
    <ConfirmCard key={shown.key} opts={shown.opts} leaving={leaving} />,
    document.body,
  );
}

function ConfirmCard({ opts, leaving }) {
  const {
    title = '确定吗？',
    subject = null,
    body = null,
    confirmLabel = '确定',
    cancelLabel = '算了',
    tone = 'danger',
  } = opts;
  const irreversible = opts.irreversible ?? tone === 'danger';
  const Icon = opts.icon ?? (tone === 'danger' ? Trash2 : AlertTriangle);

  const [armed, setArmed] = useState(false);
  const cancelRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setArmed(true), ARM_MS);
    cancelRef.current?.focus({ preventScroll: true });
    const onKey = (e) => { if (e.key === 'Escape') settle(false); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, []);

  return (
    <div
      className={`confirm-overlay${leaving ? ' leaving' : ''}`}
      onClick={() => settle(false)}
      role="presentation"
    >
      <div
        className={`confirm-card tone-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-icon"><Icon size={24} /></div>

        <h3 id="confirm-title" className="confirm-title">{title}</h3>

        {subject && (
          <div className="confirm-subject">
            <div style={{ minWidth: 0 }}>
              <div className="confirm-subject-label">{subject.label}</div>
              {subject.meta && <div className="confirm-subject-meta">{subject.meta}</div>}
            </div>
            {subject.amount && <div className="confirm-subject-amount">{subject.amount}</div>}
          </div>
        )}

        {body && <div className="confirm-body">{body}</div>}

        {irreversible && (
          <div className="confirm-warning">
            <AlertTriangle size={12} /> 删了就找不回来了
          </div>
        )}

        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="btn-secondary" onClick={() => settle(false)}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-go${armed ? ' armed' : ''}`}
            // Not `disabled`: a disabled button swallows the tap silently and
            // reads as broken. This one just ignores it until armed.
            aria-disabled={!armed}
            onClick={() => { if (armed) settle(true); }}
          >
            <span className="confirm-go-fill" style={{ animationDuration: `${ARM_MS}ms` }} />
            <span className="confirm-go-label">{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
