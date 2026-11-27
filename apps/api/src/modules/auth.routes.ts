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
  res.json({ accessToken: signAccessToken(updated), user: publicUser(updated) });
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
  })
  .strict();

authRouter.put('/prefs', authenticate, async (req, res) => {
  const prefs = parseBody(prefsSchema, req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUser(req).id } });
  const merged = { ...((user.prefs as object) ?? {}), ...prefs };
  const updated = await prisma.user.update({ where: { id: user.id }, data: { prefs: merged } });
  res.json({ prefs: updated.prefs });
});
