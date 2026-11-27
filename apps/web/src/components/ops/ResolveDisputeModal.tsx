import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Ban, CheckCheck, PencilLine, ShieldCheck, Undo2, XCircle } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { Button, cx, Field, Modal, Textarea } from '@/components/ui';
import type { Dispute } from './types';
import { ScoreInput, validateScore } from './answers';
import { AuditNotice, fmtScore } from './bits';

type Decision = 'UPHELD' | 'REJECTED';
type Action = 'NONE' | 'ADJUST_SCORE' | 'ACCEPT_ANSWER' | 'VOID_QUESTION';

function Choice({ checked, onSelect, icon, title, body, tone, name }: { checked: boolean; onSelect: () => void; icon: React.ReactNode; title: string; body: React.ReactNode; tone?: 'warn'; name: string }) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition', checked ? (tone === 'warn' ? 'border-warn bg-warn-soft' : 'border-accent bg-accent-soft') : 'border-line hover:border-line-strong')}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="mt-1 accent-[var(--accent)]" />
      <span className="mt-0.5 text-ink-2" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs text-ink-2">{body}</span>
      </span>
    </label>
  );
}

export function ResolveDisputeModal({ dispute, onClose }: { dispute: Dispute | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [decision, setDecision] = useState<Decision>('UPHELD');
  const [action, setAction] = useState<Action>('NONE');
  const [resolution, setResolution] = useState('');
  const [score, setScore] = useState('');
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);

  const q = dispute?.question ?? null;
  const choiceQ = !!q && q.type !== 'WRITTEN' && !!q.options?.length;
  const canRemedy = decision === 'UPHELD' && !!q;
  const effective: Action = canRemedy ? action : 'NONE';

  const resErr = resolution.trim().length < 10 ? 'Explain the decision in at least 10 characters — the candidate will read this' : null;
  const scoreErr = effective === 'ADJUST_SCORE' && q ? validateScore(score, q.marks) : null;
  const optErr = effective === 'ACCEPT_ANSWER' && !optionIds.length ? 'Select at least one option to accept' : null;

  const reset = () => {
    setDecision('UPHELD');
    setAction('NONE');
    setResolution('');
    setScore('');
    setOptionIds([]);
    setTouched(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const mut = useMutation({
    mutationFn: () =>
      api<{ scoreBefore: number | null; scoreAfter?: number | null; affectedCandidates: number }>(`/staff/disputes/${dispute!.id}/resolve`, {
        method: 'POST',
        body: { decision, resolution: resolution.trim(), action: effective, score: effective === 'ADJUST_SCORE' ? Number(score) : undefined, optionIds: effective === 'ACCEPT_ANSWER' ? optionIds : undefined },
      }),
    onSuccess: (r) => {
      const changed = r.scoreAfter != null && r.scoreAfter !== r.scoreBefore;
      toast.success(decision === 'UPHELD' ? 'Dispute upheld' : 'Dispute rejected', {
        description: `${dispute!.raisedBy.name}: ${fmtScore(r.scoreBefore)} → ${fmtScore(r.scoreAfter ?? r.scoreBefore)}${changed ? '' : ' (unchanged)'} · ${r.affectedCandidates} candidate score(s) changed. Recorded in the audit log.`,
        duration: 8000,
      });
      qc.invalidateQueries({ queryKey: ['disputes'] });
      qc.invalidateQueries({ queryKey: ['results'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
      qc.invalidateQueries({ queryKey: ['attempt'] });
      close();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const submit = () => {
    setTouched(true);
    if (resErr || scoreErr || optErr) return;
    mut.mutate();
  };

  return (
    <Modal
      open={!!dispute}
      onClose={close}
      size="lg"
      title="Resolve dispute"
      description={dispute ? `${dispute.raisedBy.name} · ${dispute.attempt.exam.title}${q ? ` · Question ${q.position}` : ''}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mut.isPending} variant={decision === 'REJECTED' ? 'outline' : 'primary'} icon={<ShieldCheck className="size-4" />}>
            {decision === 'UPHELD' ? 'Uphold & apply' : 'Reject dispute'}
          </Button>
        </>
      }
    >
      {dispute && (
        <div className="flex flex-col gap-5">
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-2 text-[13px] font-medium text-ink-2">Decision</legend>
            <Choice name="decision" checked={decision === 'UPHELD'} onSelect={() => setDecision('UPHELD')} icon={<CheckCheck className="size-4" />} title="Uphold" body="The candidate has a point. You can apply a remedy." />
            <Choice name="decision" checked={decision === 'REJECTED'} onSelect={() => setDecision('REJECTED')} icon={<XCircle className="size-4" />} title="Reject" body="The original marking stands. No scores change." />
          </fieldset>

          {canRemedy && q && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[13px] font-medium text-ink-2">Remedy</legend>
              <Choice name="remedy" checked={action === 'NONE'} onSelect={() => setAction('NONE')} icon={<Undo2 className="size-4" />} title="No score change" body="Acknowledge the issue (e.g. wording feedback) without changing marks." />
              <Choice name="remedy" checked={action === 'ADJUST_SCORE'} onSelect={() => setAction('ADJUST_SCORE')} icon={<PencilLine className="size-4" />} title="Adjust this candidate's score" body={`Currently ${fmtScore(q.score)}/${q.marks}. Only this candidate is affected.`} />
              {action === 'ADJUST_SCORE' && (
                <div className="ml-9">
                  <Field label="Corrected score" error={touched ? (scoreErr ?? undefined) : undefined}>
                    {(id) => <ScoreInput id={id} value={score} onChange={setScore} marks={q.marks} error={touched ? scoreErr : null} />}
                  </Field>
                </div>
              )}
              {choiceQ && (
                <Choice
                  name="remedy"
                  checked={action === 'ACCEPT_ANSWER'}
                  onSelect={() => setAction('ACCEPT_ANSWER')}
                  icon={<CheckCheck className="size-4" />}
                  tone="warn"
                  title="Accept another answer as correct"
                  body={<>Re-grades <strong>every candidate</strong> who received this question, not just this one.</>}
                />
              )}
              {action === 'ACCEPT_ANSWER' && choiceQ && (
                <fieldset className="ml-9 flex flex-col gap-1.5">
                  <legend className="mb-1 text-[13px] font-medium text-ink-2">Options to additionally accept</legend>
                  {q.options!.map((o, i) => {
                    const already = q.correct.includes(o.id);
                    return (
                      <label key={o.id} className={cx('flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm', already ? 'border-ok/40 bg-ok-soft text-ok' : 'cursor-pointer border-line hover:border-line-strong')}>
                        <input
                          type="checkbox"
                          disabled={already}
                          checked={already || optionIds.includes(o.id)}
                          onChange={(e) => setOptionIds((prev) => (e.target.checked ? [...prev, o.id] : prev.filter((x) => x !== o.id)))}
                          className="accent-[var(--accent)]"
                        />
                        <span className="w-4 text-muted">{String.fromCharCode(65 + i)}</span>
                        <span className="flex-1">{o.text}</span>
                        {already && <span className="text-[12px] font-medium">already correct</span>}
                      </label>
                    );
                  })}
                  {touched && optErr && (
                    <p role="alert" className="text-xs text-danger">
                      {optErr}
                    </p>
                  )}
                </fieldset>
              )}
              <Choice
                name="remedy"
                checked={action === 'VOID_QUESTION'}
                onSelect={() => setAction('VOID_QUESTION')}
                icon={<Ban className="size-4" />}
                tone="warn"
                title="Void the question"
                body={<>Awards <strong>full marks to every candidate</strong> who received it. Use when the question itself is broken.</>}
              />
              {(action === 'ACCEPT_ANSWER' || action === 'VOID_QUESTION') && (
                <p className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  This changes other candidates' scores. They will be notified and any published certificates are re-signed.
                </p>
              )}
            </fieldset>
          )}

          <Field label="Resolution (sent to the candidate)" required error={touched ? (resErr ?? undefined) : undefined} hint={<span className="tabular">{resolution.trim().length}/3000 · minimum 10</span>}>
            {(id) => <Textarea id={id} value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={3000} placeholder="Explain what you checked and why you decided this way." />}
          </Field>

          <AuditNotice>This decision, the remedy and every score change are written to the tamper-evident, hash-chained audit log — visible to the candidate and to auditors.</AuditNotice>
        </div>
      )}
    </Modal>
  );
}
