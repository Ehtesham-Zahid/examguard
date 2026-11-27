import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, BarChart3, CalendarClock, CheckCircle2, ClipboardPen, FilePen, Gavel, MonitorPlay, PauseCircle, Plus, Radio, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDay, fmtTime, relative } from '@/lib/format';
import { Badge, Card, CardHeader, cx, EmptyState, ErrorBox, PageHeader, ProgressBar, Spinner } from '@/components/ui';
import type { ExamListItem } from '@/components/setup/types';

interface DisputeLite {
  id: string;
  attempt: { exam: { id: string; title: string } };
}

const linkBtn = 'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition';

export default function ExaminerDashboard() {
  const { user } = useAuth();
  const exams = useQuery({ queryKey: ['exams'], queryFn: () => api<ExamListItem[]>('/exams'), refetchInterval: 30000 });
  const disputes = useQuery({ queryKey: ['disputes', 'OPEN'], queryFn: () => api<DisputeLite[]>('/staff/disputes?status=OPEN') });

  const g = useMemo(() => {
    const all = exams.data ?? [];
    const by = (p: string) => all.filter((e) => e.phase === p);
    const week = Date.now() + 7 * 86400_000;
    return {
      live: by('ONGOING').sort((a, b) => +new Date(a.windowEnd) - +new Date(b.windowEnd)),
      upcoming: by('PUBLISHED').sort((a, b) => +new Date(a.windowStart) - +new Date(b.windowStart)),
      thisWeek: by('PUBLISHED').filter((e) => +new Date(e.windowStart) < week).length,
      unpublished: by('COMPLETED').filter((e) => !e.resultsPublishedAt).sort((a, b) => +new Date(b.windowEnd) - +new Date(a.windowEnd)),
      drafts: by('DRAFT').sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
      noCandidates: by('PUBLISHED').filter((e) => e.stats.enrolled === 0),
    };
  }, [exams.data]);

  const openDisputes = disputes.data?.length ?? 0;
  const disputeExams = useMemo(() => {
    const m = new Map<string, { title: string; n: number }>();
    disputes.data?.forEach((d) => {
      const x = m.get(d.attempt.exam.id) ?? { title: d.attempt.exam.title, n: 0 };
      x.n++;
      m.set(d.attempt.exam.id, x);
    });
    return m;
  }, [disputes.data]);

  const todo = g.unpublished.length + openDisputes + g.noCandidates.length;

  return (
    <div>
      <PageHeader
        eyebrow={new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        title={`Welcome back, ${firstName(user?.name)}`}
        subtitle={exams.data ? summaryLine(g.live.length, todo, g.thisWeek) : 'Here’s what needs you today.'}
        actions={
          <Link to="/examiner/exams?new=1" className={cx(linkBtn, 'h-10 bg-accent px-4 text-sm text-accent-ink shadow-sm hover:brightness-110')}>
            <Plus className="size-4" aria-hidden /> New examination
          </Link>
        }
      />

      {exams.isLoading ? (
        <Spinner label="Loading your examinations" />
      ) : exams.isError ? (
        <ErrorBox error={exams.error} onRetry={() => exams.refetch()} />
      ) : (
        <div className="space-y-6">
          {/* Live now */}
          {g.live.length > 0 && (
            <section aria-labelledby="live-h">
              <h2 id="live-h" className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-ok">
                <span className="pulse-dot size-2 rounded-full bg-ok" aria-hidden /> Live now
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                {g.live.map((e) => (
                  <LiveCard key={e.id} e={e} />
                ))}
              </div>
            </section>
          )}

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            {/* Action queue */}
            <Card>
              <CardHeader title="Needs your attention" subtitle={todo ? `${todo} thing${todo === 1 ? '' : 's'} waiting on you` : undefined} />
              {todo === 0 ? (
                <EmptyState icon={<CheckCircle2 className="size-6" />} title="You’re all caught up" body="No results to publish, no open disputes, every scheduled exam has candidates." />
              ) : (
                <ul className="divide-y divide-line">
                  {g.unpublished.map((e) => (
                    <TodoRow
                      key={e.id}
                      icon={<ClipboardPen className="size-4" />}
                      tone="accent"
                      title={e.title}
                      body={`Closed ${relative(e.windowEnd)} · ${e.stats.submitted} submission${e.stats.submitted === 1 ? '' : 's'} — grade written answers, then publish results`}
                      actions={
                        <>
                          <Link to={`/examiner/exams/${e.id}/grading`} className={cx(linkBtn, 'border border-line-strong bg-surface hover:bg-surface-2')}>
                            Grade
                          </Link>
                          <Link to={`/examiner/exams/${e.id}/results`} className={cx(linkBtn, 'bg-accent text-accent-ink hover:brightness-110')}>
                            <BarChart3 className="size-4" aria-hidden /> Results
                          </Link>
                        </>
                      }
                    />
                  ))}
                  {[...disputeExams.entries()].map(([id, d]) => (
                    <TodoRow
                      key={`d-${id}`}
                      icon={<Gavel className="size-4" />}
                      tone="danger"
                      title={`${d.n} open dispute${d.n === 1 ? '' : 's'}`}
                      body={d.title}
                      actions={
                        <Link to="/examiner/disputes" className={cx(linkBtn, 'border border-line-strong bg-surface hover:bg-surface-2')}>
                          Review
                        </Link>
                      }
                    />
                  ))}
                  {g.noCandidates.map((e) => (
                    <TodoRow
                      key={`n-${e.id}`}
                      icon={<UserPlus className="size-4" />}
                      tone="warn"
                      title={e.title}
                      body={`Opens ${relative(e.windowStart)} but nobody is enrolled yet`}
                      actions={
                        <Link to={`/examiner/exams/${e.id}?tab=candidates`} className={cx(linkBtn, 'border border-line-strong bg-surface hover:bg-surface-2')}>
                          Enrol candidates
                        </Link>
                      }
                    />
                  ))}
                </ul>
              )}
            </Card>

            {/* Upcoming */}
            <Card>
              <CardHeader title="Coming up" subtitle={g.upcoming.length ? `${g.upcoming.length} scheduled` : undefined} actions={<Link to="/examiner/exams?phase=PUBLISHED" className="text-[13px] font-medium text-accent hover:underline">All scheduled</Link>} />
              {!g.upcoming.length ? (
                <EmptyState icon={<CalendarClock className="size-6" />} title="Nothing scheduled" body="Publish a draft to put it on the calendar." />
              ) : (
                <ol className="divide-y divide-line">
                  {g.upcoming.slice(0, 6).map((e) => (
                    <li key={e.id}>
                      <Link to={`/examiner/exams/${e.id}`} className="flex items-center gap-4 px-5 py-3 transition hover:bg-surface-2">
                        <div className="w-14 shrink-0 rounded-lg border border-line bg-surface-2 py-1.5 text-center">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-accent">{new Date(e.windowStart).toLocaleDateString(undefined, { month: 'short' })}</div>
                          <div className="tabular display text-lg font-semibold leading-none">{new Date(e.windowStart).getDate()}</div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{e.title}</div>
                          <div className="tabular text-[13px] text-muted">
                            {fmtDay(e.windowStart)} {fmtTime(e.windowStart)} · {relative(e.windowStart)}
                          </div>
                        </div>
                        <Badge tone={e.stats.enrolled ? 'neutral' : 'warn'}>{e.stats.enrolled} enrolled</Badge>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>

          {/* Drafts */}
          <Card>
            <CardHeader title="Drafts in progress" subtitle="Pick up where you left off" actions={<Link to="/examiner/exams?phase=DRAFT" className="text-[13px] font-medium text-accent hover:underline">All drafts</Link>} />
            {!g.drafts.length ? (
              <EmptyState icon={<FilePen className="size-6" />} title="No drafts" body="Start a new examination when you’re ready." />
            ) : (
              <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
                {g.drafts.slice(0, 6).map((e) => (
                  <li key={e.id} className="bg-surface">
                    <DraftTile e={e} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {!exams.data?.length && (
            <Card>
              <EmptyState icon={<Radio className="size-6" />} title="Let’s set up your first examination" body="Create a draft, add questions from your bank, enrol candidates and preview it as a candidate — nothing is visible until you publish." />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

const firstName = (n?: string) => (n ?? '').replace(/^(dr|prof|mr|mrs|ms|miss)\.?\s+/i, '').split(' ')[0] ?? '';

const summaryLine = (live: number, todo: number, week: number) => {
  const parts: string[] = [];
  if (live) parts.push(`${live} exam${live === 1 ? ' is' : 's are'} live`);
  if (todo) parts.push(`${todo} item${todo === 1 ? '' : 's'} need${todo === 1 ? 's' : ''} you`);
  if (week) parts.push(`${week} scheduled this week`);
  return parts.length ? `${parts.join(' · ')}.` : 'All quiet. A good moment to build next week’s paper.';
};

function LiveCard({ e }: { e: ExamListItem }) {
  const paused = !!e.pausedAt;
  const { enrolled, inProgress, submitted } = e.stats;
  const notStarted = Math.max(0, enrolled - inProgress - submitted);
  return (
    <Card className={cx('overflow-hidden', paused ? 'border-warn/50' : 'border-ok/40')}>
      <div className={cx('flex items-center justify-between gap-2 px-5 py-2 text-[12px] font-semibold uppercase tracking-wide', paused ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok')}>
        <span className="inline-flex items-center gap-1.5">
          {paused ? <PauseCircle className="size-3.5" aria-hidden /> : <span className="pulse-dot size-1.5 rounded-full bg-current" aria-hidden />}
          {paused ? 'Paused' : 'In progress'}
        </span>
        <span className="tabular normal-case tracking-normal">Closes {relative(e.windowEnd)}</span>
      </div>
      <div className="p-5">
        <h3 className="text-[17px] font-semibold leading-snug">
          <Link to={`/examiner/exams/${e.id}`} className="hover:text-accent hover:underline">
            {e.title}
          </Link>
        </h3>
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <Metric n={inProgress} label="Writing" tone="text-info" />
          <Metric n={submitted} label="Submitted" tone="text-ok" />
          <Metric n={notStarted} label="Not started" tone="text-muted" />
        </div>
        <ProgressBar className="mt-4" value={submitted} max={enrolled || 1} tone="ok" label={`${submitted} of ${enrolled} submitted`} />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <span className="tabular text-[13px] text-muted">Window ends {fmtDate(e.windowEnd)}</span>
          <Link to={`/examiner/exams/${e.id}/monitor`} className={cx(linkBtn, 'bg-ok text-surface hover:brightness-110')}>
            <MonitorPlay className="size-4" aria-hidden /> Open monitor
          </Link>
        </div>
      </div>
    </Card>
  );
}

const Metric = ({ n, label, tone }: { n: number; label: string; tone: string }) => (
  <div className="rounded-lg bg-surface-2 py-2">
    <div className={cx('tabular text-2xl font-semibold', tone)}>{n}</div>
    <div className="text-[12px] text-muted">{label}</div>
  </div>
);

function TodoRow({ icon, tone, title, body, actions }: { icon: ReactNode; tone: 'accent' | 'danger' | 'warn'; title: string; body: string; actions: ReactNode }) {
  const tones = { accent: 'bg-accent-soft text-accent', danger: 'bg-danger-soft text-danger', warn: 'bg-warn-soft text-warn' };
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5 sm:flex-nowrap">
      <span className={cx('rounded-lg p-2', tones[tone])} aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="text-[13px] text-muted">{body}</div>
      </div>
      <div className="flex shrink-0 gap-2">{actions}</div>
    </li>
  );
}

function DraftTile({ e }: { e: ExamListItem }) {
  const steps = [
    { done: e.questionCount > 0, label: 'Questions' },
    { done: e.stats.enrolled > 0, label: 'Candidates' },
    { done: !!e.instructions?.trim(), label: 'Instructions' },
  ];
  const n = steps.filter((s) => s.done).length;
  const soon = +new Date(e.windowStart) - Date.now() < 3 * 86400_000;
  return (
    <Link to={`/examiner/exams/${e.id}`} className="group flex h-full flex-col gap-3 p-5 transition hover:bg-surface-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{e.title}</div>
          <div className="text-[13px] text-muted">Edited {relative(e.updatedAt)}</div>
        </div>
        {soon && (
          <Badge tone="warn">
            <AlertTriangle className="size-3" aria-hidden /> Opens {relative(e.windowStart)}
          </Badge>
        )}
      </div>
      <div className="flex gap-1" aria-label={`${n} of 3 setup steps complete`}>
        {steps.map((s) => (
          <span key={s.label} className={cx('h-1.5 flex-1 rounded-full', s.done ? 'bg-accent' : 'bg-surface-2')} title={s.label} />
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between text-[13px]">
        <span className="tabular text-muted">
          {e.questionCount} Q · {e.stats.enrolled} candidates
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-accent">
          Continue <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
