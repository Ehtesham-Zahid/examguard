/**
 * Transactional email templates in the Examify "Graph Notebook" style.
 *
 * Pure functions: (kind, data) -> { subject, html, text }. Email clients ignore <style> blocks and web fonts
 * unevenly, so everything is table-based with inline styles and system font stacks, and every email has a
 * plain-text part. Data is snapshotted when the email is queued, so a preview shows exactly what was sent.
 */
import { config } from '../../core/config.js';

export type EmailKind =
  | 'exam_scheduled'
  | 'exam_reminder'
  | 'exam_open'
  | 'exam_reopened'
  | 'results_published'
  | 'score_updated'
  | 'dispute_decided'
  | 'dispute_raised'
  | 'welcome'
  | 'password_reset'
  | 'password_forgot'
  | 'password_changed'
  | 'test';

export type EmailCategory = 'exams' | 'results' | 'disputes' | 'account';

export const CATEGORY: Record<EmailKind, EmailCategory> = {
  exam_scheduled: 'exams',
  exam_reminder: 'exams',
  exam_open: 'exams',
  exam_reopened: 'exams',
  results_published: 'results',
  score_updated: 'results',
  dispute_decided: 'disputes',
  dispute_raised: 'disputes',
  welcome: 'account',
  password_reset: 'account',
  password_forgot: 'account',
  password_changed: 'account',
  test: 'account',
};

export interface ExamInfo {
  examId: string;
  title: string;
  examiner?: string;
  windowStart: string;
  windowEnd: string;
  durationMin: number;
  extraTimePct?: number;
  totalMarks?: number;
  requiresAccessCode?: boolean;
}

export type EmailData = { name: string } & Record<string, any>;

export interface Rendered {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

/* ---------------------------------------------------------------- palette */
const C = {
  ink: '#172A46',
  ink2: '#3B4C66',
  muted: '#5A6A84',
  hl: '#F7E64A',
  hlWash: '#FFF9C9',
  margin: '#E04F5F',
  grid: '#D6E8F5',
  page: '#EEF4FA',
  surface: '#FFFFFF',
  ok: '#1D7A46',
  okWash: '#E3F4EA',
  danger: '#C2343F',
  dangerWash: '#FCE8EA',
};
const SANS = "'Familjen Grotesk','Segoe UI',Helvetica,Arial,sans-serif";
const BODY = "'Atkinson Hyperlegible','Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono',SFMono-Regular,Menlo,Consolas,monospace";

/* ---------------------------------------------------------------- helpers */
export const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const url = (path: string) => `${config.publicUrl}${path.startsWith('/') ? path : `/${path}`}`;
const first = (name: string) => (name || '').trim().split(/\s+/)[0] || 'there';

function zoneName(d: Date) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: config.email.timeZone, timeZoneName: 'long' }).formatToParts(d).find((p) => p.type === 'timeZoneName');
  return part?.value ?? config.email.timeZone;
}
export function fmtWhen(iso: string) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: config.email.timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: config.email.timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  return `${day} · ${time}`;
}
const fmtDuration = (min: number, extraPct = 0) => {
  const total = Math.round(min * (1 + extraPct / 100));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const base = h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
  return extraPct > 0 ? `${base} (includes +${extraPct}% extra time)` : base;
};

/* ---------------------------------------------------------------- blocks */
type Block = { html: string; text: string };

const p = (t: string, opts: { muted?: boolean; size?: number } = {}): Block => ({
  html: `<p style="margin:0 0 16px;font-family:${BODY};font-size:${opts.size ?? 16}px;line-height:1.6;color:${opts.muted ? C.muted : C.ink2};">${t}</p>`,
  text: t.replace(/<[^>]+>/g, ''),
});

/** Key/value "ticket" with dashed rules, like a filled-in form on graph paper. */
const details = (rows: [string, string][]): Block => ({
  html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;border:2px solid ${C.ink};border-radius:12px;border-collapse:separate;background:${C.surface};">
${rows
  .map(
    ([k, v], i) => `<tr><td style="padding:12px 16px;${i ? `border-top:1px dashed ${C.grid};` : ''}font-family:${MONO};font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${C.muted};white-space:nowrap;vertical-align:top;width:120px;">${esc(k)}</td><td style="padding:12px 16px 12px 0;${i ? `border-top:1px dashed ${C.grid};` : ''}font-family:${BODY};font-size:15px;font-weight:600;color:${C.ink};vertical-align:top;">${v}</td></tr>`,
  )
  .join('\n')}
</table>`,
  text: rows.map(([k, v]) => `${k}: ${v.replace(/<[^>]+>/g, '')}`).join('\n'),
});

/** Bulletproof button (a padded table cell works in Outlook, Gmail and Apple Mail). */
const button = (label: string, href: string): Block => ({
  html: `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:10px;background:${C.ink};border-bottom:4px solid ${C.hl};">
<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:${SANS};font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;">${esc(label)} &rarr;</a></td></tr></table>`,
  text: `${label}: ${href}`,
});

