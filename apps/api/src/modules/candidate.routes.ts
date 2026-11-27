import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../core/prisma.js';
import { authenticate, currentUser, requireRole } from '../core/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../core/errors.js';
import { param, parseBody } from '../core/validate.js';
import { loadOwnAttempt } from '../core/policy.js';
import { examPhase, readSettings } from '../domain/examPhase.js';
import { finalizeAttempt, gradeAttempt, startAttempt } from '../services/attempts.service.js';
import { recordEvents } from '../services/integrity.service.js';
import { emitToMonitors } from '../core/realtime.js';
import { audit } from '../core/audit.js';
import { notify } from '../core/notify.js';
import { finalAnswerScore } from '../domain/marking.js';

export const candidateRouter = Router();
candidateRouter.use(authenticate);

const OFFLINE_MERGE_WINDOW_MS = 10 * 60_000;
const GAP_THRESHOLD_MS = 30_000;

/* ---------------------------------- dashboard ---------------------------------- */

candidateRouter.get('/exams', requireRole('CANDIDATE'), async (req, res) => {
  const me = currentUser(req);
  const now = new Date();
  const enrollments = await prisma.enrollment.findMany({
    where: { candidateId: me.id, exam: { status: { not: 'DRAFT' } } },
    include: { exam: { include: { owner: { select: { name: true } } } } },
  });
  const attempts = await prisma.attempt.findMany({ where: { candidateId: me.id, isSandbox: false } });
  const byExam = new Map(attempts.map((a) => [a.examId, a]));
  const items = enrollments
    .filter((e) => e.exam.status !== 'ARCHIVED' || byExam.has(e.examId))
    .map(({ exam, extraTimePct }) => {
      const a = byExam.get(exam.id);
      const phase = examPhase(exam, now);
      const finished = a && a.status !== 'IN_PROGRESS';
      const category = finished || phase === 'COMPLETED' || phase === 'ARCHIVED' ? 'completed' : phase === 'ONGOING' ? 'available' : 'upcoming';
      return {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        examiner: exam.owner.name,
        windowStart: exam.windowStart,
        windowEnd: exam.windowEnd,
        durationMin: exam.durationMin,
        extraTimePct,
        totalMarks: exam.totalMarks,
        phase,
        paused: !!exam.pausedAt,
        category,
        requiresAccessCode: !!exam.accessCode,
        attempt: a ? { id: a.id, status: a.status, startedAt: a.startedAt, deadline: a.deadline, submittedAt: a.submittedAt } : null,
        resultsPublished: !!exam.resultsPublishedAt,
        score: exam.resultsPublishedAt && a ? a.score : null,
      };
    })
    .sort((x, y) => new Date(x.windowStart).getTime() - new Date(y.windowStart).getTime());
  res.json({ serverNow: now, items });
});

candidateRouter.get('/exams/:id', requireRole('CANDIDATE'), async (req, res) => {
  const me = currentUser(req);
  const examId = param(req, 'id');
  const enrollment = await prisma.enrollment.findUnique({ where: { examId_candidateId: { examId, candidateId: me.id } }, include: { exam: { include: { owner: { select: { name: true } } } } } });
  if (!enrollment || enrollment.exam.status === 'DRAFT') throw notFound('Exam not found');
  const exam = enrollment.exam;
  const attempt = await prisma.attempt.findUnique({ where: { examId_candidateId_isSandbox: { examId, candidateId: me.id, isSandbox: false } }, include: { compensations: { orderBy: { createdAt: 'desc' }, take: 1 } } });
  const s = readSettings(exam.settings);
  const questionCount = exam.mode === 'BLUEPRINT' ? ((exam.blueprint as { count: number }[]) ?? []).reduce((a, b) => a + b.count, 0) : await prisma.examQuestion.count({ where: { examId } });
  res.json({
    serverNow: new Date(),
    exam: {
      id: exam.id, title: exam.title, description: exam.description, instructions: exam.instructions, examiner: exam.owner.name,
      windowStart: exam.windowStart, windowEnd: exam.windowEnd, durationMin: exam.durationMin, totalMarks: exam.totalMarks, passMarks: exam.passMarks,
      phase: examPhase(exam), paused: !!exam.pausedAt, requiresAccessCode: !!exam.accessCode, questionCount, extraTimePct: enrollment.extraTimePct,
      rules: { requireFullscreen: s.requireFullscreen, maxViolations: s.maxViolations, allowBackNav: s.allowBackNav, lateJoinMin: s.lateJoinMin },
      resultsPublished: !!exam.resultsPublishedAt,
    },
    attempt: attempt ? { id: attempt.id, status: attempt.status, deadline: attempt.deadline, submittedAt: attempt.submittedAt, compensation: attempt.compensations[0] ?? null } : null,
  });
});

