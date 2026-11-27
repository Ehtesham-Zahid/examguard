import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { config } from './config.js';
import { forbidden, unauthorized } from './errors.js';
import { prisma } from './prisma.js';

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface AccessPayload {
  sub: string;
  role: Role;
  tv: number;
}

export function signAccessToken(u: { id: string; role: Role; tokenVersion: number }) {
  return jwt.sign({ sub: u.id, role: u.role, tv: u.tokenVersion } satisfies AccessPayload, config.jwtSecret, {
    expiresIn: config.accessTtl,
  } as jwt.SignOptions);
}

export function signRefreshToken(u: { id: string; tokenVersion: number }) {
  return jwt.sign({ sub: u.id, tv: u.tokenVersion, typ: 'refresh' }, config.jwtSecret, {
    expiresIn: `${config.refreshTtlDays}d`,
  } as jwt.SignOptions);
}

export function verifyToken<T = AccessPayload>(token: string): T {
  return jwt.verify(token, config.jwtSecret) as T;
}

export async function resolveUserFromToken(token: string): Promise<AuthUser> {
  let payload: AccessPayload;
  try {
    payload = verifyToken(token);
  } catch {
    throw unauthorized('Session expired, please sign in again');
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.status !== 'ACTIVE' || user.tokenVersion !== payload.tv) throw unauthorized('Session is no longer valid');
  return { id: user.id, role: user.role, name: user.name, email: user.email };
}

/** Layer 1: authentication — who are you */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  req.user = await resolveUserFromToken(header.slice(7));
  next();
}

/** Layer 2: role-based access — what role do you have */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

export const currentUser = (req: Request): AuthUser => {
  if (!req.user) throw unauthorized();
  return req.user;
};
