export type ExamPhase = 'DRAFT' | 'PUBLISHED' | 'ONGOING' | 'COMPLETED' | 'ARCHIVED';

/** Stored status is DRAFT/PUBLISHED/COMPLETED/ARCHIVED; ONGOING is derived from the server clock. */
export function examPhase(e: { status: string; windowStart: Date; windowEnd: Date }, now = new Date()): ExamPhase {
  if (e.status === 'DRAFT') return 'DRAFT';
  if (e.status === 'ARCHIVED') return 'ARCHIVED';
  if (e.status === 'COMPLETED') return 'COMPLETED';
  if (now < e.windowStart) return 'PUBLISHED';
  if (now <= e.windowEnd) return 'ONGOING';
  return 'COMPLETED';
}

export interface ExamSettings {
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  allowBackNav: boolean;
  requireFullscreen: boolean;
  maxViolations: number; // 0 = never auto-submit
  showCorrectAnswers: boolean;
  lateJoinMin: number; // minutes after window start candidates can still begin (0 = any time in window)
  gracePeriodSec: number; // network grace for answers in flight at deadline
  autoCompensate: boolean;
}

export const defaultSettings: ExamSettings = {
  shuffleQuestions: true,
  shuffleOptions: true,
  allowBackNav: true,
  requireFullscreen: true,
  maxViolations: 5,
  showCorrectAnswers: false,
  lateJoinMin: 0,
  gracePeriodSec: 10,
  autoCompensate: false,
};

export const readSettings = (s: unknown): ExamSettings => ({ ...defaultSettings, ...((s as object) ?? {}) });

/** Attempt deadline = min(start + duration * (1 + accommodation) + compensation, window end) */
export function computeDeadline(startedAt: Date, durationMin: number, extraTimePct: number, windowEnd: Date, extraSec = 0) {
  // base time is the duration, or whatever is left of the window if the candidate starts late;
  // accommodations scale that base time, and compensations are added on top
  const base = Math.max(0, Math.min(durationMin * 60_000, windowEnd.getTime() - startedAt.getTime()));
  return new Date(startedAt.getTime() + base * (1 + extraTimePct / 100) + extraSec * 1000);
}
