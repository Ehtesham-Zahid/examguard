/**
 * Email outbox: callers queue rows next to the event (never blocking the request on SMTP); a background worker
 * claims due rows with FOR UPDATE SKIP LOCKED, sends them, and retries failures with exponential backoff.
 * dedupeKey makes every logical email exactly-once (a double-clicked "publish" or two server instances
 * can't send the same reminder twice).
 */
import crypto from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { Prisma, type EmailOutbox } from '@prisma/client';
import { prisma } from '../../core/prisma.js';
import { config, emailConfigured } from '../../core/config.js';
import { CATEGORY, examIcs, renderEmail, type EmailData, type EmailKind, type ExamInfo } from './templates.js';

const MAX_ATTEMPTS = 5;
const BATCH = 10;

/* ------------------------------------------------------------------ preferences */
export type EmailPrefs = { emailExams?: boolean; emailResults?: boolean; emailDisputes?: boolean };
const PREF_KEY = { exams: 'emailExams', results: 'emailResults', disputes: 'emailDisputes' } as const;

export function wantsEmail(prefs: unknown, kind: EmailKind) {
  const cat = CATEGORY[kind];
  if (cat === 'account') return true; // security & account emails can't be turned off
  const p = (prefs ?? {}) as EmailPrefs;
  return p[PREF_KEY[cat]] !== false;
}

/** Reserved / demo domains that can never receive mail (RFC 2606 + .local). */
export function isReservedAddress(email: string) {
  const d = email.split('@')[1]?.toLowerCase() ?? '';
  return /\.(test|example|invalid|localhost|local)$/.test(d) || ['example.com', 'example.org', 'example.net', 'localhost'].includes(d);
}

/* ------------------------------------------------------------------ queueing */
export interface Recipient {
  id: string;
  email: string;
  name: string;
  prefs?: unknown;
  status?: string;
}
export interface QueueItem {
  user: Recipient;
  kind: EmailKind;
  data?: Record<string, unknown>;
  dedupeKey?: string;
  sendAfter?: Date;
}

function toRow(i: QueueItem): Prisma.EmailOutboxCreateManyInput {
  const data = { ...(i.data ?? {}), name: i.user.name, email: i.user.email } as EmailData;
  const optedOut = !wantsEmail(i.user.prefs, i.kind);
  const inactive = i.user.status && i.user.status !== 'ACTIVE';
  return {
    userId: i.user.id,
    to: i.user.email,
    kind: i.kind,
    category: CATEGORY[i.kind],
    subject: renderEmail(i.kind, data).subject,
    data: data as Prisma.InputJsonValue,
    dedupeKey: i.dedupeKey,
    sendAfter: i.sendAfter ?? new Date(),
    ...(optedOut || inactive ? { status: 'SKIPPED' as const, lastError: optedOut ? 'Recipient turned this type of email off' : 'Account is disabled' } : {}),
  };
}

/** Queue emails; duplicates (same dedupeKey) are ignored. Never throws into the caller's request. */
export async function queueEmails(items: QueueItem[]) {
  if (!items.length) return 0;
  try {
    const r = await prisma.emailOutbox.createMany({ data: items.map(toRow), skipDuplicates: true });
    kick();
    return r.count;
  } catch (e) {
    console.error('[email] failed to queue', e);
    return 0;
  }
}
export const queueEmail = (i: QueueItem) => queueEmails([i]);

/** Queue the same email for many user ids (loads names, addresses and preferences). */
export async function queueForUsers(userIds: string[], kind: EmailKind, data: Record<string, unknown>, dedupe?: (userId: string) => string) {
  if (!userIds.length) return 0;
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, name: true, prefs: true, status: true } });
  return queueEmails(users.map((u) => ({ user: u, kind, data, dedupeKey: dedupe?.(u.id) })));
}

export const examInfo = (e: { id: string; title: string; windowStart: Date; windowEnd: Date; durationMin: number; totalMarks?: number; accessCode?: string | null; owner?: { name: string } | null }, extraTimePct = 0): ExamInfo => ({
  examId: e.id,
  title: e.title,
  windowStart: e.windowStart.toISOString(),
  windowEnd: e.windowEnd.toISOString(),
  durationMin: e.durationMin,
  extraTimePct,
  totalMarks: e.totalMarks,
  requiresAccessCode: !!e.accessCode,
  examiner: e.owner?.name,
});

/** Exam emails carry each candidate's own extra-time accommodation, so they're queued per enrolment. */
export async function queueExamEmail(examId: string, candidateIds: string[] | 'all', kind: 'exam_scheduled' | 'exam_reminder' | 'exam_open', dedupe: (userId: string) => string) {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { owner: { select: { name: true } } } });
  if (!exam) return 0;
  const enr = await prisma.enrollment.findMany({
    where: { examId, ...(candidateIds === 'all' ? {} : { candidateId: { in: candidateIds } }) },
    include: { candidate: { select: { id: true, email: true, name: true, prefs: true, status: true } } },
  });
  return queueEmails(enr.map((e) => ({ user: e.candidate, kind, data: { exam: examInfo(exam, e.extraTimePct ?? 0) }, dedupeKey: dedupe(e.candidateId) })));
}

