import React, { useState, useEffect } from 'react';
import { Bell, Sparkles, ShieldCheck, AlertTriangle, Download } from '../utils/icons';
import BackupModal from './BackupModal';
import { daysSinceBackup } from '../utils/backup';
import { subscribe, getState } from '../utils/cloudSync';

export default function Header({ onOpenAi, alerts = [] }) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);

  // Nagging is the point: this data exists in exactly one browser until it has
  // been exported at least once.
  //
  // But it has to STOP nagging once you've done it. This was read once per
  // mount and never again, and Header never unmounts (it sits outside the
  // routed area), so exporting from the sheet below left "只存在这台 — 按我备份"
  // sitting there in warning orange for the rest of the session. Acting on a
  // warning and having it ignore you is how a user learns to ignore it back.
  const readStale = () => {
    const days = daysSinceBackup();
    return days === null || days > 7;
  };
  const [staleBackup, setStaleBackup] = useState(readStale);
  // Re-checked when the sheet closes — the export button lives inside it, and
  // that's the only thing that can change the answer.
  const closeBackup = () => { setBackupOpen(false); setStaleBackup(readStale()); };

  // The recognised account, visible on every tab (Header persists across tab
  // switches) — not just on Overview where the greeting lives.
  const [sync, setSync] = useState(getState);
  useEffect(() => subscribe(setSync), []);

  return (
    <>
      {/* Main App Top Header */}
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '0px',
            background: 'var(--accent)',
            border: '2px solid #000',
            boxShadow: '2px 2px 0 #000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '800',
            fontSize: '0.85rem',
            fontFamily: 'var(--font-pixel-retro)',
            color: 'var(--accent-ink)'
          }}>
            LM
          </div>
          <div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: '700', margin: 0, letterSpacing: '0.02em' }}>LifeManager</h2>
            {/* Data waiting on the other device outranks the backup nag: it is
                the one state where something is sitting in the cloud that this
                device does not have. Without it the only hint lived inside the
                backup modal, which is not a place you open unprompted — so a
                phone could sit for weeks missing everything typed on the PC and
                say 已连线 the whole time. */}
            <button
              onClick={() => setBackupOpen(true)}
              title={sync.remoteNewer ? '云端有这台没有的资料 — 按我载入' : '备份 / 汇入资料'}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: '0.7rem',
                color: sync.remoteNewer ? 'var(--color-money)'
                  : staleBackup ? 'var(--color-diet)' : 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}
            >
              {sync.remoteNewer
                ? <><Download size={11} /> 另一台有新资料 — 按我载入</>
                : staleBackup
                  ? <><AlertTriangle size={11} /> 只存在这台 — 按我备份</>
                  : <><ShieldCheck size={11} color="var(--color-money)" /> Saved on this device only</>}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {sync.user && (
            <button
              onClick={() => setBackupOpen(true)}
              title={`已登入 · ${sync.user.email}`}
              aria-label={`Signed in as ${sync.user.email}`}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {sync.user.photoURL ? (
                <img
                  src={sync.user.photoURL} alt="" referrerPolicy="no-referrer"
                  style={{ width: '32px', height: '32px', borderRadius: '50%', border: '1px solid var(--border-strong)' }}
                />
              ) : (
                <span style={{
                  width: '32px', height: '32px', borderRadius: '50%',
                  background: 'var(--color-money-soft)', color: 'var(--color-money)',
                  border: '1px solid var(--color-money)', fontSize: '0.75rem', fontWeight: '800',
                  fontFamily: 'var(--font-pixel-retro)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {(sync.user.name || sync.user.email || '?').charAt(0).toUpperCase()}
                </span>
              )}
            </button>
          )}
          <button
            onClick={onOpenAi}
            style={{
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent)',
              color: 'var(--accent)',
              padding: '4px 8px',
              borderRadius: '0px',
              fontSize: '0.68rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              boxShadow: '1px 1px 0 #000'
            }}
          >
            <Sparkles size={13} /> AI Coach
          </button>

          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setNotifOpen(!notifOpen)}
              style={{
                background: notifOpen ? 'var(--accent-soft)' : 'var(--bg-card)',
                border: notifOpen ? '1px solid var(--accent)' : '1px solid var(--border-glass)',
                color: 'var(--text-primary)',
                width: '32px',
                height: '32px',
                borderRadius: '0px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '1px 1px 0 #000'
              }}
            >
              <Bell size={15} />
              {alerts.length > 0 && (
                <span style={{
                  position: 'absolute', top: '-2px', right: '-2px',
                  minWidth: '14px', height: '14px', padding: '0 3px',
                  borderRadius: '0px', background: 'var(--color-accent-red)',
                  color: 'white', fontSize: '0.55rem', fontWeight: '800',
                  fontFamily: 'var(--font-pixel-retro)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid #000'
                }}>
                  {alerts.length}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="notif-dropdown">
                <p style={{ fontSize: '0.8rem', fontWeight: '700', marginBottom: '6px' }}>Notifications</p>
                {alerts.length === 0 ? (
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    Nothing right now. You'll see alerts here when you pass your calorie limit or
                    daily budget, or when a rest timer finishes.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {alerts.map(a => (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '7px' }}>
                        <span style={{
                          marginTop: '5px', flexShrink: 0,
                          width: '6px', height: '6px', borderRadius: '50%',
                          background: a.tone === 'bad' ? 'var(--color-accent-red)'
                            : a.tone === 'warn' ? 'var(--color-diet)' : 'var(--color-money)'
                        }}></span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                          {a.text}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {backupOpen && <BackupModal onClose={closeBackup} />}
    </>
  );
}
