import { useEffect, useRef } from 'react';
import { getTodayString, loadJSON, saveJSON, useLiveJSON } from '../utils/storage';
import {
  isNativeAvailable, subscribeToNotifications,
  setWatchedPackages as pushWatchedPackages,
} from '../utils/tngNative';
import { parseTngNotification } from '../utils/tngParser';
import { FALLBACK_EXPENSE_CATEGORY } from '../utils/moneyCategories';
import {
  accountForPackage, defaultAccount, ensureAccounts, watchedPackages,
} from '../utils/accounts';
import { nowTimeStr } from '../utils/datetime.js';

/**
 * Turns captured phone notifications into expenses. Mounted at the app root.
 *
 * WHY THIS IS A ROOT-LEVEL HOOK AND NOT PART OF THE MONEY SCREEN
 * It used to live inside the auto-capture card, which renders only on Money →
 * 今天. So the app could only record a payment if that one screen happened to
 * be on display at the instant the notification arrived — and it almost never
 * was, because you are looking at your wallet app when you pay, not at this
 * one. Everything else was dropped without a trace: the native capture counter
 * went up, the expense list stayed empty, and nothing anywhere said why.
 *
 * Capture is a background fact about the phone, not a feature of one screen, so
 * it is wired up once, for as long as the app is open, wherever the user is.
 *
 * The card that used to own this is now purely the UI for it — it displays the
 * queue and the log this writes, and can be closed or never visited without
 * costing you a transaction.
 */

const CAPTURE_LOG_LIMIT = 25;
const REVIEW_QUEUE_LIMIT = 50;

/** Fired after an expense is logged automatically, so a visible screen can say so. */
export const TNG_LOGGED_EVENT = 'lifemanager:tng-logged';

/**
 * The day a capture belongs to, taken from when the phone posted it.
 *
 * A row with no `date` is stamped with today's on the way into storage. That was
 * fine when a notification could only be recorded as it arrived; now that the
 * queue survives the app being closed, a capture can be days old by the time it
 * is read, and dating it "today" would move real spending onto the wrong day and
 * against the wrong daily cap.
 */
export function dateStamp(at) {
  const when = new Date(at);
  if (!Number.isFinite(when.getTime())) return {};
  return { date: getTodayString(when), at };
}

function processCapture(payload, ctx) {
  const { setExpenses } = ctx;
  const accounts = ensureAccounts(ctx.rawAccounts);
  const parsed = parseTngNotification(payload.raw, ctx.learned);
  const account = accountForPackage(accounts, payload.packageName) ?? defaultAccount(accounts);
  const at = payload.postedAt || Date.now();
  const time = nowTimeStr(new Date(at));

  // Read-modify-write straight through storage rather than from a React
  // snapshot: several captures can arrive in one drain, and a stale closure
  // would have each of them overwrite the one before.
  const log = loadJSON('tngCaptureLog', []);

  // Android re-posts a notification when it updates one (TNG does this), and the
  // same capture would then be queued twice with an identical timestamp. The
  // log is the record of what has already been handled, so it is also the
  // cheapest possible guard against paying attention to it twice.
  if (log.some(entry => entry.id === at)) return;

  // Every capture is logged with its verdict, INCLUDING the ones deliberately
  // dropped. "It arrived and I ignored it because it reads as a promo" is a
  // completely different answer from "nothing arrived", and the user can only
  // tell them apart if both are visible.
  saveJSON('tngCaptureLog', [{
    id: at,
    at,
    raw: (payload.raw ?? '').slice(0, 220),
    kind: parsed.kind,
    amount: parsed.amount,
    merchant: parsed.merchant,
    packageName: payload.packageName ?? null,
    accountName: account?.name ?? null,
  }, ...log].slice(0, CAPTURE_LOG_LIMIT));

  const queueItem = (extra) => {
    const queue = loadJSON('tngReviewQueue', []);
    saveJSON('tngReviewQueue', [{
      id: at,
      raw: payload.raw,
      merchant: parsed.merchant || '',
      amount: parsed.amount,
      category: parsed.category || FALLBACK_EXPENSE_CATEGORY,
      isTransfer: parsed.isTransfer,
      reason: parsed.reason,
      accountId: account?.id ?? null,
      note: '',
      time,
      ...extra,
    }, ...queue].slice(0, REVIEW_QUEUE_LIMIT));
  };

  // Money left the wallet but the parser could not read WHAT it bought.
  if (parsed.kind === 'spend' && parsed.amount && parsed.needsPurpose) {
    queueItem();
    return;
  }

  // Not recognised at all, but there is an amount in it. This used to stop
  // here, at the capture log, which is behind a button most people never press
  // — so an unrecognised real payment was indistinguishable from no payment.
  // A wording the rules have not learned yet is a reason to ASK, not to
  // silently drop money: it goes in the same queue, flagged as unread.
  if (parsed.kind === 'unknown' && parsed.amount) {
    queueItem({ unrecognised: true, category: FALLBACK_EXPENSE_CATEGORY });
    return;
  }

  // Everything else — income, marketing, points — is recorded above and stops.
  if (parsed.kind !== 'spend' || !parsed.amount) return;

  setExpenses(prev => [{
    id: at,
    merchant: parsed.merchant || 'Unknown merchant',
    amount: parsed.amount,
    category: parsed.category,
    note: '',
    accountId: account?.id ?? null,
    paymentMethod: account?.name ?? '未指定户口',
    source: '自动侦测',
    // A captured payment is a purchase until told otherwise. Marking it as a
    // fixed monthly bill happens by opening it in 记账 and choosing one, which
    // rewrites this and links it to the allocation — the capture itself stays
    // untouched, which is what the user asked for ("自动记账不要过度修改").
    type: 'expense',
    time,
    // Dated from when the payment happened, not from when the app got round to
    // reading it. Undated rows are stamped "today" on the way in, which was
    // harmless while nothing survived the app closing — now that the queue does
    // survive, opening the app after a two-day gap would otherwise dump two
    // days of spending onto today and blow the daily cap for no reason.
    ...dateStamp(at),
  }, ...prev]);

  window.dispatchEvent(new CustomEvent(TNG_LOGGED_EVENT, {
    detail: { amount: parsed.amount, merchant: parsed.merchant, accountName: account?.name ?? null },
  }));
}

export function useTngCapture({ setExpenses }) {
  const native = isNativeAvailable();
  const rawAccounts = useLiveJSON('accounts', []);
  const learned = useLiveJSON('merchantCategories', {});

  // The handler needs today's accounts and learned categories, but
  // re-subscribing whenever either changes would tear the listener down and
  // could drop a notification mid-flight. A ref hands it current values without
  // re-running the effect.
  const live = useRef(null);
  live.current = { rawAccounts, learned, setExpenses };

  // Keep the native watch list in step with which packages the accounts claim.
  // Pushed on every change rather than once at startup: binding a bank to an
  // account has to take effect immediately, not after the next app restart.
  useEffect(() => {
    if (!native) return;
    pushWatchedPackages(watchedPackages(ensureAccounts(rawAccounts)));
  }, [native, rawAccounts]);

  useEffect(() => {
    if (!native) return undefined;
    return subscribeToNotifications((payload) => {
      try {
        processCapture(payload, live.current);
      } catch (e) {
        // A single malformed capture must not kill the subscription and take
        // every later payment down with it.
        console.warn('TNG capture failed', e);
      }
    });
  }, [native]);
}
