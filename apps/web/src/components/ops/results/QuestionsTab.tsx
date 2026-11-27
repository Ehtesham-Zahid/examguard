import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, FlaskConical, Info, RefreshCw } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { RichText } from '@/components/RichText';
import { DIFFICULTY_TONE, TYPE_LABEL } from '@/components/status';
import { Badge, Button, Card, ConfirmDialog, cx, EmptyState, Toggle } from '@/components/ui';
import type { AnalyticsData, QuestionStats } from '../types';
import { fmtSec } from '../bits';

const LEVEL = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' } as const;

function discr(d: number | null): { tone: 'ok' | 'warn' | 'danger' | 'neutral'; text: string } {
  if (d === null) return { tone: 'neutral', text: 'Not enough data' };
  if (d >= 0.3) return { tone: 'ok', text: 'Good — separates strong from weak' };
  if (d >= 0.1) return { tone: 'warn', text: 'Fair — could be sharper' };
  return { tone: 'danger', text: 'Review — strong and weak score alike' };
}

function Metric({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'ok' | 'warn' | 'danger' | 'neutral' }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={cx('tabular mt-0.5 text-lg font-semibold', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn', tone === 'danger' && 'text-danger')}>{value}</div>
      {hint && <div className="text-[11px] leading-snug text-ink-2">{hint}</div>}
    </div>
  );
}

function QuestionCard({ q, index }: { q: QuestionStats; index: number }) {
  const d = discr(q.discrimination);
  const maxPicks = Math.max(1, ...q.options.map((o) => o.picks));
  const mismatch = q.labelledDifficulty !== q.observedDifficulty;
  return (
    <Card className={cx('overflow-hidden', q.flags.length > 0 && 'border-warn/40')}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <span className="display text-lg font-semibold">Q{index + 1}</span>
        <Badge>{TYPE_LABEL[q.type]}</Badge>
        <Badge tone="accent">{q.topic}</Badge>
        <span className="ml-auto text-[12px] text-muted">
          {q.n} candidate{q.n === 1 ? '' : 's'} received it
        </span>
      </div>
      <div className="px-5 py-4">
        <RichText text={q.body} className="text-[15px] leading-relaxed text-ink" />

        {q.flags.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {q.flags.map((f) => (
              <li key={f} className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {f}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <Metric label="Difficulty index" value={`${q.difficultyIndex}%`} hint="Average share of marks earned (higher = easier)" />
          <Metric label="Discrimination" value={q.discrimination ?? '—'} tone={d.tone} hint={d.text} />
          <Metric label="Skip rate" value={`${q.skipRate}%`} tone={q.skipRate >= 30 ? 'warn' : undefined} hint={`${q.attempted}/${q.n} answered`} />
          <Metric label="Avg. time" value={fmtSec(q.avgTimeSec)} />
          <Metric label="Flagged for review" value={q.flaggedForReview} hint="Candidates who marked it to revisit" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-ink-2">Labelled</span>
          <Badge tone={DIFFICULTY_TONE[q.labelledDifficulty]}>{LEVEL[q.labelledDifficulty]}</Badge>
          <span className="text-muted" aria-hidden>→</span>
          <span className="text-ink-2">observed</span>
          <Badge tone={DIFFICULTY_TONE[q.observedDifficulty]}>{LEVEL[q.observedDifficulty]}</Badge>
          {mismatch && <span className="text-[12px] text-warn">Label doesn't match how candidates performed</span>}
          {q.calibrated != null && <span className="tabular ml-auto text-[12px] text-muted">Bank calibration p = {q.calibrated}</span>}
        </div>

        {q.type !== 'WRITTEN' && q.options.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">How candidates answered</div>
            <ul className="flex flex-col gap-1.5">
              {q.options.map((o, i) => {
                const share = q.n ? Math.round((o.picks / q.n) * 100) : 0;
                return (
                  <li key={o.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                    <span className={cx('flex min-w-0 items-center gap-2 text-[13px]', o.correct ? 'font-semibold text-ok' : 'text-ink')}>
                      <span className="w-4 shrink-0 text-muted">{String.fromCharCode(65 + i)}</span>
                      <span className="truncate" title={o.text}>{o.text}</span>
                      {o.correct && <Check className="size-4 shrink-0" aria-label="Correct answer" />}
                    </span>
                    <span className="col-span-2 h-2.5 overflow-hidden rounded-full bg-surface-2 sm:col-span-1 sm:order-none order-last">
                      <span className={cx('block h-full rounded-full', o.correct ? 'bg-ok' : 'bg-line-strong')} style={{ width: `${(o.picks / maxPicks) * 100}%` }} />
                    </span>
                    <span className="tabular text-right text-[12px] text-ink-2">
                      {o.picks} · {share}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

export function QuestionsTab({ data, examId }: { data: AnalyticsData; examId: string }) {
  const qc = useQueryClient();
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const calibrate = useMutation({
    mutationFn: () => api<{ updated: number }>(`/staff/exams/${examId}/calibrate`, { method: 'POST' }),
    onSuccess: (r) => {
      setConfirm(false);
      toast.success(`Recalibrated ${r.updated} question(s) in the bank`, { description: 'Future fair papers will use the new difficulty estimates.' });
      qc.invalidateQueries({ queryKey: ['analytics', examId] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const list = data.questions.map((q, i) => ({ q, i })).filter((x) => !onlyFlagged || x.q.flags.length);
  const flagged = data.questions.filter((q) => q.flags.length).length;

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-wrap items-start gap-4 px-5 py-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <FlaskConical className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Feed real performance back into the question bank</div>
          <p className="mt-0.5 max-w-2xl text-[13px] text-ink-2">
            Recalibration blends each question's labelled difficulty with how candidates actually scored here. The fair-paper generator uses these estimates so every randomised paper has the same overall difficulty.
          </p>
        </div>
        <Button onClick={() => setConfirm(true)} icon={<RefreshCw className="size-4" />} disabled={!data.questions.length}>
          Recalibrate difficulty in bank
        </Button>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13px] text-ink-2">
          <Info className="size-4 text-info" aria-hidden />
          Discrimination: <strong className="text-ok">≥ 0.3 good</strong> · 0.1–0.3 fair · <strong className="text-danger">&lt; 0.1 review</strong> (top vs bottom 27% of candidates)
        </p>
        <div className="rounded-lg border border-line bg-surface px-3">
          <Toggle checked={onlyFlagged} onChange={setOnlyFlagged} label={`Only flagged (${flagged})`} />
        </div>
      </div>

      {!list.length ? (
        <Card>
          <EmptyState title={onlyFlagged ? 'No questions flagged' : 'No question data yet'} body={onlyFlagged ? 'Every question behaved as expected.' : 'Analysis appears once candidates submit.'} />
        </Card>
      ) : (
        list.map(({ q, i }) => <QuestionCard key={q.questionId} q={q} index={i} />)
      )}

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => calibrate.mutate()}
        loading={calibrate.isPending}
        title="Recalibrate the question bank?"
        confirmLabel="Recalibrate"
        body={`Updates the calibrated difficulty of ${data.questions.length} question(s) using results from ${data.summary.count} candidate(s). Labels you set are kept; the action is audited.`}
      />
    </div>
  );
}