/* ----------------------------------- attempts ----------------------------------- */

const sessionId = (req: Request) => {
  const s = req.header('x-session-id');
  if (!s || s.length < 8 || s.length > 100) throw badRequest('Missing exam session id');
  return s;
};

candidateRouter.post('/exams/:id/start', async (req, res) => {
  const me = currentUser(req);
  const body = parseBody(z.object({ accessCode: z.string().max(50).optional(), sandbox: z.boolean().default(false) }), req);
  const examId = param(req, 'id');
  if (body.sandbox) {
    if (me.role === 'CANDIDATE') throw forbidden('Sandbox mode is only available to examiners');
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam || (me.role !== 'ADMIN' && exam.ownerId !== me.id)) throw forbidden();
  } else if (me.role !== 'CANDIDATE') throw forbidden('Only candidates can take examinations. Use the sandbox to preview.');
  const { attempt, resumed } = await startAttempt({ examId, userId: me.id, sandbox: body.sandbox, sessionId: sessionId(req), accessCode: body.accessCode, ip: req.ip, ua: req.header('user-agent') });
  res.status(resumed ? 200 : 201).json({ attemptId: attempt.id, resumed });
});

async function ownActiveAttempt(req: Request) {
  const me = currentUser(req);
  const attempt = await loadOwnAttempt(me, param(req, 'id'));
  return attempt;
}

function assertSession(attempt: { activeSessionId: string | null }, req: Request) {
  if (attempt.activeSessionId !== sessionId(req)) throw conflict('This exam is open on another device', 'SESSION_LOCKED');
}

candidateRouter.get('/attempts/:id', async (req, res) => {
  const me = currentUser(req);
  const attempt = await ownActiveAttempt(req);
  if (attempt.status === 'IN_PROGRESS') assertSession(attempt, req);
  const aqs = await prisma.attemptQuestion.findMany({
    where: { attemptId: attempt.id },
    orderBy: { position: 'asc' },
    include: { questionVersion: { include: { question: { include: { topic: true } } } }, answer: true },
  });
  const s = readSettings(attempt.exam.settings);
  const announcements = await prisma.announcement.findMany({ where: { examId: attempt.examId, OR: [{ candidateId: null }, { candidateId: me.id }] }, orderBy: { createdAt: 'desc' }, take: 20 });
  const scratch = await prisma.scratchpad.findUnique({ where: { attemptId: attempt.id } });
  // NOTE: answer keys (questionVersion.correct, rubric) are deliberately never serialised to candidates
  res.json({
    serverNow: Date.now(),
    attempt: {
      id: attempt.id, status: attempt.status, isSandbox: attempt.isSandbox, startedAt: attempt.startedAt, deadline: attempt.deadline,
      violationCount: attempt.violationCount, lastSeq: attempt.lastSeq,
    },
    exam: {
      id: attempt.exam.id, title: attempt.exam.title, instructions: attempt.exam.instructions, totalMarks: attempt.maxScore, paused: !!attempt.exam.pausedAt,
      settings: { allowBackNav: s.allowBackNav, requireFullscreen: s.requireFullscreen && !attempt.isSandbox, maxViolations: attempt.isSandbox ? 0 : s.maxViolations },
    },
    candidate: { name: me.name, email: me.email },
    questions: aqs.map((aq) => {
      const opts = new Map((aq.questionVersion.options as { id: string; text: string }[]).map((o) => [o.id, o]));
      return {
        id: aq.id,
        position: aq.position,
        type: aq.questionVersion.question.type,
        topic: aq.questionVersion.question.topic.name,
        body: aq.questionVersion.body,
        marks: aq.marks,
        negativeMarks: aq.negativeMarks,
        multiScheme: aq.questionVersion.question.type === 'MULTI' ? aq.multiScheme : undefined,
        options: (aq.optionOrder as string[]).map((id) => opts.get(id)).filter(Boolean),
      };
    }),
    answers: Object.fromEntries(aqs.filter((a) => a.answer).map((aq) => [aq.id, { response: aq.answer!.response, flagged: aq.answer!.flagged, visited: aq.answer!.visited, timeSpentMs: aq.answer!.timeSpentMs, clientSeq: aq.answer!.clientSeq }])),
    announcements,
    scratchpad: scratch ? { canvas: scratch.canvas, notes: scratch.notes } : null,
  });
});

