import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Radio, ShieldAlert, Check, HelpCircle, Trash2, Plus, X, Smartphone, RefreshCw, AlertTriangle,
} from '../utils/icons';
import { useLiveJSON, saveJSON } from '../utils/storage';
import { num } from '../utils/num';
import {
  isNativeAvailable, isStaleApk, getStatus, openPermissionSettings,
  startDiscovery, stopDiscovery, getDiscovered,
} from '../utils/tngNative';
import { merchantKey } from '../utils/tngParser';
import { CategorySelect } from './CategoryPicker';
import { defaultAccount, accountById, sameId, typeMeta } from '../utils/accounts';
import { dateStamp } from '../hooks/useTngCapture';
import { AccountSelect } from './AccountPicker';

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
  color: 'white', marginTop: '4px', fontSize: '0.8rem',
};

const ago = (ts) => {
  if (!ts) return null;
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
};

/**
 * Real notification capture: the reason the APK exists.
 *
 * WHAT THIS SCREEN IS FOR NOW
 * It used to be a small "permission granted ✓" strip, which is a claim, not
 * evidence — and when notifications silently stopped arriving (Android drops
 * listener bindings on app update and under memory pressure, leaving the
 * permission switch on) there was no way to tell from inside the app. So the
 * whole thing looked broken and the paste box looked like the real feature.
 *
 * This now reports the three facts that are actually different from each other:
 *   permission granted · listener connected · when something last arrived
 * and it can BIND OTHER APPS to accounts, because the user spends from more
 * than one wallet and every one of those payments was previously invisible.
 */
