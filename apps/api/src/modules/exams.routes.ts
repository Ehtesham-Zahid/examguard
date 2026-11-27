import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../core/prisma.js';
import { authenticate, currentUser, requireRole } from '../core/auth.js';
import { badRequest, conflict } from '../core/errors.js';
import { param, parseBody } from '../core/validate.js';
import { loadExamForStaff } from '../core/policy.js';
import { defaultSettings, examPhase, readSettings } from '../domain/examPhase.js';
import { averageOverlap, easiness, generateFairPaper, generateNaivePaper, stats, targetDifficulty, validateBlueprint, type PoolQuestion, type Slot } from '../domain/fairness.js';
import { finalizeAttempt, recomputeExamTotals } from '../services/attempts.service.js';
import { audit } from '../core/audit.js';
import { emitToCandidates, emitToMonitors } from '../core/realtime.js';
import { notify } from '../core/notify.js';

export const examsRouter = Router();
examsRouter.use(authenticate, requireRole('ADMIN', 'EXAMINER'));

const settingsSchema = z
  .object({
    shuffleQuestions: z.boolean(),
    shuffleOptions: z.boolean(),
    allowBackNav: z.boolean(),
    requireFullscreen: z.boolean(),
    maxViolations: z.number().int().min(0).max(50),
    showCorrectAnswers: z.boolean(),
    lateJoinMin: z.number().int().min(0).max(1440),
    gracePeriodSec: z.number().int().min(0).max(120),
    autoCompensate: z.boolean(),
  })
  .partial();

const examBase = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(150),
  description: z.string().max(2000).default(''),
  instructions: z.string().max(10000).default(''),
  windowStart: z.coerce.date(),
  windowEnd: z.coerce.date(),
  durationMin: z.number().int().min(1, 'Duration must be at least 1 minute').max(600),
  passMarks: z.number().min(0).default(0),
  accessCode: z.string().trim().max(30).optional().nullable(),
  settings: settingsSchema.default({}),
});
const examInput = examBase.superRefine((e, ctx) => {
  if (e.windowEnd <= e.windowStart) ctx.addIssue({ code: 'custom', path: ['windowEnd'], message: 'End must be after start' });
  if ((e.windowEnd.getTime() - e.windowStart.getTime()) / 60000 < e.durationMin) ctx.addIssue({ code: 'custom', path: ['durationMin'], message: 'Duration is longer than the availability window' });
});

const summarize = async (examIds: string[]) => {
  const [enr, att, qs] = await Promise.all([
    prisma.enrollment.groupBy({ by: ['examId'], where: { examId: { in: examIds } }, _count: true }),
    prisma.attempt.groupBy({ by: ['examId', 'status'], where: { examId: { in: examIds }, isSandbox: false }, _count: true }),
    prisma.examQuestion.groupBy({ by: ['examId'], where: { examId: { in: examIds } }, _count: true }),
  ]);
  return (id: string) => {
    const a = att.filter((x) => x.examId === id);
    return {
      enrolled: enr.find((x) => x.examId === id)?._count ?? 0,
      inProgress: a.find((x) => x.status === 'IN_PROGRESS')?._count ?? 0,
      submitted: a.filter((x) => x.status !== 'IN_PROGRESS').reduce((s, x) => s + x._count, 0),
      questionCount: qs.find((x) => x.examId === id)?._count ?? 0,
    };
  };
};

examsRouter.get('/', async (req, res) => {
  const me = currentUser(req);
  const exams = await prisma.exam.findMany({ where: me.role === 'EXAMINER' ? { ownerId: me.id } : {}, orderBy: { windowStart: 'desc' }, include: { owner: { select: { name: true } } } });
  const sum = await summarize(exams.map((e) => e.id));
  res.json(exams.map((e) => ({ ...e, accessCode: undefined, hasAccessCode: !!e.accessCode, phase: examPhase(e), questionCount: e.mode === 'BLUEPRINT' ? ((e.blueprint as unknown as Slot[]) ?? []).reduce((a, b) => a + b.count, 0) : sum(e.id).questionCount, stats: sum(e.id) })));
});

examsRouter.post('/', async (req, res) => {
  const me = currentUser(req);
  const body = parseBody(examInput, req);
  const exam = await prisma.exam.create({ data: { ...body, accessCode: body.accessCode || null, settings: { ...defaultSettings, ...body.settings }, ownerId: me.id } });
  audit(me.id, 'exam.create', 'Exam', exam.id, { title: exam.title });
  res.status(201).json(exam);
});

