import { forwardRef } from 'react';
import { Check, CircleDot, X } from 'lucide-react';
import { cx, Input } from '@/components/ui';
import type { Option } from './types';
import { round2 } from './bits';

export const selectedOf = (r: unknown): string[] => (Array.isArray(r) ? (r as string[]) : []);
export const textOf = (r: unknown): string => (r && typeof r === 'object' && !Array.isArray(r) ? ((r as { text?: string }).text ?? '') : '');

/**
 * Options in the order the candidate saw them, with the key and the candidate's choice
 * marked by icon + text (never colour alone).
 */
export function OptionList({ options, order, correct, selected, compact }: { options: Option[]; order?: string[] | null; correct: string[]; selected: string[]; compact?: boolean }) {
  const byId = new Map(options.map((o) => [o.id, o]));
  const ordered = order?.length ? (order.map((id) => byId.get(id)).filter(Boolean) as Option[]) : options;
  return (
    <ul className="flex flex-col gap-1.5">
      {ordered.map((o, i) => {
        const isCorrect = correct.includes(o.id);
        const picked = selected.includes(o.id);
        const wrongPick = picked && !isCorrect;
        return (
          <li
            key={o.id}
            className={cx(
              'flex items-start gap-3 rounded-lg border px-3 text-sm',
              compact ? 'py-1.5' : 'py-2',
              isCorrect ? 'border-ok/40 bg-ok-soft' : wrongPick ? 'border-danger/40 bg-danger-soft' : 'border-line bg-surface',
            )}
          >
            <span className={cx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-semibold', picked ? 'border-transparent bg-ink text-surface' : 'border-line-strong text-muted')} aria-hidden>
              {String.fromCharCode(65 + i)}
            </span>
            <span className="min-w-0 flex-1 text-ink">{o.text}</span>
            <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
              {picked && (
                <span className={cx('inline-flex items-center gap-1 text-[12px] font-medium', isCorrect ? 'text-ok' : 'text-danger')}>
                  <CircleDot className="size-3.5" aria-hidden /> Chosen
                </span>
              )}
              {isCorrect && (
                <span className="inline-flex items-center gap-1 text-[12px] font-medium text-ok">
                  <Check className="size-3.5" aria-hidden /> Correct
                </span>
              )}
              {wrongPick && <X className="size-3.5 text-danger" aria-label="Incorrect choice" />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function WrittenResponse({ text }: { text: string }) {
  if (!text.trim()) return <p className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-sm italic text-muted">No answer was written.</p>;
  return <div className="exam-text whitespace-pre-wrap rounded-lg border border-line bg-surface-2/40 px-4 py-3 text-[15px] text-ink">{text}</div>;
}

/* ------------------------------ score entry ------------------------------ */

export function validateScore(raw: string, marks: number): string | null {
  if (raw.trim() === '') return 'Enter a score';
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'Score must be a number';
  if (n < 0) return 'Score cannot be negative';
  if (n > marks) return `Maximum is ${marks}`;
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(raw.trim())) return 'Use at most two decimals';
  return null;
}

/** Number field + quick-score chips (0, half, full). */
export const ScoreInput = forwardRef<HTMLInputElement, { id?: string; value: string; onChange: (v: string) => void; marks: number; error?: string | null; disabled?: boolean; onEnter?: () => void }>(
  ({ id, value, onChange, marks, error, disabled, onEnter }, ref) => {
    const quick = [0, round2(marks / 2), marks];
    return (
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-28">
          <Input
            ref={ref}
            id={id}
            type="number"
            inputMode="decimal"
            min={0}
            max={marks}
            step={0.5}
            value={value}
            disabled={disabled}
            invalid={!!error}
            aria-describedby={id ? `${id}-max` : undefined}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && onEnter) {
                e.preventDefault();
                onEnter();
              }
            }}
            className="tabular pr-10 text-base font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span id={id ? `${id}-max` : undefined} className="tabular pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-muted">
            /{marks}
          </span>
        </div>
        <div className="flex gap-1" role="group" aria-label="Quick scores">
          {quick.map((q, i) => (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => onChange(String(q))}
              aria-pressed={value !== '' && Number(value) === q}
              className={cx('tabular h-10 min-w-11 rounded-lg border px-2.5 text-sm font-medium transition', value !== '' && Number(value) === q ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-ink-2 hover:border-line-strong')}
            >
              {i === 0 ? '0' : i === 1 ? `½ · ${q}` : `Full · ${q}`}
            </button>
          ))}
        </div>
      </div>
    );
  },
);
ScoreInput.displayName = 'ScoreInput';
