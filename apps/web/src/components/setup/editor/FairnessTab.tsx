import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Scale, Sparkles, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/lib/api';
import { Badge, Card, CardHeader, cx, EmptyState, ErrorBox, Spinner, Table, Td, Th } from '@/components/ui';
import { DIFFICULTY_TONE } from '@/components/status';
import { DIFF_LABEL, type ExamDetail, type Slot } from '../types';
import { useTopics } from './QuestionPicker';

interface Series {
  values: number[];
  mean: number;
  sd: number;
  min: number;
  max: number;
  range: number;
  overlap: number;
}
interface Fairness {
  mode: 'BLUEPRINT' | 'FIXED';
  message?: string;
  target: number;
  poolSize: number;
  fair: Series;
  naive: Series;
  issued: { attemptId: string; candidate: string; expected: number; actual: number | null }[];
  issuedOverlap: number;
  coverage: (Slot & { available: number })[];
}

export function FairnessTab({ exam }: { exam: ExamDetail }) {
  const q = useQuery({ queryKey: ['fairness', exam.id], queryFn: () => api<Fairness>(`/exams/${exam.id}/fairness`) });
  const topics = useTopics();
  const topicName = (id: string) => topics.data?.find((t) => t.id === id)?.name ?? '…';

  const data = useMemo(() => (q.data?.fair ? q.data.fair.values.map((f, i) => ({ paper: i + 1, fair: f, naive: q.data!.naive.values[i] })) : []), [q.data]);
  const domain = useMemo<[number, number]>(() => {
    if (!q.data?.fair) return [0, 100];
    const all = [...q.data.fair.values, ...q.data.naive.values, q.data.target];
    return [Math.max(0, Math.floor(Math.min(...all) / 5) * 5 - 5), Math.min(100, Math.ceil(Math.max(...all) / 5) * 5 + 5)];
  }, [q.data]);

  if (q.isLoading) return <Spinner label="Simulating 40 papers each way" />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  if (d.mode !== 'BLUEPRINT' || !d.fair) return <Card><EmptyState icon={<Scale className="size-6" />} title="Fairness applies to blueprint papers" body={d.message ?? 'Switch the Questions tab to Blueprint mode and save to see the analysis.'} /></Card>;

  const tighter = d.fair.sd > 0 ? d.naive.sd / d.fair.sd : null;

  return (
    <div className="space-y-5">
      {/* Headline */}
      <Card className="overflow-hidden">
        <div className="grid gap-0 md:grid-cols-[1.4fr_1fr]">
          <div className="p-6">
            <div className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-accent">
              <Sparkles className="size-3.5" aria-hidden /> Fair paper generation
            </div>
            <h2 className="display text-2xl font-semibold leading-snug">
              {tighter && tighter >= 1.2 ? (
                <>
                  Papers differ in difficulty by just <span className="text-accent tabular">±{d.fair.sd} pts</span> — versus <span className="tabular text-ink-2">±{d.naive.sd} pts</span> with plain random picking.
                </>
              ) : (
                <>Every candidate gets a different paper of the same expected difficulty.</>
              )}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-ink-2">
              Instead of drawing questions blindly, ExamGuard balances each paper against how hard every question has proven to be, so no one is unlucky enough to draw all the tough ones — while papers still differ enough to make copying pointless.
            </p>
          </div>
          <div className="flex flex-col justify-center gap-3 border-t border-line bg-surface-2/50 p-6 md:border-l md:border-t-0">
            <div className="flex items-center gap-3">
              <span className="rounded-lg bg-accent-soft p-2 text-accent" aria-hidden>
                <Target className="size-5" />
              </span>
              <div>
                <div className="text-[13px] text-muted">Target expected score</div>
                <div className="tabular text-3xl font-semibold">{d.target}%</div>
              </div>
            </div>
            <p className="text-[13px] text-ink-2">
              The average score a typical candidate would get across the whole pool. Drawn from <span className="tabular font-medium">{d.poolSize}</span> eligible questions.
            </p>
          </div>
        </div>
      </Card>

      {/* Chart + stats */}
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Expected score per paper" subtitle="40 simulated papers each way. Closer to the target line means fairer." />
          <div className="h-72 px-2 pb-3 pt-4 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 20, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="0" vertical={false} />
                <XAxis dataKey="paper" tick={{ fill: 'var(--muted)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--line-strong)' }} interval={4} label={{ value: 'Simulated paper', position: 'insideBottom', offset: -2, fill: 'var(--muted)', fontSize: 12 }} height={36} />
                <YAxis domain={domain} ticks={Array.from({ length: Math.floor((domain[1] - domain[0]) / 5) + 1 }, (_, i) => domain[0] + i * 5)} tick={{ fill: 'var(--muted)', fontSize: 12 }} tickLine={false} axisLine={false} unit="%" width={48} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)', fontSize: 13 }}
                  labelStyle={{ color: 'var(--muted)' }}
                  labelFormatter={(l) => `Paper ${l}`}
                  formatter={(v, name) => [`${v}%`, name === 'fair' ? 'ExamGuard fair' : 'Naive random']}
                  cursor={{ stroke: 'var(--line-strong)' }}
                />
                <Legend verticalAlign="top" height={28} iconType="plainline" formatter={(v) => <span style={{ color: 'var(--ink-2)', fontSize: 13 }}>{v === 'fair' ? 'ExamGuard fair' : 'Naive random'}</span>} />
                <ReferenceLine y={d.target} stroke="var(--ink-2)" strokeDasharray="4 4" label={{ value: `target ${d.target}%`, position: 'insideBottomLeft', fill: 'var(--ink-2)', fontSize: 12 }} />
                <Line type="monotone" dataKey="naive" stroke="var(--muted)" strokeWidth={2} strokeDasharray="5 3" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="fair" stroke="var(--accent)" strokeWidth={2.5} dot={false} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details className="border-t border-line px-5 py-3 text-sm">
            <summary className="cursor-pointer text-[13px] font-medium text-ink-2">View as table</summary>
            <div className="mt-3 max-h-64 overflow-y-auto">
              <Table className="min-w-0">
                <thead>
                  <tr>
                    <Th>Paper</Th>
                    <Th className="text-right">Fair</Th>
                    <Th className="text-right">Naive</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.paper}>
                      <Td className="tabular py-1.5">{r.paper}</Td>
                      <Td className="tabular py-1.5 text-right">{r.fair}%</Td>
                      <Td className="tabular py-1.5 text-right">{r.naive}%</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </details>
        </Card>

        <Card>
          <CardHeader title="Side by side" subtitle="Lower spread = fairer. Lower overlap = harder to copy." />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[12px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-2.5 text-left font-semibold">Measure</th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-3 rounded bg-accent" aria-hidden /> Fair
                    </span>
                  </th>
                  <th className="px-5 py-2.5 text-right font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-3 rounded bg-muted" aria-hidden /> Naive
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line border-t border-line">
                <StatRow label="Std. deviation" hint="How much papers differ in difficulty" fair={d.fair.sd} naive={d.naive.sd} unit=" pts" lowerBetter />
                <StatRow label="Range" hint={`Fair ${d.fair.min}–${d.fair.max}% · naive ${d.naive.min}–${d.naive.max}%`} fair={d.fair.range} naive={d.naive.range} unit=" pts" lowerBetter />
                <StatRow label="Mean" hint="Should sit on the target" fair={d.fair.mean} naive={d.naive.mean} unit="%" />
                <StatRow label="Question overlap" hint="Avg. share of questions two papers have in common" fair={d.fair.overlap} naive={d.naive.overlap} unit="%" lowerBetter />
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-5 py-3 text-[12px] text-muted">The fair sampler also spreads usage across the pool, so overlap stays low even as spread shrinks.</p>
        </Card>
      </div>

      {/* Coverage */}
      <Card>
        <CardHeader title="Blueprint coverage" subtitle="How deep the bank is behind each row. More depth = more variety between papers." />
        <Table>
          <thead>
            <tr>
              <Th>Topic</Th>
              <Th>Difficulty</Th>
              <Th className="text-right">Per paper</Th>
              <Th className="text-right">Marks each</Th>
              <Th className="text-right">In bank</Th>
              <Th>Depth</Th>
            </tr>
          </thead>
          <tbody>
            {d.coverage.map((c, i) => {
              const ratio = c.count ? c.available / c.count : 0;
              return (
                <tr key={i}>
                  <Td className="font-medium">{topicName(c.topicId)}</Td>
                  <Td>
                    <Badge tone={DIFFICULTY_TONE[c.difficulty]}>{DIFF_LABEL[c.difficulty]}</Badge>
                  </Td>
                  <Td className="tabular text-right">{c.count}</Td>
                  <Td className="tabular text-right">{c.marks}</Td>
                  <Td className="tabular text-right">{c.available}</Td>
                  <Td>
                    <span className={cx('tabular text-[13px] font-medium', ratio < 1 ? 'text-danger' : ratio < 1.5 ? 'text-warn' : 'text-ok')}>{ratio.toFixed(1)}×</span>
                    <span className="ml-2 text-[12px] text-muted">{ratio < 1 ? 'not enough questions' : ratio < 1.5 ? 'papers will look alike' : 'healthy variety'}</span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {/* Issued */}
      <Card>
        <CardHeader
          title="Papers issued to candidates"
          subtitle={d.issued.length ? `${d.issued.length} real papers · ${d.issuedOverlap}% average overlap between any two` : 'Real papers appear here once candidates start.'}
        />
        {!d.issued.length ? (
          <EmptyState icon={<Scale className="size-6" />} title="No papers issued yet" body="Each candidate’s paper is generated the moment they press Start. Use “Preview as candidate” to draw a sandbox paper." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Candidate</Th>
                <Th className="text-right">Expected</Th>
                <Th className="text-right">Actual</Th>
                <Th>Expected vs target</Th>
                <Th className="text-right">
                  <span className="sr-only">Review</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {d.issued.map((p) => {
                const delta = Math.round((p.expected - d.target) * 10) / 10;
                return (
                  <tr key={p.attemptId}>
                    <Td className="font-medium">{p.candidate}</Td>
                    <Td className="tabular text-right">{p.expected}%</Td>
                    <Td className="tabular text-right">{p.actual != null ? `${p.actual}%` : <span className="text-muted">pending</span>}</Td>
                    <Td>
                      <span className={cx('tabular text-[13px]', Math.abs(delta) <= 3 ? 'text-ok' : Math.abs(delta) <= 6 ? 'text-warn' : 'text-danger')}>
                        {delta > 0 ? '+' : ''}
                        {delta} pts {Math.abs(delta) <= 3 ? '· on target' : delta > 0 ? '· easier' : '· harder'}
                      </span>
                    </Td>
                    <Td className="text-right">
                      <Link to={`/examiner/attempts/${p.attemptId}`} className="text-[13px] font-medium text-accent hover:underline">
                        Review
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function StatRow({ label, hint, fair, naive, unit, lowerBetter }: { label: string; hint: string; fair: number; naive: number; unit: string; lowerBetter?: boolean }) {
  const fairWins = lowerBetter ? fair < naive : false;
  return (
    <tr>
      <td className="px-5 py-3">
        <div className="font-medium">{label}</div>
        <div className="text-[12px] text-muted">{hint}</div>
      </td>
      <td className={cx('tabular px-3 py-3 text-right text-base font-semibold', fairWins && 'text-accent')}>
        {fair}
        {unit}
      </td>
      <td className="tabular px-5 py-3 text-right text-base text-ink-2">
        {naive}
        {unit}
      </td>
    </tr>
  );
}