examsRouter.get('/:id', async (req, res) => {
  const exam = await loadExamForStaff(currentUser(req), param(req, 'id'));
  const questions = await prisma.examQuestion.findMany({ where: { examId: exam.id }, orderBy: { position: 'asc' }, include: { question: { include: { versions: true, topic: true } } } });
  const sum = await summarize([exam.id]);
  res.json({
    ...exam,
    settings: readSettings(exam.settings),
    phase: examPhase(exam),
    stats: sum(exam.id),
    questions: questions.map((eq) => {
      const v = eq.question.versions.find((x) => x.version === eq.question.currentVersion)!;
      return { id: eq.question.id, position: eq.position, type: eq.question.type, difficulty: eq.question.difficulty, topic: eq.question.topic.name, body: v.body, marks: v.marks, options: v.options, correct: v.correct, version: v.version };
    }),
  });
});

examsRouter.put('/:id', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  const body = parseBody(examInput, req);
  const phase = examPhase(exam);
  if (phase === 'COMPLETED' || phase === 'ARCHIVED') throw conflict('Completed examinations can no longer be edited');
  if (phase === 'ONGOING') {
    // only safe edits while candidates are writing: text and extending the window end
    if (body.windowStart.getTime() !== exam.windowStart.getTime() || body.durationMin !== exam.durationMin) throw conflict('Start time and duration cannot change while the exam is ongoing');
    if (body.windowEnd < exam.windowEnd) throw conflict('The window can only be extended while the exam is ongoing');
    if (body.passMarks !== exam.passMarks) throw conflict('The pass mark cannot change while the exam is ongoing');
    const cur = readSettings(exam.settings);
    const next = { ...cur, ...body.settings };
    const changed = (Object.keys(cur) as (keyof typeof cur)[]).filter((k) => cur[k] !== next[k]);
    if (changed.length) throw conflict(`Exam rules cannot change while the exam is ongoing (${changed.join(', ')})`);
  }
  const updated = await prisma.exam.update({ where: { id: exam.id }, data: { ...body, accessCode: body.accessCode || null, settings: { ...readSettings(exam.settings), ...body.settings } } });
  audit(me.id, 'exam.update', 'Exam', exam.id);
  res.json(updated);
});

examsRouter.delete('/:id', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  if (exam.status !== 'DRAFT') throw conflict('Only draft examinations can be deleted — archive it instead');
  await prisma.exam.delete({ where: { id: exam.id } });
  audit(me.id, 'exam.delete', 'Exam', exam.id, { title: exam.title });
  res.json({ ok: true });
});

const assertDraft = (e: { status: string }) => {
  if (e.status !== 'DRAFT') throw conflict('Questions can only be changed while the exam is a draft. Unpublish it first.');
};

examsRouter.put('/:id/questions', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  assertDraft(exam);
  const { questionIds } = parseBody(z.object({ questionIds: z.array(z.string()).max(300) }), req);
  if (new Set(questionIds).size !== questionIds.length) throw badRequest('A question was added twice');
  const owned = await prisma.question.count({ where: { id: { in: questionIds }, archived: false, ...(me.role === 'EXAMINER' ? { ownerId: me.id } : {}) } });
  if (owned !== questionIds.length) throw badRequest('Some questions do not exist, are archived, or are not yours');
  await prisma.$transaction([
    prisma.examQuestion.deleteMany({ where: { examId: exam.id } }),
    prisma.examQuestion.createMany({ data: questionIds.map((questionId, i) => ({ examId: exam.id, questionId, position: i + 1 })) }),
    prisma.exam.update({ where: { id: exam.id }, data: { mode: 'FIXED' } }),
  ]);
  const updated = await recomputeExamTotals(exam.id);
  res.json({ ok: true, totalMarks: updated.totalMarks });
});

