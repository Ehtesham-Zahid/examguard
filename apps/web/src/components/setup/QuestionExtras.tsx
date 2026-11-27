import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { RichText } from '@/components/RichText';
import { Badge, Button, cx, ErrorBox, Modal, Spinner } from '@/components/ui';
import { ImportWizard } from './ImportWizard';
import { SCHEME_INFO } from './QuestionForm';
import type { QuestionDetail, QuestionItem } from './types';

const TEMPLATE = `type,topic,difficulty,question,options,correct,marks,negative_marks,scheme,rubric,tags
SINGLE,Algorithms,EASY,What is the worst-case time complexity of binary search?,O(1)|O(log n)|O(n)|O(n log n),B,2,0.5,,,search|complexity
MULTI,Data Structures,MEDIUM,Which of these structures give O(1) average lookup by key?,Hash map|Sorted array|Hash set|Linked list,A|C,3,0,PARTIAL,,hashing
WRITTEN,Databases,HARD,Explain the difference between optimistic and pessimistic locking.,,,5,,,"2 marks: defines both; 2 marks: trade-offs; 1 mark: example",concurrency`;

const SAMPLE_JSON = `[
  {
    "type": "SINGLE",
    "topic": "Algorithms",
    "difficulty": "EASY",
    "question": "What is the worst-case time complexity of binary search?",
    "options": [{ "text": "O(1)" }, { "text": "O(log n)" }, { "text": "O(n)" }],
    "correct": ["b"],
    "marks": 2,
    "negativeMarks": 0.5,
    "tags": ["search"]
  }
]`;

export function QuestionImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  return (
    <ImportWizard
      open={open}
      onClose={onClose}
      title="Import questions"
      description="Validate first — nothing is saved until you confirm. Duplicates of questions already in your bank are flagged."
      endpoint="/questions/import"
      templateName="examify-questions-template.csv"
      templateCsv={TEMPLATE}
      sampleJson={SAMPLE_JSON}
      columnsHint={
        <>
          CSV columns: <code>type, topic, difficulty, question, options, correct, marks, negative_marks, scheme, rubric, tags</code>. Separate options, correct letters and tags with <code>|</code> — e.g. options <code>Red|Green|Blue</code>, correct <code>A|C</code>. New topics are created automatically.
        </>
      }
      previewHeader="Question"
      previewCell={(r) => <span className="line-clamp-2 text-sm">{r.preview || <span className="text-muted">(empty)</span>}</span>}
      noun={['question', 'questions']}
      onCommitted={() => {
        qc.invalidateQueries({ queryKey: ['questions'] });
        qc.invalidateQueries({ queryKey: ['topics'] });
      }}
    />
  );
}

export function VersionsModal({ question, onClose }: { question: QuestionItem | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['question', question?.id], queryFn: () => api<QuestionDetail>(`/questions/${question!.id}`), enabled: !!question });
  const [selected, setSelected] = useState<number | null>(null);
  const versions = q.data?.versions ?? [];
  const v = versions.find((x) => x.version === selected) ?? versions[0];

  return (
    <Modal
      open={!!question}
      onClose={() => {
        setSelected(null);
        onClose();
      }}
      title="Version history"
      description="Every edit is kept. Attempts always reference the exact version the candidate saw."
      size="xl"
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {q.isLoading ? (
        <Spinner label="Loading versions" />
      ) : q.isError ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <ol className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible" aria-label="Versions">
            {versions.map((x) => (
              <li key={x.id} className="shrink-0">
                <button
                  type="button"
                  aria-current={v?.version === x.version ? 'true' : undefined}
                  onClick={() => setSelected(x.version)}
                  className={cx('w-full rounded-lg border px-3 py-2 text-left transition', v?.version === x.version ? 'border-accent bg-accent-soft/60' : 'border-line hover:border-line-strong')}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    v{x.version}
                    {x.version === q.data!.currentVersion && <Badge tone="accent">Current</Badge>}
                  </div>
                  <div className="tabular text-[12px] text-muted">{fmtDate(x.createdAt)}</div>
                </button>
              </li>
            ))}
          </ol>
          {v && (
            <div className="min-w-0 rounded-xl border border-line p-4">
              <RichText text={v.body} className="exam-text" />
              {v.options.length > 0 && (
                <ul className="mt-4 space-y-1.5">
                  {v.options.map((o, i) => {
                    const ok = v.correct.includes(o.id);
                    return (
                      <li key={o.id} className={cx('flex items-start gap-2 rounded-lg px-3 py-2 text-sm', ok ? 'bg-ok-soft' : 'bg-surface-2/60')}>
                        {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-label="Correct" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />}
                        <span className="font-semibold text-muted">{String.fromCharCode(65 + i)}.</span>
                        <span>{o.text}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
                <div>
                  <dt className="inline text-muted">Marks </dt>
                  <dd className="tabular inline font-medium">{v.marks}</dd>
                </div>
                {v.negativeMarks > 0 && (
                  <div>
                    <dt className="inline text-muted">Penalty </dt>
                    <dd className="tabular inline font-medium">−{v.negativeMarks}</dd>
                  </div>
                )}
                {q.data!.type === 'MULTI' && (
                  <div>
                    <dt className="inline text-muted">Scheme </dt>
                    <dd className="inline font-medium">{SCHEME_INFO[v.multiScheme].label}</dd>
                  </div>
                )}
              </dl>
              {v.rubric && (
                <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
                  <div className="mb-1 font-semibold text-muted">Rubric</div>
                  <div className="whitespace-pre-wrap">{v.rubric}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
