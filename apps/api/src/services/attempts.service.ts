import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../core/prisma.js';
import { badRequest, conflict, forbidden } from '../core/errors.js';
import { autoMark, type QType, type Scheme } from '../domain/marking.js';
import { computeDeadline, examPhase, readSettings } from '../domain/examPhase.js';
import { easiness, generateFairPaper, paperDifficulty, type PoolQuestion, type Slot } from '../domain/fairness.js';
import { rng, shuffle } from '../domain/random.js';
import { emitToMonitors, emitToUser } from '../core/realtime.js';
import { audit } from '../core/audit.js';

type Tx = Prisma.TransactionClient;

/** Build the frozen question list for a new attempt (fixed list or fair blueprint). */
export async function buildPaper(tx: Tx, exam: { id: string; ownerId: string; mode: string; blueprint: unknown; settings: unknown }, seed: string) {
  const settings = readSettings(exam.settings);
  const rand = rng(seed);

  if (exam.mode === 'BLUEPRINT') {
    const slots = (exam.blueprint as Slot[] | null) ?? [];
    const questions = await tx.question.findMany({
      where: { archived: false, ownerId: exam.ownerId, OR: slots.map((s) => ({ topicId: s.topicId, difficulty: s.difficulty as 'EASY' })) },
      include: { versions: true },
    });
    const pool: PoolQuestion[] = questions.map((q) => ({ id: q.id, topicId: q.topicId, difficulty: q.difficulty, p: easiness(q) }));
    // usage of each question in papers already issued for this exam -> drives variation
    const issued = await tx.attemptQuestion.findMany({ where: { attempt: { examId: exam.id, isSandbox: false } }, select: { questionVersion: { select: { questionId: true } } } });
    const usage = new Map<string, number>();
    issued.forEach((i) => usage.set(i.questionVersion.questionId, (usage.get(i.questionVersion.questionId) ?? 0) + 1));
    const { picks, difficulty } = generateFairPaper(pool, slots, seed, usage);
    const byId = new Map(questions.map((q) => [q.id, q]));
    const ordered = settings.shuffleQuestions ? shuffle(picks, rand) : picks;
    return {
      difficulty,
      items: ordered.map((p) => {
        const q = byId.get(p.q.id)!;
        const v = q.versions.find((x) => x.version === q.currentVersion)!;
        return { q, v, marks: p.marks, negativeMarks: Math.min(v.negativeMarks, p.marks) };
      }),
    };
  }

  const eqs = await tx.examQuestion.findMany({ where: { examId: exam.id }, orderBy: { position: 'asc' }, include: { question: { include: { versions: true } } } });
  const items = eqs.map((eq) => {
    const v = eq.question.versions.find((x) => x.version === eq.question.currentVersion)!;
    return { q: eq.question, v, marks: v.marks, negativeMarks: v.negativeMarks };
  });
  const ordered = settings.shuffleQuestions ? shuffle(items, rand) : items;
  return { difficulty: paperDifficulty(ordered.map((i) => ({ p: easiness(i.q), marks: i.marks }))), items: ordered };
}

export async function startAttempt(opts: { examId: string; userId: string; sandbox: boolean; sessionId: string; accessCode?: string; ip?: string; ua?: string }) {
  const exam = await prisma.exam.findUnique({ where: { id: opts.examId } });
  if (!exam) throw badRequest('Exam not found');
  const settings = readSettings(exam.settings);
  const now = new Date();
  let extraPct = 0;

  if (!opts.sandbox) {
    const enrollment = await prisma.enrollment.findUnique({ where: { examId_candidateId: { examId: exam.id, candidateId: opts.userId } } });
    if (!enrollment) throw forbidden('You are not enrolled in this examination');
    extraPct = enrollment.extraTimePct;
    const existing = await prisma.attempt.findUnique({ where: { examId_candidateId_isSandbox: { examId: exam.id, candidateId: opts.userId, isSandbox: false } } });
    if (existing) return resumeAttempt(existing, opts);
    const phase = examPhase(exam, now);
    if (phase === 'DRAFT' || phase === 'ARCHIVED') throw forbidden('This examination is not available');
    if (phase === 'PUBLISHED') throw forbidden(`This examination opens at ${exam.windowStart.toISOString()}`);
    if (phase === 'COMPLETED') throw forbidden('The availability window for this examination has closed');
    if (exam.pausedAt) throw conflict('The examination is paused by the examiner. Please wait.', 'EXAM_PAUSED');
    if (settings.lateJoinMin > 0 && now.getTime() > exam.windowStart.getTime() + settings.lateJoinMin * 60000) throw forbidden(`Late entry closed ${settings.lateJoinMin} minutes after the exam started`);
    if (exam.accessCode && exam.accessCode !== (opts.accessCode ?? '').trim()) throw forbidden('Incorrect access code');
  } else {
    // a fresh sandbox each time; never touches real data
    await prisma.attempt.deleteMany({ where: { examId: exam.id, candidateId: opts.userId, isSandbox: true } });
  }

  const seed = crypto.randomUUID();
  const attempt = await prisma.$transaction(async (tx) => {
    const paper = await buildPaper(tx, exam, seed);
    if (!paper.items.length) throw badRequest('This examination has no questions yet');
    const deadline = opts.sandbox ? new Date(now.getTime() + exam.durationMin * 60000) : computeDeadline(now, exam.durationMin, extraPct, exam.windowEnd);
    const rand = rng(seed + ':opts');
    return tx.attempt.create({
      data: {
        examId: exam.id,
        candidateId: opts.userId,
        isSandbox: opts.sandbox,
        startedAt: now,
        deadline,
        maxScore: paper.items.reduce((s, i) => s + i.marks, 0),
        paperDifficulty: paper.difficulty,
        activeSessionId: opts.sessionId,
        lastHeartbeatAt: now,
        ipAddress: opts.ip,
        userAgent: opts.ua?.slice(0, 300),
        questions: {
          create: paper.items.map((it, idx) => {
            const ids = (it.v.options as { id: string }[]).map((o) => o.id);
            return {
              position: idx + 1,
              questionVersionId: it.v.id,
              optionOrder: settings.shuffleOptions ? shuffle(ids, rand) : ids,
              marks: it.marks,
              negativeMarks: it.negativeMarks,
              multiScheme: it.v.multiScheme,
            };
          }),
        },
        events: { create: { type: 'attempt_started', payload: { seed, ip: opts.ip, ua: opts.ua?.slice(0, 200), sandbox: opts.sandbox } } },
      },
    });
  });
  if (!opts.sandbox) {
    emitToMonitors(exam.id, 'attempt:update', { attemptId: attempt.id });
    audit(opts.userId, 'attempt.start', 'Attempt', attempt.id, { examId: exam.id });
  }
  return { attempt, resumed: false };
}

