import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Clock, CloudOff, KeyRound, Loader2, Lock, Maximize, Monitor, PlayCircle, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, ApiError, errMsg } from '@/lib/api';
import { fmtDate, fmtDuration } from '@/lib/format';
import { sessionHeaders } from '@/lib/session';
import type { Phase } from '@/lib/types';
import { Badge, Button, Card, CardHeader, cx, ErrorBox, Field, Input, Spinner } from '@/components/ui';
import { PhaseBadge } from '@/components/status';
import { RichText } from '@/components/RichText';
import SpringCheck from '@/components/bits/SpringCheck';

interface Lobby {
  serverNow: string;
  exam: { id: string; title: string; description: string; instructions: string; examiner: string; windowStart: string; windowEnd: string; durationMin: number; totalMarks: number; passMarks: number; phase: Phase; paused: boolean; requiresAccessCode: boolean; questionCount: number; extraTimePct: number; rules: { requireFullscreen: boolean; maxViolations: number; allowBackNav: boolean; lateJoinMin: number }; resultsPublished: boolean };
  attempt: { id: string; status: string; deadline: string; submittedAt: string | null; compensation: { status: string; seconds: number; reason: string } | null } | null;
}

export default function ExamLobby() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data, isLoading, error, refetch, dataUpdatedAt } = useQuery({ queryKey: ['lobby', id], queryFn: () => api<Lobby>(`/candidate/exams/${id}`), refetchInterval: 15000 });
  const [code, setCode] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startErr, setStartErr] = useState('');
  const [locked, setLocked] = useState(false);
  const [now, setNow] = useState(Date.now());
  const checks = useSystemCheck();
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // when waiting for device-switch approval, retry periodically
  useEffect(() => {
    if (!locked) return;
    const iv = setInterval(async () => {
      try {
        const r = await api<{ attemptId: string }>(`/candidate/exams/${id}/start`, { method: 'POST', headers: sessionHeaders(), body: {} });
        setLocked(false);
        nav(`/exam/${r.attemptId}`);
      } catch {
        /* still waiting */
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [locked, id, nav]);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} onRetry={refetch} />;
  const { exam, attempt } = data;
  const offset = new Date(data.serverNow).getTime() - dataUpdatedAt; // fixed at fetch time so the countdown ticks smoothly
  const opensIn = new Date(exam.windowStart).getTime() - (now + offset);
  const resuming = attempt?.status === 'IN_PROGRESS';
  const finished = attempt && attempt.status !== 'IN_PROGRESS';
  const canStart = exam.phase === 'ONGOING' && !exam.paused && !finished;
  const duration = Math.round(exam.durationMin * (1 + exam.extraTimePct / 100));

  const start = async () => {
    setStartErr('');
    if (exam.requiresAccessCode && !resuming && !code.trim()) return setStartErr('Enter the access code given by your examiner');
    setBusy(true);
    try {
      const r = await api<{ attemptId: string }>(`/candidate/exams/${id}/start`, { method: 'POST', headers: sessionHeaders(), body: { accessCode: code.trim() || undefined } });
      // try to enter full-screen while we still have the click gesture; never block navigation on it
      if (exam.rules.requireFullscreen) await Promise.race([document.documentElement.requestFullscreen?.().catch(() => null), new Promise((r) => setTimeout(r, 600))]);
      nav(`/exam/${r.attemptId}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SESSION_LOCKED') {
        setLocked(true);
        toast.info('Your request to switch devices was sent to the examiner.');
      } else setStartErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/candidate" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> My exams</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2"><PhaseBadge phase={exam.phase} paused={exam.paused} />{exam.extraTimePct > 0 && <Badge tone="info">Accommodation: +{exam.extraTimePct}% time</Badge>}</div>
          <h1 className="display text-[30px] font-semibold leading-tight">{exam.title}</h1>
          <p className="mt-1 text-ink-2">{exam.description} <span className="text-muted">· {exam.examiner}</span></p>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <div className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
              {[
                ['Duration', `${duration} min`],
                ['Questions', exam.questionCount],
                ['Total marks', exam.totalMarks],
                ['Pass mark', exam.passMarks],
              ].map(([k, v]) => (
                <div key={k} className="p-4">
                  <div className="text-xs text-muted">{k}</div>
                  <div className="tabular mt-1 text-xl font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <div className="border-t border-line px-4 py-3 text-sm text-muted">Available {fmtDate(exam.windowStart)} → {fmtDate(exam.windowEnd)}</div>
          </Card>
          <Card>
            <CardHeader title="Instructions" />
            <div className="p-5 text-[15px] leading-relaxed text-ink-2">{exam.instructions ? <RichText text={exam.instructions} /> : <p className="text-muted">No special instructions.</p>}</div>
          </Card>
          <Card>
            <CardHeader title="Exam rules" subtitle="These protect fairness for everyone. No camera or microphone is used." />
            <ul className="space-y-3 p-5 text-sm">
              {exam.rules.requireFullscreen && <Rule icon={<Maximize className="size-4" />}>The exam runs in full-screen. Leaving full-screen is recorded.</Rule>}
              <Rule icon={<ShieldCheck className="size-4" />}>Switching tabs, copying, pasting and screenshots are blocked or recorded.{exam.rules.maxViolations > 0 && <> After <strong>{exam.rules.maxViolations}</strong> warnings the exam is submitted automatically.</>}</Rule>
              {!exam.rules.allowBackNav && <Rule icon={<Lock className="size-4" />}>You cannot return to previous questions once you move on.</Rule>}
              <Rule icon={<Clock className="size-4" />}>The timer is controlled by the server and continues if you close the tab.</Rule>
              <Rule icon={<CloudOff className="size-4" />}>If your connection drops, keep answering — your work is saved on this device and syncs automatically.</Rule>
              <Rule icon={<Monitor className="size-4" />}>The exam can be open on only one device. Switching devices needs examiner approval.</Rule>
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5 lg:sticky lg:top-24">
            {finished ? (
              <div className="text-center">
                <CheckCircle2 className="mx-auto size-10 text-ok" />
                <h2 className="mt-2 font-semibold">You've submitted this exam</h2>
                <p className="mt-1 text-sm text-muted">Submitted {fmtDate(attempt!.submittedAt)}</p>
                {attempt!.compensation?.status === 'PENDING' && <p className="mt-3 rounded-lg bg-info-soft p-3 text-left text-sm text-info">A time-compensation request is under review: {attempt!.compensation.reason}. If approved, your exam will reopen with the time you lost.</p>}
                {exam.resultsPublished && <Link to={`/candidate/results/${attempt!.id}`}><Button className="mt-4 w-full">View result</Button></Link>}
              </div>
            ) : exam.phase === 'PUBLISHED' ? (
              <div className="text-center">
                <Clock className="mx-auto size-9 text-info" />
                <h2 className="mt-2 font-semibold">Opens in</h2>
                <div className="mt-1 font-mono text-3xl font-semibold tabular">{opensIn > 86400000 ? `${Math.floor(opensIn / 86400000)}d ${fmtDuration(opensIn % 86400000)}` : fmtDuration(opensIn)}</div>
                <p className="mt-2 text-sm text-muted">This page updates automatically.</p>
              </div>
            ) : exam.phase === 'COMPLETED' ? (
              <div className="text-center text-sm text-muted">The availability window for this exam has closed.</div>
            ) : locked ? (
              <div className="text-center">
                <Loader2 className="mx-auto size-8 animate-spin text-warn" />
                <h2 className="mt-3 font-semibold">Waiting for examiner approval</h2>
                <p className="mt-1 text-sm text-muted">This exam is open on another device. We'll continue automatically as soon as your examiner approves the switch (or the other device has been offline for 90 seconds).</p>
              </div>
            ) : (
              <>
                <h2 className="font-semibold">{resuming ? 'Resume your exam' : 'Before you start'}</h2>
                {resuming && <p className="mt-1 text-sm text-ink-2">Time remaining: <span className="font-mono font-semibold">{fmtDuration(new Date(attempt!.deadline).getTime() - (now + offset))}</span></p>}
                <ul className="mt-4 space-y-2 text-sm">
                  {checks.map((c) => (
                    <li key={c.label} className="flex items-center gap-2">
                      <span className={cx('grid size-5 place-items-center rounded-full', c.ok ? 'bg-ok-soft text-ok' : c.blocking ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn')}>{c.ok ? <Check className="size-3" /> : c.blocking ? <X className="size-3" /> : <AlertTriangle className="size-3" />}</span>
                      <span className={c.ok ? 'text-ink-2' : 'text-ink'}>{c.label}</span>
                    </li>
                  ))}
                </ul>
                {exam.requiresAccessCode && !resuming && (
                  <Field label="Access code" className="mt-4" hint="Provided by your examiner at the start of the exam">
                    {(fid) => <Input id={fid} value={code} onChange={(e) => setCode(e.target.value)} className="font-mono uppercase" placeholder="e.g. NET2026" />}
                  </Field>
                )}
                {!resuming && (
                  <div className="mt-4 rounded-lg border border-dashed border-line-strong bg-surface-2/60 p-3 text-sm text-ink-2">
                    <SpringCheck
                      checked={agree}
                      onChange={setAgree}
                      color="var(--ink)"
                      fillColor="var(--ink)"
                      checkColor="var(--hl)"
                      boxSize={20}
                      boxRadius={5}
                      fontSize={14}
                      strike="none"
                      ariaLabel="I've read the instructions and will complete this exam on my own"
                      label="I've read the instructions and will complete this exam on my own, without outside help or AI tools."
                    />
                  </div>
                )}
                {startErr && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{startErr}</p>}
                <Button size="lg" className="mt-4 w-full" disabled={!canStart || (!resuming && !agree) || checks.some((c) => c.blocking && !c.ok)} loading={busy} onClick={start} icon={!busy && (exam.requiresAccessCode && !resuming ? <KeyRound className="size-4" /> : <PlayCircle className="size-4" />)}>
                  {resuming ? 'Resume exam' : 'Start exam'}
                </Button>
                {!resuming && <p className="mt-2 text-center text-xs text-muted">Your {duration}-minute timer starts as soon as you begin.</p>}
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Rule({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 text-muted">{icon}</span>
      <span className="text-ink-2">{children}</span>
    </li>
  );
}

function useSystemCheck() {
  const [online, setOnline] = useState(navigator.onLine);
  const [latency, setLatency] = useState<number | null>(null);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const t0 = performance.now();
    api('/time').then(() => setLatency(Math.round(performance.now() - t0))).catch(() => setLatency(-1));
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  const idb = typeof indexedDB !== 'undefined';
  return [
    { label: online ? (latency !== null && latency >= 0 ? `Connected to exam server (${latency} ms)` : 'Checking connection…') : 'You are offline', ok: online && latency !== null && latency >= 0, blocking: !online },
    { label: document.fullscreenEnabled ? 'Full-screen supported' : 'Full-screen not supported in this browser', ok: document.fullscreenEnabled, blocking: false },
    { label: idb ? 'Offline answer storage available' : 'Offline storage unavailable (private mode?)', ok: idb, blocking: false },
    { label: window.innerWidth >= 360 ? 'Screen size OK' : 'Screen is very small', ok: window.innerWidth >= 360, blocking: false },
  ];
}
