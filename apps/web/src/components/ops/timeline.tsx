import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CirclePlay, Clock, CloudUpload, Laptop, LogIn, MonitorSmartphone, RotateCcw, ShieldAlert, Wifi, WifiOff, type LucideIcon } from 'lucide-react';
import { fmtDuration, fmtTime } from '@/lib/format';
import { cx, EmptyState, Toggle } from '@/components/ui';
import type { AttemptEvent } from './types';
import { deviceLabel, fmtSec } from './bits';

type Kind = 'system' | 'integrity' | 'network' | 'staff' | 'info';

/** Client copy of the server's integrity signal labels (apps/api/src/services/integrity.service.ts). */
const SIGNAL_LABEL: Record<string, string> = {
  TAB_HIDDEN: 'Switched tab or minimised the window',
  WINDOW_BLUR: 'Exam window lost focus',
  FULLSCREEN_EXIT: 'Exited full-screen mode',
  COPY_ATTEMPT: 'Tried to copy exam content',
  CUT_ATTEMPT: 'Tried to cut text',
  PASTE_ATTEMPT: 'Tried to paste external text',
  CONTEXT_MENU: 'Opened the right-click menu',
  BLOCKED_SHORTCUT: 'Used a blocked keyboard shortcut',
  SCREENSHOT_KEY: 'Pressed the screenshot key',
  DEVTOOLS_OPEN: 'Browser developer tools appear to be open',
  MULTI_SCREEN: 'A second monitor is connected',
  PASTE_LIKE_INPUT: 'Large block of text appeared at once',
  TYPING_ANOMALY: 'Typing rhythm unusually uniform',
  RAPID_ANSWERS: 'Several questions answered in a few seconds each',
  SPLIT_SCREEN: 'Exam window resized to a small portion of the screen',
};
const INFO_LABEL: Record<string, string> = {
  NETWORK_OFFLINE: 'Device went offline',
  NETWORK_ONLINE: 'Device back online',
  QUESTION_VIEW: 'Viewed a question',
  FULLSCREEN_ENTER: 'Entered full-screen',
  SCRATCHPAD_OPEN: 'Opened the scratchpad',
  PREFS_CHANGED: 'Changed reading / accessibility preferences',
  TAB_VISIBLE: 'Returned to the exam tab',
};

const n = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0));
const s = (v: unknown) => (typeof v === 'string' ? v : '');

export function describeEvent(e: AttemptEvent): { kind: Kind; icon: LucideIcon; title: string; detail?: string } {
  const p = e.payload ?? {};
  switch (e.type) {
    case 'attempt_started':
      return { kind: 'system', icon: CirclePlay, title: 'Started the exam', detail: [deviceLabel(s(p.ua)), s(p.ip)].filter(Boolean).join(' · ') };
    case 'connectivity_gap':
      return { kind: 'network', icon: WifiOff, title: `No contact for ${fmtSec(n(p.seconds))}`, detail: `${p.from ? fmtTime(s(p.from)) : ''}–${p.to ? fmtTime(s(p.to)) : ''} · ${fmtSec(n(p.remainingAtGapStartSec))} remained when it began` };
    case 'offline_answers_synced':
      return { kind: 'network', icon: CloudUpload, title: `${n(p.count)} answer(s) saved offline were synced`, detail: 'Work done during the outage was kept.' };
    case 'offline_answers_merged_after_deadline':
      return { kind: 'network', icon: CloudUpload, title: `${n(p.count)} offline answer(s) merged after the deadline`, detail: 'They were written before time ran out and arrived late.' };
    case 'device_switched':
      return { kind: 'system', icon: Laptop, title: p.auto ? 'Continued on a new device (old one went silent)' : 'Continued on a new device (approved)', detail: [deviceLabel(s(p.ua)), s(p.ip), p.silentForSec ? `previous device silent ${fmtSec(n(p.silentForSec))}` : ''].filter(Boolean).join(' · ') };
    case 'time_extended':
      return { kind: 'staff', icon: Clock, title: `+${n(p.minutes)} min added${p.by ? ` by ${s(p.by)}` : ''}`, detail: s(p.reason) };
    case 'attempt_reopened':
      return { kind: 'staff', icon: RotateCcw, title: `Reopened with ${fmtSec(n(p.seconds))} restored`, detail: p.by ? `by ${s(p.by)}` : undefined };
    case 'attempt_finalized': {
      const st = s(p.status);
      const reason = s(p.reason);
      const title = st === 'SUBMITTED' ? 'Submitted by the candidate' : st === 'AUTO_SUBMITTED' ? 'Auto-submitted' : st === 'FORCE_SUBMITTED' ? 'Force-submitted' : 'Attempt finalised';
      const REASONS: Record<string, string> = {
        exam_closed_by_examiner: 'The examiner closed the exam',
        time_expired: 'Time ran out',
        integrity_violation_limit: 'Reached the maximum number of integrity warnings',
        candidate_submitted: '',
      };
      const pretty = reason in REASONS ? REASONS[reason] : reason.startsWith('examiner: ') ? `Examiner: ${reason.slice(10)}` : reason.replace(/_/g, ' ');
      return { kind: st === 'SUBMITTED' ? 'system' : 'staff', icon: CheckCircle2, title, detail: pretty || undefined };
    }
  }
  if (SIGNAL_LABEL[e.type]) return { kind: 'integrity', icon: ShieldAlert, title: SIGNAL_LABEL[e.type], detail: s(p.details) || undefined };
  if (e.type === 'NETWORK_OFFLINE') return { kind: 'network', icon: WifiOff, title: INFO_LABEL[e.type] };
  if (e.type === 'NETWORK_ONLINE') return { kind: 'network', icon: Wifi, title: INFO_LABEL[e.type] };
  if (INFO_LABEL[e.type]) return { kind: 'info', icon: e.type === 'QUESTION_VIEW' ? MonitorSmartphone : LogIn, title: INFO_LABEL[e.type], detail: s(p.details) || undefined };
  return { kind: 'info', icon: AlertTriangle, title: e.type.replace(/_/g, ' ').toLowerCase(), detail: s(p.details) || undefined };
}

