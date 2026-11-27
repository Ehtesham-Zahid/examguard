import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, Check, Download, Flag, MessageSquareWarning, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { useDownload } from '@/components/ops/hooks';
import { fmtDate, pct } from '@/lib/format';
import { Badge, Button, Card, CardHeader, cx, ErrorBox, Field, Modal, Select, Spinner, Stat, Textarea } from '@/components/ui';
import { DisputeBadge } from '@/components/status';
import { RichText } from '@/components/RichText';
import FlipCard from '@/components/bits/FlipCard';
import CountUp from '@/components/bits/CountUp';
import { confetti } from '@/lib/confetti';

interface Detail {
  exam: { id: string; title: string; passMarks: number; publishedAt: string };
  attempt: { id: string; score: number; maxScore: number; status: string; submittedAt: string; startedAt: string };
  passed: boolean;
  rank: number;
  totalCandidates: number;
  percentile: number | null;
  topics: { name: string; scored: number; max: number; pct: number }[];
  certificateCode?: string;
  disputes: { id: string; status: string; category: string; message: string; resolution: string | null; createdAt: string }[];
  questions: { id: string; position: number; type: string; topic: string; body: string; options: { id: string; text: string }[]; marks: number; response: unknown; score: number; feedback: string | null; voided: boolean; correct?: string[] }[];
}

const CATS = [
  ['GRADING_ERROR', 'Grading error — my answer was marked incorrectly'],
  ['AMBIGUOUS_QUESTION', 'Ambiguous question — more than one answer is defensible'],
  ['TECHNICAL_ISSUE', 'Technical issue — a problem during the exam affected me'],
  ['OTHER', 'Other'],
];

