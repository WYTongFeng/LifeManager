import React, { useState, useRef } from 'react';
import { X, Download, Upload, AlertTriangle, ShieldCheck, Check, Copy } from '../utils/icons';
import {
  buildBackup, summarise, downloadBackup,
  validateBackup, restoreBackup, daysSinceBackup,
} from '../utils/backup';
import SyncPanel from './SyncPanel';
import TextExportModal from './TextExportModal';
import { UpdateStatus } from './UpdateBanner';

const ROWS = [
  ['accounts', '户口 Accounts'],
  ['debts', '欠款 Debts'],
  ['expenses', '今日开销 Expenses'],
  ['meals', '今日餐食 Meals'],
  ['workouts', '今日组数 Sets'],
  ['historyDays', '历史天数 History'],
];

export default function BackupModal({ onClose }) {
  const [current] = useState(() => summarise(buildBackup()));
  const [lastBackup] = useState(() => daysSinceBackup());
  const [exported, setExported] = useState(false);
  const [textExport, setTextExport] = useState(false);
  const [pending, setPending] = useState(null);   // validated backup awaiting confirm
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const handleExport = () => {
    downloadBackup();
    setExported(true);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file twice still fires a change event.
    e.target.value = '';
    if (!file) return;

    setError('');
    setPending(null);

    const text = await file.text();
    const result = validateBackup(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPending(result.backup);
  };

  const handleRestore = () => {
    restoreBackup(pending);
    // Every module reads localStorage through useState initialisers, so a
    // reload is the only way to make the restored data actually take effect.
    window.location.reload();
  };

  const incoming = pending ? summarise(pending) : null;

  // Rendered instead of the backup sheet rather than on top of it — two stacked
  // modal overlays on a phone leaves no visible way back to the first.
  if (textExport) return <TextExportModal onClose={() => setTextExport(false)} />;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={20} color="var(--color-money)" /> 资料备份 Backup
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {/* Why this exists */}
        <div style={{
          background: lastBackup === null ? 'var(--color-accent-red-soft)' : 'var(--bg-card)',
          border: `1px solid ${lastBackup === null ? 'var(--color-accent-red)' : 'var(--border-glass)'}`,
          borderRadius: 'var(--radius-sm)',
          padding: '0.7rem 0.8rem',
          fontSize: '0.74rem',
          lineHeight: 1.5,
          color: 'var(--text-secondary)',
          marginBottom: '1.25rem',
        }}>
          {lastBackup === null ? (
            <><strong style={{ color: 'var(--color-accent-red)' }}>你还没有备份过。</strong>{' '}
              所有资料只存在这个浏览器里。清掉浏览器资料、换手机或换浏览器，全部会不见。</>
          ) : lastBackup === 0 ? (
            <>上次备份：<strong style={{ color: 'var(--color-money)' }}>今天</strong>。</>
          ) : (
            <>上次备份：<strong style={{ color: lastBackup > 7 ? 'var(--color-diet)' : 'var(--text-primary)' }}>
              {lastBackup} 天前</strong>{lastBackup > 7 ? ' — 建议再存一次。' : '。'}</>
          )}
        </div>

        {/* Cloud sync */}
        <div style={{ marginBottom: '1.25rem' }}>
          <SyncPanel />
        </div>

        {/* What's stored right now */}
        <div style={{ marginBottom: '1.25rem' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>目前存了什么</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginTop: '8px' }}>
            {ROWS.map(([key, label]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                <span style={{ fontWeight: '700' }}>{current[key]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Export */}
        <button onClick={handleExport} className="btn-primary" style={{ width: '100%', fontSize: '0.85rem' }}>
          {exported ? <Check size={16} /> : <Download size={16} />}
          {exported ? '已汇出 — 存好它' : '汇出备份档 Export'}
        </button>
        <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.45 }}>
          会下载一个 JSON 档。把它丢进 Google Drive 或 OneDrive，就等于上了云。
          也可以传去手机，用下面的「汇入」读回来 — 这就是手动同步。
        </p>

        {/* The other kind of export, and a genuinely different job: the JSON
            above restores a phone, this one is for reading. Kept next to it
            because "get my data out" is one thought, and putting the two
            answers in two different places would mean finding the wrong one. */}
        <button
          onClick={() => setTextExport(true)}
          className="btn-secondary"
          style={{ width: '100%', fontSize: '0.85rem', marginTop: '10px' }}
        >
          <Copy size={16} /> 导出文字档（给 AI 看）
        </button>
        <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.45 }}>
          纯文字：每天花了多少、每个户口剩多少、吃了什么、练了什么。
          复制起来直接贴给 AI 问它 — JSON 备份档它读得很吃力，这个不会。
        </p>

        <div style={{ height: '1px', background: 'var(--border-glass)', margin: '1.25rem 0' }} />

        {/* Import */}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFile}
          style={{ display: 'none' }}
        />
        <button onClick={() => fileRef.current?.click()} className="btn-secondary" style={{ width: '100%', fontSize: '0.85rem' }}>
          <Upload size={16} /> 汇入备份档 Import
        </button>

        {error && (
          <div style={{
            marginTop: '10px',
            background: 'var(--color-accent-red-soft)',
            border: '1px solid var(--color-accent-red)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.7rem',
            display: 'flex', gap: '7px', alignItems: 'flex-start',
          }}>
            <AlertTriangle size={15} color="var(--color-accent-red)" style={{ flexShrink: 0, marginTop: '1px' }} />
            <span style={{ fontSize: '0.74rem', color: 'var(--text-primary)', lineHeight: 1.45 }}>{error}</span>
          </div>
        )}

        {/* Confirm step — restore replaces everything, so it never happens on one tap */}
        {pending && (
          <div style={{
            marginTop: '10px',
            background: 'var(--color-diet-soft)',
            border: '1px solid var(--color-diet)',
            borderRadius: 'var(--radius-md)',
            padding: '0.85rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '8px' }}>
              <AlertTriangle size={16} color="var(--color-diet)" />
              <span style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--color-diet)' }}>
                会覆盖掉现在的资料
              </span>
            </div>
            <p style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '10px' }}>
              汇入是<strong>整个取代</strong>，不是合并 — 合并两边的资料需要处理冲突，弄错会把帐目搞乱。
              如果现在这台有还没存过的东西，先按上面的「汇出」。
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '4px 10px', fontSize: '0.73rem', marginBottom: '12px' }}>
              <span style={{ color: 'var(--text-muted)' }}></span>
              <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>现在</span>
              <span style={{ color: 'var(--color-diet)', textAlign: 'right', fontWeight: '700' }}>汇入后</span>
              {ROWS.map(([key, label]) => (
                <React.Fragment key={key}>
                  <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                  <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{current[key]}</span>
                  <span style={{ textAlign: 'right', fontWeight: '700' }}>{incoming[key]}</span>
                </React.Fragment>
              ))}
            </div>

            <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
              备份档时间：{new Date(pending.exportedAt).toLocaleString()}
            </p>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setPending(null)} className="btn-secondary" style={{ flex: 1, fontSize: '0.8rem' }}>
                取消
              </button>
              <button
                onClick={handleRestore}
                style={{
                  flex: 1,
                  background: 'var(--color-accent-red)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.75rem',
                  fontSize: '0.8rem',
                  fontWeight: '700',
                  cursor: 'pointer',
                }}
              >
                确定覆盖
              </button>
            </div>
          </div>
        )}

        {/* Which build am I on, and is there a newer one. Lives here because
            this sheet is already where "the state of my data and this device"
            questions get answered — and the automatic check is throttled to
            once every six hours, so there has to be a way to ask right now. */}
        <div style={{ marginTop: '1.1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-glass)' }}>
          <UpdateStatus />
        </div>

      </div>
    </div>
  );
}
