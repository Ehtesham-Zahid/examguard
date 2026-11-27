import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, CalendarClock, ClipboardCheck, Copy, KeyRound, MonitorPlay, PencilLine, Plus, Search, Shuffle, Users } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { relative } from '@/lib/format';
import type { Phase } from '@/lib/types';
import { Button, buttonClass, Card, cx, EmptyState, ErrorBox, Input, PageHeader, ProgressBar, Spinner, Tabs } from '@/components/ui';
import { PhaseBadge } from '@/components/status';
import { NewExamModal } from '@/components/setup/ExamForm';
import type { ExamListItem } from '@/components/setup/types';

type Filter = 'ALL' | Phase;
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'ONGOING', label: 'Live' },
  { id: 'PUBLISHED', label: 'Scheduled' },
  { id: 'DRAFT', label: 'Drafts' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'ARCHIVED', label: 'Archived' },
];
const ORDER: Record<Phase, number> = { ONGOING: 0, PUBLISHED: 1, DRAFT: 2, COMPLETED: 3, ARCHIVED: 4 };

export default function ExamList() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const filter = (params.get('phase') as Filter) || 'ALL';
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(params.get('new') === '1');
  const q = useQuery({ queryKey: ['exams'], queryFn: () => api<ExamListItem[]>('/exams'), refetchInterval: 60000 });

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: q.data?.length ?? 0 };
    q.data?.forEach((e) => (c[e.phase] = (c[e.phase] ?? 0) + 1));
    return c;
  }, [q.data]);

  const items = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? [])
      .filter((e) => filter === 'ALL' || e.phase === filter)
      .filter((e) => !s || e.title.toLowerCase().includes(s) || e.description.toLowerCase().includes(s) || e.owner?.name.toLowerCase().includes(s))
      .sort((a, b) => ORDER[a.phase] - ORDER[b.phase] || (a.phase === 'PUBLISHED' ? +new Date(a.windowStart) - +new Date(b.windowStart) : +new Date(b.windowStart) - +new Date(a.windowStart)));
  }, [q.data, filter, search]);

  return (
    <div>
      <PageHeader
        eyebrow={user?.role === 'ADMIN' ? 'All examiners' : 'Your examinations'}
        title="Examinations"
        subtitle="Draft, schedule, run and close out examinations. Live papers float to the top."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New examination
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-line px-5 pt-3 lg:flex-row lg:items-end lg:justify-between">
          <Tabs<Filter>
            className="border-b-0"
            value={filter}
            onChange={(f) => setParams(f === 'ALL' ? {} : { phase: f }, { replace: true })}
            tabs={FILTERS.map((f) => ({ ...f, count: q.data ? counts[f.id] ?? 0 : undefined }))}
          />
          <div className="relative pb-3 lg:w-72">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" aria-hidden />
            <Input type="search" aria-label="Search examinations" placeholder="Search by title" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {q.isLoading ? (
          <Spinner label="Loading examinations" />
        ) : q.isError ? (
          <div className="p-5">
            <ErrorBox error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : !items.length ? (
          <EmptyState
            icon={<ClipboardCheck className="size-6" />}
            title={search ? 'No examinations match your search' : filter === 'ALL' ? 'No examinations yet' : `No ${FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} examinations`}
            body={filter === 'ALL' && !search ? 'Create your first draft — you can preview it as a candidate before anything goes live.' : undefined}
            action={
              filter === 'ALL' && !search ? (
                <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                  New examination
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
          <ExamListHeader />
          <ul className="divide-y divide-line">
            {items.map((e) => (
              <ExamRow key={e.id} e={e} showOwner={user?.role === 'ADMIN'} />
            ))}
          </ul>
          </>
        )}
      </Card>

      <NewExamModal
        open={creating}
        onClose={() => {
          setCreating(false);
          if (params.get('new')) setParams({}, { replace: true });
        }}
      />
    </div>
  );
}

const sameYear = (d: Date) => d.getFullYear() === new Date().getFullYear();
const shortDay = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear(d) ? {} : { year: 'numeric' }) });
};
const shortTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** Desktop column template shared by the header and every row, so the list reads as a real table. */
const COLS = 'xl:grid-cols-[minmax(0,1fr)_12.5rem_11rem_9.5rem]';

export function ExamListHeader() {
  return (
    <div className={cx('hidden gap-5 border-b border-line bg-surface-2/50 px-5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted xl:grid', COLS)} aria-hidden>
      <span>Examination</span>
      <span>Schedule</span>
      <span>Candidates</span>
      <span className="text-right">Actions</span>
    </div>
  );
}