const slotSchema = z.object({ topicId: z.string(), difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']), count: z.number().int().min(1).max(100), marks: z.number().positive().max(100) });

async function poolFor(slots: Slot[], ownerId: string | null) {
  const qs = await prisma.question.findMany({ where: { archived: false, type: { in: ['SINGLE', 'MULTI', 'WRITTEN'] }, ...(ownerId ? { ownerId } : {}), OR: slots.length ? slots.map((s) => ({ topicId: s.topicId, difficulty: s.difficulty as 'EASY' })) : undefined } });
  return qs.map((q) => ({ id: q.id, topicId: q.topicId, difficulty: q.difficulty, p: easiness(q) })) as PoolQuestion[];
}

examsRouter.put('/:id/blueprint', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  assertDraft(exam);
  const { slots } = parseBody(z.object({ slots: z.array(slotSchema).min(1, 'Add at least one blueprint row').max(30) }), req);
  const problems = validateBlueprint(await poolFor(slots, exam.ownerId), slots);
  if (problems.length) throw badRequest(problems[0], problems);
  await prisma.exam.update({ where: { id: exam.id }, data: { mode: 'BLUEPRINT', blueprint: slots } });
  const updated = await recomputeExamTotals(exam.id);
  audit(me.id, 'exam.blueprint', 'Exam', exam.id, { slots: slots.length });
  res.json({ ok: true, totalMarks: updated.totalMarks });
});

/** Fairness report (Innovation 5.2): simulate many papers with fair vs naive sampling, plus the real issued papers. */
examsRouter.get('/:id/fairness', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  if (exam.mode !== 'BLUEPRINT' || !exam.blueprint) return res.json({ mode: exam.mode, message: 'Fairness analysis applies to blueprint-based randomised exams' });
  const slots = exam.blueprint as unknown as Slot[];
  const pool = await poolFor(slots, exam.ownerId);
  const N = 40;
  const usage = new Map<string, number>();
  const fair = Array.from({ length: N }, (_, i) => {
    const p = generateFairPaper(pool, slots, `sim-${i}`, usage);
    p.picks.forEach((x) => usage.set(x.q.id, (usage.get(x.q.id) ?? 0) + 1));
    return p;
  });
  const naive = Array.from({ length: N }, (_, i) => generateNaivePaper(pool, slots, `sim-${i}`));
  const issued = await prisma.attempt.findMany({ where: { examId: exam.id, isSandbox: false }, select: { id: true, paperDifficulty: true, score: true, maxScore: true, candidate: { select: { name: true } }, questions: { select: { questionVersion: { select: { questionId: true } } } } } });
  const toPct = (x: number) => Math.round(x * 1000) / 10;
  res.json({
    mode: 'BLUEPRINT',
    target: toPct(targetDifficulty(pool, slots)),
    poolSize: pool.length,
    fair: { values: fair.map((p) => toPct(p.difficulty)), ...Object.fromEntries(Object.entries(stats(fair.map((p) => p.difficulty * 100))).map(([k, v]) => [k, Math.round(v * 10) / 10])), overlap: Math.round(averageOverlap(fair.map((p) => p.picks.map((x) => x.q.id))) * 100) },
    naive: { values: naive.map((p) => toPct(p.difficulty)), ...Object.fromEntries(Object.entries(stats(naive.map((p) => p.difficulty * 100))).map(([k, v]) => [k, Math.round(v * 10) / 10])), overlap: Math.round(averageOverlap(naive.map((p) => p.picks.map((x) => x.q.id))) * 100) },
    issued: issued.map((a) => ({ attemptId: a.id, candidate: a.candidate.name, expected: toPct(a.paperDifficulty ?? 0), actual: a.score != null && a.maxScore ? toPct(a.score / a.maxScore) : null })),
    issuedOverlap: Math.round(averageOverlap(issued.map((a) => a.questions.map((q) => q.questionVersion.questionId))) * 100),
    coverage: slots.map((s) => ({ ...s, available: pool.filter((q) => q.topicId === s.topicId && q.difficulty === s.difficulty).length })),
  });
});