/* ------------------------------------------------------------------ password tokens */
export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

/** Creates a single-use set/reset-password link token (only its hash is stored) and invalidates older ones. */
export async function issuePasswordToken(userId: string, purpose: 'welcome' | 'reset' | 'forgot', ttlMs: number) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlMs);
  await prisma.$transaction([
    prisma.passwordToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordToken.create({ data: { userId, purpose, tokenHash: hashToken(token), expiresAt } }),
  ]);
  return { token, expiresAt };
}

/* ------------------------------------------------------------------ transport */
let transporter: Transporter | null = null;
let transportKey = '';
let testTransport: Transporter | null = null;

/** Lets the test suite route mail to an in-process SMTP sink. */
export function setTestTransport(t: Transporter | null) {
  testTransport = t;
}
function getTransport() {
  if (testTransport) return testTransport;
  const { host, port, user, pass } = config.email;
  const key = `${host}:${port}:${user}:${pass.length}`;
  if (!transporter || key !== transportKey) {
    transporter?.close();
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      // STARTTLS is mandatory for real providers; a local test sink (localhost) runs without TLS
      requireTLS: port !== 465 && !['localhost', '127.0.0.1'].includes(host),
      ignoreTLS: ['localhost', '127.0.0.1'].includes(host),
      auth: { user, pass },
      pool: true,
      maxConnections: 2,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5, // well under Gmail's burst limits
      connectionTimeout: 15_000,
      socketTimeout: 30_000,
    });
    transportKey = key;
  }
  return transporter;
}
export const fromAddress = () => config.email.from || (config.email.user ? `ExamGuard <${config.email.user}>` : 'ExamGuard <no-reply@examguard.local>');

export async function verifyTransport() {
  if (!emailConfigured() && !testTransport) return { ok: false, error: 'Email is not configured: set SMTP_USER and SMTP_PASS' };
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

function friendlyError(e: unknown) {
  const err = e as { code?: string; responseCode?: number; message?: string };
  if (err.responseCode === 535 || /Username and Password not accepted|Invalid login/i.test(err.message ?? '')) return 'Gmail rejected the login — check SMTP_USER and that SMTP_PASS is a 16-character App Password (2-Step Verification must be on).';
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNECTION' || err.code === 'ESOCKET') return `Could not reach ${config.email.host}:${config.email.port} (${err.code}). The host may block outbound SMTP — try SMTP_PORT=587.`;
  return (err.message ?? String(e)).slice(0, 500);
}

/* ------------------------------------------------------------------ rendering & sending */
export function renderRow(row: Pick<EmailOutbox, 'kind' | 'data'>) {
  return renderEmail(row.kind as EmailKind, row.data as EmailData);
}

function attachmentsFor(row: EmailOutbox) {
  const d = row.data as EmailData;
  if ((row.kind === 'exam_scheduled' || row.kind === 'exam_reminder') && d.exam) {
    return [{ filename: 'exam.ics', content: examIcs(d.exam as ExamInfo), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }];
  }
  return [];
}

/** Links with tokens are removed from stored data once delivered, so the log never holds a usable link. */
function redact(data: unknown) {
  const d = { ...(data as Record<string, unknown>) };
  if ('token' in d) d.token = null;
  return d as Prisma.InputJsonValue;
}

async function deliver(row: EmailOutbox) {
  if (isReservedAddress(row.to) && !config.email.allowReservedDomains) {
    return prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'SKIPPED', lastError: 'Demo address on a reserved domain — it can never receive mail' } });
  }
  if (!emailConfigured() && !testTransport) {
    return prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'SKIPPED', lastError: 'Email delivery is not configured (set SMTP_USER and SMTP_PASS)' } });
  }
  const r = renderRow(row);
  try {
    const info = await getTransport().sendMail({
      from: fromAddress(),
      to: row.to,
      replyTo: config.email.replyTo,
      subject: r.subject,
      html: r.html,
      text: r.text,
      attachments: attachmentsFor(row),
      headers: { 'X-ExamGuard-Email': row.kind, 'X-Entity-Ref-ID': row.id },
    });
    await prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), messageId: info.messageId ?? null, lastError: null, data: redact(row.data) } });
  } catch (e) {
    // 5xx = permanent rejection (bad address, auth refused): retrying won't help, an admin can retry after fixing it
    const permanent = ((e as { responseCode?: number }).responseCode ?? 0) >= 500;
    const final = permanent || row.attempts >= MAX_ATTEMPTS;
    const backoffSec = Math.min(3600, 30 * 2 ** (row.attempts - 1)); // 30s, 1m, 2m, 4m…
    await prisma.emailOutbox.update({
      where: { id: row.id },
      data: { status: final ? 'FAILED' : 'PENDING', lastError: friendlyError(e), sendAfter: new Date(Date.now() + backoffSec * 1000) },
    });
  }
}

