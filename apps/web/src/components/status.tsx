import { Badge } from './ui';
import type { Phase } from '@/lib/types';

const PHASE: Record<Phase, { tone: 'neutral' | 'info' | 'ok' | 'accent' | 'warn'; label: string }> = {
  DRAFT: { tone: 'neutral', label: 'Draft' },
  PUBLISHED: { tone: 'info', label: 'Scheduled' },
  ONGOING: { tone: 'ok', label: 'Live now' },
  COMPLETED: { tone: 'accent', label: 'Completed' },
  ARCHIVED: { tone: 'neutral', label: 'Archived' },
};
export const PhaseBadge = ({ phase, paused }: { phase: Phase; paused?: boolean }) =>
  paused ? (
    <Badge tone="warn" dot>
      Paused
    </Badge>
  ) : (
    <Badge tone={PHASE[phase].tone} dot={phase === 'ONGOING'}>
      {PHASE[phase].label}
    </Badge>
  );

const ATTEMPT: Record<string, { tone: 'neutral' | 'info' | 'ok' | 'warn' | 'danger'; label: string }> = {
  IN_PROGRESS: { tone: 'info', label: 'In progress' },
  SUBMITTED: { tone: 'ok', label: 'Submitted' },
  AUTO_SUBMITTED: { tone: 'warn', label: 'Auto-submitted' },
  FORCE_SUBMITTED: { tone: 'danger', label: 'Force-submitted' },
  NOT_STARTED: { tone: 'neutral', label: 'Not started' },
  ABSENT: { tone: 'danger', label: 'Absent' },
};
export const AttemptBadge = ({ status }: { status: string }) => <Badge tone={ATTEMPT[status]?.tone ?? 'neutral'}>{ATTEMPT[status]?.label ?? status}</Badge>;

export const SeverityBadge = ({ s }: { s: string }) => <Badge tone={s === 'HIGH' ? 'danger' : s === 'MEDIUM' ? 'warn' : 'neutral'}>{s.toLowerCase()}</Badge>;

const DISPUTE: Record<string, { tone: 'neutral' | 'info' | 'ok' | 'warn' | 'danger'; label: string }> = {
  OPEN: { tone: 'warn', label: 'Open' },
  UNDER_REVIEW: { tone: 'info', label: 'Under review' },
  UPHELD: { tone: 'ok', label: 'Upheld' },
  REJECTED: { tone: 'neutral', label: 'Rejected' },
};
export const DisputeBadge = ({ status }: { status: string }) => <Badge tone={DISPUTE[status]?.tone}>{DISPUTE[status]?.label ?? status}</Badge>;

export const DIFFICULTY_TONE = { EASY: 'ok', MEDIUM: 'warn', HARD: 'danger' } as const;
export const TYPE_LABEL: Record<string, string> = { SINGLE: 'Single answer', MULTI: 'Multiple select', WRITTEN: 'Written' };