/** Pre-publication checklist (3.2 "review before publication"). */
async function reviewChecklist(examId: string) {
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId }, include: { questions: { include: { question: { include: { versions: true } } } } } });
  const enrolled = await prisma.enrollment.count({ where: { examId } });
  const checks: { label: string; ok: boolean; blocking: boolean; detail?: string }[] = [];
  const now = new Date();
  checks.push({ label: 'Title and instructions provided', ok: exam.title.length >= 3 && exam.instructions.trim().length > 0, blocking: false, detail: exam.instructions.trim() ? undefined : 'Instructions are empty' });
  checks.push({ label: 'Availability window ends in the future', ok: exam.windowEnd > now, blocking: true });
  if (exam.mode === 'FIXED') {
    checks.push({ label: 'At least one question assigned', ok: exam.questions.length > 0, blocking: true, detail: `${exam.questions.length} questions` });
    const broken = exam.questions.filter((eq) => {
      const v = eq.question.versions.find((x) => x.version === eq.question.currentVersion)!;
      return eq.question.type !== 'WRITTEN' && (v.correct as string[]).length === 0;
    });
    checks.push({ label: 'Every objective question has a correct answer', ok: broken.length === 0, blocking: true, detail: broken.length ? `${broken.length} question(s) missing an answer key` : undefined });
    const archived = exam.questions.filter((eq) => eq.question.archived).length;
    checks.push({ label: 'No archived questions', ok: archived === 0, blocking: true, detail: archived ? `${archived} archived question(s)` : undefined });
  } else {
    const slots = (exam.blueprint as unknown as Slot[]) ?? [];
    const problems = validateBlueprint(await poolFor(slots, exam.ownerId), slots);
    checks.push({ label: 'Blueprint can be satisfied by the question bank', ok: slots.length > 0 && problems.length === 0, blocking: true, detail: problems[0] });
  }
  checks.push({ label: 'Total marks greater than zero', ok: exam.totalMarks > 0, blocking: true, detail: `${exam.totalMarks} marks` });
  checks.push({ label: 'Pass mark does not exceed total marks', ok: exam.passMarks <= exam.totalMarks, blocking: true, detail: `${exam.passMarks} / ${exam.totalMarks}` });
  checks.push({ label: 'Candidates enrolled', ok: enrolled > 0, blocking: false, detail: `${enrolled} enrolled` });
  checks.push({ label: 'Duration fits in the window', ok: (exam.windowEnd.getTime() - exam.windowStart.getTime()) / 60000 >= exam.durationMin, blocking: true });
  return { checks, canPublish: checks.every((c) => c.ok || !c.blocking) };
}

examsRouter.get('/:id/review', async (req, res) => {
  const exam = await loadExamForStaff(currentUser(req), param(req, 'id'));
  await recomputeExamTotals(exam.id);
  res.json(await reviewChecklist(exam.id));
});

examsRouter.post('/:id/publish', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  if (exam.status !== 'DRAFT') throw conflict('Only draft examinations can be published');
  await recomputeExamTotals(exam.id);
  const review = await reviewChecklist(exam.id);
  if (!review.canPublish) throw badRequest('Fix the blocking issues before publishing', review.checks.filter((c) => !c.ok && c.blocking));
  const pinned = await prisma.examQuestion.findMany({ where: { examId: exam.id }, include: { question: { select: { currentVersion: true } } } });
  const [updated] = await prisma.$transaction([
    prisma.exam.update({ where: { id: exam.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
    ...pinned.map((eq) => prisma.examQuestion.update({ where: { id: eq.id }, data: { version: eq.question.currentVersion } })),
  ]);
  const enrolled = await prisma.enrollment.findMany({ where: { examId: exam.id }, select: { candidateId: true } });
  await notify(enrolled.map((e) => e.candidateId), 'New examination scheduled', `${exam.title} opens ${exam.windowStart.toUTCString()}`, `/candidate/exams/${exam.id}`);
  audit(me.id, 'exam.publish', 'Exam', exam.id);
  res.json(updated);
});

examsRouter.post('/:id/unpublish', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  if (exam.status !== 'PUBLISHED') throw conflict('Exam is not published');
  const attempts = await prisma.attempt.count({ where: { examId: exam.id, isSandbox: false } });
  if (attempts) throw conflict('Candidates have already started — the exam cannot return to draft');
  const [updated] = await prisma.$transaction([
    prisma.exam.update({ where: { id: exam.id }, data: { status: 'DRAFT', publishedAt: null } }),
    prisma.examQuestion.updateMany({ where: { examId: exam.id }, data: { version: null } }),
  ]);
  audit(me.id, 'exam.unpublish', 'Exam', exam.id);
  res.json(updated);
});

examsRouter.post('/:id/close', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  if (exam.status !== 'PUBLISHED') throw conflict('Only published examinations can be closed');
  if (examPhase(exam) === 'PUBLISHED') throw conflict('This exam has not opened yet — unpublish it instead of closing it');
  const active = await prisma.attempt.findMany({ where: { examId: exam.id, status: 'IN_PROGRESS', isSandbox: false } });
  for (const a of active) await finalizeAttempt(a.id, 'FORCE_SUBMITTED', 'exam_closed_by_examiner');
  const updated = await prisma.exam.update({ where: { id: exam.id }, data: { status: 'COMPLETED', windowEnd: new Date(Math.min(Date.now(), exam.windowEnd.getTime())), pausedAt: null } });
  emitToCandidates(exam.id, 'exam:closed', {});
  audit(me.id, 'exam.close', 'Exam', exam.id, { forcedSubmissions: active.length });
  res.json(updated);
});