/** Records contact with the client. Detects connectivity gaps (> 30s of silence) for resilience evidence. */
async function registerContact(attempt: { id: string; examId: string; lastHeartbeatAt: Date | null; deadline: Date; isSandbox: boolean }) {
  const now = new Date();
  const last = attempt.lastHeartbeatAt ?? now;
  const gapMs = now.getTime() - last.getTime();
  await prisma.attempt.update({ where: { id: attempt.id }, data: { lastHeartbeatAt: now } });
  if (gapMs > GAP_THRESHOLD_MS) {
    const remainingAtGapStartSec = Math.max(0, Math.round((attempt.deadline.getTime() - last.getTime()) / 1000));
    await prisma.attemptEvent.create({ data: { attemptId: attempt.id, type: 'connectivity_gap', payload: { from: last.toISOString(), to: now.toISOString(), seconds: Math.round(gapMs / 1000), remainingAtGapStartSec } } });
    if (!attempt.isSandbox) emitToMonitors(attempt.examId, 'attempt:update', { attemptId: attempt.id });
    return { from: last, to: now, gapSec: Math.round(gapMs / 1000), remainingAtGapStartSec };
  }
  return null;
}

/**
 * Evidence-based compensation (Innovation 5.3):
 *  - network drop but candidate kept working offline (answers queued locally) → no time lost → no compensation
 *  - device/power failure (no local activity during the gap) → suggest exactly the lost time
 */
async function suggestCompensation(attempt: { id: string; examId: string; isSandbox: boolean; exam: { settings: unknown } }, gap: { from: Date; to: Date; gapSec: number; remainingAtGapStartSec: number }, offlineAnswers: number) {
  if (attempt.isSandbox || gap.gapSec < 60 || offlineAnswers > 0) return null;
  const live = await prisma.attempt.findUnique({ where: { id: attempt.id }, select: { status: true } });
  if (live?.status !== 'IN_PROGRESS') return null; // finalised attempts get their suggestion from the expiry sweeper
  const seconds = Math.min(gap.gapSec, gap.remainingAtGapStartSec, 30 * 60);
  if (seconds <= 0) return null;
  const s = readSettings(attempt.exam.settings);
  const comp = await prisma.timeCompensation.create({
    data: {
      attemptId: attempt.id,
      seconds,
      reason: 'Connection lost with no exam activity recorded on the device during the outage',
      evidence: { gapStart: gap.from, gapEnd: gap.to, gapSec: gap.gapSec, remainingAtGapStartSec: gap.remainingAtGapStartSec, offlineAnswers },
      status: s.autoCompensate ? 'APPROVED' : 'PENDING',
      decidedAt: s.autoCompensate ? new Date() : null,
    },
  });
  if (s.autoCompensate) {
    const a = await prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
    await prisma.attempt.update({ where: { id: attempt.id }, data: { deadline: new Date(a.deadline.getTime() + seconds * 1000), extraTimeSec: { increment: seconds } } });
  }
  emitToMonitors(attempt.examId, 'compensation:new', { attemptId: attempt.id, compensationId: comp.id });
  return comp;
}

