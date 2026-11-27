import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Accessibility, ExternalLink, Search, Trash2, Upload, UserPlus, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { Badge, Button, Card, CardHeader, ConfirmDialog, cx, EmptyState, ErrorBox, Field, Input, Modal, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { AttemptBadge } from '@/components/status';
import { CandidateImport } from '../CandidateImport';
import { Avatar, IconBtn, LockNotice, Segmented, useDebounced } from '../shared';
import type { Enrollment, ExamDetail, Group, UserRow } from '../types';
import { invalidateExam } from './common';

export function CandidatesTab({ exam }: { exam: ExamDetail }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['enrollments', exam.id], queryFn: () => api<Enrollment[]>(`/exams/${exam.id}/enrollments`) });
  const [enrolling, setEnrolling] = useState(false);
  const [importing, setImporting] = useState(false);
  const [accom, setAccom] = useState<Enrollment | null>(null);
  const [removing, setRemoving] = useState<Enrollment | null>(null);
  const [filter, setFilter] = useState('');
  const closed = exam.phase === 'COMPLETED' || exam.phase === 'ARCHIVED';

  const remove = useMutation({
    mutationFn: (e: Enrollment) => api(`/exams/${exam.id}/enrollments/${e.id}`, { method: 'DELETE' }),
    onSuccess: (_r, e) => {
      toast.success(`${e.name} removed from this examination`);
      setRemoving(null);
      qc.invalidateQueries({ queryKey: ['enrollments', exam.id] });
      invalidateExam(qc, exam.id);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (q.data ?? []).filter((e) => !f || e.name.toLowerCase().includes(f) || e.email.toLowerCase().includes(f) || e.groupName?.toLowerCase().includes(f));
  }, [q.data, filter]);
  const counts = useMemo(() => {
    const c = { total: q.data?.length ?? 0, accom: 0, started: 0 };
    q.data?.forEach((e) => {
      if (e.extraTimePct) c.accom++;
      if (e.attemptId) c.started++;
    });
    return c;
  }, [q.data]);

  return (
    <div className="space-y-5">
      {closed && <LockNotice title="Enrolment is closed">This examination has finished. The list below is the final record of who was expected to sit it.</LockNotice>}
      <Card>
        <CardHeader
          title={`${counts.total} candidate${counts.total === 1 ? '' : 's'} enrolled`}
          subtitle={counts.total ? `${counts.started} started · ${counts.accom} with extra-time accommodation` : 'Only enrolled candidates can see and sit this examination.'}
          actions={
            !closed && (
              <>
                <Button variant="outline" icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>
                  Import new
                </Button>
                <Button icon={<UserPlus className="size-4" />} onClick={() => setEnrolling(true)}>
                  Enrol candidates
                </Button>
              </>
            )
          }
        />
        {counts.total > 8 && (
          <div className="border-b border-line px-5 py-3">
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" aria-hidden />
              <Input type="search" aria-label="Filter enrolled candidates" placeholder="Filter by name, email or group" className="pl-9" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          </div>
        )}
        {q.isLoading ? (
          <Spinner label="Loading enrolments" />
        ) : q.isError ? (
          <div className="p-5">
            <ErrorBox error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : !q.data?.length ? (
          <EmptyState
            icon={<Users className="size-6" />}
            title="Nobody is enrolled yet"
            body="Enrol individuals, a whole group, or paste a list of emails."
            action={
              !closed && (
                <Button icon={<UserPlus className="size-4" />} onClick={() => setEnrolling(true)}>
                  Enrol candidates
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Candidate</Th>
                <Th>Group</Th>
                <Th>Status</Th>
                <Th className="text-right">Score</Th>
                <Th>Extra time</Th>
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="hover:bg-surface-2/50">
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={e.name} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{e.name}</div>
                        <div className="truncate text-[13px] text-muted">{e.email}</div>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-ink-2">{e.groupName ?? <span className="text-muted">—</span>}</Td>
                  <Td>
                    <AttemptBadge status={e.attemptStatus ?? e.status} />
                  </Td>
                  <Td className="tabular text-right">{e.score != null ? <span className="font-semibold">{e.score}</span> : <span className="text-muted">—</span>}</Td>
                  <Td>
                    {e.attemptId || closed ? (
                      e.extraTimePct ? <Badge tone="info">+{e.extraTimePct}%</Badge> : <span className="text-muted">—</span>
                    ) : (
                      <button type="button" onClick={() => setAccom(e)} className={cx('inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] transition hover:bg-surface-2', e.extraTimePct ? 'font-medium text-info' : 'text-muted')} aria-label={`Set extra time for ${e.name}, currently ${e.extraTimePct}%`}>
                        <Accessibility className="size-3.5" aria-hidden />
                        {e.extraTimePct ? `+${e.extraTimePct}%` : 'None'}
                      </button>
                    )}
                  </Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      {e.attemptId && (
                        <Link to={`/examiner/attempts/${e.attemptId}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium text-accent hover:bg-accent-soft">
                          Review <ExternalLink className="size-3.5" aria-hidden />
                        </Link>
                      )}
                      {!e.attemptId && !closed && (
                        <IconBtn label={`Remove ${e.name}`} danger onClick={() => setRemoving(e)}>
                          <Trash2 className="size-4" />
                        </IconBtn>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <EnrolModal open={enrolling} onClose={() => setEnrolling(false)} exam={exam} enrolled={new Set(q.data?.map((e) => e.id))} />
      <AccommodationModal exam={exam} enrollment={accom} onClose={() => setAccom(null)} />
      <CandidateImport
        open={importing}
        onClose={() => {
          setImporting(false);
          invalidateExam(qc, exam.id);
        }}
        enrollExamId={exam.id}
      />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        loading={remove.isPending}
        tone="danger"
        title="Remove from examination?"
        confirmLabel="Remove"
        body={
          <>
            <strong className="text-ink">{removing?.name}</strong> will no longer see this examination. Their account is not affected and you can enrol them again later.
          </>
        }
      />
    </div>
  );
}

/* ------------------------------ Accommodation ------------------------------ */

function AccommodationModal({ exam, enrollment, onClose }: { exam: ExamDetail; enrollment: Enrollment | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [pct, setPct] = useState('0');
  const [err, setErr] = useState<string>();
  useEffect(() => {
    if (enrollment) setPct(String(enrollment.extraTimePct));
    setErr(undefined);
  }, [enrollment]);
  const n = Number(pct);
  const m = useMutation({
    mutationFn: () => api(`/exams/${exam.id}/enrollments/${enrollment!.id}`, { method: 'PATCH', body: { extraTimePct: n } }),
    onSuccess: () => {
      toast.success(n ? `${enrollment!.name} gets +${n}% time` : `Accommodation removed for ${enrollment!.name}`);
      qc.invalidateQueries({ queryKey: ['enrollments', exam.id] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const submit = () => {
    if (!Number.isInteger(n) || n < 0 || n > 200) return setErr('Whole number between 0 and 200');
    m.mutate();
  };
  const minutes = Math.round(exam.durationMin * (1 + (Number.isFinite(n) ? n : 0) / 100));
  return (
    <Modal
      open={!!enrollment}
      onClose={onClose}
      title="Extra-time accommodation"
      description={enrollment ? `${enrollment.name} · ${enrollment.email}` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={m.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Common accommodations">
          {[0, 25, 50, 100].map((p) => (
            <button key={p} type="button" onClick={() => setPct(String(p))} aria-pressed={n === p} className={cx('rounded-lg border px-3 py-2 text-sm transition', n === p ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line hover:border-line-strong')}>
              {p === 0 ? 'None' : `+${p}%`}
            </button>
          ))}
        </div>
        <Field label="Custom percentage" error={err} hint="Applied when the candidate starts. Fixed once they begin.">
          {(id) => <div className="w-32"><Input id={id} type="number" min={0} max={200} value={pct} onChange={(e) => setPct(e.target.value)} className="tabular" invalid={!!err} /></div>}
        </Field>
        <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm">
          Time allowed: <strong className="tabular">{minutes} min</strong> <span className="text-muted">(standard {exam.durationMin} min)</span>
        </div>
      </div>
    </Modal>
  );
}

/* --------------------------------- Enrol --------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type EnrolMode = 'pick' | 'group' | 'emails';

function EnrolModal({ open, onClose, exam, enrolled }: { open: boolean; onClose: () => void; exam: ExamDetail; enrolled: Set<string> }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<EnrolMode>('pick');
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [group, setGroup] = useState('');
  const [emailText, setEmailText] = useState('');
  const [unknown, setUnknown] = useState<string[]>([]);
  const s = useDebounced(search.trim());
  useEffect(() => {
    if (open) {
      setSel(new Set());
      setGroup('');
      setEmailText('');
      setUnknown([]);
      setSearch('');
    }
  }, [open]);

  const users = useQuery({
    queryKey: ['users', 'candidates', s],
    queryFn: () => api<{ items: UserRow[]; total: number }>(`/users?role=CANDIDATE&pageSize=100${s ? `&search=${encodeURIComponent(s)}` : ''}`),
    enabled: open && mode === 'pick',
    placeholderData: keepPreviousData,
  });
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api<Group[]>('/users/groups'), enabled: open && mode === 'group' });

  const emails = useMemo(() => [...new Set(emailText.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))], [emailText]);
  const badEmails = emails.filter((e) => !EMAIL_RE.test(e));

  const m = useMutation({
    mutationFn: () => {
      const body = mode === 'pick' ? { candidateIds: [...sel] } : mode === 'group' ? { group } : { emails };
      return api<{ added: number; alreadyEnrolled: number; unknownEmails: string[] }>(`/exams/${exam.id}/enrollments`, { method: 'POST', body });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['enrollments', exam.id] });
      invalidateExam(qc, exam.id);
      const extra = [r.alreadyEnrolled ? `${r.alreadyEnrolled} already enrolled` : '', r.unknownEmails.length ? `${r.unknownEmails.length} not found` : ''].filter(Boolean).join(', ');
      if (r.added) toast.success(`Enrolled ${r.added} candidate${r.added === 1 ? '' : 's'}${extra ? ` (${extra})` : ''}`);
      else toast.info(`No new candidates enrolled${extra ? ` — ${extra}` : ''}`);
      if (r.unknownEmails.length) setUnknown(r.unknownEmails);
      else onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const canSubmit = mode === 'pick' ? sel.size > 0 : mode === 'group' ? !!group : emails.length > 0 && !badEmails.length;
  const pickable = (users.data?.items ?? []).filter((u) => !enrolled.has(u.id) && u.status === 'ACTIVE');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enrol candidates"
      description={exam.status === 'PUBLISHED' ? 'Newly enrolled candidates are notified immediately.' : 'Candidates are notified when you publish.'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {unknown.length ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={() => m.mutate()} loading={m.isPending} disabled={!canSubmit}>
            {mode === 'pick' ? `Enrol ${sel.size || ''} selected` : mode === 'group' ? (group ? `Enrol group ${group}` : 'Enrol group') : `Enrol ${emails.length || ''} email${emails.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <Segmented
        label="How to enrol"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setUnknown([]);
        }}
        className="mb-4"
        options={[
          { id: 'pick', label: 'Choose people' },
          { id: 'group', label: 'Whole group' },
          { id: 'emails', label: 'Paste emails' },
        ]}
      />

      {mode === 'pick' && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" aria-hidden />
            <Input type="search" aria-label="Search candidates" placeholder="Search by name or email" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {users.isLoading ? (
            <Spinner label="Searching" />
          ) : users.isError ? (
            <ErrorBox error={users.error} onRetry={() => users.refetch()} />
          ) : !users.data?.items.length ? (
            <EmptyState title="No candidates found" body="Try another search, or import new candidates." />
          ) : (
            <div className="rounded-xl border border-line">
              <label className="flex items-center gap-3 border-b border-line bg-surface-2/60 px-4 py-2 text-[13px] font-medium text-ink-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={pickable.length > 0 && pickable.every((u) => sel.has(u.id))}
                  disabled={!pickable.length}
                  onChange={(e) =>
                    setSel((p) => {
                      const n = new Set(p);
                      pickable.forEach((u) => (e.target.checked ? n.add(u.id) : n.delete(u.id)));
                      return n;
                    })
                  }
                />
                Select all {pickable.length} shown
                {users.data.total > users.data.items.length && <span className="font-normal text-muted">· showing {users.data.items.length} of {users.data.total}, refine your search</span>}
              </label>
              <ul className="max-h-[46vh] divide-y divide-line overflow-y-auto">
                {users.data.items.map((u) => {
                  const already = enrolled.has(u.id);
                  const disabled = already || u.status !== 'ACTIVE';
                  return (
                    <li key={u.id}>
                      <label className={cx('flex items-center gap-3 px-4 py-2.5', disabled ? 'opacity-55' : 'cursor-pointer hover:bg-surface-2/60', sel.has(u.id) && 'bg-accent-soft/60')}>
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--accent)]"
                          disabled={disabled}
                          checked={already || sel.has(u.id)}
                          onChange={() =>
                            setSel((p) => {
                              const n = new Set(p);
                              if (n.has(u.id)) n.delete(u.id);
                              else n.add(u.id);
                              return n;
                            })
                          }
                        />
                        <Avatar name={u.name} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{u.name}</span>
                          <span className="block truncate text-[13px] text-muted">{u.email}</span>
                        </span>
                        {u.groupName && <Badge>{u.groupName}</Badge>}
                        {already && <Badge tone="accent">Enrolled</Badge>}
                        {u.status !== 'ACTIVE' && <Badge tone="danger">Disabled</Badge>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {mode === 'group' &&
        (groups.isLoading ? (
          <Spinner label="Loading groups" />
        ) : groups.isError ? (
          <ErrorBox error={groups.error} onRetry={() => groups.refetch()} />
        ) : !groups.data?.length ? (
          <EmptyState icon={<Users className="size-6" />} title="No groups yet" body="Groups come from the “group” column when importing candidates, or can be set per user by an administrator." />
        ) : (
          <div role="radiogroup" aria-label="Groups" className="grid gap-2 sm:grid-cols-2">
            {groups.data.map((g) => (
              <button
                key={g.name}
                type="button"
                role="radio"
                aria-checked={group === g.name}
                onClick={() => setGroup(g.name)}
                className={cx('flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition', group === g.name ? 'border-accent bg-accent-soft/60 ring-1 ring-accent' : 'border-line hover:border-line-strong')}
              >
                <span className="font-medium">{g.name}</span>
                <span className="tabular text-[13px] text-muted">{g.count} candidates</span>
              </button>
            ))}
            <p className="text-[12px] text-muted sm:col-span-2">Only active accounts are enrolled. Anyone already enrolled is skipped.</p>
          </div>
        ))}

      {mode === 'emails' && (
        <div className="space-y-3">
          <Field label="Email addresses" hint="One per line, or separated by commas. Must belong to existing candidate accounts." error={badEmails.length ? `${badEmails.length} invalid: ${badEmails.slice(0, 3).join(', ')}${badEmails.length > 3 ? '…' : ''}` : undefined}>
            {(id) => <Textarea id={id} value={emailText} onChange={(e) => setEmailText(e.target.value)} className="min-h-40 font-mono text-[13px]" placeholder={'aisha.khan@example.edu\ndaniel.okafor@example.edu'} spellCheck={false} />}
          </Field>
          <div className="tabular text-[13px] text-muted">{emails.length} unique address{emails.length === 1 ? '' : 'es'} detected</div>
        </div>
      )}

      {unknown.length > 0 && (
        <div role="alert" className="mt-4 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm">
          <div className="font-medium text-warn">{unknown.length} address{unknown.length === 1 ? '' : 'es'} didn’t match a candidate account</div>
          <p className="mt-1 break-words font-mono text-[12px] text-ink-2">{unknown.join(', ')}</p>
          <p className="mt-1 text-[12px] text-ink-2">Use “Import new” to create accounts for them.</p>
        </div>
      )}
    </Modal>
  );
}
