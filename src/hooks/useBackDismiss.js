import { useEffect, useRef } from 'react';

/**
 * Lets an open overlay claim the Android back button.
 *
 * THE BUG THIS FIXES
 * `useAndroidBackButton` maps back onto `navigate(-1)`, which is right for
 * routes and wrong for anything floating on top of one. With the AI modal open,
 * pressing back changed the route UNDERNEATH the modal and left the modal
 * sitting there — so the button that everyone on Android uses to mean "close
 * this" instead silently moved the app somewhere else. The Life Hub sheet would
 * have had exactly the same problem, and a sheet you can't back out of is worse
 * than one that doesn't exist.
 *
 * A STACK, not a single handler: the Life Hub can be open with a modal on top
 * of it, and back must peel one layer at a time, topmost first. Registration
 * order is mount order, which for overlays is the same as stacking order.
 */
const dismissers = [];

/**
 * Fire the topmost overlay's dismiss, if there is one.
 * @returns {boolean} true when an overlay handled the press
 */
export function runTopDismiss() {
  const top = dismissers[dismissers.length - 1];
  if (!top) return false;
  try {
    top();
  } catch (e) {
    // A throwing dismisser must not leave back permanently swallowed — the
    // overlay is already broken, don't take navigation down with it.
    console.warn('Back dismisser failed', e);
    return false;
  }
  return true;
}

/**
 * @param {boolean} active     whether the overlay is currently showing
 * @param {Function} onDismiss what to do when back is pressed
 */
export function useBackDismiss(active, onDismiss) {
  // Kept in a ref so a handler that closes over fresh state doesn't have to
  // re-register (and re-order) the stack on every render.
  const handler = useRef(onDismiss);
  handler.current = onDismiss;

  useEffect(() => {
    if (!active) return undefined;
    const fn = () => handler.current?.();
    dismissers.push(fn);
    return () => {
      const i = dismissers.indexOf(fn);
      if (i >= 0) dismissers.splice(i, 1);
    };
  }, [active]);
}
