import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me-please-32chars-min',
  clientOrigins: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  accessTtl: '15m',
  refreshTtlDays: 7,
  isProd: process.env.NODE_ENV === 'production',
  publicUrl: process.env.PUBLIC_WEB_URL ?? (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',')[0],
};