const note = (t: string, tone: 'hl' | 'ok' | 'danger' | 'info' = 'hl'): Block => {
  const bg = tone === 'ok' ? C.okWash : tone === 'danger' ? C.dangerWash : tone === 'info' ? C.page : C.hlWash;
  const bar = tone === 'ok' ? C.ok : tone === 'danger' ? C.danger : tone === 'info' ? '#5B8FD6' : C.ink;
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="background:${bg};border-left:4px solid ${bar};border-radius:8px;padding:14px 16px;font-family:${BODY};font-size:14px;line-height:1.55;color:${C.ink};">${t}</td></tr></table>`,
    text: `» ${t.replace(/<[^>]+>/g, '')}`,
  };
};

const code = (label: string, value: string): Block => ({
  html: `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="font-family:${MONO};font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${C.muted};padding-bottom:6px;">${esc(label)}</td></tr><tr><td style="background:${C.hl};border:2px solid ${C.ink};border-radius:8px;padding:10px 16px;font-family:${MONO};font-size:18px;font-weight:700;letter-spacing:2px;color:${C.ink};">${esc(value)}</td></tr></table>`,
  text: `${label}: ${value}`,
});

const linkFallback = (href: string): Block => ({
  html: `<p style="margin:0 0 8px;font-family:${BODY};font-size:12px;line-height:1.5;color:${C.muted};">Button not working? Paste this link into your browser:<br><a href="${esc(href)}" style="color:${C.ink};word-break:break-all;">${esc(href)}</a></p>`,
  text: '',
});

/* ---------------------------------------------------------------- layout */
interface Doc {
  subject: string;
  preheader: string;
  eyebrow: string;
  title: string;
  highlight?: string; // part of the title drawn over with a highlighter
  accent?: 'ink' | 'ok' | 'danger';
  blocks: Block[];
  footer?: string;
}

function layout(d: Doc): Rendered {
  const accent = d.accent === 'ok' ? C.ok : d.accent === 'danger' ? C.danger : C.margin;
  const titleHtml = d.highlight && d.title.includes(d.highlight) ? esc(d.title).replace(esc(d.highlight), `<span style="background:${C.hl};color:${C.ink};padding:0 6px;border-radius:4px;-webkit-box-decoration-break:clone;box-decoration-break:clone;">${esc(d.highlight)}</span>`) : esc(d.title);
  const prefs = url('/settings');
  const footer = d.footer ?? `You're getting this because you have an Examify account. <a href="${esc(prefs)}" style="color:${C.ink};">Email preferences</a>`;
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(d.subject)}</title>
<style>
  @media (max-width:620px){ .eg-card{padding:28px 22px 24px 30px !important} .eg-title{font-size:26px !important} }
  a{color:${C.ink}}
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(d.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};background-image:linear-gradient(${C.grid} 1px,transparent 1px),linear-gradient(90deg,${C.grid} 1px,transparent 1px);background-size:24px 24px;">
<tr><td align="center" style="padding:32px 12px 40px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
    <!-- brand -->
    <tr><td style="padding:0 4px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:34px;height:34px;background:${C.ink};border-radius:9px;text-align:center;vertical-align:middle;font-family:${SANS};font-size:18px;font-weight:800;color:${C.hl};">E</td>
            <td style="padding-left:10px;font-family:${SANS};font-size:20px;font-weight:800;letter-spacing:-0.3px;color:${C.ink};">Examify</td>
          </tr></table>
        </td>
        <td align="right" style="vertical-align:middle;font-family:${MONO};font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.muted};">${esc(d.eyebrow)}</td>
      </tr></table>
    </td></tr>
    <!-- card -->
    <tr><td style="background:${C.surface};border:2px solid ${C.ink};border-radius:16px;box-shadow:6px 6px 0 ${C.ink};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="width:3px;background:${accent};border-radius:14px 0 0 14px;font-size:0;line-height:0;">&nbsp;</td>
        <td class="eg-card" style="padding:36px 36px 28px 34px;">
          <div style="margin:0 0 14px;font-family:${MONO};font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${accent};">&mdash;&nbsp; ${esc(d.eyebrow)}</div>
          <h1 class="eg-title" style="margin:0 0 20px;font-family:${SANS};font-size:30px;line-height:1.22;font-weight:800;letter-spacing:-0.5px;color:${C.ink};">${titleHtml}</h1>
          ${d.blocks.map((b) => b.html).join('\n')}
        </td>
      </tr></table>
    </td></tr>
    <!-- footer -->
    <tr><td style="padding:22px 8px 0;font-family:${BODY};font-size:12px;line-height:1.6;color:${C.muted};text-align:center;">
      ${footer}<br>
      <span style="font-family:${MONO};font-size:11px;letter-spacing:0.6px;">Examify &middot; secure examination management &middot; <a href="${esc(config.publicUrl)}" style="color:${C.muted};">${esc(config.publicUrl.replace(/^https?:\/\//, ''))}</a></span>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
  const text = [`EXAMIFY — ${d.eyebrow.toUpperCase()}`, '', d.title, '', ...d.blocks.map((b) => b.text).filter(Boolean).flatMap((t) => [t, '']), '—', footer.replace(/<[^>]+>/g, ''), `Email preferences: ${prefs}`].join('\n');
  return { subject: d.subject, preheader: d.preheader, html, text };
}

/* ---------------------------------------------------------------- shared exam block */
function examTicket(e: ExamInfo, opts: { showClose?: boolean } = {}) {
  const rows: [string, string][] = [
    ['Exam', esc(e.title)],
    ['Opens', esc(fmtWhen(e.windowStart))],
    ['Closes', esc(fmtWhen(e.windowEnd))],
    ['Duration', esc(fmtDuration(e.durationMin, e.extraTimePct))],
  ];
  if (e.totalMarks) rows.push(['Marks', esc(String(e.totalMarks))]);
  if (e.examiner) rows.push(['Examiner', esc(e.examiner)]);
  if (!opts.showClose) rows.splice(2, 1);
  return details(rows);
}
const tzNote = (iso: string) => p(`All times are ${esc(zoneName(new Date(iso)))}. The exam timer runs on our server, so your device clock doesn't matter.`, { muted: true, size: 13 });

const REDACTED = '#link-already-delivered';
const tokenLink = (path: string, token: string | null | undefined) => (token ? url(`${path}?token=${encodeURIComponent(token)}`) : REDACTED);

/* ---------------------------------------------------------------- templates */
export function renderEmail(kind: EmailKind, data: EmailData): Rendered {
  const hi = p(`Hi ${esc(first(data.name))},`);
  switch (kind) {
    case 'exam_scheduled': {
      const e = data.exam as ExamInfo;
      const lobby = url(`/candidate/exams/${e.examId}`);
      return layout({
        subject: `Scheduled: ${e.title} — ${fmtWhen(e.windowStart)}`,
        preheader: `Your exam opens ${fmtWhen(e.windowStart)}. Add it to your calendar.`,
        eyebrow: 'Exam scheduled',
        title: `You're registered for ${e.title}`,
        highlight: e.title,
        blocks: [
          hi,
          p(`You've been enrolled in an examination. The details are below, and a calendar invite is attached so it lands in your calendar.`),
          examTicket(e, { showClose: true }),
          ...(e.requiresAccessCode ? [note(`<strong>You'll need an access code</strong> to start. Your examiner will share it in the exam room; it is never sent by email.`)] : []),
          button('View instructions', lobby),
          note(`Before the day: open the link once on the device you'll use, check your connection, and read the rules. If your internet drops during the exam, keep going — answers are saved on your device and sync when you're back online.`, 'info'),
          tzNote(e.windowStart),
        ],
      });
    }
    case 'exam_reminder': {
      const e = data.exam as ExamInfo;
      return layout({
        subject: `Reminder: ${e.title} opens ${fmtWhen(e.windowStart)}`,
        preheader: `Your exam opens soon — here's what to have ready.`,
        eyebrow: 'Reminder',
        title: `${e.title} opens soon`,
        highlight: 'opens soon',
        blocks: [
          hi,
          p(`A quick reminder that your exam is coming up.`),
          examTicket(e, { showClose: true }),
          details([
            ['Checklist', `Charged device and a stable connection<br>Quiet room, notes away<br>${e.requiresAccessCode ? 'Access code from your examiner' : 'Nothing else needed — just sign in'}`],
          ]),
          button('Open the exam lobby', url(`/candidate/exams/${e.examId}`)),
          tzNote(e.windowStart),
        ],
      });
    }
    case 'exam_open': {
      const e = data.exam as ExamInfo;
      return layout({
        subject: `Open now: ${e.title}`,
        preheader: `You can start now. The window closes ${fmtWhen(e.windowEnd)}.`,
        eyebrow: 'Exam open',
        title: `${e.title} is open now`,
        highlight: 'open now',
        accent: 'ok',
        blocks: [
          hi,
          p(`The exam window has opened and you can start whenever you're ready. Your timer only begins when you press <strong>Start</strong>.`),
          details([
            ['Exam', esc(e.title)],
            ['Window closes', esc(fmtWhen(e.windowEnd))],
            ['Time allowed', esc(fmtDuration(e.durationMin, e.extraTimePct))],
          ]),
          button('Start the exam', url(`/candidate/exams/${e.examId}`)),
          note(`Start early enough to finish before the window closes — if you start late, your time is cut to the window's end.`, 'info'),
          tzNote(e.windowEnd),
        ],
      });
    }
    case 'exam_reopened': {
      return layout({
        subject: `Your exam has been reopened: ${data.title}`,
        preheader: `You have ${data.minutes} minute(s) to continue.`,
        eyebrow: 'Exam reopened',
        title: `You can continue ${data.title}`,
        highlight: 'continue',
        accent: 'ok',
        blocks: [
          hi,
          p(`Your examiner reviewed the connection problem during your attempt and reopened it. Your saved answers are exactly where you left them.`),
          details([
            ['Exam', esc(data.title)],
            ['Time granted', `${esc(data.minutes)} minute(s)`],
          ]),
          button('Continue the exam', url(`/candidate/exams/${data.examId}`)),
        ],
      });
    }
    case 'results_published': {
      const link = url(`/candidate/results/${data.attemptId}`);
      return layout({
        subject: `Your result is ready: ${data.title}`,
        preheader: `Sign in to see your score, feedback and certificate.`,
        eyebrow: 'Results published',
        title: `Your result for ${data.title} is ready`,
        highlight: 'is ready',
        accent: 'ok',
        blocks: [
          hi,
          p(`Your examiner has published results. Sign in to see your score, per-question feedback and your downloadable report.`),
          button('See my result', link),
          ...(data.certificateCode ? [code('Certificate verification code', data.certificateCode), p(`Anyone — an employer, a university — can check your certificate is genuine at <a href="${esc(url(`/verify/${data.certificateCode}`))}" style="color:${C.ink};font-weight:700;">${esc(url('/verify'))}</a>. The code proves authenticity without revealing anything else.`, { size: 14 })] : []),
          note(`Think a question was marked incorrectly? You can raise a dispute from the result page.`, 'info'),
        ],
      });
    }
    case 'score_updated':
      return layout({
        subject: `Your score was updated: ${data.title}`,
        preheader: `A question was re-graded after a review.`,
        eyebrow: 'Score updated',
        title: `Your score for ${data.title} changed`,
        highlight: 'changed',
        blocks: [hi, p(`A question in this exam was re-graded after a review, so your score was recalculated for everyone affected. Your certificate was reissued with the new score.`), button('See my result', url(`/candidate/results/${data.attemptId}`))],
      });
    case 'dispute_decided': {
      const upheld = data.decision === 'UPHELD';
      return layout({
        subject: `Dispute ${upheld ? 'upheld' : 'reviewed'}: ${data.title}`,
        preheader: upheld ? 'Your dispute was upheld and your score was updated.' : 'Your examiner reviewed your dispute.',
        eyebrow: upheld ? 'Dispute upheld' : 'Dispute decided',
        title: upheld ? `Your dispute was upheld` : `Your dispute was reviewed`,
        highlight: upheld ? 'upheld' : 'reviewed',
        accent: upheld ? 'ok' : 'ink',
        blocks: [
          hi,
          p(upheld ? `Good news — your examiner agreed with your dispute on <strong>${esc(data.title)}</strong> and the marking was corrected.` : `Your examiner has reviewed your dispute on <strong>${esc(data.title)}</strong> and kept the original marking.`),
          note(`<strong>Examiner's response:</strong><br>${esc(data.resolution)}`, upheld ? 'ok' : 'hl'),
          button('View my disputes', url('/candidate/disputes')),
        ],
      });
    }
    case 'dispute_raised':
      return layout({
        subject: `New dispute on ${data.title}`,
        preheader: `${data.candidateName} raised a dispute.`,
        eyebrow: 'Needs review',
        title: `New result dispute`,
        highlight: 'dispute',
        accent: 'danger',
        blocks: [hi, p(`<strong>${esc(data.candidateName)}</strong> raised a dispute on <strong>${esc(data.title)}</strong>.`), ...(data.reason ? [note(esc(data.reason))] : []), button('Review disputes', url('/examiner/disputes'))],
      });
    case 'welcome': {
      const link = tokenLink('/reset-password', data.token);
      return layout({
        subject: `Welcome to Examify — set your password`,
        preheader: `Your ${String(data.role ?? 'candidate').toLowerCase()} account is ready.`,
        eyebrow: 'Welcome',
        title: `Your account is ready`,
        highlight: 'ready',
        blocks: [
          hi,
          p(`${data.invitedBy ? `${esc(data.invitedBy)} created` : 'An administrator created'} an Examify ${esc(String(data.role ?? 'candidate').toLowerCase())} account for you. Choose a password to finish setting it up.`),
          details([
            ['Sign-in email', esc(data.email)],
            ['Link expires', esc(data.expiresAt ? fmtWhen(data.expiresAt) : 'in 7 days')],
          ]),
          button('Set my password', link),
          linkFallback(link),
          p(`If you weren't expecting this, you can ignore the email — nothing happens until a password is set.`, { muted: true, size: 13 }),
        ],
      });
    }
    case 'password_reset':
    case 'password_forgot': {
      const link = tokenLink('/reset-password', data.token);
      const admin = kind === 'password_reset';
      return layout({
        subject: admin ? 'Your Examify password was reset' : 'Reset your Examify password',
        preheader: admin ? 'Choose a new password to sign in again.' : 'Use this link to choose a new password.',
        eyebrow: 'Password',
        title: admin ? 'Your password was reset' : 'Reset your password',
        highlight: admin ? 'reset' : 'password',
        blocks: [
          hi,
          p(admin ? `An administrator reset your password and signed you out of every device. Choose a new password to sign in again.` : `We received a request to reset the password for <strong>${esc(data.email)}</strong>. This link works once and expires ${esc(data.expiresAt ? `on ${fmtWhen(data.expiresAt)}` : 'soon')}.`),
          button('Choose a new password', link),
          linkFallback(link),
          note(admin ? `Didn't ask for this? Contact your administrator.` : `Didn't request this? You can safely ignore this email — your password won't change.`, 'info'),
        ],
      });
    }
    case 'password_changed':
      return layout({
        subject: 'Your Examify password was changed',
        preheader: 'If this was you, no action is needed.',
        eyebrow: 'Security',
        title: 'Your password was changed',
        highlight: 'changed',
        blocks: [
          hi,
          p(`The password for <strong>${esc(data.email)}</strong> was changed on ${esc(fmtWhen(data.at ?? new Date().toISOString()))}.`),
          note(`If this wasn't you, reset your password right away and tell your administrator.`, 'danger'),
          button('Reset my password', url('/forgot-password')),
        ],
        footer: `This security notice is always sent and can't be turned off.`,
      });
    case 'test':
      return layout({
        subject: 'Examify test email ✓',
        preheader: 'Email delivery is working.',
        eyebrow: 'Test',
        title: 'Email delivery works',
        highlight: 'works',
        accent: 'ok',
        blocks: [
          hi,
          p(`This is a test message sent by ${esc(data.sentBy ?? 'an administrator')} from the Examify email log. If you can read it, exam notifications, reminders and result emails will reach your candidates.`),
          details([
            ['Sent at', esc(fmtWhen(data.at ?? new Date().toISOString()))],
            ['Server', esc(config.publicUrl)],
          ]),
        ],
      });
  }
}

/* ---------------------------------------------------------------- calendar invite */
const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);
/** RFC 5545 lines are folded at 75 octets. */
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ' ' + rest.slice(cut);
  }
  out.push(rest);
  return out.join('\r\n');
};

export function examIcs(e: ExamInfo) {
  const link = url(`/candidate/exams/${e.examId}`);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Examify//Exams//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:exam-${e.examId}@examify`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(e.windowStart)}`,
    `DTEND:${icsDate(e.windowEnd)}`,
    `SUMMARY:${icsText(`Exam: ${e.title}`)}`,
    `DESCRIPTION:${icsText(`Exam window for ${e.title}. Time allowed: ${fmtDuration(e.durationMin, e.extraTimePct)}.\nStart here: ${link}`)}`,
    `URL:${link}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(`${e.title} opens in 30 minutes`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
