/** AI marking assistant UI: suggestion panel, quote highlighting and the consistency report. */
import { Fragment, useMemo } from 'react';
import { AlertTriangle, Check, CircleDashed, EyeOff, Info, Minus, RefreshCw, ShieldAlert, Sparkles, Wand2, X } from 'lucide-react';
import { Badge, Button, cx, Kbd, Spinner } from '@/components/ui';
import { fmtScore } from './bits';
import type { AiFlag, AiSuggestion } from './types';

const FLAG: Record<AiFlag, { tone: 'danger' | 'warn' | 'info'; icon: typeof Info; text: string }> = {
  possible_manipulation: { tone: 'danger', icon: ShieldAlert, text: 'This answer contains text aimed at the marker (for example asking for marks). Claude ignored it — check the answer yourself.' },
  needs_human_review: { tone: 'warn', icon: AlertTriangle, text: 'Claude is not confident about this one. Read the answer carefully before deciding.' },
  rubric_unclear: { tone: 'info', icon: Info, text: 'No rubric was provided, so Claude inferred the expected points from the question.' },
  blank_or_off_topic: { tone: 'warn', icon: AlertTriangle, text: 'The answer looks blank or off-topic.' },
};
const toneCls = { danger: 'border-danger/30 bg-danger-soft text-danger', warn: 'border-warn/30 bg-warn-soft text-warn', info: 'border-info/30 bg-info-soft text-info' };
const CONF = { high: { tone: 'ok', label: 'High confidence' }, medium: { tone: 'info', label: 'Medium confidence' }, low: { tone: 'warn', label: 'Low confidence' } } as const;
const VERDICT = {
  met: { icon: Check, cls: 'bg-ok-soft text-ok', label: 'Met' },
  partial: { icon: Minus, cls: 'bg-warn-soft text-warn', label: 'Partly met' },
  missed: { icon: X, cls: 'bg-danger-soft text-danger', label: 'Missed' },
} as const;

