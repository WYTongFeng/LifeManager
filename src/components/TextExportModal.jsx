import React, { useMemo, useState } from 'react';
import { X, Download, Check, Copy } from '../utils/icons';
import { loadJSON } from '../utils/storage';
import { calcBMR } from '../utils/calories';
import { buildMoneyReport, buildHealthReport, reportFilename, reportRanges } from '../utils/textExport';

/**
 * Export everything as plain text, to paste at an AI.
 *
 * SEPARATE FROM 备份 ON PURPOSE
 * The JSON backup already exists and is the right tool for restoring a phone.
 * It is the wrong tool for the thing the user actually asked for — handing his
 * own data to a language model and asking it questions — because it is mostly
 * internal ids and timestamps. See textExport.js for what this file says
 * instead.
 *
 * COPY IS THE PRIMARY ACTION, NOT DOWNLOAD
 * A downloaded .txt inside the Android app lands somewhere in Downloads and
 * then has to be found, opened and re-copied before it can be pasted anywhere —
 * and a blob download in a Capacitor WebView is not reliable to begin with.
 * The clipboard goes straight where it is going. Download is offered second,
 * for the case where he does want a file on the laptop.
 */

const KINDS = [
  { key: 'money', label: '记账', hint: '每天花了多少、每个户口剩多少' },
  { key: 'health', label: '饮食 & 健身', hint: '每天吃的、练的、卡路里' },
];

