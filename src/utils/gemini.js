// Shared Gemini client for every AI feature in the app.
//
// One place owns the key, the model, and — most importantly — the daily spend
// cap. The coach and the food estimator draw from the SAME budget: two separate
// caps would quietly double the ceiling the user thought they set.
//
// The key ships inside the built app (client-side call, no backend proxy — the
// user explicitly chose not to pay for Firebase Functions). Leave
// VITE_GEMINI_API_KEY unset and every AI feature degrades to its offline path
// rather than erroring — same pattern as isFirebaseConfigured().

import { getTodayString } from './storage.js';
import { ENV } from './env.js';

/**
 * Which model to call.
 *
 * Overridable via `VITE_GEMINI_MODEL` rather than being a bare constant,
 * because this is the one setting in the app whose correctness has an expiry
 * date that nobody here controls: Google retires model ids on its own schedule,
 * and when this one goes the failure is total — every AI feature (coach, text
 * estimate, photo estimate) dies at once, on a device that may be months
 * behind the source. Being able to fix that by rebuilding with one env var,
 * instead of editing source, is the difference between a five-minute fix and
 * being stuck. `describeError` below spells the same thing out on screen.
 */
const MODEL = ENV.VITE_GEMINI_MODEL || 'gemini-3.5-flash-lite';

// Hard daily cap on real API calls. This is the budget guard: even if a bug
// loops, or this build ends up on a friend's phone, spend stops here.
export const DAILY_CALL_LIMIT = 40;

// Without this a slow or wedged API leaves the UI on "思考中…" forever, with no
// error and no way back — observed in testing when Gemini stopped responding
// mid-session. Fail loudly after 30s instead so the caller can fall back.
const REQUEST_TIMEOUT_MS = 30_000;

// Raw localStorage, deliberately un-prefixed and unsynced: this is a per-device
// spend counter, not user data. Syncing it would let one device's usage lock
// out another, and it has no place in a backup.
const CALL_LOG_KEY = 'ai_call_log';

export function isAiConfigured() {
  return Boolean(ENV.VITE_GEMINI_API_KEY);
}

export function getCallsUsedToday() {
  try {
    const log = JSON.parse(localStorage.getItem(CALL_LOG_KEY) || '{}');
    // getTodayString() is local-calendar, not toISOString()/UTC — at UTC+8 the
    // latter would roll the quota over at 8am local instead of midnight.
    return log.date === getTodayString() ? log.count : 0;
  } catch {
    return 0;
  }
}

export function getCallsRemainingToday() {
  return Math.max(0, DAILY_CALL_LIMIT - getCallsUsedToday());
}

export function isDailyBudgetExhausted() {
  return getCallsUsedToday() >= DAILY_CALL_LIMIT;
}

function setCallCount(count) {
  try {
    localStorage.setItem(CALL_LOG_KEY, JSON.stringify({ date: getTodayString(), count: Math.max(0, count) }));
  } catch {
    // A full/blocked localStorage must not take the feature down with it; the
    // worst case is an uncounted call, which the server-side key limits catch.
  }
}

function recordCall() {
  setCallCount(getCallsUsedToday() + 1);
}

/**
 * Give the quota back for a request that never reached the model.
 *
 * The cap counts ATTEMPTS on purpose (a retry loop must not run free), but that
 * makes a misconfiguration eat the entire day: a wrong model id or a rejected
 * key returns instantly, so a few frustrated taps burn all 40 and the app then
 * says "今天的额度已用完" — which is false, and sends you off debugging quota
 * instead of the actual problem. These specific failures are refunded because
 * Google rejected them before any inference happened, so they genuinely cost
 * nothing upstream.
 */
function refundCall() {
  setCallCount(getCallsUsedToday() - 1);
}

/**
 * One Gemini generateContent call.
 *
 * @param {object} opts
 * @param {Array} opts.contents      - Gemini `contents` array (roles + parts)
 * @param {string} [opts.system]     - system instruction text
 * @param {number} [opts.maxOutputTokens]
 * @param {boolean} [opts.json]      - ask for a JSON-only response
 * @returns {Promise<string>} the model's text output
 */
export async function callGemini({ contents, system, maxOutputTokens = 300, json = false }) {
  if (!isAiConfigured()) throw new Error('AI 未设置：缺少 API key');
  if (isDailyBudgetExhausted()) {
    throw new Error(`今天的 ${DAILY_CALL_LIMIT} 次 AI 额度已用完`);
  }

  // Count the attempt, not just successes — a failed call still costs quota
  // upstream, and counting only successes would let a retry loop run free.
  recordCall();

  const generationConfig = { maxOutputTokens };
  if (json) generationConfig.responseMimeType = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${ENV.VITE_GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents,
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig,
        }),
        signal: controller.signal,
      }
    );
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('AI 没有响应（超过 30 秒），请稍后再试');
    throw new Error(`连不上 AI：${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // 429 is the one the user will actually hit, and "quota exceeded" in raw
    // JSON tells them nothing about what to do next.
    //
    // Google returns RESOURCE_EXHAUSTED for two completely different problems,
    // and the advice for one is useless for the other:
    //   · rate limited      — too many calls too fast. Waiting DOES fix it.
    //   · credits depleted  — the billing account is empty. Waiting fixes
    //                         nothing, ever, and 「等一下再问」 sends you off to
    //                         retry forever against a wall.
    // Only the body can tell them apart, so it decides the message.
    //
    // Refunded either way. The call never reached the model, and not refunding
    // meant a depleted balance ALSO silently ate the 40-a-day local budget —
    // one dead account turning into two separate lockouts.
    if (res.status === 429) {
      refundCall();
      throw new Error(/deplet|billing|prepay/i.test(body)
        ? 'Gemini 的余额用完了 — 到 ai.studio/projects 充值或开 billing。这不是等一下就会好的。'
        : 'AI 太频繁被限流了，等一下再问');
    }
    // 404 on this endpoint means the MODEL id no longer exists — Google retires
    // them, and an app in the field can't know that. Without naming it, this
    // arrived as `AI 请求失败 (404)` plus a wall of JSON, which reads like a
    // network problem and sends you looking in the wrong place entirely.
    if (res.status === 404) {
      refundCall();
      throw new Error(`AI 模型「${MODEL}」不存在或已下架 — 在 .env.local 设 VITE_GEMINI_MODEL 换一个再重新 build。`);
    }
    // 401/403 is the key: missing, wrong, restricted to another domain, or the
    // Generative Language API simply not enabled on the project.
    if (res.status === 401 || res.status === 403) {
      refundCall();
      throw new Error('AI 的 API key 被拒绝了 — 检查 VITE_GEMINI_API_KEY，以及该 key 有没有开 Generative Language API。');
    }
    throw new Error(`AI 请求失败 (${res.status})：${body.slice(0, 160)}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text).filter(Boolean).join('');

  if (!text) {
    // A thinking model can burn the whole output budget before writing a word;
    // that comes back as MAX_TOKENS with no parts, which is not "empty reply".
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new Error('AI 回复被长度限制截断了，请换个更具体的问题');
    }
    throw new Error('AI 返回了空回复');
  }
  return text;
}