const answerItem = z.object({
  questionId: z.string().min(1).max(64),
  response: z.union([z.array(z.string().max(10)).max(10), z.object({ text: z.string().max(20000) }), z.null()]).optional(),
  flagged: z.boolean().optional(),
  visited: z.boolean().optional(),
  timeSpentMs: z.number().int().min(0).max(24 * 3600_000).optional(),
  seq: z.number().int().min(1),
  offline: z.boolean().optional(),
  claimedAt: z.number().int().optional(), // server-time estimate from monotonic clock, only for offline items
});

/** Idempotent batched autosave. Each item carries a monotonically increasing client seq: stale/duplicate writes are ignored. */
candidateRouter.put('/attempts/:id/answers', async (req, res) => {
  const attempt = await ownActiveAttempt(req);
  const { items } = parseBody(z.object({ items: z.array(answerItem).min(1).max(200) }), req);
  const now = Date.now();
  const s = readSettings(attempt.exam.settings);
  const deadline = attempt.deadline.getTime();
  const inTime = attempt.status === 'IN_PROGRESS' && now <= deadline + s.gracePeriodSec * 1000;
  const inMergeWindow = (attempt.status === 'IN_PROGRESS' || attempt.status === 'AUTO_SUBMITTED') && now <= deadline + OFFLINE_MERGE_WINDOW_MS && !attempt.exam.resultsPublishedAt;

  if (attempt.status === 'IN_PROGRESS') assertSession(attempt, req);
  if (attempt.exam.pausedAt && attempt.status === 'IN_PROGRESS') throw conflict('Exam is paused — your answers are kept on this device and will sync when it resumes', 'EXAM_PAUSED');
  if (!inTime && !inMergeWindow) throw conflict('Time is over — answers can no longer be changed', 'TIME_OVER');

  const lastContact = attempt.lastHeartbeatAt?.getTime() ?? attempt.startedAt.getTime();
  const gap = await registerContact(attempt);

  const aqRows = await prisma.attemptQuestion.findMany({ where: { attemptId: attempt.id }, select: { id: true, position: true, answer: { select: { visited: true } } } });
  const aqIds = new Set(aqRows.map((x) => x.id));
  const positionOf = new Map(aqRows.map((x) => [x.id, x.position]));
  // "no going back": answers to questions before the furthest one already visited are frozen
  const furthestVisited = s.allowBackNav ? 0 : Math.max(0, ...aqRows.filter((x) => x.answer?.visited).map((x) => x.position));
  const accepted: { questionId: string; seq: number }[] = [];
  const rejected: { questionId: string; seq: number; reason: string }[] = [];
  let offlineAccepted = 0;
  let maxSeq = attempt.lastSeq;

  for (const it of items) {
    if (!aqIds.has(it.questionId)) {
      rejected.push({ questionId: it.questionId, seq: it.seq, reason: 'unknown_question' });
      continue;
    }
    if (!s.allowBackNav && it.response !== undefined && (positionOf.get(it.questionId) ?? 0) < furthestVisited) {
      const prev = await prisma.answer.findUnique({ where: { attemptQuestionId: it.questionId }, select: { response: true } });
      if (JSON.stringify(prev?.response ?? null) !== JSON.stringify(it.response)) {
        rejected.push({ questionId: it.questionId, seq: it.seq, reason: 'back_navigation_disabled' });
        continue;
      }
    }
    if (!inTime) {
      // late-arriving work is only accepted if it was provably produced offline before the deadline
      const valid = it.offline && it.claimedAt !== undefined && it.claimedAt <= deadline && it.claimedAt >= lastContact - 15_000 && it.claimedAt <= now;
      if (!valid) {
        rejected.push({ questionId: it.questionId, seq: it.seq, reason: 'after_deadline' });
        continue;
      }
    } else if (it.claimedAt !== undefined && it.claimedAt > deadline + s.gracePeriodSec * 1000) {
      rejected.push({ questionId: it.questionId, seq: it.seq, reason: 'after_deadline' });
      continue;
    }
    const existing = await prisma.answer.findUnique({ where: { attemptQuestionId: it.questionId } });
    if (existing && existing.clientSeq >= it.seq) {
      accepted.push({ questionId: it.questionId, seq: existing.clientSeq }); // duplicate/out-of-order retry: already applied
      continue;
    }
    const data: Prisma.AnswerUncheckedUpdateInput = { clientSeq: it.seq, savedAt: new Date() };
    if (it.response !== undefined) data.response = it.response === null ? (null as never) : (it.response as Prisma.InputJsonValue);
    if (it.flagged !== undefined) data.flagged = it.flagged;
    if (it.visited !== undefined) data.visited = it.visited;
    if (it.timeSpentMs !== undefined) data.timeSpentMs = it.timeSpentMs;
    await prisma.answer.upsert({
      where: { attemptQuestionId: it.questionId },
      update: data,
      create: { attemptId: attempt.id, attemptQuestionId: it.questionId, ...(data as object), response: (it.response ?? undefined) as Prisma.InputJsonValue },
    });
    accepted.push({ questionId: it.questionId, seq: it.seq });
    if (it.offline) offlineAccepted++;
    maxSeq = Math.max(maxSeq, it.seq);
  }
  await prisma.attempt.update({ where: { id: attempt.id }, data: { lastSeq: maxSeq } });
  if (offlineAccepted) await prisma.attemptEvent.create({ data: { attemptId: attempt.id, type: inTime ? 'offline_answers_synced' : 'offline_answers_merged_after_deadline', payload: { count: offlineAccepted } } });
  if (attempt.status === 'AUTO_SUBMITTED' && offlineAccepted) await prisma.$transaction((tx) => gradeAttempt(tx, attempt.id));
  if (gap) await suggestCompensation(attempt, gap, offlineAccepted);
  if (!attempt.isSandbox) emitToMonitors(attempt.examId, 'attempt:progress', { attemptId: attempt.id });
  res.json({ serverNow: Date.now(), deadline: attempt.deadline, accepted, rejected });
});

