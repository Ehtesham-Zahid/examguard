import { describe, expect, it } from 'vitest';
import { CATEGORY, examIcs, renderEmail, type EmailKind } from './templates.js';
import { isReservedAddress, wantsEmail } from './outbox.js';

const exam = { examId: 'ex1', title: 'Data Structures — Midterm', windowStart: '2026-12-01T05:00:00.000Z', windowEnd: '2026-12-01T09:00:00.000Z', durationMin: 90, extraTimePct: 25, totalMarks: 50, examiner: 'Dr. Hamza Qureshi' };
const base = { name: 'Ayesha Khan', email: 'ayesha@uni.edu' };
const sample: Record<EmailKind, Record<string, unknown>> = {
  exam_scheduled: { exam },
  exam_reminder: { exam: { ...exam, requiresAccessCode: true } },
  exam_open: { exam },
  exam_reopened: { title: 'OS Final', examId: 'ex2', minutes: 12 },
  results_published: { title: 'OS Final', attemptId: 'at1', certificateCode: 'EG-7K2Q-9XA4' },
  score_updated: { title: 'OS Final', attemptId: 'at1' },
  dispute_decided: { title: 'OS Final', decision: 'UPHELD', resolution: 'Option B is also correct.' },
  dispute_raised: { title: 'OS Final', candidateName: 'Ali Raza', reason: 'Q4 has two correct answers' },
  welcome: { token: 'tok_abcdefghijklmnopqrstuvwxyz', expiresAt: '2026-12-04T05:00:00.000Z', role: 'CANDIDATE', invitedBy: 'Sana Umer' },
  password_reset: { token: 'tok_abcdefghijklmnopqrstuvwxyz', expiresAt: '2026-12-02T05:00:00.000Z' },
  password_forgot: { token: 'tok_abcdefghijklmnopqrstuvwxyz', expiresAt: '2026-12-01T06:00:00.000Z' },
  password_changed: { at: '2026-12-01T05:00:00.000Z' },
  test: { sentBy: 'Sana Umer', at: '2026-12-01T05:00:00.000Z' },
};

describe('email templates', () => {
  it('renders every kind with subject, html and a plain-text part', () => {
    for (const kind of Object.keys(CATEGORY) as EmailKind[]) {
      const r = renderEmail(kind, { ...base, ...sample[kind] });
      expect(r.subject.length, kind).toBeGreaterThan(5);
      expect(r.html, kind).toContain('<!doctype html>');
      expect(r.html, kind).toContain('Hi Ayesha,');
      expect(r.text, kind).toContain('Hi Ayesha,');
      expect(r.text, kind).not.toMatch(/<[a-z][^>]*>/i); // no tags leak into the text part
    }
  });

  it('escapes user-controlled content', () => {
    const r = renderEmail('dispute_raised', { ...base, title: '<script>alert(1)</script>', candidateName: 'Eve"><img src=x>', reason: 'x' });
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('<img src=x>');
    expect(r.html).toContain('&lt;script&gt;');
  });

  it('shows times in the configured zone with extra time folded into the duration', () => {
    const r = renderEmail('exam_scheduled', { ...base, exam });
    expect(r.html).toContain('10:00 am'); // 05:00Z = 10:00 PKT
    expect(r.html).toContain('1 h 53 min (includes +25% extra time)');
    expect(r.html).toContain('Pakistan Standard Time');
  });

  it('never puts an access code or a score in the email', () => {
    expect(renderEmail('exam_reminder', { ...base, ...sample.exam_reminder }).html).toContain('Access code from your examiner');
    expect(renderEmail('exam_scheduled', { ...base, exam: { ...exam, requiresAccessCode: true } }).html).toContain('never sent by email');
    const results = renderEmail('results_published', { ...base, ...sample.results_published });
    expect(results.html).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(results.html).toContain('EG-7K2Q-9XA4');
  });

  it('links carry the token until it is redacted after delivery', () => {
    expect(renderEmail('password_forgot', { ...base, ...sample.password_forgot }).html).toContain('/reset-password?token=tok_abcdefghijklmnopqrstuvwxyz');
    const redacted = renderEmail('password_forgot', { ...base, token: null });
    expect(redacted.html).not.toContain('token=');
    expect(redacted.html).toContain('#link-already-delivered');
  });
});

describe('calendar invite', () => {
  const ics = examIcs({ ...exam, title: 'A very long examination title, with commas; and semicolons that needs folding across lines' });
  it('is valid RFC 5545 (CRLF, UTC times, escaped text, folded lines)', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261201T050000Z');
    expect(ics).toContain('DTEND:20261201T090000Z');
    expect(ics).toContain('UID:exam-ex1@examguard');
    expect(ics).toContain('\\,');
    expect(ics).toContain('\\;');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(ics.split('\n').every((l, i, a) => i === a.length - 1 || l.endsWith('\r'))).toBe(true);
  });
});

describe('delivery rules', () => {
  it('respects per-category opt-outs but always sends account emails', () => {
    const off = { emailExams: false, emailResults: false, emailDisputes: false };
    expect(wantsEmail(off, 'exam_open')).toBe(false);
    expect(wantsEmail(off, 'results_published')).toBe(false);
    expect(wantsEmail(off, 'dispute_decided')).toBe(false);
    expect(wantsEmail(off, 'password_changed')).toBe(true);
    expect(wantsEmail({}, 'exam_open')).toBe(true);
    expect(wantsEmail(null, 'results_published')).toBe(true);
  });
  it('recognises reserved demo domains', () => {
    expect(isReservedAddress('student@examguard.test')).toBe(true);
    expect(isReservedAddress('a@example.com')).toBe(true);
    expect(isReservedAddress('someone@gmail.com')).toBe(false);
    expect(isReservedAddress('x@uni.edu.pk')).toBe(false);
  });
});
