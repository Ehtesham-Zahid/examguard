import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../core/prisma.js';
import { authenticate, currentUser, requireRole } from '../core/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../core/errors.js';
import { param, parseBody, parseQuery } from '../core/validate.js';
import { loadAttemptForStaff, loadExamForStaff } from '../core/policy.js';
import { examPhase, readSettings } from '../domain/examPhase.js';
import { finalAnswerScore, selectedIds, validateManualScore } from '../domain/marking.js';
import { PRIOR } from '../domain/fairness.js';
import { jaccard, shingles } from '../domain/similarity.js';
import { correctFor, finalizeAttempt, gradeAttempt } from '../services/attempts.service.js';
import { issueCertificate } from '../services/certificates.service.js';
import { audit } from '../core/audit.js';
import { emitToMonitors, emitToUser } from '../core/realtime.js';
import { notify } from '../core/notify.js';
import { SIGNALS } from '../services/integrity.service.js';

export const staffRouter = Router();
staffRouter.use(authenticate, requireRole('ADMIN', 'EXAMINER'));

/* ------------------------------------ monitoring --------------------------------- */

staffRouter.get('/exams/:id/monitor', async (req, res) => {
  const exam = await loadExamForStaff(currentUser(req), param(req, 'id'));
  const [attempts, enrollments, transfers, compensations, incidents] = await Promise.all([
    prisma.attempt.findMany({
      where: { examId: exam.id, isSandbox: false },
      include: { candidate: { select: { id: true, name: true, email: true } }, _count: { select: { questions: true, incidents: { where: { status: 'OPEN' } } } }, answers: { select: { response: true, flagged: true } } },
    }),
    prisma.enrollment.findMany({ where: { examId: exam.id }, include: { candidate: { select: { id: true, name: true, email: true } } } }),
    prisma.sessionTransfer.findMany({ where: { attempt: { examId: exam.id }, status: 'PENDING' }, include: { attempt: { select: { candidate: { select: { name: true } } } } } }),
    prisma.timeCompensation.findMany({ where: { attempt: { examId: exam.id }, status: 'PENDING' }, include: { attempt: { select: { candidate: { select: { name: true } }, status: true } } } }),
    prisma.incident.findMany({ where: { attempt: { examId: exam.id, isSandbox: false } }, orderBy: { createdAt: 'desc' }, take: 100, include: { attempt: { select: { candidate: { select: { name: true } } } } } }),
  ]);
  const now = Date.now();
  const answered = (r: unknown) => (Array.isArray(r) ? r.length > 0 : !!(r as { text?: string } | null)?.text?.trim());
  const started = new Set(attempts.map((a) => a.candidateId));
  res.json({
    serverNow: now,
    exam: { id: exam.id, title: exam.title, pausedAt: exam.pausedAt, windowStart: exam.windowStart, windowEnd: exam.windowEnd, status: exam.status },
    attempts: attempts.map((a) => {
      const silent = now - (a.lastHeartbeatAt?.getTime() ?? 0);
      return {
        id: a.id,
        candidate: a.candidate,
        status: a.status,
        startedAt: a.startedAt,
        deadline: a.deadline,
        submittedAt: a.submittedAt,
        total: a._count.questions,
        answered: a.answers.filter((x) => answered(x.response)).length,
        flagged: a.answers.filter((x) => x.flagged).length,
        connection: a.status !== 'IN_PROGRESS' ? 'done' : silent < 40_000 ? 'online' : silent < 120_000 ? 'unstable' : 'offline',
        lastSeenAt: a.lastHeartbeatAt,
        violations: a.violationCount,
        integrityScore: a.integrityScore,
        openIncidents: a._count.incidents,
        extraTimeSec: a.extraTimeSec,
      };
    }),
    notStarted: enrollments.filter((e) => !started.has(e.candidateId)).map((e) => e.candidate),
    transfers,
    compensations,
    incidents: incidents.map((i) => ({ ...i, label: SIGNALS[i.type]?.label ?? i.type, candidate: i.attempt.candidate.name, attempt: undefined })),
  });
});

