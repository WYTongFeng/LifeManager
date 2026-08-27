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

  // Smallest slices collapsed into one. Ten 1% slivers are unreadable as
  // wedges AND push the things that matter off the bottom of the legend.
  const shown = useMemo(() => {
    const positive = slices.filter(s => num(s.value) > 0).sort((a, b) => num(b.value) - num(a.value));
    if (positive.length <= maxSlices) return positive;
    const head = positive.slice(0, maxSlices - 1);
    const tail = positive.slice(maxSlices - 1);
    return [...head, {
      key: '__rest',
      label: `其他 ${tail.length} 项`,
      value: tail.reduce((sum, s) => sum + num(s.value), 0),
      detail: tail.map(s => s.label).join('、'),
      // The collapsed tail keeps its rows too, so the small categories are
      // still reachable rather than being merged into an unopenable lump.
      items: tail.flatMap(s => s.items ?? []),
    }];
  }, [slices, maxSlices]);

  const total = shown.reduce((sum, s) => sum + num(s.value), 0);
  if (total <= 0) return null;

  let offset = 0;
  const arcs = shown.map((slice, i) => {
    const fraction = num(slice.value) / total;
    const arc = {
      ...slice,
      color: slice.muted ? 'var(--border-glass)' : SLICE_COLORS[i % SLICE_COLORS.length],
      fraction,
      length: fraction * CIRCUMFERENCE,
      offset,
    };
    offset += arc.length;
    return arc;
  });

  // From `arcs`, not from `shown`. `fraction` is computed in the map above, so
  // looking the active slice up in the pre-map array meant the donut's centre
  // rendered "NaN%" for every slice you tapped — silent until tapping a slice
  // was worth doing, which is exactly what this component just became.
  const activeSlice = arcs.find(s => s.key === active) ?? null;

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
                strokeWidth={active === arc.key ? 15 : 12}
                strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
                strokeDashoffset={-arc.offset}
                opacity={active && active !== arc.key ? 0.32 : 1}
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
            {activeSlice ? activeSlice.label : centerLabel}
          </div>
          <div style={{ fontSize: '0.95rem', fontWeight: '800' }}>
            {fmt(activeSlice ? activeSlice.value : (centerValue ?? total))}
          </div>
          {activeSlice && (
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
              {Math.round(activeSlice.fraction * 100)}%
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '12px' }}>
        {arcs.map(arc => {
          const isOpen = active === arc.key;
          const rows = arc.items ?? [];
          return (
            <div key={arc.key}>
              <button
                type="button"
                onClick={() => setActive(isOpen ? null : arc.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                  padding: '5px 7px', borderRadius: 'var(--radius-sm)', textAlign: 'left',
                  background: isOpen ? 'var(--bg-input)' : 'transparent',
                  border: '1px solid transparent', color: 'var(--text-primary)', cursor: 'pointer',
                }}
              >
                <span style={{
                  width: '9px', height: '9px', borderRadius: '2px', flexShrink: 0,
                  background: arc.color, border: arc.muted ? '1px solid var(--text-muted)' : 'none',
                }} />
                <span style={{ fontSize: '0.72rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {arc.label}
                  {/* Says up front that there is something to open. A row that
                      silently does nothing when tapped is worse than one that
                      never looked tappable. */}
                  {rows.length > 0 && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.64rem', marginLeft: '5px' }}>
                      {rows.length} 笔 {isOpen ? '▾' : '▸'}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', flexShrink: 0 }}>
                  {fmt(arc.value)}
                </span>
                <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', width: '34px', textAlign: 'right', flexShrink: 0 }}>
                  {Math.round(arc.fraction * 100)}%
                </span>
              </button>

              {isOpen && rows.length > 0 && (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: '1px',
                  margin: '2px 0 6px 17px', paddingLeft: '9px',
                  borderLeft: `2px solid ${arc.color}`,
                }}>
                  {rows.map(item => (
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

              {isOpen && arc.detail && (
                <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '2px 0 6px 17px', lineHeight: 1.5 }}>
                  {arc.detail}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
