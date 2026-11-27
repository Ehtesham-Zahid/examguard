/** Admin email log: what was sent, to whom, previews, retries and a delivery test. */
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../core/prisma.js';
import { authenticate, currentUser, requireRole } from '../core/auth.js';
import { badRequest, conflict, notFound } from '../core/errors.js';
import { param, parseBody, parseQuery } from '../core/validate.js';
import { audit } from '../core/audit.js';
import { config, emailConfigured, emailMode } from '../core/config.js';
import { fromAddress, isReservedAddress, kick, queueEmails, renderRowForPreview, verifyTransport } from '../services/email/outbox.js';

export const emailsRouter = Router();
emailsRouter.use(authenticate, requireRole('ADMIN'));

const STATUSES = ['PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
const TOKEN_KINDS = ['welcome', 'password_reset', 'password_forgot'];

emailsRouter.get('/', async (req, res) => {
  const q = parseQuery(
    z.object({ status: z.preprocess((v) => (typeof v === 'string' && v ? v.split(',') : undefined), z.array(z.enum(STATUSES)).optional()), category: z.enum(['exams', 'results', 'disputes', 'account']).optional(), q: z.string().trim().max(120).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(5).max(100).default(25) }),
    req,
  );
  const where: Prisma.EmailOutboxWhereInput = {
    ...(q.status?.length ? { status: { in: q.status } } : {}),
    ...(q.category ? { category: q.category } : {}),
    ...(q.q ? { OR: [{ to: { contains: q.q, mode: 'insensitive' } }, { subject: { contains: q.q, mode: 'insensitive' } }] } : {}),
  };
  const [items, total, counts] = await Promise.all([
    prisma.emailOutbox.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: { id: true, to: true, kind: true, category: true, subject: true, status: true, attempts: true, lastError: true, createdAt: true, sentAt: true, sendAfter: true, user: { select: { name: true, role: true } } } }),
    prisma.emailOutbox.count({ where }),
    prisma.emailOutbox.groupBy({ by: ['status'], _count: true }),
  ]);
  res.json({
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    counts: Object.fromEntries(STATUSES.map((s) => [s, counts.find((c) => c.status === s)?._count ?? 0])),
    config: { configured: emailConfigured(), mode: emailMode(), from: emailMode() === 'relay' ? 'your Google account (Apps Script)' : fromAddress(), host: emailMode() === 'relay' ? 'Google Apps Script relay (HTTPS)' : `${config.email.host}:${config.email.port}`, user: config.email.user || null, timeZone: config.email.timeZone },
  });
});

emailsRouter.get('/status', async (_req, res) => {
  res.json({ configured: emailConfigured(), mode: emailMode(), check: await verifyTransport() });
});

emailsRouter.get('/:id', async (req, res) => {
  const row = await prisma.emailOutbox.findUnique({ where: { id: param(req, 'id') }, include: { user: { select: { name: true, role: true } } } });
  if (!row) throw notFound();
  const r = renderRowForPreview(row);
  res.json({ ...row, data: undefined, html: r.html, text: r.text, hasCalendarInvite: row.kind === 'exam_scheduled' || row.kind === 'exam_reminder', linkRedacted: TOKEN_KINDS.includes(row.kind) && !(row.data as { token?: string })?.token });
});

/** Retry a failed/skipped email (e.g. after configuring SMTP). Sent link emails can't be resent — links are single-use. */
emailsRouter.post('/:id/retry', async (req, res) => {
  const row = await prisma.emailOutbox.findUnique({ where: { id: param(req, 'id') } });
  if (!row) throw notFound();
  if (row.status === 'PENDING' || row.status === 'SENDING') throw conflict('This email is already queued');
  if (TOKEN_KINDS.includes(row.kind) && !(row.data as { token?: string })?.token) throw conflict('This email contained a one-time link that was already delivered. Send a fresh password reset instead.');
  if (row.status === 'SENT') {
    // a sent email is copied (keeps the original record intact)
    const copy = await prisma.emailOutbox.create({ data: { userId: row.userId, to: row.to, kind: row.kind, category: row.category, subject: row.subject, data: row.data as Prisma.InputJsonValue } });
    audit(currentUser(req).id, 'email.resend', 'EmailOutbox', copy.id, { original: row.id, to: row.to });
    kick();
    return res.json({ id: copy.id });
  }
  await prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'PENDING', attempts: 0, lastError: null, sendAfter: new Date() } });
  audit(currentUser(req).id, 'email.retry', 'EmailOutbox', row.id, { to: row.to });
  kick();
  res.json({ id: row.id });
});

emailsRouter.post('/test', async (req, res) => {
  const me = currentUser(req);
  const { to } = parseBody(z.object({ to: z.string().trim().toLowerCase().email('Enter a valid email address') }), req);
  if (isReservedAddress(to) && !config.email.allowReservedDomains) throw badRequest('That is a reserved demo domain that can never receive mail — use a real inbox');
  await queueEmails([{ user: { id: me.id, email: to, name: me.name }, kind: 'test', data: { sentBy: me.name, at: new Date().toISOString() } }]);
  const row = await prisma.emailOutbox.findFirst({ where: { kind: 'test', to }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  audit(me.id, 'email.test', 'EmailOutbox', row?.id ?? null, { to });
  res.status(201).json({ id: row?.id });
});