staffRouter.get('/attempts/:id', async (req, res) => {
  const attempt = await loadAttemptForStaff(currentUser(req), param(req, 'id'));
  const [aqs, events, incidents, scratch, compensations, transfers, candidate, disputes] = await Promise.all([
    prisma.attemptQuestion.findMany({ where: { attemptId: attempt.id }, orderBy: { position: 'asc' }, include: { questionVersion: { include: { question: { include: { topic: true } } } }, answer: true } }),
    prisma.attemptEvent.findMany({ where: { attemptId: attempt.id }, orderBy: { createdAt: 'asc' }, take: 1000 }),
    prisma.incident.findMany({ where: { attemptId: attempt.id }, orderBy: { createdAt: 'asc' } }),
    prisma.scratchpad.findUnique({ where: { attemptId: attempt.id } }),
    prisma.timeCompensation.findMany({ where: { attemptId: attempt.id }, orderBy: { createdAt: 'desc' } }),
    prisma.sessionTransfer.findMany({ where: { attemptId: attempt.id }, orderBy: { createdAt: 'desc' } }),
    prisma.user.findUniqueOrThrow({ where: { id: attempt.candidateId }, select: { id: true, name: true, email: true, groupName: true } }),
    prisma.dispute.findMany({ where: { attemptId: attempt.id } }),
  ]);
  res.json({
    attempt: { ...attempt, submitKey: undefined, activeSessionId: undefined, exam: { id: attempt.exam.id, title: attempt.exam.title, passMarks: attempt.exam.passMarks, resultsPublishedAt: attempt.exam.resultsPublishedAt } },
    candidate,
    questions: aqs.map((aq) => ({
      id: aq.id,
      answerId: aq.answer?.id,
      position: aq.position,
      type: aq.questionVersion.question.type,
      topic: aq.questionVersion.question.topic.name,
      body: aq.questionVersion.body,
      options: aq.questionVersion.options,
      optionOrder: aq.optionOrder,
      correct: correctFor(aq),
      rubric: aq.questionVersion.rubric,
      marks: aq.marks,
      voided: aq.voided,
      response: aq.answer?.response ?? null,
      flagged: aq.answer?.flagged ?? false,
      timeSpentMs: aq.answer?.timeSpentMs ?? 0,
      autoScore: aq.answer?.autoScore ?? null,
      manualScore: aq.answer?.manualScore ?? null,
      feedback: aq.answer?.feedback ?? null,
      score: aq.answer ? finalAnswerScore(aq.answer) : 0,
    })),
    events,
    incidents: incidents.map((i) => ({ ...i, label: SIGNALS[i.type]?.label ?? i.type })),
    scratchpad: scratch,
    compensations,
    transfers,
    disputes,
  });
});

staffRouter.post('/attempts/:id/extend', async (req, res) => {
  const me = currentUser(req);
  const attempt = await loadAttemptForStaff(me, param(req, 'id'));
  const { minutes, reason } = parseBody(z.object({ minutes: z.number().int().min(1).max(120), reason: z.string().trim().min(3, 'A reason is required').max(300) }), req);
  if (attempt.status !== 'IN_PROGRESS') throw conflict('Only in-progress attempts can be extended');
  const updated = await prisma.attempt.update({ where: { id: attempt.id }, data: { deadline: new Date(attempt.deadline.getTime() + minutes * 60000), extraTimeSec: { increment: minutes * 60 } } });
  await prisma.attemptEvent.create({ data: { attemptId: attempt.id, type: 'time_extended', payload: { minutes, reason, by: me.name } } });
  emitToUser(attempt.candidateId, 'attempt:deadline', { attemptId: attempt.id, deadline: updated.deadline, message: `Your examiner added ${minutes} minute(s)` });
  audit(me.id, 'attempt.extend', 'Attempt', attempt.id, { minutes, reason });
  res.json({ deadline: updated.deadline });
});

staffRouter.post('/attempts/:id/force-submit', async (req, res) => {
  const me = currentUser(req);
  const attempt = await loadAttemptForStaff(me, param(req, 'id'));
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(3, 'A reason is required').max(300) }), req);
  const r = await finalizeAttempt(attempt.id, 'FORCE_SUBMITTED', `examiner: ${reason}`);
  if (!r) throw conflict('Attempt is already submitted');
  audit(me.id, 'attempt.force_submit', 'Attempt', attempt.id, { reason });
  res.json({ ok: true });
});

staffRouter.patch('/incidents/:id', async (req, res) => {
  const me = currentUser(req);
  const inc = await prisma.incident.findUnique({ where: { id: param(req, 'id') } });
  if (!inc) throw notFound();
  await loadAttemptForStaff(me, inc.attemptId);
  const body = parseBody(z.object({ status: z.enum(['REVIEWED', 'DISMISSED', 'ESCALATED', 'OPEN']), note: z.string().max(1000).optional() }), req);
  const updated = await prisma.incident.update({ where: { id: inc.id }, data: { status: body.status, reviewNote: body.note, reviewerId: me.id, reviewedAt: new Date() } });
  audit(me.id, `incident.${body.status.toLowerCase()}`, 'Incident', inc.id, { note: body.note });
  res.json(updated);
});

