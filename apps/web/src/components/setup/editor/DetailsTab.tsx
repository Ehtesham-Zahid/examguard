import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, LifeBuoy, ShieldCheck, Shuffle } from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { toLocalInput } from '@/lib/format';
import { Button, Card, CardHeader, Field, Input, Toggle } from '@/components/ui';
import { examBody, ExamFields, serverExamErrors, validateExam, type ExamFormValues } from '../ExamForm';
import { LockNotice } from '../shared';
import type { ExamDetail, ExamSettings } from '../types';
import { invalidateExam } from './common';

const toValues = (e: ExamDetail): ExamFormValues => ({
  title: e.title,
  description: e.description,
  instructions: e.instructions,
  windowStart: toLocalInput(e.windowStart),
  windowEnd: toLocalInput(e.windowEnd),
  durationMin: String(e.durationMin),
  passMarks: String(e.passMarks),
  accessCode: e.accessCode ?? '',
});

export function DetailsTab({ exam }: { exam: ExamDetail }) {
  const qc = useQueryClient();
  const initial = useMemo(() => ({ v: toValues(exam), s: exam.settings }), [exam]);
  const [v, setV] = useState(initial.v);
  const [s, setS] = useState<ExamSettings>(initial.s);
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => {
    setV(initial.v);
    setS(initial.s);
    setErrs({});
  }, [initial]);

  const readOnly = exam.phase === 'COMPLETED' || exam.phase === 'ARCHIVED';
  const ongoing = exam.phase === 'ONGOING';
  const dirty = JSON.stringify(v) !== JSON.stringify(initial.v) || JSON.stringify(s) !== JSON.stringify(initial.s);
  const lockMsg = ongoing ? 'Locked while candidates are writing' : undefined;

  const m = useMutation({
    mutationFn: () => {
      const body = examBody(v);
      // datetime-local drops seconds — keep the exact stored instant for untouched fields so the
      // server's "start can't move / end can only extend" rules don't trip on rounding.
      if (v.windowStart === initial.v.windowStart) body.windowStart = exam.windowStart;
      if (v.windowEnd === initial.v.windowEnd) body.windowEnd = exam.windowEnd;
      return api(`/exams/${exam.id}`, { method: 'PUT', body: { ...body, settings: s } });
    },
    onSuccess: () => {
      toast.success('Changes saved');
      invalidateExam(qc, exam.id);
    },
    onError: (e) => {
      const fe = serverExamErrors(e);
      setErrs(fe);
      toast.error(Object.keys(fe).length ? 'Please fix the highlighted fields' : errMsg(e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fe = validateExam(v, { totalMarks: exam.totalMarks });
    if (ongoing && v.windowEnd !== initial.v.windowEnd && new Date(v.windowEnd) < new Date(exam.windowEnd)) fe.windowEnd = 'While live, the window can only be extended, not shortened';
    if (!Number.isInteger(s.maxViolations) || s.maxViolations < 0 || s.maxViolations > 50) fe.maxViolations = 'Between 0 and 50';
    if (!Number.isInteger(s.lateJoinMin) || s.lateJoinMin < 0 || s.lateJoinMin > 1440) fe.lateJoinMin = 'Between 0 and 1440 minutes';
    if (!Number.isInteger(s.gracePeriodSec) || s.gracePeriodSec < 0 || s.gracePeriodSec > 120) fe.gracePeriodSec = 'Between 0 and 120 seconds';
    setErrs(fe);
    if (Object.keys(fe).length) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    m.mutate();
  };

  const set = <K extends keyof ExamSettings>(k: K, val: ExamSettings[K]) => setS((x) => ({ ...x, [k]: val }));
  const settingsLocked = readOnly || ongoing;

  return (
    <form onSubmit={submit} noValidate className="space-y-5 pb-20">
      {readOnly && <LockNotice title="This examination has finished">Details are kept as a record and can no longer be edited. Duplicate it to reuse the setup.</LockNotice>}
      {ongoing && <LockNotice title="Live examination — limited editing">You can fix wording and extend the closing time. Start time, duration, pass mark and rules are frozen so every candidate sits the same exam.</LockNotice>}

      <Card>
        <CardHeader title="Basics" subtitle="What candidates see and when they can sit it." />
        <fieldset disabled={readOnly} className="p-5">
          <ExamFields v={v} set={(p) => setV((x) => ({ ...x, ...p }))} errs={errs} locked={{ windowStart: lockMsg, durationMin: lockMsg, passMarks: lockMsg }} />
        </fieldset>
      </Card>

      <fieldset disabled={settingsLocked} className="grid items-start gap-5 lg:grid-cols-2">
        <SettingsGroup icon={<ShieldCheck className="size-4" />} title="Integrity" subtitle="How strictly the attempt is proctored.">
          <Toggle disabled={settingsLocked} checked={s.requireFullscreen} onChange={(x) => set('requireFullscreen', x)} label="Require full screen" description="Leaving full screen is logged as a violation and the candidate is asked to return." />
          <Toggle disabled={settingsLocked} checked={s.allowBackNav} onChange={(x) => set('allowBackNav', x)} label="Allow going back" description="Off = each question is final once the candidate moves on." />
          <NumberRow
            label="Auto-submit after violations"
            hint={s.maxViolations === 0 ? 'Never auto-submit — violations are only logged for review.' : `The attempt is submitted automatically on violation #${s.maxViolations}.`}
            value={s.maxViolations}
            onChange={(n) => set('maxViolations', n)}
            min={0}
            max={50}
            suffix="violations"
            error={errs.maxViolations}
            disabled={settingsLocked}
          />
          <NumberRow
            label="Late entry cut-off"
            hint={s.lateJoinMin === 0 ? 'Candidates may start at any point while the window is open.' : `Candidates can’t start more than ${s.lateJoinMin} min after the window opens.`}
            value={s.lateJoinMin}
            onChange={(n) => set('lateJoinMin', n)}
            min={0}
            max={1440}
            suffix="minutes"
            error={errs.lateJoinMin}
            disabled={settingsLocked}
          />
        </SettingsGroup>

        <SettingsGroup icon={<Shuffle className="size-4" />} title="Randomisation" subtitle="Makes copying from a neighbour pointless.">
          <Toggle disabled={settingsLocked} checked={s.shuffleQuestions} onChange={(x) => set('shuffleQuestions', x)} label="Shuffle question order" description="Each candidate gets the same questions in a different order." />
          <Toggle disabled={settingsLocked} checked={s.shuffleOptions} onChange={(x) => set('shuffleOptions', x)} label="Shuffle answer options" description="Option A for one candidate may be option C for another. Grading is unaffected." />
        </SettingsGroup>

        <SettingsGroup icon={<Eye className="size-4" />} title="Results" subtitle="What candidates learn after you publish results.">
          <Toggle disabled={settingsLocked} checked={s.showCorrectAnswers} onChange={(x) => set('showCorrectAnswers', x)} label="Show correct answers" description="Candidates see the answer key next to their responses once results are published. Leave off if you’ll reuse the questions." />
        </SettingsGroup>

        <SettingsGroup icon={<LifeBuoy className="size-4" />} title="Resilience" subtitle="Protects candidates from network and device failures.">
          <NumberRow
            label="Submission grace period"
            hint="Answers already in flight when time runs out are still accepted for this long."
            value={s.gracePeriodSec}
            onChange={(n) => set('gracePeriodSec', n)}
            min={0}
            max={120}
            suffix="seconds"
            error={errs.gracePeriodSec}
            disabled={settingsLocked}
          />
          <Toggle disabled={settingsLocked} checked={s.autoCompensate} onChange={(x) => set('autoCompensate', x)} label="Auto-compensate lost time" description="Time lost to verified disconnections is added back automatically instead of waiting for your approval." />
        </SettingsGroup>
      </fieldset>

      {!readOnly && (
        <div className="sticky bottom-3 z-20">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
            <span className="text-sm text-ink-2" aria-live="polite">
              {dirty ? <><span className="mr-2 inline-block size-2 rounded-full bg-warn align-middle" aria-hidden />Unsaved changes</> : 'All changes saved'}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={!dirty || m.isPending}
                onClick={() => {
                  setV(initial.v);
                  setS(initial.s);
                  setErrs({});
                }}
              >
                Discard
              </Button>
              <Button type="submit" loading={m.isPending} disabled={!dirty}>
                Save changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}

function SettingsGroup({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle: string; children: ReactNode }) {
  return (
    <Card>
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="rounded-lg bg-accent-soft p-2 text-accent" aria-hidden>
          {icon}
        </span>
        <div>
          <h3 className="text-[15px] font-semibold">{title}</h3>
          <p className="text-[13px] text-muted">{subtitle}</p>
        </div>
      </div>
      <div className="divide-y divide-line px-5 py-2">{children}</div>
    </Card>
  );
}

function NumberRow({ label, hint, value, onChange, min, max, suffix, error, disabled }: { label: string; hint: string; value: number; onChange: (n: number) => void; min: number; max: number; suffix: string; error?: string; disabled?: boolean }) {
  return (
    <div className="py-2">
      <Field label={label} error={error} hint={hint}>
        {(id) => (
          <div className="flex items-center gap-2 [&>input]:w-28">
            <Input id={id} type="number" inputMode="numeric" min={min} max={max} value={Number.isNaN(value) ? '' : value} onChange={(e) => onChange(e.target.value === '' ? NaN : Math.trunc(Number(e.target.value)))} invalid={!!error} disabled={disabled} className="tabular" />
            <span className="text-[13px] text-muted">{suffix}</span>
          </div>
        )}
      </Field>
    </div>
  );
}
