import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Download, FileDown, Globe, Lock, PenLine, Search, Sheet } from 'lucide-react';
import { api, ApiError, errMsg } from '@/lib/api';
import { fmtDate, fmtDuration } from '@/lib/format';
import { AttemptBadge } from '@/components/status';
import { Badge, Button, Card, ConfirmDialog, cx, EmptyState, Field, Input, Modal, ProgressBar, Select, Stat, Table, Td, Textarea, Th } from '@/components/ui';
import type { ResultRow, ResultsData } from '../types';
import { fmtScore, IntegrityPill } from '../bits';
import { downloadCsv, useDownload } from '../hooks';

type SortKey = 'rank' | 'name' | 'score' | 'integrity' | 'incidents' | 'duration';

export function ResultsTab({ data }: { data: ResultsData }) {
  const { exam, summary, grading } = data;
  const qc = useQueryClient();
  const nav = useNavigate();
  const dl = useDownload();
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<'all' | 'pass' | 'fail'>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rank', dir: 1 });
  const [publishOpen, setPublishOpen] = useState(false);
  const [unpubOpen, setUnpubOpen] = useState(false);
  const [unpubReason, setUnpubReason] = useState('');
  const [unpubTouched, setUnpubTouched] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['results', exam.id] });
    qc.invalidateQueries({ queryKey: ['analytics', exam.id] });
  };
  const publish = useMutation({
    mutationFn: () => api<{ published: number }>(`/staff/exams/${exam.id}/results/publish`, { method: 'POST' }),
    onSuccess: (r) => {
      setConflict(null);
      setPublishOpen(false);
      toast.success(`Results published to ${r.published} candidate(s)`, { description: 'Signed certificates were issued and candidates notified.' });
      invalidate();
    },
    onError: (e) => {
      setPublishOpen(false);
      if (e instanceof ApiError && e.status === 409) setConflict(e.message);
      else toast.error(errMsg(e));
    },
  });
  const unpubErr = unpubReason.trim().length < 5 ? 'Give a reason of at least 5 characters' : null;
  const unpublish = useMutation({
    mutationFn: () => api(`/staff/exams/${exam.id}/results/unpublish`, { method: 'POST', body: { reason: unpubReason.trim() } }),
    onSuccess: () => {
      toast.success('Results withdrawn', { description: 'Candidates can no longer see them and certificates were revoked.' });
      setUnpubOpen(false);
      setUnpubReason('');
      setUnpubTouched(false);
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const pctOf = (r: ResultRow) => (r.maxScore ? ((r.score ?? 0) / r.maxScore) * 100 : 0);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const val = (r: ResultRow): number | string => {
      switch (sort.key) {
        case 'rank':
          return r.rank ?? 1e9;
        case 'name':
          return r.candidate.name.toLowerCase();
        case 'score':
          return pctOf(r);
        case 'integrity':
          return r.integrityScore;
        case 'incidents':
          return r.incidents;
        case 'duration':
          return r.durationSec ?? 1e9;
      }
    };
    return data.attempts
      .filter((r) => !q || r.candidate.name.toLowerCase().includes(q) || r.candidate.email.toLowerCase().includes(q) || (r.certificateCode ?? '').toLowerCase().includes(q))
      .filter((r) => outcome === 'all' || (r.status !== 'IN_PROGRESS' && (outcome === 'pass' ? r.passed : !r.passed)))
      .sort((a, b) => {
        const x = val(a);
        const y = val(b);
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
  }, [data.attempts, query, outcome, sort]);

  const exportCsv = () => {
    downloadCsv(`${exam.title.replace(/\W+/g, '-')}-results.csv`, [
      ['Rank', 'Candidate', 'Email', 'Group', 'Score', 'Max', 'Percent', 'Result', 'Status', 'Grading', 'Integrity', 'Incidents', 'Duration (min)', 'Certificate'],
      ...rows.map((r) => [r.rank, r.candidate.name, r.candidate.email, r.candidate.groupName, r.score, r.maxScore, Math.round(pctOf(r)), r.status === 'IN_PROGRESS' ? '' : r.passed ? 'Pass' : 'Fail', r.status, r.gradingStatus, r.integrityScore, r.incidents, r.durationSec != null ? Math.round(r.durationSec / 60) : '', r.certificateCode]),
    ]);
    toast.success(`Exported ${rows.length} row(s)`);
  };

  const sortTh = (key: SortKey, label: string, className?: string) => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
    return (
      <Th className={className} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-ink" onClick={() => setSort({ key, dir: active ? ((sort.dir * -1) as 1 | -1) : key === 'name' || key === 'rank' ? 1 : -1 })}>
          {label} <Icon className={cx('size-3', !active && 'opacity-40')} aria-hidden />
        </button>
      </Th>
    );
  };

  const published = !!exam.resultsPublishedAt;
  const needsGrading = grading.total - grading.graded;

  return (
    <div className="flex flex-col gap-5">
      {/* publish state */}
      <Card className={cx('flex flex-wrap items-center justify-between gap-4 px-5 py-4', published ? 'border-ok/40' : '')}>
        <div className="flex items-start gap-3">
          <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', published ? 'bg-ok-soft text-ok' : 'bg-surface-2 text-ink-2')}>{published ? <Globe className="size-5" aria-hidden /> : <Lock className="size-5" aria-hidden />}</span>
          <div>
            <div className="font-semibold">{published ? 'Results are published' : 'Results are private'}</div>
            <p className="text-[13px] text-ink-2">{published ? `Candidates can see their scores and verified certificates since ${fmtDate(exam.resultsPublishedAt)}.` : 'Only staff can see these results. Publishing issues signed certificates and notifies every candidate.'}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" icon={<FileDown className="size-4" />} loading={dl.busy === `/reports/exams/${exam.id}/pdf`} onClick={() => dl.run(`/reports/exams/${exam.id}/pdf`, 'exam-report.pdf')}>
            Exam report PDF
          </Button>
          {published ? (
            <Button variant="outline" onClick={() => setUnpubOpen(true)}>
              Unpublish…
            </Button>
          ) : (
            <Button onClick={() => setPublishOpen(true)} icon={<Globe className="size-4" />}>
              Publish results
            </Button>
          )}
        </div>
        {conflict && (
          <div role="alert" className="flex w-full items-start gap-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-sm text-warn">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="flex-1">
              <strong>Can't publish yet:</strong> {conflict}
              {/manual grading/i.test(conflict) && (
                <Link to={`/examiner/exams/${exam.id}/grading`} className="ml-2 font-semibold underline">
                  Open grading →
                </Link>
              )}
            </div>
            <button className="text-[12px] font-medium underline" onClick={() => setConflict(null)}>
              Dismiss
            </button>
          </div>
        )}
      </Card>

      {/* tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Submissions" value={summary.count} hint={grading.inProgress ? `${grading.inProgress} still writing` : undefined} />
        <Stat label="Mean score" value={fmtScore(summary.mean)} hint={`of ${exam.totalMarks} marks`} />
        <Stat label="Median" value={fmtScore(summary.median)} hint={`SD ${fmtScore(summary.sd)}`} />
        <Stat label="Pass rate" value={`${Math.round(summary.passRate)}%`} hint={`Pass mark ${exam.passMarks}`} tone={summary.passRate >= 50 ? 'ok' : 'warn'} />
        <Stat label="Highest" value={fmtScore(summary.max)} />
        <Stat label="Lowest" value={fmtScore(summary.min)} />
      </div>

      {/* grading progress */}
      <Card className="flex flex-wrap items-center gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="flex items-center gap-2 font-medium">{needsGrading ? <PenLine className="size-4 text-warn" aria-hidden /> : <CheckCircle2 className="size-4 text-ok" aria-hidden />} Grading progress</span>
            <span className="tabular text-ink-2">
              {grading.graded}/{grading.total} attempts fully graded
            </span>
          </div>
          <ProgressBar value={grading.graded} max={grading.total || 1} tone={needsGrading ? 'warn' : 'ok'} label="Attempts fully graded" />
        </div>
        {needsGrading > 0 && (
          <Link to={`/examiner/exams/${exam.id}/grading`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink hover:brightness-110">
            <PenLine className="size-4" aria-hidden /> Grade {needsGrading} attempt{needsGrading > 1 ? 's' : ''}
          </Link>
        )}
      </Card>

      {/* table */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <label className="relative min-w-0 flex-1 sm:max-w-xs">
            <span className="sr-only">Search results</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, email or certificate" className="h-9 pl-9" />
          </label>
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} className="h-9 w-auto" aria-label="Filter by outcome">
            <option value="all">All outcomes</option>
            <option value="pass">Passed</option>
            <option value="fail">Failed</option>
          </Select>
          <div className="ml-auto">
            <Button size="sm" variant="outline" onClick={exportCsv} icon={<Sheet className="size-4" />} disabled={!rows.length}>
              Export CSV
            </Button>
          </div>
        </div>
        {!data.attempts.length ? (
          <EmptyState title="No attempts yet" body="Results appear once candidates submit." />
        ) : !rows.length ? (
          <EmptyState title="No matches" body="Try a different search or filter." />
        ) : (
          <Table className="[&_table]:min-w-[1020px]">
            <thead>
              <tr>
                {sortTh('rank', '#', 'w-14')}
                {sortTh('name', 'Candidate')}
                {sortTh('score', 'Score')}
                <Th>Result</Th>
                <Th>Status</Th>
                {sortTh('integrity', 'Integrity')}
                {sortTh('incidents', 'Incidents')}
                {sortTh('duration', 'Time')}
                <Th>Certificate</Th>
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = Math.round(pctOf(r));
                const done = r.status !== 'IN_PROGRESS';
                return (
                  <tr key={r.id} className="cursor-pointer transition-colors hover:bg-surface-2/50" onClick={() => nav(`/examiner/attempts/${r.id}`)}>
                    <Td className="tabular font-semibold text-ink-2">{r.rank ?? '—'}</Td>
                    <Td>
                      <Link to={`/examiner/attempts/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">
                        {r.candidate.name}
                      </Link>
                      <div className="text-[12px] text-muted">
                        {r.candidate.email}
                        {r.candidate.groupName ? ` · ${r.candidate.groupName}` : ''}
                      </div>
                    </Td>
                    <Td>
                      <div className="tabular font-semibold">
                        {fmtScore(r.score)}
                        <span className="font-normal text-muted">/{r.maxScore}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <ProgressBar value={p} className="w-16" tone={r.passed ? 'ok' : 'danger'} label={`${p}%`} />
                        <span className="tabular text-[12px] text-ink-2">{p}%</span>
                      </div>
                    </Td>
                    <Td>{done ? r.gradingStatus !== 'GRADED' ? <Badge tone="warn">Provisional</Badge> : r.passed ? <Badge tone="ok">Pass</Badge> : <Badge tone="danger">Fail</Badge> : '—'}</Td>
                    <Td>
                      <AttemptBadge status={r.status} />
                    </Td>
                    <Td>
                      <IntegrityPill score={r.integrityScore} />
                    </Td>
                    <Td className="tabular">{r.incidents || <span className="text-muted">0</span>}</Td>
                    <Td className="tabular text-ink-2">{r.durationSec != null ? fmtDuration(r.durationSec * 1000) : '—'}</Td>
                    <Td>{r.certificateCode ? <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px]">{r.certificateCode}</code> : <span className="text-muted">—</span>}</Td>
                    <Td className="text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          dl.run(`/reports/attempts/${r.id}/pdf`, `result-${r.candidate.name}.pdf`);
                        }}
                        disabled={dl.busy === `/reports/attempts/${r.id}/pdf` || !done}
                        className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-40"
                        aria-label={`Download ${r.candidate.name}'s result PDF`}
                        title="Candidate PDF"
                      >
                        <Download className="size-4" />
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onConfirm={() => publish.mutate()}
        loading={publish.isPending}
        title="Publish results?"
        confirmLabel="Publish to candidates"
        body={
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>{summary.count} candidate(s) see their score and feedback.</li>
            <li>Each receives a digitally signed, verifiable certificate.</li>
            <li>Later grade changes require a reason and are audited.</li>
          </ul>
        }
      />
      <Modal
        open={unpubOpen}
        onClose={() => setUnpubOpen(false)}
        title="Withdraw published results?"
        description="Candidates lose access and all certificates for this exam are revoked."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setUnpubOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={unpublish.isPending}
              onClick={() => {
                setUnpubTouched(true);
                if (!unpubErr) unpublish.mutate();
              }}
            >
              Unpublish
            </Button>
          </>
        }
      >
        <Field label="Reason (audited)" required error={unpubTouched ? (unpubErr ?? undefined) : undefined}>
          {(id) => <Textarea id={id} value={unpubReason} onChange={(e) => setUnpubReason(e.target.value)} maxLength={300} placeholder="e.g. Answer key error found in Q4 — re-grading." />}
        </Field>
      </Modal>
    </div>
  );
}
