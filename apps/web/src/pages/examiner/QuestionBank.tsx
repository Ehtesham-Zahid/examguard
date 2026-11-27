import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Copy, FileQuestion, History, Pencil, Plus, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { relative } from '@/lib/format';
import { Badge, Button, Card, ConfirmDialog, cx, EmptyState, ErrorBox, Input, PageHeader, Select, Spinner } from '@/components/ui';
import { DIFFICULTY_TONE, TYPE_LABEL } from '@/components/status';
import { useTopics } from '@/components/setup/editor/QuestionPicker';
import { QuestionFormModal } from '@/components/setup/QuestionForm';
import { QuestionImport, VersionsModal } from '@/components/setup/QuestionExtras';
import { IconBtn, Segmented, useDebounced } from '@/components/setup/shared';
import { DIFF_LABEL, DIFFICULTIES, type QuestionItem } from '@/components/setup/types';

export default function QuestionBank() {
  const qc = useQueryClient();
  const topics = useTopics();
  const [search, setSearch] = useState('');
  const [topicId, setTopicId] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [type, setType] = useState('');
  const [archived, setArchived] = useState<'false' | 'true'>('false');
  const s = useDebounced(search.trim());
  const [editing, setEditing] = useState<QuestionItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [history, setHistory] = useState<QuestionItem | null>(null);
  const [archiving, setArchiving] = useState<QuestionItem | null>(null);

  const params = new URLSearchParams({ archived });
  if (s) params.set('search', s);
  if (topicId) params.set('topicId', topicId);
  if (difficulty) params.set('difficulty', difficulty);
  if (type) params.set('type', type);
  const q = useQuery({ queryKey: ['questions', 'bank', params.toString()], queryFn: () => api<QuestionItem[]>(`/questions?${params}`), placeholderData: keepPreviousData });

  const archive = useMutation({
    mutationFn: (x: QuestionItem) => api(`/questions/${x.id}/archive`, { method: 'POST', body: { archived: !x.archived } }),
    onSuccess: (_r, x) => {
      toast.success(x.archived ? 'Question restored' : 'Question archived');
      setArchiving(null);
      qc.invalidateQueries({ queryKey: ['questions'] });
      qc.invalidateQueries({ queryKey: ['topics'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const duplicate = useMutation({
    mutationFn: (x: QuestionItem) => api<QuestionItem>(`/questions/${x.id}/duplicate`, { method: 'POST' }),
    onSuccess: (c) => {
      toast.success('Copy created — opening it for editing');
      qc.invalidateQueries({ queryKey: ['questions'] });
      setEditing(c);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const filtered = !!(s || topicId || difficulty || type);
  const totalActive = topics.data?.reduce((a, t) => a + t.questionCount, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Content"
        title="Question bank"
        subtitle="Versioned, reusable questions. Editing never changes a paper a candidate has already received."
        actions={
          <>
            <Button variant="outline" icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>
              Import
            </Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New question
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[230px_1fr]">
        {/* Topic rail */}
        <nav aria-label="Topics" className="hidden lg:block">
          <div className="sticky top-4 space-y-0.5">
            <div className="mb-2 px-3 text-[12px] font-semibold uppercase tracking-wide text-muted">Topics</div>
            <TopicBtn active={!topicId} onClick={() => setTopicId('')} label="All topics" count={totalActive} />
            {topics.data?.map((t) => (
              <TopicBtn key={t.id} active={topicId === t.id} onClick={() => setTopicId(t.id)} label={t.name} count={t.questionCount} />
            ))}
          </div>
        </nav>

        <div className="min-w-0 space-y-4">
          <Card className="p-3">
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-[1fr_auto_auto_auto]">
              <div className="relative col-span-2 xl:col-span-1">
                <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" aria-hidden />
                <Input type="search" aria-label="Search question text or exact tag" placeholder="Search text or tag" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select aria-label="Topic" value={topicId} onChange={(e) => setTopicId(e.target.value)} className="col-span-2 lg:hidden">
                <option value="">All topics</option>
                {topics.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <Select aria-label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="">Any difficulty</option>
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {DIFF_LABEL[d]}
                  </option>
                ))}
              </Select>
              <Select aria-label="Question type" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">Any type</option>
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              <Segmented
                className="col-span-2 w-fit xl:col-span-1"
                label="Show"
                value={archived}
                onChange={setArchived}
                options={[
                  { id: 'false', label: 'Active' },
                  { id: 'true', label: 'Archived' },
                ]}
              />
            </div>
          </Card>

          {q.isLoading ? (
            <Spinner label="Loading questions" />
          ) : q.isError ? (
            <ErrorBox error={q.error} onRetry={() => q.refetch()} />
          ) : !q.data?.length ? (
            <Card>
              <EmptyState
                icon={<FileQuestion className="size-6" />}
                title={archived === 'true' ? 'No archived questions' : filtered ? 'No questions match these filters' : 'Your bank is empty'}
                body={archived === 'true' ? 'Archived questions are hidden from pickers but kept for history.' : filtered ? 'Try clearing a filter.' : 'Write your first question or import a CSV of existing ones.'}
                action={
                  !filtered && archived === 'false' ? (
                    <div className="flex gap-2">
                      <Button variant="outline" icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>
                        Import
                      </Button>
                      <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                        New question
                      </Button>
                    </div>
                  ) : filtered ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSearch('');
                        setTopicId('');
                        setDifficulty('');
                        setType('');
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <>
              <p className="tabular px-1 text-[13px] text-muted" aria-live="polite">
                {q.data.length} question{q.data.length === 1 ? '' : 's'}
                {q.data.length >= 500 && ' (showing the 500 most recent — refine your filters)'}
              </p>
              <ul className={cx('space-y-2.5', q.isFetching && 'opacity-70 transition')}>
                {q.data.map((x) => (
                  <li key={x.id}>
                    <Card className="group p-4 transition hover:border-line-strong">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                        <div className="min-w-0 flex-1">
                          <button type="button" onClick={() => setEditing(x)} className="block w-full text-left" disabled={x.archived}>
                            <p className="line-clamp-2 text-[15px] leading-snug">{x.current.body.replace(/```[\s\S]*?```/g, ' [code] ').replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1')}</p>
                          </button>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Badge>{x.topic.name}</Badge>
                            <Badge tone={DIFFICULTY_TONE[x.difficulty]}>{DIFF_LABEL[x.difficulty]}</Badge>
                            <Badge tone="info">{TYPE_LABEL[x.type]}</Badge>
                            {x.tags.map((t) => (
                              <button key={t} type="button" onClick={() => setSearch(t)} className="rounded-full px-1.5 text-[12px] text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Filter by tag ${t}`}>
                                #{t}
                              </button>
                            ))}
                          </div>
                          <div className="tabular mt-2 flex flex-wrap gap-x-3 text-[12px] text-muted">
                            <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setHistory(x)}>
                              <History className="size-3.5" aria-hidden /> v{x.currentVersion}
                              {x.versionCount > 1 && ` · ${x.versionCount} versions`}
                            </button>
                            <span>{x.usedInExams ? `Used in ${x.usedInExams} exam${x.usedInExams === 1 ? '' : 's'}` : 'Not used yet'}</span>
                            <span>Updated {relative(x.updatedAt)}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-row-reverse items-center justify-between gap-2 border-t border-line pt-2 sm:flex-col sm:items-end sm:border-0 sm:pt-0">
                          <div className="text-right">
                            <div className="tabular text-lg font-semibold leading-none">{x.current.marks}</div>
                            <div className="text-[11px] text-muted">marks{x.current.negativeMarks > 0 && ` · −${x.current.negativeMarks}`}</div>
                          </div>
                          <div className="flex">
                            {!x.archived && (
                              <IconBtn label="Edit question" onClick={() => setEditing(x)}>
                                <Pencil className="size-4" />
                              </IconBtn>
                            )}
                            <IconBtn label="Version history" onClick={() => setHistory(x)}>
                              <History className="size-4" />
                            </IconBtn>
                            {!x.archived && (
                              <IconBtn label="Duplicate question" onClick={() => duplicate.mutate(x)} disabled={duplicate.isPending}>
                                <Copy className="size-4" />
                              </IconBtn>
                            )}
                            <IconBtn label={x.archived ? 'Restore question' : 'Archive question'} onClick={() => (x.archived ? archive.mutate(x) : setArchiving(x))}>
                              {x.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                            </IconBtn>
                          </div>
                        </div>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <QuestionFormModal open={creating || !!editing} question={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      <QuestionImport open={importing} onClose={() => setImporting(false)} />
      <VersionsModal question={history} onClose={() => setHistory(null)} />
      <ConfirmDialog
        open={!!archiving}
        onClose={() => setArchiving(null)}
        onConfirm={() => archiving && archive.mutate(archiving)}
        loading={archive.isPending}
        title="Archive this question?"
        confirmLabel="Archive"
        body={
          archiving?.usedInExams ? (
            <>It’s used in {archiving.usedInExams} exam{archiving.usedInExams === 1 ? '' : 's'}. Past attempts are unaffected, but draft exams containing it won’t pass the publish check until it’s removed or restored.</>
          ) : (
            'It will be hidden from the bank and from question pickers. You can restore it any time.'
          )
        }
      />
    </div>
  );
}

function TopicBtn({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'true' : undefined} className={cx('flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition', active ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
      <span className="truncate">{label}</span>
      {count !== undefined && <span className="tabular text-[12px] text-muted">{count}</span>}
    </button>
  );
}
