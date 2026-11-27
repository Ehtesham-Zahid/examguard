/** Persistence, batching, decisions and consistency checks around the AI marking assistant. */
import type { AiGradeSuggestion, Prisma } from '@prisma/client';
import { prisma } from '../../core/prisma.js';
import { aiConfig, aiEnabled } from '../../core/config.js';
import { jaccard, shingles } from '../../domain/similarity.js';
import { aiErrorMessage, inputHash, suggestGrade, type GradeInput } from './grader.js';

const answerInclude = { attemptQuestion: { include: { questionVersion: { include: { question: { select: { type: true } } } } } }, attempt: { select: { id: true, examId: true, status: true, isSandbox: true } } } as const;
type AnswerWithCtx = Prisma.AnswerGetPayload<{ include: typeof answerInclude }>;

const textOf = (a: { response: unknown }) => ((a.response as { text?: string } | null)?.text ?? '').trim();
const inputOf = (a: AnswerWithCtx): GradeInput => ({ question: a.attemptQuestion.questionVersion.body, rubric: a.attemptQuestion.questionVersion.rubric, maxMarks: a.attemptQuestion.marks, answer: textOf(a) });

export function serialize(s: AiGradeSuggestion, currentHash?: string) {
  return {
    id: s.id,
    status: s.status,
    score: s.score,
    maxScore: s.maxScore,
    confidence: s.confidence,
    summary: s.summary,
    criteria: s.criteria,
    evidence: s.evidence,
    feedback: s.feedbackDraft,
    flags: s.flags,
    error: s.error,
    model: s.model,
    createdAt: s.createdAt,
    decision: s.decision,
    finalScore: s.finalScore,
    stale: currentHash ? s.inputHash !== currentHash : false,
  };
}
export type SerializedSuggestion = ReturnType<typeof serialize>;

/** Latest suggestion per answer (for the grading screen). */
export async function latestFor(answerIds: string[]) {
  if (!answerIds.length) return new Map<string, AiGradeSuggestion>();
  const rows = await prisma.aiGradeSuggestion.findMany({ where: { answerId: { in: answerIds } }, orderBy: { createdAt: 'desc' } });
  const map = new Map<string, AiGradeSuggestion>();
  for (const r of rows) if (!map.has(r.answerId)) map.set(r.answerId, r);
  return map;
}

export class AiInputError extends Error {}

/** Suggest a mark for one answer. Reuses an existing suggestion for identical input unless force=true. */
export async function suggestForAnswer(answerId: string, userId: string, force = false) {
  const a = await prisma.answer.findUnique({ where: { id: answerId }, include: answerInclude });
  if (!a) throw new AiInputError('Answer not found');
  if (a.attemptQuestion.questionVersion.question.type !== 'WRITTEN') throw new AiInputError('Only written answers can be AI-marked');
  if (a.attempt.status === 'IN_PROGRESS') throw new AiInputError('This attempt is still in progress');
  const input = inputOf(a);
  if (!input.answer) throw new AiInputError('Blank answers are scored 0 automatically — there is nothing to mark');
  const hash = inputHash(input);
  const existing = await prisma.aiGradeSuggestion.findFirst({ where: { answerId, inputHash: hash, status: 'READY' }, orderBy: { createdAt: 'desc' } });
  // reuse identical input; even "Redo" reuses a suggestion made seconds ago (double clicks never pay twice)
  if (existing && (!force || Date.now() - existing.createdAt.getTime() < 15_000)) return existing;
  return generate(a, input, hash, userId);
}

