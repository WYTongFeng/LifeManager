import React, { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { StickyNote, Sparkles, Bell, Star } from '../utils/icons';
import { useBackDismiss } from '../hooks/useBackDismiss';

/**
 * The centre button's four actions.
 *
 * DELIBERATELY NOT A PAGE. The whole reason this exists is that opening a
 * separate app to jot one line is too many steps — so putting a "Quick Add"
 * screen in between would rebuild the exact problem it's meant to remove. Each
 * tile goes STRAIGHT to the thing: tap 📝 and you are in a note.
 *
 * Four, and only four. A launcher with eleven shortcuts is a menu, and a menu
 * is something you have to read before you can act.
 */
const ACTIONS = [
  {
    key: 'notes',
    to: '/notes/new',
    Icon: StickyNote,
    emoji: '📝',
    label: '记事本',
    hint: '快速写点东西',
    color: 'var(--color-notes)',
    soft: 'var(--color-notes-soft)',
  },
  {
    key: 'ai',
    // The only one that isn't a route: it hands your data to the clipboard for
    // whichever AI chat you use, over whatever you were looking at. Making it a
    // page would put a screen in front of a two-tap action.
    modal: 'ai',
    Icon: Sparkles,
    emoji: '🤖',
    label: '问 AI',
    hint: '复制数据去问',
    color: 'var(--accent)',
    soft: 'var(--accent-soft)',
  },
  {
    key: 'reminder',
    to: '/reminders/new',
    Icon: Bell,
    emoji: '🔔',
    label: '提醒',
    hint: '叫我去做某件事',
    color: 'var(--color-remind)',
    soft: 'var(--color-remind-soft)',
  },
  {
    key: 'special',
    to: '/special/new',
    Icon: Star,
    emoji: '⭐',
    label: '特别的日子',
    hint: '生日 · 纪念日',
    color: 'var(--color-special)',
    soft: 'var(--color-special-soft)',
  },
];

export default function LifeHub({ open, onClose, onOpenExport }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Android back closes the sheet instead of navigating the page underneath it.
  useBackDismiss(open, onClose);

  // The nav bar stays tappable above the backdrop (see index.css), so a tab can
  // still be tapped while this is open. Closing on any route change is what
  // keeps the sheet from being left hanging over a screen it didn't launch.
  //
  // Compared against the route the sheet OPENED on, not just "did this effect
  // run": the effect also runs on the render that opens it, and closing there
  // would make the button do nothing at all.
  const openedOn = useRef(location.pathname);
  useEffect(() => {
    if (!open) {
      openedOn.current = location.pathname;
    } else if (location.pathname !== openedOn.current) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, open]);

  if (!open) return null;

  const run = (action) => {
    // Closed FIRST, so the sheet is already gone as the new screen animates in
    // rather than fading out on top of it.
    onClose();
    if (action.modal === 'ai') onOpenExport();
    else navigate(action.to);
  };

  return (
    <>
      <div className="life-hub-backdrop" onClick={onClose} />

      <div className="life-hub-sheet" role="menu" aria-label="Life Hub">
        <div className="life-hub-grid">
          {ACTIONS.map((action, i) => (
            <button
              key={action.key}
              className="life-hub-tile"
              role="menuitem"
              onClick={() => run(action)}
              // Staggered so the four read as one thing unfolding rather than
              // four things appearing at once.
              style={{ animationDelay: `${i * 40}ms`, borderColor: action.soft }}
            >
              <span className="life-hub-emoji" style={{ background: action.soft, color: action.color }}>
                <action.Icon size={20} />
              </span>
              <span className="life-hub-label" style={{ color: action.color }}>{action.label}</span>
              <span className="life-hub-hint">{action.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
