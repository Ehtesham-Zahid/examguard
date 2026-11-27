import { describe, expect, it } from 'vitest';
import { autoMark, validateManualScore } from './marking.js';
import { computeDeadline, examPhase } from './examPhase.js';
import { generateFairPaper, generateNaivePaper, stats, type PoolQuestion } from './fairness.js';
import { jaccard, shingles } from './similarity.js';

const base = { marks: 4, negativeMarks: 1, multiScheme: 'PARTIAL' as const, correct: ['a', 'b'] };

describe('autoMark', () => {
  it('single correct / wrong / blank', () => {
    expect(autoMark({ ...base, type: 'SINGLE', correct: ['a'], response: ['a'] })).toBe(4);
    expect(autoMark({ ...base, type: 'SINGLE', correct: ['a'], response: ['b'] })).toBe(-1);
    expect(autoMark({ ...base, type: 'SINGLE', correct: ['a'], response: [] })).toBe(0);
    expect(autoMark({ ...base, type: 'SINGLE', correct: ['a'], response: ['a', 'b'] })).toBe(-1);
  });
  it('multi partial', () => {
    expect(autoMark({ ...base, type: 'MULTI', response: ['a'] })).toBe(2);
    expect(autoMark({ ...base, type: 'MULTI', response: ['a', 'b'] })).toBe(4);
    expect(autoMark({ ...base, type: 'MULTI', response: ['a', 'c'] })).toBe(0);
  });
  it('multi all-or-nothing', () => {
    expect(autoMark({ ...base, type: 'MULTI', multiScheme: 'ALL_OR_NOTHING', response: ['a'] })).toBe(-1);
    expect(autoMark({ ...base, type: 'MULTI', multiScheme: 'ALL_OR_NOTHING', response: ['b', 'a'] })).toBe(4);
  });
  it('multi partial negative floors at zero', () => {
    expect(autoMark({ ...base, type: 'MULTI', multiScheme: 'PARTIAL_NEGATIVE', response: ['a', 'c'] })).toBe(0);
    expect(autoMark({ ...base, type: 'MULTI', multiScheme: 'PARTIAL_NEGATIVE', correct: ['a', 'b', 'c'], response: ['a', 'b', 'd'] })).toBe(1.33);
  });
  it('ignores duplicate ids & garbage', () => {
    expect(autoMark({ ...base, type: 'MULTI', response: ['a', 'a', 5] })).toBe(2);
  });
  it('written needs manual', () => {
    expect(autoMark({ ...base, type: 'WRITTEN', response: { text: 'x' } })).toBeNull();
  });
});

describe('validateManualScore', () => {
  it('bounds', () => {
    expect(validateManualScore(5, 4)).toMatch(/exceed/);
    expect(validateManualScore(-1, 4)).toMatch(/negative/);
    expect(validateManualScore(2.5, 4)).toBeNull();
  });
});

describe('exam timing', () => {
  const ws = new Date('2026-01-01T10:00:00Z');
  const we = new Date('2026-01-01T12:00:00Z');
  it('phase derived from clock', () => {
    expect(examPhase({ status: 'PUBLISHED', windowStart: ws, windowEnd: we }, new Date('2026-01-01T09:00:00Z'))).toBe('PUBLISHED');
    expect(examPhase({ status: 'PUBLISHED', windowStart: ws, windowEnd: we }, new Date('2026-01-01T11:00:00Z'))).toBe('ONGOING');
    expect(examPhase({ status: 'PUBLISHED', windowStart: ws, windowEnd: we }, new Date('2026-01-01T13:00:00Z'))).toBe('COMPLETED');
  });
  it('deadline capped by window', () => {
    expect(computeDeadline(new Date('2026-01-01T11:30:00Z'), 60, 0, we).toISOString()).toBe('2026-01-01T12:00:00.000Z');
    expect(computeDeadline(new Date('2026-01-01T10:00:00Z'), 60, 0, we).toISOString()).toBe('2026-01-01T11:00:00.000Z');
    expect(computeDeadline(new Date('2026-01-01T10:00:00Z'), 60, 50, we).toISOString()).toBe('2026-01-01T11:30:00.000Z');
  });
});

describe('fair paper generation', () => {
  const pool: PoolQuestion[] = [];
  for (let i = 0; i < 12; i++) pool.push({ id: `e${i}`, topicId: 't', difficulty: 'EASY', p: 0.6 + (i % 6) * 0.07 });
  for (let i = 0; i < 12; i++) pool.push({ id: `h${i}`, topicId: 't', difficulty: 'HARD', p: 0.15 + (i % 6) * 0.06 });
  const slots = [
    { topicId: 't', difficulty: 'EASY', count: 3, marks: 2 },
    { topicId: 't', difficulty: 'HARD', count: 2, marks: 4 },
  ];
  it('is less variable than naive sampling', () => {
    const fair = Array.from({ length: 30 }, (_, i) => generateFairPaper(pool, slots, `s${i}`).difficulty);
    const naive = Array.from({ length: 30 }, (_, i) => generateNaivePaper(pool, slots, `s${i}`).difficulty);
    expect(stats(fair).sd).toBeLessThan(stats(naive).sd);
  });
  it('respects blueprint', () => {
    const p = generateFairPaper(pool, slots, 'x');
    expect(p.picks.filter((x) => x.q.difficulty === 'EASY')).toHaveLength(3);
    expect(p.picks.filter((x) => x.q.difficulty === 'HARD')).toHaveLength(2);
  });
});

describe('similarity', () => {
  it('detects copied text', () => {
    const a = shingles('A binary search tree keeps keys in sorted order so lookup is logarithmic');
    const b = shingles('a binary search tree keeps keys in sorted order, so lookup is logarithmic!');
    const c = shingles('Hash tables give constant time average access using buckets');
    expect(jaccard(a, b)).toBeGreaterThan(0.9);
    expect(jaccard(a, c)).toBeLessThan(0.1);
  });
});
