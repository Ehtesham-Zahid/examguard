import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarClock, CheckCircle2, Clock, KeyRound, PlayCircle, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDay, fmtDuration, fmtTime } from '@/lib/format';
import type { Phase } from '@/lib/types';
import { Badge, Button, Card, cx, EmptyState, ErrorBox, PageHeader, Spinner, Tabs } from '@/components/ui';
import { AttemptBadge, PhaseBadge } from '@/components/status';

export interface CandidateExam {
  id: string;
  title: string;
  description: string;
  examiner: string;
  windowStart: string;
  windowEnd: string;
  durationMin: number;
  extraTimePct: number;
  totalMarks: number;
  phase: Phase;
  paused: boolean;
  category: 'available' | 'upcoming' | 'completed';
  requiresAccessCode: boolean;
  attempt: { id: string; status: string; startedAt: string; deadline: string; submittedAt: string | null } | null;
  resultsPublished: boolean;
  score: number | null;
}

function useTick(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(iv);
  }, [ms]);
  return now;
}

export default function CandidateDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'available' | 'upcoming' | 'completed'>('available');
  const { data, isLoading, error, refetch, dataUpdatedAt } = useQuery({ queryKey: ['candidate-exams'], queryFn: () => api<{ serverNow: string; items: CandidateExam[] }>('/candidate/exams'), refetchInterval: 30000 });
  const now = useTick();
  const offset = data ? new Date(data.serverNow).getTime() - dataUpdatedAt : 0;
  const items = data?.items ?? [];
  const by = (c: string) => items.filter((i) => i.category === c);
  useEffect(() => {
    if (data && !by('available').length && by('upcoming').length) setTab('upcoming');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const list = by(tab);
  const inProgress = items.find((i) => i.attempt?.status === 'IN_PROGRESS');
  const hour = new Date().getHours();

  return (
    <div>
      <PageHeader eyebrow={new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} title={`Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${user?.name.split(' ')[0]}`} subtitle="Your examinations, schedules and results in one place." />
      {inProgress && (
        <Card className="mb-6 flex flex-wrap items-center gap-4 border-info/40 bg-info-soft p-5">
          <PlayCircle className="size-8 text-info" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-info">You have an exam in progress</div>
            <div className="text-sm text-ink-2">{inProgress.title} — time remaining {fmtDuration(new Date(inProgress.attempt!.deadline).getTime() - (now + offset))}. Your answers are saved.</div>
          </div>
          <Link to={`/candidate/exams/${inProgress.id}`}><Button icon={<ArrowRight className="size-4" />} className="flex-row-reverse">Resume</Button></Link>
        </Card>
      )}
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'available', label: 'Available now', count: by('available').length },
          { id: 'upcoming', label: 'Upcoming', count: by('upcoming').length },
          { id: 'completed', label: 'Completed', count: by('completed').length },
        ]}
      />
      {isLoading && <Spinner />}
      {error && <ErrorBox error={error} onRetry={refetch} />}
      {!isLoading && !list.length && (
        <Card>
          <EmptyState
            icon={tab === 'completed' ? <CheckCircle2 className="size-6" /> : <CalendarClock className="size-6" />}
            title={tab === 'available' ? 'No exams open right now' : tab === 'upcoming' ? 'Nothing scheduled' : 'No completed exams yet'}
            body={tab === 'available' ? 'When an exam window opens it will appear here. Check the Upcoming tab for your schedule.' : undefined}
          />
        </Card>
      )}
      <div key={tab} className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((e) => (
          <ExamCard key={e.id} e={e} now={now + offset} />
        ))}
      </div>
    </div>
  );
}

function ExamCard({ e, now }: { e: CandidateExam; now: number }) {
  const opensIn = new Date(e.windowStart).getTime() - now;
  const closesIn = new Date(e.windowEnd).getTime() - now;
  const duration = Math.round(e.durationMin * (1 + e.extraTimePct / 100));
  return (
    <Card className="lift flex flex-col p-5 hover:border-line-strong">
      <div className="mb-3 flex items-center justify-between gap-2">
        <PhaseBadge phase={e.phase} paused={e.paused} />
        {e.attempt && <AttemptBadge status={e.attempt.status} />}
      </div>
      <h3 className="text-[17px] font-semibold leading-snug">{e.title}</h3>
      <p className="mt-1 line-clamp-2 text-sm text-muted">{e.description || `By ${e.examiner}`}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Duration</dt>
          <dd className="flex items-center gap-1.5 font-medium"><Timer className="size-3.5 text-muted" /> {duration} min {e.extraTimePct > 0 && <Badge tone="info">+{e.extraTimePct}%</Badge>}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Marks</dt>
          <dd className="font-medium tabular">{e.totalMarks}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-muted">Window</dt>
          <dd className="font-medium">{fmtDay(e.windowStart)}, {fmtTime(e.windowStart)} – {fmtDay(e.windowEnd) === fmtDay(e.windowStart) ? fmtTime(e.windowEnd) : fmtDate(e.windowEnd)}</dd>
        </div>
      </dl>
      <div className="mt-auto pt-5">
        {e.category === 'upcoming' && (
          <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2.5">
            <span className="flex items-center gap-2 text-sm text-ink-2"><Clock className="size-4" /> Opens in</span>
            <span className="font-mono text-sm font-semibold tabular">{opensIn > 86400000 ? `${Math.floor(opensIn / 86400000)}d ${fmtDuration(opensIn % 86400000)}` : fmtDuration(opensIn)}</span>
          </div>
        )}
        {e.category === 'available' && (
          <div className="space-y-2">
            <div className={cx('text-xs', closesIn < 3600000 ? 'text-danger' : 'text-muted')}>Window closes in {closesIn > 86400000 ? `${Math.floor(closesIn / 86400000)} days` : fmtDuration(closesIn)}</div>
            <Link to={`/candidate/exams/${e.id}`} className="block">
              <Button className="w-full" icon={e.requiresAccessCode ? <KeyRound className="size-4" /> : <PlayCircle className="size-4" />}>{e.attempt ? 'Resume exam' : 'View instructions & start'}</Button>
            </Link>
          </div>
        )}
        {e.category === 'completed' &&
          (e.resultsPublished && e.attempt ? (
            <Link to={`/candidate/results/${e.attempt.id}`} className="flex items-center justify-between rounded-lg bg-accent-soft px-3 py-2.5 text-accent hover:brightness-95">
              <span className="text-sm font-medium">Result published</span>
              <span className="font-semibold tabular">{e.score} / {e.totalMarks} →</span>
            </Link>
          ) : (
            <div className="rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-muted">{e.attempt ? 'Submitted — awaiting results' : 'You did not attempt this exam'}</div>
          ))}
      </div>
    </Card>
  );
}