export function AiSuggestionPanel({
  enabled,
  blank,
  suggestion,
  loading,
  onRequest,
  onAccept,
  onUseFeedback,
  activeQuote,
  onQuoteHover,
}: {
  enabled: boolean;
  blank: boolean;
  suggestion?: AiSuggestion;
  loading: boolean;
  onRequest: (force: boolean) => void;
  onAccept: () => void;
  onUseFeedback: () => void;
  activeQuote: number | null;
  onQuoteHover: (i: number | null) => void;
}) {
  if (blank) return null;
  if (!enabled)
    return (
      <div className="flex items-start gap-3 rounded-xl border border-dashed border-line-strong px-4 py-3 text-[13px] text-ink-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
        <p>
          <strong className="text-ink">AI marking assistant is off.</strong> An administrator can turn it on by adding a Claude API key (<code className="font-mono text-[12px]">ANTHROPIC_API_KEY</code>) to the server. You can grade normally meanwhile.
        </p>
      </div>
    );

  const shell = (children: React.ReactNode, cls = '') => (
    <section aria-label="AI suggestion" aria-busy={loading} className={cx('rounded-xl border-2 border-ink/80 bg-surface shadow-[4px_4px_0_var(--hl)]', cls)}>
      {children}
    </section>
  );

  if (loading)
    return shell(
      <div className="flex items-center gap-3 px-4 py-4" role="status">
        <span className="relative grid size-9 place-items-center rounded-lg bg-hl text-hl-ink">
          <Sparkles className="size-4 animate-pulse" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Claude is reading this answer against the rubric…</div>
          <div className="mt-2 grid gap-1.5" aria-hidden>
            <div className="h-2 w-3/4 animate-pulse rounded bg-surface-2" />
            <div className="h-2 w-1/2 animate-pulse rounded bg-surface-2" />
          </div>
        </div>
      </div>,
    );

  if (!suggestion)
    return shell(
      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
        <span className="grid size-9 place-items-center rounded-lg bg-hl text-hl-ink">
          <Wand2 className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Get a suggested mark</div>
          <p className="flex items-center gap-1.5 text-[12px] text-ink-2">
            <EyeOff className="size-3.5" aria-hidden /> Claude sees only the question, rubric and this answer — never who wrote it.
          </p>
        </div>
        <Button size="sm" variant="highlight" icon={<Sparkles className="size-4" />} onClick={() => onRequest(false)}>
          Suggest mark <Kbd>S</Kbd>
        </Button>
      </div>,
    );

  if (suggestion.status === 'FAILED')
    return shell(
      <div className="flex flex-wrap items-start gap-3 px-4 py-3.5" role="alert">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold">No suggestion this time</div>
          <p className="text-ink-2">{suggestion.error}</p>
        </div>
        <Button size="sm" variant="outline" icon={<RefreshCw className="size-4" />} onClick={() => onRequest(true)}>
          Try again
        </Button>
      </div>,
    );

  const s = suggestion;
  const conf = s.confidence ? CONF[s.confidence] : null;
  const decided = s.decision && s.finalScore != null;
  return shell(
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-hl text-hl-ink">
            <Sparkles className="size-4" aria-hidden />
          </span>
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-ink-2">AI suggestion</span>
        </div>
        <div className="flex items-baseline gap-1" aria-label={`Suggested ${fmtScore(s.score)} out of ${s.maxScore}`}>
          <span className="display text-[28px] font-bold leading-none tabular">{fmtScore(s.score)}</span>
          <span className="text-sm text-ink-2">/ {s.maxScore}</span>
        </div>
        {conf && (
          <Badge tone={conf.tone} dot>
            {conf.label}
          </Badge>
        )}
        {s.stale && <Badge tone="warn">Answer or rubric changed</Badge>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={() => onRequest(true)} aria-label="Ask Claude again">
            Redo
          </Button>
          {s.feedback && (
            <Button size="sm" variant="outline" onClick={onUseFeedback}>
              Use feedback
            </Button>
          )}
          <Button size="sm" onClick={onAccept} icon={<Check className="size-4" />}>
            Use this mark <Kbd>A</Kbd>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 px-4 py-3">
        {s.summary && <p className="text-[14px] text-ink">{s.summary}</p>}
        {s.flags.length > 0 && (
          <ul className="grid gap-1.5">
            {s.flags.map((f) => {
              const F = FLAG[f];
              if (!F) return null;
              return (
                <li key={f} className={cx('flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]', toneCls[F.tone])}>
                  <F.icon className="mt-0.5 size-4 shrink-0" aria-hidden /> {F.text}
                </li>
              );
            })}
          </ul>
        )}
        {s.criteria.length > 0 && (
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Against the rubric</div>
            <ul className="grid gap-1.5">
              {s.criteria.map((c, i) => {
                const V = VERDICT[c.verdict] ?? VERDICT.partial;
                return (
                  <li key={i} className="flex items-start gap-2.5 text-[13px]">
                    <span className={cx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', V.cls)} title={V.label}>
                      <V.icon className="size-3" aria-hidden />
                      <span className="sr-only">{V.label}:</span>
                    </span>
                    <span>
                      <strong className="font-semibold text-ink">{c.criterion}</strong> <span className="text-ink-2">— {c.comment}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {s.evidence.length > 0 && (
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Evidence from the answer</div>
            <ul className="grid gap-1.5">
              {s.evidence.map((e, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onMouseEnter={() => onQuoteHover(i)}
                    onMouseLeave={() => onQuoteHover(null)}
                    onFocus={() => onQuoteHover(i)}
                    onBlur={() => onQuoteHover(null)}
                    className={cx('w-full rounded-lg border-l-4 px-3 py-2 text-left text-[13px] transition', activeQuote === i ? 'border-ink bg-hl/40' : 'border-hl bg-surface-2/60 hover:bg-hl/25')}
                  >
                    <span className="italic text-ink">“{e.quote}”</span>
                    <span className="mt-0.5 block text-[12px] text-ink-2">
                      {e.supports}
                      {!e.verified && <span className="ml-1.5 font-semibold text-warn">· not found word-for-word in the answer</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <EyeOff className="size-3.5" aria-hidden /> Marked blind by {s.model}. Advisory only — your mark is final, and both are logged.
        </span>
        {decided && (
          <span className="font-medium text-ink-2">{s.decision === 'ACCEPTED' ? 'You used this mark' : `You adjusted ${fmtScore(s.score)} → ${fmtScore(s.finalScore)}`}</span>
        )}
      </div>
    </>,
  );
}

/** The candidate's answer with Claude's evidence quotes highlighted (the hovered one more strongly). */
export function HighlightedAnswer({ text, quotes, active }: { text: string; quotes: { quote: string; verified: boolean }[]; active: number | null }) {
  const parts = useMemo(() => {
    const ranges: { start: number; end: number; i: number }[] = [];
    const lower = text.toLowerCase();
    quotes.forEach((q, i) => {
      if (!q.verified || !q.quote.trim()) return;
      let at = text.indexOf(q.quote);
      if (at < 0) at = lower.indexOf(q.quote.toLowerCase());
      if (at >= 0 && !ranges.some((r) => at < r.end && at + q.quote.length > r.start)) ranges.push({ start: at, end: at + q.quote.length, i });
    });
    ranges.sort((a, b) => a.start - b.start);
    const out: { t: string; i: number | null }[] = [];
    let pos = 0;
    for (const r of ranges) {
      if (r.start > pos) out.push({ t: text.slice(pos, r.start), i: null });
      out.push({ t: text.slice(r.start, r.end), i: r.i });
      pos = r.end;
    }
    if (pos < text.length) out.push({ t: text.slice(pos), i: null });
    return out;
  }, [text, quotes]);
  if (!text.trim()) return <p className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-sm italic text-muted">No answer was written.</p>;
  return (
    <div className="exam-text whitespace-pre-wrap rounded-lg border border-line bg-surface-2/40 px-4 py-3 text-[15px] text-ink">
      {parts.map((p, k) =>
        p.i == null ? (
          <Fragment key={k}>{p.t}</Fragment>
        ) : (
          <mark key={k} className={cx('rounded-sm px-0.5 transition-colors', active === p.i ? 'bg-hl text-hl-ink ring-2 ring-ink/70' : 'bg-hl/45 text-inherit')}>
            {p.t}
          </mark>
        ),
      )}
    </div>
  );
}

export interface ConsistencyData {
  similarPairs: { questionId: string; a: string; b: string; similarity: number; scoreA: number; scoreB: number; marks: number }[];
  disagreements: { questionId: string; answerId: string; aiScore: number; finalScore: number; marks: number }[];
  stats: { gradedAnswers: number; comparedWithAi: number; agreementRate: number | null; accepted: number; adjusted: number; undecided: number };
}

/** Body of the consistency-check dialog. `label` turns an answer id into "Q2 · Candidate #004". */
export function ConsistencyReport({ data, loading, label, onOpen }: { data?: ConsistencyData; loading: boolean; label: (answerId: string) => string; onOpen: (answerId: string) => void }) {
  if (loading || !data) return <Spinner label="Comparing marks" />;
  const { stats } = data;
  return (
    <div className="grid gap-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Answers compared', stats.gradedAnswers],
          ['Agreement with AI', stats.agreementRate == null ? '—' : `${stats.agreementRate}%`],
          ['AI mark used', stats.accepted],
          ['AI mark adjusted', stats.adjusted],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-surface-2/50 px-3 py-2.5">
            <dt className="text-[12px] text-muted">{k}</dt>
            <dd className="display text-[22px] font-bold tabular">{v}</dd>
          </div>
        ))}
      </dl>
      <section>
        <h3 className="mb-1 font-semibold">Similar answers, different marks</h3>
        <p className="mb-2 text-[13px] text-ink-2">Pairs that read alike (overlapping wording) but were marked at least a quarter of the marks apart.</p>
        {data.similarPairs.length ? (
          <ul className="grid gap-2">
            {data.similarPairs.map((p) => (
              <li key={p.a + p.b} className="flex flex-wrap items-center gap-3 rounded-lg border border-warn/30 bg-warn-soft/40 px-3 py-2 text-[13px]">
                <Badge tone="warn">{Math.round(p.similarity * 100)}% alike</Badge>
                <span className="min-w-0 flex-1">
                  {label(p.a)} got <strong className="tabular">{fmtScore(p.scoreA)}</strong>, {label(p.b)} got <strong className="tabular">{fmtScore(p.scoreB)}</strong> <span className="text-muted">/ {p.marks}</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => onOpen(p.a)}>
                  Open first
                </Button>
                <Button size="sm" variant="outline" onClick={() => onOpen(p.b)}>
                  Open second
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2 text-[13px] text-ok">
            <Check className="size-4" aria-hidden /> No look-alike answers with very different marks.
          </p>
        )}
      </section>
      <section>
        <h3 className="mb-1 font-semibold">Big differences from the AI suggestion</h3>
        <p className="mb-2 text-[13px] text-ink-2">Your mark differs from Claude's by 30% of the marks or more. Often you're right — worth a second look anyway.</p>
        {data.disagreements.length ? (
          <ul className="grid gap-2">
            {data.disagreements.map((d) => (
              <li key={d.answerId} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2 text-[13px]">
                <CircleDashed className="size-4 text-info" aria-hidden />
                <span className="min-w-0 flex-1">
                  {label(d.answerId)}: you gave <strong className="tabular">{fmtScore(d.finalScore)}</strong>, AI suggested <strong className="tabular">{fmtScore(d.aiScore)}</strong> <span className="text-muted">/ {d.marks}</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => onOpen(d.answerId)}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
            <Info className="size-4" aria-hidden /> {stats.comparedWithAi ? 'Your marks are close to the AI suggestions.' : 'Nothing to compare yet — get AI suggestions and grade some answers first.'}
          </p>
        )}
      </section>
    </div>
  );
}