/** Approve/reject evidence-based compensation. If the attempt was auto-submitted during the outage it is reopened with exactly the time that remained. */
staffRouter.post('/compensations/:id/decide', async (req, res) => {
  const me = currentUser(req);
  const comp = await prisma.timeCompensation.findUnique({ where: { id: param(req, 'id') } });
  if (!comp) throw notFound();
  const attempt = await loadAttemptForStaff(me, comp.attemptId);
  const { approve, seconds } = parseBody(z.object({ approve: z.boolean(), seconds: z.number().int().min(1).max(3600).optional() }), req);
  const grant = seconds ?? comp.seconds;
  const claimed = await prisma.timeCompensation.updateMany({ where: { id: comp.id, status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: me.id, decidedAt: new Date(), seconds: grant } });
  if (claimed.count !== 1) throw conflict('Already decided');
  if (approve) await prisma.timeCompensation.updateMany({ where: { attemptId: attempt.id, status: 'PENDING' }, data: { status: 'REJECTED', decidedById: me.id, decidedAt: new Date() } }); // duplicates for the same outage
  let reopened = false;
  if (approve) {
    if (attempt.status === 'IN_PROGRESS') {
      const d = await prisma.attempt.update({ where: { id: attempt.id }, data: { deadline: new Date(attempt.deadline.getTime() + grant * 1000), extraTimeSec: { increment: grant } } });
      emitToUser(attempt.candidateId, 'attempt:deadline', { attemptId: attempt.id, deadline: d.deadline, message: `Time restored after a connection problem: +${Math.round(grant / 60)} min` });
    } else if (attempt.status === 'AUTO_SUBMITTED' && !attempt.exam.resultsPublishedAt) {
      await prisma.attempt.update({ where: { id: attempt.id }, data: { status: 'IN_PROGRESS', submittedAt: null, deadline: new Date(Date.now() + grant * 1000), extraTimeSec: { increment: grant }, activeSessionId: null, lastHeartbeatAt: new Date() } });
      await prisma.attemptEvent.create({ data: { attemptId: attempt.id, type: 'attempt_reopened', payload: { seconds: grant, by: me.name } } });
      await notify([attempt.candidateId], 'Your exam has been reopened', `You have ${Math.round(grant / 60)} minute(s) remaining — the time you lost during the outage.`, `/candidate/exams/${attempt.examId}`);
      reopened = true;
    }
  }
  emitToMonitors(attempt.examId, 'attempt:update', { attemptId: attempt.id });
  audit(me.id, approve ? 'compensation.approve' : 'compensation.reject', 'Attempt', attempt.id, { seconds: grant, reopened });
  res.json({ ok: true, reopened });
});

staffRouter.post('/transfers/:id/decide', async (req, res) => {
  const me = currentUser(req);
  const t = await prisma.sessionTransfer.findUnique({ where: { id: param(req, 'id') } });
  if (!t) throw notFound();
  const attempt = await loadAttemptForStaff(me, t.attemptId);
  const { approve } = parseBody(z.object({ approve: z.boolean() }), req);
  if (t.status !== 'PENDING') throw conflict('This request has already been decided');
  if (approve && attempt.status !== 'IN_PROGRESS') throw conflict('The attempt is no longer in progress — the switch is no longer needed');
  await prisma.sessionTransfer.update({ where: { id: t.id }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: me.id, decidedAt: new Date() } });
  if (approve) {
    await prisma.attempt.update({ where: { id: attempt.id }, data: { activeSessionId: t.sessionId } });
    emitToUser(attempt.candidateId, 'session:transferred', { attemptId: attempt.id, sessionId: t.sessionId });
  }
  audit(me.id, approve ? 'transfer.approve' : 'transfer.reject', 'Attempt', attempt.id);
  res.json({ ok: true });
});

/* ------------------------------------- grading ----------------------------------- */

staffRouter.get('/exams/:id/grading', async (req, res) => {
  const exam = await loadExamForStaff(currentUser(req), param(req, 'id'));
  const { anonymous } = parseQuery(z.object({ anonymous: z.enum(['true', 'false']).default('true') }), req);
  const aqs = await prisma.attemptQuestion.findMany({
    where: { attempt: { examId: exam.id, isSandbox: false, status: { not: 'IN_PROGRESS' } }, questionVersion: { question: { type: 'WRITTEN' } } },
    include: { answer: true, attempt: { select: { id: true, candidate: { select: { name: true, email: true } } } }, questionVersion: { include: { question: true } } },
    orderBy: { position: 'asc' },
  });
  const anonIds = new Map<string, number>();
  const groups = new Map<string, { questionId: string; body: string; rubric: string | null; marks: number; items: unknown[] }>();
  for (const aq of aqs) {
    const qid = aq.questionVersion.questionId;
    if (!anonIds.has(aq.attempt.id)) anonIds.set(aq.attempt.id, anonIds.size + 1);
    if (!groups.has(qid)) groups.set(qid, { questionId: qid, body: aq.questionVersion.body, rubric: aq.questionVersion.rubric, marks: aq.marks, items: [] });
    groups.get(qid)!.items.push({
      answerId: aq.answer?.id,
      attemptId: aq.attempt.id,
      candidate: anonymous === 'true' ? `Candidate #${String(anonIds.get(aq.attempt.id)).padStart(3, '0')}` : aq.attempt.candidate.name,
      text: (aq.answer?.response as { text?: string } | null)?.text ?? '',
      marks: aq.marks,
      manualScore: aq.answer?.manualScore ?? null,
      autoScore: aq.answer?.autoScore ?? null,
      feedback: aq.answer?.feedback ?? '',
      graded: aq.answer?.manualScore != null || aq.answer?.autoScore != null,
    });
  }
  const list = [...groups.values()];
  const total = list.reduce((s, g) => s + g.items.length, 0);
  const done = list.reduce((s, g) => s + (g.items as { graded: boolean }[]).filter((i) => i.graded).length, 0);
  res.json({ groups: list, progress: { total, done } });
});