/** Single-device binding: a second device needs the examiner's approval unless the first has gone silent. */
async function resumeAttempt(existing: Prisma.AttemptGetPayload<object>, opts: { sessionId: string; ip?: string; ua?: string }) {
  if (existing.status !== 'IN_PROGRESS') throw conflict('You have already submitted this examination', 'ALREADY_SUBMITTED');
  if (existing.activeSessionId === opts.sessionId) return { attempt: existing, resumed: true };
  // no device bound (e.g. attempt reopened after an approved outage compensation): bind this one
  if (!existing.activeSessionId) {
    const attempt = await prisma.attempt.update({ where: { id: existing.id }, data: { activeSessionId: opts.sessionId, lastHeartbeatAt: new Date() } });
    await prisma.attemptEvent.create({ data: { attemptId: existing.id, type: 'device_bound', payload: { ip: opts.ip, ua: opts.ua?.slice(0, 200) } } });
    return { attempt, resumed: true };
  }

  const silentFor = Date.now() - (existing.lastHeartbeatAt?.getTime() ?? 0);
  const approved = await prisma.sessionTransfer.findFirst({ where: { attemptId: existing.id, sessionId: opts.sessionId, status: 'APPROVED' } });
  if (approved || silentFor > 90_000) {
    const attempt = await prisma.attempt.update({ where: { id: existing.id }, data: { activeSessionId: opts.sessionId, lastHeartbeatAt: new Date() } });
    await prisma.attemptEvent.create({ data: { attemptId: existing.id, type: 'device_switched', payload: { ip: opts.ip, ua: opts.ua?.slice(0, 200), auto: !approved, silentForSec: Math.round(silentFor / 1000) } } });
    await prisma.incident.create({ data: { attemptId: existing.id, type: 'DEVICE_SWITCH', severity: 'LOW', details: approved ? 'Resumed on a new device after examiner approval' : `Resumed on a new device after previous device was silent for ${Math.round(silentFor / 1000)}s` } });
    emitToMonitors(existing.examId, 'attempt:update', { attemptId: existing.id });
    return { attempt, resumed: true };
  }
  const pending = await prisma.sessionTransfer.findFirst({ where: { attemptId: existing.id, sessionId: opts.sessionId, status: 'PENDING' } });
  const transfer = pending ?? (await prisma.sessionTransfer.create({ data: { attemptId: existing.id, sessionId: opts.sessionId, ipAddress: opts.ip, userAgent: opts.ua?.slice(0, 300) } }));
  if (!pending) {
    await prisma.incident.create({ data: { attemptId: existing.id, type: 'CONCURRENT_LOGIN', severity: 'MEDIUM', details: 'Attempted to open the exam on a second device while the first is still active' } });
    emitToMonitors(existing.examId, 'transfer:new', { attemptId: existing.id, transferId: transfer.id });
  }
  throw conflict('This exam is already open on another device. Ask your examiner to approve the switch, or close the other device.', 'SESSION_LOCKED');
}

export function correctFor(aq: { correctOverride: unknown; questionVersion: { correct: unknown } }) {
  return ((aq.correctOverride ?? aq.questionVersion.correct) as string[]) ?? [];
}

