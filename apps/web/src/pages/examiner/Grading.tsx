import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, BookCheck, CheckCircle2, ClipboardList, EyeOff, PartyPopper, Save } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { RichText } from '@/components/RichText';
import { Badge, Button, Card, cx, EmptyState, ErrorBox, Field, Kbd, PageHeader, ProgressBar, Spinner, Textarea, Toggle } from '@/components/ui';
import { ScoreInput, validateScore, WrittenResponse } from '@/components/ops/answers';
import { fmtScore } from '@/components/ops/bits';
import { useHotkeys } from '@/components/ops/hooks';
import type { GradingData, GradingItem } from '@/components/ops/types';

interface ExamLite {
  id: string;
  title: string;
  resultsPublishedAt: string | null;
}

const currentScore = (i: GradingItem) => i.manualScore ?? i.autoScore;

export default function Grading() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [anonymous, setAnonymous] = useState(true);
  const key = ['grading', id, anonymous];
  const q = useQuery({ queryKey: key, queryFn: () => api<GradingData>(`/staff/exams/${id}/grading?anonymous=${anonymous}`), placeholderData: (prev) => prev });
  const exam = useQuery({ queryKey: ['exam', id], queryFn: () => api<ExamLite>(`/exams/${id}`) });

  const [qi, setQi] = useState(0);
  const [ai, setAi] = useState(0);
  const initialised = useRef(false);

  // On first load jump to the first ungraded answer
  useEffect(() => {
    if (!q.data || initialised.current) return;
    initialised.current = true;
    const g = q.data.groups.findIndex((x) => x.items.some((i) => !i.graded));
    if (g >= 0) {
      setQi(g);
      setAi(Math.max(0, q.data.groups[g].items.findIndex((i) => !i.graded)));
    }
  }, [q.data]);

  const group = q.data?.groups[qi];
  const item = group?.items[ai];

  /* ---------- form state for the current answer ---------- */
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const scoreRef = useRef<HTMLInputElement>(null);
  const itemKey = item?.answerId ?? `${qi}:${ai}`;
  useEffect(() => {
    if (!item) return;
    const s = currentScore(item);
    setScore(s == null ? '' : String(s));
    setFeedback(item.feedback ?? '');
    setTouched(false);
    // focus the score box for fast keyboard grading
    setTimeout(() => scoreRef.current?.focus({ preventScroll: true }), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  const published = !!exam.data?.resultsPublishedAt;
  const scoreErr = item ? validateScore(score, item.marks) : null;
  const reasonErr = published && reason.trim().length < 3 ? 'Results are published — give a reason for changing this grade' : null;

  const goto = (g: number, a: number) => {
    if (!q.data) return;
    const groups = q.data.groups;
    if (g < 0 || g >= groups.length) return;
    setQi(g);
    setAi(Math.max(0, Math.min(a, groups[g].items.length - 1)));
  };
  const next = () => {
    if (!q.data || !group) return;
    if (ai < group.items.length - 1) setAi(ai + 1);
    else if (qi < q.data.groups.length - 1) goto(qi + 1, 0);
  };
  const prev = () => {
    if (!q.data) return;
    if (ai > 0) setAi(ai - 1);
    else if (qi > 0) goto(qi - 1, q.data.groups[qi - 1].items.length - 1);
  };
  const nextUngraded = () => {
    if (!q.data) return;
    const flat = q.data.groups.flatMap((g, gi) => g.items.map((it, ii) => ({ gi, ii, it })));
    const cur = flat.findIndex((x) => x.gi === qi && x.ii === ai);
    const hit = [...flat.slice(cur + 1), ...flat.slice(0, cur)].find((x) => !x.it.graded);
    if (hit) goto(hit.gi, hit.ii);
    else toast.success('Every answer is graded');
  };

  const save = useMutation({
    mutationFn: (v: { answerId: string; score: number; feedback: string }) =>
      api<{ attemptScore: number; gradingStatus: string }>(`/staff/answers/${v.answerId}/grade`, { method: 'PUT', body: { score: v.score, feedback: v.feedback || undefined, reason: published ? reason.trim() : undefined } }),
    onSuccess: (_r, v) => {
      // update every cached variant (anonymous / named) so progress moves instantly
      qc.setQueriesData<GradingData>({ queryKey: ['grading', id] }, (old) => {
        if (!old) return old;
        let newlyDone = 0;
        const groups = old.groups.map((g) => ({
          ...g,
          items: g.items.map((i) => {
            if (i.answerId !== v.answerId) return i;
            if (!i.graded) newlyDone++;
            return { ...i, manualScore: v.score, feedback: v.feedback, graded: true };
          }),
        }));
        return { groups, progress: { ...old.progress, done: old.progress.done + newlyDone } };
      });
      qc.invalidateQueries({ queryKey: ['results'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
      qc.invalidateQueries({ queryKey: ['attempt'] });
      toast.success(`Saved ${v.score}/${item?.marks}`, { duration: 1500 });
      next();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const submit = () => {
    setTouched(true);
    if (!item?.answerId) return;
    if (scoreErr || reasonErr) {
      scoreRef.current?.focus();
      return;
    }
    save.mutate({ answerId: item.answerId, score: Number(score), feedback: feedback.trim() });
  };

  useHotkeys({ j: next, k: prev, n: nextUngraded, Enter: (e) => !(e.target as HTMLElement).closest('button,a') && submit(), '0': () => item && setScore('0'), h: () => item && setScore(String(Math.round((item.marks / 2) * 100) / 100)), f: () => item && setScore(String(item.marks)) });

  const progress = q.data?.progress ?? { total: 0, done: 0 };
  const complete = progress.total > 0 && progress.done >= progress.total;
  const header = (
    <PageHeader
      eyebrow="Manual grading"
      title="Grade written answers"
      subtitle={exam.data ? exam.data.title : 'Question by question, so every candidate is judged against the same rubric in one sitting.'}
      actions={
        <>
          <div className="rounded-lg border border-line bg-surface px-3">
            <Toggle checked={anonymous} onChange={setAnonymous} label="Blind marking" description="Hide candidate names" />
          </div>
          <Link to={`/examiner/exams/${id}/results`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2">
            Results
          </Link>
        </>
      }
    />
  );

  if (q.isLoading) return <>{header}<Spinner label="Loading answers" /></>;
  if (q.error || !q.data) return <>{header}<ErrorBox error={q.error} onRetry={() => q.refetch()} /></>;
  if (!q.data.groups.length)
    return (
      <>
        {header}
        <Card>
          <EmptyState icon={<ClipboardList className="size-6" />} title="Nothing to grade by hand" body="This exam has no submitted written answers. Multiple-choice questions are marked automatically." action={<Link className="text-sm font-medium text-accent hover:underline" to={`/examiner/exams/${id}/results`}>Go to results →</Link>} />
        </Card>
      </>
    );

  const groups = q.data.groups;
  return (
    <div>
      {header}

      {/* overall progress */}
      <Card className={cx('mb-5 flex flex-wrap items-center gap-4 px-5 py-4', complete && 'border-ok/40 bg-ok-soft')}>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">{complete ? 'All answers graded' : 'Overall progress'}</span>
            <span className="tabular text-sm text-ink-2">
              <strong className="text-ink">{progress.done}</strong> / {progress.total} answers
            </span>
          </div>
          <ProgressBar value={progress.done} max={progress.total} tone={complete ? 'ok' : 'accent'} className="h-2" label="Grading progress" />
        </div>
        {complete ? (
          <Link to={`/examiner/exams/${id}/results`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink shadow-sm hover:brightness-110">
            <PartyPopper className="size-4" aria-hidden /> Review &amp; publish results
          </Link>
        ) : (
          <Button variant="outline" onClick={nextUngraded}>
            Next ungraded <Kbd>N</Kbd>
          </Button>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* question list */}
        <nav aria-label="Written questions" className="lg:sticky lg:top-4 lg:self-start">
          <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {groups.map((g, i) => {
              const done = g.items.filter((x) => x.graded).length;
              const full = done === g.items.length;
              return (
                <li key={g.questionId} className="min-w-60 lg:min-w-0">
                  <button
                    type="button"
                    onClick={() => goto(i, 0)}
                    aria-current={i === qi ? 'true' : undefined}
                    className={cx('w-full rounded-xl border px-3.5 py-3 text-left transition', i === qi ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Question {i + 1}</span>
                      {full ? <CheckCircle2 className="size-4 text-ok" aria-label="Fully graded" /> : <span className="tabular text-[12px] text-ink-2">{done}/{g.items.length}</span>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13px] text-ink">{g.body.replace(/[`*]/g, '')}</p>
                    <ProgressBar value={done} max={g.items.length} tone={full ? 'ok' : 'accent'} className="mt-2" label={`Question ${i + 1}: ${done} of ${g.items.length} graded`} />
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {group && item && (
          <div className="flex min-w-0 flex-col gap-4">
            {/* question + rubric */}
            <Card className="p-5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone="accent">Question {qi + 1}</Badge>
                <Badge>{group.marks} marks</Badge>
              </div>
              <RichText text={group.body} className="exam-text text-ink" />
              {group.rubric && (
                <div className="mt-4 rounded-lg border border-line bg-surface-2/60 p-3.5">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-2">
                    <BookCheck className="size-4 text-accent" aria-hidden /> Marking rubric
                  </div>
                  <ul className="flex flex-col gap-1 text-[13px] text-ink">
                    {group.rubric.split('\n').filter(Boolean).map((line, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            {/* answer */}
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
                <div className="flex items-center gap-2">
                  {anonymous && <EyeOff className="size-4 text-muted" aria-label="Blind marking on" />}
                  <span className="font-semibold">{item.candidate}</span>
                  {item.graded ? <Badge tone="ok">Graded · {fmtScore(currentScore(item))}</Badge> : <Badge tone="warn">Not graded</Badge>}
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={prev} disabled={qi === 0 && ai === 0} aria-label="Previous answer (K)">
                    <ArrowLeft className="size-4" aria-hidden /> <Kbd>K</Kbd>
                  </Button>
                  <span className="tabular px-1 text-[13px] text-ink-2" aria-live="polite">
                    Answer {ai + 1} of {group.items.length}
                  </span>
                  <Button size="sm" variant="ghost" onClick={next} disabled={qi === groups.length - 1 && ai === group.items.length - 1} aria-label="Next answer (J)">
                    <Kbd>J</Kbd> <ArrowRight className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
              {/* jump strip */}
              <div className="flex flex-wrap gap-1 border-b border-line px-5 py-2" role="group" aria-label="Jump to answer">
                {group.items.map((it, i) => (
                  <button
                    key={it.answerId ?? i}
                    type="button"
                    onClick={() => setAi(i)}
                    aria-label={`Answer ${i + 1}${it.graded ? ', graded' : ', not graded'}`}
                    aria-current={i === ai ? 'true' : undefined}
                    className={cx('tabular grid size-7 place-items-center rounded-md text-[11px] font-semibold transition', i === ai ? 'bg-ink text-surface' : it.graded ? 'bg-ok-soft text-ok' : 'bg-surface-2 text-ink-2 hover:bg-line')}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <div className="px-5 py-4">
                <WrittenResponse text={item.text} />
                {!item.text.trim() && <p className="mt-2 text-[12px] text-muted">Blank answers are scored 0 automatically — you can still override.</p>}
              </div>

              <form
                className="grid gap-4 border-t border-line bg-surface-2/40 px-5 py-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <Field label="Score" required error={touched ? (scoreErr ?? undefined) : undefined}>
                  {(fid) => <ScoreInput ref={scoreRef} id={fid} value={score} onChange={setScore} marks={item.marks} error={touched ? scoreErr : null} onEnter={submit} disabled={!item.answerId} />}
                </Field>
                <Field label="Feedback for the candidate (optional)" hint={<>Shown with the result. <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> saves.</>}>
                  {(fid) => (
                    <Textarea
                      id={fid}
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      maxLength={3000}
                      className="min-h-20"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          submit();
                        }
                      }}
                    />
                  )}
                </Field>
                {published && (
                  <Field label="Reason for change" required error={touched ? (reasonErr ?? undefined) : undefined} hint="Results are already published. The change re-signs the certificate and is audited.">
                    {(fid) => <Textarea id={fid} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="min-h-16" />}
                  </Field>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="hidden text-[12px] text-muted sm:block">
                    <Kbd>J</Kbd>/<Kbd>K</Kbd> next/prev · <Kbd>0</Kbd> <Kbd>H</Kbd> <Kbd>F</Kbd> zero/half/full · <Kbd>Enter</Kbd> save &amp; next · <Kbd>N</Kbd> next ungraded
                  </p>
                  <Button type="submit" loading={save.isPending} disabled={!item.answerId} icon={<Save className="size-4" />}>
                    Save &amp; next
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