staffRouter.put('/answers/:id/grade', async (req, res) => {
  const me = currentUser(req);
  const answer = await prisma.answer.findUnique({ where: { id: param(req, 'id') }, include: { attemptQuestion: true } });
  if (!answer) throw notFound('Answer not found');
  const attempt = await loadAttemptForStaff(me, answer.attemptId);
  if (attempt.status === 'IN_PROGRESS') throw conflict('This attempt is still in progress');
  const body = parseBody(z.object({ score: z.number(), feedback: z.string().max(3000).optional(), reason: z.string().max(500).optional() }), req);
  const err = validateManualScore(body.score, answer.attemptQuestion.marks);
  if (err) throw badRequest(err);
  if (attempt.exam.resultsPublishedAt && !body.reason) throw badRequest('Results are already published — a reason is required to change a grade (or resolve it through a dispute)');
  const before = finalAnswerScore(answer);
  await prisma.answer.update({ where: { id: answer.id }, data: { manualScore: body.score, feedback: body.feedback, gradedById: me.id, gradedAt: new Date() } });
  const updated = await prisma.$transaction((tx) => gradeAttempt(tx, attempt.id));
  if (attempt.exam.resultsPublishedAt) await issueCertificate(attempt.id);
  audit(me.id, 'answer.grade', 'Attempt', attempt.id, { answerId: answer.id, before, after: body.score, reason: body.reason });
  res.json({ ok: true, attemptScore: updated.score, gradingStatus: updated.gradingStatus });
});

/* ------------------------------------- results ----------------------------------- */

const summaryStats = (scores: number[], pass: number) => {
  const s = [...scores].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return { count: 0, mean: 0, median: 0, max: 0, min: 0, sd: 0, passRate: 0 };
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const r = (x: number) => Math.round(x * 100) / 100;
  return { count: n, mean: r(mean), median: r(n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2), max: s[n - 1], min: s[0], sd: r(Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / n)), passRate: r((s.filter((x) => x >= pass).length / n) * 100) };
};

staffRouter.get('/exams/:id/results', async (req, res) => {
  const exam = await loadExamForStaff(currentUser(req), param(req, 'id'));
  const attempts = await prisma.attempt.findMany({ where: { examId: exam.id, isSandbox: false }, include: { candidate: { select: { name: true, email: true, groupName: true } }, certificate: { select: { code: true } }, _count: { select: { incidents: true } } }, orderBy: { score: 'desc' } });
  const done = attempts.filter((a) => a.status !== 'IN_PROGRESS');
  const ranked = [...done].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  res.json({
    exam: { id: exam.id, title: exam.title, totalMarks: exam.totalMarks, passMarks: exam.passMarks, resultsPublishedAt: exam.resultsPublishedAt, status: exam.status, windowEnd: exam.windowEnd },
    summary: summaryStats(done.map((a) => a.score ?? 0), exam.passMarks),
    grading: { total: done.length, graded: done.filter((a) => a.gradingStatus === 'GRADED').length, inProgress: attempts.length - done.length },
    attempts: attempts.map((a) => ({
      id: a.id, candidate: a.candidate, status: a.status, score: a.score, maxScore: a.maxScore, gradingStatus: a.gradingStatus,
      submittedAt: a.submittedAt, startedAt: a.startedAt, durationSec: a.submittedAt ? Math.round((a.submittedAt.getTime() - a.startedAt.getTime()) / 1000) : null,
      passed: (a.score ?? 0) >= exam.passMarks, rank: ranked.findIndex((x) => x.id === a.id) + 1 || null, integrityScore: a.integrityScore, incidents: a._count.incidents, certificateCode: a.certificate?.code,
    })),
  });
});

