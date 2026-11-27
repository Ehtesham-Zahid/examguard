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
import { config, emailConfigured, emailMode } from '../../core/config.js';
import { CATEGORY, examIcs, renderEmail, type EmailData, type EmailKind, type ExamInfo } from './templates.js';

const MAX_ATTEMPTS = 8; // 30s → ~1h backoff: about two hours of retries for transient outages
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
  try {
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, name: true, prefs: true, status: true } });
    return await queueEmails(users.map((u) => ({ user: u, kind, data, dedupeKey: dedupe?.(u.id) })));
  } catch (e) {
    console.error('[email] failed to queue', kind, e); // never fail the action that triggered the email
    return 0;
  }
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
  try {
    const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { owner: { select: { name: true } } } });
    if (!exam) return 0;
    const enr = await prisma.enrollment.findMany({
      where: { examId, ...(candidateIds === 'all' ? {} : { candidateId: { in: candidateIds } }) },
      include: { candidate: { select: { id: true, email: true, name: true, prefs: true, status: true } } },
    });
    return await queueEmails(enr.map((e) => ({ user: e.candidate, kind, data: { exam: examInfo(exam, e.extraTimePct ?? 0) }, dedupeKey: dedupe(e.candidateId) })));
  } catch (e) {
    console.error('[email] failed to queue', kind, e);
    return 0;
  }
}

/** Dedupe keys include the window start, so moving an exam re-announces it and re-arms reminders. */
export const examKey = (kind: 'scheduled' | 'reminder' | 'open', exam: { id: string; windowStart: Date }, userId: string) => `${kind}:${exam.id}:${userId}:${exam.windowStart.getTime()}`;

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
export const fromAddress = () => config.email.from || (config.email.user ? `ExamGuard <${config.email.user}>` : 'ExamGuard');
const NOT_CONFIGURED = 'Email delivery is not configured (set EMAIL_RELAY_URL + EMAIL_RELAY_SECRET, or SMTP_USER + SMTP_PASS)';

/* ---- Google Apps Script relay: HTTPS POST to a web app that calls MailApp.sendEmail (see scripts/google-apps-script) */
class RelayError extends Error {
  constructor(
    message: string,
    public permanent = false,
    public quota = false,
  ) {
    super(message);
  }
}
interface RelayMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  attachments?: { filename: string; contentType: string; base64: string }[];
}
async function callRelay(body: Record<string, unknown>) {
  let res: Response;
  try {
    // Apps Script answers a POST with a 302 to the result; fetch follows it (as GET), which is what Apps Script expects
    res = await fetch(config.email.relayUrl, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: config.email.relaySecret, ...body }), redirect: 'follow', signal: AbortSignal.timeout(45_000) });
  } catch (e) {
    throw new RelayError(`Could not reach the email relay (${(e as Error).name === 'TimeoutError' ? 'timed out' : (e as Error).message}).`);
  }
  const raw = await res.text();
  let json: { ok?: boolean; error?: string; id?: string; quota?: number; account?: string } | null = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // Google 5xx pages are transient; any other HTML means the deployment is wrong (not "Anyone" access, or a /dev URL)
    if (res.status >= 500) throw new RelayError(`Google Apps Script is temporarily unavailable (HTTP ${res.status}).`);
    throw new RelayError(/<html|<!doctype/i.test(raw) ? 'The relay URL returned a web page instead of JSON — redeploy the Apps Script as a Web app with access "Anyone" and use the /exec URL.' : `Relay returned an unexpected response (HTTP ${res.status}).`, true);
  }
  if (!json?.ok) {
    const msg = json?.error ?? `Relay error (HTTP ${res.status})`;
    // wrong secret / bad request won't fix themselves; quota and Google hiccups will
    throw new RelayError(msg, /secret|invalid|unauthori[sz]ed|bad request/i.test(msg), /quota|too many times/i.test(msg));
  }
  return json;
}