candidateRouter.post('/attempts/:id/heartbeat', async (req, res) => {
  const attempt = await ownActiveAttempt(req);
  if (attempt.status !== 'IN_PROGRESS') return res.json({ serverNow: Date.now(), status: attempt.status, deadline: attempt.deadline });
  assertSession(attempt, req);
  const body = parseBody(z.object({ currentQuestion: z.number().int().min(0).max(1000).optional(), answered: z.number().int().min(0).max(1000).optional(), online: z.boolean().optional() }), req);
  const gap = await registerContact(attempt);
  if (gap) await suggestCompensation(attempt, gap, 0);
  const fresh = await prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id }, include: { exam: { select: { pausedAt: true } } } });
  if (!attempt.isSandbox) emitToMonitors(attempt.examId, 'attempt:heartbeat', { attemptId: attempt.id, currentQuestion: body.currentQuestion, answered: body.answered, at: Date.now() });
  res.json({ serverNow: Date.now(), status: fresh.status, deadline: fresh.deadline, paused: !!fresh.exam.pausedAt });
});

candidateRouter.post('/attempts/:id/events', async (req, res) => {
  const attempt = await ownActiveAttempt(req);
  if (attempt.status !== 'IN_PROGRESS') return res.json({ ok: true });
  assertSession(attempt, req);
  const { events } = parseBody(z.object({ events: z.array(z.object({ type: z.string().max(40), at: z.number().optional(), details: z.string().max(500).optional() })).min(1).max(50) }), req);
  const r = await recordEvents(attempt, events);
  if (r.limitReached && !attempt.isSandbox) {
    await finalizeAttempt(attempt.id, 'FORCE_SUBMITTED', 'integrity_violation_limit');
    await prisma.incident.create({ data: { attemptId: attempt.id, type: 'AUTO_SUBMIT_VIOLATIONS', severity: 'HIGH', details: `Attempt auto-submitted after reaching ${r.maxViolations} integrity warnings` } });
    return res.json({ ...r, submitted: true });
  }
  res.json({ ...r, submitted: false });
});

candidateRouter.put('/attempts/:id/scratchpad', async (req, res) => {
  const attempt = await ownActiveAttempt(req);
  if (attempt.status !== 'IN_PROGRESS') throw conflict('Attempt is closed', 'TIME_OVER');
  assertSession(attempt, req);
  const body = parseBody(z.object({ canvas: z.string().max(3_000_000).optional(), notes: z.string().max(50000).optional() }), req);
  if (body.canvas && !body.canvas.startsWith('data:image/png;base64,')) throw badRequest('Invalid scratchpad image');
  await prisma.scratchpad.upsert({ where: { attemptId: attempt.id }, update: body, create: { attemptId: attempt.id, ...body } });
  res.json({ ok: true, savedAt: Date.now() });
});

