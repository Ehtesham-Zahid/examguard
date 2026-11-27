import { useQuery } from '@tanstack/react-query';
import { Award, ChevronRight, Download, GraduationCap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useDownload } from '@/components/ops/hooks';
import { fmtDate, pct } from '@/lib/format';
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorBox, PageHeader, ProgressBar, Spinner } from '@/components/ui';

interface R {
  attemptId: string;
  exam: { id: string; title: string; totalMarks: number; passMarks: number; resultsPublishedAt: string };
  score: number;
  maxScore: number;
  passed: boolean;
  submittedAt: string;
  certificateCode?: string;
}

export default function MyResults() {
  const dl = useDownload();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['my-results'], queryFn: () => api<R[]>('/candidate/results') });
  const avg = data?.length ? Math.round(data.reduce((s, r) => s + pct(r.score, r.maxScore), 0) / data.length) : 0;
  return (
    <div>
      <PageHeader title="Results" subtitle="Published results only. Each report carries a verification code anyone can check." />
      {isLoading && <Spinner />}
      {error && <ErrorBox error={error} onRetry={refetch} />}
      {data && !data.length && (
        <Card>
          <EmptyState icon={<GraduationCap className="size-6" />} title="No published results yet" body="Results appear here as soon as your examiner publishes them." />
        </Card>
      )}
      {!!data?.length && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Card className="p-4"><div className="text-xs text-muted">Exams with results</div><div className="tabular mt-1 text-2xl font-semibold">{data.length}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted">Average score</div><div className="tabular mt-1 text-2xl font-semibold">{avg}%</div></Card>
            <Card className="p-4"><div className="text-xs text-muted">Passed</div><div className="tabular mt-1 text-2xl font-semibold">{data.filter((r) => r.passed).length} / {data.length}</div></Card>
          </div>
          <div className="space-y-3">
            {data.map((r) => (
              <Card key={r.attemptId} className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
                <div className="grid size-12 place-items-center rounded-xl bg-accent-soft text-accent"><Award className="size-6" /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{r.exam.title}</div>
                  <div className="text-sm text-muted">Submitted {fmtDate(r.submittedAt)}{r.certificateCode && <> · <span className="font-mono">{r.certificateCode}</span></>}</div>
                  <ProgressBar value={r.score} max={r.maxScore} tone={r.passed ? 'ok' : 'danger'} className="mt-2 max-w-sm" label="Score" />
                </div>
                <div className="text-right">
                  <div className="tabular text-xl font-semibold">{r.score}<span className="text-sm text-muted"> / {r.maxScore}</span></div>
                  <Badge tone={r.passed ? 'ok' : 'danger'}>{r.passed ? 'Pass' : 'Fail'} · {pct(r.score, r.maxScore)}%</Badge>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" icon={<Download className="size-4" />} loading={dl.busy === `/reports/attempts/${r.attemptId}/pdf`} onClick={() => dl.run(`/reports/attempts/${r.attemptId}/pdf`, 'result.pdf')}>PDF</Button>
                  <ButtonLink to={`/candidate/results/${r.attemptId}`} size="sm" variant="secondary" icon={<ChevronRight className="size-4" />} className="flex-row-reverse">Details</ButtonLink>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