export async function verifyTransport(): Promise<{ ok: boolean; error?: string; quota?: number; account?: string }> {
  if (testTransport) return { ok: true };
  const mode = emailMode();
  if (!mode) return { ok: false, error: NOT_CONFIGURED };
  try {
    if (mode === 'relay') {
      const r = await callRelay({ action: 'ping' });
      return { ok: true, quota: r.quota, account: r.account };
    }
    await getTransport().verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

async function send(msg: RelayMessage & { kind: string; id: string }) {
  if (emailMode() === 'relay' && !testTransport) {
    const r = await callRelay({ action: 'send', ...msg, name: (config.email.from.match(/^(.*?)\s*</)?.[1] || 'ExamGuard').replace(/"/g, '') });
    return r.id ?? null;
  }
  const info = await getTransport().sendMail({
    from: fromAddress(),
    to: msg.to,
    replyTo: msg.replyTo,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.base64, 'base64'), contentType: a.contentType })),
    headers: { 'X-ExamGuard-Email': msg.kind, 'X-Entity-Ref-ID': msg.id },
  });
  return info.messageId ?? null;
}

function friendlyError(e: unknown) {
  if (e instanceof RelayError) return e.message.slice(0, 500);
  const err = e as { code?: string; responseCode?: number; message?: string };
  if (err.responseCode === 535 || /Username and Password not accepted|Invalid login/i.test(err.message ?? '')) return 'Gmail rejected the login — check SMTP_USER and that SMTP_PASS is a 16-character App Password (2-Step Verification must be on).';
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNECTION' || err.code === 'ESOCKET') return `Could not reach ${config.email.host}:${config.email.port} (${err.code}). This host blocks outbound SMTP (Render's free plan does) — use the Google Apps Script relay instead: set EMAIL_RELAY_URL and EMAIL_RELAY_SECRET.`;
  return (err.message ?? String(e)).slice(0, 500);
}

/* ------------------------------------------------------------------ rendering & sending */
export function renderRow(row: Pick<EmailOutbox, 'kind' | 'data'>) {
  return renderEmail(row.kind as EmailKind, row.data as EmailData);
}

function attachmentsFor(row: EmailOutbox) {
  const d = row.data as EmailData;
  if ((row.kind === 'exam_scheduled' || row.kind === 'exam_reminder') && d.exam) {
    return [{ filename: 'exam.ics', base64: Buffer.from(examIcs(d.exam as ExamInfo)).toString('base64'), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }];
  }
  return [];
}

/** Links with tokens are removed from stored data once an email is final (sent, skipped or failed). */
function redact(data: unknown) {
  const d = { ...(data as Record<string, unknown>) };
  if ('token' in d) d.token = null;
  return d as Prisma.InputJsonValue;
}
/** Render for admins: never with a live link. */
export function renderRowForPreview(row: Pick<EmailOutbox, 'kind' | 'data'>) {
  return renderEmail(row.kind as EmailKind, { ...(row.data as EmailData), token: null });
}

async function deliver(row: EmailOutbox) {
  if (isReservedAddress(row.to) && !config.email.allowReservedDomains) {
    return prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'SKIPPED', lastError: 'Demo address on a reserved domain — it can never receive mail', data: redact(row.data) } });
  }
  if (!emailConfigured() && !testTransport) {
    return prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'SKIPPED', lastError: NOT_CONFIGURED, data: redact(row.data) } });
  }
  const r = renderRow(row);
  let messageId: string | null;
  try {
    messageId = await send({ id: row.id, kind: row.kind, to: row.to, replyTo: config.email.replyTo, subject: r.subject, html: r.html, text: r.text, attachments: attachmentsFor(row) });
  } catch (e) {
    if (e instanceof RelayError && e.quota) {
      // daily sending quota: wait for it to reset instead of burning attempts (Google's window is a rolling 24h)
      return prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'PENDING', attempts: { decrement: 1 }, lastError: 'Daily Gmail sending quota reached — will retry automatically in an hour', sendAfter: new Date(Date.now() + 3600_000) } });
    }
    // permanent rejection (SMTP 5xx, wrong relay secret, bad deployment): retrying won't help; an admin can retry after fixing it
    const permanent = e instanceof RelayError ? e.permanent : ((e as { responseCode?: number }).responseCode ?? 0) >= 500;
    const final = permanent || row.attempts >= MAX_ATTEMPTS;
    const backoffSec = Math.min(3600, 30 * 2 ** (row.attempts - 1)); // 30s, 1m, 2m, 4m … capped at 1h
    return prisma.emailOutbox.update({
      where: { id: row.id },
      data: { status: final ? 'FAILED' : 'PENDING', lastError: friendlyError(e), sendAfter: new Date(Date.now() + backoffSec * 1000), ...(final ? { data: redact(row.data) } : {}) },
    });
  }
  // outside the try: a DB hiccup here must not mark a delivered email for resending
  await prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), messageId, lastError: null, data: redact(row.data) } }).catch((e) => console.error('[email] sent but could not record', row.id, e));
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
    select: { id: true, windowStart: true },
  });
  for (const e of soon) {
    // skip people who were told about this exact schedule in the last 12h
    const recent = await prisma.emailOutbox.findMany({ where: { kind: 'exam_scheduled', createdAt: { gt: new Date(t - 12 * HOUR) }, dedupeKey: { startsWith: `scheduled:${e.id}:` } }, select: { userId: true } });
    const skip = new Set(recent.map((r) => r.userId));
    const ids = (await prisma.enrollment.findMany({ where: { examId: e.id }, select: { candidateId: true } })).map((x) => x.candidateId).filter((id) => !skip.has(id));
    if (ids.length) await queueExamEmail(e.id, ids, 'exam_reminder', (u) => examKey('reminder', e, u));
  }
  const open = await prisma.exam.findMany({
    where: { status: 'PUBLISHED', pausedAt: null, windowStart: { lte: now, gt: new Date(t - 3 * HOUR) }, windowEnd: { gt: now } },
    select: { id: true, windowStart: true, settings: true, pausedSec: true },
  });
  for (const e of open) {
    const lateJoinMin = Number((e.settings as { lateJoinMin?: number } | null)?.lateJoinMin ?? 0);
    const sendUntil = e.windowStart.getTime() + e.pausedSec * 1000 + (lateJoinMin > 0 ? Math.min(30, lateJoinMin) : 30) * 60_000;
    if (t > sendUntil) continue; // never tell people to "start now" after late entry has closed
    const started = new Set((await prisma.attempt.findMany({ where: { examId: e.id }, select: { candidateId: true } })).map((a) => a.candidateId));
    const ids = (await prisma.enrollment.findMany({ where: { examId: e.id }, select: { candidateId: true } })).map((x) => x.candidateId).filter((id) => !started.has(id));
    if (ids.length) await queueExamEmail(e.id, ids, 'exam_open', (u) => examKey('open', e, u));
  }
}

export function startEmailWorker() {
  const mode = emailMode();
  if (mode) {
    void verifyTransport().then((r) => console.log(r.ok ? `[email] ${mode === 'relay' ? `Apps Script relay ready${r.account ? ` (${r.account}, ${r.quota} sends left today)` : ''}` : `SMTP ready (${config.email.host}:${config.email.port} as ${config.email.user})`}` : `[email] ${mode} check failed: ${r.error}`));
  } else {
    console.log('[email] not configured — emails are recorded in the admin email log but not delivered');
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