/** (Re)compute auto scores and totals. Safe to call repeatedly — used on submit, regrade and dispute resolution. */
export async function gradeAttempt(tx: Tx, attemptId: string) {
  const aqs = await tx.attemptQuestion.findMany({ where: { attemptId }, include: { questionVersion: { include: { question: true } }, answer: true } });
  let score = 0;
  let pendingManual = 0;
  for (const aq of aqs) {
    const type = aq.questionVersion.question.type as QType;
    let auto: number | null;
    if (aq.voided) auto = aq.marks; // voided question: everybody gets full marks
    else
      auto = autoMark({ type, marks: aq.marks, negativeMarks: aq.negativeMarks, multiScheme: aq.multiScheme as Scheme, correct: correctFor(aq), response: aq.answer?.response ?? null });
    if (type === 'WRITTEN' && !aq.voided) {
      const text = (aq.answer?.response as { text?: string } | null)?.text?.trim();
      if (!text) auto = 0; // blank written answer needs no grader
    }
    if (aq.answer) await tx.answer.update({ where: { id: aq.answer.id }, data: { autoScore: auto } });
    else await tx.answer.create({ data: { attemptId, attemptQuestionId: aq.id, response: undefined, autoScore: auto } });
    const manual = aq.answer?.manualScore ?? null;
    if (auto === null && manual === null) pendingManual++;
    score += manual ?? auto ?? 0;
  }
  score = Math.max(0, Math.round(score * 100) / 100);
  return tx.attempt.update({ where: { id: attemptId }, data: { score, gradingStatus: pendingManual ? 'NEEDS_MANUAL' : 'GRADED' } });
}

/** Exactly-once finalisation: the conditional update means double-clicks, retries and the expiry sweeper can race safely. */
export async function finalizeAttempt(attemptId: string, status: 'SUBMITTED' | 'AUTO_SUBMITTED' | 'FORCE_SUBMITTED', reason: string, submitKey?: string) {
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.attempt.updateMany({ where: { id: attemptId, status: 'IN_PROGRESS' }, data: { status, submittedAt: new Date(), submitKey: submitKey ?? null } });
    if (updated.count === 0) return null;
    await tx.attemptEvent.create({ data: { attemptId, type: 'attempt_finalized', payload: { status, reason } } });
    return gradeAttempt(tx, attemptId);
  });
  if (result) {
    emitToMonitors(result.examId, 'attempt:update', { attemptId });
    emitToUser(result.candidateId, 'attempt:finalized', { attemptId, status, reason });
    if (!result.isSandbox) audit(result.candidateId, `attempt.${status.toLowerCase()}`, 'Attempt', attemptId, { reason, score: result.score });
  }
  return result;
}

/** Background sweeper: finalises attempts whose server deadline (+ network grace) passed, even if the tab is closed. */
export function startExpirySweeper() {
  const tick = async () => {
    try {
      const expired = await prisma.attempt.findMany({ where: { status: 'IN_PROGRESS', exam: { pausedAt: null } }, include: { exam: { select: { settings: true } } } });
      const now = Date.now();
      for (const a of expired) {
        const grace = readSettings(a.exam.settings).gracePeriodSec * 1000;
        if (a.deadline.getTime() + grace < now) {
          const done = await finalizeAttempt(a.id, 'AUTO_SUBMITTED', 'time_expired');
          // Candidate went silent before the deadline (power/device failure): suggest restoring the time they had left
          const last = a.lastHeartbeatAt?.getTime() ?? a.startedAt.getTime();
          if (done && !a.isSandbox && a.deadline.getTime() - last > 60_000) {
            const remaining = Math.round((a.deadline.getTime() - last) / 1000);
            await prisma.timeCompensation.create({
              data: {
                attemptId: a.id,
                seconds: Math.min(remaining, 30 * 60),
                reason: 'Candidate disconnected before the deadline and never came back online — attempt was auto-submitted',
                evidence: { gapStart: new Date(last), gapEnd: a.deadline, gapSec: remaining, remainingAtGapStartSec: remaining, offlineAnswers: 0, autoSubmitted: true },
              },
            });
            emitToMonitors(a.examId, 'compensation:new', { attemptId: a.id });
          }
        }
      }
    } catch (e) {
      console.error('sweeper', e);
    }
  };
  return setInterval(tick, 5000);
}

export async function recomputeExamTotals(examId: string) {
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId }, include: { questions: { include: { question: { include: { versions: true } } } } } });
  let total = 0;
  if (exam.mode === 'BLUEPRINT') total = ((exam.blueprint as Slot[] | null) ?? []).reduce((s, x) => s + x.count * x.marks, 0);
  else total = exam.questions.reduce((s, eq) => s + (eq.question.versions.find((v) => v.version === eq.question.currentVersion)?.marks ?? 0), 0);
  return prisma.exam.update({ where: { id: examId }, data: { totalMarks: Math.round(total * 100) / 100 } });
}
