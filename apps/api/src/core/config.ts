import 'dotenv/config';

// Render (and similar hosts) expose the public URL; fall back to CLIENT_ORIGIN for local dev
const external = process.env.PUBLIC_WEB_URL ?? process.env.RENDER_EXTERNAL_URL;
const origins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim());
if (external && !origins.includes(external)) origins.push(external);

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me-please-32chars-min',
  clientOrigins: origins,
  accessTtl: '15m',
  refreshTtlDays: 7,
  isProd: process.env.NODE_ENV === 'production',
  publicUrl: (external ?? origins[0]).replace(/\/$/, ''),
};
