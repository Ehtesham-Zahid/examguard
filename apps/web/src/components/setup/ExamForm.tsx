import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { toLocalInput } from '@/lib/format';
import { Button, Field, Input, Modal, Textarea } from '@/components/ui';
import { fieldErrors } from './shared';
import type { ExamBase } from './types';

export interface ExamFormValues {
  title: string;
  description: string;
  instructions: string;
  windowStart: string;
  windowEnd: string;
  durationMin: string;
  passMarks: string;
  accessCode: string;
}

export function defaultExamValues(): ExamFormValues {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 3 * 3600_000);
  return { title: '', description: '', instructions: '', windowStart: toLocalInput(start), windowEnd: toLocalInput(end), durationMin: '60', passMarks: '0', accessCode: '' };
}

export function validateExam(v: ExamFormValues, opts: { totalMarks?: number } = {}) {
  const e: Record<string, string> = {};
  if (v.title.trim().length < 3) e.title = 'Title must be at least 3 characters';
  else if (v.title.trim().length > 150) e.title = 'At most 150 characters';
  if (v.description.length > 2000) e.description = 'At most 2,000 characters';
  if (v.instructions.length > 10000) e.instructions = 'At most 10,000 characters';
  const s = new Date(v.windowStart).getTime();
  const en = new Date(v.windowEnd).getTime();
  if (!v.windowStart || Number.isNaN(s)) e.windowStart = 'Choose a start date and time';
  if (!v.windowEnd || Number.isNaN(en)) e.windowEnd = 'Choose an end date and time';
  else if (!e.windowStart && en <= s) e.windowEnd = 'End must be after start';
  const d = Number(v.durationMin);
  if (!Number.isInteger(d) || d < 1) e.durationMin = 'Duration must be at least 1 minute';
  else if (d > 600) e.durationMin = 'At most 600 minutes';
  else if (!e.windowStart && !e.windowEnd && (en - s) / 60000 < d) e.durationMin = 'Duration is longer than the availability window';
  const p = Number(v.passMarks);
  if (v.passMarks === '' || Number.isNaN(p) || p < 0) e.passMarks = 'Pass mark must be 0 or more';
  else if (opts.totalMarks && opts.totalMarks > 0 && p > opts.totalMarks) e.passMarks = `Cannot exceed the total of ${opts.totalMarks} marks`;
  if (v.accessCode.trim().length > 30) e.accessCode = 'At most 30 characters';
  return e;
}

export const examBody = (v: ExamFormValues) => ({
  title: v.title.trim(),
  description: v.description,
  instructions: v.instructions,
  windowStart: new Date(v.windowStart).toISOString(),
  windowEnd: new Date(v.windowEnd).toISOString(),
  durationMin: Number(v.durationMin),
  passMarks: Number(v.passMarks),
  accessCode: v.accessCode.trim() || null,
});

const windowHint = (v: ExamFormValues) => {
  const s = new Date(v.windowStart).getTime();
  const e = new Date(v.windowEnd).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return undefined;
  const mins = Math.round((e - s) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `Window is ${h ? `${h} h ` : ''}${m ? `${m} min` : ''}`.trim() + '. Candidates can start any time inside it.';
};

/** Fields shared by the create modal and the Details tab. `locked` disables fields the server will refuse to change. */
export function ExamFields({ v, set, errs, locked = {}, compact }: { v: ExamFormValues; set: (p: Partial<ExamFormValues>) => void; errs: Record<string, string>; locked?: Partial<Record<keyof ExamFormValues, string>>; compact?: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Title" required error={errs.title} className="sm:col-span-2">
        {(id) => <Input id={id} value={v.title} onChange={(e) => set({ title: e.target.value })} invalid={!!errs.title} placeholder="e.g. Data Structures — Midterm" maxLength={150} />}
      </Field>
      <Field label="Description" error={errs.description} hint="Shown to candidates in their exam list." className="sm:col-span-2">
        {(id) => <Textarea id={id} value={v.description} onChange={(e) => set({ description: e.target.value })} className="min-h-16" />}
      </Field>
      {!compact && (
        <Field label="Instructions" error={errs.instructions} hint="Shown on the lobby screen before the candidate starts. Supports `inline code` and **bold**." className="sm:col-span-2">
          {(id) => <Textarea id={id} value={v.instructions} onChange={(e) => set({ instructions: e.target.value })} className="min-h-28" />}
        </Field>
      )}
      <Field label="Opens" required error={errs.windowStart} hint={locked.windowStart}>
        {(id) => <Input id={id} type="datetime-local" value={v.windowStart} onChange={(e) => set({ windowStart: e.target.value })} invalid={!!errs.windowStart} disabled={!!locked.windowStart} />}
      </Field>
      <Field label="Closes" required error={errs.windowEnd} hint={locked.windowEnd ?? windowHint(v)}>
        {(id) => <Input id={id} type="datetime-local" value={v.windowEnd} onChange={(e) => set({ windowEnd: e.target.value })} invalid={!!errs.windowEnd} disabled={!!locked.windowEnd} />}
      </Field>
      <Field label="Duration (minutes)" required error={errs.durationMin} hint={locked.durationMin ?? 'Per candidate, from when they press Start.'}>
        {(id) => <Input id={id} type="number" inputMode="numeric" min={1} max={600} value={v.durationMin} onChange={(e) => set({ durationMin: e.target.value })} invalid={!!errs.durationMin} disabled={!!locked.durationMin} className="tabular" />}
      </Field>
      <Field label="Pass mark" error={errs.passMarks} hint={locked.passMarks ?? 'Absolute marks, not a percentage.'}>
        {(id) => <Input id={id} type="number" inputMode="decimal" min={0} step="0.5" value={v.passMarks} onChange={(e) => set({ passMarks: e.target.value })} invalid={!!errs.passMarks} disabled={!!locked.passMarks} className="tabular" />}
      </Field>
      <Field label="Access code" error={errs.accessCode} hint="Optional. Candidates must type it to start — share it in the room." className="sm:col-span-2">
        {(id) => <Input id={id} value={v.accessCode} onChange={(e) => set({ accessCode: e.target.value })} maxLength={30} placeholder="Leave blank for none" autoComplete="off" className="font-mono" />}
      </Field>
    </div>
  );
}

/** Map server zod paths (windowEnd, durationMin…) to our field errors. */
export const serverExamErrors = (e: unknown) => fieldErrors(e);

export function NewExamModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [v, setV] = useState<ExamFormValues>(defaultExamValues);
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setV(defaultExamValues());
      setErrs({});
    }
  }, [open]);
  const m = useMutation({
    mutationFn: () => api<ExamBase>('/exams', { method: 'POST', body: examBody(v) }),
    onSuccess: (exam) => {
      toast.success('Draft created — now add questions and candidates');
      qc.invalidateQueries({ queryKey: ['exams'] });
      onClose();
      nav(`/examiner/exams/${exam.id}`);
    },
    onError: (e) => {
      const fe = serverExamErrors(e);
      setErrs(fe);
      if (!Object.keys(fe).length) toast.error(errMsg(e));
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fe = validateExam(v);
    setErrs(fe);
    if (!Object.keys(fe).length) m.mutate();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New examination"
      description="Start with the basics. You can add instructions, questions, rules and candidates next."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-exam" loading={m.isPending}>
            Create draft
          </Button>
        </>
      }
    >
      <form id="new-exam" onSubmit={submit} noValidate>
        <ExamFields v={v} set={(p) => setV((x) => ({ ...x, ...p }))} errs={errs} />
      </form>
    </Modal>
  );
}
