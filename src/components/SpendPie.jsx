import React, { useMemo, useState } from 'react';
import { num } from '../utils/num';

/**
 * Where the month's money went.
 *
 * WHY THIS SHOWS MORE THAN SPENDING CATEGORIES
 * The screen already had a category breakdown, and it answered a narrower
 * question than the one people actually ask. Rent, bills and a SPayLater
 * instalment are usually the biggest things that happen to a month's money, and
 * they lived in a completely different section — so a chart of "where did it
 * all go" that showed only 吃饭/交通/购物 was, for this user, a chart of the
 * small half.
 *
 * So one circle covers the whole cycle's income: every fixed commitment, every
 * debt reserved, every category actually spent, and — the slice that makes the
 * others legible — whatever is still unspent. A pie whose slices sum to the
 * money that existed can be read as proportions of something real. A pie of
 * spending alone only ever says "100% of what you spent", which is true of
 * every month and tells you nothing.
 *
 * WHY A DONUT AND NOT A PIE
 * The hole is where the total goes. Reading a value off slice areas is
 * something people are famously bad at, so the number that matters is printed
 * rather than implied, and every slice carries its own figure in the legend
 * underneath. The circle is for proportion at a glance; the list is for facts.
 *
 * TAPPING A SLICE OPENS IT
 * It used to only dim the other slices and print the same total again, which
 * is the one thing the reader could already see. "RM 420 on 吃饭" is not an
 * answer to where the money went — it is the question restated with a number
 * attached. A slice that carries `items` now expands into the actual rows
 * behind it, newest first, so the chart bottoms out in real transactions
 * instead of in another aggregate.
 */