export default function TextExportModal({ onClose }) {
  const [kind, setKind] = useState('money');
  // 本月 by default. It is the question being asked almost every time, and
  // "最近 30 天" — which is what this used to offer — is not a month in an app
  // whose month starts on the 10th. See reportRanges().
  const [rangeKey, setRangeKey] = useState('cycle');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  // Recomputed per render rather than pinned at mount: the app stays open for
  // days on the phone, and a modal opened after payday must not still be
  // offering last cycle as 本月.
  const ranges = reportRanges();
  const range = ranges.find(r => r.key === rangeKey) ?? ranges[0];

  // Read straight from storage rather than taking a dozen props. This modal is
  // opened from the header, which is nowhere near the modules that own any of
  // this data, and threading nine arrays through Header to get here would make
  // Header know about debts.
  const text = useMemo(() => {
    // Not named `window`: shadowing the global inside this callback is legal
    // and reads fine until someone reaches for window.something in here.
    const span = {
      from: range.from,
      to: range.to,
      rangeLabel: `这份涵盖：${range.label}${range.from ? `（${range.from} → ${range.to}）` : '（全部记录）'}`,
    };
    if (kind === 'money') {
      return buildMoneyReport({
        expenses: loadJSON('expenses', []),
        accounts: loadJSON('accounts', []),
        debts: loadJSON('debts', []),
        incomeSources: loadJSON('incomeSources', []),
        allocations: loadJSON('allocations', []),
        dailyBudget: loadJSON('dailyBudget', 0),
        ...span,
      });
    }
    const weightKg = loadJSON('bodyWeightKg', null);
    const heightCm = loadJSON('heightCm', null);
    const age = loadJSON('ageYears', null);
    const sex = loadJSON('sex', null);
    return buildHealthReport({
      meals: loadJSON('meals', []),
      workouts: loadJSON('workouts', []),
      history: loadJSON('history', []),
      bodyWeightKg: weightKg, heightCm, ageYears: age, sex,
      calorieLimit: loadJSON('calorieLimit', null),
      bmr: calcBMR({ weightKg, heightCm, age, sex }),
      ...span,
    });
  }, [kind, range.from, range.to, range.label]);

  const copy = async () => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access can be refused — an insecure origin, or the WebView
      // simply saying no. Rather than a dead button, fall back to selecting the
      // text so a long-press copy works.
      setCopyFailed(true);
      const box = document.getElementById('export-text');
      if (box) {
        const selection = document.createRange();
        selection.selectNodeContents(box);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(selection);
      }
    }
  };

  const download = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = reportFilename(kind, new Date(), rangeKey);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const lines = text.split('\n').length;
  const kb = (new TextEncoder().encode(text).length / 1024).toFixed(1);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ height: '86vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>导出文字档</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '6px 0 12px', lineHeight: 1.5, flexShrink: 0 }}>
          纯文字，人和 AI 都读得懂。复制了直接贴给 AI 问它 — 「我这个月花太多了吗」「帮我看看我的饮食」。
        </p>

        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          {KINDS.map(k => (
            <button
              key={k.key}
              onClick={() => setKind(k.key)}
              style={{
                flex: 1, padding: '9px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                background: kind === k.key ? 'var(--color-money-soft)' : 'var(--bg-card)',
                border: `1px solid ${kind === k.key ? 'var(--color-money)' : 'var(--border-glass)'}`,
                color: kind === k.key ? 'var(--color-money)' : 'var(--text-secondary)',
                fontSize: '0.78rem', fontWeight: '700',
              }}
            >
              {k.label}
              <span style={{ display: 'block', fontSize: '0.6rem', fontWeight: '500', opacity: 0.8, marginTop: '2px' }}>
                {k.hint}
              </span>
            </button>
          ))}
        </div>

        {/* Each option prints the dates it actually covers. 本月 here means the
            payday cycle, not the calendar month, and a label that says only
            「本月」 would quietly mean something different from what a reader
            assumes on, say, the 3rd. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px', flexShrink: 0 }}>
          {ranges.map(r => (
            <button
              key={r.key}
              onClick={() => setRangeKey(r.key)}
              style={{
                padding: '7px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                background: rangeKey === r.key ? 'var(--bg-input)' : 'transparent',
                border: `1px solid ${rangeKey === r.key ? 'var(--color-money)' : 'var(--border-glass)'}`,
                color: rangeKey === r.key ? 'white' : 'var(--text-secondary)',
                fontSize: '0.72rem', fontWeight: '700', textAlign: 'left',
              }}
            >
              {r.label}
              <span style={{ display: 'block', fontSize: '0.58rem', fontWeight: '500', opacity: 0.75, marginTop: '1px' }}>
                {r.hint}
              </span>
            </button>
          ))}
        </div>

        {/* The actual text, visible before it goes anywhere. Exporting your own
            financial records into something you cannot see first is not a
            reasonable thing to ask anyone to do. */}
        <pre
          id="export-text"
          style={{
            flex: 1, overflow: 'auto', marginTop: '10px', padding: '10px',
            background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
            fontSize: '0.62rem', lineHeight: 1.55, whiteSpace: 'pre',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            userSelect: 'text', WebkitUserSelect: 'text',
          }}
        >{text}</pre>

        <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '6px', flexShrink: 0 }}>
          {lines} 行 · {kb} KB
        </div>

        {copyFailed && (
          <p style={{ fontSize: '0.66rem', color: 'var(--color-accent-amber)', marginTop: '6px', lineHeight: 1.5, flexShrink: 0 }}>
            这台装置不让 app 直接写剪贴板。上面的文字已经帮你选起来了 — 长按 / Ctrl+C 复制。
          </p>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexShrink: 0 }}>
          <button
            onClick={download}
            className="btn-secondary"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            <Download size={15} /> 存成档案
          </button>
          <button
            onClick={copy}
            style={{
              flex: 2, padding: '0.8rem', border: 'none', borderRadius: 'var(--radius-sm)',
              background: copied ? 'var(--color-money-soft)' : 'var(--color-money)',
              color: copied ? 'var(--color-money)' : 'var(--color-money-ink)',
              fontSize: '0.88rem', fontWeight: '800', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            }}
          >
            {copied ? <><Check size={16} /> 复制好了</> : <><Copy size={16} /> 复制全部</>}
          </button>
        </div>
      </div>
    </div>
  );
}
