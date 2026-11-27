/**
 * Fair randomised paper generation (Innovation 5.2).
 *
 * Every question has an expected success rate p (its "easiness"): the examiner's label
 * gives the prior (EASY .8 / MEDIUM .55 / HARD .3) and real attempt data recalibrates it.
 * For each candidate we sample many blueprint-conforming papers and keep the one whose
 * mark-weighted expected score is closest to the pool target, while penalising overlap with
 * papers already issued — giving equal difficulty AND meaningful variation.
 */
import { rng, shuffle } from './random.js';

export const PRIOR: Record<string, number> = { EASY: 0.8, MEDIUM: 0.55, HARD: 0.3 };

export interface PoolQuestion {
  id: string;
  topicId: string;
  difficulty: string;
  p: number; // expected success rate 0..1
}
export interface Slot {
  topicId: string;
  difficulty: string;
  count: number;
  marks: number;
}

export const easiness = (q: { difficulty: string; calibratedDifficulty: number | null }) =>
  q.calibratedDifficulty ?? PRIOR[q.difficulty] ?? 0.55;

export function slotPool(pool: PoolQuestion[], s: Slot) {
  return pool.filter((q) => q.topicId === s.topicId && q.difficulty === s.difficulty);
}

export function validateBlueprint(pool: PoolQuestion[], slots: Slot[]) {
  const problems: string[] = [];
  slots.forEach((s, i) => {
    const n = slotPool(pool, s).length;
    if (s.count < 1) problems.push(`Row ${i + 1}: count must be at least 1`);
    if (n < s.count) problems.push(`Row ${i + 1}: needs ${s.count} questions but the bank only has ${n}`);
  });
  return problems;
}

/** Expected percentage score of a paper (mark-weighted mean of p). */
export function paperDifficulty(items: { p: number; marks: number }[]) {
  const total = items.reduce((s, i) => s + i.marks, 0);
  if (!total) return 0;
  return items.reduce((s, i) => s + i.p * i.marks, 0) / total;
}

export function targetDifficulty(pool: PoolQuestion[], slots: Slot[]) {
  const items = slots.flatMap((s) => {
    const sp = slotPool(pool, s);
    const avg = sp.reduce((a, q) => a + q.p, 0) / (sp.length || 1);
    return Array.from({ length: s.count }, () => ({ p: avg, marks: s.marks }));
  });
  return paperDifficulty(items);
}

export function generateFairPaper(
  pool: PoolQuestion[],
  slots: Slot[],
  seed: string,
  usage: Map<string, number> = new Map(),
  opts: { samples?: number; overlapWeight?: number } = {},
) {
  const samples = opts.samples ?? 60;
  const overlapWeight = opts.overlapWeight ?? 0.02;
  const rand = rng(seed);
  const target = targetDifficulty(pool, slots);
  const maxUse = Math.max(1, ...usage.values());

  let best: { picks: { q: PoolQuestion; marks: number }[]; diff: number; cost: number } | null = null;
  for (let k = 0; k < samples; k++) {
    const picks = slots.flatMap((s) => shuffle(slotPool(pool, s), rand).slice(0, s.count).map((q) => ({ q, marks: s.marks })));
    const diff = paperDifficulty(picks.map((p) => ({ p: p.q.p, marks: p.marks })));
    const overlap = picks.reduce((a, p) => a + (usage.get(p.q.id) ?? 0) / maxUse, 0) / (picks.length || 1);
    const cost = Math.abs(diff - target) + overlapWeight * overlap;
    if (!best || cost < best.cost) best = { picks, diff, cost };
  }
  return { picks: best?.picks ?? [], difficulty: best?.diff ?? 0, target };
}

/** Naive baseline for comparison in the fairness report: one purely random sample. */
export function generateNaivePaper(pool: PoolQuestion[], slots: Slot[], seed: string) {
  return generateFairPaper(pool, slots, seed, new Map(), { samples: 1, overlapWeight: 0 });
}

export function stats(values: number[]) {
  const n = values.length || 1;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { mean, sd, min: Math.min(...values), max: Math.max(...values), range: Math.max(...values) - Math.min(...values) };
}

/** Average pairwise Jaccard overlap between papers (0 = completely different, 1 = identical). */
export function averageOverlap(papers: string[][]) {
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < papers.length; i++)
    for (let j = i + 1; j < papers.length; j++) {
      const a = new Set(papers[i]);
      const b = new Set(papers[j]);
      const inter = [...a].filter((x) => b.has(x)).length;
      sum += inter / (a.size + b.size - inter || 1);
      pairs++;
    }
  return pairs ? sum / pairs : 0;
}
