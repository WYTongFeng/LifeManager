import React from 'react';
import { downloadBackup } from '../utils/backup';

/**
 * Catches render crashes so a bug can't leave a blank white screen.
 *
 * The important part is the export button. The user's accounts and debts live
 * only in this browser, so a crash that hides the UI would otherwise strip any
 * way to get at them. Backup reads localStorage directly and never touches
 * React state, so it still works when everything above it is broken.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, saved: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('LifeManager crashed:', error, info);
  }

  handleExport = () => {
    try {
      downloadBackup();
      this.setState({ saved: true });
    } catch (e) {
      console.error('Emergency export failed:', e);
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        maxWidth: '480px', margin: '0 auto', padding: '2rem 1.25rem',
        minHeight: '100vh', background: 'var(--bg-main)', color: 'var(--text-primary)',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1rem',
      }}>
        <h2 style={{ fontSize: '1.3rem', fontWeight: '800' }}>App 出问题了</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          画面崩溃了，但<strong>你的资料还在</strong>。先按下面汇出一份，再重新载入。
        </p>

        <button onClick={this.handleExport} className="btn-primary" style={{ width: '100%' }}>
          {this.state.saved ? '已汇出 — 存好它' : '立即汇出资料'}
        </button>

        <button onClick={() => window.location.reload()} className="btn-secondary" style={{ width: '100%' }}>
          重新载入
        </button>

        <details style={{ marginTop: '0.5rem' }}>
          <summary style={{ fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
            技术细节
          </summary>
          <pre style={{
            fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '8px',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            background: 'var(--bg-card)', padding: '0.7rem', borderRadius: 'var(--radius-sm)',
            maxHeight: '200px', overflow: 'auto',
          }}>
            {String(this.state.error?.stack || this.state.error)}
          </pre>
        </details>
      </div>
    );
  }
}
