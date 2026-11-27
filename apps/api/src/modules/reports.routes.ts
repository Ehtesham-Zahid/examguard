import { Router, type Response } from 'express';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { prisma } from '../core/prisma.js';
import { authenticate, currentUser } from '../core/auth.js';
import { forbidden, notFound } from '../core/errors.js';
import { param } from '../core/validate.js';
import { loadExamForStaff } from '../core/policy.js';
import { config } from '../core/config.js';
import { finalAnswerScore } from '../domain/marking.js';
import { issueCertificate, publicKeyPem, verifyCode } from '../services/certificates.service.js';
import { examAnalytics } from './staff.routes.js';

export const reportsRouter = Router();
export const verifyRouter = Router();

const INK = '#0f172a';
const MUTED = '#64748b';
const ACCENT = '#4338ca';
const LINE = '#e2e8f0';

function startDoc(res: Response, filename: string) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: filename, Producer: 'Examify' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  doc.pipe(res);
  doc.rect(0, 0, doc.page.width, 6).fill(ACCENT);
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(11).text('EXAMIFY', 48, 28, { characterSpacing: 2 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('Secure Examination Management System', 48, 42);
  doc.moveDown(2);
  return doc;
}
const hr = (doc: PDFKit.PDFDocument) => {
  doc.moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).strokeColor(LINE).lineWidth(1).stroke();
  doc.moveDown(0.6);
};
const kv = (doc: PDFKit.PDFDocument, pairs: [string, string][], x = 48, w = 125) => {
  const y0 = doc.y;
  pairs.forEach(([k, v], i) => {
    const cx = x + (i % 4) * w;
    const cy = y0 + Math.floor(i / 4) * 40;
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(k.toUpperCase(), cx, cy, { width: w - 8 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(v, cx, cy + 11, { width: w - 8 });
  });
  doc.y = y0 + Math.ceil(pairs.length / 4) * 40 + 6;
  doc.x = 48;
};
const footer = (doc: PDFKit.PDFDocument, text: string) => {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(`${text}  ·  Page ${i + 1} of ${range.count}  ·  Generated ${new Date().toUTCString()}`, 48, doc.page.height - 34, { width: doc.page.width - 96, align: 'center', lineBreak: false });
  }
};

/** Candidate result report with QR verification. Candidates: own + published only. Staff: exams they own. */
reportsRouter.get('/attempts/:id/pdf', authenticate, async (req, res) => {
  const me = currentUser(req);
  const attempt = await prisma.attempt.findUnique({ where: { id: param(req, 'id') }, include: { exam: true, candidate: true, certificate: true } });
  if (!attempt || attempt.isSandbox) throw notFound('Attempt not found');
  const isOwner = attempt.candidateId === me.id;
  const isStaff = me.role === 'ADMIN' || attempt.exam.ownerId === me.id;
  if (!isOwner && !isStaff) throw notFound('Attempt not found');
  if (isOwner && !isStaff && !attempt.exam.resultsPublishedAt) throw forbidden('Results have not been published yet');
  const cert = attempt.certificate ?? (attempt.exam.resultsPublishedAt ? await issueCertificate(attempt.id) : null);
  const aqs = await prisma.attemptQuestion.findMany({ where: { attemptId: attempt.id }, orderBy: { position: 'asc' }, include: { answer: true, questionVersion: { include: { question: { include: { topic: true } } } } } });

  const doc = startDoc(res, `result-${attempt.exam.title.replace(/\W+/g, '-')}.pdf`);

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text('Examination Result Report', 48);
  doc.fillColor(MUTED).font('Helvetica').fontSize(11).text(attempt.exam.title);
  doc.moveDown(1);
  hr(doc);
  const pct = attempt.maxScore ? Math.round(((attempt.score ?? 0) / attempt.maxScore) * 1000) / 10 : 0;
  const passed = (attempt.score ?? 0) >= attempt.exam.passMarks;
  kv(doc, [
    ['Candidate', attempt.candidate.name],
    ['Score', `${attempt.score ?? 0} / ${attempt.maxScore}`],
    ['Percentage', `${pct}%`],
    ['Result', passed ? 'PASS' : 'FAIL'],
    ['Submitted', attempt.submittedAt ? attempt.submittedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—'],
    ['Pass mark', String(attempt.exam.passMarks)],
    ['Status', attempt.status.replace('_', ' ').toLowerCase()],
    ['Questions', String(aqs.length)],
  ]);
  if (!attempt.exam.resultsPublishedAt) {
    doc.fillColor('#b45309').font('Helvetica-Bold').fontSize(10).text('PROVISIONAL — results not yet published', 48);
    doc.moveDown(0.5);
  }
  hr(doc);

  // topic breakdown
  const topics: Record<string, { s: number; m: number }> = {};
  aqs.forEach((aq) => {
    const t = aq.questionVersion.question.topic.name;
    topics[t] ??= { s: 0, m: 0 };
    topics[t].s += aq.answer ? finalAnswerScore(aq.answer) : 0;
    topics[t].m += aq.marks;
  });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text('Performance by topic', 48);
  doc.moveDown(0.4);
  Object.entries(topics).forEach(([t, v]) => {
    const p = v.m ? Math.max(0, v.s / v.m) : 0;
    const y = doc.y;
    doc.fillColor(INK).font('Helvetica').fontSize(9.5).text(t, 48, y, { width: 150 });
    doc.rect(205, y + 2, 250, 7).fill(LINE);
    doc.rect(205, y + 2, 250 * p, 7).fill(ACCENT);
    doc.fillColor(MUTED).text(`${Math.round(v.s * 100) / 100}/${v.m}  (${Math.round(p * 100)}%)`, 465, y, { width: 90 });
    doc.y = y + 16;
  });
  doc.moveDown(0.6);
  hr(doc);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text('Question summary', 48);
  doc.moveDown(0.4);
  aqs.forEach((aq) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    const s = aq.answer ? finalAnswerScore(aq.answer) : 0;
    const y = doc.y;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Q${aq.position}`, 48, y, { width: 28 });
    doc.fillColor(INK).text(aq.questionVersion.body.replace(/\s+/g, ' ').slice(0, 95), 78, y, { width: 380 });
    doc.font('Helvetica-Bold').fillColor(s >= aq.marks ? '#15803d' : s > 0 ? '#b45309' : '#b91c1c').text(`${aq.voided ? 'voided · ' : ''}${s}/${aq.marks}`, 465, y, { width: 82, align: 'right' });
    doc.y = Math.max(doc.y, y + 13) + 3;
  });

  if (cert) {
    if (doc.y > doc.page.height - 190) doc.addPage();
    doc.moveDown(1);
    hr(doc);
    const url = `${config.publicUrl}/verify/${cert.code}`;
    const qr = await QRCode.toBuffer(url, { margin: 1, width: 220, color: { dark: INK } });
    const y = doc.y;
    doc.image(qr, 48, y, { width: 96 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text('Verify this report', 160, y + 4);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('Scan the QR code or visit the address below and enter the code. The record is digitally signed (Ed25519); any alteration will fail verification.', 160, y + 22, { width: 380 });
    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(14).text(cert.code, 160, y + 56);
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(url, 160, y + 76, { width: 380 });
    doc.y = y + 110;
  }
  footer(doc, 'Confidential — issued to the named candidate');
  doc.end();
});

/** Examiner exam summary report built from real submission data. */
reportsRouter.get('/exams/:id/pdf', authenticate, async (req, res) => {
  const me = currentUser(req);
  const exam = await loadExamForStaff(me, param(req, 'id'));
  const a = await examAnalytics(exam.id);
  const attempts = await prisma.attempt.findMany({ where: { examId: exam.id, isSandbox: false, status: { not: 'IN_PROGRESS' } }, include: { candidate: { select: { name: true, email: true } } }, orderBy: { score: 'desc' } });
  const doc = startDoc(res, `exam-report-${exam.title.replace(/\W+/g, '-')}.pdf`);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text('Examination Summary Report', 48);
  doc.fillColor(MUTED).font('Helvetica').fontSize(11).text(`${exam.title}  ·  ${exam.windowStart.toISOString().slice(0, 10)}`);
  doc.moveDown(1);
  hr(doc);
  kv(doc, [
    ['Submissions', String(a.summary.count)],
    ['Mean', String(a.summary.mean)],
    ['Median', String(a.summary.median)],
    ['Pass rate', `${a.summary.passRate}%`],
    ['Highest', String(a.summary.max)],
    ['Lowest', String(a.summary.min)],
    ['Std. dev.', String(a.summary.sd)],
    ['Total marks', String(exam.totalMarks)],
  ]);
  hr(doc);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text('Score distribution', 48);
  doc.moveDown(0.5);
  const maxC = Math.max(1, ...a.distribution.map((d) => d.count));
  const baseY = doc.y + 90;
  a.distribution.forEach((d, i) => {
    const h = (d.count / maxC) * 80;
    const x = 48 + i * 50;
    doc.rect(x, baseY - h, 38, h).fill(ACCENT);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text(String(d.count), x, baseY - h - 11, { width: 38, align: 'center' });
    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(d.label, x - 4, baseY + 4, { width: 46, align: 'center' });
  });
  doc.y = baseY + 24;
  hr(doc);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text('Question analysis', 48);
  doc.moveDown(0.3);
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('Difficulty index = average % of marks earned. Discrimination = top 27% minus bottom 27% (≥ 0.3 good, < 0.1 review).', 48);
  doc.moveDown(0.4);
  const head = (y: number) => {
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8);
    [['Question', 48, 250], ['Diff.', 305, 40], ['Discr.', 350, 40], ['Skip', 395, 35], ['Time', 435, 40], ['Flags', 480, 70]].forEach(([t, x, w]) => doc.text(String(t), Number(x), y, { width: Number(w) }));
  };
  head(doc.y);
  doc.y += 14;
  a.questions.forEach((q) => {
    if (doc.y > doc.page.height - 80) {
      doc.addPage();
      head(60);
      doc.y = 74;
    }
    const y = doc.y;
    doc.fillColor(INK).font('Helvetica').fontSize(8.5).text(q.body.replace(/\s+/g, ' ').slice(0, 70), 48, y, { width: 250 });
    doc.text(`${q.difficultyIndex}%`, 305, y, { width: 40 });
    doc.text(q.discrimination === null ? '—' : String(q.discrimination), 350, y, { width: 40 });
    doc.text(`${q.skipRate}%`, 395, y, { width: 35 });
    doc.text(`${q.avgTimeSec}s`, 435, y, { width: 40 });
    doc.fillColor(q.flags.length ? '#b45309' : '#15803d').text(q.flags.length ? `${q.flags.length} issue(s)` : 'OK', 480, y, { width: 70 });
    doc.y = Math.max(doc.y, y + 12) + 3;
  });
  doc.addPage();
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text('Candidate scores', 48, 60);
  doc.moveDown(0.5);
  attempts.forEach((at, i) => {
    if (doc.y > doc.page.height - 70) doc.addPage();
    const y = doc.y;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(String(i + 1), 48, y, { width: 24 });
    doc.fillColor(INK).text(at.candidate.name, 74, y, { width: 170 });
    doc.fillColor(MUTED).text(at.candidate.email, 246, y, { width: 180 });
    doc.fillColor(INK).font('Helvetica-Bold').text(`${at.score ?? 0}/${at.maxScore}`, 430, y, { width: 60 });
    doc.fillColor((at.score ?? 0) >= exam.passMarks ? '#15803d' : '#b91c1c').text((at.score ?? 0) >= exam.passMarks ? 'PASS' : 'FAIL', 495, y, { width: 50 });
    doc.y = y + 15;
  });
  footer(doc, 'Confidential — for authorised examination staff only');
  doc.end();
});

/* ---------------------- public verification (no auth, minimal data) ---------------------- */
verifyRouter.get('/public-key', (_req, res) => res.type('text/plain').send(publicKeyPem));
verifyRouter.get('/:code', async (req, res) => {
  const code = param(req, 'code');
  res.json(await verifyCode(code));
});