export default function ResultDetail() {
  const { attemptId = '' } = useParams();
  const qc = useQueryClient();
  const dl = useDownload();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['result', attemptId], queryFn: () => api<Detail>(`/candidate/attempts/${attemptId}/result`) });
  const [dispute, setDispute] = useState<{ questionId: string | null } | null>(null);
  const [revealed, setRevealed] = useState(() => {
    try {
      return sessionStorage.getItem(`eg_reveal_${attemptId}`) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (revealed) try { sessionStorage.setItem(`eg_reveal_${attemptId}`, '1'); } catch { /* ignore */ }
  }, [revealed, attemptId]);
  const [category, setCategory] = useState('GRADING_ERROR');
  const [message, setMessage] = useState('');
  const [msgErr, setMsgErr] = useState('');
  const raise = useMutation({
    mutationFn: () => api(`/candidate/attempts/${attemptId}/disputes`, { body: { questionId: dispute?.questionId, category, message } }),
    onSuccess: () => {
      toast.success('Dispute submitted. You can follow its progress under Disputes.');
      setDispute(null);
      setMessage('');
      qc.invalidateQueries({ queryKey: ['result', attemptId] });
      qc.invalidateQueries({ queryKey: ['my-disputes'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} onRetry={refetch} />;
  const p = pct(data.attempt.score, data.attempt.maxScore);
  // the server accepts disputes for 7 days after publication; don't invite one it will refuse
  const disputeOpen = !data.exam.publishedAt || Date.now() - new Date(data.exam.publishedAt).getTime() < 7 * 86_400_000;

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/candidate/results" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> All results</Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Result · published {fmtDate(data.exam.publishedAt)}</p>
          <h1 className="display mt-1 text-[30px] font-semibold">{data.exam.title}</h1>
        </div>
        <div className="flex gap-2">
          {disputeOpen ? (
            <Button variant="outline" icon={<MessageSquareWarning className="size-4" />} onClick={() => setDispute({ questionId: null })}>Raise a dispute</Button>
          ) : (
            <span className="inline-flex h-10 items-center rounded-lg border border-dashed border-line-strong px-3 text-[13px] text-muted">Dispute window closed (7 days)</span>
          )}
          <Button icon={<Download className="size-4" />} loading={dl.busy !== null} onClick={() => dl.run(`/reports/attempts/${attemptId}/pdf`, 'result.pdf')}>Download report</Button>
        </div>
      </div>

      <div className="mb-8 flex flex-col items-center gap-3">
        <FlipCard
          width={340}
          height={200}
          radius={18}
          tilt
          glare
          glareOpacity={0.18}
          background="var(--surface)"
          color="var(--ink)"
          shadowColor="#172A46"
          shadowOpacity={0.18}
          defaultFlipped={revealed}
          onFlipChange={(f) => {
            if (f && !revealed) {
              setRevealed(true);
              if (data.passed) confetti();
            }
          }}
          ariaLabel={revealed ? `Your score: ${data.attempt.score} out of ${data.attempt.maxScore}, ${p}%, ${data.passed ? 'passed' : 'not passed'}` : 'Result card — activate to reveal your score'}
          front={
            <div className="grid-paper relative flex h-full w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-[18px] border-2 border-ink p-6 text-center">
              <span className="absolute inset-y-0 left-6 w-[1.5px] bg-margin/60" aria-hidden />
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-2">Your result is in</span>
              <span className="display text-2xl font-bold"><span className="hl">Tap to reveal</span></span>
              <span className="text-xs text-muted">or press Enter</span>
            </div>
          }
          back={
            <div className={cx('relative flex h-full w-full flex-col items-center justify-center gap-1 rounded-[18px] border-2 p-6 text-center', data.passed ? 'border-ok bg-ok-soft' : 'border-danger bg-danger-soft')}>
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-2">Score</span>
              <span className="display tabular text-[46px] font-bold leading-none">
                {revealed ? <CountUp to={data.attempt.score ?? 0} decimals={Number.isInteger(data.attempt.score) ? 0 : 1} duration={1.1} trigger="load" /> : data.attempt.score}
                <span className="text-xl text-muted"> / {data.attempt.maxScore}</span>
              </span>
              <Badge tone={data.passed ? 'ok' : 'danger'} className="mt-2 text-[13px]">{data.passed ? '🎉 Passed' : 'Not passed'} · {p}%</Badge>
            </div>
          }
        />
      </div>

      <div className="stagger mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Rank" value={`${data.rank} / ${data.totalCandidates}`} hint={data.percentile !== null ? `Better than ${data.percentile}% of candidates` : undefined} />
        <Stat label="Pass mark" value={data.exam.passMarks} />
        {data.certificateCode && (
          <Card className="p-4">
            <div className="flex items-center gap-1.5 text-[13px] text-muted"><BadgeCheck className="size-4 text-ok" /> Verification code</div>
            <div className="mt-2 font-mono text-[15px] font-semibold">{data.certificateCode}</div>
            <Link to={`/verify/${data.certificateCode}`} className="mt-1 inline-block text-xs font-medium text-accent hover:underline">Check authenticity →</Link>
          </Card>
        )}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader title="Strengths by topic" />
          <div className="h-64 p-2">
            <ResponsiveContainer>
              <RadarChart data={data.topics} outerRadius="72%">
                <PolarGrid stroke="var(--line-strong)" />
                <PolarAngleAxis dataKey="name" tick={{ fill: 'var(--ink-2)', fontSize: 12 }} />
                <Radar dataKey="pct" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.25} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHeader title="Topic breakdown" />
          <ul className="space-y-4 p-5">
            {data.topics.map((t) => (
              <li key={t.name}>
                <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{t.name}</span><span className="tabular text-muted">{Math.round(t.scored * 100) / 100} / {t.max} · {t.pct}%</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className={cx('h-full rounded-full', t.pct >= 70 ? 'bg-ok' : t.pct >= 40 ? 'bg-warn' : 'bg-danger')} style={{ width: `${Math.max(0, t.pct)}%` }} /></div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {!!data.disputes.length && (
        <Card className="mb-6">
          <CardHeader title="Your disputes" actions={<Link to="/candidate/disputes" className="text-sm font-medium text-accent hover:underline">Track all</Link>} />
          <ul className="divide-y divide-line">
            {data.disputes.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <DisputeBadge status={d.status} />
                <span className="flex-1 truncate text-ink-2">{d.message}</span>
                {d.resolution && <span className="text-xs text-muted">“{d.resolution}”</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Question-by-question" subtitle={data.questions[0]?.correct ? 'Correct answers are shown because your examiner enabled it.' : 'Your examiner has chosen not to reveal correct answers.'} />
        <ol className="divide-y divide-line">
          {data.questions.map((q) => {
            const sel = Array.isArray(q.response) ? (q.response as string[]) : [];
            const full = q.score >= q.marks;
            return (
              <li key={q.id} className="p-5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Q{q.position}</span>
                  <Badge>{q.topic}</Badge>
                  {q.voided && <Badge tone="info">Voided — full marks awarded</Badge>}
                  <span className={cx('ml-auto tabular text-sm font-semibold', full ? 'text-ok' : q.score > 0 ? 'text-warn' : 'text-danger')}>{q.score} / {q.marks}</span>
                  {disputeOpen && <button onClick={() => setDispute({ questionId: q.id })} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Dispute question ${q.position}`} title="Dispute this question"><Flag className="size-4" /></button>}
                </div>
                <RichText text={q.body} className="text-[15px] text-ink-2" />
                {q.type !== 'WRITTEN' ? (
                  <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                    {q.options.map((o, i) => {
                      const mine = sel.includes(o.id);
                      const right = q.correct?.includes(o.id);
                      return (
                        <li key={o.id} className={cx('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', mine && right && 'border-ok bg-ok-soft', mine && q.correct && !right && 'border-danger bg-danger-soft', mine && !q.correct && 'border-accent bg-accent-soft', !mine && right && 'border-ok border-dashed', !mine && !right && 'border-line')}>
                          <span className="font-mono text-xs text-muted">{String.fromCharCode(65 + i)}</span>
                          <span className="flex-1">{o.text}</span>
                          {mine && <span className="text-xs text-muted">your answer</span>}
                          {right !== undefined && (right ? <Check className="size-4 text-ok" /> : mine ? <X className="size-4 text-danger" /> : null)}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="mt-3 whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 text-sm">{(q.response as { text?: string } | null)?.text || <span className="text-muted">No answer</span>}</div>
                )}
                {q.feedback && <p className="mt-2 rounded-lg bg-info-soft px-3 py-2 text-sm text-info"><strong>Examiner feedback:</strong> {q.feedback}</p>}
              </li>
            );
          })}
        </ol>
      </Card>

      <Modal
        open={!!dispute}
        onClose={() => setDispute(null)}
        title="Raise a dispute"
        description={dispute?.questionId ? `About question ${data.questions.find((q) => q.id === dispute.questionId)?.position}` : 'About the whole result'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDispute(null)}>Cancel</Button>
            <Button
              loading={raise.isPending}
              onClick={() => {
                if (message.trim().length < 20) return setMsgErr('Please explain in at least 20 characters so the examiner can review it.');
                setMsgErr('');
                raise.mutate();
              }}
            >
              Submit dispute
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Reason">{(id) => <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>
          <Field label="Explain the issue" error={msgErr} hint={`${message.trim().length}/20 characters minimum`}>{(id) => <Textarea id={id} value={message} onChange={(e) => setMessage(e.target.value)} rows={5} placeholder="Describe what you think is wrong and why." />}</Field>
          <p className="text-xs text-muted">Every decision is recorded in a tamper-evident audit log and you'll be notified of the outcome. If your dispute reveals a flawed question, every affected candidate is re-graded — not just you.</p>
        </div>
      </Modal>
    </div>
  );
}