// Distinguishable at small sizes and in this app's dark HUD. Deliberately not
// the module accent colours (money-green, diet-amber, sports-purple): those
// mean something specific everywhere else in the app, and a slice reusing one
// would read as a claim about which module it belongs to.
const SLICE_COLORS = [
  '#3dd68c', '#f5a524', '#8b7cf6', '#38bdf8', '#f0554b',
  '#2dd4bf', '#e879b9', '#a3e635', '#fb923c', '#94a3b8',
];

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const fmt = (n) => `RM ${num(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * @param {object}  props
 * @param {{key:string,label:string,value:number,muted?:boolean,
 *          items?:{id:any,label:string,sub?:string,amount:number}[]}[]} props.slices
 *        `muted` marks a slice that is not spending — the unspent remainder —
 *        so it can be drawn as a gap rather than as another outgoing.
 *        `items` are the individual records behind the slice, revealed when it
 *        is tapped. Optional: a slice with none (a fixed bill, the unspent
 *        remainder) simply has nothing to open.
 * @param {string}  props.centerLabel
 * @param {number}  props.centerValue
 * @param {(item:object) => void} [props.onItemClick] — opens the record itself.
 */
export default function SpendPie({
  slices = [], centerLabel = '本月总额', centerValue = null, maxSlices = 9, onItemClick,
}) {
  const [active, setActive] = useState(null);

  // THE CIRCLE COLLAPSES. THE LIST DOES NOT.
  //
  // "分类那边全部都挤在其他，你可以分细一点吗" (2026-09-22). Everything
  // past the ninth-largest category used to be merged into one legend row
  // called "其他 N 项" — which sat directly underneath the real 其他
  // category, with the same word and a different meaning. Two different lumps,
  // one name, and the small categories he was looking for had no number
  // anywhere on the screen.
  //
  // The merge exists for the donut and only for the donut: fifteen 1% wedges
  // are unreadable and the colours stop being distinguishable. That is a
  // drawing constraint, not a reason to withhold the figures. So the ring
  // keeps its nine arcs plus a grey remainder, and the legend below lists
  // EVERY category with its own total, its own share and its own drill-down.
  // Same split the header comment already claims: the circle is for proportion
  // at a glance, the list is for facts.
  const ranked = useMemo(
    () => slices.filter(s => num(s.value) > 0).sort((a, b) => num(b.value) - num(a.value)),
    [slices]
  );

  const total = ranked.reduce((sum, s) => sum + num(s.value), 0);

  // How many get an arc of their own. With room to spare nothing is merged and
  // there is no remainder arc at all.
  const headCount = ranked.length <= maxSlices ? ranked.length : maxSlices - 1;

  // `rows` is the legend: one entry per category, always. `arcKey` is which
  // wedge it belongs to, so tapping a merged row still lights up the grey
  // remainder rather than dimming the whole ring and pointing at nothing.
  const { rows, arcs } = useMemo(() => {
    const head = ranked.slice(0, headCount);
    const tail = ranked.slice(headCount);
    const colorFor = (i, slice) => (slice.muted ? 'var(--border-glass)' : SLICE_COLORS[i % SLICE_COLORS.length]);
    const REST_COLOR = 'var(--text-muted)';

    const arcList = head.map((slice, i) => ({
      key: slice.key,
      label: slice.label,
      value: num(slice.value),
      muted: slice.muted,
      color: colorFor(i, slice),
    }));
    if (tail.length > 0) {
      arcList.push({
        key: '__rest',
        label: `小额的 ${tail.length} 类`,
        value: tail.reduce((sum, s) => sum + num(s.value), 0),
        color: REST_COLOR,
      });
    }

    let offset = 0;
    const withGeometry = arcList.map(arc => {
      const fraction = total > 0 ? arc.value / total : 0;
      const out = { ...arc, fraction, length: fraction * CIRCUMFERENCE, offset };
      offset += out.length;
      return out;
    });

    const rowList = [
      ...head.map((slice, i) => ({
        ...slice,
        color: colorFor(i, slice),
        arcKey: slice.key,
        fraction: total > 0 ? num(slice.value) / total : 0,
      })),
      ...tail.map(slice => ({
        ...slice,
        color: REST_COLOR,
        // Tapping any of these lights the one grey wedge they share.
        arcKey: '__rest',
        // Marked so the legend can indent them under the remainder they were
        // drawn into — the row is honest about why it has no colour of its own.
        merged: true,
        fraction: total > 0 ? num(slice.value) / total : 0,
      })),
    ];
    return { rows: rowList, arcs: withGeometry };
  }, [ranked, headCount, total]);

  if (total <= 0) return null;

  // From `rows`, not from the raw slices: `fraction` is computed above, so
  // looking the active row up in the pre-map array rendered "NaN%" in the
  // donut's centre for every slice you tapped.
  // The grey remainder wedge is tappable too and has no legend row of its own,
  // so it falls back to the arc — otherwise tapping it dimmed the entire ring
  // and printed nothing in the middle.
  const activeRow = rows.find(r => r.key === active)
    ?? arcs.find(a => a.key === '__rest' && a.key === active)
    ?? null;
  // Which wedge to keep lit. A merged row lights the remainder it lives in.
  const activeArcKey = activeRow ? (activeRow.arcKey ?? activeRow.key) : null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
        <svg viewBox="0 0 100 100" style={{ width: '176px', height: '176px', display: 'block' }} role="img"
          aria-label={`本月钱的去向，共 ${fmt(total)}`}>
          {/* -90° so the first slice starts at the top, where a reader expects it. */}
          <g transform="rotate(-90 50 50)">
            {arcs.map(arc => (
              <circle
                key={arc.key}
                cx="50" cy="50" r={RADIUS}
                fill="none"
                stroke={arc.color}
                strokeWidth={activeArcKey === arc.key ? 15 : 12}
                strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
                strokeDashoffset={-arc.offset}
                opacity={activeArcKey && activeArcKey !== arc.key ? 0.32 : 1}
                style={{ cursor: 'pointer', transition: 'opacity 120ms, stroke-width 120ms' }}
                onClick={() => setActive(active === arc.key ? null : arc.key)}
              >
                <title>{`${arc.label} ${fmt(arc.value)}`}</title>
              </circle>
            ))}
          </g>
        </svg>

        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', textAlign: 'center',
        }}>
          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
            {activeRow ? activeRow.label : centerLabel}
          </div>
          <div style={{ fontSize: '0.95rem', fontWeight: '800' }}>
            {fmt(activeRow ? activeRow.value : (centerValue ?? total))}
          </div>
          {activeRow && (
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
              {Math.round(activeRow.fraction * 100)}%
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '12px' }}>
        {rows.map((row, i) => {
          const isOpen = active === row.key;
          const items = row.items ?? [];
          // The first merged row carries a one-line heading, so the smaller
          // categories below it read as "these share the grey wedge" rather
          // than as rows whose colour swatch mysteriously stopped varying.
          const startsMerged = row.merged && !rows[i - 1]?.merged;
          return (
            <div key={row.key}>
              {startsMerged && (
                <p style={{
                  fontSize: '0.6rem', color: 'var(--text-muted)',
                  margin: '7px 0 2px', paddingLeft: '7px',
                }}>
                  下面这 {rows.length - i} 类在圈里合成灰色那一块 —— 数字还是各算各的
                </p>
              )}
              <button
                type="button"
                onClick={() => setActive(isOpen ? null : row.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                  padding: '5px 7px', borderRadius: 'var(--radius-sm)', textAlign: 'left',
                  background: isOpen ? 'var(--bg-input)' : 'transparent',
                  border: '1px solid transparent', color: 'var(--text-primary)', cursor: 'pointer',
                }}
              >
                <span style={{
                  width: '9px', height: '9px', borderRadius: '2px', flexShrink: 0,
                  background: row.color,
                  border: row.muted ? '1px solid var(--text-muted)' : 'none',
                  opacity: row.merged ? 0.55 : 1,
                }} />
                <span style={{ fontSize: '0.72rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.label}
                  {/* Says up front that there is something to open. A row that
                      silently does nothing when tapped is worse than one that
                      never looked tappable. */}
                  {items.length > 0 && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.64rem', marginLeft: '5px' }}>
                      {items.length} 笔 {isOpen ? '▾' : '▸'}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', flexShrink: 0 }}>
                  {fmt(row.value)}
                </span>
                <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', width: '34px', textAlign: 'right', flexShrink: 0 }}>
                  {Math.round(row.fraction * 100)}%
                </span>
              </button>

              {isOpen && items.length > 0 && (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: '1px',
                  margin: '2px 0 6px 17px', paddingLeft: '9px',
                  borderLeft: `2px solid ${row.color}`,
                }}>
                  {items.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onItemClick?.(item)}
                      disabled={!onItemClick}
                      style={{
                        display: 'flex', alignItems: 'baseline', gap: '8px', width: '100%',
                        padding: '4px 6px', borderRadius: 'var(--radius-sm)', textAlign: 'left',
                        background: 'transparent', border: '1px solid transparent',
                        color: 'var(--text-primary)', cursor: onItemClick ? 'pointer' : 'default',
                      }}
                    >
                      <span style={{ fontSize: '0.7rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.label}
                        {item.sub && (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.62rem', marginLeft: '6px' }}>
                            {item.sub}
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', flexShrink: 0 }}>
                        {fmt(item.amount)}
                      </span>
                    </button>
                  ))}
                </div>
              )}

            </div>
          );
        })}
      </div>
    </div>
  );
}
