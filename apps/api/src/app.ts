import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './core/config.js';
import { errorHandler } from './core/errors.js';
import { authRouter } from './modules/auth.routes.js';
import { usersRouter } from './modules/users.routes.js';
import { questionsRouter } from './modules/questions.routes.js';
import { examsRouter } from './modules/exams.routes.js';
import { candidateRouter } from './modules/candidate.routes.js';
import { staffRouter } from './modules/staff.routes.js';
import { reportsRouter, verifyRouter } from './modules/reports.routes.js';
import { emailsRouter } from './modules/emails.routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.clientOrigins, credentials: true, exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser());
  // Keyed per signed-in user (not per IP) so a whole exam hall behind one NAT address isn't throttled together
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        const h = req.headers.authorization;
        if (h?.startsWith('Bearer ')) {
          try {
            return `u:${(jwt.verify(h.slice(7), config.jwtSecret) as { sub: string }).sub}`;
          } catch {
            /* fall through to IP */
          }
        }
        return ipKeyGenerator(req.ip ?? '');
      },
      message: { error: { code: 'RATE_LIMIT', message: 'Too many requests, slow down' } },
    }),
  );

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  /** Authoritative server clock: the client only displays a countdown derived from this. */
  app.get('/api/time', (_req, res) => res.json({ serverNow: Date.now() }));
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/questions', questionsRouter);
  app.use('/api/exams', examsRouter);
  app.use('/api/candidate', candidateRouter);
  app.use('/api/staff', staffRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/verify', verifyRouter);
  app.use('/api/admin/emails', emailsRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));
  app.use(errorHandler);

  // Production: serve the built SPA from the same origin (same-site cookies, no CORS, WebSockets on one host)
  const webDist = process.env.WEB_DIST ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }
  return app;
}
