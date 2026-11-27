import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Activity, BarChart3, CheckCircle2, Hourglass, Inbox, Pause, Play, ShieldAlert, Square, UserRoundX, WifiOff } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { fmtDate, fmtDuration } from '@/lib/format';
import { Badge, Button, Card, CardHeader, ConfirmDialog, cx, EmptyState, ErrorBox, Field, Modal, Spinner, Stat, Textarea, Toggle } from '@/components/ui';
import { CompensationCard, IncidentItem, IncidentReviewModal, TransferCard, useInvalidateOps } from '@/components/ops/actions';
import { EvidenceNotice } from '@/components/ops/bits';
import { useMonitorSocket, useNow, type MonitorEvent } from '@/components/ops/hooks';
import { AnnouncementsPanel, AttemptsTable, NotStartedPanel } from '@/components/ops/monitor';
import type { Incident, MonitorData } from '@/components/ops/types';

export default function Monitor() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const key = useMemo(() => ['monitor', id], [id]);
  const q = useQuery({ queryKey: key, queryFn: () => api<MonitorData>(`/staff/exams/${id}/monitor`), refetchInterval: 10_000, staleTime: 0 });
  const now = useNow(1000);

  // server clock offset — never trust the local clock for exam timing
  const offset = useMemo(() => (q.data ? q.data.serverNow - q.dataUpdatedAt : 0), [q.data, q.dataUpdatedAt]);
  const serverNowMs = now + offset;

  /* ---------- realtime: coalesce bursts of events into one refetch ---------- */
  const timer = useRef<number | null>(null);
  const refresh = useCallback(() => {
    if (timer.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      qc.invalidateQueries({ queryKey: key });
    }, 700);
  }, [qc, key]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const [flash, setFlash] = useState(false);
  const socketState = useMonitorSocket(id, (ev: MonitorEvent, data) => {
    if (ev === 'attempt:heartbeat') {
      qc.setQueryData<MonitorData>(key, (old) =>
        old && {
          ...old,
          attempts: old.attempts.map((a) => (a.id === data.attemptId && a.status === 'IN_PROGRESS' ? { ...a, connection: 'online', lastSeenAt: new Date().toISOString(), answered: typeof data.answered === 'number' ? data.answered : a.answered } : a)),
        },
      );
      return;
    }
    const name = q.data?.attempts.find((a) => a.id === data.attemptId)?.candidate.name ?? 'A candidate';
    if (ev === 'transfer:new') toast.warning(`${name} wants to switch device`, { description: 'Decide in “Needs your decision”.' });
    if (ev === 'compensation:new') toast.info(`Lost-time request for ${name}`, { description: 'Review the outage evidence before approving.' });
    if (ev === 'incident:new') {
      setFlash(true);
      setTimeout(() => setFlash(false), 1600);
    }
    refresh();
  });

  /* ---------- exam controls ---------- */
  const invalidate = useInvalidateOps();
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState('');
  const [resumeOpen, setResumeOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const pause = useMutation({
    mutationFn: () => api(`/exams/${id}/pause`, { method: 'POST', body: { reason: pauseReason.trim() } }),
    onSuccess: () => {
      toast.success('Exam paused', { description: 'Every timer is frozen. Candidates see a pause screen.' });
      setPauseOpen(false);
      setPauseReason('');
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const resume = useMutation({
    mutationFn: () => api<{ addedSec: number }>(`/exams/${id}/resume`, { method: 'POST' }),
    onSuccess: (r) => {
      toast.success('Exam resumed', { description: `${fmtDuration(r.addedSec * 1000)} was added back to every active candidate.` });
      setResumeOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const close = useMutation({
    mutationFn: () => api(`/exams/${id}/close`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Exam closed', { description: 'All remaining attempts were submitted.' });
      setCloseOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  /* ---------- incidents ---------- */
  const [reviewing, setReviewing] = useState<Incident | null>(null);
  const [openOnly, setOpenOnly] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [recipient, setRecipient] = useState('');

  if (q.isLoading) return <Spinner label="Connecting to the exam room" />;
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const exam = d.exam;
  const paused = !!exam.pausedAt;
  const start = new Date(exam.windowStart).getTime();
  const end = new Date(exam.windowEnd).getTime();
  const phase = exam.status === 'PUBLISHED' ? (serverNowMs < start ? 'scheduled' : serverNowMs <= end ? 'live' : 'ended') : exam.status === 'DRAFT' ? 'draft' : 'ended';

  const writing = d.attempts.filter((a) => a.status === 'IN_PROGRESS');
  const finished = d.attempts.length - writing.length;
  const unstable = writing.filter((a) => a.connection === 'offline' || a.connection === 'unstable').length;
  const openIncidents = d.attempts.reduce((s, a) => s + a.openIncidents, 0);
  const pending = d.transfers.length + d.compensations.length;
  const incidents = d.incidents.filter((i) => !openOnly || i.status === 'OPEN');
  const shown = showAll ? incidents : incidents.slice(0, 12);
  const people = [...d.attempts.map((a) => a.candidate), ...d.notStarted].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-5">
      {/* ---------- header ---------- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-accent">
            Live proctoring
            {phase === 'live' && !paused && <Badge tone="ok" dot className="normal-case tracking-normal">Live now</Badge>}
            {paused && <Badge tone="warn" dot className="normal-case tracking-normal">Paused</Badge>}
            {phase === 'scheduled' && <Badge tone="info" className="normal-case tracking-normal">Starts {fmtDate(exam.windowStart)}</Badge>}
            {phase === 'ended' && <Badge className="normal-case tracking-normal">Window closed</Badge>}
          </div>
          <h1 className="display text-[26px] font-semibold leading-tight sm:text-[32px]">{exam.title}</h1>
          <p className="mt-1 text-sm text-ink-2">
            Window {fmtDate(exam.windowStart)} – {fmtDate(exam.windowEnd)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-1.5" aria-live="off">
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Server time</div>
              <div className="tabular font-mono text-[15px] font-semibold">{new Date(serverNowMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
            </div>
            <span className={cx('flex items-center gap-1.5 border-l border-line pl-3 text-[12px] font-medium', socketState === 'live' ? 'text-ok' : socketState === 'connecting' ? 'text-muted' : 'text-danger')} title="Realtime connection">
              <span className={cx('size-2 rounded-full', socketState === 'live' ? 'pulse-dot bg-ok' : socketState === 'connecting' ? 'bg-line-strong' : 'bg-danger')} aria-hidden />
              {socketState === 'live' ? 'Realtime' : socketState === 'connecting' ? 'Connecting' : socketState === 'denied' ? 'No access' : 'Polling'}
            </span>
          </div>
          {phase === 'live' &&
            (paused ? (
              <Button onClick={() => setResumeOpen(true)} icon={<Play className="size-4" />}>
                Resume exam
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setPauseOpen(true)} icon={<Pause className="size-4" />}>
                Pause
              </Button>
            ))}
          {exam.status === 'PUBLISHED' && Date.now() >= new Date(exam.windowStart).getTime() && (
            <Button variant="outline" className="text-danger hover:bg-danger-soft" onClick={() => setCloseOpen(true)} icon={<Square className="size-4" />}>
              Close exam
            </Button>
          )}
          <Link to={`/examiner/exams/${id}/results`} className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
            <BarChart3 className="size-4" aria-hidden /> Results
          </Link>
        </div>
      </header>

      {paused && (
        <div role="status" className="flex items-center gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          <Pause className="size-5 shrink-0" aria-hidden />
          <span>
            <strong>Exam paused {fmtDuration(serverNowMs - new Date(exam.pausedAt!).getTime())} ago.</strong> Timers are frozen; on resume every active candidate gets this time back.
          </span>
        </div>
      )}

      <EvidenceNotice />

      {/* ---------- summary tiles ---------- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Writing now" value={writing.length} icon={<Activity className="size-4" />} tone="info" />
        <Stat label="Submitted" value={finished} icon={<CheckCircle2 className="size-4" />} tone="ok" />
        <Stat label="Not started" value={d.notStarted.length} icon={<UserRoundX className="size-4" />} />
        <Stat label="Offline / unstable" value={unstable} icon={<WifiOff className="size-4" />} tone={unstable ? 'danger' : undefined} hint={unstable ? 'Answers are kept locally and sync on reconnect' : 'All connections healthy'} />
        <Stat label="Open incidents" value={openIncidents} icon={<ShieldAlert className="size-4" />} tone={openIncidents ? 'warn' : undefined} hint={pending ? `${pending} decision${pending > 1 ? 's' : ''} waiting` : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---------- main column ---------- */}
        <div className="flex min-w-0 flex-col gap-5">
          <AttemptsTable attempts={d.attempts} serverNowMs={serverNowMs} pausedAt={exam.pausedAt} />

          <Card className={cx('transition-shadow', flash && 'ring-2 ring-warn/50')}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <span className="relative flex size-2.5" aria-hidden>
                    <span className="pulse-dot absolute inset-0 rounded-full bg-danger" />
                  </span>
                  Live incident feed
                </span>
              }
              subtitle="Privacy-first signals: no webcam, microphone or screen capture."
              actions={<Toggle checked={openOnly} onChange={setOpenOnly} label="Open only" />}
            />
            {!incidents.length ? (
              <EmptyState icon={<ShieldAlert className="size-6" />} title={openOnly ? 'No incidents waiting for review' : 'No integrity signals yet'} body="New signals appear here in real time." />
            ) : (
              <div className="px-4">
                <ul className="divide-y divide-line" aria-live="polite">
                  {shown.map((i) => (
                    <IncidentItem key={i.id} i={i} onReview={setReviewing} showCandidate href={`/examiner/attempts/${i.attemptId}`} />
                  ))}
                </ul>
                {incidents.length > shown.length && (
                  <div className="border-t border-line py-2 text-center">
                    <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                      Show {incidents.length - shown.length} more
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* ---------- side column ---------- */}
        <aside className="flex min-w-0 flex-col gap-5" aria-label="Decisions and communication">
          <Card className={cx(pending > 0 && 'border-warn/40')}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Inbox className="size-4 text-warn" aria-hidden /> Needs your decision
                  {pending > 0 && <Badge tone="warn">{pending}</Badge>}
                </span>
              }
              subtitle="Device switches and lost-time claims"
            />
            {!pending ? (
              <div className="flex items-center gap-2 px-4 py-4 text-[13px] text-muted">
                <Hourglass className="size-4" aria-hidden /> Nothing waiting. Requests appear here instantly.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 p-3">
                {d.transfers.map((t) => (
                  <TransferCard key={t.id} t={t} name={t.attempt?.candidate.name ?? 'Candidate'} stale={d.attempts.find((a) => a.id === t.attemptId)?.status !== 'IN_PROGRESS'} />
                ))}
                {d.compensations.map((c) => (
                  <CompensationCard key={c.id} c={c} name={c.attempt?.candidate.name ?? 'Candidate'} />
                ))}
              </div>
            )}
          </Card>

          <div id="announcements" className="scroll-mt-24">
            <AnnouncementsPanel examId={id} people={people} recipient={recipient} setRecipient={setRecipient} />
          </div>
          <NotStartedPanel
            people={d.notStarted}
            onMessage={(cid) => {
              setRecipient(cid);
              const el = document.getElementById('announcements');
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              setTimeout(() => el?.querySelector('textarea')?.focus(), 300);
            }}
          />
        </aside>
      </div>

      <IncidentReviewModal incident={reviewing} onClose={() => setReviewing(null)} />

      <Modal
        open={pauseOpen}
        onClose={() => setPauseOpen(false)}
        title="Pause the whole exam?"
        description="Every candidate's timer freezes until you resume. Nobody gains or loses time."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPauseOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => pause.mutate()} loading={pause.isPending} icon={<Pause className="size-4" />}>
              Pause exam
            </Button>
          </>
        }
      >
        <Field label="Message shown to candidates (optional)" hint={<span className="tabular">{pauseReason.length}/300</span>}>
          {(fid) => <Textarea id={fid} value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} maxLength={300} placeholder="e.g. Fire alarm test — please stay seated." className="min-h-20" />}
        </Field>
      </Modal>

      <ConfirmDialog
        open={resumeOpen}
        onClose={() => setResumeOpen(false)}
        onConfirm={() => resume.mutate()}
        loading={resume.isPending}
        title="Resume the exam?"
        confirmLabel="Resume now"
        body={`Each of the ${writing.length} active candidate(s) gets back the ${paused ? fmtDuration(serverNowMs - new Date(exam.pausedAt!).getTime()) : ''} spent paused, and the exam window is extended by the same amount.`}
      />
      <ConfirmDialog
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        onConfirm={() => close.mutate()}
        loading={close.isPending}
        tone="danger"
        title="Close this exam now?"
        confirmLabel="Close and submit all"
        body={
          writing.length
            ? `${writing.length} candidate(s) are still writing. Their attempts will be force-submitted with whatever they have saved. This cannot be undone.`
            : 'Nobody is writing at the moment. The exam window will end now and no one else can start. This cannot be undone.'
        }
      />
    </div>
  );
}
