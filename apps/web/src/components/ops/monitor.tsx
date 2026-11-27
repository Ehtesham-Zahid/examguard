import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock, Eye, Megaphone, Search, Send, Square, UserRoundX, Users } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { fmtDuration, fmtTime, relative } from '@/lib/format';
import { AttemptBadge } from '@/components/status';
import { Badge, Button, Card, CardHeader, cx, EmptyState, ErrorBox, Field, Input, ProgressBar, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import type { Announcement, MonitorAttempt, PersonLite } from './types';
import { ConnectionDot, IntegrityPill } from './bits';
import { ExtendTimeModal, ForceSubmitModal } from './actions';

/* ------------------------------ attempts table ------------------------------ */

type Filter = 'all' | 'attention' | 'writing' | 'finished';
const needsAttention = (a: MonitorAttempt) => a.connection === 'offline' || a.connection === 'unstable' || a.openIncidents > 0 || a.integrityScore < 60;

export function remainingMs(a: MonitorAttempt, serverNowMs: number, pausedAt: string | null) {
  const ref = pausedAt ? Math.min(new Date(pausedAt).getTime(), serverNowMs) : serverNowMs;
  return new Date(a.deadline).getTime() - ref;
}

export function AttemptsTable({ attempts, serverNowMs, pausedAt }: { attempts: MonitorAttempt[]; serverNowMs: number; pausedAt: string | null }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [extend, setExtend] = useState<MonitorAttempt | null>(null);
  const [force, setForce] = useState<MonitorAttempt | null>(null);

  const counts = useMemo(
    () => ({
      all: attempts.length,
      attention: attempts.filter((a) => a.status === 'IN_PROGRESS' && needsAttention(a)).length,
      writing: attempts.filter((a) => a.status === 'IN_PROGRESS').length,
      finished: attempts.filter((a) => a.status !== 'IN_PROGRESS').length,
    }),
    [attempts],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return attempts
      .filter((a) => (filter === 'all' ? true : filter === 'attention' ? a.status === 'IN_PROGRESS' && needsAttention(a) : filter === 'writing' ? a.status === 'IN_PROGRESS' : a.status !== 'IN_PROGRESS'))
      .filter((a) => !q || a.candidate.name.toLowerCase().includes(q) || a.candidate.email.toLowerCase().includes(q))
      .sort((a, b) => {
        const w = (x: MonitorAttempt) => (x.status !== 'IN_PROGRESS' ? 2 : needsAttention(x) ? 0 : 1);
        return w(a) - w(b) || a.candidate.name.localeCompare(b.candidate.name);
      });
  }, [attempts, filter, query]);

  const chip = (id: Filter, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      aria-pressed={filter === id}
      className={cx('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition', filter === id ? 'border-ink bg-ink text-surface' : 'border-line bg-surface text-ink-2 hover:border-line-strong')}
    >
      {label}
      <span className={cx('tabular rounded-full px-1.5 text-[11px]', filter === id ? 'bg-surface/20' : 'bg-surface-2', id === 'attention' && counts.attention > 0 && filter !== id && 'bg-danger-soft text-danger')}>{counts[id]}</span>
    </button>
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter candidates">
          {chip('all', 'All')}
          {chip('attention', 'Needs attention')}
          {chip('writing', 'Writing')}
          {chip('finished', 'Finished')}
        </div>
        <label className="relative w-full sm:w-56">
          <span className="sr-only">Search candidates</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or email" className="h-9 pl-9" />
        </label>
      </div>
      {!rows.length ? (
        <EmptyState icon={<Users className="size-6" />} title={attempts.length ? 'No candidates match' : 'Nobody has started yet'} body={attempts.length ? 'Try another filter or search.' : 'Rows appear here the moment a candidate opens the paper.'} />
      ) : (
        <Table className="[&_table]:min-w-[880px]">
          <thead>
            <tr>
              <Th>Candidate</Th>
              <Th>Connection</Th>
              <Th className="w-44">Progress</Th>
              <Th>Time left</Th>
              <Th>Integrity</Th>
              <Th>Incidents</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const live = a.status === 'IN_PROGRESS';
              const rem = remainingMs(a, serverNowMs, pausedAt);
              return (
                <tr key={a.id} className={cx('transition-colors hover:bg-surface-2/50', live && a.connection === 'offline' && 'bg-danger-soft/40')}>
                  <Td>
                    <Link to={`/examiner/attempts/${a.id}`} className="font-medium text-ink hover:underline">
                      {a.candidate.name}
                    </Link>
                    <div className="text-[12px] text-muted">{a.candidate.email}</div>
                  </Td>
                  <Td>
                    <ConnectionDot c={a.connection} />
                    {live && a.lastSeenAt && a.connection !== 'online' && <div className="text-[11px] text-muted">seen {relative(a.lastSeenAt)}</div>}
                  </Td>
                  <Td>
                    <div className="tabular mb-1 flex justify-between text-[12px] text-ink-2">
                      <span>
                        {a.answered}/{a.total}
                      </span>
                      {a.flagged > 0 && <span className="text-warn">{a.flagged} flagged</span>}
                    </div>
                    <ProgressBar value={a.answered} max={a.total || 1} tone={live ? 'accent' : 'ok'} label={`${a.candidate.name} answered ${a.answered} of ${a.total}`} />
                  </Td>
                  <Td>
                    {live ? (
                      <div>
                        <span className={cx('tabular text-[15px] font-semibold', rem < 5 * 60000 ? 'text-danger' : rem < 10 * 60000 ? 'text-warn' : 'text-ink')}>{fmtDuration(rem)}</span>
                        {a.extraTimeSec > 0 && <div className="text-[11px] text-muted">incl. +{Math.round(a.extraTimeSec / 60)} min</div>}
                      </div>
                    ) : (
                      <div className="flex flex-col items-start gap-0.5">
                        <AttemptBadge status={a.status} />
                        {a.submittedAt && <span className="text-[11px] text-muted">at {fmtTime(a.submittedAt)}</span>}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <IntegrityPill score={a.integrityScore} />
                    <div className="tabular mt-0.5 text-[11px] text-muted">{a.violations} warning{a.violations === 1 ? '' : 's'}</div>
                  </Td>
                  <Td>{a.openIncidents ? <Badge tone="warn">{a.openIncidents} open</Badge> : <span className="text-[13px] text-muted">—</span>}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Link to={`/examiner/attempts/${a.id}`} className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={`View ${a.candidate.name}'s attempt`} title="View attempt">
                        <Eye className="size-4" />
                      </Link>
                      {live && (
                        <>
                          <button type="button" onClick={() => setExtend(a)} className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={`Extend time for ${a.candidate.name}`} title="Extend time">
                            <Clock className="size-4" />
                          </button>
                          <button type="button" onClick={() => setForce(a)} className="inline-flex size-8 items-center justify-center rounded-lg text-danger hover:bg-danger-soft" aria-label={`Force submit ${a.candidate.name}`} title="Force submit">
                            <Square className="size-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {extend && <ExtendTimeModal open attemptId={extend.id} name={extend.candidate.name} onClose={() => setExtend(null)} />}
      {force && <ForceSubmitModal open attemptId={force.id} name={force.candidate.name} onClose={() => setForce(null)} />}
    </Card>
  );
}

/* ------------------------------ announcements ------------------------------ */

export function AnnouncementsPanel({ examId, people, recipient, setRecipient }: { examId: string; people: PersonLite[]; recipient: string; setRecipient: (v: string) => void }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [touched, setTouched] = useState(false);
  const list = useQuery({ queryKey: ['announcements', examId], queryFn: () => api<Announcement[]>(`/exams/${examId}/announcements`) });
  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const err = !msg.trim() ? 'Write a message first' : null;
  const send = useMutation({
    mutationFn: () => api<Announcement>(`/exams/${examId}/announcements`, { method: 'POST', body: { message: msg.trim(), candidateId: recipient || undefined } }),
    onSuccess: () => {
      toast.success(recipient ? `Message sent to ${nameOf.get(recipient) ?? 'candidate'}` : 'Announcement broadcast to all candidates');
      setMsg('');
      setTouched(false);
      qc.invalidateQueries({ queryKey: ['announcements', examId] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Megaphone className="size-4 text-accent" aria-hidden /> Announcements</span>} subtitle="Appears instantly on candidates' screens." />
      <form
        className="flex flex-col gap-3 px-4 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!err) send.mutate();
        }}
      >
        <Field label="Send to">
          {(id) => (
            <Select id={id} value={recipient} onChange={(e) => setRecipient(e.target.value)}>
              <option value="">Everyone in this exam</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Message" error={touched ? (err ?? undefined) : undefined} hint={<span className="tabular">{msg.length}/1000</span>}>
          {(id) => <Textarea id={id} value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={1000} placeholder="e.g. Question 7: assume the array is 0-indexed." className="min-h-20" />}
        </Field>
        <Button type="submit" loading={send.isPending} icon={<Send className="size-4" />}>
          {recipient ? 'Send privately' : 'Broadcast'}
        </Button>
      </form>
      <div className="border-t border-line px-4 py-3">
        <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">Sent</h4>
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <ErrorBox error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data?.length ? (
          <p className="py-2 text-[13px] text-muted">No announcements yet.</p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
            {list.data.map((a) => (
              <li key={a.id} className="rounded-lg bg-surface-2/60 px-3 py-2">
                <div className="flex justify-between gap-2 text-[11px] text-muted">
                  <span className="font-medium">{a.candidateId ? `To ${nameOf.get(a.candidateId) ?? 'one candidate'}` : 'To everyone'}</span>
                  <time dateTime={a.createdAt}>{fmtTime(a.createdAt)}</time>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-ink">{a.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function NotStartedPanel({ people, onMessage }: { people: PersonLite[]; onMessage: (id: string) => void }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><UserRoundX className="size-4 text-muted" aria-hidden /> Not started <span className="tabular text-muted">({people.length})</span></span>} />
      {!people.length ? (
        <p className="px-4 py-4 text-[13px] text-muted">Every enrolled candidate has opened the paper.</p>
      ) : (
        <ul className="max-h-60 divide-y divide-line overflow-y-auto">
          {people.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="truncate text-[12px] text-muted">{p.email}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => onMessage(p.id)} aria-label={`Message ${p.name}`}>
                Message
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
