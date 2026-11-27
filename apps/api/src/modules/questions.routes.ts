import { Router } from 'express';
import { z } from 'zod';
import Papa from 'papaparse';
import type { Prisma } from '@prisma/client';
import { prisma } from '../core/prisma.js';
import { authenticate, currentUser, requireRole } from '../core/auth.js';
import { badRequest } from '../core/errors.js';
import { param, parseBody, parseQuery } from '../core/validate.js';
import { loadQuestionForStaff } from '../core/policy.js';
import { audit } from '../core/audit.js';

export const questionsRouter = Router();
questionsRouter.use(authenticate, requireRole('ADMIN', 'EXAMINER'));

const LETTERS = 'abcdefghij';

const questionInput = z
  .object({
    topicId: z.string().optional(),
    topicName: z.string().trim().min(1).max(80).optional(),
    type: z.enum(['SINGLE', 'MULTI', 'WRITTEN']),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
    body: z.string().trim().min(3, 'Question text is too short').max(10000),
    options: z.array(z.object({ id: z.string().max(10).optional(), text: z.string().trim().min(1, 'Option text cannot be empty').max(2000) })).max(10).default([]),
    correct: z.array(z.string().max(10)).default([]),
    marks: z.number().positive('Marks must be greater than 0').max(100),
    negativeMarks: z.number().min(0).max(100).default(0),
    multiScheme: z.enum(['ALL_OR_NOTHING', 'PARTIAL', 'PARTIAL_NEGATIVE']).default('PARTIAL'),
    rubric: z.string().max(5000).optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  })
  .superRefine((q, ctx) => {
    if (!q.topicId && !q.topicName) ctx.addIssue({ code: 'custom', path: ['topicId'], message: 'Topic is required' });
    if (q.type === 'WRITTEN') return;
    if (q.options.length < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Objective questions need at least 2 options' });
    const ids = q.options.map((o, i) => o.id ?? LETTERS[i]);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Option ids must be unique' });
    if (new Set(q.options.map((o) => o.text.toLowerCase())).size !== q.options.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Two options have identical text' });
    const bad = q.correct.filter((c) => !ids.includes(c));
    if (bad.length) ctx.addIssue({ code: 'custom', path: ['correct'], message: `Correct answer refers to unknown option ${bad.join(',')}` });
    if (q.type === 'SINGLE' && q.correct.length !== 1) ctx.addIssue({ code: 'custom', path: ['correct'], message: 'Single-answer questions need exactly one correct option' });
    if (q.type === 'MULTI' && q.correct.length < 1) ctx.addIssue({ code: 'custom', path: ['correct'], message: 'Select at least one correct option' });
    if (q.negativeMarks > q.marks) ctx.addIssue({ code: 'custom', path: ['negativeMarks'], message: 'Negative marks cannot exceed the question marks' });
  });
type QuestionInput = z.infer<typeof questionInput>;

async function resolveTopic(tx: Prisma.TransactionClient, q: { topicId?: string; topicName?: string }) {
  if (q.topicId) {
    const t = await tx.topic.findUnique({ where: { id: q.topicId } });
    if (!t) throw badRequest('Topic not found');
    return t.id;
  }
  const name = q.topicName!.trim();
  const t = await tx.topic.upsert({ where: { name }, update: {}, create: { name } });
  return t.id;
}

const versionData = (q: QuestionInput) => {
  const options = q.type === 'WRITTEN' ? [] : q.options.map((o, i) => ({ id: o.id ?? LETTERS[i], text: o.text }));
  return {
    body: q.body,
    options,
    correct: q.type === 'WRITTEN' ? [] : [...new Set(q.correct)],
    marks: q.marks,
    negativeMarks: q.negativeMarks,
    multiScheme: q.multiScheme,
    rubric: q.rubric ?? null,
  };
};

const withCurrent = { versions: { orderBy: { version: 'desc' as const } }, topic: true, _count: { select: { examQuestions: true } } };
const shape = (q: Prisma.QuestionGetPayload<{ include: typeof withCurrent }>) => {
  const cur = q.versions.find((v) => v.version === q.currentVersion) ?? q.versions[0];
  return { ...q, current: cur, versionCount: q.versions.length, versions: undefined, usedInExams: q._count.examQuestions };
};

questionsRouter.get('/topics', async (req, res) => {
  const me = currentUser(req);
  const scope = me.role === 'EXAMINER' ? { ownerId: me.id } : {};
  const topics = await prisma.topic.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { questions: { where: { archived: false, ...scope } } } } } });
  res.json(topics.map((t) => ({ id: t.id, name: t.name, questionCount: t._count.questions })));
});

