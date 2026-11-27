import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { Card, CardHeader, EmptyState, Stat } from '@/components/ui';
import type { AnalyticsData } from '../types';
import { fmtScore, integrityTone } from '../bits';

const tooltipStyle = {
  contentStyle: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)', fontSize: 13, boxShadow: 'var(--shadow)' },
  labelStyle: { color: 'var(--ink-2)', fontWeight: 600 },
  itemStyle: { color: 'var(--ink)' },
  cursor: { fill: 'var(--surface-2)' },
};
const axis = { stroke: 'var(--line-strong)', tick: { fill: 'var(--muted)', fontSize: 12 }, tickLine: false };

export function AnalyticsTab({ data }: { data: AnalyticsData }) {
  const { summary, exam } = data;
  if (!summary.count) return <Card><EmptyState icon={<BarChart3 className="size-6" />} title="No submissions to analyse yet" body="Charts appear once at least one candidate has submitted." /></Card>;
  const passPct = exam.totalMarks ? (exam.passMarks / exam.totalMarks) * 100 : 0;
  const dist = data.distribution.map((b, i) => ({ ...b, pass: (i + 1) * 10 > passPct }));
  const topics = [...data.topics].sort((a, b) => a.pct - b.pct);
  const intTone = integrityTone(data.avgIntegrity);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Mean" value={fmtScore(summary.mean)} hint={`of ${exam.totalMarks}`} />
        <Stat label="Median" value={fmtScore(summary.median)} />
        <Stat label="Std. deviation" value={fmtScore(summary.sd)} hint="Spread of scores" />
        <Stat label="Pass rate" value={`${Math.round(summary.passRate)}%`} tone={summary.passRate >= 50 ? 'ok' : 'warn'} />
        <Stat label="Avg. duration" value={`${data.avgDurationMin} min`} hint={`of ${exam.durationMin} min allowed`} />
        <Stat label="Avg. integrity" value={data.avgIntegrity} tone={intTone} hint="0–100, higher is calmer" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Score distribution" subtitle={`Share of candidates per 10% band · pass mark at ${Math.round(passPct)}%`} />
          <div className="h-72 px-2 py-4" role="img" aria-label={`Histogram: ${dist.map((d) => `${d.label} ${d.count}`).join(', ')}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dist} margin={{ top: 16, right: 12, bottom: 4, left: -18 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="label" {...axis} interval={0} angle={-30} textAnchor="end" height={48} />
                <YAxis allowDecimals={false} {...axis} axisLine={false} />
                <Tooltip {...tooltipStyle} formatter={(v) => [`${v} candidate(s)`, 'Count']} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={44}>
                  {dist.map((d) => (
                    <Cell key={d.label} fill={d.pass ? 'var(--accent)' : 'var(--warn)'} />
                  ))}
                  <LabelList dataKey="count" position="top" fill="var(--ink-2)" fontSize={12} formatter={(v: unknown) => (Number(v) ? String(v) : '')} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 border-t border-line px-5 py-2.5 text-[12px] text-ink-2">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-accent" aria-hidden /> At or above pass band</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-warn" aria-hidden /> Below pass band</span>
          </div>
        </Card>

        <Card>
          <CardHeader title="Topic performance" subtitle="Average share of available marks earned, weakest first" />
          {!topics.length ? (
            <EmptyState title="No topic data" />
          ) : (
            <div className="px-2 py-4" style={{ height: Math.max(200, topics.length * 44 + 40) }} role="img" aria-label={`Topic performance: ${topics.map((t) => `${t.name} ${t.pct}%`).join(', ')}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topics} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 8 }}>
                  <CartesianGrid horizontal={false} stroke="var(--line)" />
                  <XAxis type="number" domain={[0, 100]} {...axis} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" width={130} {...axis} axisLine={false} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${v}%`, 'Average']} />
                  <Bar dataKey="pct" radius={[0, 6, 6, 0]} maxBarSize={24}>
                    {topics.map((t) => (
                      <Cell key={t.name} fill={t.pct >= 70 ? 'var(--ok)' : t.pct >= 50 ? 'var(--info)' : 'var(--danger)'} />
                    ))}
                    <LabelList dataKey="pct" position="right" fill="var(--ink-2)" fontSize={12} formatter={(v: unknown) => `${v}%`} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
