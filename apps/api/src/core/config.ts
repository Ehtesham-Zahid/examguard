import 'dotenv/config';

// Render (and similar hosts) expose the public URL; fall back to CLIENT_ORIGIN for local dev
const external = process.env.PUBLIC_WEB_URL ?? process.env.RENDER_EXTERNAL_URL;
const origins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim());
if (external && !origins.includes(external)) origins.push(external);

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24)) {
  throw new Error('JWT_SECRET must be set to a long random value in production');
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me-please-32chars-min',
  clientOrigins: origins,
  accessTtl: '15m',
  refreshTtlDays: 7,
  isProd: process.env.NODE_ENV === 'production',
  publicUrl: (external ?? origins[0]).replace(/\/$/, ''),
  email: {
    // Preferred on hosts that block SMTP (e.g. Render free): a Google Apps Script web app that sends through Gmail over HTTPS
    relayUrl: (process.env.EMAIL_RELAY_URL ?? '').trim(),
    relaySecret: (process.env.EMAIL_RELAY_SECRET ?? '').trim(),
    // Gmail: SMTP_USER = the Gmail / Workspace address, SMTP_PASS = a 16-character App Password
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    user: (process.env.SMTP_USER ?? '').trim(),
    pass: (process.env.SMTP_PASS ?? '').replace(/\s+/g, ''), // app passwords are often pasted as "abcd efgh ijkl mnop"
    from: (process.env.EMAIL_FROM ?? '').trim(),
    replyTo: (process.env.EMAIL_REPLY_TO ?? '').trim() || undefined,
    timeZone: process.env.EMAIL_TIMEZONE || 'Asia/Karachi',
    /** Demo accounts use reserved domains (*.test) that can never receive mail; only a local test sink allows them. */
    allowReservedDomains: process.env.EMAIL_ALLOW_TEST_DOMAINS === 'true',
    disabled: process.env.EMAIL_DISABLED === 'true',
  },
};

/** 'relay' (Google Apps Script over HTTPS) wins over 'smtp' when both are set. */
export const emailMode = (): 'relay' | 'smtp' | null =>
  config.email.disabled ? null : config.email.relayUrl && config.email.relaySecret ? 'relay' : config.email.user && config.email.pass ? 'smtp' : null;
/** AI marking assistant (Claude). Off until ANTHROPIC_API_KEY is set; the SDK also honours ANTHROPIC_BASE_URL. */
export const aiConfig = {
  apiKey: (process.env.ANTHROPIC_API_KEY ?? '').trim(),
  model: (process.env.AI_GRADING_MODEL ?? '').trim() || 'claude-opus-5-5',
  effort: (['low', 'medium', 'high', 'xhigh', 'max'].includes(process.env.AI_GRADING_EFFORT ?? '') ? process.env.AI_GRADING_EFFORT : 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
  maxBatch: Math.max(1, Number(process.env.AI_GRADING_MAX_BATCH) || 300),
  concurrency: Math.max(1, Math.min(8, Number(process.env.AI_GRADING_CONCURRENCY) || 3)),
};
export const aiEnabled = () => aiConfig.apiKey.length > 0;

export const emailConfigured = () => emailMode() !== null;