candidateRouter.post('/attempts/:id/submit', async (req, res) => {
  const attempt = await ownActiveAttempt(req);
  const { idempotencyKey } = parseBody(z.object({ idempotencyKey: z.string().min(8).max(100) }), req);
  if (attempt.status !== 'IN_PROGRESS') {
    if (attempt.submitKey === idempotencyKey || attempt.status !== 'SUBMITTED') return res.json({ status: attempt.status, alreadySubmitted: true });
    throw conflict('This attempt has already been submitted', 'ALREADY_SUBMITTED');
  }
  assertSession(attempt, req);
  const result = await finalizeAttempt(attempt.id, 'SUBMITTED', 'candidate_submitted', idempotencyKey);
  const fresh = result ?? (await prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } }));
  res.json({ status: fresh.status, alreadySubmitted: !result, isSandbox: fresh.isSandbox, score: fresh.isSandbox ? fresh.score : undefined, maxScore: fresh.isSandbox ? fresh.maxScore : undefined });
});

/* ------------------------------------ results ----------------------------------- */

candidateRouter.get('/results', requireRole('CANDIDATE'), async (req, res) => {
  const me = currentUser(req);
  const attempts = await prisma.attempt.findMany({
    where: { candidateId: me.id, isSandbox: false, exam: { resultsPublishedAt: { not: null } } },
    include: { exam: { select: { id: true, title: true, totalMarks: true, passMarks: true, resultsPublishedAt: true } }, certificate: { select: { code: true } } },
    orderBy: { submittedAt: 'desc' },
  });
  res.json(attempts.map((a) => ({ attemptId: a.id, exam: a.exam, score: a.score, maxScore: a.maxScore, passed: (a.score ?? 0) >= a.exam.passMarks, submittedAt: a.submittedAt, certificateCode: a.certificate?.code })));
});

candidateRouter.get('/attempts/:id/result', requireRole('CANDIDATE'), async (req, res) => {
  const me = currentUser(req);
  const attempt = await loadOwnAttempt(me, param(req, 'id'));
  if (!attempt.exam.resultsPublishedAt || attempt.isSandbox) throw forbidden('Results for this examination have not been published yet');
  const s = readSettings(attempt.exam.settings);
  const aqs = await prisma.attemptQuestion.findMany({ where: { attemptId: attempt.id }, orderBy: { position: 'asc' }, include: { questionVersion: { include: { question: { include: { topic: true } } } }, answer: true, disputes: true } });
  const all = await prisma.attempt.findMany({ where: { examId: attempt.examId, isSandbox: false, status: { not: 'IN_PROGRESS' } }, select: { score: true } });
  const scores = all.map((a) => a.score ?? 0).sort((a, b) => b - a);
  const rank = scores.findIndex((x) => x <= (attempt.score ?? 0)) + 1;
  const topics: Record<string, { scored: number; max: number }> = {};
  aqs.forEach((aq) => {
    const t = aq.questionVersion.question.topic.name;
    topics[t] ??= { scored: 0, max: 0 };
    topics[t].scored += aq.answer ? finalAnswerScore(aq.answer) : 0;
    topics[t].max += aq.marks;
  });
  const cert = await prisma.certificate.findUnique({ where: { attemptId: attempt.id } });
  const disputes = await prisma.dispute.findMany({ where: { attemptId: attempt.id }, orderBy: { createdAt: 'desc' } });
  res.json({
    exam: { id: attempt.exam.id, title: attempt.exam.title, passMarks: attempt.exam.passMarks, publishedAt: attempt.exam.resultsPublishedAt },
    attempt: { id: attempt.id, score: attempt.score, maxScore: attempt.maxScore, status: attempt.status, submittedAt: attempt.submittedAt, startedAt: attempt.startedAt },
    passed: (attempt.score ?? 0) >= attempt.exam.passMarks,
    rank,
    totalCandidates: scores.length,
    percentile: scores.length ? Math.round(((scores.length - rank) / scores.length) * 100) : null,
    topics: Object.entries(topics).map(([name, v]) => ({ name, ...v, pct: v.max ? Math.round((v.scored / v.max) * 100) : 0 })),
    certificateCode: cert?.code,
    disputes,
    questions: aqs.map((aq) => {
      const v = aq.questionVersion;
      return {
        id: aq.id,
        position: aq.position,
        type: v.question.type,
        topic: v.question.topic.name,
        body: v.body,
        options: (aq.optionOrder as string[]).map((id) => (v.options as { id: string; text: string }[]).find((o) => o.id === id)),
        marks: aq.marks,
        response: aq.answer?.response ?? null,
        score: aq.answer ? finalAnswerScore(aq.answer) : 0,
        feedback: aq.answer?.feedback ?? null,
        voided: aq.voided,
        correct: s.showCorrectAnswers ? ((aq.correctOverride ?? v.correct) as string[]) : undefined,
      };
    }),
  });
});