staffRouter.post('/exams/:id/results/publish', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  if (exam.resultsPublishedAt) throw conflict('Results are already published');
  if (examPhase(exam) !== 'COMPLETED' && examPhase(exam) !== 'ARCHIVED') throw conflict('Results can be published once the exam window has closed — close the exam early if everyone has finished');
  const attempts = await prisma.attempt.findMany({ where: { examId: exam.id, isSandbox: false } });
  if (attempts.some((a) => a.status === 'IN_PROGRESS')) throw conflict('Some candidates are still writing — wait for them to finish or close the exam');
  const pending = attempts.filter((a) => a.gradingStatus !== 'GRADED').length;
  if (pending) throw conflict(`${pending} attempt(s) still need manual grading`);
  if (!attempts.length) throw conflict('There are no submissions to publish');
  for (const a of attempts) await issueCertificate(a.id);
  await prisma.exam.update({ where: { id: exam.id }, data: { resultsPublishedAt: new Date() } });
  await notify(attempts.map((a) => a.candidateId), 'Results published', `Your result for ${exam.title} is available`, '/candidate/results');
  audit(me.id, 'results.publish', 'Exam', exam.id, { count: attempts.length });
  res.json({ ok: true, published: attempts.length });
});

staffRouter.post('/exams/:id/results/unpublish', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(5, 'A reason is required').max(300) }), req);
  await prisma.exam.update({ where: { id: exam.id }, data: { resultsPublishedAt: null } });
  await prisma.certificate.updateMany({ where: { attempt: { examId: exam.id } }, data: { revoked: true } });
  audit(me.id, 'results.unpublish', 'Exam', exam.id, { reason });
  res.json({ ok: true });
});

/* ------------------------------------ analytics ---------------------------------- */

export async function examAnalytics(examId: string) {
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
  const attempts = await prisma.attempt.findMany({ where: { examId, isSandbox: false, status: { not: 'IN_PROGRESS' } }, select: { id: true, score: true, maxScore: true, integrityScore: true, startedAt: true, submittedAt: true } });
  const aqs = await prisma.attemptQuestion.findMany({ where: { attemptId: { in: attempts.map((a) => a.id) } }, include: { answer: true, questionVersion: { include: { question: { include: { topic: true } } } } } });
  const scores = attempts.map((a) => a.score ?? 0);
  const maxScore = Math.max(exam.totalMarks, ...attempts.map((a) => a.maxScore), 1);

  // score distribution in 10 buckets of percentage
  const buckets = Array.from({ length: 10 }, (_, i) => ({ label: `${i * 10}–${i * 10 + 10}%`, count: 0 }));
  attempts.forEach((a) => buckets[Math.min(9, Math.floor((((a.score ?? 0) / (a.maxScore || maxScore)) * 100) / 10))].count++);

  // upper / lower 27% groups for the discrimination index
  const ranked = [...attempts].sort((a, b) => (b.score ?? 0) / (b.maxScore || 1) - (a.score ?? 0) / (a.maxScore || 1));
  const k = Math.max(1, Math.round(ranked.length * 0.27));
  const upper = new Set(ranked.slice(0, k).map((a) => a.id));
  const lower = new Set(ranked.slice(-k).map((a) => a.id));

  const byQ = new Map<string, typeof aqs>();
  aqs.forEach((aq) => {
    const id = aq.questionVersion.questionId;
    if (!byQ.has(id)) byQ.set(id, []);
    byQ.get(id)!.push(aq);
  });
  const isAnswered = (r: unknown) => (Array.isArray(r) ? r.length > 0 : !!(r as { text?: string } | null)?.text?.trim());
  const questions = [...byQ.entries()].map(([questionId, list]) => {
    const v = list[0].questionVersion;
    const q = v.question;
    const n = list.length;
    const attempted = list.filter((x) => isAnswered(x.answer?.response)).length;
    const frac = (x: (typeof list)[number]) => (x.marks ? Math.max(0, x.answer ? finalAnswerScore(x.answer) : 0) / x.marks : 0);
    const p = n ? list.reduce((s, x) => s + frac(x), 0) / n : 0;
    const up = list.filter((x) => upper.has(x.attemptId));
    const lo = list.filter((x) => lower.has(x.attemptId));
    const mean = (arr: typeof list) => (arr.length ? arr.reduce((s, x) => s + frac(x), 0) / arr.length : 0);
    const discrimination = up.length && lo.length ? mean(up) - mean(lo) : null;
    const options = (v.options as { id: string; text: string }[]).map((o) => ({
      id: o.id,
      text: o.text,
      correct: correctFor(list[0]).includes(o.id),
      picks: list.filter((x) => selectedIds(x.answer?.response).includes(o.id)).length,
    }));
    const topWrong = options.filter((o) => !o.correct).sort((a, b) => b.picks - a.picks)[0];
    const topRight = Math.max(0, ...options.filter((o) => o.correct).map((o) => o.picks));
    const flags: string[] = [];
    if (n >= 3 && discrimination !== null && discrimination < 0.1) flags.push('Low discrimination — strong and weak candidates perform alike');
    if (n >= 3 && discrimination !== null && discrimination < 0) flags.push('Negative discrimination — possibly ambiguous or wrong answer key');
    if (topWrong && topWrong.picks > topRight && n >= 3) flags.push(`Distractor "${topWrong.text.slice(0, 40)}" chosen more often than the correct answer`);
    if (n && (n - attempted) / n >= 0.3) flags.push('Frequently skipped');
    if (n >= 3 && p > 0.95) flags.push('Very easy — almost everyone scores full marks');
    if (n >= 3 && p < 0.15) flags.push('Very hard — almost nobody scores');
    const observedLevel = p >= 0.7 ? 'EASY' : p >= 0.4 ? 'MEDIUM' : 'HARD';
    return {
      questionId,
      body: v.body,
      type: q.type,
      topic: q.topic.name,
      labelledDifficulty: q.difficulty,
      observedDifficulty: observedLevel,
      calibrated: q.calibratedDifficulty,
      n,
      attempted,
      skipRate: n ? Math.round(((n - attempted) / n) * 100) : 0,
      difficultyIndex: Math.round(p * 100),
      discrimination: discrimination === null ? null : Math.round(discrimination * 100) / 100,
      avgTimeSec: n ? Math.round(list.reduce((s, x) => s + (x.answer?.timeSpentMs ?? 0), 0) / n / 1000) : 0,
      flaggedForReview: list.filter((x) => x.answer?.flagged).length,
      options,
      flags,
    };
  });

  const topics: Record<string, { scored: number; max: number }> = {};
  aqs.forEach((aq) => {
    const t = aq.questionVersion.question.topic.name;
    topics[t] ??= { scored: 0, max: 0 };
    topics[t].scored += aq.answer ? Math.max(0, finalAnswerScore(aq.answer)) : 0;
    topics[t].max += aq.marks;
  });
  return {
    exam: { id: exam.id, title: exam.title, totalMarks: exam.totalMarks, passMarks: exam.passMarks, windowStart: exam.windowStart, windowEnd: exam.windowEnd, durationMin: exam.durationMin },
    summary: summaryStats(scores, exam.passMarks),
    distribution: buckets,
    avgDurationMin: attempts.length ? Math.round(attempts.reduce((s, a) => s + ((a.submittedAt?.getTime() ?? 0) - a.startedAt.getTime()), 0) / attempts.length / 60000) : 0,
    avgIntegrity: attempts.length ? Math.round(attempts.reduce((s, a) => s + a.integrityScore, 0) / attempts.length) : 100,
    topics: Object.entries(topics).map(([name, v]) => ({ name, pct: v.max ? Math.round((v.scored / v.max) * 100) : 0 })),
    questions,
  };
}

