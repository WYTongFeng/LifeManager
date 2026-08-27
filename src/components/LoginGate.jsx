import React from 'react';
import AuthForm from './AuthForm';

/**
 * A real front door, shown once on first launch — not the sign-in button
 * buried three taps deep in Header → 备份 → Sync that it was before. Only
 * rendered when Firebase is actually configured and nobody is signed in yet
 * (App.jsx gates this); if Firebase isn't configured at all, this never
 * shows and the app works exactly as it always has, purely local.
 *
 * Skippable, and only ever shown once per device: dismissing it — either by
 * signing in or by explicitly skipping — sets `loginGateSeen` (in App.jsx),
 * so a returning user is never interrupted by this again. Signing out later
 * does not bring it back; that's a deliberate settings action, not a reason
 * to re-run first-launch onboarding.
 */
export default function LoginGate({ onDismiss }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'var(--bg-main)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      // The keyboard opening over a fixed, centred, full-height panel would
      // otherwise put the password field somewhere unreachable on a phone.
      padding: '2rem 1.5rem', textAlign: 'center', gap: '1.25rem',
      overflowY: 'auto',
    }}>
      <div style={{
        width: '64px', height: '64px', borderRadius: 'var(--radius-lg)',
        background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: '800', fontSize: '1.6rem', color: 'var(--accent-ink)',
      }}>
        LM
      </div>

      <div>
        <h1 style={{ fontSize: '1.3rem', fontWeight: '800' }}>LifeManager</h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '6px', lineHeight: 1.6, maxWidth: '280px' }}>
          注册一个帐号，手机和电脑的资料就能自动同步。只需要登入一次，之后开 app 不会再问。
        </p>
      </div>

      <div style={{ width: '100%', maxWidth: '280px' }}>
        {/* onSignedIn only fires for the in-place paths; the Google redirect
            fallback navigates away and re-mounts the app instead, and by then
            sync.user is populated so App.jsx's own gate condition keeps this
            from showing again either way. */}
        <AuthForm onSignedIn={onDismiss} />
      </div>

      <button
        onClick={onDismiss}
        style={{
          background: 'none', border: 'none', color: 'var(--text-muted)',
          fontSize: '0.78rem', cursor: 'pointer', textDecoration: 'underline',
        }}
      >
        先不要，直接开始用
      </button>
    </div>
  );
}
