import type { ReactNode } from 'react';
import { Scale, ShieldCheck } from 'lucide-react';
import { cx } from '@/components/ui';
import type { Connection } from './types';

/* ------------------------------ connection ------------------------------ */

const CONN: Record<Connection, { label: string; dot: string; text: string }> = {
  online: { label: 'Online', dot: 'bg-ok', text: 'text-ok' },
  unstable: { label: 'Unstable', dot: 'bg-warn', text: 'text-warn' },
  offline: { label: 'Offline', dot: 'bg-danger', text: 'text-danger' },
  done: { label: 'Finished', dot: 'bg-line-strong', text: 'text-muted' },
};
export function ConnectionDot({ c, withLabel = true }: { c: Connection; withLabel?: boolean }) {
  const m = CONN[c];
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[13px] font-medium', m.text)} title={m.label}>
      <span className="relative flex size-2.5" aria-hidden>
        {c === 'online' && <span className={cx('pulse-dot absolute inset-0 rounded-full opacity-60', m.dot)} />}
        <span className={cx('relative inline-block size-2.5 rounded-full ring-2 ring-surface', m.dot)} />
      </span>
      {withLabel ? m.label : <span className="sr-only">{m.label}</span>}
    </span>
  );
}

/* ------------------------------ integrity ------------------------------ */

export type ToneKey = 'ok' | 'warn' | 'danger';
export const integrityTone = (score: number): ToneKey => (score >= 85 ? 'ok' : score >= 60 ? 'warn' : 'danger');
const TONE_CLS: Record<ToneKey, string> = { ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-danger' };
const TONE_BAR: Record<ToneKey, string> = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger' };

/** Integrity score 0–100 as a compact meter. Colour = threshold (≥85 calm, ≥60 look closer, <60 review). */
export function IntegrityPill({ score, className }: { score: number; className?: string }) {
  const t = integrityTone(score);
  return (
    <span className={cx('inline-flex items-center gap-2 rounded-md px-2 py-0.5 text-[13px] font-semibold', TONE_CLS[t], className)} title={`Integrity score ${score}/100 — ${t === 'ok' ? 'no concerns' : t === 'warn' ? 'worth a look' : 'review recommended'}`}>
      <span className="tabular">{score}</span>
      <span className="hidden h-1 w-8 overflow-hidden rounded-full bg-current/15 sm:block" aria-hidden>
        <span className={cx('block h-full rounded-full', TONE_BAR[t])} style={{ width: `${score}%` }} />
      </span>
    </span>
  );
}

/* ------------------------------ principle banner ------------------------------ */

export function EvidenceNotice({ compact, children }: { compact?: boolean; children?: ReactNode }) {
  return (
    <div className={cx('flex items-start gap-3 rounded-xl border border-info/25 bg-info-soft text-ink', compact ? 'px-3 py-2.5 text-[13px]' : 'px-4 py-3 text-sm')} role="note">
      <Scale className={cx('mt-0.5 shrink-0 text-info', compact ? 'size-4' : 'size-5')} aria-hidden />
      <div>
        <strong className="font-semibold">Integrity signals are evidence for review, not proof of misconduct.</strong>{' '}
        <span className="text-ink-2">{children ?? 'A switched tab can be a notification; a connection gap can be a router. Look at the context, talk to the candidate, then decide.'}</span>
      </div>
    </div>
  );
}

export function AuditNotice({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2/60 px-3 py-2.5 text-[13px] text-ink-2" role="note">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
      <span>{children ?? 'Every decision is recorded in the tamper-evident, hash-chained audit log.'}</span>
    </div>
  );
}

/* ------------------------------ misc ------------------------------ */

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">{children}</h3>
      {right}
    </div>
  );
}

export const fmtSec = (s: number) => {
  const v = Math.max(0, Math.round(s));
  if (v < 60) return `${v}s`;
  const m = Math.floor(v / 60);
  const r = v % 60;
  if (m < 60) return r ? `${m} min ${r}s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
};

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const fmtScore = (n: number | null | undefined) => (n == null ? '—' : String(round2(n)));

/** Short browser/device label from a user-agent string. */
export function deviceLabel(ua?: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' on ');
}

export const CATEGORY_LABEL: Record<string, string> = {
  GRADING_ERROR: 'Grading error',
  AMBIGUOUS_QUESTION: 'Ambiguous question',
  TECHNICAL_ISSUE: 'Technical issue',
  OTHER: 'Other',
};