questionsRouter.post('/topics', async (req, res) => {
  const { name } = parseBody(z.object({ name: z.string().trim().min(1).max(80) }), req);
  res.status(201).json(await prisma.topic.create({ data: { name } }));
});

questionsRouter.get('/', async (req, res) => {
  const q = parseQuery(
    z.object({ search: z.string().max(200).optional(), topicId: z.string().optional(), difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(), type: z.enum(['SINGLE', 'MULTI', 'WRITTEN']).optional(), archived: z.enum(['true', 'false']).default('false') }),
    req,
  );
  const me = currentUser(req);
  const where: Prisma.QuestionWhereInput = {
    archived: q.archived === 'true',
    ...(me.role === 'EXAMINER' ? { ownerId: me.id } : {}),
    ...(q.topicId ? { topicId: q.topicId } : {}),
    ...(q.difficulty ? { difficulty: q.difficulty } : {}),
    ...(q.type ? { type: q.type } : {}),
    ...(q.search ? { OR: [{ versions: { some: { body: { contains: q.search, mode: 'insensitive' } } } }, { tags: { has: q.search } }] } : {}),
  };
  const items = await prisma.question.findMany({ where, include: withCurrent, orderBy: { updatedAt: 'desc' }, take: 500 });
  res.json(items.map(shape));
});

questionsRouter.get('/:id', async (req, res) => {
  const q = await loadQuestionForStaff(currentUser(req), param(req, 'id'));
  const full = await prisma.question.findUniqueOrThrow({ where: { id: q.id }, include: withCurrent });
  const versions = await prisma.questionVersion.findMany({ where: { questionId: q.id }, orderBy: { version: 'desc' } });
  res.json({ ...shape(full), versions });
});

async function similarExists(body: string, ownerId: string, excludeId?: string) {
  const norm = body.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
  const dupe = await prisma.questionVersion.findFirst({
    where: { body: { equals: body.trim(), mode: 'insensitive' }, question: { ownerId, archived: false, ...(excludeId ? { id: { not: excludeId } } : {}) } },
  });
  return dupe ? norm : null;
}

questionsRouter.post('/', async (req, res) => {
  const body = parseBody(questionInput, req);
  const me = currentUser(req);
  if (await similarExists(body.body, me.id)) throw badRequest('An identical question already exists in your bank');
  const q = await prisma.$transaction(async (tx) => {
    const topicId = await resolveTopic(tx, body);
    return tx.question.create({
      data: { ownerId: me.id, topicId, type: body.type, difficulty: body.difficulty, tags: body.tags, versions: { create: { version: 1, ...versionData(body) } } },
      include: withCurrent,
    });
  });
  audit(me.id, 'question.create', 'Question', q.id);
  res.status(201).json(shape(q));
});

/** Edits create a new immutable version — attempts already snapshot older versions, so they are never affected. */
questionsRouter.put('/:id', async (req, res) => {
  const me = currentUser(req);
  const existing = await loadQuestionForStaff(me, param(req, 'id'));
  const body = parseBody(questionInput, req);
  if (body.type !== existing.type) throw badRequest('Question type cannot be changed after creation; create a new question instead');
  const q = await prisma.$transaction(async (tx) => {
    const topicId = await resolveTopic(tx, body);
    const next = existing.currentVersion + 1;
    await tx.questionVersion.create({ data: { questionId: existing.id, version: next, ...versionData(body) } });
    return tx.question.update({ where: { id: existing.id }, data: { topicId, difficulty: body.difficulty, tags: body.tags, currentVersion: next }, include: withCurrent });
  });
  audit(me.id, 'question.update', 'Question', q.id, { version: q.currentVersion });
  res.json(shape(q));
});

questionsRouter.post('/:id/archive', async (req, res) => {
  const me = currentUser(req);
  const q = await loadQuestionForStaff(me, param(req, 'id'));
  const { archived } = parseBody(z.object({ archived: z.boolean() }), req);
  await prisma.question.update({ where: { id: q.id }, data: { archived } });
  audit(me.id, archived ? 'question.archive' : 'question.restore', 'Question', q.id);
  res.json({ ok: true });
});

