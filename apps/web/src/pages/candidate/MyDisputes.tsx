import { useQuery } from '@tanstack/react-query';
import { CircleDot, Gavel } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Card, EmptyState, ErrorBox, PageHeader, Spinner } from '@/components/ui';
import { DisputeBadge } from '@/components/status';

interface D {
  id: string;
  status: string;
  category: string;
  message: string;
  resolution: string | null;
  scoreBefore: number | null;
  scoreAfter: number | null;
  createdAt: string;
  resolvedAt: string | null;
  attempt: { exam: { title: string } };
  attemptQuestion: { position: number } | null;
  timeline: { action: string; at: string; data: Record<string, unknown> }[];
}
const LABEL: Record<string, string> = { 'dispute.open': 'Dispute submitted', 'dispute.under_review': 'Examiner started reviewing', 'dispute.upheld': 'Dispute upheld', 'dispute.rejected': 'Dispute rejected' };

export default function MyDisputes() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['my-disputes'], queryFn: () => api<D[]>('/candidate/disputes') });
  return (
    <div className="max-w-4xl">
      <PageHeader title="Disputes" subtitle="Track every query you've raised about a result. Decisions include a written reason and are permanently recorded." />
      {isLoading && <Spinner />}
      {error && <ErrorBox error={error} onRetry={refetch} />}
      {data && !data.length && <Card><EmptyState icon={<Gavel className="size-6" />} title="No disputes" body="If you believe a result is wrong, open it from Results and choose “Raise a dispute”." /></Card>}
      <div className="space-y-4">
        {data?.map((d) => (
          <Card key={d.id} className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <DisputeBadge status={d.status} />
              <span className="font-semibold">{d.attempt.exam.title}</span>
              {d.attemptQuestion && <span className="text-sm text-muted">· Question {d.attemptQuestion.position}</span>}
              <span className="ml-auto text-xs text-muted">{fmtDate(d.createdAt)}</span>
            </div>
            <p className="mt-2 text-sm text-ink-2">{d.message}</p>
            {d.resolution && (
              <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${d.status === 'UPHELD' ? 'bg-ok-soft text-ok' : 'bg-surface-2 text-ink-2'}`}>
                <strong>Decision:</strong> {d.resolution}
                {d.scoreAfter !== null && d.scoreBefore !== null && d.scoreAfter !== d.scoreBefore && <> — score {d.scoreBefore} → <strong>{d.scoreAfter}</strong></>}
              </div>
            )}
            <ol className="mt-4 space-y-2 border-l-2 border-line pl-4">
              {d.timeline.map((t, i) => (
                <li key={i} className="relative text-sm">
                  <CircleDot className="absolute -left-[23px] top-0.5 size-3.5 bg-surface text-accent" />
                  <span className="font-medium">{LABEL[t.action] ?? t.action}</span> <span className="text-muted">· {fmtDate(t.at)}</span>
                </li>
              ))}
            </ol>
          </Card>
        ))}
      </div>
    </div>
  );
}
