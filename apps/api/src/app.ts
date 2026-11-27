import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './core/config.js';
import { errorHandler } from './core/errors.js';
import { authRouter } from './modules/auth.routes.js';
import { usersRouter } from './modules/users.routes.js';
import { questionsRouter } from './modules/questions.routes.js';
import { examsRouter } from './modules/exams.routes.js';
import { candidateRouter } from './modules/candidate.routes.js';
import { staffRouter } from './modules/staff.routes.js';
import { reportsRouter, verifyRouter } from './modules/reports.routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.clientOrigins, credentials: true, exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser());
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Too many requests, slow down' } } }));

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
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));
  app.use(errorHandler);
  return app;
}
