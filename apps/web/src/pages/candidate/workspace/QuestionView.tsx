import { Bookmark, BookmarkCheck, Check, Strikethrough } from 'lucide-react';
import { useRef, useState } from 'react';
import { RichText } from '@/components/RichText';
import { Badge, cx } from '@/components/ui';

export interface WQuestion {
  id: string;
  position: number;
  type: 'SINGLE' | 'MULTI' | 'WRITTEN';
  topic: string;
  body: string;
  marks: number;
  negativeMarks: number;
  multiScheme?: string;
  options: { id: string; text: string }[];
}
export interface WAnswer {
  response?: unknown;
  flagged?: boolean;
  visited?: boolean;
  timeSpentMs?: number;
}

const SCHEME: Record<string, string> = {
  ALL_OR_NOTHING: 'All correct options must be selected to earn marks.',
  PARTIAL: 'Partial credit for each correct option — but any wrong option scores zero.',
  PARTIAL_NEGATIVE: 'Each wrong option cancels one correct option.',
};

export function QuestionView({
  q,
  a,
  total,
  onAnswer,
  onFlag,
  onTyping,
  disabled,
}: {
  q: WQuestion;
  a: WAnswer | undefined;
  total: number;
  onAnswer: (response: unknown) => void;
  onFlag: () => void;
  onTyping: (e: React.FormEvent<HTMLTextAreaElement>, prevLen: number) => void;
  disabled?: boolean;
}) {
  const selected = Array.isArray(a?.response) ? (a!.response as string[]) : [];
  const [struck, setStruck] = useState<Set<string>>(new Set());
  const text = (a?.response as { text?: string } | null)?.text ?? '';
  const prevLen = useRef(text.length);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  const toggle = (id: string) => {
    if (disabled) return;
    if (q.type === 'SINGLE') onAnswer(selected[0] === id ? [] : [id]);
    else onAnswer(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <article aria-labelledby={`q-${q.id}-title`} className="relative">
      <header className="mb-5 flex flex-wrap items-center gap-2">
        <h2 id={`q-${q.id}-title`} className="display text-[22px] font-semibold">
          Question {q.position}
          <span className="ml-1 text-base font-normal text-muted">/ {total}</span>
        </h2>
        <Badge>{q.topic}</Badge>
        <Badge tone="accent">
          {q.marks} mark{q.marks === 1 ? '' : 's'}
        </Badge>
        {q.negativeMarks > 0 && <Badge tone="danger">−{q.negativeMarks} if wrong</Badge>}
        <button onClick={onFlag} disabled={disabled} aria-pressed={!!a?.flagged} className={cx('ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition', a?.flagged ? 'border-warn bg-warn-soft text-warn' : 'border-line text-ink-2 hover:border-line-strong')}>
          {a?.flagged ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
          {a?.flagged ? 'Marked for review' : 'Mark for review'}
        </button>
      </header>

      <div className="exam-text no-select mb-6">
        <RichText text={q.body} />
      </div>

      {q.type !== 'WRITTEN' && (
        <fieldset>
          <legend className="mb-3 text-sm text-muted">
            {q.type === 'SINGLE' ? 'Choose one answer.' : `Select all that apply. ${q.multiScheme ? SCHEME[q.multiScheme] : ''}`}
          </legend>
          <div className="space-y-2.5" role={q.type === 'SINGLE' ? 'radiogroup' : 'group'}>
            {q.options.map((o, i) => {
              const on = selected.includes(o.id);
              const isStruck = struck.has(o.id);
              return (
                <div key={o.id} className="group flex items-stretch gap-2">
                  <button
                    role={q.type === 'SINGLE' ? 'radio' : 'checkbox'}
                    aria-checked={on}
                    disabled={disabled}
                    onClick={() => toggle(o.id)}
                    className={cx(
                      'exam-text no-select flex flex-1 items-start gap-3 rounded-xl border-2 px-4 py-3 text-left transition',
                      on ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong',
                      isStruck && !on && 'opacity-45',
                    )}
                  >
                    <span className={cx('mt-0.5 grid size-6 shrink-0 place-items-center border-2 font-mono text-xs font-semibold', q.type === 'SINGLE' ? 'rounded-full' : 'rounded-md', on ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong text-muted')}>
                      {on ? <Check className="size-3.5" strokeWidth={3} /> : String.fromCharCode(65 + i)}
                    </span>
                    <span className={cx('min-w-0 flex-1', isStruck && 'line-through')}>
                      <RichText text={o.text} />
                    </span>
                    <span className="hidden self-center font-mono text-[11px] text-muted sm:inline">{i + 1}</span>
                  </button>
                  <button
                    onClick={() => setStruck((s) => { const n = new Set(s); n.has(o.id) ? n.delete(o.id) : n.add(o.id); return n; })}
                    className={cx('rounded-lg px-2 text-muted transition hover:bg-surface-2', isStruck ? 'text-ink opacity-100' : 'opacity-40 group-hover:opacity-100')}
                    aria-label={`${isStruck ? 'Restore' : 'Eliminate'} option ${String.fromCharCode(65 + i)}`}
                    title="Eliminate option (visual aid only)"
                  >
                    <Strikethrough className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
          {selected.length > 0 && !disabled && (
            <button onClick={() => onAnswer([])} className="mt-3 text-sm font-medium text-muted hover:text-ink hover:underline">
              Clear selection
            </button>
          )}
        </fieldset>
      )}

      {q.type === 'WRITTEN' && (
        <div>
          <label htmlFor={`ans-${q.id}`} className="mb-2 block text-sm text-muted">
            Write your answer below. Pasting from outside the exam is disabled.
          </label>
          <textarea
            id={`ans-${q.id}`}
            value={text}
            disabled={disabled}
            spellCheck
            onChange={(e) => onAnswer({ text: e.target.value })}
            onInput={(e) => {
              onTyping(e, prevLen.current);
              prevLen.current = e.currentTarget.value.length;
            }}
            onDrop={(e) => e.preventDefault()}
            className="exam-text min-h-[260px] w-full resize-y rounded-xl border-2 border-line bg-surface p-4 outline-none transition focus:border-accent"
            placeholder="Start typing your answer…"
          />
          <div className="mt-1.5 flex justify-between text-xs text-muted">
            <span>Saved automatically as you type</span>
            <span className="tabular">{words} words</span>
          </div>
        </div>
      )}
    </article>
  );
}

export const isAnswered = (a?: WAnswer) => (Array.isArray(a?.response) ? (a!.response as unknown[]).length > 0 : !!(a?.response as { text?: string } | null)?.text?.trim());
