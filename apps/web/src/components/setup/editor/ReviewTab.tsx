import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Eye, Rocket, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Button, Card, CardHeader, cx, ErrorBox, Spinner } from '@/components/ui';
import type { ExamDetail, ReviewCheck } from '../types';
import { usePublish } from './common';

export function ReviewTab({ exam, onPreview, previewing }: { exam: ExamDetail; onPreview: () => void; previewing: boolean }) {
  const q = useQuery({ queryKey: ['review', exam.id], queryFn: () => api<{ checks: ReviewCheck[]; canPublish: boolean }>(`/exams/${exam.id}/review`) });
  const { publish, publishing, modal } = usePublish(exam);

  if (q.isLoading) return <Spinner label="Running pre-publication checks" />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const checks = q.data!.checks;
  const blocking = checks.filter((c) => !c.ok && c.blocking);
  const warnings = checks.filter((c) => !c.ok && !c.blocking);
  const passed = checks.filter((c) => c.ok);
  const isDraft = exam.status === 'DRAFT';

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <Card>
        <CardHeader title="Pre-publication checklist" subtitle={`${passed.length} of ${checks.length} checks passed`} />
        <ul className="divide-y divide-line">
          {[...blocking, ...warnings, ...passed].map((c) => {
            const state = c.ok ? 'ok' : c.blocking ? 'block' : 'warn';
            return (
              <li key={c.label} className="flex items-start gap-3 px-5 py-3.5">
                {state === 'ok' ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden /> : state === 'block' ? <XCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden /> : <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <div className={cx('text-sm', state === 'ok' ? 'text-ink-2' : 'font-medium')}>{c.label}</div>
                  {c.detail && <div className="text-[13px] text-muted">{c.detail}</div>}
                </div>
                <span className={cx('shrink-0 text-[12px] font-medium uppercase tracking-wide', state === 'ok' ? 'text-ok' : state === 'block' ? 'text-danger' : 'text-warn')}>
                  <span className="sr-only">Status: </span>
                  {state === 'ok' ? 'Pass' : state === 'block' ? 'Blocking' : 'Advisory'}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="space-y-4">
        <Card className={cx('p-5', isDraft && q.data!.canPublish && 'border-accent/50')}>
          {isDraft ? (
            q.data!.canPublish ? (
              <>
                <div className="flex items-center gap-2 text-ok">
                  <CheckCircle2 className="size-5" aria-hidden />
                  <span className="font-semibold">Ready to publish</span>
                </div>
                <p className="mt-2 text-sm text-ink-2">
                  Candidates will see it in their list and be notified. It opens <strong className="text-ink">{fmtDate(exam.windowStart)}</strong>.
                  {warnings.length > 0 && ` ${warnings.length} advisory item${warnings.length === 1 ? '' : 's'} won’t stop you.`}
                </p>
                <Button size="lg" className="mt-4 w-full" icon={<Rocket className="size-4" />} onClick={publish} loading={publishing}>
                  Publish examination
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-danger">
                  <XCircle className="size-5" aria-hidden />
                  <span className="font-semibold">
                    {blocking.length} blocking issue{blocking.length === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="mt-2 text-sm text-ink-2">Resolve the items marked “Blocking” to publish. Advisory items are recommendations only.</p>
                <Button size="lg" className="mt-4 w-full" icon={<Rocket className="size-4" />} disabled>
                  Publish examination
                </Button>
              </>
            )
          ) : (
            <>
              <div className="font-semibold">Already published</div>
              <p className="mt-1 text-sm text-ink-2">
                {exam.publishedAt ? `Published ${fmtDate(exam.publishedAt)}. ` : ''}The checklist is kept here for reference.
              </p>
            </>
          )}
        </Card>
        <Card className="p-5">
          <div className="font-semibold">Try it first</div>
          <p className="mt-1 text-sm text-ink-2">Open a sandbox attempt to see exactly what candidates will. Sandbox attempts never count towards results.</p>
          <Button variant="outline" className="mt-3 w-full" icon={<Eye className="size-4" />} onClick={onPreview} loading={previewing}>
            Preview as candidate
          </Button>
        </Card>
      </div>
      {modal}
    </div>
  );
}
