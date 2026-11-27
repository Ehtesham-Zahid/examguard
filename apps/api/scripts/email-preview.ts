// dev-only: render every template to HTML files (npx tsx scripts/email-preview.ts <outDir>)
import { writeFileSync } from 'node:fs';
import { CATEGORY, renderEmail, type EmailKind } from '../src/services/email/templates.js';
const out = process.argv[2];
const exam = { examId: 'ex1', title: 'Data Structures Midterm', windowStart: '2026-12-01T05:00:00.000Z', windowEnd: '2026-12-01T09:00:00.000Z', durationMin: 90, extraTimePct: 25, totalMarks: 50, examiner: 'Dr. Hamza Qureshi', requiresAccessCode: true };
const d: Record<string, Record<string, unknown>> = {
  exam_scheduled: { exam }, exam_reminder: { exam }, exam_open: { exam }, exam_reopened: { title: 'Operating Systems Final', examId: 'x', minutes: 12 },
  results_published: { title: 'Operating Systems Final', attemptId: 'a', certificateCode: 'EG-7K2Q-9XA4' }, score_updated: { title: 'Operating Systems Final', attemptId: 'a' },
  dispute_decided: { title: 'Operating Systems Final', decision: 'UPHELD', resolution: 'You were right: option B is also a valid answer, so the question now accepts both.' },
  dispute_raised: { title: 'Operating Systems Final', candidateName: 'Ali Raza', reason: 'Question 4 has two correct answers (B and D).' },
  welcome: { token: 'demo-token-1234567890abcdef', expiresAt: '2026-12-04T05:00:00.000Z', role: 'CANDIDATE', invitedBy: 'Sana Umer' },
  password_reset: { token: 'demo-token-1234567890abcdef', expiresAt: '2026-12-02T05:00:00.000Z' }, password_forgot: { token: 'demo-token-1234567890abcdef', expiresAt: '2026-12-01T06:00:00.000Z' },
  password_changed: { at: '2026-12-01T05:00:00.000Z' }, test: { sentBy: 'Sana Umer', at: '2026-12-01T05:00:00.000Z' },
};
const kinds = Object.keys(CATEGORY) as EmailKind[];
for (const k of kinds) writeFileSync(`${out}/${k}.html`, renderEmail(k, { name: 'Ayesha Khan', email: 'ayesha@uni.edu', ...d[k] }).html);
writeFileSync(`${out}/index.html`, kinds.map((k) => `<a href="${k}.html">${k}</a>`).join('<br>'));
