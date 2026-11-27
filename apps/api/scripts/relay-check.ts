/**
 * End-to-end check of the Google Apps Script relay transport against a local mock that behaves like Apps Script
 * (POST → 302 redirect → GET returns the JSON result). Run on a disposable, seeded database:
 *   DATABASE_URL=... npx tsx scripts/relay-check.ts
 */
import http from 'node:http';
import crypto from 'node:crypto';

const SECRET = 'relay-test-secret-0123456789abcdef';
const received: any[] = [];
const results = new Map<string, string>();
let mode: 'ok' | 'html' | 'quota' = 'ok';
const mock = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/exec') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const r = JSON.parse(body);
      let out: object;
      if (mode === 'html') return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html>Sign in</html>');
      if (r.secret !== SECRET) out = { ok: false, error: 'Unauthorized: EMAIL_RELAY_SECRET does not match the secret in the Apps Script' };
      else if (r.action === 'ping') out = { ok: true, quota: 97, account: 'ehteshamzahid313@gmail.com' };
      else if (mode === 'quota') out = { ok: false, error: 'Service invoked too many times for one day: email.' };
      else {
        received.push(r);
        out = { ok: true, id: crypto.randomUUID(), quota: 96 };
      }
      const id = crypto.randomUUID();
      results.set(id, JSON.stringify(out));
      res.writeHead(302, { location: `/result?id=${id}` }).end(); // what script.google.com does
    });
    return;
  }
  if (req.method === 'GET' && req.url?.startsWith('/result')) {
    const id = new URL(req.url, 'http://x').searchParams.get('id')!;
    return res.writeHead(200, { 'content-type': 'application/json' }).end(results.get(id) ?? '{}');
  }
  res.writeHead(404).end();
});

let failures = 0;
const ok = (c: unknown, m: string) => (console.log(`${c ? '✓' : '✗'} ${m}`), c || failures++);

async function main() {
  await new Promise<void>((r) => mock.listen(2600, r));
  process.env.EMAIL_RELAY_URL = 'http://localhost:2600/exec';
  process.env.EMAIL_RELAY_SECRET = SECRET;
  process.env.SMTP_USER = 'should-be-ignored@gmail.com';
  process.env.SMTP_PASS = 'x';
  process.env.EMAIL_ALLOW_TEST_DOMAINS = 'true';
  const { emailMode } = await import('../src/core/config.js');
  const { prisma } = await import('../src/core/prisma.js');
  const ob = await import('../src/services/email/outbox.js');

  ok(emailMode() === 'relay', 'relay is preferred over SMTP when both are configured');
  const v = await ob.verifyTransport();
  ok(v.ok && v.quota === 97 && v.account === 'ehteshamzahid313@gmail.com', 'health check pings the relay (account + quota) through the 302 redirect');

  const user = await prisma.user.findFirstOrThrow({ where: { role: 'CANDIDATE' } });
  const exam = { examId: 'e1', title: 'Relay Exam', windowStart: new Date(Date.now() + 86400_000).toISOString(), windowEnd: new Date(Date.now() + 90000_000).toISOString(), durationMin: 60 };
  await ob.queueEmails([{ user, kind: 'exam_scheduled', data: { exam }, dedupeKey: `relay-check:${Date.now()}` }]);
  await ob.processOutbox();
  const sent = received.find((r) => r.subject?.includes('Relay Exam'));
  ok(!!sent && sent.html.includes('<!doctype html>') && sent.text.includes('Relay Exam') && sent.to === user.email, 'email delivered through the relay with HTML and text parts');
  const ics = sent?.attachments?.[0];
  ok(ics?.filename === 'exam.ics' && Buffer.from(ics.base64, 'base64').toString().includes('BEGIN:VCALENDAR'), 'calendar invite attached (base64)');
  const row = await prisma.emailOutbox.findFirst({ where: { to: user.email, kind: 'exam_scheduled' }, orderBy: { createdAt: 'desc' } });
  ok(row?.status === 'SENT' && !!row.messageId, 'row marked SENT with the relay message id');

  // temporary failure (quota) → retried later, not failed
  mode = 'quota';
  await ob.queueEmails([{ user, kind: 'test', data: { sentBy: 'check' }, dedupeKey: `relay-q:${Date.now()}` }]);
  await ob.processOutbox();
  const q = await prisma.emailOutbox.findFirst({ where: { kind: 'test', dedupeKey: { startsWith: 'relay-q:' } }, orderBy: { createdAt: 'desc' } });
  ok(q?.status === 'PENDING' && q.sendAfter > new Date() && /too many times/.test(q.lastError ?? ''), 'quota error → queued for retry with backoff');

  // misconfigured deployment (HTML page) → fails fast with a helpful message
  mode = 'html';
  await ob.queueEmails([{ user, kind: 'test', data: { sentBy: 'check' }, dedupeKey: `relay-h:${Date.now()}` }]);
  await ob.processOutbox();
  const h = await prisma.emailOutbox.findFirst({ where: { kind: 'test', dedupeKey: { startsWith: 'relay-h:' } }, orderBy: { createdAt: 'desc' } });
  ok(h?.status === 'FAILED' && /Anyone/.test(h.lastError ?? ''), 'HTML response (wrong access setting) fails fast and says how to fix it');

  // wrong secret → permanent failure explaining the mismatch
  mode = 'ok';
  process.env.EMAIL_RELAY_SECRET = 'wrong';
  const cfg = (await import('../src/core/config.js')).config;
  cfg.email.relaySecret = 'wrong';
  await ob.queueEmails([{ user, kind: 'test', data: { sentBy: 'check' }, dedupeKey: `relay-s:${Date.now()}` }]);
  await ob.processOutbox();
  const s = await prisma.emailOutbox.findFirst({ where: { kind: 'test', dedupeKey: { startsWith: 'relay-s:' } }, orderBy: { createdAt: 'desc' } });
  ok(s?.status === 'FAILED' && /does not match/.test(s.lastError ?? ''), 'wrong secret fails fast with a clear message');

  console.log(failures ? `\n${failures} FAILED` : '\nRELAY CHECK PASSED');
  mock.close();
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}
main();
