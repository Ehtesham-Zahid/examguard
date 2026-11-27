import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import Papa from 'papaparse';
import { prisma } from '../core/prisma.js';
import { authenticate, currentUser, requireRole } from '../core/auth.js';
import { badRequest } from '../core/errors.js';
import { param, parseBody, parseQuery } from '../core/validate.js';
import { audit, verifyAuditChain } from '../core/audit.js';
import { passwordSchema } from './auth.routes.js';
import { loadExamForStaff } from '../core/policy.js';

export const usersRouter = Router();
usersRouter.use(authenticate);

const select = { id: true, name: true, email: true, role: true, status: true, groupName: true, mustChangePassword: true, createdAt: true, lockedUntil: true };

// Examiners may list candidates (to enrol them); admins may list everyone
usersRouter.get('/', requireRole('ADMIN', 'EXAMINER'), async (req, res) => {
  const q = parseQuery(
    z.object({ search: z.string().max(100).optional(), role: z.enum(['ADMIN', 'EXAMINER', 'CANDIDATE']).optional(), group: z.string().max(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(50) }),
    req,
  );
  const me = currentUser(req);
  const role = me.role === 'EXAMINER' ? 'CANDIDATE' : q.role;
  const where = {
    ...(role ? { role } : {}),
    ...(q.group ? { groupName: q.group } : {}),
    ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' as const } }, { email: { contains: q.search, mode: 'insensitive' as const } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, select, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.user.count({ where }),
  ]);
  res.json({ items, total });
});

usersRouter.get('/groups', requireRole('ADMIN', 'EXAMINER'), async (_req, res) => {
  const groups = await prisma.user.groupBy({ by: ['groupName'], where: { role: 'CANDIDATE', groupName: { not: null } }, _count: true });
  res.json(groups.map((g) => ({ name: g.groupName, count: g._count })));
});

const createSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(100),
  email: z.string().trim().toLowerCase().email('Invalid email'),
  role: z.enum(['ADMIN', 'EXAMINER', 'CANDIDATE']),
  password: passwordSchema.optional(),
  groupName: z.string().trim().max(60).optional().nullable(),
});

const tempPassword = () => `Eg-${crypto.randomBytes(4).toString('hex')}1`;

usersRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const body = parseBody(createSchema, req);
  const password = body.password ?? tempPassword();
  const user = await prisma.user.create({
    data: { name: body.name, email: body.email, role: body.role, groupName: body.groupName || null, passwordHash: await bcrypt.hash(password, 10), mustChangePassword: !body.password },
    select,
  });
  audit(currentUser(req).id, 'user.create', 'User', user.id, { email: user.email, role: user.role });
  res.status(201).json({ user, temporaryPassword: body.password ? undefined : password });
});

usersRouter.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const id = param(req, 'id');
  const body = parseBody(
    z.object({ name: z.string().trim().min(2).max(100).optional(), role: z.enum(['ADMIN', 'EXAMINER', 'CANDIDATE']).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional(), groupName: z.string().trim().max(60).nullable().optional() }),
    req,
  );
  const me = currentUser(req);
  if (id === me.id && (body.role && body.role !== 'ADMIN' || body.status === 'DISABLED')) throw badRequest('You cannot demote or disable your own account');
  const before = await prisma.user.findUniqueOrThrow({ where: { id }, select });
  const user = await prisma.user.update({
    where: { id },
    data: { ...body, ...(body.status === 'DISABLED' || (body.role && body.role !== before.role) ? { tokenVersion: { increment: 1 } } : {}) },
    select,
  });
  audit(me.id, 'user.update', 'User', id, { before: { role: before.role, status: before.status }, after: body });
  res.json({ user });
});

usersRouter.post('/:id/reset-password', requireRole('ADMIN'), async (req, res) => {
  const id = param(req, 'id');
  const password = tempPassword();
  await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true, tokenVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null } });
  audit(currentUser(req).id, 'user.reset_password', 'User', id);
  res.json({ temporaryPassword: password });
});

/** Bulk candidate import: CSV text or JSON array. dryRun=true returns a validation preview. */
const importRow = z.object({
  name: z.string().trim().min(2, 'name is required (min 2 chars)').max(100),
  email: z.string().trim().toLowerCase().email('email is invalid'),
  group: z.string().trim().max(60).optional().nullable(),
  password: z.string().optional(),
});