export default function TngAutoCapture({
  expenses, setExpenses, setLearned, accounts, setAccounts, onNeedPaste,
}) {
  const [status, setStatus] = useState(null);
  // Written by useTngCapture at the app root, displayed here. Two independent
  // usePersistentState instances for one key drift apart until one remounts —
  // and this component unmounts every time you leave the screen, which would
  // have it write a stale snapshot back over whatever was captured meanwhile.
  // See storage.js: multi-writer keys read live and write through saveJSON.
  const queue = useLiveJSON('tngReviewQueue', []);
  const setQueue = (next) => saveJSON('tngReviewQueue', next);
  // Last few captures with the verdict the parser gave them. This is the single
  // most useful thing for answering "why didn't my payment show up" — it
  // distinguishes "nothing arrived" from "it arrived and was read as a promo".
  const captureLog = useLiveJSON('tngCaptureLog', []);
  const [showLog, setShowLog] = useState(false);
  const [discovery, setDiscovery] = useState(null);
  const [bindTarget, setBindTarget] = useState(null);
  const [bindAccountId, setBindAccountId] = useState(null);

  const native = isNativeAvailable();
  const stale = isStaleApk();

  // Counted from today's expenses, not from a stored tally. The tally it
  // replaces was labelled "今天" but never reset, so it only ever grew — and a
  // count of things in a list should be a count of that list.
  const autoCount = useMemo(
    () => expenses.filter(e => e.source === '自动侦测').length,
    [expenses]
  );

  const refreshStatus = useCallback(async () => {
    if (!native) return;
    setStatus(await getStatus());
  }, [native]);

  useEffect(() => {
    if (!native) return;
    refreshStatus();
    // The permission is granted in system settings, so re-check on return.
    const onVisible = () => { if (!document.hidden) refreshStatus(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [native, refreshStatus]);

  // --- discovery ---------------------------------------------------------
  useEffect(() => {
    if (!discovery?.running) return;
    const poll = async () => {
      const found = await getDiscovered();
      setDiscovery(d => (d?.running ? { ...d, found } : d));
    };
    poll();
    const t = setInterval(poll, 4000);
    const stopAt = setTimeout(() => {
      stopDiscovery();
      setDiscovery(d => (d ? { ...d, running: false } : d));
    }, discovery.durationMs);
    return () => { clearInterval(t); clearTimeout(stopAt); };
  }, [discovery?.running, discovery?.durationMs]);

  const beginDiscovery = async () => {
    const durationMs = 5 * 60 * 1000;
    await startDiscovery(durationMs);
    setDiscovery({ running: true, durationMs, found: [], startedAt: Date.now() });
  };

  const endDiscovery = async () => {
    await stopDiscovery();
    setDiscovery(d => (d ? { ...d, running: false } : d));
  };

  const bindPackage = () => {
    if (!bindTarget || !bindAccountId) return;
    // Written through the same `accounts` key AccountsView owns — the package
    // list lives on the account, not in a separate mapping table, so backup,
    // sync and restore all carry it for free.
    // `balance` is derived on read (accounts.js) — writing the resolved copy
    // straight back would persist a stale number that then outranks the live
    // derivation on the next load.
    const next = accounts.map(({ balance: _b, spentSinceOpening: _s, ...a }) => (sameId(a.id, bindAccountId)
      ? { ...a, packages: [...new Set([...(a.packages ?? []), bindTarget.packageName])] }
      : a));
    setAccounts?.(next);
    setBindTarget(null);
    setBindAccountId(null);
  };

  // Running inside the Android shell but with no plugin compiled in — an APK
  // built before this feature existed. Silently rendering nothing would look
  // exactly like the feature being broken, which is the complaint this whole
  // rewrite exists to answer.
  if (stale) {
    return (
      <div className="glass-card" style={{ padding: '0.85rem 1rem', borderLeft: '3px solid var(--color-accent-red)' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '7px' }}>
          <AlertTriangle size={16} color="var(--color-accent-red)" /> 这个 APK 没有自动记账
        </div>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '7px', lineHeight: 1.5 }}>
          手机上装的是旧版 APK，里面还没有通知监听的部分，所以只能手动贴。
          重新装最新的 APK 就会自动记了。
        </p>
      </div>
    );
  }

  if (!native) return null;

  const updateItem = (id, patch) =>
    setQueue(queue.map(q => (q.id === id ? { ...q, ...patch } : q)));

  const confirmItem = (item) => {
    if (!item.note.trim()) return;
    const account = accountById(accounts, item.accountId);
    setExpenses([{
      id: item.id,
      merchant: item.merchant.trim() || 'Unknown merchant',
      amount: num(item.amount),
      category: item.category,
      note: item.note.trim(),
      accountId: item.accountId ?? null,
      paymentMethod: account?.name ?? '未指定户口',
      source: '自动侦测',
      time: item.time,
      // Same reason as the automatic path: an item can sit in this queue for
      // days, and it belongs to the day it was paid, not the day you got round
      // to saying what it was for. `id` is the notification's timestamp.
      ...dateStamp(item.id),
    }, ...expenses]);

    // A transfer's category says nothing reusable — the same person can be
    // dinner one week and rent the next.
    if (!item.isTransfer) {
      const key = merchantKey(item.merchant);
      if (key) setLearned(prev => ({ ...prev, [key]: item.category }));
    }
    setQueue(queue.filter(q => q.id !== item.id));
  };

  // Three separate facts, deliberately not collapsed into one boolean.
  const granted = status?.granted;
  const connected = status?.listenerConnected;
  const working = granted && connected;

  // Captures the phone accepted, minus the ones this side actually received,
  // minus the ones still waiting to be received. Anything left over went
  // missing between the two halves of the app — which is the failure that ran
  // silently for as long as nobody thought to compare these two numbers.
  // Skipped on an APK too old to report the second one, where 0 means
  // "not counted", not "not delivered".
  const lostCount = status && !status.legacy
    ? Math.max(0, (status.capturedTotal ?? 0) - (status.deliveredTotal ?? 0) - (status.pendingCount ?? 0))
    : 0;
  const tone = granted == null ? 'var(--text-muted)'
    : working ? 'var(--color-money)'
    : granted ? 'var(--color-diet)'
    : 'var(--color-accent-red)';

  return (
    <>
      {/* Headline status */}
      <div className="glass-card" style={{ padding: '0.9rem 1rem', borderLeft: `3px solid ${tone}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', minWidth: 0 }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: 'var(--radius-sm)', flexShrink: 0,
              background: `${working ? 'var(--color-money-soft)' : granted ? 'var(--color-diet-soft)' : 'var(--color-accent-red-soft)'}`,
              color: tone, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {working ? <Radio size={19} /> : <ShieldAlert size={19} />}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.88rem', fontWeight: '700' }}>自动记账</div>
              <span style={{ fontSize: '0.7rem', color: tone }}>
                {granted == null ? '检查中…'
                  : !granted ? '还没开通知权限 — 现在什么都收不到'
                  : !connected ? '权限开了，但系统还没连上 — 通常重开一次 app 就好'
                  : '开着 · 付款后会自己记，不用你贴'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <button onClick={refreshStatus} aria-label="重新检查" title="重新检查"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}>
              <RefreshCw size={14} />
            </button>
            {granted === false && (
              <button onClick={openPermissionSettings} className="btn-primary"
                style={{ padding: '0.45rem 0.8rem', fontSize: '0.74rem' }}>
                去开启
              </button>
            )}
          </div>
        </div>

        {/* Evidence, not a claim. Three separate facts, because they come apart. */}
        {granted && (
          <div style={{ display: 'flex', gap: '1.1rem', marginTop: '11px', flexWrap: 'wrap' }}>
            <Fact label="今天自动记录" value={`${autoCount} 笔`} />
            <Fact label="总共收到过" value={`${status?.capturedTotal ?? 0} 则通知`} />
            <Fact
              label="最后一则"
              value={status?.lastCapturedAt ? ago(status.lastCapturedAt) : '还没有'}
              tone={status?.lastCapturedAt ? undefined : 'var(--text-muted)'}
            />
            <Fact label="正在监听" value={`${status?.watched?.length ?? 0} 个 app`} />
          </div>
        )}

        {/* The check the app could not previously do on itself.
            The phone counts what it captured; this side counts what it received.
            When those disagreed there was no way to see it from inside the app —
            "7 则通知" sat happily next to an empty capture log and an empty
            expense list, and looked like everything was fine. Now the app says
            so itself instead of waiting to be asked. */}
        {lostCount > 0 && (
          <p style={{
            fontSize: '0.68rem', color: 'var(--color-accent-red)', marginTop: '10px',
            lineHeight: 1.5, display: 'flex', gap: '6px',
          }}>
            <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>
              手机收到 {status.capturedTotal} 则，app 只拿到 {status.deliveredTotal} 则 —
              有 <strong>{lostCount} 则</strong>在中间丢了。
              旧版本会这样（通知只在记账页开着时才收得到），装了这版之后这个数字就不会再涨。
              漏掉的那几笔要补的话，用下面的「手动贴一则」。
            </span>
          </p>
        )}

        {status?.pendingCount > 0 && (
          <p style={{ fontSize: '0.68rem', color: 'var(--color-diet)', marginTop: '8px', lineHeight: 1.5 }}>
            还有 {status.pendingCount} 则排着队还没处理 — 通常一两秒内就会自己进来。
          </p>
        )}

        {granted === false && (
          <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '10px', lineHeight: 1.5 }}>
            Android 规定这个开关只能你自己在系统设定里开 — 程式不能代开。
            按「去开启」会直接带你到那一页，找到 LifeManager 打开就好。
            只会读你绑定的那几个 app 的通知，其他一律不碰。
          </p>
        )}

        {granted && !connected && (
          <p style={{ fontSize: '0.68rem', color: 'var(--color-diet)', marginTop: '10px', lineHeight: 1.5 }}>
            Android 更新 app 或记忆体不够时会把监听断掉，权限却还是开着的 —
            看起来像正常，其实收不到东西。把 LifeManager 完全关掉重开通常就会自己接回来；
            还是不行就到系统设定里把开关关掉再打开一次。
          </p>
        )}

        {status?.legacy && (
          <p style={{ fontSize: '0.68rem', color: 'var(--color-diet)', marginTop: '10px', lineHeight: 1.5, display: 'flex', gap: '6px' }}>
            <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>手机上装的 APK 是旧版的，没有新的自我诊断功能。上面的数字可能显示不出来 — 重新装一次最新的 APK 就有了。</span>
          </p>
        )}

        {granted && status?.capturedTotal === 0 && (
          <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '10px', lineHeight: 1.5 }}>
            还没收到过任何通知。先用 TNG 付一笔小的（或叫朋友转你 RM1）测试一下 —
            通知一跳出来，这里的数字就会动。
          </p>
        )}

        <div style={{ display: 'flex', gap: '6px', marginTop: '11px', flexWrap: 'wrap' }}>
          <button onClick={() => setShowLog(v => !v)} className="btn-secondary"
            style={{ padding: '4px 10px', fontSize: '0.66rem' }}>
            {showLog ? '收起' : `侦测记录（${captureLog.length}）`}
          </button>
          <button onClick={beginDiscovery} className="btn-secondary"
            style={{ padding: '4px 10px', fontSize: '0.66rem' }}>
            <Plus size={11} /> 加银行 / 其他钱包
          </button>
          {onNeedPaste && (
            <button onClick={onNeedPaste} className="btn-secondary"
              style={{ padding: '4px 10px', fontSize: '0.66rem' }}>
              手动贴一则
            </button>
          )}
        </div>
      </div>

      {/* Capture log — proves whether something arrived AND how it was read. */}
      {showLog && (
        <div className="glass-card" style={{ padding: '0.8rem 0.9rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: '700' }}>侦测记录</span>
            {captureLog.length > 0 && (
              <button onClick={() => saveJSON('tngCaptureLog', [])} className="btn-secondary" style={{ padding: '3px 8px', fontSize: '0.62rem' }}>
                清空
              </button>
            )}
          </div>
          <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '9px', lineHeight: 1.5 }}>
            每一则收到的通知，连同 app 怎么判断它。看到「广告」或「看不懂」而其实是笔真的开销，
            就贴到手动读取器里，规则可以加。
          </p>
          {captureLog.length === 0 ? (
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '0.8rem' }}>
              还没收到过通知。
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '260px', overflowY: 'auto' }}>
              {captureLog.map(entry => {
                const verdict = {
                  spend: ['记成开销', 'var(--color-money)'],
                  income: ['进账 · 没算开销', 'var(--color-diet)'],
                  noise: ['广告 · 忽略', 'var(--text-muted)'],
                  unknown: ['看不懂 · 没记', 'var(--color-accent-red)'],
                }[entry.kind] ?? ['?', 'var(--text-muted)'];
                return (
                  <div key={entry.id} style={{
                    padding: '0.5rem 0.6rem', borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
                      <span style={{ fontSize: '0.66rem', fontWeight: '700', color: verdict[1] }}>{verdict[0]}</span>
                      <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                        {ago(entry.at)}{entry.accountName ? ` · ${entry.accountName}` : ''}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '3px', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                      {entry.raw}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Discovery — bind a bank or another wallet to an account */}
      {discovery && (
        <div className="glass-card" style={{ padding: '0.85rem 1rem', border: '1px solid var(--color-sports)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Smartphone size={15} color="var(--color-sports)" />
              {discovery.running ? '正在找…' : '找到这些 app'}
            </span>
            <button onClick={discovery.running ? endDiscovery : () => setDiscovery(null)}
              className="btn-secondary" style={{ padding: '3px 9px', fontSize: '0.64rem' }}>
              {discovery.running ? '停止' : '关掉'}
            </button>
          </div>
          <p style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '7px', lineHeight: 1.5 }}>
            接下来 5 分钟内，任何 app 只要跳出<strong>带 RM 金额</strong>的通知，
            这里就会列出它是哪个 app。用你的银行 app 转一笔小的、或等一则通知进来，
            然后把它绑到对应的户口 — 之后那个户口的开销也会自动记。
            <br />
            这样做是因为各家银行的 app 内部名称不能靠猜 — 猜错的话 app 会说「在监听你的 Maybank」，
            实际上什么都没听。让手机自己讲比较准。
          </p>

          {discovery.found?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
              {discovery.found.map(f => (
                <button
                  key={f.packageName}
                  type="button"
                  onClick={() => { setBindTarget(f); setBindAccountId(defaultAccount(accounts)?.id ?? null); }}
                  style={{
                    textAlign: 'left', padding: '0.55rem 0.7rem', borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
                    color: 'var(--text-primary)', cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: '0.78rem', fontWeight: '700' }}>{f.appLabel}</div>
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {f.packageName} · {f.count} 则
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginTop: '3px' }}>{f.sample}</div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '0.9rem' }}>
              {discovery.running ? '等一则通知进来…' : '这段时间没有收到带金额的通知。'}
            </div>
          )}
        </div>
      )}

      {/* Bind modal */}
      {bindTarget && (
        <div className="modal-overlay" onClick={() => setBindTarget(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: '700' }}>{bindTarget.appLabel} 是哪个户口?</h3>
              <button onClick={() => setBindTarget(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '0.9rem' }}>
              绑好之后，这个 app 的付款通知会自动记到那个户口底下，余额也会跟着扣。
            </p>
            <AccountSelect accounts={accounts} value={bindAccountId} onChange={setBindAccountId} style={inputStyle} />
            <div style={{ display: 'flex', gap: '10px', marginTop: '1.1rem' }}>
              <button onClick={() => setBindTarget(null)} className="btn-secondary" style={{ flex: 1 }}>取消</button>
              <button onClick={bindPackage} className="btn-primary" style={{ flex: 1 }} disabled={!bindAccountId}>绑定</button>
            </div>
          </div>
        </div>
      )}

      {/* Review queue — captured but not safe to log without a decision */}
      {queue.length > 0 && (
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '7px' }}>
            <HelpCircle size={17} color="var(--color-diet)" />
            待确认 ({queue.length})
          </h3>
          <p style={{ fontSize: '0.71rem', color: 'var(--text-muted)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
            这些侦测到金额，但看不出买了什么，所以没有自动记录。
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {queue.map(item => {
              const acc = accountById(accounts, item.accountId);
              return (
              <div key={item.id} className="glass-card" style={{
                padding: '0.85rem', border: '1px solid var(--color-diet)',
                background: 'var(--color-diet-soft)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.86rem', fontWeight: '700' }}>{item.merchant || '未知'}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {item.time}
                      {item.isTransfer ? ' · 汇款' : ''}
                      {/* An unread wording, not just an unread shop. Worth
                          saying out loud: these used to vanish into the capture
                          log, where an unrecognised real payment looked exactly
                          like no payment at all. */}
                      {item.unrecognised ? ' · 看不懂这则通知' : ''}
                      {acc && <> · 从 <span style={{ color: typeMeta(acc.type).color }}>{acc.name}</span> 扣</>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <span style={{ fontSize: '1rem', fontWeight: '800', color: 'var(--color-accent-red)' }}>
                      RM {num(item.amount).toFixed(2)}
                    </span>
                    <button onClick={() => setQueue(queue.filter(q => q.id !== item.id))}
                      aria-label="忽略" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* When the rules couldn't read the message, the message itself
                    is the only thing that can tell you what this was. */}
                {item.unrecognised && item.raw && (
                  <div style={{
                    fontSize: '0.66rem', color: 'var(--text-secondary)', marginTop: '8px',
                    padding: '0.45rem 0.55rem', borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-input)', lineHeight: 1.45, whiteSpace: 'pre-wrap',
                  }}>
                    {item.raw.slice(0, 160)}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>这笔是什么？</label>
                    <input
                      type="text"
                      value={item.note}
                      onChange={(e) => updateItem(item.id, { note: e.target.value })}
                      placeholder={item.isTransfer ? '例：分摊晚餐' : '例：手机壳'}
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ width: '38%' }}>
                    <label style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>分类</label>
                    {/* Always the expense list: this queue only ever holds
                        money that LEFT the wallet — an income notification is
                        logged and reported, never parked here for review. */}
                    <CategorySelect
                      txType="expense"
                      value={item.category}
                      onChange={(id) => updateItem(item.id, { category: id })}
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div style={{ marginTop: '8px' }}>
                  <label style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>从哪个户口出</label>
                  <AccountSelect
                    accounts={accounts}
                    value={item.accountId}
                    onChange={(id) => updateItem(item.id, { accountId: id })}
                    style={inputStyle}
                  />
                </div>

                <button
                  onClick={() => confirmItem(item)}
                  disabled={!item.note.trim()}
                  className="btn-primary"
                  style={{
                    width: '100%', marginTop: '10px', fontSize: '0.8rem', padding: '0.6rem',
                    opacity: item.note.trim() ? 1 : 0.45,
                    cursor: item.note.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  <Check size={15} /> {item.note.trim() ? '记录' : '先填这笔是什么'}
                </button>
              </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function Fact({ label, value, tone }) {
  return (
    <div>
      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: '0.8rem', fontWeight: '700', color: tone ?? 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
