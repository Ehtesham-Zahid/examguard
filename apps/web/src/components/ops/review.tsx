import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BookCheck, Clock, Flag, Save } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { RichText } from '@/components/RichText';
import { TYPE_LABEL } from '@/components/status';
import { Badge, Button, Card, cx, Field, Textarea } from '@/components/ui';
import type { ReviewQuestion } from './types';
import { OptionList, ScoreInput, selectedOf, textOf, validateScore, WrittenResponse } from './answers';
import { fmtScore, fmtSec } from './bits';
import { useInvalidateOps } from './actions';

export function outcomeOf(q: ReviewQuestion): 'correct' | 'partial' | 'wrong' | 'blank' | 'pending' | 'voided' {
  if (q.voided) return 'voided';
  const blank = q.type === 'WRITTEN' ? !textOf(q.response).trim() : !selectedOf(q.response).length;
  if (blank) return 'blank';
  if (q.type === 'WRITTEN' && q.manualScore == null && q.autoScore == null) return 'pending';
  if (q.score >= q.marks) return 'correct';
  if (q.score > 0) return 'partial';
  return 'wrong';
}
const OUTCOME: Record<ReturnType<typeof outcomeOf>, { tone: 'ok' | 'warn' | 'danger' | 'neutral' | 'info'; label: string }> = {
  correct: { tone: 'ok', label: 'Full marks' },
  partial: { tone: 'warn', label: 'Partial' },
  wrong: { tone: 'danger', label: 'Incorrect' },
  blank: { tone: 'neutral', label: 'Not answered' },
  pending: { tone: 'info', label: 'Needs grading' },
  voided: { tone: 'neutral', label: 'Voided — full marks' },
};

function InlineGrade({ q, published, disabled }: { q: ReviewQuestion; published: boolean; disabled?: boolean }) {
  const invalidate = useInvalidateOps();
  const initial = q.manualScore ?? q.autoScore;
  const [score, setScore] = useState(initial == null ? '' : String(initial));
  const [feedback, setFeedback] = useState(q.feedback ?? '');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const scoreErr = validateScore(score, q.marks);
  const reasonErr = published && reason.trim().length < 3 ? 'Results are published — a reason is required' : null;
  const dirty = score !== (initial == null ? '' : String(initial)) || feedback !== (q.feedback ?? '');
  const mut = useMutation({
    mutationFn: () => api<{ attemptScore: number }>(`/staff/answers/${q.answerId}/grade`, { method: 'PUT', body: { score: Number(score), feedback: feedback.trim() || undefined, reason: published ? reason.trim() : undefined } }),
    onSuccess: (r) => {
      toast.success(`Q${q.position} graded ${score}/${q.marks}`, { description: `Attempt total is now ${fmtScore(r.attemptScore)}.` });
      setReason('');
      setTouched(false);
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const submit = () => {
    setTouched(true);
    if (!scoreErr && !reasonErr && q.answerId) mut.mutate();
  };
  return (
    <form
      className="mt-4 grid gap-3 rounded-lg border border-line bg-surface-2/40 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Score" error={touched ? (scoreErr ?? undefined) : undefined}>
        {(id) => <ScoreInput id={id} value={score} onChange={setScore} marks={q.marks} error={touched ? scoreErr : null} disabled={disabled || !q.answerId} onEnter={submit} />}
      </Field>
      <Field label="Feedback (optional)">{(id) => <Textarea id={id} value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={3000} className="min-h-16" disabled={disabled} />}</Field>
      {published && (
        <Field label="Reason for change" required error={touched ? (reasonErr ?? undefined) : undefined} hint="Results are published: the change is audited and the certificate re-signed.">
          {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="min-h-14" disabled={disabled} />}
        </Field>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={mut.isPending} disabled={disabled || !q.answerId || (!dirty && initial != null)} icon={<Save className="size-4" />}>
          Save grade
        </Button>
      </div>
    </form>
  );
}

export function QuestionReview({ q, published, inProgress }: { q: ReviewQuestion; published: boolean; inProgress: boolean }) {
  const o = OUTCOME[outcomeOf(q)];
  const [showRubric, setShowRubric] = useState(false);
  return (
    <Card id={`q-${q.position}`} className="scroll-mt-24 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <span className="display text-lg font-semibold">Q{q.position}</span>
        <Badge>{TYPE_LABEL[q.type]}</Badge>
        <span className="text-[12px] text-muted">{q.topic}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {q.flagged && (
            <Badge tone="warn">
              <Flag className="size-3" aria-hidden /> Flagged by candidate
            </Badge>
          )}
          <span className="tabular inline-flex items-center gap-1 text-[12px] text-muted" title="Time spent on this question">
            <Clock className="size-3.5" aria-hidden /> {fmtSec(q.timeSpentMs / 1000)}
          </span>
          <Badge tone={o.tone}>{o.label}</Badge>
          <span className={cx('tabular rounded-md px-2 py-0.5 text-sm font-semibold', q.score >= q.marks ? 'bg-ok-soft text-ok' : q.score > 0 ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-ink-2')}>
            {fmtScore(q.score)}/{q.marks}
          </span>
        </div>
      </div>
      <div className="px-5 py-4">
        <RichText text={q.body} className="exam-text mb-3 text-ink" />
        {q.type === 'WRITTEN' ? (
          <>
            <WrittenResponse text={textOf(q.response)} />
            {q.rubric && (
              <div className="mt-3">
                <button type="button" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline" aria-expanded={showRubric} onClick={() => setShowRubric((v) => !v)}>
                  <BookCheck className="size-4" aria-hidden /> {showRubric ? 'Hide rubric' : 'Show rubric'}
                </button>
                {showRubric && <pre className="mt-2 rounded-lg bg-surface-2/60 p-3 font-sans text-[13px] whitespace-pre-wrap text-ink-2">{q.rubric}</pre>}
              </div>
            )}
            {inProgress ? <p className="mt-3 text-[12px] text-muted">Grading opens once the candidate submits.</p> : <InlineGrade key={`${q.answerId}-${q.manualScore}-${q.autoScore}`} q={q} published={published} />}
          </>
        ) : q.options?.length ? (
          <>
            <OptionList options={q.options} order={q.optionOrder} correct={q.correct} selected={selectedOf(q.response)} />
            {!selectedOf(q.response).length && <p className="mt-2 text-[13px] italic text-muted">The candidate did not choose an option.</p>}
          </>
        ) : null}
        {q.feedback && q.type !== 'WRITTEN' && <p className="mt-3 text-[13px] text-ink-2">Feedback: {q.feedback}</p>}
      </div>
    </Card>
  );
}

export function Scratchpad({ data }: { data: { canvas: string; notes: string; updatedAt: string } | null }) {
  const hasCanvas = !!data?.canvas && data.canvas.startsWith('data:image/');
  if (!data || (!hasCanvas && !data.notes.trim())) return <p className="py-6 text-center text-sm text-muted">The candidate didn't use the scratchpad.</p>;
  return (
    <div className="grid gap-4">
      {hasCanvas && (
        <figure>
          <img src={data.canvas} alt="Candidate's scratchpad drawing" className="w-full rounded-lg border border-line bg-white" />
          <figcaption className="mt-1 text-[12px] text-muted">Drawing canvas (rough work — not graded)</figcaption>
        </figure>
      )}
      {data.notes.trim() && (
        <div>
          <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Notes</div>
          <pre className="rounded-lg border border-line bg-surface-2/40 p-3 font-mono text-[13px] whitespace-pre-wrap text-ink">{data.notes}</pre>
        </div>
      )}
    </div>
  );
}