staffRouter.get('/exams/:id/analytics', async (req, res) => {
  const exam = await loadExamForStaff(currentUser(req), param(req, 'id'));
  res.json(await examAnalytics(exam.id));
});

/** Feed observed difficulty back into the bank (Bayesian blend with the label prior), improving future fair papers. */
staffRouter.post('/exams/:id/calibrate', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  const a = await examAnalytics(exam.id);
  const K = 5;
  let updated = 0;
  for (const q of a.questions) {
    if (q.n < 1) continue;
    const prior = PRIOR[q.labelledDifficulty] ?? 0.55;
    const p = (prior * K + (q.difficultyIndex / 100) * q.n) / (K + q.n);
    await prisma.question.update({ where: { id: q.questionId }, data: { calibratedDifficulty: Math.round(p * 1000) / 1000 } });
    updated++;
  }
  audit(me.id, 'exam.calibrate', 'Exam', exam.id, { updated });
  res.json({ updated });
});

/** Collusion signals: near-identical written answers & shared unusual wrong MCQ choices. Evidence for review, never a verdict. */
staffRouter.get('/exams/:id/similarity', async (req, res) => {
  const exam = await loadExamForStaff(currentUser(req), param(req, 'id'));
  const aqs = await prisma.attemptQuestion.findMany({
    where: { attempt: { examId: exam.id, isSandbox: false, status: { not: 'IN_PROGRESS' } } },
    include: { answer: true, attempt: { select: { id: true, candidate: { select: { name: true } } } }, questionVersion: { include: { question: true } } },
  });
  const byQ = new Map<string, typeof aqs>();
  aqs.forEach((x) => {
    const k = x.questionVersion.questionId;
    if (!byQ.has(k)) byQ.set(k, []);
    byQ.get(k)!.push(x);
  });
  const written: { question: string; a: string; b: string; attemptA: string; attemptB: string; similarity: number; excerptA: string; excerptB: string }[] = [];
  const wrongPairs = new Map<string, { a: string; b: string; attemptA: string; attemptB: string; shared: number }>();
  for (const list of byQ.values()) {
    const q = list[0].questionVersion;
    if (q.question.type === 'WRITTEN') {
      const texts = list.map((x) => ({ x, t: (x.answer?.response as { text?: string } | null)?.text ?? '' })).filter((y) => y.t.split(/\s+/).length >= 8);
      const sh = texts.map((y) => shingles(y.t));
      for (let i = 0; i < texts.length; i++)
        for (let j = i + 1; j < texts.length; j++) {
          const s = jaccard(sh[i], sh[j]);
          if (s >= 0.5)
            written.push({ question: q.body.slice(0, 80), a: texts[i].x.attempt.candidate.name, b: texts[j].x.attempt.candidate.name, attemptA: texts[i].x.attemptId, attemptB: texts[j].x.attemptId, similarity: Math.round(s * 100), excerptA: texts[i].t.slice(0, 160), excerptB: texts[j].t.slice(0, 160) });
        }
    } else {
      const correct = correctFor(list[0]);
      const wrong = list.filter((x) => {
        const sel = selectedIds(x.answer?.response);
        return sel.length && sel.sort().join() !== [...correct].sort().join();
      });
      for (let i = 0; i < wrong.length; i++)
        for (let j = i + 1; j < wrong.length; j++) {
          if (selectedIds(wrong[i].answer?.response).sort().join() !== selectedIds(wrong[j].answer?.response).sort().join()) continue;
          const key = [wrong[i].attemptId, wrong[j].attemptId].sort().join(':');
          const e = wrongPairs.get(key) ?? { a: wrong[i].attempt.candidate.name, b: wrong[j].attempt.candidate.name, attemptA: wrong[i].attemptId, attemptB: wrong[j].attemptId, shared: 0 };
          e.shared++;
          wrongPairs.set(key, e);
        }
    }
  }
  res.json({
    written: written.sort((a, b) => b.similarity - a.similarity),
    identicalWrongAnswers: [...wrongPairs.values()].filter((p) => p.shared >= 3).sort((a, b) => b.shared - a.shared),
    note: 'Similarity indicators are not proof of misconduct. Review the full answers and context before taking any action.',
  });
});

