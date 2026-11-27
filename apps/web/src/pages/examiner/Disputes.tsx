import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight, Eye, Gavel, Hash, MessageSquareQuote } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { fmtDate, relative } from '@/lib/format';
import { RichText } from '@/components/RichText';
import { DisputeBadge } from '@/components/status';
import { Badge, Button, Card, cx, EmptyState, ErrorBox, PageHeader, Spinner, Tabs } from '@/components/ui';
import { OptionList, selectedOf, textOf, WrittenResponse } from '@/components/ops/answers';
import { AuditNotice, CATEGORY_LABEL, fmtScore } from '@/components/ops/bits';
import { ResolveDisputeModal } from '@/components/ops/ResolveDisputeModal';
import type { Dispute } from '@/components/ops/types';

type Status = Dispute['status'];
type TabId = 'ALL' | Status;
const TAB_IDS: TabId[] = ['OPEN', 'UNDER_REVIEW', 'UPHELD', 'REJECTED', 'ALL'];

const ACTION_LABEL: Record<string, string> = {
  'dispute.open': 'Raised by the candidate',
  'dispute.under_review': 'Review started',
  'dispute.upheld': 'Upheld',
  'dispute.rejected': 'Rejected',
};
const REMEDY_LABEL: Record<string, string> = {
  NONE: 'no score change',
  ADJUST_SCORE: 'score adjusted',
  ACCEPT_ANSWER: 'additional answer accepted for everyone',
  VOID_QUESTION: 'question voided for everyone',
};

