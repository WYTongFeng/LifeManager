import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { kgToLbs, formatWeight } from '../utils/units';

/**
 * Per-exercise weight trend, split into its own file purely so it can be
 * `React.lazy`-ed.
 *
 * WHY IT'S WORTH A FILE OF ITS OWN
 * Recharts is roughly 400 KB of the bundle — comfortably the largest single
 * dependency, larger than React, the router and the whole app put together.
 * Importing it at the top of SportsModule.jsx put it in the main chunk, which
 * meant EVERY launch downloaded, parsed and executed it before first paint.
 *
 * The chart it pays for renders in exactly one place: inside a live training
 * session, on the strength screen, and only once `weightProgressData.length >= 2`
 * — you need the same exercise logged on two separate days before it appears at
 * all. So a new user never sees it, and an established user sees it during the
 * one activity where they are least likely to be waiting on a cold start.
 *
 * That matters more here than the raw number suggests: this ships as an APK on
 * a phone, where the WebView re-parses the bundle on a cold start over whatever
 * connection is going.
 */
export default function WeightTrendChart({ data, weightUnit }) {
  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={40}
          tickFormatter={(v) => (weightUnit === 'lbs' ? Math.round(kgToLbs(v)) : v)}
        />
        <Tooltip
          formatter={(value) => [formatWeight(value, weightUnit), '重量']}
          contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem' }}
          labelStyle={{ color: 'var(--text-primary)' }}
        />
        <Line type="monotone" dataKey="weightKg" stroke="var(--color-sports)" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
