import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clock, FileDown, Gavel, ListChecks, NotebookPen, ShieldAlert, Square, Waypoints } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtDuration } from '@/lib/format';
import { AttemptBadge, DisputeBadge } from '@/components/status';
import { Badge, Button, Card, CardHeader, cx, EmptyState, ErrorBox, Spinner, Tabs } from '@/components/ui';
import { CompensationCard, ExtendTimeModal, ForceSubmitModal, IncidentItem, IncidentReviewModal, TransferCard } from '@/components/ops/actions';
import { CATEGORY_LABEL, EvidenceNotice, fmtScore, IntegrityPill } from '@/components/ops/bits';
import { useDownload, useNow } from '@/components/ops/hooks';
import { outcomeOf, QuestionReview, Scratchpad } from '@/components/ops/review';
import { EventTimeline } from '@/components/ops/timeline';
import type { AttemptDetail, Incident } from '@/components/ops/types';

type View = 'answers' | 'timeline' | 'scratchpad';
type QFilter = 'all' | 'lost' | 'written' | 'flagged';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}

export default function AttemptReview() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['attempt', id], queryFn: () => api<AttemptDetail>(`/staff/attempts/${id}`) });
  const now = useNow(1000);
  const dl = useDownload();
  const [view, setView] = useState<View>('answers');
  const [qf, setQf] = useState<QFilter>('all');
  const [extend, setExtend] = useState(false);
  const [force, setForce] = useState(false);
  const [reviewing, setReviewing] = useState<Incident | null>(null);

  const questions = q.data?.questions;
  const filtered = useMemo(
    () =>
      (questions ?? []).filter((x) => {
        if (qf === 'lost') return !x.voided && x.score < x.marks;
        if (qf === 'written') return x.type === 'WRITTEN';
        if (qf === 'flagged') return x.flagged;
        return true;
      }),
    [questions, qf],
  );

  if (q.isLoading) return <Spinner label="Loading attempt" />;
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const { attempt: a, candidate, incidents, compensations, transfers, disputes, events, scratchpad } = q.data;
  const qs = q.data.questions;
  const live = a.status === 'IN_PROGRESS';
  const published = !!a.exam.resultsPublishedAt;
  const passed = (a.score ?? 0) >= a.exam.passMarks;
  const end = a.submittedAt ? new Date(a.submittedAt).getTime() : now;
  const openInc = incidents.filter((i) => i.status === 'OPEN').length;
  const pendingDecisions = compensations.filter((c) => c.status === 'PENDING').length + transfers.filter((t) => t.status === 'PENDING').length;
  const needGrading = qs.filter((x) => outcomeOf(x) === 'pending').length;

  return (
    <div className="flex flex-col gap-5">
      {/* ---------- header ---------- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link to={live ? `/examiner/exams/${a.examId}/monitor` : `/examiner/exams/${a.examId}/results`} className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> {a.exam.title}
          </Link>
          <h1 className="display text-[28px] font-semibold leading-tight sm:text-[32px]">{candidate.name}</h1>
          <p className="mt-1 text-sm text-ink-2">
            {candidate.email}
            {candidate.groupName && <> · {candidate.groupName}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {live && (
            <>
              <Button variant="outline" icon={<Clock className="size-4" />} onClick={() => setExtend(true)}>
                Extend time
              </Button>
              <Button variant="danger" icon={<Square className="size-4" />} onClick={() => setForce(true)}>
                Force submit
              </Button>
            </>
          )}
          {!live && (
            <Button variant="outline" icon={<FileDown className="size-4" />} loading={!!dl.busy} onClick={() => dl.run(`/reports/attempts/${a.id}/pdf`, `result-${candidate.name}.pdf`)}>
              Candidate PDF
            </Button>
          )}
        </div>
      </header>

      {/* ---------- summary ---------- */}
      <Card className="overflow-hidden">
        <div className="grid gap-px bg-line sm:grid-cols-[minmax(0,240px)_1fr]">
          <div className={cx('flex flex-col justify-center gap-1 bg-surface px-5 py-4', !live && a.gradingStatus === 'GRADED' && (passed ? 'bg-ok-soft' : 'bg-danger-soft'))}>
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{live ? 'Score so far' : 'Score'}</span>
            <span className="tabular display text-4xl font-semibold">
              {fmtScore(a.score)}
              <span className="text-xl text-muted">/{a.maxScore}</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {live ? <Badge tone="info">Still writing</Badge> : a.gradingStatus !== 'GRADED' ? <Badge tone="warn">{needGrading} awaiting grading</Badge> : passed ? <Badge tone="ok">Pass</Badge> : <Badge tone="danger">Below pass mark ({a.exam.passMarks})</Badge>}
              {published && <Badge tone="accent">Published</Badge>}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 bg-surface px-5 py-4 md:grid-cols-4">
            <Fact label="Status">
              <AttemptBadge status={a.status} />
            </Fact>
            <Fact label="Integrity">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <IntegrityPill score={a.integrityScore} /> <span className="tabular whitespace-nowrap text-[12px] text-muted">{a.violationCount} warning{a.violationCount === 1 ? '' : 's'}</span>
              </span>
            </Fact>
            <Fact label="Started">{fmtDate(a.startedAt)}</Fact>
            <Fact label={live ? 'Time left' : 'Submitted'}>
              {live ? <span className="tabular">{fmtDuration(new Date(a.deadline).getTime() - now)}</span> : fmtDate(a.submittedAt)}
            </Fact>
            <Fact label="Time used">
              <span className="tabular">{fmtDuration(end - new Date(a.startedAt).getTime())}</span>
            </Fact>
            <Fact label="Extra time">{a.extraTimeSec ? <span className="tabular">+{Math.round(a.extraTimeSec / 60)} min</span> : 'None'}</Fact>
            <Fact label="Deadline">{fmtDate(a.deadline)}</Fact>
            <Fact label="Answered">
              <span className="tabular">
                {qs.filter((x) => outcomeOf(x) !== 'blank').length}/{qs.length}
              </span>
            </Fact>
          </dl>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---------- main ---------- */}
        <div className="min-w-0">
          <Tabs<View>
            className="mb-4"
            value={view}
            onChange={setView}
            tabs={[
              { id: 'answers', label: <span className="flex items-center gap-1.5"><ListChecks className="size-4" aria-hidden /> Answer sheet</span>, count: qs.length },
              { id: 'timeline', label: <span className="flex items-center gap-1.5"><Waypoints className="size-4" aria-hidden /> Timeline</span>, count: events.length },
              { id: 'scratchpad', label: <span className="flex items-center gap-1.5"><NotebookPen className="size-4" aria-hidden /> Scratchpad</span> },
            ]}
          />
          {view === 'answers' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter questions">
                {(
                  [
                    ['all', 'All'],
                    ['lost', 'Marks lost'],
                    ['written', 'Written'],
                    ['flagged', 'Flagged'],
                  ] as [QFilter, string][]
                ).map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={qf === k} onClick={() => setQf(k)} className={cx('h-8 rounded-full border px-3 text-[13px] font-medium', qf === k ? 'border-ink bg-ink text-surface' : 'border-line text-ink-2 hover:border-line-strong')}>
                    {label}
                  </button>
                ))}
                <nav aria-label="Jump to question" className="ml-auto hidden flex-wrap gap-1 md:flex">
                  {qs.map((x) => {
                    const o = outcomeOf(x);
                    return (
                      <a
                        key={x.id}
                        href={`#q-${x.position}`}
                        className={cx('tabular grid size-7 place-items-center rounded-md text-[11px] font-semibold', o === 'correct' || o === 'voided' ? 'bg-ok-soft text-ok' : o === 'partial' ? 'bg-warn-soft text-warn' : o === 'wrong' ? 'bg-danger-soft text-danger' : o === 'pending' ? 'bg-info-soft text-info' : 'bg-surface-2 text-muted')}
                        aria-label={`Question ${x.position}: ${o}`}
                      >
                        {x.position}
                      </a>
                    );
                  })}
                </nav>
              </div>
              {!filtered.length ? (
                <Card>
                  <EmptyState title="No questions in this view" />
                </Card>
              ) : (
                filtered.map((x) => <QuestionReview key={x.id} q={x} published={published} inProgress={live} />)
              )}
            </div>
          )}
          {view === 'timeline' && (
            <Card className="p-5">
              <EventTimeline events={events} startedAt={a.startedAt} />
            </Card>
          )}
          {view === 'scratchpad' && (
            <Card className="p-5">
              <Scratchpad data={scratchpad} />
            </Card>
          )}
        </div>

        {/* ---------- side ---------- */}
        <aside className="flex min-w-0 flex-col gap-5" aria-label="Integrity and decisions">
          <EvidenceNotice compact>Use the timeline to see what happened around each signal.</EvidenceNotice>

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><ShieldAlert className="size-4 text-warn" aria-hidden /> Incidents {openInc > 0 && <Badge tone="warn">{openInc} open</Badge>}</span>} />
            {!incidents.length ? (
              <p className="px-4 py-4 text-[13px] text-muted">No integrity signals were recorded.</p>
            ) : (
              <ul className="max-h-[420px] divide-y divide-line overflow-y-auto px-4">
                {[...incidents].reverse().map((i) => (
                  <IncidentItem key={i.id} i={{ ...i, candidate: candidate.name }} onReview={setReviewing} />
                ))}
              </ul>
            )}
          </Card>

          {(compensations.length > 0 || transfers.length > 0) && (
            <Card>
              <CardHeader title="Time & device decisions" subtitle={pendingDecisions ? `${pendingDecisions} waiting for you` : 'All decided'} />
              <div className="flex flex-col gap-2.5 p-3">
                {transfers.map((t) => (
                  <TransferCard key={t.id} t={t} name={candidate.name} stale={!live} />
                ))}
                {compensations.map((c) => (
                  <CompensationCard key={c.id} c={c} name={candidate.name} attemptStatus={a.status} />
                ))}
              </div>
            </Card>
          )}

          {disputes.length > 0 && (
            <Card>
              <CardHeader title={<span className="flex items-center gap-2"><Gavel className="size-4 text-accent" aria-hidden /> Disputes</span>} actions={<Link to="/examiner/disputes" className="text-[13px] font-medium text-accent hover:underline">Open queue →</Link>} />
              <ul className="divide-y divide-line">
                {disputes.map((d) => (
                  <li key={d.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{CATEGORY_LABEL[d.category] ?? d.category}</span>
                      <DisputeBadge status={d.status} />
                    </div>
                    <p className="mt-1 line-clamp-3 text-[13px] text-ink-2">{d.message}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {(a.ipAddress || a.userAgent) && (
            <Card className="px-4 py-3 text-[12px] text-muted">
              <div className="font-semibold uppercase tracking-wide">Session</div>
              {a.ipAddress && <div className="mt-1 font-mono">{a.ipAddress}</div>}
              {a.userAgent && <div className="mt-0.5 break-words">{a.userAgent}</div>}
            </Card>
          )}
        </aside>
      </div>

      <IncidentReviewModal incident={reviewing} onClose={() => setReviewing(null)} />
      {extend && <ExtendTimeModal open attemptId={a.id} name={candidate.name} onClose={() => setExtend(false)} />}
      {force && <ForceSubmitModal open attemptId={a.id} name={candidate.name} onClose={() => setForce(false)} />}
    </div>
  );
}
