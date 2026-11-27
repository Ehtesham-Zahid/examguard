/** Pure marking engine — deterministic and unit-tested. */
export type Scheme = 'ALL_OR_NOTHING' | 'PARTIAL' | 'PARTIAL_NEGATIVE';
export type QType = 'SINGLE' | 'MULTI' | 'WRITTEN';

export interface MarkInput {
  type: QType;
  marks: number;
  negativeMarks: number;
  multiScheme: Scheme;
  correct: string[];
  response: unknown;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function selectedIds(response: unknown): string[] {
  if (Array.isArray(response)) return [...new Set(response.filter((x): x is string => typeof x === 'string'))];
  return [];
}

/** Returns the auto score, or null when the question needs manual grading. */
export function autoMark(q: MarkInput): number | null {
  if (q.type === 'WRITTEN') return null;
  const sel = selectedIds(q.response);
  if (sel.length === 0) return 0; // unanswered never penalised
  const correct = new Set(q.correct);

  if (q.type === 'SINGLE') {
    if (sel.length === 1 && correct.has(sel[0])) return q.marks;
    return round(-Math.abs(q.negativeMarks));
  }

  const hits = sel.filter((s) => correct.has(s)).length;
  const misses = sel.length - hits;
  const exact = misses === 0 && hits === correct.size;

  switch (q.multiScheme) {
    case 'ALL_OR_NOTHING':
      return exact ? q.marks : round(-Math.abs(q.negativeMarks));
    case 'PARTIAL':
      // proportional credit, but any incorrect selection voids the question
      return misses > 0 ? 0 : round((hits / correct.size) * q.marks);
    case 'PARTIAL_NEGATIVE':
      // each wrong choice cancels a right one, floored at zero
      return round(Math.max(0, ((hits - misses) / correct.size) * q.marks));
  }
}

export function validateManualScore(score: number, max: number) {
  if (!Number.isFinite(score)) return 'Score must be a number';
  if (score < 0) return 'Score cannot be negative';
  if (score > max) return `Score cannot exceed the ${max} marks assigned to this question`;
  if (Math.round(score * 100) !== score * 100) return 'Use at most two decimal places';
  return null;
}

export function finalAnswerScore(a: { autoScore: number | null; manualScore: number | null }) {
  return a.manualScore ?? a.autoScore ?? 0;
}