/** Claims due rows atomically; safe with several server instances. */
async function claim() {
  // Prisma stores DateTime as UTC in a zone-less column, so compare with the app's clock rather than now(),
  // which Postgres would interpret in the database session's time zone.
  // (a Date parameter is sent as timestamptz and converted back through the session zone, so pass UTC wall time)
  const now = new Date().toISOString().replace('Z', '');
  return prisma.$queryRaw<EmailOutbox[]>`
    UPDATE "EmailOutbox" SET "status" = 'SENDING', "attempts" = "attempts" + 1, "updatedAt" = ${now}::timestamp
    WHERE "id" IN (
      SELECT "id" FROM "EmailOutbox" WHERE "status" = 'PENDING' AND "sendAfter" <= ${now}::timestamp
      ORDER BY "sendAfter" ASC LIMIT ${BATCH} FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
}

let running = false;
let again = false;
export async function processOutbox() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      // a crash mid-send leaves rows in SENDING: hand them back after 10 minutes
      await prisma.emailOutbox.updateMany({ where: { status: 'SENDING', updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { status: 'PENDING' } });
      for (;;) {
        const rows = await claim();
        if (!rows.length) break;
        for (const row of rows) await deliver(row);
      }
    } while (again);
  } catch (e) {
    console.error('[email] worker error', e);
  } finally {
    running = false;
  }
}

let kickTimer: NodeJS.Timeout | null = null;
/** Process soon after something was queued (debounced), instead of waiting for the next tick. */
export function kick() {
  if (kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    void processOutbox();
  }, 250);
}

/* ------------------------------------------------------------------ scheduled exam emails */
const HOUR = 3600_000;
/**
 * Reminder ~24h before the window opens (skipped if the candidate was told about the exam in the last 12h),
 * and an "open now" email in the first 30 minutes of the window for candidates who haven't started.
 */
export async function scheduleExamEmails(now = new Date()) {
  const t = now.getTime();
  const soon = await prisma.exam.findMany({
    where: { status: 'PUBLISHED', windowStart: { gt: new Date(t + 2 * HOUR), lte: new Date(t + 24 * HOUR) }, publishedAt: { lt: new Date(t - 12 * HOUR) } },
    select: { id: true },
  });
  for (const e of soon) {
    const recent = await prisma.emailOutbox.findMany({ where: { kind: 'exam_scheduled', createdAt: { gt: new Date(t - 12 * HOUR) }, dedupeKey: { startsWith: `scheduled:${e.id}:` } }, select: { userId: true } });
    const skip = new Set(recent.map((r) => r.userId));
    const ids = (await prisma.enrollment.findMany({ where: { examId: e.id }, select: { candidateId: true } })).map((x) => x.candidateId).filter((id) => !skip.has(id));
    if (ids.length) await queueExamEmail(e.id, ids, 'exam_reminder', (u) => `reminder:${e.id}:${u}`);
  }
  const open = await prisma.exam.findMany({
    where: { status: 'PUBLISHED', pausedAt: null, windowStart: { lte: now, gt: new Date(t - 30 * 60_000) }, windowEnd: { gt: now } },
    select: { id: true },
  });
  for (const e of open) {
    const started = new Set((await prisma.attempt.findMany({ where: { examId: e.id }, select: { candidateId: true } })).map((a) => a.candidateId));
    const ids = (await prisma.enrollment.findMany({ where: { examId: e.id }, select: { candidateId: true } })).map((x) => x.candidateId).filter((id) => !started.has(id));
    if (ids.length) await queueExamEmail(e.id, ids, 'exam_open', (u) => `open:${e.id}:${u}`);
  }
}

export function startEmailWorker() {
  if (emailConfigured()) {
    void verifyTransport().then((r) => console.log(r.ok ? `[email] SMTP ready (${config.email.host}:${config.email.port} as ${config.email.user})` : `[email] SMTP check failed: ${r.error}`));
  } else {
    console.log('[email] SMTP_USER / SMTP_PASS not set — emails are recorded in the admin email log but not delivered');
  }
  const send = setInterval(() => void processOutbox(), 15_000);
  let scheduling = false;
  const schedule = setInterval(async () => {
    if (scheduling) return;
    scheduling = true;
    try {
      await scheduleExamEmails();
    } catch (e) {
      console.error('[email] scheduler error', e);
    } finally {
      scheduling = false;
    }
  }, 60_000);
  void processOutbox();
  return () => {
    clearInterval(send);
    clearInterval(schedule);
  };
}