examsRouter.post('/:id/archive', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  if (examPhase(exam) !== 'COMPLETED') throw conflict('Only completed examinations can be archived');
  res.json(await prisma.exam.update({ where: { id: exam.id }, data: { status: 'ARCHIVED' } }));
  audit(me.id, 'exam.archive', 'Exam', exam.id);
});

examsRouter.post('/:id/duplicate', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  const qs = await prisma.examQuestion.findMany({ where: { examId: exam.id } });
  const copy = await prisma.exam.create({
    data: {
      ownerId: me.id, title: `${exam.title} (copy)`, description: exam.description, instructions: exam.instructions,
      windowStart: new Date(Date.now() + 86400_000), windowEnd: new Date(Date.now() + 86400_000 + exam.durationMin * 60000 * 2),
      durationMin: exam.durationMin, passMarks: exam.passMarks, mode: exam.mode, blueprint: exam.blueprint ?? undefined, settings: exam.settings as Prisma.InputJsonValue, totalMarks: exam.totalMarks,
      questions: { create: qs.map((q) => ({ questionId: q.questionId, position: q.position })) },
    },
  });
  audit(me.id, 'exam.duplicate', 'Exam', copy.id, { from: exam.id });
  res.status(201).json(copy);
});

/* --------------------------------- pause / resume -------------------------------- */

examsRouter.post('/:id/pause', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  if (examPhase(exam) !== 'ONGOING') throw conflict('Only ongoing examinations can be paused');
  if (exam.pausedAt) throw conflict('Already paused');
  const { reason } = parseBody(z.object({ reason: z.string().trim().max(300).default('') }), req);
  await prisma.exam.update({ where: { id: exam.id }, data: { pausedAt: new Date() } });
  emitToCandidates(exam.id, 'exam:paused', { reason });
  emitToMonitors(exam.id, 'exam:paused', {});
  audit(me.id, 'exam.pause', 'Exam', exam.id, { reason });
  res.json({ ok: true });
});

/** Resuming adds exactly the paused duration to every active attempt — nobody gains or loses time. */
examsRouter.post('/:id/resume', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  if (!exam.pausedAt) throw conflict('Exam is not paused');
  const pausedSec = Math.round((Date.now() - exam.pausedAt.getTime()) / 1000);
  const active = await prisma.attempt.findMany({ where: { examId: exam.id, status: 'IN_PROGRESS' } });
  await prisma.$transaction([
    ...active.map((a) => prisma.attempt.update({ where: { id: a.id }, data: { deadline: new Date(a.deadline.getTime() + pausedSec * 1000), extraTimeSec: { increment: pausedSec }, lastHeartbeatAt: new Date() } })),
    prisma.exam.update({ where: { id: exam.id }, data: { pausedAt: null, windowEnd: new Date(exam.windowEnd.getTime() + pausedSec * 1000) } }),
  ]);
  emitToCandidates(exam.id, 'exam:resumed', { addedSec: pausedSec });
  emitToMonitors(exam.id, 'exam:resumed', {});
  audit(me.id, 'exam.resume', 'Exam', exam.id, { pausedSec, attempts: active.length });
  res.json({ ok: true, addedSec: pausedSec });
});

/* ----------------------------------- enrollment ---------------------------------- */

examsRouter.get('/:id/enrollments', async (req, res) => {
  const exam = await loadExamForStaff(currentUser(req), param(req, 'id'));
  const [enr, attempts] = await Promise.all([
    prisma.enrollment.findMany({ where: { examId: exam.id }, include: { candidate: { select: { id: true, name: true, email: true, groupName: true } } }, orderBy: { createdAt: 'asc' } }),
    prisma.attempt.findMany({ where: { examId: exam.id, isSandbox: false } }),
  ]);
  const byC = new Map(attempts.map((a) => [a.candidateId, a]));
  const phase = examPhase(exam);
  res.json(
    enr.map((e) => {
      const a = byC.get(e.candidateId);
      const status = a ? (a.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'SUBMITTED') : phase === 'COMPLETED' ? 'ABSENT' : 'NOT_STARTED';
      return { ...e.candidate, extraTimePct: e.extraTimePct, enrolledAt: e.createdAt, status, attemptId: a?.id, score: a?.score, attemptStatus: a?.status };
    }),
  );
});

