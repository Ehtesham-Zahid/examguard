import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowUp, FileQuestion, ListOrdered, Plus, Scale, Shuffle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { Badge, Button, Card, CardHeader, cx, EmptyState, Input, Select, Table, Td, Th } from '@/components/ui';
import { DIFFICULTY_TONE, TYPE_LABEL } from '@/components/status';
import { RichText } from '@/components/RichText';
import { detailList, IconBtn, LockNotice } from '../shared';
import { DIFF_LABEL, DIFFICULTIES, type Difficulty, type ExamDetail, type QuestionItem, type QType, type Slot } from '../types';
import { invalidateExam } from './common';
import { QuestionPicker, useTopics } from './QuestionPicker';

interface Row {
  id: string;
  body: string;
  type: QType;
  difficulty: Difficulty;
  topic: string;
  marks: number;
  version: number;
}

export function QuestionsTab({ exam, onOpenFairness }: { exam: ExamDetail; onOpenFairness: () => void }) {
  const [mode, setMode] = useState<'FIXED' | 'BLUEPRINT'>(exam.mode);
  useEffect(() => setMode(exam.mode), [exam.mode]);
  const locked = exam.status !== 'DRAFT';

  return (
    <div className="space-y-5">
      {locked && (
        <LockNotice title="The paper is locked">
          {exam.status === 'PUBLISHED' && exam.phase === 'PUBLISHED' ? 'Unpublish the examination to change its questions.' : 'Questions can’t change once an examination has been published and candidates may have started.'}
        </LockNotice>
      )}

      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="How the paper is built">
        <ModeCard
          active={mode === 'FIXED'}
          disabled={locked}
          onClick={() => setMode('FIXED')}
          icon={<ListOrdered className="size-5" />}
          title="Fixed paper"
          body="Hand-pick questions. Every candidate gets the same set (order can still be shuffled)."
          current={exam.mode === 'FIXED'}
        />
        <ModeCard
          active={mode === 'BLUEPRINT'}
          disabled={locked}
          onClick={() => setMode('BLUEPRINT')}
          icon={<Shuffle className="size-5" />}
          title="Blueprint — fair random paper"
          body="Describe the mix (topic × difficulty × count). Each candidate draws a different paper of matched difficulty."
          current={exam.mode === 'BLUEPRINT'}
        />
      </div>
      {mode !== exam.mode && !locked && (
        <p className="flex items-center gap-2 text-[13px] text-warn" role="status">
          <AlertTriangle className="size-4" aria-hidden /> Saving below switches this exam to {mode === 'FIXED' ? 'a fixed paper' : 'blueprint mode'}.
        </p>
      )}

      {mode === 'FIXED' ? <FixedEditor exam={exam} locked={locked} /> : <BlueprintEditor exam={exam} locked={locked} onOpenFairness={onOpenFairness} />}
    </div>
  );
}

