import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, CalendarClock, ClipboardCheck, Copy, KeyRound, MonitorPlay, Plus, Search, Shuffle, Users } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtTime, relative } from '@/lib/format';
import type { Phase } from '@/lib/types';
import { Button, Card, cx, EmptyState, ErrorBox, Input, PageHeader, ProgressBar, Spinner, Tabs } from '@/components/ui';
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
          <ul className="divide-y divide-line">
            {items.map((e) => (
              <ExamRow key={e.id} e={e} showOwner={user?.role === 'ADMIN'} />
            ))}
          </ul>
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
  const sameDay = new Date(e.windowStart).toDateString() === new Date(e.windowEnd).toDateString();
  const done = e.stats.submitted;
  const enrolled = e.stats.enrolled;

  return (
    <li className={cx('group relative grid gap-3 px-5 py-4 transition hover:bg-surface-2/50 md:grid-cols-2 md:items-center xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(11rem,1fr)_auto]', live && 'bg-ok-soft/40')}>
      {live && <span className="absolute inset-y-0 left-0 w-1 bg-ok" aria-hidden />}
      <div className="min-w-0 md:col-span-2 xl:col-span-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/examiner/exams/${e.id}`} className="truncate text-[15px] font-semibold hover:text-accent hover:underline">
            {e.title}
          </Link>
          <PhaseBadge phase={e.phase} paused={!!e.pausedAt && live} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          <span>{e.questionCount} questions · {e.totalMarks} marks · {e.durationMin} min</span>
          {e.mode === 'BLUEPRINT' && (
            <span className="inline-flex items-center gap-1 text-accent">
              <Shuffle className="size-3.5" aria-hidden /> Fair random paper
            </span>
          )}
          {e.hasAccessCode && (
            <span className="inline-flex items-center gap-1">
              <KeyRound className="size-3.5" aria-hidden /> Access code
            </span>
          )}
          {showOwner && e.owner && <span>by {e.owner.name}</span>}
        </div>
      </div>

      <div className="flex items-start gap-2 text-[13px]">
        <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
        <div className="tabular">
          <div>
            {fmtDate(e.windowStart)} – {sameDay ? fmtTime(e.windowEnd) : fmtDate(e.windowEnd)}
          </div>
          <div className="text-muted">{e.phase === 'PUBLISHED' ? `Opens ${relative(e.windowStart)}` : live ? `Closes ${relative(e.windowEnd)}` : e.phase === 'DRAFT' ? 'Not published' : `Closed ${relative(e.windowEnd)}`}</div>
        </div>
      </div>

      <div className="text-[13px]">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <Users className="size-3.5" aria-hidden /> <span className="tabular">{enrolled}</span> enrolled
          </span>
          {(live || e.phase === 'COMPLETED') && enrolled > 0 && (
            <span className="tabular whitespace-nowrap text-muted">
              {live ? `${e.stats.inProgress} writing · ` : ''}
              {done} done
            </span>
          )}
        </div>
        {(live || e.phase === 'COMPLETED') && enrolled > 0 && <ProgressBar className="mt-1.5" value={done} max={enrolled} tone={live ? 'ok' : 'accent'} label={`${done} of ${enrolled} submitted`} />}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 md:col-span-2 xl:col-span-1 xl:justify-end">
        {live && (
          <Link to={`/examiner/exams/${e.id}/monitor`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ok px-3 text-[13px] font-medium text-surface hover:brightness-110">
            <MonitorPlay className="size-4" aria-hidden /> Monitor
          </Link>
        )}
        {(e.phase === 'COMPLETED' || e.phase === 'ARCHIVED') && (
          <Link to={`/examiner/exams/${e.id}/results`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
            <BarChart3 className="size-4" aria-hidden /> Results
          </Link>
        )}
        <Link to={`/examiner/exams/${e.id}`} className="inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
          Open
        </Link>
        <Button size="sm" variant="ghost" onClick={() => dup.mutate()} loading={dup.isPending} icon={<Copy className="size-4" />} aria-label={`Duplicate ${e.title}`} title="Duplicate">
          <span className="xl:sr-only">Duplicate</span>
        </Button>
      </div>
    </li>
  );
}
