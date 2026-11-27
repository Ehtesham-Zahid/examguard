import { describe, expect, it } from 'vitest';
import { inputHash, redactPII, sanitise, SuggestionSchema, type SuggestionOutput } from './grader.js';

const input = { question: 'Explain a stack.', rubric: '- LIFO\n- push/pop', maxMarks: 5, answer: 'A stack is LIFO.\nYou push and pop items.' };
const out = (o: Partial<SuggestionOutput>): SuggestionOutput => ({ score: 3, confidence: 'medium', summary: 's', criteria: [], evidence: [], feedback: 'f', flags: [], ...o });

describe('AI grader safety', () => {
  it('clamps the mark to the range and a 0.5 grid', () => {
    expect(sanitise(out({ score: 9 }), input).score).toBe(5);
    expect(sanitise(out({ score: -2 }), input).score).toBe(0);
    expect(sanitise(out({ score: 3.3 }), input).score).toBe(3.5);
    expect(sanitise(out({ score: Number.NaN }), input).score).toBe(0);
  });
  it('verifies quotes against the answer (whitespace/case tolerant) and flags fabricated ones', () => {
    const s = sanitise(out({ evidence: [{ quote: 'a stack is   LIFO.', supports: 'x' }, { quote: 'Stacks are queues', supports: 'y' }] }), input);
    expect(s.evidence.map((e) => e.verified)).toEqual([true, false]);
    expect(s.flags).toContain('needs_human_review');
  });
  it('limits evidence to four quotes and de-duplicates flags', () => {
    const s = sanitise(out({ evidence: Array.from({ length: 7 }, () => ({ quote: 'You push', supports: '' })), flags: ['rubric_unclear', 'rubric_unclear'] }), input);
    expect(s.evidence).toHaveLength(4);
    expect(s.flags).toEqual(['rubric_unclear']);
  });
  it('redacts emails and phone numbers before sending', () => {
    expect(redactPII('mail me at ali.raza@uni.edu.pk or +92 300 1234567')).toBe('mail me at [email] or [number]');
    expect(redactPII('O(1) push, 3 items')).toBe('O(1) push, 3 items');
    expect(redactPII('2^40 = 1099511627776 bytes')).toBe('2^40 = 1099511627776 bytes'); // numeric answers survive
    expect(redactPII('call 0300-123-4567')).toBe('call [number]');
  });
  it('fingerprints the inputs that determine a suggestion', () => {
    expect(inputHash(input)).toBe(inputHash({ ...input }));
    expect(inputHash(input)).not.toBe(inputHash({ ...input, rubric: '- LIFO' }));
    expect(inputHash(input)).not.toBe(inputHash({ ...input, maxMarks: 6 }));
  });
  it('schema accepts a well-formed model response', () => {
    expect(SuggestionSchema.safeParse(out({ criteria: [{ criterion: 'LIFO', verdict: 'met', comment: 'ok' }], flags: ['possible_manipulation'] })).success).toBe(true);
    expect(SuggestionSchema.safeParse({ ...out({}), confidence: 'certain' }).success).toBe(false);
  });
});