questionsRouter.post('/:id/duplicate', async (req, res) => {
  const me = currentUser(req);
  const q = await loadQuestionForStaff(me, param(req, 'id'));
  const v = await prisma.questionVersion.findUniqueOrThrow({ where: { questionId_version: { questionId: q.id, version: q.currentVersion } } });
  const copy = await prisma.question.create({
    data: {
      ownerId: me.id, topicId: q.topicId, type: q.type, difficulty: q.difficulty, tags: q.tags,
      versions: { create: { version: 1, body: `${v.body} (copy)`, options: v.options as Prisma.InputJsonValue, correct: v.correct as Prisma.InputJsonValue, marks: v.marks, negativeMarks: v.negativeMarks, multiScheme: v.multiScheme, rubric: v.rubric } },
    },
    include: withCurrent,
  });
  res.status(201).json(shape(copy));
});

/**
 * Bulk import. CSV columns: type,topic,difficulty,question,options,correct,marks,negative_marks,scheme,rubric,tags
 * options are separated by "|" and correct answers are letters, e.g. "A|C".
 */
questionsRouter.post('/import', async (req, res) => {
  const body = parseBody(z.object({ format: z.enum(['csv', 'json']), content: z.string().max(3_000_000), dryRun: z.boolean().default(true) }), req);
  const me = currentUser(req);
  let raw: Record<string, unknown>[];
  if (body.format === 'csv') {
    const parsed = Papa.parse<Record<string, string>>(body.content.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
    if (parsed.errors.length) throw badRequest(`CSV parse error on row ${(parsed.errors[0].row ?? 0) + 2}: ${parsed.errors[0].message}`);
    const missing = ['type', 'topic', 'difficulty', 'question', 'marks'].filter((h) => !parsed.meta.fields?.includes(h));
    if (missing.length) throw badRequest(`CSV is missing required column(s): ${missing.join(', ')}`);
    raw = parsed.data.map((r) => {
      const options = (r.options ?? '').split('|').map((s) => s.trim()).filter(Boolean);
      return {
        type: (r.type ?? '').trim().toUpperCase(),
        topicName: r.topic,
        difficulty: (r.difficulty ?? '').trim().toUpperCase(),
        body: r.question,
        options: options.map((text) => ({ text })),
        correct: (r.correct ?? '').split('|').map((s) => s.trim().toLowerCase()).filter(Boolean),
        marks: Number(r.marks),
        negativeMarks: r.negative_marks ? Number(r.negative_marks) : 0,
        multiScheme: r.scheme ? r.scheme.trim().toUpperCase() : undefined,
        rubric: r.rubric || null,
        tags: (r.tags ?? '').split('|').map((s) => s.trim()).filter(Boolean),
      };
    });
  } else {
    try {
      const j = JSON.parse(body.content);
      if (!Array.isArray(j)) throw new Error();
      raw = j.map((r: Record<string, unknown>) => ({ ...r, topicName: r.topicName ?? r.topic, body: r.body ?? r.question }));
    } catch {
      throw badRequest('JSON must be an array of question objects');
    }
  }
  if (!raw.length) throw badRequest('File contains no rows');
  if (raw.length > 1000) throw badRequest('Maximum 1000 questions per import');

  const seen = new Set<string>();
  const results = await Promise.all(
    raw.map(async (r, i) => {
      const row = body.format === 'csv' ? i + 2 : i + 1;
      const p = questionInput.safeParse(r);
      if (!p.success) return { row, ok: false, errors: p.error.issues.map((x) => `${x.path.join('.') || 'row'}: ${x.message}`), preview: String(r.body ?? '').slice(0, 80) };
      const key = p.data.body.toLowerCase();
      const errors: string[] = [];
      if (seen.has(key)) errors.push('duplicate question within file');
      seen.add(key);
      if (await similarExists(p.data.body, me.id)) errors.push('identical question already in your bank');
      return { row, ok: errors.length === 0, errors, preview: p.data.body.slice(0, 80), data: p.data };
    }),
  );
  const valid = results.filter((r) => r.ok);
  if (body.dryRun) return res.json({ total: raw.length, valid: valid.length, invalid: raw.length - valid.length, results: results.map((r) => ({ ...r, data: undefined })) });

  await prisma.$transaction(async (tx) => {
    for (const r of valid) {
      const d = r.data!;
      const topicId = await resolveTopic(tx, d);
      await tx.question.create({ data: { ownerId: me.id, topicId, type: d.type, difficulty: d.difficulty, tags: d.tags, versions: { create: { version: 1, ...versionData(d) } } } });
    }
  });
  audit(me.id, 'question.import', 'Question', null, { count: valid.length });
  res.json({ total: raw.length, created: valid.length, skipped: raw.length - valid.length, results: results.map((r) => ({ ...r, data: undefined })) });
});