/* ------------------------------------- disputes ---------------------------------- */

staffRouter.get('/disputes', async (req, res) => {
  const me = currentUser(req);
  const { status } = parseQuery(z.object({ status: z.enum(['OPEN', 'UNDER_REVIEW', 'UPHELD', 'REJECTED']).optional() }), req);
  const items = await prisma.dispute.findMany({
    where: { ...(status ? { status } : {}), ...(me.role === 'EXAMINER' ? { attempt: { exam: { ownerId: me.id } } } : {}) },
    orderBy: { createdAt: 'desc' },
    include: {
      raisedBy: { select: { name: true, email: true } },
      attempt: { select: { id: true, score: true, maxScore: true, exam: { select: { id: true, title: true } } } },
      attemptQuestion: { include: { answer: true, questionVersion: { include: { question: true } } } },
    },
  });
  const logs = await prisma.auditLog.findMany({ where: { entity: 'Dispute', entityId: { in: items.map((i) => i.id) } }, orderBy: { seq: 'asc' } });
  res.json(
    items.map((d) => ({
      ...d,
      question: d.attemptQuestion
        ? { position: d.attemptQuestion.position, body: d.attemptQuestion.questionVersion.body, type: d.attemptQuestion.questionVersion.question.type, options: d.attemptQuestion.questionVersion.options, correct: correctFor(d.attemptQuestion), marks: d.attemptQuestion.marks, response: d.attemptQuestion.answer?.response, score: d.attemptQuestion.answer ? finalAnswerScore(d.attemptQuestion.answer) : 0, voided: d.attemptQuestion.voided }
        : null,
      attemptQuestion: undefined,
      timeline: logs.filter((l) => l.entityId === d.id).map((l) => ({ action: l.action, at: l.createdAt, data: l.data, hash: l.hash.slice(0, 10) })),
    })),
  );
});

async function loadDispute(me: ReturnType<typeof currentUser>, id: string) {
  const d = await prisma.dispute.findUnique({ where: { id }, include: { attempt: { include: { exam: true } }, attemptQuestion: true } });
  if (!d) throw notFound('Dispute not found');
  if (me.role !== 'ADMIN' && d.attempt.exam.ownerId !== me.id) throw forbidden();
  return d;
}

staffRouter.post('/disputes/:id/review', async (req, res) => {
  const me = currentUser(req);
  const d = await loadDispute(me, param(req, 'id'));
  if (d.status !== 'OPEN') throw conflict('Dispute is not open');
  await prisma.dispute.update({ where: { id: d.id }, data: { status: 'UNDER_REVIEW' } });
  audit(me.id, 'dispute.under_review', 'Dispute', d.id, { by: me.name });
  await notify([d.raisedById], 'Dispute under review', `Your dispute on ${d.attempt.exam.title} is being reviewed`, '/candidate/disputes');
  res.json({ ok: true });
});