examsRouter.post('/:id/enrollments', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  if (examPhase(exam) === 'COMPLETED' || exam.status === 'ARCHIVED') throw conflict('Cannot enrol candidates in a completed examination');
  const body = parseBody(z.object({ candidateIds: z.array(z.string()).max(2000).default([]), group: z.string().optional(), emails: z.array(z.string().trim().max(200)).max(2000).default([]) }), req);
  const ids = new Set(body.candidateIds);
  if (body.group) (await prisma.user.findMany({ where: { role: 'CANDIDATE', groupName: body.group, status: 'ACTIVE' }, select: { id: true } })).forEach((u) => ids.add(u.id));
  const unknownEmails: string[] = [];
  if (body.emails.length) {
    const found = await prisma.user.findMany({ where: { role: 'CANDIDATE', email: { in: body.emails.filter(Boolean).map((e) => e.toLowerCase()) } }, select: { id: true, email: true } });
    found.forEach((u) => ids.add(u.id));
    body.emails.forEach((e) => !found.some((f) => f.email === e.toLowerCase()) && unknownEmails.push(e));
  }
  const valid = await prisma.user.findMany({ where: { id: { in: [...ids] }, role: 'CANDIDATE' }, select: { id: true } });
  const result = await prisma.enrollment.createMany({ data: valid.map((u) => ({ examId: exam.id, candidateId: u.id })), skipDuplicates: true });
  if (exam.status === 'PUBLISHED') await notify(valid.map((v) => v.id), 'You have been enrolled', exam.title, `/candidate/exams/${exam.id}`);
  audit(me.id, 'exam.enroll', 'Exam', exam.id, { added: result.count });
  res.json({ added: result.count, alreadyEnrolled: valid.length - result.count, unknownEmails });
});

examsRouter.patch('/:id/enrollments/:candidateId', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  const { extraTimePct } = parseBody(z.object({ extraTimePct: z.number().int().min(0).max(200) }), req);
  const candidateId = param(req, 'candidateId');
  const started = await prisma.attempt.findFirst({ where: { examId: exam.id, candidateId, isSandbox: false } });
  if (started) throw conflict('Accommodation cannot change after the candidate has started — use "extend time" instead');
  await prisma.enrollment.update({ where: { examId_candidateId: { examId: exam.id, candidateId } }, data: { extraTimePct } });
  audit(me.id, 'exam.accommodation', 'Exam', exam.id, { candidateId, extraTimePct });
  res.json({ ok: true });
});

examsRouter.delete('/:id/enrollments/:candidateId', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  const candidateId = param(req, 'candidateId');
  if (await prisma.attempt.findFirst({ where: { examId: exam.id, candidateId, isSandbox: false } })) throw conflict('This candidate has already attempted the exam and cannot be removed');
  await prisma.enrollment.delete({ where: { examId_candidateId: { examId: exam.id, candidateId } } });
  audit(me.id, 'exam.unenroll', 'Exam', exam.id, { candidateId });
  res.json({ ok: true });
});

/* --------------------------------- announcements -------------------------------- */

examsRouter.get('/:id/announcements', async (req, res) => {
  const exam = await loadExamForStaff(currentUser(req), param(req, 'id'));
  res.json(await prisma.announcement.findMany({ where: { examId: exam.id }, orderBy: { createdAt: 'desc' } }));
});

examsRouter.post('/:id/announcements', async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  const body = parseBody(z.object({ message: z.string().trim().min(1, 'Message cannot be empty').max(1000), candidateId: z.string().optional().nullable() }), req);
  if (body.candidateId && !(await prisma.enrollment.findUnique({ where: { examId_candidateId: { examId: exam.id, candidateId: body.candidateId } } }))) throw badRequest('That candidate is not enrolled in this exam');
  const a = await prisma.announcement.create({ data: { examId: exam.id, authorId: me.id, message: body.message, candidateId: body.candidateId || null } });
  if (a.candidateId) {
    const { emitToUser } = await import('../core/realtime.js');
    emitToUser(a.candidateId, 'announcement', a);
  } else emitToCandidates(exam.id, 'announcement', a);
  audit(me.id, 'exam.announce', 'Exam', exam.id, { message: body.message, to: a.candidateId ?? 'all' });
  res.status(201).json(a);
});
