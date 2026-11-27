import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { prisma } from '../core/prisma.js';
import { authenticate, currentUser, signAccessToken, signRefreshToken, verifyToken } from '../core/auth.js';
import { badRequest, unauthorized } from '../core/errors.js';
import { parseBody } from '../core/validate.js';
import { config } from '../core/config.js';
import { audit } from '../core/audit.js';
import { disconnectUser } from '../core/realtime.js';
import { hashToken, issuePasswordToken, queueEmails } from '../services/email/outbox.js';

export const authRouter = Router();
const COOKIE = 'eg_refresh';
const MAX_FAILS = 5;
const LOCK_MIN = 15;

// per IP + email: brute force on one account is capped (plus account lockout), a shared lab IP is not
const loginLimiter = rateLimit({ windowMs: 60_000, limit: 10, keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.email ?? '').toLowerCase()}`, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Too many login attempts, wait a minute' } } });

export const publicUser = (u: { id: string; name: string; email: string; role: string; mustChangePassword: boolean; prefs: unknown; groupName: string | null }) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  groupName: u.groupName,
  mustChangePassword: u.mustChangePassword,
  prefs: u.prefs,
});

function setRefresh(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: config.isProd ? 'none' : 'lax',
    maxAge: config.refreshTtlDays * 86400_000,
    path: '/api/auth',
  });
}

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(100)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = parseBody(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }), req);
  const user = await prisma.user.findUnique({ where: { email } });
  const generic = unauthorized('Incorrect email or password');
  if (!user) throw generic;
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw unauthorized(`Account temporarily locked after repeated failed attempts. Try again in ${mins} min.`);
  }
  if (user.status !== 'ACTIVE') throw unauthorized('This account has been disabled. Contact an administrator.');
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const fails = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: fails >= MAX_FAILS ? 0 : fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000) : null },
    });
    if (fails >= MAX_FAILS) audit(user.id, 'auth.locked', 'User', user.id, { ip: req.ip });
    throw generic;
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  setRefresh(res, signRefreshToken(user));
  audit(user.id, 'auth.login', 'User', user.id, { ip: req.ip });
  res.json({ accessToken: signAccessToken(user), user: publicUser(user) });
});

authRouter.post('/refresh', async (req, res) => {
  const token = req.cookies?.[COOKIE] ?? req.body?.refreshToken;
  if (!token) throw unauthorized('No session');
  let payload: { sub: string; tv: number; typ: string };
  try {
    payload = verifyToken(token);
  } catch {
    throw unauthorized('Session expired');
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || payload.typ !== 'refresh' || user.tokenVersion !== payload.tv || user.status !== 'ACTIVE') throw unauthorized('Session expired');
  setRefresh(res, signRefreshToken(user));
  res.json({ accessToken: signAccessToken(user), user: publicUser(user) });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/api/auth' });
  res.json({ ok: true });
});

authRouter.post('/logout-all', authenticate, async (req, res) => {
  const u = currentUser(req);
  await prisma.user.update({ where: { id: u.id }, data: { tokenVersion: { increment: 1 } } });
  disconnectUser(u.id);
  res.clearCookie(COOKIE, { path: '/api/auth' });
  audit(u.id, 'auth.logout_all', 'User', u.id);
  res.json({ ok: true });
});

authRouter.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUser(req).id } });
  res.json({ user: publicUser(user) });
});

authRouter.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = parseBody(z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }), req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUser(req).id } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect');
  if (currentPassword === newPassword) throw badRequest('New password must be different');
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 10), mustChangePassword: false, tokenVersion: { increment: 1 } },
  });
  setRefresh(res, signRefreshToken(updated));
  audit(user.id, 'auth.password_changed', 'User', user.id);
  await queueEmails([{ user: updated, kind: 'password_changed', data: { at: new Date().toISOString() } }]);
  res.json({ accessToken: signAccessToken(updated), user: publicUser(updated) });
});

/* ------------------------------------------------ password links (welcome, admin reset, forgot) */
const FORGOT_TTL = 60 * 60_000;
const limitMsg = { error: { code: 'RATE_LIMIT', message: 'Too many reset requests — try again in a few minutes' } };
const normEmail = (v: unknown) => String(v ?? '').trim().toLowerCase();
// forgot: 5 per address+IP per 15 min (typos) AND 10 per IP per hour regardless of address (no mail-bombing many accounts)
const forgotLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, keyGenerator: (req) => `fp:${ipKeyGenerator(req.ip ?? '')}:${normEmail(req.body?.email)}`, standardHeaders: true, legacyHeaders: false, message: limitMsg });
const forgotIpLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 10, keyGenerator: (req) => `fpip:${ipKeyGenerator(req.ip ?? '')}`, standardHeaders: true, legacyHeaders: false, message: limitMsg });
// reset: keyed by the link itself, so a whole exam hall behind one IP can set passwords at once
const resetLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, keyGenerator: (req) => `rp:${String(req.body?.token ?? '').slice(0, 24)}`, standardHeaders: true, legacyHeaders: false, message: limitMsg });
const resetIpLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 300, keyGenerator: (req) => `rpip:${ipKeyGenerator(req.ip ?? '')}`, standardHeaders: true, legacyHeaders: false, message: limitMsg });
// self-service reset emails are capped per account per day and overall per day, so they can never eat the sending quota
const FORGOT_PER_ACCOUNT_DAY = 3;
const FORGOT_GLOBAL_DAY = Number(process.env.FORGOT_EMAILS_PER_DAY) || 40;

/** Always answers the same way, so it can't be used to discover which emails have accounts. */
authRouter.post('/password/forgot', forgotIpLimiter, forgotLimiter, async (req, res) => {
  const { email } = parseBody(z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email address') }), req);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.status === 'ACTIVE') {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [recent, today, globalToday] = await Promise.all([
      prisma.passwordToken.findFirst({ where: { userId: user.id, purpose: 'forgot', createdAt: { gt: new Date(Date.now() - 60_000) } } }),
      prisma.passwordToken.count({ where: { userId: user.id, purpose: 'forgot', createdAt: { gt: dayAgo } } }),
      prisma.passwordToken.count({ where: { purpose: 'forgot', createdAt: { gt: dayAgo } } }),
    ]);
    if (!recent && today < FORGOT_PER_ACCOUNT_DAY && globalToday < FORGOT_GLOBAL_DAY) {
      const { token, expiresAt } = await issuePasswordToken(user.id, 'forgot', FORGOT_TTL);
      await queueEmails([{ user, kind: 'password_forgot', data: { token, expiresAt: expiresAt.toISOString() } }]);
      audit(user.id, 'auth.password_forgot', 'User', user.id, { ip: req.ip });
    }
  }
  res.json({ ok: true });
});

async function findToken(raw: string) {
  const t = await prisma.passwordToken.findUnique({ where: { tokenHash: hashToken(raw) }, include: { user: true } });
  if (!t || t.usedAt || t.expiresAt < new Date() || t.user.status !== 'ACTIVE') return null;
  return t;
}
const maskEmail = (e: string) => e.replace(/^(.)(.*)(.@.*)$/, (_m, a: string, b: string, c: string) => a + '•'.repeat(Math.min(6, b.length)) + c);

authRouter.get('/password/token', async (req, res) => {
  const raw = String(req.query.token ?? '');
  const t = raw.length >= 20 && raw.length <= 200 ? await findToken(raw) : null;
  if (!t) return res.json({ valid: false });
  res.json({ valid: true, purpose: t.purpose, name: t.user.name.split(' ')[0], email: maskEmail(t.user.email), expiresAt: t.expiresAt });
});

authRouter.post('/password/reset', resetIpLimiter, resetLimiter, async (req, res) => {
  const { token, password } = parseBody(z.object({ token: z.string().min(20).max(200), password: passwordSchema }), req);
  const t = await findToken(token);
  if (!t) throw badRequest('This link has expired or was already used. Request a new one.');
  // claim the token atomically so two tabs can't both use it
  const claimed = await prisma.passwordToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw badRequest('This link has expired or was already used. Request a new one.');
  const updated = await prisma.user.update({
    where: { id: t.userId },
    data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: false, tokenVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null },
  });
  await prisma.passwordToken.updateMany({ where: { userId: t.userId, usedAt: null }, data: { usedAt: new Date() } });
  disconnectUser(updated.id);
  audit(updated.id, t.purpose === 'welcome' ? 'auth.password_set' : 'auth.password_reset', 'User', updated.id, { ip: req.ip });
  if (t.purpose !== 'welcome') await queueEmails([{ user: updated, kind: 'password_changed', data: { at: new Date().toISOString() } }]);
  res.json({ ok: true, email: updated.email });
});

const prefsSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'contrast', 'system']).optional(),
    fontSize: z.number().int().min(12).max(26).optional(),
    font: z.enum(['default', 'legible', 'dyslexic', 'serif', 'mono']).optional(),
    lineHeight: z.number().min(1.2).max(2.2).optional(),
    paletteSide: z.enum(['left', 'right', 'hidden']).optional(),
    layout: z.enum(['single', 'scroll']).optional(),
    reduceMotion: z.boolean().optional(),
    language: z.enum(['en', 'ur']).optional(),
    emailExams: z.boolean().optional(),
    emailResults: z.boolean().optional(),
    emailDisputes: z.boolean().optional(),
  })
  .strict();

authRouter.put('/prefs', authenticate, async (req, res) => {
  const prefs = parseBody(prefsSchema, req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUser(req).id } });
  const merged = { ...((user.prefs as object) ?? {}), ...prefs };
  const updated = await prisma.user.update({ where: { id: user.id }, data: { prefs: merged } });
  res.json({ prefs: updated.prefs });
});