/**
 * Resolve a dispute (Innovation 5.4). Upheld disputes apply a concrete, auditable remedy:
 *  - ADJUST_SCORE: change this candidate's mark on the question
 *  - ACCEPT_ANSWER: accept additional option(s) as correct — re-grades EVERY candidate who got this question
 *  - VOID_QUESTION: award full marks to every candidate who got this question
 * Every change is recorded in the hash-chained audit log and the certificate is re-signed.
 */
staffRouter.post('/disputes/:id/resolve', async (req, res) => {
  const me = currentUser(req);
  const d = await loadDispute(me, param(req, 'id'));
  if (d.status === 'UPHELD' || d.status === 'REJECTED') throw conflict('Dispute already resolved');
  const body = parseBody(
    z.object({
      decision: z.enum(['UPHELD', 'REJECTED']),
      resolution: z.string().trim().min(10, 'Explain the decision in at least 10 characters').max(3000),
      action: z.enum(['NONE', 'ADJUST_SCORE', 'ACCEPT_ANSWER', 'VOID_QUESTION']).default('NONE'),
      score: z.number().optional(),
      optionIds: z.array(z.string()).optional(),
    }),
    req,
  );
  if (body.decision === 'REJECTED' && body.action !== 'NONE') throw badRequest('A rejected dispute cannot change scores');
  if (body.action !== 'NONE' && !d.attemptQuestion) throw badRequest('This dispute is not linked to a specific question');

  const scoreBefore = d.attempt.score;
  let affected: string[] = [d.attemptId];
  const aq = d.attemptQuestion;
  if (body.decision === 'UPHELD' && aq) {
    if (body.action === 'ADJUST_SCORE') {
      if (body.score === undefined) throw badRequest('Provide the corrected score');
      const err = validateManualScore(body.score, aq.marks);
      if (err) throw badRequest(err);
      await prisma.answer.upsert({ where: { attemptQuestionId: aq.id }, update: { manualScore: body.score, gradedById: me.id, gradedAt: new Date(), feedback: `Adjusted via dispute: ${body.resolution}` }, create: { attemptId: d.attemptId, attemptQuestionId: aq.id, manualScore: body.score } });
    } else if (body.action === 'ACCEPT_ANSWER' || body.action === 'VOID_QUESTION') {
      const siblings = await prisma.attemptQuestion.findMany({ where: { questionVersionId: aq.questionVersionId, attempt: { examId: d.attempt.examId, isSandbox: false, status: { not: 'IN_PROGRESS' } } }, include: { questionVersion: true } });
      if (body.action === 'ACCEPT_ANSWER') {
        if (!body.optionIds?.length) throw badRequest('Select the option(s) to accept as correct');
        const valid = (siblings[0].questionVersion.options as { id: string }[]).map((o) => o.id);
        if (body.optionIds.some((o) => !valid.includes(o))) throw badRequest('Unknown option');
        const merged = [...new Set([...correctFor(siblings[0]), ...body.optionIds])];
        await prisma.attemptQuestion.updateMany({ where: { id: { in: siblings.map((s) => s.id) } }, data: { correctOverride: merged } });
      } else await prisma.attemptQuestion.updateMany({ where: { id: { in: siblings.map((s) => s.id) } }, data: { voided: true } });
      affected = [...new Set(siblings.map((s) => s.attemptId))];
    }
  }
  const before = new Map((await prisma.attempt.findMany({ where: { id: { in: affected } }, select: { id: true, score: true, candidateId: true } })).map((a) => [a.id, a]));
  for (const id of affected) await prisma.$transaction((tx) => gradeAttempt(tx, id));
  const after = await prisma.attempt.findMany({ where: { id: { in: affected } }, select: { id: true, score: true, candidateId: true } });
  if (d.attempt.exam.resultsPublishedAt) for (const id of affected) await issueCertificate(id);
  const changed = after.filter((a) => a.score !== before.get(a.id)?.score);
  const own = after.find((a) => a.id === d.attemptId);
  await prisma.dispute.update({ where: { id: d.id }, data: { status: body.decision, resolution: body.resolution, resolverId: me.id, resolvedAt: new Date(), scoreBefore, scoreAfter: own?.score ?? scoreBefore, affectedCount: changed.length } });
  audit(me.id, `dispute.${body.decision.toLowerCase()}`, 'Dispute', d.id, { action: body.action, resolution: body.resolution, scoreBefore, scoreAfter: own?.score, affectedCandidates: changed.length });
  await notify([d.raisedById], `Dispute ${body.decision === 'UPHELD' ? 'upheld' : 'rejected'}`, body.resolution, '/candidate/disputes');
  const others = changed.filter((c) => c.candidateId !== d.raisedById).map((c) => c.candidateId);
  if (others.length) await notify(others, 'Your score was updated', `A question in ${d.attempt.exam.title} was re-graded after a review.`, '/candidate/results');
  res.json({ ok: true, scoreBefore, scoreAfter: own?.score, affectedCandidates: changed.length });
});