function DisputeCard({ d, onResolve }: { d: Dispute; onResolve: (d: Dispute) => void }) {
  const qc = useQueryClient();
  const review = useMutation({
    mutationFn: () => api(`/staff/disputes/${d.id}/review`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Marked as under review', { description: `${d.raisedBy.name} has been notified.` });
      qc.invalidateQueries({ queryKey: ['disputes'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const q = d.question;
  const resolved = d.status === 'UPHELD' || d.status === 'REJECTED';

  return (
    <Card className={cx('overflow-hidden', d.status === 'OPEN' && 'border-warn/40')}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{d.raisedBy.name}</span>
            <DisputeBadge status={d.status} />
            <Badge>{CATEGORY_LABEL[d.category] ?? d.category}</Badge>
          </div>
          <div className="mt-0.5 text-[13px] text-ink-2">
            {d.attempt.exam.title}
            {q ? ` · Question ${q.position}` : ' · whole attempt'} · raised {relative(d.createdAt)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/examiner/attempts/${d.attemptId}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
            <Eye className="size-4" aria-hidden /> Attempt
          </Link>
          {d.status === 'OPEN' && (
            <Button size="sm" variant="outline" loading={review.isPending} onClick={() => review.mutate()}>
              Start review
            </Button>
          )}
          {!resolved && (
            <Button size="sm" icon={<Gavel className="size-4" />} onClick={() => onResolve(d)}>
              Resolve…
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-5 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex min-w-0 flex-col gap-4">
          <blockquote className="flex gap-3 rounded-lg bg-surface-2/60 px-4 py-3">
            <MessageSquareQuote className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink">{d.message}</p>
          </blockquote>

          {q && (
            <div className="rounded-lg border border-line p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Question {q.position}</span>
                {q.voided && <Badge tone="info">Voided</Badge>}
                <span className={cx('tabular ml-auto rounded-md px-2 py-0.5 text-sm font-semibold', q.score >= q.marks ? 'bg-ok-soft text-ok' : q.score > 0 ? 'bg-warn-soft text-warn' : 'bg-danger-soft text-danger')}>
                  {fmtScore(q.score)}/{q.marks}
                </span>
              </div>
              <RichText text={q.body} className="mb-3 text-[15px] leading-relaxed text-ink" />
              {q.type === 'WRITTEN' ? <WrittenResponse text={textOf(q.response)} /> : q.options?.length ? <OptionList compact options={q.options} correct={q.correct} selected={selectedOf(q.response)} /> : null}
              <p className="mt-2 text-[12px] text-muted">Options shown in bank order; “Chosen” marks the candidate's response.</p>
            </div>
          )}

          {resolved && (
            <div className={cx('rounded-lg border px-4 py-3', d.status === 'UPHELD' ? 'border-ok/40 bg-ok-soft' : 'border-line bg-surface-2/60')}>
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {d.status === 'UPHELD' ? 'Upheld' : 'Rejected'} {d.resolvedAt && <span className="font-normal text-muted">· {fmtDate(d.resolvedAt)}</span>}
              </div>
              {d.resolution && <p className="mt-1 text-[14px] whitespace-pre-wrap text-ink">{d.resolution}</p>}
              <div className="tabular mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                <span>Score</span>
                <strong className="text-ink">{fmtScore(d.scoreBefore)}</strong>
                <ArrowRight className="size-3.5" aria-hidden />
                <strong className="text-ink">{fmtScore(d.scoreAfter)}</strong>
                {d.affectedCount != null && <span>· {d.affectedCount} candidate score(s) changed</span>}
              </div>
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">Audit trail</h3>
          <ol className="relative ml-1.5 border-l-2 border-line">
            {(d.timeline.some((t) => t.action === 'dispute.open') ? d.timeline : [{ action: 'dispute.open', at: d.createdAt, data: null, hash: '' }, ...d.timeline]).map((t, i) => {
              const remedy = typeof t.data?.action === 'string' ? REMEDY_LABEL[t.data.action] : undefined;
              return (
                <li key={i} className="relative pb-3.5 pl-4 last:pb-0">
                  <span className={cx('absolute top-1.5 -left-[5px] size-2 rounded-full', t.action.endsWith('upheld') ? 'bg-ok' : t.action.endsWith('rejected') ? 'bg-ink-2' : 'bg-accent')} aria-hidden />
                  <div className="text-[13px] font-medium text-ink">{ACTION_LABEL[t.action] ?? t.action}</div>
                  {remedy && <div className="text-[12px] text-ink-2">Remedy: {remedy}</div>}
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    <time dateTime={t.at}>{fmtDate(t.at)}</time>
                    {t.hash && (
                      <code className="inline-flex items-center rounded bg-surface-2 px-1 font-mono text-[10.5px] text-ink-2" title="Audit-log hash (chain link)">
                        <Hash className="size-2.5" aria-hidden />
                        {t.hash}
                      </code>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </Card>
  );
}

export default function Disputes() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('status') as TabId | null;
  const tab: TabId = raw && TAB_IDS.includes(raw) ? raw : 'OPEN';
  const q = useQuery({ queryKey: ['disputes'], queryFn: () => api<Dispute[]>('/staff/disputes') });
  const [resolving, setResolving] = useState<Dispute | null>(null);

  const all = q.data ?? [];
  const count = (s: TabId) => (s === 'ALL' ? all.length : all.filter((d) => d.status === s).length);
  const list = tab === 'ALL' ? all : all.filter((d) => d.status === tab);
  const LABEL: Record<TabId, string> = { OPEN: 'Open', UNDER_REVIEW: 'Under review', UPHELD: 'Upheld', REJECTED: 'Rejected', ALL: 'All' };

  return (
    <div>
      <PageHeader eyebrow="Fairness" title="Disputes" subtitle="Candidates can challenge a mark or a question. Every decision is explained to them and recorded in the tamper-evident audit log." />
      <div className="mb-5">
        <AuditNotice>Transparency by design: each step below carries the hash of its audit-log entry. Altering any past entry breaks the chain, so decisions cannot be quietly rewritten.</AuditNotice>
      </div>
      <Tabs<TabId> className="mb-5" value={tab} onChange={(t) => setParams(t === 'OPEN' ? {} : { status: t }, { replace: true })} tabs={TAB_IDS.map((id) => ({ id, label: LABEL[id], count: q.data ? count(id) : undefined }))} />
      {q.isLoading ? (
        <Spinner label="Loading disputes" />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : !list.length ? (
        <Card>
          <EmptyState icon={<Gavel className="size-6" />} title={tab === 'OPEN' ? 'No open disputes' : `No ${LABEL[tab].toLowerCase()} disputes`} body={tab === 'OPEN' ? 'When a candidate challenges a mark it appears here.' : undefined} />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {list.map((d) => (
            <DisputeCard key={d.id} d={d} onResolve={setResolving} />
          ))}
        </div>
      )}
      <ResolveDisputeModal dispute={resolving} onClose={() => setResolving(null)} />
    </div>
  );
}
