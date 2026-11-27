import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileQuestion, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Badge, Button, cx, EmptyState, ErrorBox, Input, Modal, Select, Spinner } from '@/components/ui';
import { DIFFICULTY_TONE, TYPE_LABEL } from '@/components/status';
import { useDebounced } from '../shared';
import { DIFF_LABEL, DIFFICULTIES, type QuestionItem, type Topic } from '../types';

export const useTopics = () => useQuery({ queryKey: ['topics'], queryFn: () => api<Topic[]>('/questions/topics'), staleTime: 60_000 });

export function QuestionPicker({ open, onClose, exclude, onAdd }: { open: boolean; onClose: () => void; exclude: Set<string>; onAdd: (qs: QuestionItem[]) => void }) {
  const [search, setSearch] = useState('');
  const [topicId, setTopicId] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [type, setType] = useState('');
  const [sel, setSel] = useState<Map<string, QuestionItem>>(new Map());
  const s = useDebounced(search.trim());
  const topics = useTopics();

  useEffect(() => {
    if (open) setSel(new Map());
  }, [open]);

  const params = new URLSearchParams();
  if (s) params.set('search', s);
  if (topicId) params.set('topicId', topicId);
  if (difficulty) params.set('difficulty', difficulty);
  if (type) params.set('type', type);
  const q = useQuery({ queryKey: ['questions', 'picker', params.toString()], queryFn: () => api<QuestionItem[]>(`/questions?${params}`), enabled: open, placeholderData: keepPreviousData });

  const available = useMemo(() => (q.data ?? []).filter((x) => !exclude.has(x.id)), [q.data, exclude]);
  const allSelected = available.length > 0 && available.every((x) => sel.has(x.id));
  const selMarks = [...sel.values()].reduce((a, x) => a + x.current.marks, 0);

  const toggle = (x: QuestionItem) =>
    setSel((m) => {
      const n = new Map(m);
      if (n.has(x.id)) n.delete(x.id);
      else n.set(x.id, x);
      return n;
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add questions from your bank"
      description="Questions are added at their current version. Later edits create new versions and never change a paper already issued."
      size="xl"
      footer={
        <>
          <span className="mr-auto self-center text-[13px] text-muted tabular" aria-live="polite">
            {sel.size} selected · {selMarks} marks
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!sel.size}
            onClick={() => {
              onAdd([...sel.values()]);
              onClose();
            }}
          >
            Add {sel.size || ''} question{sel.size === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" aria-hidden />
          <Input type="search" aria-label="Search question text or tag" placeholder="Search text or tag" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Filter by topic" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
          <option value="">All topics</option>
          {topics.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Filter by difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
          <option value="">Any difficulty</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {DIFF_LABEL[d]}
            </option>
          ))}
        </Select>
        <Select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Any type</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>

      {q.isLoading ? (
        <Spinner label="Loading questions" />
      ) : q.isError ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState
          icon={<FileQuestion className="size-6" />}
          title="No matching questions"
          body={
            <>
              Adjust the filters, or{' '}
              <Link to="/examiner/questions" className="font-medium text-accent underline">
                write new questions
              </Link>{' '}
              in the bank.
            </>
          }
        />
      ) : (
        <div className="rounded-xl border border-line">
          <label className="flex items-center gap-3 border-b border-line bg-surface-2/60 px-4 py-2 text-[13px] font-medium text-ink-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={allSelected}
              disabled={!available.length}
              onChange={() =>
                setSel((m) => {
                  const n = new Map(m);
                  if (allSelected) available.forEach((x) => n.delete(x.id));
                  else available.forEach((x) => n.set(x.id, x));
                  return n;
                })
              }
            />
            Select all {available.length} shown
            {q.data.length - available.length > 0 && <span className="font-normal text-muted">({q.data.length - available.length} already on the paper)</span>}
          </label>
          <ul className={cx('max-h-[52vh] divide-y divide-line overflow-y-auto', q.isFetching && 'opacity-70')}>
            {q.data.map((x) => {
              const added = exclude.has(x.id);
              const checked = sel.has(x.id);
              return (
                <li key={x.id}>
                  <label className={cx('flex cursor-pointer items-start gap-3 px-4 py-3 transition', added ? 'cursor-default opacity-55' : checked ? 'bg-accent-soft/60' : 'hover:bg-surface-2/60')}>
                    <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--accent)]" checked={checked || added} disabled={added} onChange={() => toggle(x)} aria-label={`Select question: ${x.current.body.slice(0, 60)}`} />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm">{x.current.body.replace(/```[\s\S]*?```/g, '[code]')}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge>{x.topic.name}</Badge>
                        <Badge tone={DIFFICULTY_TONE[x.difficulty]}>{DIFF_LABEL[x.difficulty]}</Badge>
                        <span className="text-[12px] text-muted">{TYPE_LABEL[x.type]}</span>
                        {added && <Badge tone="accent">On paper</Badge>}
                      </div>
                    </div>
                    <span className="tabular shrink-0 text-sm font-semibold">{x.current.marks}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}
