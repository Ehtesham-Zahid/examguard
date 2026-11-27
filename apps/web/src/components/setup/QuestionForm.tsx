import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { RichText } from '@/components/RichText';
import { Button, cx, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { TYPE_LABEL } from '@/components/status';
import { useTopics } from './editor/QuestionPicker';
import { fieldErrors, IconBtn, Segmented } from './shared';
import { DIFF_LABEL, DIFFICULTIES, type Difficulty, type MultiScheme, type QType, type QuestionItem } from './types';

const LETTERS = 'abcdefghij';
const NEW_TOPIC = '__new__';

interface Opt {
  id: string;
  text: string;
}
interface FormState {
  type: QType;
  topicId: string;
  topicName: string;
  difficulty: Difficulty;
  body: string;
  options: Opt[];
  correct: string[];
  marks: string;
  negativeMarks: string;
  multiScheme: MultiScheme;
  rubric: string;
  tags: string;
}

const blank = (): FormState => ({
  type: 'SINGLE',
  topicId: '',
  topicName: '',
  difficulty: 'MEDIUM',
  body: '',
  options: [
    { id: 'a', text: '' },
    { id: 'b', text: '' },
    { id: 'c', text: '' },
    { id: 'd', text: '' },
  ],
  correct: [],
  marks: '1',
  negativeMarks: '0',
  multiScheme: 'PARTIAL',
  rubric: '',
  tags: '',
});

const fromQuestion = (q: QuestionItem): FormState => ({
  type: q.type,
  topicId: q.topicId,
  topicName: '',
  difficulty: q.difficulty,
  body: q.current.body,
  options: q.current.options.length ? q.current.options.map((o) => ({ ...o })) : blank().options,
  correct: [...q.current.correct],
  marks: String(q.current.marks),
  negativeMarks: String(q.current.negativeMarks),
  multiScheme: q.current.multiScheme,
  rubric: q.current.rubric ?? '',
  tags: q.tags.join(', '),
});

export const SCHEME_INFO: Record<MultiScheme, { label: string; body: string }> = {
  ALL_OR_NOTHING: { label: 'All or nothing', body: 'Full marks only for exactly the right set of options. Anything else scores 0 (minus negative marks, if set).' },
  PARTIAL: { label: 'Partial credit', body: 'Each correct option earns its share of the marks — but choosing any wrong option scores 0 for the question.' },
  PARTIAL_NEGATIVE: { label: 'Partial, wrong cancels right', body: 'Each correct option earns its share; each wrong option takes one share away. Never goes below 0.' },
};

const nextId = (opts: Opt[]) => [...LETTERS].find((l) => !opts.some((o) => o.id === l)) ?? `x${opts.length}`;
const tagList = (s: string) => [...new Set(s.split(',').map((t) => t.trim()).filter(Boolean))];

function validate(f: FormState) {
  const e: Record<string, string> = {};
  if (!f.topicId) e.topicId = 'Topic is required';
  else if (f.topicId === NEW_TOPIC && !f.topicName.trim()) e.topicId = 'Name the new topic';
  else if (f.topicId === NEW_TOPIC && f.topicName.trim().length > 80) e.topicId = 'At most 80 characters';
  if (f.body.trim().length < 3) e.body = 'Question text is too short';
  else if (f.body.length > 10000) e.body = 'At most 10,000 characters';
  const marks = Number(f.marks);
  const neg = Number(f.negativeMarks || 0);
  if (!(marks > 0)) e.marks = 'Marks must be greater than 0';
  else if (marks > 100) e.marks = 'At most 100';
  if (Number.isNaN(neg) || neg < 0) e.negativeMarks = 'Must be 0 or more';
  else if (f.type !== 'WRITTEN' && marks > 0 && neg > marks) e.negativeMarks = 'Cannot exceed the question marks';
  if (f.type !== 'WRITTEN') {
    if (f.options.length < 2) e.options = 'Objective questions need at least 2 options';
    else if (f.options.some((o) => !o.text.trim())) e.options = 'Option text cannot be empty';
    else if (new Set(f.options.map((o) => o.text.trim().toLowerCase())).size !== f.options.length) e.options = 'Two options have identical text';
    const valid = f.correct.filter((c) => f.options.some((o) => o.id === c));
    if (f.type === 'SINGLE' && valid.length !== 1) e.correct = 'Mark exactly one option as correct';
    if (f.type === 'MULTI' && valid.length < 1) e.correct = 'Mark at least one option as correct';
  }
  const tags = tagList(f.tags);
  if (tags.length > 10) e.tags = 'At most 10 tags';
  else if (tags.some((t) => t.length > 30)) e.tags = 'Each tag at most 30 characters';
  if (f.rubric.length > 5000) e.rubric = 'At most 5,000 characters';
  return e;
}

export function QuestionFormModal({ open, onClose, question }: { open: boolean; onClose: () => void; question?: QuestionItem | null }) {
  const qc = useQueryClient();
  const topics = useTopics();
  const editing = !!question;
  const [f, setF] = useState<FormState>(blank);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [view, setView] = useState<'write' | 'preview'>('write');
  useEffect(() => {
    if (open) {
      setF(question ? fromQuestion(question) : blank());
      setErrs({});
      setView('write');
    }
  }, [open, question]);
  const set = (p: Partial<FormState>) => setF((x) => ({ ...x, ...p }));

  const m = useMutation({
    mutationFn: () => {
      const body = {
        ...(f.topicId === NEW_TOPIC ? { topicName: f.topicName.trim() } : { topicId: f.topicId }),
        type: f.type,
        difficulty: f.difficulty,
        body: f.body.trim(),
        options: f.type === 'WRITTEN' ? [] : f.options.map((o) => ({ id: o.id, text: o.text.trim() })),
        correct: f.type === 'WRITTEN' ? [] : f.correct.filter((c) => f.options.some((o) => o.id === c)),
        marks: Number(f.marks),
        negativeMarks: Number(f.negativeMarks || 0),
        multiScheme: f.multiScheme,
        rubric: f.type === 'WRITTEN' ? f.rubric.trim() || null : null,
        tags: tagList(f.tags),
      };
      return editing ? api<QuestionItem>(`/questions/${question!.id}`, { method: 'PUT', body }) : api<QuestionItem>('/questions', { method: 'POST', body });
    },
    onSuccess: (q) => {
      toast.success(editing ? `Saved as version ${q.currentVersion}` : 'Question added to your bank');
      qc.invalidateQueries({ queryKey: ['questions'] });
      qc.invalidateQueries({ queryKey: ['topics'] });
      qc.invalidateQueries({ queryKey: ['question', q.id] });
      onClose();
    },
    onError: (e) => {
      const fe = fieldErrors(e);
      setErrs(fe);
      toast.error(Object.keys(fe).length ? 'Please fix the highlighted fields' : errMsg(e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fe = validate(f);
    setErrs(fe);
    if (Object.keys(fe).length) return;
    m.mutate();
  };

  const toggleCorrect = (id: string) => {
    if (f.type === 'SINGLE') set({ correct: [id] });
    else set({ correct: f.correct.includes(id) ? f.correct.filter((c) => c !== id) : [...f.correct, id] });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? 'Edit question' : 'New question'}
      description={editing ? undefined : 'Objective questions are marked automatically; written answers go to the grading queue.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="question-form" loading={m.isPending}>
            {editing ? `Save as version ${question!.currentVersion + 1}` : 'Add question'}
          </Button>
        </>
      }
    >
      <form id="question-form" onSubmit={submit} noValidate className="space-y-5">
        {editing && (
          <div className="flex items-start gap-3 rounded-xl bg-info-soft px-4 py-3 text-sm">
            <GitBranch className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <div className="text-ink-2">
              <strong className="text-ink">Edits create version {question!.currentVersion + 1}.</strong> Papers already issued keep the exact version they were given, so live and finished attempts are never affected.
              {question!.usedInExams > 0 && ` Draft exams using it will pick up the new version.`}
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type" required hint={editing ? 'Type can’t change after creation.' : undefined}>
            {(id) => (
              <Select id={id} value={f.type} disabled={editing} onChange={(e) => set({ type: e.target.value as QType, correct: [] })}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Topic" required error={errs.topicId}>
            {(id) => (
              <Select id={id} value={f.topicId} onChange={(e) => set({ topicId: e.target.value })} aria-invalid={!!errs.topicId || undefined}>
                <option value="">Choose…</option>
                {topics.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                <option value={NEW_TOPIC}>+ New topic…</option>
              </Select>
            )}
          </Field>
          <Field label="Difficulty" required>
            {(id) => (
              <Select id={id} value={f.difficulty} onChange={(e) => set({ difficulty: e.target.value as Difficulty })}>
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {DIFF_LABEL[d]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {f.topicId === NEW_TOPIC && (
            <Field label="New topic name" required className="sm:col-span-3">
              {(id) => <Input id={id} value={f.topicName} onChange={(e) => set({ topicName: e.target.value })} maxLength={80} placeholder="e.g. Graph algorithms" autoFocus />}
            </Field>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-ink-2">
              Question <span className="text-danger" aria-hidden>*</span>
            </span>
            <Segmented
              label="Editor view"
              value={view}
              onChange={setView}
              options={[
                { id: 'write', label: 'Write' },
                { id: 'preview', label: 'Preview' },
              ]}
            />
          </div>
          {view === 'write' ? (
            <Textarea
              aria-label="Question text"
              value={f.body}
              onChange={(e) => set({ body: e.target.value })}
              className={cx('min-h-36', errs.body && 'border-danger')}
              aria-invalid={!!errs.body || undefined}
              placeholder={'What is the time complexity of binary search?\n\nUse ```code blocks``` or `inline code`.'}
            />
          ) : (
            <div className="exam-text min-h-36 rounded-lg border border-line bg-surface-2/40 px-4 py-3">{f.body.trim() ? <RichText text={f.body} /> : <span className="text-sm text-muted">Nothing to preview yet.</span>}</div>
          )}
          {errs.body ? (
            <p role="alert" className="mt-1.5 text-xs text-danger">
              {errs.body}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-muted">
              Supports <code>```code blocks```</code>, <code>`inline code`</code> and <code>**bold**</code>.
            </p>
          )}
        </div>

        {f.type !== 'WRITTEN' && (
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-ink-2">
              Options — {f.type === 'SINGLE' ? 'select the one correct answer' : 'tick every correct answer'} <span className="text-danger" aria-hidden>*</span>
            </legend>
            <ul className="space-y-2">
              {f.options.map((o, i) => {
                const correct = f.correct.includes(o.id);
                return (
                  <li key={o.id} className={cx('flex items-center gap-2 rounded-lg border px-2 py-1.5 transition', correct ? 'border-ok/50 bg-ok-soft/50' : 'border-line')}>
                    <label className="flex cursor-pointer items-center gap-2 pl-1" title="Mark as correct">
                      <input
                        type={f.type === 'SINGLE' ? 'radio' : 'checkbox'}
                        name="correct"
                        checked={correct}
                        onChange={() => toggleCorrect(o.id)}
                        className="size-4 accent-[var(--ok)]"
                        aria-label={`Option ${String.fromCharCode(65 + i)} is correct`}
                      />
                      <span className="w-4 text-center text-[13px] font-semibold text-muted">{String.fromCharCode(65 + i)}</span>
                    </label>
                    <Input
                      aria-label={`Option ${String.fromCharCode(65 + i)} text`}
                      value={o.text}
                      onChange={(e) => set({ options: f.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })}
                      className="h-9 border-transparent bg-transparent focus:bg-surface"
                      placeholder={`Option ${String.fromCharCode(65 + i)}`}
                      maxLength={2000}
                    />
                    <IconBtn label={`Remove option ${String.fromCharCode(65 + i)}`} danger disabled={f.options.length <= 2} onClick={() => set({ options: f.options.filter((x) => x.id !== o.id), correct: f.correct.filter((c) => c !== o.id) })}>
                      <Trash2 className="size-4" />
                    </IconBtn>
                  </li>
                );
              })}
            </ul>
            {(errs.options || errs.correct) && (
              <p role="alert" className="mt-1.5 text-xs text-danger">
                {errs.options ?? errs.correct}
              </p>
            )}
            <Button type="button" variant="ghost" size="sm" className="mt-2" icon={<Plus className="size-4" />} disabled={f.options.length >= 10} onClick={() => set({ options: [...f.options, { id: nextId(f.options), text: '' }] })}>
              Add option
            </Button>
          </fieldset>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Marks" required error={errs.marks}>
            {(id) => <Input id={id} type="number" min={0.5} step={0.5} max={100} value={f.marks} onChange={(e) => set({ marks: e.target.value })} invalid={!!errs.marks} className="tabular" />}
          </Field>
          {f.type !== 'WRITTEN' && (
            <Field label="Negative marks for a wrong answer" error={errs.negativeMarks} hint="0 = no penalty. Unanswered questions are never penalised.">
              {(id) => <Input id={id} type="number" min={0} step={0.25} value={f.negativeMarks} onChange={(e) => set({ negativeMarks: e.target.value })} invalid={!!errs.negativeMarks} className="tabular" />}
            </Field>
          )}
        </div>

        {f.type === 'MULTI' && (
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Marking scheme</legend>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
              {(Object.keys(SCHEME_INFO) as MultiScheme[]).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={f.multiScheme === k} onClick={() => set({ multiScheme: k })} className={cx('rounded-xl border p-3 text-left transition', f.multiScheme === k ? 'border-accent bg-accent-soft/60 ring-1 ring-accent' : 'border-line hover:border-line-strong')}>
                  <div className="text-sm font-semibold">{SCHEME_INFO[k].label}</div>
                  <div className="mt-1 text-[12px] leading-snug text-ink-2">{SCHEME_INFO[k].body}</div>
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {f.type === 'WRITTEN' && (
          <Field label="Marking rubric" error={errs.rubric} hint="Shown to graders beside each answer. Never shown to candidates.">
            {(id) => <Textarea id={id} value={f.rubric} onChange={(e) => set({ rubric: e.target.value })} placeholder={'2 marks — defines the term correctly\n2 marks — gives a relevant example'} />}
          </Field>
        )}

        <Field label="Tags" error={errs.tags} hint="Comma-separated, up to 10. Searchable in the bank.">
          {(id) => <Input id={id} value={f.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="recursion, midterm-2026" />}
        </Field>
      </form>
    </Modal>
  );
}