function ModeCard({ active, disabled, onClick, icon, title, body, current }: { active: boolean; disabled: boolean; onClick: () => void; icon: React.ReactNode; title: string; body: string; current: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cx('flex items-start gap-3 rounded-xl border p-4 text-left transition disabled:cursor-not-allowed', active ? 'border-accent bg-accent-soft/60 ring-1 ring-accent' : 'border-line bg-surface hover:border-line-strong', disabled && !active && 'opacity-50')}
    >
      <span className={cx('rounded-lg p-2', active ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-2')} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {title} {current && <Badge tone="accent">In use</Badge>}
        </span>
        <span className="mt-0.5 block text-[13px] text-ink-2">{body}</span>
      </span>
    </button>
  );
}

/* --------------------------------- Fixed --------------------------------- */

function FixedEditor({ exam, locked }: { exam: ExamDetail; locked: boolean }) {
  const qc = useQueryClient();
  const initial = useMemo<Row[]>(() => (exam.mode === 'FIXED' ? exam.questions.map((q) => ({ id: q.id, body: q.body, type: q.type, difficulty: q.difficulty, topic: q.topic, marks: q.marks, version: q.version })) : []), [exam]);
  const [rows, setRows] = useState<Row[]>(initial);
  const [picking, setPicking] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => setRows(initial), [initial]);

  const dirty = exam.mode !== 'FIXED' || rows.map((r) => r.id).join() !== initial.map((r) => r.id).join();
  const total = rows.reduce((a, r) => a + r.marks, 0);
  const mix = useMemo(() => {
    const d = { EASY: 0, MEDIUM: 0, HARD: 0 } as Record<Difficulty, number>;
    rows.forEach((r) => (d[r.difficulty] += r.marks));
    return d;
  }, [rows]);

  const save = useMutation({
    mutationFn: () => api<{ totalMarks: number }>(`/exams/${exam.id}/questions`, { method: 'PUT', body: { questionIds: rows.map((r) => r.id) } }),
    onSuccess: (r) => {
      toast.success(`Paper saved — ${rows.length} questions, ${r.totalMarks} marks`);
      invalidateExam(qc, exam.id);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const n = [...rs];
      [n[i], n[i + d]] = [n[i + d]!, n[i]!];
      return n;
    });

  const add = (qs: QuestionItem[]) => setRows((rs) => [...rs, ...qs.map((q) => ({ id: q.id, body: q.current.body, type: q.type, difficulty: q.difficulty, topic: q.topic.name, marks: q.current.marks, version: q.currentVersion }))]);

  return (
    <Card>
      <CardHeader
        title={`${rows.length} question${rows.length === 1 ? '' : 's'} · ${total} marks`}
        subtitle={rows.length ? <MixBar mix={mix} total={total} /> : 'Build the paper from your question bank.'}
        actions={
          !locked && (
            <>
              <Button variant="outline" icon={<Plus className="size-4" />} onClick={() => setPicking(true)}>
                Add from bank
              </Button>
              <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
                Save paper
              </Button>
            </>
          )
        }
      />
      {!rows.length ? (
        <EmptyState
          icon={<FileQuestion className="size-6" />}
          title="No questions yet"
          body="Pick questions from your bank. You can reorder them before saving."
          action={
            !locked && (
              <Button icon={<Plus className="size-4" />} onClick={() => setPicking(true)}>
                Add from bank
              </Button>
            )
          }
        />
      ) : (
        <ol className="divide-y divide-line">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-start gap-3 px-5 py-3">
              <span className="tabular mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold text-ink-2">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <button type="button" className="block w-full text-left" aria-expanded={expanded === r.id} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                  {expanded === r.id ? <RichText text={r.body} className="text-sm" /> : <p className="line-clamp-2 text-sm">{r.body.replace(/```[\s\S]*?```/g, '[code]')}</p>}
                </button>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge>{r.topic}</Badge>
                  <Badge tone={DIFFICULTY_TONE[r.difficulty]}>{DIFF_LABEL[r.difficulty]}</Badge>
                  <span className="text-[12px] text-muted">
                    {TYPE_LABEL[r.type]} · v{r.version}
                  </span>
                </div>
              </div>
              <span className="tabular mt-0.5 shrink-0 text-sm font-semibold">{r.marks}</span>
              {!locked && (
                <div className="flex shrink-0 items-center">
                  <IconBtn label={`Move question ${i + 1} up`} onClick={() => move(i, -1)} disabled={i === 0}>
                    <ArrowUp className="size-4" />
                  </IconBtn>
                  <IconBtn label={`Move question ${i + 1} down`} onClick={() => move(i, 1)} disabled={i === rows.length - 1}>
                    <ArrowDown className="size-4" />
                  </IconBtn>
                  <IconBtn label={`Remove question ${i + 1}`} danger onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>
                    <Trash2 className="size-4" />
                  </IconBtn>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {dirty && !locked && rows.length > 0 && (
        <div className="border-t border-line bg-warn-soft/50 px-5 py-2.5 text-[13px] text-warn" role="status">
          Unsaved changes to the paper.
        </div>
      )}
      <QuestionPicker open={picking} onClose={() => setPicking(false)} exclude={new Set(rows.map((r) => r.id))} onAdd={add} />
    </Card>
  );
}

function MixBar({ mix, total }: { mix: Record<Difficulty, number>; total: number }) {
  const color = { EASY: 'bg-ok', MEDIUM: 'bg-warn', HARD: 'bg-danger' };
  return (
    <span className="mt-1 flex flex-col gap-1.5">
      <span className="flex h-1.5 w-56 max-w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
        {DIFFICULTIES.map((d) => (
          <span key={d} className={color[d]} style={{ width: `${total ? (mix[d] / total) * 100 : 0}%` }} />
        ))}
      </span>
      <span className="tabular text-[12px]">
        {DIFFICULTIES.map((d) => `${DIFF_LABEL[d]} ${total ? Math.round((mix[d] / total) * 100) : 0}%`).join(' · ')} of marks
      </span>
    </span>
  );
}

/* ------------------------------- Blueprint ------------------------------- */

interface SlotRow {
  key: number;
  topicId: string;
  difficulty: Difficulty;
  count: string;
  marks: string;
}
let keySeq = 1;
const toRow = (s: Partial<Slot>): SlotRow => ({ key: keySeq++, topicId: s.topicId ?? '', difficulty: s.difficulty ?? 'MEDIUM', count: String(s.count ?? 5), marks: String(s.marks ?? 1) });

function BlueprintEditor({ exam, locked, onOpenFairness }: { exam: ExamDetail; locked: boolean; onOpenFairness: () => void }) {
  const qc = useQueryClient();
  const topics = useTopics();
  const bank = useQuery({ queryKey: ['questions', 'all-active'], queryFn: () => api<QuestionItem[]>('/questions') });
  const initial = useMemo(() => (exam.mode === 'BLUEPRINT' && exam.blueprint?.length ? exam.blueprint.map(toRow) : [toRow({})]), [exam]);
  const [rows, setRows] = useState<SlotRow[]>(initial);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  useEffect(() => {
    setRows(initial);
    setServerErrors([]);
  }, [initial]);

  const avail = useMemo(() => {
    const m = new Map<string, number>();
    bank.data?.forEach((q) => m.set(`${q.topicId}:${q.difficulty}`, (m.get(`${q.topicId}:${q.difficulty}`) ?? 0) + 1));
    return m;
  }, [bank.data]);

  const rowErr = (r: SlotRow, i: number) => {
    if (!r.topicId) return 'Choose a topic';
    const c = Number(r.count);
    if (!Number.isInteger(c) || c < 1 || c > 100) return 'Count must be 1–100';
    const mk = Number(r.marks);
    if (!(mk > 0) || mk > 100) return 'Marks must be between 0 and 100';
    if (rows.findIndex((x) => x.topicId === r.topicId && x.difficulty === r.difficulty) !== i) return 'Duplicate of an earlier row — merge them';
    const a = avail.get(`${r.topicId}:${r.difficulty}`) ?? 0;
    if (bank.data && c > a) return `Only ${a} available in the bank`;
    return null;
  };
  const errors = rows.map(rowErr);
  const hasErrors = errors.some(Boolean);
  const totalQ = rows.reduce((a, r) => a + (Number(r.count) || 0), 0);
  const totalMarks = rows.reduce((a, r) => a + (Number(r.count) || 0) * (Number(r.marks) || 0), 0);
  const dirty = exam.mode !== 'BLUEPRINT' || JSON.stringify(rows.map(({ key, ...r }) => r)) !== JSON.stringify(initial.map(({ key, ...r }) => r));

  const save = useMutation({
    mutationFn: () => api<{ totalMarks: number }>(`/exams/${exam.id}/blueprint`, { method: 'PUT', body: { slots: rows.map((r) => ({ topicId: r.topicId, difficulty: r.difficulty, count: Number(r.count), marks: Number(r.marks) })) } }),
    onSuccess: (r) => {
      setServerErrors([]);
      toast.success(`Blueprint saved — ${totalQ} questions per paper, ${r.totalMarks} marks`);
      invalidateExam(qc, exam.id);
    },
    onError: (e) => {
      const list = detailList(e);
      setServerErrors(list.length ? list : [errMsg(e)]);
      toast.error('The blueprint could not be saved');
    },
  });

  const update = (key: number, p: Partial<SlotRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const topicName = (id: string) => topics.data?.find((t) => t.id === id)?.name ?? '—';

  return (
    <Card>
      <CardHeader
        title="Paper blueprint"
        subtitle={
          <span className="tabular">
            Every candidate gets <strong className="text-ink">{totalQ}</strong> questions worth <strong className="text-ink">{totalMarks}</strong> marks, drawn so that papers are equally hard.
          </span>
        }
        actions={
          <>
            {exam.mode === 'BLUEPRINT' && (
              <Button variant="outline" icon={<Scale className="size-4" />} onClick={onOpenFairness}>
                Fairness report
              </Button>
            )}
            {!locked && (
              <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || hasErrors}>
                Save blueprint
              </Button>
            )}
          </>
        }
      />
      {serverErrors.length > 0 && (
        <div role="alert" className="mx-5 mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <div className="font-medium">The server rejected this blueprint:</div>
          <ul className="mt-1 list-disc pl-5">
            {serverErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <Table className="mt-1">
        <thead>
          <tr>
            <Th>Topic</Th>
            <Th>Difficulty</Th>
            <Th className="w-28">Questions</Th>
            <Th className="w-28">Marks each</Th>
            <Th>Bank coverage</Th>
            <Th className="w-12">
              <span className="sr-only">Remove</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const a = avail.get(`${r.topicId}:${r.difficulty}`) ?? 0;
            const c = Number(r.count) || 0;
            const err = errors[i];
            return (
              <tr key={r.key} className={cx(err && r.topicId && 'bg-danger-soft/30')}>
                <Td>
                  {locked ? (
                    topicName(r.topicId)
                  ) : (
                    <Select aria-label={`Row ${i + 1} topic`} value={r.topicId} onChange={(e) => update(r.key, { topicId: e.target.value })}>
                      <option value="">Choose topic…</option>
                      {topics.data?.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Td>
                <Td>
                  {locked ? (
                    <Badge tone={DIFFICULTY_TONE[r.difficulty]}>{DIFF_LABEL[r.difficulty]}</Badge>
                  ) : (
                    <Select aria-label={`Row ${i + 1} difficulty`} value={r.difficulty} onChange={(e) => update(r.key, { difficulty: e.target.value as Difficulty })}>
                      {DIFFICULTIES.map((d) => (
                        <option key={d} value={d}>
                          {DIFF_LABEL[d]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Td>
                <Td>{locked ? <span className="tabular">{r.count}</span> : <Input aria-label={`Row ${i + 1} question count`} type="number" min={1} max={100} value={r.count} onChange={(e) => update(r.key, { count: e.target.value })} className="tabular" invalid={!!err && /Count|available/.test(err)} />}</Td>
                <Td>{locked ? <span className="tabular">{r.marks}</span> : <Input aria-label={`Row ${i + 1} marks per question`} type="number" min={0.5} step={0.5} max={100} value={r.marks} onChange={(e) => update(r.key, { marks: e.target.value })} className="tabular" invalid={!!err && /Marks/.test(err)} />}</Td>
                <Td>
                  {r.topicId && bank.data ? (
                    <div className="min-w-40">
                      <div className="flex justify-between text-[12px]">
                        <span className={cx('tabular', c > a ? 'font-medium text-danger' : 'text-ink-2')}>
                          {c} of {a} available
                        </span>
                        {a > 0 && c <= a && <span className="text-muted">{a >= c * 3 ? 'great variety' : a >= c * 1.5 ? 'some variety' : 'little variety'}</span>}
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                        <div className={cx('h-full rounded-full', c > a ? 'bg-danger' : a >= c * 1.5 ? 'bg-ok' : 'bg-warn')} style={{ width: `${a ? Math.min(100, (c / a) * 100) : 100}%` }} />
                      </div>
                      {err && <p className="mt-1 text-[12px] text-danger">{err}</p>}
                    </div>
                  ) : (
                    <span className="text-[12px] text-muted">{err ?? '…'}</span>
                  )}
                </Td>
                <Td>
                  {!locked && (
                    <IconBtn label={`Remove row ${i + 1}`} danger disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                      <Trash2 className="size-4" />
                    </IconBtn>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {!locked && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <Button variant="ghost" icon={<Plus className="size-4" />} onClick={() => setRows((rs) => [...rs, toRow({ topicId: '', difficulty: 'MEDIUM' })])} disabled={rows.length >= 30}>
            Add row
          </Button>
          <p className="text-[12px] text-muted">Tip: keep the bank at least 1.5× larger than each row’s count so papers genuinely differ.</p>
        </div>
      )}
    </Card>
  );
}
