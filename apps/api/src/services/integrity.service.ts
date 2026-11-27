import type { Severity } from '@prisma/client';
import { prisma } from '../core/prisma.js';
import { emitToMonitors } from '../core/realtime.js';
import { readSettings } from '../domain/examPhase.js';

/**
 * Privacy-first integrity signals (Innovation 5.1). No webcam, no microphone, no screen capture.
 * Each signal is evidence for a human reviewer, never an automatic verdict.
 */
export const SIGNALS: Record<string, { severity: Severity; counts: boolean; label: string }> = {
  TAB_HIDDEN: { severity: 'MEDIUM', counts: true, label: 'Switched tab or minimised the window' },
  WINDOW_BLUR: { severity: 'LOW', counts: true, label: 'Exam window lost focus' },
  FULLSCREEN_EXIT: { severity: 'MEDIUM', counts: true, label: 'Exited full-screen mode' },
  COPY_ATTEMPT: { severity: 'LOW', counts: true, label: 'Tried to copy exam content' },
  CUT_ATTEMPT: { severity: 'LOW', counts: true, label: 'Tried to cut text' },
  PASTE_ATTEMPT: { severity: 'MEDIUM', counts: true, label: 'Tried to paste external text' },
  CONTEXT_MENU: { severity: 'LOW', counts: false, label: 'Opened the right-click menu' },
  BLOCKED_SHORTCUT: { severity: 'MEDIUM', counts: true, label: 'Used a blocked keyboard shortcut' },
  SCREENSHOT_KEY: { severity: 'MEDIUM', counts: true, label: 'Pressed the screenshot key' },
  DEVTOOLS_OPEN: { severity: 'HIGH', counts: true, label: 'Browser developer tools appear to be open' },
  MULTI_SCREEN: { severity: 'MEDIUM', counts: true, label: 'A second monitor is connected' },
  PASTE_LIKE_INPUT: { severity: 'MEDIUM', counts: true, label: 'Large block of text appeared at once (possible paste/AI insert)' },
  TYPING_ANOMALY: { severity: 'LOW', counts: false, label: 'Typing rhythm unusually uniform (possible auto-typer)' },
  RAPID_ANSWERS: { severity: 'LOW', counts: false, label: 'Several questions answered in a few seconds each' },
  SPLIT_SCREEN: { severity: 'LOW', counts: false, label: 'Exam window resized to a small portion of the screen' },
};
const PENALTY: Record<Severity, number> = { LOW: 2, MEDIUM: 6, HIGH: 12 };
const INFO_EVENTS = new Set(['NETWORK_OFFLINE', 'NETWORK_ONLINE', 'QUESTION_VIEW', 'FULLSCREEN_ENTER', 'SCRATCHPAD_OPEN', 'PREFS_CHANGED', 'TAB_VISIBLE']);

export interface ClientEvent {
  type: string;
  at?: number;
  details?: string;
}

export async function recordEvents(attempt: { id: string; examId: string; isSandbox: boolean; violationCount: number; integrityScore: number; exam: { settings: unknown } }, events: ClientEvent[]) {
  let violations = attempt.violationCount;
  let score = attempt.integrityScore;
  const created: string[] = [];
  for (const e of events.slice(0, 50)) {
    const sig = SIGNALS[e.type];
    if (!sig && !INFO_EVENTS.has(e.type)) continue;
    await prisma.attemptEvent.create({ data: { attemptId: attempt.id, type: e.type, payload: { details: e.details?.slice(0, 300), clientAt: e.at } } });
    if (!sig) continue;
    await prisma.incident.create({ data: { attemptId: attempt.id, type: e.type, severity: sig.severity, details: [sig.label, e.details].filter(Boolean).join(' — ').slice(0, 400) } });
    created.push(e.type);
    if (sig.counts) violations++;
    score = Math.max(0, score - PENALTY[sig.severity]);
  }
  const settings = readSettings(attempt.exam.settings);
  await prisma.attempt.update({ where: { id: attempt.id }, data: { violationCount: violations, integrityScore: score } });
  if (created.length && !attempt.isSandbox) emitToMonitors(attempt.examId, 'incident:new', { attemptId: attempt.id, types: created });
  const limitReached = settings.maxViolations > 0 && violations >= settings.maxViolations;
  return { violations, maxViolations: settings.maxViolations, integrityScore: score, limitReached, warnings: Math.max(0, settings.maxViolations - violations) };
}