/* one global limit on concurrent Claude calls, across every exam and examiner */
let active = 0;
const waiters: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>) {
  if (active >= aiConfig.concurrency) await new Promise<void>((r) => waiters.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

async function generate(a: AnswerWithCtx, input: GradeInput, hash: string, userId: string) {
  try {
    const r = await slot(() => suggestGrade(input));
    return await prisma.aiGradeSuggestion.create({
      data: {
        answerId: a.id,
        examId: a.attempt.examId,
        status: 'READY',
        model: r.model,
        score: r.suggestion.score,
        maxScore: input.maxMarks,
        confidence: r.suggestion.confidence,
        summary: r.suggestion.summary,
        criteria: r.suggestion.criteria,
        evidence: r.suggestion.evidence,
        feedbackDraft: r.suggestion.feedback,
        flags: r.suggestion.flags,
        inputHash: hash,
        requestedById: userId,
        latencyMs: r.latencyMs,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
      },
    });
  } catch (e) {
    return prisma.aiGradeSuggestion.create({ data: { answerId: a.id, examId: a.attempt.examId, status: 'FAILED', model: aiConfig.model, maxScore: input.maxMarks, error: aiErrorMessage(e), inputHash: hash, requestedById: userId } });
  }
}

/* ------------------------------------------------------------------ batch jobs (in-process) */
interface Job {
  examId: string;
  questionId: string | null;
  total: number;
  done: number;
  failed: number;
  startedAt: Date;
  finishedAt: Date | null;
  cancelled: boolean;
  lastError: string | null;
}
const jobs = new Map<string, Job>();

export function jobStatus(examId: string) {
  const j = jobs.get(examId);
  if (!j) return null;
  return { questionId: j.questionId, total: j.total, done: j.done, failed: j.failed, running: !j.finishedAt, cancelled: j.cancelled, startedAt: j.startedAt, finishedAt: j.finishedAt, lastError: j.lastError };
}

export function cancelJob(examId: string) {
  const j = jobs.get(examId);
  if (j && !j.finishedAt) j.cancelled = true;
}

/** Answers that would be sent in a batch (written, submitted, non-blank, not yet suggested for this exact input). */
export async function batchCandidates(examId: string, questionId: string | null, opts: { includeGraded: boolean; force: boolean }) {
  const answers = await prisma.answer.findMany({
    where: {
      attempt: { examId, isSandbox: false, status: { not: 'IN_PROGRESS' } },
      attemptQuestion: { questionVersion: { question: { type: 'WRITTEN', ...(questionId ? { id: questionId } : {}) } } },
      ...(opts.includeGraded ? {} : { manualScore: null }),
    },
    include: answerInclude,
  });
  const withText = answers.filter((a) => textOf(a));
  if (opts.force) return withText;
  const latest = await latestFor(withText.map((a) => a.id));
  return withText.filter((a) => {
    const s = latest.get(a.id);
    return !(s && s.status === 'READY' && s.inputHash === inputHash(inputOf(a)));
  });
}

export async function startBatch(examId: string, questionId: string | null, userId: string, opts: { includeGraded: boolean; force: boolean }) {
  if (!aiEnabled()) throw new AiInputError('The AI marking assistant is not configured (set ANTHROPIC_API_KEY).');
  const running = jobs.get(examId);
  if (running && !running.finishedAt) return { started: false, reason: 'already_running', status: jobStatus(examId) };
  // reserve the slot before any await, so two quick clicks can't start two paid batches
  const job: Job = { examId, questionId, total: 0, done: 0, failed: 0, startedAt: new Date(), finishedAt: null, cancelled: false, lastError: null };
  jobs.set(examId, job);
  let todo: AnswerWithCtx[];
  try {
    todo = (await batchCandidates(examId, questionId, opts)).slice(0, aiConfig.maxBatch);
  } catch (e) {
    jobs.delete(examId);
    throw e;
  }
  job.total = todo.length;
  if (!todo.length) job.finishedAt = new Date();
  else void runJob(job, todo, userId);
  return { started: todo.length > 0, queued: todo.length, reason: todo.length ? undefined : 'nothing_to_do', status: jobStatus(examId) };
}

async function runJob(job: Job, todo: AnswerWithCtx[], userId: string) {
  let i = 0;
  const worker = async () => {
    while (i < todo.length && !job.cancelled) {
      const a = todo[i++];
      const input = inputOf(a);
      const row = await generate(a, input, inputHash(input), userId).catch(() => null);
      job.done++;
      if (!row || row.status === 'FAILED') {
        job.failed++;
        job.lastError = row?.error ?? 'failed';
        // a bad key or exhausted rate limit will fail every request: stop early instead of burning through the list
        if (row?.error && /rejected|cannot use|not configured|rate-limited/i.test(row.error)) job.cancelled = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(aiConfig.concurrency, todo.length) }, worker));
  job.finishedAt = new Date();
}

/* ------------------------------------------------------------------ decisions */
/** Pair the examiner's saved mark with the latest suggestion for that answer (if any). */
export async function recordDecision(answerId: string, finalScore: number, userId: string) {
  const s = await prisma.aiGradeSuggestion.findFirst({ where: { answerId, status: 'READY' }, orderBy: { createdAt: 'desc' } });
  if (!s || s.score == null) return null;
  // only pair with a suggestion made for exactly this question/rubric/answer
  const a = await prisma.answer.findUnique({ where: { id: answerId }, include: answerInclude });
  if (!a || inputHash(inputOf(a)) !== s.inputHash) return null;
  const decision = Math.abs(finalScore - s.score) < 1e-6 ? 'ACCEPTED' : 'ADJUSTED';
  await prisma.aiGradeSuggestion.update({ where: { id: s.id }, data: { decision, finalScore, decidedById: userId, decidedAt: new Date() } });
  return { suggestionId: s.id, aiScore: s.score, decision };
}

/* ------------------------------------------------------------------ consistency */
const SIMILAR = 0.55;

/**
 * Flags (1) pairs of answers to the same question that read alike but received clearly different marks, and
 * (2) marks that differ a lot from the AI suggestion. Both are prompts to look again, not verdicts.
 */
export async function consistencyReport(examId: string) {
  const answers = await prisma.answer.findMany({
    where: { attempt: { examId, isSandbox: false, status: { not: 'IN_PROGRESS' } }, attemptQuestion: { questionVersion: { question: { type: 'WRITTEN' } } } },
    include: { attemptQuestion: { include: { questionVersion: { select: { questionId: true, body: true } } } } },
  });
  const graded = answers.filter((a) => (a.manualScore ?? a.autoScore) != null && textOf(a).split(/\s+/).length >= 6);
  const byQ = new Map<string, typeof graded>();
  for (const a of graded) {
    const k = a.attemptQuestion.questionVersion.questionId;
    byQ.set(k, [...(byQ.get(k) ?? []), a]);
  }
  const similarPairs: { questionId: string; a: string; b: string; similarity: number; scoreA: number; scoreB: number; marks: number }[] = [];
  for (const [questionId, all] of byQ) {
    const list = all.slice(0, 400); // pairwise check is O(n²): bound it so a huge exam can't stall the server
    const sh = list.map((a) => shingles(textOf(a)));
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const marks = list[i].attemptQuestion.marks;
        const sa = (list[i].manualScore ?? list[i].autoScore)!;
        const sb = (list[j].manualScore ?? list[j].autoScore)!;
        if (Math.abs(sa - sb) < Math.max(1, marks * 0.25)) continue;
        const sim = jaccard(sh[i], sh[j]);
        if (sim >= SIMILAR) similarPairs.push({ questionId, a: list[i].id, b: list[j].id, similarity: Math.round(sim * 100) / 100, scoreA: sa, scoreB: sb, marks });
      }
  }
  similarPairs.sort((x, y) => y.similarity - x.similarity);

  const latest = await latestFor(graded.map((a) => a.id));
  const disagreements: { questionId: string; answerId: string; aiScore: number; finalScore: number; marks: number }[] = [];
  let compared = 0;
  let agreed = 0;
  for (const a of graded) {
    const s = latest.get(a.id);
    if (!s || s.status !== 'READY' || s.score == null || a.manualScore == null) continue;
    compared++;
    const diff = Math.abs(a.manualScore - s.score);
    if (diff <= Math.max(0.5, a.attemptQuestion.marks * 0.1)) agreed++;
    if (diff >= Math.max(1, a.attemptQuestion.marks * 0.3)) disagreements.push({ questionId: a.attemptQuestion.questionVersion.questionId, answerId: a.id, aiScore: s.score, finalScore: a.manualScore, marks: a.attemptQuestion.marks });
  }
  // decisions counted on the latest suggestion per answer only (Redo doesn't inflate the numbers)
  const latestAll = await latestFor(answers.map((a) => a.id));
  const current = [...latestAll.values()].filter((s) => s.status === 'READY');
  return {
    similarPairs: similarPairs.slice(0, 50),
    disagreements: disagreements.sort((x, y) => Math.abs(y.finalScore - y.aiScore) - Math.abs(x.finalScore - x.aiScore)).slice(0, 50),
    stats: {
      gradedAnswers: graded.length,
      comparedWithAi: compared,
      agreementRate: compared ? Math.round((agreed / compared) * 100) : null,
      accepted: current.filter((s) => s.decision === 'ACCEPTED').length,
      adjusted: current.filter((s) => s.decision === 'ADJUSTED').length,
      undecided: current.filter((s) => s.decision === null).length,
    },
  };
}