usersRouter.post('/import', requireRole('ADMIN', 'EXAMINER'), async (req, res) => {
  const body = parseBody(z.object({ format: z.enum(['csv', 'json']), content: z.string().max(2_000_000), dryRun: z.boolean().default(true), enrollExamId: z.string().optional() }), req);
  let rows: Record<string, unknown>[];
  if (body.format === 'csv') {
    const parsed = Papa.parse<Record<string, unknown>>(body.content.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
    if (parsed.errors.length) throw badRequest(`CSV parse error on row ${(parsed.errors[0].row ?? 0) + 2}: ${parsed.errors[0].message}`);
    const missing = ['name', 'email'].filter((h) => !parsed.meta.fields?.includes(h));
    if (missing.length) throw badRequest(`CSV is missing required column(s): ${missing.join(', ')}`);
    rows = parsed.data;
  } else {
    try {
      const j = JSON.parse(body.content);
      if (!Array.isArray(j)) throw new Error();
      rows = j;
    } catch {
      throw badRequest('JSON must be an array of objects: [{"name","email","group"}]');
    }
  }
  if (rows.length === 0) throw badRequest('File contains no rows');
  if (body.enrollExamId) {
    const exam = await loadExamForStaff(currentUser(req), body.enrollExamId);
    if (exam.status === 'COMPLETED' || exam.status === 'ARCHIVED' || exam.windowEnd < new Date()) throw badRequest('Cannot enrol candidates in a completed examination');
  }
  if (rows.length > 2000) throw badRequest('Maximum 2000 rows per import');

  const seen = new Set<string>();
  const existing = new Set((await prisma.user.findMany({ where: { email: { in: rows.map((r) => String(r.email ?? '').trim().toLowerCase()) } }, select: { email: true } })).map((u) => u.email));
  const results = rows.map((raw, i) => {
    const r = importRow.safeParse(raw);
    const rowNo = body.format === 'csv' ? i + 2 : i + 1;
    if (!r.success) return { row: rowNo, ok: false, errors: r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`), data: raw };
    const errors: string[] = [];
    if (seen.has(r.data.email)) errors.push('duplicate email within file');
    if (existing.has(r.data.email)) errors.push('email already registered');
    seen.add(r.data.email);
    return { row: rowNo, ok: errors.length === 0, errors, data: r.data };
  });
  const valid = results.filter((r) => r.ok);
  if (body.dryRun) return res.json({ total: rows.length, valid: valid.length, invalid: rows.length - valid.length, results });

  const created: { name: string; email: string; temporaryPassword: string }[] = [];
  await prisma.$transaction(async (tx) => {
    for (const r of valid) {
      const d = r.data as z.infer<typeof importRow>;
      const pw = d.password && d.password.length >= 8 ? d.password : tempPassword();
      const u = await tx.user.create({ data: { name: d.name, email: d.email, role: 'CANDIDATE', groupName: d.group || null, passwordHash: await bcrypt.hash(pw, 8), mustChangePassword: true } });
      if (body.enrollExamId) await tx.enrollment.create({ data: { examId: body.enrollExamId, candidateId: u.id } });
      created.push({ name: d.name, email: d.email, temporaryPassword: pw });
    }
  });
  audit(currentUser(req).id, 'user.import', 'User', null, { count: created.length });
  res.json({ total: rows.length, created: created.length, skipped: rows.length - created.length, credentials: created, results });
});

usersRouter.get('/admin/overview', requireRole('ADMIN'), async (_req, res) => {
  const now = new Date();
  const [byRole, exams, live, activeAttempts, openIncidents, openDisputes, chain] = await Promise.all([
    prisma.user.groupBy({ by: ['role'], _count: true }),
    prisma.exam.count(),
    prisma.exam.count({ where: { status: 'PUBLISHED', windowStart: { lte: now }, windowEnd: { gte: now } } }),
    prisma.attempt.count({ where: { status: 'IN_PROGRESS', isSandbox: false } }),
    prisma.incident.count({ where: { status: 'OPEN' } }),
    prisma.dispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
    verifyAuditChain(),
  ]);
  res.json({ users: Object.fromEntries(byRole.map((r) => [r.role, r._count])), exams, liveExams: live, activeAttempts, openIncidents, openDisputes, auditChain: chain });
});

usersRouter.get('/admin/audit', requireRole('ADMIN'), async (req, res) => {
  const q = parseQuery(z.object({ entity: z.string().optional(), take: z.coerce.number().int().min(1).max(500).default(100) }), req);
  const logs = await prisma.auditLog.findMany({ where: q.entity ? { entity: q.entity } : {}, orderBy: { seq: 'desc' }, take: q.take });
  const actors = await prisma.user.findMany({ where: { id: { in: [...new Set(logs.map((l) => l.actorId).filter(Boolean) as string[])] } }, select: { id: true, name: true, role: true } });
  const map = Object.fromEntries(actors.map((a) => [a.id, a]));
  res.json({ logs: logs.map((l) => ({ ...l, actor: l.actorId ? map[l.actorId] : null })), chain: await verifyAuditChain() });
});
