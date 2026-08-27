import React, { useState } from 'react';
import { Cloud, ShieldCheck } from '../utils/icons';
import { signInWithEmail, registerWithEmail, sendPasswordReset, signIn, getState } from '../utils/cloudSync';
import { isNativePlatform } from '../utils/platform';

/**
 * The one email/password sign-in form, shared by the first-launch LoginGate
 * and the Sync panel in 备份 — two entry points that were drifting apart with
 * their own copies of a Google button.
 *
 * WHY EMAIL/PASSWORD IS THE PRIMARY PATH — see the long note on
 * `signInWithEmail` in cloudSync.js. Short version: Google's OAuth screen
 * refuses to render inside an Android WebView, so on the actual phone the
 * Google button could never have worked, whatever it looked like.
 *
 * Google stays available on desktop, where it does work, but is deliberately
 * hidden on native rather than shown-and-broken. It's also demoted to a small
 * secondary link for a reason beyond looks: two devices signing in through
 * two different providers get two different uids, and since the uid *is* the
 * data path, that reads to the user as "sync silently does nothing". Steering
 * both devices down the same path is what keeps them on one account.
 */

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
  color: 'white', marginTop: '4px', fontSize: '0.85rem',
};
const labelStyle = { fontSize: '0.75rem', color: 'var(--text-secondary)' };
const linkStyle = {
  background: 'none', border: 'none', color: 'var(--text-muted)',
  fontSize: '0.72rem', cursor: 'pointer', textDecoration: 'underline', padding: 0,
};

export default function AuthForm({ onSignedIn }) {
  const [mode, setMode] = useState('signin');   // signin | register
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const registering = mode === 'register';

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await (registering ? registerWithEmail : signInWithEmail)(email, password);
      onSignedIn?.();
    } catch {
      // cloudSync has already translated the Firebase code into something
      // readable and put it on sync.error; re-read it rather than inventing a
      // second, vaguer message here.
      setError(getState().error || '登入失败，请再试一次。');
    }
    setBusy(false);
  };

  const reset = async () => {
    if (!email.trim()) { setError('先填 email，才知道要寄去哪。'); return; }
    setBusy(true);
    setError('');
    try {
      await sendPasswordReset(email);
      setNotice(`重设密码的信已经寄到 ${email.trim()}，收件匣没有的话看看垃圾邮件。`);
    } catch {
      setError(getState().error || '寄不出去，请再试一次。');
    }
    setBusy(false);
  };

  const google = async () => {
    setBusy(true);
    setError('');
    try {
      await signIn();
      onSignedIn?.();
    } catch {
      setError(getState().error || '登入失败，请再试一次。');
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ textAlign: 'left' }}>
        <label style={labelStyle}>Email</label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          autoComplete="email" inputMode="email" placeholder="you@example.com"
          style={inputStyle} required
        />
      </div>

      <div style={{ textAlign: 'left' }}>
        <label style={labelStyle}>密码</label>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete={registering ? 'new-password' : 'current-password'}
          placeholder={registering ? '至少 6 个字' : ''}
          minLength={6} style={inputStyle} required
        />
      </div>

      {error && (
        <p style={{ fontSize: '0.72rem', color: 'var(--color-accent-red)', lineHeight: 1.5, textAlign: 'left' }}>
          {error}
        </p>
      )}
      {notice && (
        <p style={{ fontSize: '0.72rem', color: 'var(--color-money)', lineHeight: 1.5, textAlign: 'left' }}>
          {notice}
        </p>
      )}

      <button type="submit" disabled={busy} className="btn-primary"
        style={{ width: '100%', fontSize: '0.85rem', opacity: busy ? 0.6 : 1 }}>
        <ShieldCheck size={16} />
        {busy ? '处理中…' : registering ? '注册并开启同步' : '登入'}
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <button type="button" style={linkStyle} disabled={busy}
          onClick={() => { setMode(registering ? 'signin' : 'register'); setError(''); setNotice(''); }}>
          {registering ? '已经有帐号了，去登入' : '第一次用？先注册一个'}
        </button>
        {!registering && (
          <button type="button" style={linkStyle} disabled={busy} onClick={reset}>
            忘记密码
          </button>
        )}
      </div>

      {/* Desktop only — see the component note. On the phone this button could
          never succeed, so showing it would just be a trap. */}
      {!isNativePlatform() && (
        <button type="button" onClick={google} disabled={busy} className="btn-secondary"
          style={{ width: '100%', fontSize: '0.78rem', padding: '0.5rem', opacity: busy ? 0.6 : 1 }}>
          <Cloud size={14} /> 或用 Google 登入（只有电脑能用）
        </button>
      )}

      <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.55, textAlign: 'left' }}>
        两台装置登入<strong>同一个帐号</strong>才会同步。资料只有你自己读得到。
      </p>
    </form>
  );
}