function ExamRow({ e, showOwner }: { e: ExamListItem; showOwner?: boolean }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const dup = useMutation({
    mutationFn: () => api<{ id: string }>(`/exams/${e.id}/duplicate`, { method: 'POST' }),
    onSuccess: (c) => {
      toast.success('Copy created as a draft');
      qc.invalidateQueries({ queryKey: ['exams'] });
      nav(`/examiner/exams/${c.id}`);
    },
    onError: (err) => toast.error(errMsg(err)),
  });
  const live = e.phase === 'ONGOING';
  const finished = e.phase === 'COMPLETED' || e.phase === 'ARCHIVED';
  const sameDay = new Date(e.windowStart).toDateString() === new Date(e.windowEnd).toDateString();
  const done = e.stats.submitted;
  const enrolled = e.stats.enrolled;
  const when = e.phase === 'PUBLISHED' ? `Opens ${relative(e.windowStart)}` : live ? `Closes ${relative(e.windowEnd)}` : e.phase === 'DRAFT' ? 'Not published yet' : `Closed ${relative(e.windowEnd)}`;

  return (
    <li className={cx('group relative grid gap-x-5 gap-y-3 px-5 py-4 transition hover:bg-surface-2/50 sm:grid-cols-2 sm:items-center', COLS, live && 'bg-ok-soft/40')}>
      {live && <span className="absolute inset-y-0 left-0 w-1 bg-ok" aria-hidden />}

      {/* examination */}
      <div className="min-w-0 sm:col-span-2 xl:col-span-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link to={`/examiner/exams/${e.id}`} className="truncate text-[15px] font-semibold hover:text-accent hover:underline" title={e.title}>
            {e.title}
          </Link>
          <span className="shrink-0">
            <PhaseBadge phase={e.phase} paused={!!e.pausedAt && live} />
          </span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[13px] text-muted">
          <span className="truncate">
            {e.questionCount} questions · {e.totalMarks} marks · {e.durationMin} min{showOwner && e.owner ? ` · ${e.owner.name}` : ''}
          </span>
          {e.mode === 'BLUEPRINT' && (
            <span className="inline-flex shrink-0 text-accent" title="Fair random paper: every candidate gets a different, equally hard paper">
              <Shuffle className="size-3.5" aria-hidden />
              <span className="sr-only">Fair random paper</span>
            </span>
          )}
          {e.hasAccessCode && (
            <span className="inline-flex shrink-0" title="Requires an access code">
              <KeyRound className="size-3.5" aria-hidden />
              <span className="sr-only">Requires an access code</span>
            </span>
          )}
        </div>
      </div>

      {/* schedule */}
      <div className="flex min-w-0 items-start gap-2 text-[13px]">
        <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 tabular">
          <div className="truncate font-medium text-ink" title={`${shortDay(e.windowStart)}, ${shortTime(e.windowStart)} → ${shortDay(e.windowEnd)}, ${shortTime(e.windowEnd)}`}>
            {sameDay ? `${shortDay(e.windowStart)} · ${shortTime(e.windowStart)} – ${shortTime(e.windowEnd)}` : `${shortDay(e.windowStart)} → ${shortDay(e.windowEnd)}`}
          </div>
          <div className="truncate text-muted">{when}</div>
        </div>
      </div>

      {/* candidates: the same two-line shape on every row */}
      <div className="min-w-0 text-[13px]">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 font-medium text-ink">
            <Users className="size-3.5 text-muted" aria-hidden /> <span className="tabular">{enrolled}</span> enrolled
          </span>
          {live && e.stats.inProgress > 0 && (
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-ok">
              <span className="pulse-dot size-1.5 rounded-full bg-ok" aria-hidden />
              <span className="tabular">{e.stats.inProgress}</span> writing
            </span>
          )}
        </div>
        {(live || finished) && enrolled > 0 ? (
          <div className="mt-1.5 flex items-center gap-2">
            <ProgressBar className="flex-1 bg-line/70!" value={done} max={enrolled} label={`${done} of ${enrolled} submitted`} />
            <span className="tabular shrink-0 text-[12px] text-muted">
              {done}/{enrolled}
            </span>
          </div>
        ) : (
          <div className="mt-1 text-[12px] text-muted">{enrolled ? 'Not started' : 'No candidates yet'}</div>
        )}
      </div>

      {/* one clear action + duplicate */}
      <div className="flex items-center gap-1.5 sm:col-span-2 xl:col-span-1 xl:justify-end">
        {live ? (
          <Link to={`/examiner/exams/${e.id}/monitor`} className={buttonClass('primary', 'sm', 'min-w-[6.5rem]')}>
            <span className="pulse-dot size-1.5 rounded-full bg-[#6fd394]" aria-hidden />
            <MonitorPlay className="size-4" aria-hidden /> Monitor
          </Link>
        ) : finished ? (
          <Link to={`/examiner/exams/${e.id}/results`} className={buttonClass('outline', 'sm', 'min-w-[6.5rem]')}>
            <BarChart3 className="size-4" aria-hidden /> Results
          </Link>
        ) : (
          <Link to={`/examiner/exams/${e.id}`} className={buttonClass('outline', 'sm', 'min-w-[6.5rem]')}>
            <PencilLine className="size-4" aria-hidden /> {e.phase === 'DRAFT' ? 'Edit' : 'Open'}
          </Link>
        )}
        <Button size="sm" variant="ghost" onClick={() => dup.mutate()} loading={dup.isPending} icon={<Copy className="size-4" />} aria-label={`Duplicate ${e.title}`} title="Duplicate as a new draft" />
      </div>
    </li>
  );
}