/* ------------------------------------ disputes ---------------------------------- */

candidateRouter.post('/attempts/:id/disputes', requireRole('CANDIDATE'), async (req, res) => {
  const me = currentUser(req);
  const attempt = await loadOwnAttempt(me, param(req, 'id'));
  if (!attempt.exam.resultsPublishedAt) throw forbidden('You can raise disputes once results are published');
  const body = parseBody(
    z.object({ questionId: z.string().optional().nullable(), category: z.enum(['GRADING_ERROR', 'AMBIGUOUS_QUESTION', 'TECHNICAL_ISSUE', 'OTHER']), message: z.string().trim().min(20, 'Please explain the issue in at least 20 characters').max(3000) }),
    req,
  );
  const windowDays = 7;
  if (Date.now() - attempt.exam.resultsPublishedAt.getTime() > windowDays * 86400_000) throw forbidden(`The ${windowDays}-day dispute window has closed`);
  if (body.questionId) {
    const aq = await prisma.attemptQuestion.findFirst({ where: { id: body.questionId, attemptId: attempt.id } });
    if (!aq) throw badRequest('Question does not belong to this attempt');
  }
  const open = await prisma.dispute.findFirst({ where: { attemptId: attempt.id, attemptQuestionId: body.questionId ?? null, status: { in: ['OPEN', 'UNDER_REVIEW'] } } });
  if (open) throw conflict('You already have an open dispute for this item');
  const d = await prisma.dispute.create({ data: { attemptId: attempt.id, attemptQuestionId: body.questionId ?? null, raisedById: me.id, category: body.category, message: body.message, scoreBefore: attempt.score } });
  audit(me.id, 'dispute.open', 'Dispute', d.id, { attemptId: attempt.id, category: body.category });
  await notify([attempt.exam.ownerId], 'New result dispute', `${me.name} raised a dispute on ${attempt.exam.title}`, `/examiner/disputes`);
  res.status(201).json(d);
});

candidateRouter.get('/disputes', requireRole('CANDIDATE'), async (req, res) => {
  const me = currentUser(req);
  const items = await prisma.dispute.findMany({ where: { raisedById: me.id }, orderBy: { createdAt: 'desc' }, include: { attempt: { select: { exam: { select: { title: true } } } }, attemptQuestion: { select: { position: true } } } });
  const logs = await prisma.auditLog.findMany({ where: { entity: 'Dispute', entityId: { in: items.map((i) => i.id) } }, orderBy: { seq: 'asc' } });
  res.json(items.map((d) => ({ ...d, timeline: logs.filter((l) => l.entityId === d.id).map((l) => ({ action: l.action, at: l.createdAt, data: l.data })) })));
});

/* --------------------------------- notifications -------------------------------- */

candidateRouter.get('/notifications', async (req, res) => {
  const me = currentUser(req);
  const items = await prisma.notification.findMany({ where: { userId: me.id }, orderBy: { createdAt: 'desc' }, take: 30 });
  res.json({ items, unread: items.filter((n) => !n.read).length });
});
candidateRouter.post('/notifications/read', async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: currentUser(req).id, read: false }, data: { read: true } });
  res.json({ ok: true });
});
