import React, { useState, useEffect } from 'react';
import { Cloud, CloudOff, RefreshCw, AlertTriangle, Check, LogOut, Download } from '../utils/icons';
import { subscribe, signOutAndStop, pushNow, pullNow, getState } from '../utils/cloudSync';
import AuthForm from './AuthForm';

const fmt = (ms) => (ms ? new Date(ms).toLocaleString() : '—');

/**
 * Say what the last press actually did.
 *
 * A push with nothing to send used to return in silence, which looks exactly
 * like a push that failed — and for a long time it WAS one, so there was no way
 * to tell the two apart from the outside.
 */
function describeResult({ lastResult, status }) {
  if (!lastResult || status === 'pushing' || status === 'pulling') return null;
  if (lastResult.kind === 'push') {
    return lastResult.count ? `已上传 ${lastResult.count} 项` : '这台没有新变动，云端已经是最新的';
  }
  return lastResult.count ? `载入了 ${lastResult.count} 项` : '云端没有这台缺少的资料';
}

export default function SyncPanel() {
  const [sync, setSync] = useState(getState);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribe(setSync), []);

  // Firebase isn't set up — say so plainly rather than showing dead buttons.
  if (!sync.available) {
    return (
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-glass)',
        borderRadius: 'var(--radius-sm)', padding: '0.8rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '6px' }}>
          <CloudOff size={16} color="var(--text-muted)" />
          <span style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--text-secondary)' }}>
            云端同步：未设定
          </span>
        </div>
        <p style={{ fontSize: '0.71rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          填好 <code>.env.local</code>（照 <code>.env.example</code>）就会自动开启，
          手机和电脑就能同步。没设定也不影响使用，汇出汇入照样能用。
        </p>
      </div>
    );
  }

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch { /* surfaced through sync.error */ }
    setBusy(false);
  };

  /**
   * Send everything this device has, then read the whole cloud back — the
   * escape hatch for "the two don't match and I don't care why". Safe to press
   * at any time: both directions merge per record and per id, so neither copy
   * is thrown away. Push first, because a pull that finds changes reloads the
   * page and would never come back to the push.
   */
  const resyncEverything = async () => {
    await pushNow({ force: true });
    await pullNow({ force: true });
  };

  const result = describeResult(sync);

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${sync.remoteNewer ? 'var(--color-diet)' : 'var(--border-glass)'}`,
      borderRadius: 'var(--radius-sm)', padding: '0.8rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '8px' }}>
        <Cloud size={16} color={sync.user ? 'var(--color-money)' : 'var(--text-muted)'} />
        <span style={{ fontSize: '0.82rem', fontWeight: '700' }}>云端同步 Sync</span>
        {sync.user && (
          <span style={{ fontSize: '0.66rem', color: 'var(--color-money)', marginLeft: 'auto' }}>
            {sync.status === 'pushing' ? '上传中…' : sync.status === 'pulling' ? '下载中…' : '已连线'}
          </span>
        )}
      </div>

      {sync.error && (
        <div style={{
          background: 'var(--color-accent-red-soft)', border: '1px solid var(--color-accent-red)',
          borderRadius: 'var(--radius-sm)', padding: '0.55rem 0.65rem', marginBottom: '8px',
          display: 'flex', gap: '6px', alignItems: 'flex-start',
        }}>
          <AlertTriangle size={13} color="var(--color-accent-red)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <span style={{ fontSize: '0.7rem', lineHeight: 1.45 }}>{sync.error}</span>
        </div>
      )}

      {!sync.user ? (
        <>
          {/* The "same account on both devices" note lives in AuthForm, so it
              stays identical in both places it's shown — it used to be
              duplicated here, and the two copies rendered back to back. */}
          <AuthForm />
        </>
      ) : (
        <>
          <div style={{ fontSize: '0.71rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            {sync.user.email}
            <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>
              上次同步：{fmt(sync.lastSyncedAt)}
            </div>
          </div>

          {/* Never applied automatically — the user decides which copy wins. */}
          {sync.remoteNewer && (
            <div style={{
              background: 'var(--color-diet-soft)', border: '1px solid var(--color-diet)',
              borderRadius: 'var(--radius-sm)', padding: '0.7rem', marginBottom: '8px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
                <AlertTriangle size={14} color="var(--color-diet)" />
                <span style={{ fontSize: '0.76rem', fontWeight: '700', color: 'var(--color-diet)' }}>
                  云端有较新的资料
                </span>
              </div>
              <p style={{ fontSize: '0.69rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '8px' }}>
                来自 <strong>{sync.remoteNewer.deviceId}</strong>，
                {fmt(sync.remoteNewer.updatedAt)}。
                载入是逐笔合并 — 那边有、这台没有的补进来，同一笔以谁后改的为准，
                这台独有的不会消失。不确定的话，先汇出一份。
              </p>
              <div style={{ display: 'flex', gap: '7px' }}>
                <button onClick={() => run(pullNow)} disabled={busy} className="btn-primary" style={{ flex: 1, fontSize: '0.75rem', padding: '0.55rem' }}>
                  <Download size={14} /> 载入云端
                </button>
                <button onClick={() => run(() => pushNow({ force: true }))} disabled={busy} className="btn-secondary" style={{ flex: 1, fontSize: '0.75rem', padding: '0.55rem' }}>
                  用这台覆盖
                </button>
              </div>
            </div>
          )}

          {/* Both directions, always. 「立即上传」 only ever sends data AWAY from
              this device — it can never be what brings the other device's data
              here, and when the download button only appeared alongside the
              「云端有较新的资料」 banner, pressing upload over and over was the
              only thing left to try. The arrows say which way each one goes. */}
          <div style={{ display: 'flex', gap: '7px' }}>
            <button onClick={() => run(() => pushNow())} disabled={busy} className="btn-secondary" style={{ flex: 1, fontSize: '0.75rem', padding: '0.55rem', flexDirection: 'column', gap: '2px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                {sync.status === 'pushing' ? <RefreshCw size={14} /> : <Check size={14} />} 立即上传
              </span>
              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 400 }}>这台 → 云端</span>
            </button>
            <button onClick={() => run(() => pullNow())} disabled={busy} className="btn-secondary" style={{ flex: 1, fontSize: '0.75rem', padding: '0.55rem', flexDirection: 'column', gap: '2px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Download size={14} /> 载入云端
              </span>
              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 400 }}>云端 → 这台</span>
            </button>
          </div>

          {result && (
            <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '7px', textAlign: 'center' }}>
              {result}
            </div>
          )}

          <div style={{ display: 'flex', gap: '7px', marginTop: '7px' }}>
            <button onClick={() => run(resyncEverything)} disabled={busy} className="btn-secondary" style={{ flex: 1, fontSize: '0.72rem', padding: '0.5rem' }}>
              <RefreshCw size={13} /> 全部重新同步
            </button>
            <button onClick={() => run(signOutAndStop)} disabled={busy} className="btn-secondary" style={{ flex: 1, fontSize: '0.72rem', padding: '0.5rem' }}>
              <LogOut size={13} /> 登出
            </button>
          </div>
          <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '7px', lineHeight: 1.5 }}>
            改动会自动上传，但载入要自己按 — 另一台的资料不会自己跑过来。
            两边都对不上的话按「全部重新同步」，它会把两边完整对一次。
          </p>
        </>
      )}
    </div>
  );
}