const KIND_STYLE: Record<Kind, string> = {
  system: 'bg-accent-soft text-accent',
  integrity: 'bg-warn-soft text-warn',
  network: 'bg-info-soft text-info',
  staff: 'bg-surface-2 text-ink border border-line-strong',
  info: 'bg-surface-2 text-muted',
};
const FILTERS: { id: 'all' | Kind; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'integrity', label: 'Integrity' },
  { id: 'network', label: 'Connectivity' },
  { id: 'staff', label: 'Staff actions' },
];

export function EventTimeline({ events, startedAt }: { events: AttemptEvent[]; startedAt: string }) {
  const [filter, setFilter] = useState<'all' | Kind>('all');
  const [showNav, setShowNav] = useState(false);
  const start = new Date(startedAt).getTime();
  const items = useMemo(
    () =>
      events
        .filter((e) => showNav || e.type !== 'QUESTION_VIEW')
        .map((e) => ({ e, d: describeEvent(e) }))
        .filter((x) => filter === 'all' || x.d.kind === filter),
    [events, filter, showNav],
  );
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter events">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={cx('h-8 rounded-full border px-3 text-[13px] font-medium', filter === f.id ? 'border-ink bg-ink text-surface' : 'border-line text-ink-2 hover:border-line-strong')}>
              {f.label}
            </button>
          ))}
        </div>
        <Toggle checked={showNav} onChange={setShowNav} label="Show question navigation" />
      </div>
      {!items.length ? (
        <EmptyState title="No events in this view" />
      ) : (
        <ol className="relative ml-4 border-l-2 border-line">
          {items.map(({ e, d }) => {
            const Icon = d.icon;
            const t = new Date(e.createdAt).getTime();
            return (
              <li key={e.id} className="relative pb-5 pl-7 last:pb-0">
                <span className={cx('absolute top-0 -left-[15px] grid size-7 place-items-center rounded-full ring-4 ring-surface', KIND_STYLE[d.kind])} aria-hidden>
                  <Icon className="size-3.5" />
                </span>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium text-ink">{d.title}</span>
                  <time className="tabular text-[12px] text-muted" dateTime={e.createdAt}>
                    {fmtTime(e.createdAt)} · +{fmtDuration(Math.max(0, t - start))}
                  </time>
                </div>
                {d.detail && <p className="mt-0.5 text-[13px] text-ink-2">{d.detail}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
