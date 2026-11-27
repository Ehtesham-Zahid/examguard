import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ClipboardList, Cloud, CloudOff, Expand, Keyboard, Loader2, Lock, Megaphone, NotebookPen, PauseCircle, ShieldAlert, Type, Wifi, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { serverNow, syncClock } from '@/lib/clock';
import { fmtDuration, fmtTime } from '@/lib/format';
import { acknowledge, clearAttempt, db, dropRejected, loadSnapshot, markPendingOffline, nextSeq, pendingFor, queueAnswer, saveSnapshot } from '@/lib/outbox';
import { getSessionId, sessionHeaders } from '@/lib/session';
import { getSocket } from '@/lib/socket';
import { localPrefs } from '@/lib/theme';
import { Badge, Button, cx, Kbd, Modal } from '@/components/ui';
import { Logo } from '@/layouts/AppShell';
import { PreferenceControls } from '@/pages/Settings';
import { isAnswered, QuestionView, type WAnswer, type WQuestion } from './workspace/QuestionView';
import { Scratchpad } from './workspace/Scratchpad';
import HoldButton from '@/components/bits/HoldButton';
import StatusMark from '@/components/bits/StatusMark';
import { confetti } from '@/lib/confetti';
import { isCounted, SIGNAL_TEXT, useIntegrity, useTypingMonitor, type Signal } from './workspace/useIntegrity';

interface AttemptPayload {
  serverNow: number;
  attempt: { id: string; status: string; isSandbox: boolean; startedAt: string; deadline: string; violationCount: number; lastSeq: number };
  exam: { id: string; title: string; instructions: string; totalMarks: number; paused: boolean; settings: { allowBackNav: boolean; requireFullscreen: boolean; maxViolations: number } };
  candidate: { name: string; email: string };
  questions: WQuestion[];
  answers: Record<string, WAnswer & { clientSeq: number }>;
  announcements: { id: string; message: string; createdAt: string; candidateId: string | null }[];
  scratchpad: { canvas: string; notes: string } | null;
}
type Net = 'online' | 'unstable' | 'offline';
type Save = 'saved' | 'saving' | 'queued' | 'error';
type Screen = 'loading' | 'locked' | 'gate' | 'exam' | 'finishing' | 'done' | 'error';

export default function ExamWorkspace() {
  const { attemptId = '' } = useParams();
  const nav = useNavigate();
  const { user, updatePrefs } = useAuth();
  const [data, setData] = useState<AttemptPayload | null>(null);
  const [screen, setScreen] = useState<Screen>('loading');
  const [loadError, setLoadError] = useState('');
  const [answers, setAnswers] = useState<Record<string, WAnswer>>({});
  const [current, setCurrent] = useState(0);
  const [deadline, setDeadline] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [paused, setPaused] = useState(false);
  const [net, setNet] = useState<Net>(navigator.onLine ? 'online' : 'offline');
  const [save, setSave] = useState<Save>('saved');
  const [pending, setPending] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [violations, setViolations] = useState(0);
  const [warning, setWarning] = useState<{ text: string; left: number } | null>(null);
  const [announcements, setAnnouncements] = useState<AttemptPayload['announcements']>([]);
  const [scratchOpen, setScratchOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [finish, setFinish] = useState<{ status: string; reason?: string; score?: number; maxScore?: number; at: number } | null>(null);
  const [liveMsg, setLiveMsg] = useState('');
  const [prefs, setPrefs] = useState(() => ({ ...localPrefs(), ...(user?.prefs ?? {}) }));

  const flushing = useRef(false);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventQueue = useRef<{ type: string; at: number; details?: string; id?: number }[]>([]);
  const enteredAt = useRef(performance.now());
  const answeredFast = useRef(0);
  const warned = useRef(new Set<number>());
  const failures = useRef(0);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const lastSeqFloor = useRef(0);
  const autoSubmitted = useRef(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const currentRef = useRef(current);
  currentRef.current = current;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const sandbox = !!data?.attempt.isSandbox;
  const settings = data?.exam.settings;
  const questions = data?.questions ?? [];
  const layout = settings?.allowBackNav === false ? 'single' : prefs.layout ?? 'single';
  const paletteSide = prefs.paletteSide ?? 'left';

  /* ------------------------------ loading ------------------------------ */
  const load = useCallback(async () => {
    setScreen('loading');
    const t0 = performance.now();
    try {
      const d = await api<AttemptPayload>(`/candidate/attempts/${attemptId}`, { headers: sessionHeaders() });
      syncClock(d.serverNow, performance.now() - t0);
      saveSnapshot(attemptId, d);
      bootstrap(d);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SESSION_LOCKED') return setScreen('locked');
      if (e instanceof ApiError && e.isNetwork) {
        const snap = await loadSnapshot(attemptId);
        if (snap) {
          setNet('offline');
          toast.warning('You are offline — resuming from the copy saved on this device.');
          return bootstrap(snap.data as AttemptPayload, true);
        }
      }
      setLoadError(e instanceof Error ? e.message : 'Could not load the exam');
      setScreen('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  const bootstrap = async (d: AttemptPayload, fromSnapshot = false) => {
    setData(d);
    lastSeqFloor.current = d.attempt.lastSeq;
    const base: Record<string, WAnswer> = {};
    Object.entries(d.answers).forEach(([k, v]) => (base[k] = { response: v.response, flagged: v.flagged, visited: v.visited, timeSpentMs: v.timeSpentMs }));
    // unsynced local changes win over the server copy
    const local = await pendingFor(d.attempt.id);
    local.forEach((it) => (base[it.questionId] = { ...base[it.questionId], response: it.response ?? base[it.questionId]?.response, flagged: it.flagged ?? base[it.questionId]?.flagged, visited: true, timeSpentMs: it.timeSpentMs }));
    setPending(local.length);
    setAnswers(base);
    setDeadline(new Date(d.attempt.deadline).getTime());
    setPaused(d.exam.paused);
    setViolations(d.attempt.violationCount);
    setAnnouncements(d.announcements);
    let furthest = 0;
    d.questions.forEach((q, i) => base[q.id]?.visited && (furthest = i));
    setCurrent(d.exam.settings.allowBackNav ? 0 : furthest);
    // integrity events recorded before a reload/offline period are kept on the device and re-sent
    try {
      const saved = await db.events.where('attemptId').equals(d.attempt.id).toArray();
      eventQueue.current.push(...saved.map((e) => ({ type: e.type, at: e.at, details: e.details, id: e.id })));
    } catch {
      /* IndexedDB unavailable */
    }
    if (d.attempt.status !== 'IN_PROGRESS') {
      setFinish({ status: d.attempt.status, at: Date.now() });
      return setScreen('done');
    }
    if (d.exam.settings.requireFullscreen && !document.fullscreenElement && document.fullscreenEnabled) setScreen('gate');
    else setScreen('exam');
    if (!fromSnapshot && local.length) scheduleFlush(50);
  };

  useEffect(() => {
    load();
  }, [load]);

  /* ------------------------------ sync engine ------------------------------ */
  const flush = useCallback(async (): Promise<boolean> => {
    if (flushing.current) return false;
    const items = await pendingFor(attemptId);
    setPending(items.length);
    if (!items.length) {
      setSave('saved');
      return true;
    }
    flushing.current = true;
    setSave('saving');
    try {
      const r = await api<{ serverNow: number; deadline: string; accepted: { questionId: string; seq: number }[]; rejected: { questionId: string; reason: string }[] }>(`/candidate/attempts/${attemptId}/answers`, {
        method: 'PUT',
        headers: sessionHeaders(),
        body: { items: items.map(({ key: _k, attemptId: _a, ...rest }) => rest) },
        timeoutMs: 12000,
      });
      await acknowledge(attemptId, r.accepted);
      if (r.rejected.length) {
        await dropRejected(attemptId, r.rejected.map((x) => x.questionId));
        if (r.rejected.some((x) => x.reason === 'after_deadline')) toast.error('Some changes arrived after the time limit and were not accepted.');
      }
      setDeadline(new Date(r.deadline).getTime());
      failures.current = 0;
      setNet('online');
      setLastSavedAt(Date.now());
      const left = await pendingFor(attemptId);
      setPending(left.length);
      setSave(left.length ? 'queued' : 'saved');
      return left.length === 0;
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'SESSION_LOCKED') setScreen('locked');
        else if (e.code === 'TIME_OVER') {
          await clearAttempt(attemptId);
          setPending(0);
          setSave('saved');
          return true;
        } else if (e.code === 'EXAM_PAUSED') setPaused(true);
        else if (e.isNetwork) {
          failures.current++;
          setNet(navigator.onLine ? 'unstable' : 'offline');
          await markPendingOffline(attemptId);
        } else if (e.status === 400) toast.error(`An answer could not be saved: ${e.message}`);
      }
      setSave('queued');
      return false;
    } finally {
      flushing.current = false;
    }
  }, [attemptId]);

  const scheduleFlush = useCallback(
    (ms = 700) => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => flush(), ms);
    },
    [flush],
  );

  const persist = useCallback(
    async (qid: string, patch: WAnswer) => {
      const merged = { ...answersRef.current[qid], ...patch };
      setAnswers((s) => ({ ...s, [qid]: merged }));
      const offline = net !== 'online' || !navigator.onLine;
      await queueAnswer({
        attemptId,
        questionId: qid,
        response: merged.response,
        flagged: merged.flagged,
        visited: true,
        timeSpentMs: Math.round(merged.timeSpentMs ?? 0),
        seq: nextSeq(attemptId, lastSeqFloor.current),
        offline,
        claimedAt: Math.round(serverNow()),
      });
      setPending((p) => Math.max(p, 1));
      setSave(offline ? 'queued' : 'saving');
      scheduleFlush(offline ? 3000 : 600);
    },
    [attemptId, net, scheduleFlush],
  );

  // periodic retry + connectivity events
  useEffect(() => {
    const iv = setInterval(() => pending > 0 && flush(), 5000);
    const on = () => {
      setNet('unstable');
      toast.success('Back online — syncing your answers…');
      flush();
    };
    const off = () => {
      setNet('offline');
      toast.warning("You're offline. Keep working — answers are saved on this device.", { duration: 6000 });
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      clearInterval(iv);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [flush, pending]);

  /* ------------------------------ heartbeat + clock ------------------------------ */
  useEffect(() => {
    if (screen !== 'exam' && screen !== 'gate') return;
    const beat = async () => {
      const t0 = performance.now();
      try {
        const r = await api<{ serverNow: number; status: string; deadline: string; paused: boolean }>(`/candidate/attempts/${attemptId}/heartbeat`, {
          method: 'POST',
          headers: sessionHeaders(),
          body: { currentQuestion: currentRef.current + 1, answered: Object.values(answersRef.current).filter(isAnswered).length, online: true },
          timeoutMs: 8000,
        });
        syncClock(r.serverNow, performance.now() - t0);
        setDeadline(new Date(r.deadline).getTime());
        setPaused(r.paused);
        failures.current = 0;
        setNet('online');
        if (r.status !== 'IN_PROGRESS') {
          setFinish({ status: r.status, at: Date.now() });
          setScreen('done');
        }
      } catch (e) {
        if (e instanceof ApiError && e.code === 'SESSION_LOCKED') return setScreen('locked');
        failures.current++;
        setNet(!navigator.onLine || failures.current >= 2 ? 'offline' : 'unstable');
      }
    };
    beat();
    const iv = setInterval(beat, 15000);
    return () => clearInterval(iv);
  }, [screen, attemptId]);

  // timer tick (display only — the server enforces the deadline)
  useEffect(() => {
    if (!deadline) return;
    const iv = setInterval(() => {
      if (paused) return;
      const r = deadline - serverNow();
      setRemaining(r);
      const mins = Math.ceil(r / 60000);
      for (const m of [10, 5, 1])
        if (mins === m && r > 0 && !warned.current.has(m)) {
          warned.current.add(m);
          toast.warning(`${m} minute${m > 1 ? 's' : ''} remaining`);
          setLiveMsg(`${m} minute${m > 1 ? 's' : ''} remaining`);
        }
      if (r <= 0 && screenRef.current === 'exam') timeUp();
    }, 250);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline, paused]);

  /* ------------------------------ realtime ------------------------------ */
  useEffect(() => {
    if (!data) return;
    const s = getSocket();
    const join = () => s.emit('join:exam', data.exam.id);
    join();
    s.on('connect', join);
    const onAnn = (a: AttemptPayload['announcements'][number]) => {
      setAnnouncements((x) => [a, ...x]);
      toast.info('Announcement from your examiner', { description: a.message, duration: 10000 });
      setLiveMsg(`Announcement: ${a.message}`);
    };
    const onPause = () => {
      setPaused(true);
      setLiveMsg('The exam has been paused by the examiner. Your timer is frozen.');
    };
    const onResume = (p: { addedSec: number }) => {
      setDeadline((d) => d + p.addedSec * 1000);
      setPaused(false);
      toast.success(`Exam resumed — ${Math.round(p.addedSec / 60)} min added back to your timer`);
    };
    const onDeadline = (p: { attemptId: string; deadline: string; message: string }) => {
      if (p.attemptId !== attemptId) return;
      setDeadline(new Date(p.deadline).getTime());
      toast.success(p.message);
    };
    const onFinal = (p: { attemptId: string; status: string; reason: string }) => {
      if (p.attemptId !== attemptId) return;
      setFinish({ status: p.status, reason: p.reason, at: Date.now() });
      setScreen('done');
    };
    const onTransfer = (p: { attemptId: string; sessionId: string }) => p.attemptId === attemptId && p.sessionId !== getSessionId() && setScreen('locked');
    const onClosed = () => {
      toast.info('The examiner has closed this exam.');
      load();
    };
    s.on('announcement', onAnn);
    s.on('exam:paused', onPause);
    s.on('exam:resumed', onResume);
    s.on('attempt:deadline', onDeadline);
    s.on('attempt:finalized', onFinal);
    s.on('session:transferred', onTransfer);
    s.on('exam:closed', onClosed);
    return () => {
      s.off('connect', join);
      s.off('announcement', onAnn);
      s.off('exam:paused', onPause);
      s.off('exam:resumed', onResume);
      s.off('attempt:deadline', onDeadline);
      s.off('attempt:finalized', onFinal);
      s.off('session:transferred', onTransfer);
      s.off('exam:closed', onClosed);
    };
  }, [data, attemptId, load]);

  /* ------------------------------ integrity ------------------------------ */
  const flushEvents = useCallback(async () => {
    if (!eventQueue.current.length) return;
    const batch = eventQueue.current.splice(0, 50);
    try {
      const r = await api<{ violations: number; warnings: number; maxViolations: number; submitted: boolean }>(`/candidate/attempts/${attemptId}/events`, { method: 'POST', headers: sessionHeaders(), body: { events: batch.map(({ id: _id, ...e }) => e) } });
      await db.events.bulkDelete(batch.map((e) => e.id).filter((x): x is number => typeof x === 'number')).catch(() => null);
      setViolations(r.violations);
      if (r.submitted) {
        await clearAttempt(attemptId);
        setFinish({ status: 'FORCE_SUBMITTED', reason: 'integrity_violation_limit', at: Date.now() });
        setScreen('done');
        document.exitFullscreen?.().catch(() => null);
      }
      return r;
    } catch {
      eventQueue.current.unshift(...batch); // retry later
    }
  }, [attemptId]);

  const onSignal = useCallback(
    async (s: Signal, details?: string) => {
      if (screenRef.current !== 'exam' || pausedRef.current) return; // nothing is counted while the exam is paused
      const ev = { type: s, at: Date.now(), details };
      const id = await db.events.add({ attemptId, ...ev }).catch(() => undefined);
      eventQueue.current.push({ ...ev, id: typeof id === 'number' ? id : undefined });
      if (!isCounted(s)) return;
      const r = await flushEvents();
      const max = data?.exam.settings.maxViolations ?? 0;
      if (SIGNAL_TEXT[s]) setWarning({ text: SIGNAL_TEXT[s]!, left: r ? r.warnings : Math.max(0, max - violations - 1) });
    },
    [flushEvents, data, violations, attemptId],
  );
  useEffect(() => {
    const iv = setInterval(flushEvents, 4000);
    return () => clearInterval(iv);
  }, [flushEvents]);

  const { isFullscreen, enterFullscreen } = useIntegrity({ enabled: screen === 'exam', requireFullscreen: !!settings?.requireFullscreen, onSignal });
  const onTyping = useTypingMonitor(onSignal);
  useEffect(() => {
    if (screen === 'exam' && settings?.requireFullscreen && !document.fullscreenEnabled) eventQueue.current.push({ type: 'SPLIT_SCREEN', at: Date.now(), details: 'Device does not support full-screen mode' });
  }, [screen, settings]);

  /* ------------------------------ navigation ------------------------------ */
  const commitTime = useCallback(async () => {
    const q = questions[current];
    if (!q) return;
    const spent = performance.now() - enteredAt.current;
    enteredAt.current = performance.now();
    if (spent < 500) return;
    const a = answersRef.current[q.id];
    await persist(q.id, { ...a, visited: true, timeSpentMs: (a?.timeSpentMs ?? 0) + spent });
  }, [questions, current, persist]);

  const go = useCallback(
    (i: number) => {
      if (i < 0 || i >= questions.length || i === current) return;
      if (settings?.allowBackNav === false && i < current) return toast.error('Going back to earlier questions is disabled for this exam.');
      commitTime();
      setCurrent(i);
      if (layout === 'scroll') document.getElementById(`qwrap-${questions[i].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else document.getElementById('exam-main')?.scrollTo({ top: 0 });
    },
    [questions, current, settings, commitTime, layout],
  );

  const answer = useCallback(
    (qid: string, response: unknown) => {
      const elapsed = performance.now() - enteredAt.current;
      if (Array.isArray(response) && response.length && elapsed < 2500) {
        answeredFast.current++;
        if (answeredFast.current === 4) onSignal('RAPID_ANSWERS', '4 consecutive answers in under 2.5s each');
      } else if (Array.isArray(response)) answeredFast.current = 0;
      persist(qid, { response, visited: true });
    },
    [persist, onSignal],
  );

  // keyboard shortcuts
  useEffect(() => {
    if (screen !== 'exam') return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (reviewOpen || prefsOpen || helpOpen || scratchOpen || warning || paletteOpen) return;
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && t.closest('[role="radio"],[role="checkbox"],button')) return;
      const q = questions[current];
      if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'n') go(current + 1);
      else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'p') go(current - 1);
      else if (e.key.toLowerCase() === 'f' && q) persist(q.id, { flagged: !answersRef.current[q.id]?.flagged });
      else if (e.key.toLowerCase() === 's') setScratchOpen((o) => !o);
      else if (e.key === '?') setHelpOpen(true);
      else if (/^[1-9]$/.test(e.key) && q && q.type !== 'WRITTEN') {
        const opt = q.options[Number(e.key) - 1];
        if (!opt) return;
        const sel = (answersRef.current[q.id]?.response as string[] | undefined) ?? [];
        answer(q.id, q.type === 'SINGLE' ? (sel[0] === opt.id ? [] : [opt.id]) : sel.includes(opt.id) ? sel.filter((x) => x !== opt.id) : [...sel, opt.id]);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [screen, questions, current, go, persist, answer, reviewOpen, prefsOpen, helpOpen, scratchOpen, warning, paletteOpen]);

  // warn before leaving with unsynced work
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (screenRef.current === 'exam' && pending > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [pending]);

  /* ------------------------------ submit ------------------------------ */
  const submit = useCallback(
    async (auto = false) => {
      if (auto) {
        if (autoSubmitted.current) return;
        autoSubmitted.current = true;
      }
      setReviewOpen(false);
      setScreen('finishing');
      await commitTime(); // the time-on-question update must be queued before the final flush
      // push every queued answer first; retry a few times if the network is flaky
      for (let i = 0; i < 4; i++) {
        // an autosave already in flight isn't a failure: wait for it, then flush whatever is left
        for (let w = 0; flushing.current && w < 50; w++) await new Promise((r) => setTimeout(r, 100));
        if (await flush()) break;
        await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
      }
      await flushEvents();
      const left = await pendingFor(attemptId);
      if (left.length && !auto) {
        toast.error(`${left.length} answer(s) haven't reached the server yet. Check your connection — we'll keep retrying, and you can submit once they're saved.`);
        setScreen('exam');
        return;
      }
      if (left.length && auto) {
        // offline at expiry: keep the answers locally; they are merged if they reach the server within 10 minutes
        setFinish({ status: 'PENDING_SYNC', at: Date.now() });
        setScreen('done');
        return;
      }
      const keyName = `eg_submit_${attemptId}`;
      let key = localStorage.getItem(keyName);
      if (!key) {
        key = crypto.randomUUID();
        localStorage.setItem(keyName, key);
      }
      try {
        const r = await api<{ status: string; score?: number; maxScore?: number }>(`/candidate/attempts/${attemptId}/submit`, { method: 'POST', headers: sessionHeaders(), body: { idempotencyKey: key } });
        await clearAttempt(attemptId);
        setFinish({ status: r.status, score: r.score, maxScore: r.maxScore, at: Date.now(), reason: auto ? 'time_expired' : undefined });
        setScreen('done');
        document.exitFullscreen?.().catch(() => null);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'ALREADY_SUBMITTED') {
          setFinish({ status: 'SUBMITTED', at: Date.now() });
          setScreen('done');
          return;
        }
        if (e instanceof ApiError && e.code === 'SESSION_LOCKED') return setScreen('locked');
        if (auto) {
          // offline at expiry with everything saved: the server finalises the attempt on its own
          setFinish({ status: 'AUTO_SUBMITTED', at: Date.now(), reason: 'time_expired' });
          setScreen('done');
          return;
        }
        toast.error(`Could not submit: ${e instanceof Error ? e.message : ''}. Your answers are safe — we'll keep trying.`);
        setScreen('exam');
      }
    },
    [attemptId, flush, flushEvents, commitTime],
  );

  const timeUp = useCallback(() => {
    toast.info("Time's up — submitting your answers.");
    submit(true);
  }, [submit]);

  // retry pending sync after an offline expiry
  useEffect(() => {
    if (finish?.status !== 'PENDING_SYNC') return;
    const iv = setInterval(async () => {
      if (await flush()) {
        setFinish({ status: 'AUTO_SUBMITTED', at: Date.now(), reason: 'synced_after_reconnect' });
        clearAttempt(attemptId);
      }
    }, 4000);
    return () => clearInterval(iv);
  }, [finish, flush, attemptId]);

  /* ------------------------------ derived ------------------------------ */
  const stats = useMemo(() => {
    const answered = questions.filter((q) => isAnswered(answers[q.id])).length;
    const flagged = questions.filter((q) => answers[q.id]?.flagged).length;
    return { answered, flagged, unanswered: questions.length - answered };
  }, [questions, answers]);

  const updateLocalPrefs = (p: typeof prefs) => {
    setPrefs((x) => ({ ...x, ...p }));
    updatePrefs(p);
  };

  /* ------------------------------ screens ------------------------------ */
  if (screen === 'loading') return <FullCenter><Loader2 className="size-6 animate-spin text-muted" /><p className="mt-3 text-sm text-muted">Preparing your exam…</p></FullCenter>;
  if (screen === 'error')
    return (
      <FullCenter>
        <AlertTriangle className="size-8 text-danger" />
        <h1 className="mt-3 text-lg font-semibold">We couldn't open this exam</h1>
        <p className="mt-1 max-w-md text-sm text-muted">{loadError}</p>
        <div className="mt-5 flex gap-2">
          <Button onClick={load}>Try again</Button>
          <Link to="/app"><Button variant="outline">Back to dashboard</Button></Link>
        </div>
      </FullCenter>
    );
  if (screen === 'locked') return <LockedScreen examId={data?.exam.id} onRetry={load} />;
  if (screen === 'done' && finish) return <DoneScreen finish={finish} sandbox={sandbox} examId={data?.exam.id} answered={stats.answered} total={questions.length} pending={pending} />;

  const q = questions[current];
  const timeTone = paused ? 'text-warn' : remaining < 60_000 ? 'text-danger' : remaining < 5 * 60_000 ? 'text-warn' : 'text-ink';
  const watermark = `${data?.candidate.name} · ${data?.candidate.email} · ${attemptId.slice(-6)}`;

  const palette = (
    <nav aria-label="Question navigator" className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Questions</h2>
        <span className="tabular text-xs text-muted">{stats.answered}/{questions.length} answered</span>
      </div>
      <ol className="grid grid-cols-5 gap-1.5">
        {questions.map((x, i) => {
          const a = answers[x.id];
          const done = isAnswered(a);
          const locked = settings?.allowBackNav === false && i < current;
          return (
            <li key={x.id}>
              <button
                onClick={() => go(i)}
                disabled={locked}
                aria-current={i === current ? 'step' : undefined}
                aria-label={`Question ${i + 1}: ${done ? 'answered' : a?.visited ? 'not answered' : 'not visited'}${a?.flagged ? ', marked for review' : ''}`}
                className={cx(
                  'relative grid h-10 w-full place-items-center rounded-lg border-[1.5px] font-mono text-sm font-semibold tabular transition-all duration-150 hover:-translate-y-px disabled:opacity-40',
                  done ? 'pop border-ink bg-ink text-surface' : a?.visited ? 'border-line-strong bg-surface-2 text-ink' : 'border-line bg-surface text-muted',
                  a?.flagged && !done && 'border-dashed border-margin',
                  i === current && 'ring-2 ring-margin ring-offset-2 ring-offset-[var(--surface)]',
                )}
              >
                {i + 1}
                {a?.flagged && <span className="pop absolute -right-1 -top-1 size-3 rounded-full border-2 border-surface bg-margin" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ol>
      <ul className="mt-4 space-y-1.5 text-xs text-muted">
        <li className="flex items-center gap-2"><span className="size-3 rounded bg-ink" /> Answered</li>
        <li className="flex items-center gap-2"><span className="size-3 rounded border border-line-strong bg-surface-2" /> Visited, unanswered</li>
        <li className="flex items-center gap-2"><span className="size-3 rounded border border-line bg-surface" /> Not visited</li>
        <li className="flex items-center gap-2"><span className="size-3 rounded-full bg-margin" /> Marked for review</li>
        <li className="flex items-center gap-2"><span className="size-3 rounded outline-2 outline-offset-1 outline-margin" /> Current question</li>
      </ul>
      <div className="mt-auto pt-4">
        <Button className="w-full" onClick={() => { commitTime(); setPaletteOpen(false); setReviewOpen(true); }} icon={<ClipboardList className="size-4" />}>Review & submit</Button>
      </div>
    </nav>
  );

  return (
    <div className="grid-paper flex h-full flex-col">
      <div aria-live="assertive" className="sr-only">{liveMsg}</div>
      {/* top bar */}
      <header className="z-20 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 sm:px-5">
        <span className="hidden sm:block"><Logo compact /></span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{data?.exam.title}</div>
          <div className="truncate text-xs text-muted">{data?.candidate.name}{sandbox && ' · sandbox preview'}</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
          <ConnectionPill net={net} save={save} pending={pending} lastSavedAt={lastSavedAt} />
          {!!settings?.maxViolations && violations > 0 && (
            <Badge tone={violations >= settings.maxViolations - 1 ? 'danger' : 'warn'} className="hidden md:inline-flex">
              <ShieldAlert className="size-3.5" /> {violations}/{settings.maxViolations} warnings
            </Badge>
          )}
          <div className={cx('flex items-center gap-2 rounded-lg border border-line px-3 py-1.5', remaining < 60_000 && !paused && 'border-danger bg-danger-soft')} role="timer" aria-label={`Time remaining ${fmtDuration(remaining)}`}>
            {paused ? <PauseCircle className="size-4 text-warn" /> : <span className={cx('size-2 rounded-full', remaining < 5 * 60000 ? 'bg-danger pulse-dot' : 'bg-ok')} />}
            <span className={cx('font-mono text-lg font-semibold tabular', timeTone)}>{paused ? 'Paused' : fmtDuration(remaining)}</span>
          </div>
          <IconBtn label="Scratchpad (S)" onClick={() => setScratchOpen((o) => !o)} active={scratchOpen}><NotebookPen className="size-[18px]" /></IconBtn>
          <IconBtn label="Display settings" onClick={() => setPrefsOpen(true)}><Type className="size-[18px]" /></IconBtn>
          <IconBtn label="Keyboard shortcuts (?)" onClick={() => setHelpOpen(true)} className="hidden sm:grid"><Keyboard className="size-[18px]" /></IconBtn>
        </div>
      </header>

      {sandbox && <div className="bg-info-soft px-4 py-1.5 text-center text-xs font-medium text-info">Sandbox preview — this attempt is not recorded and never affects results or statistics.</div>}
      {net === 'offline' && (
        <div role="status" className="flex items-center justify-center gap-2 bg-warn-soft px-4 py-2 text-sm font-medium text-warn">
          <CloudOff className="size-4" /> You're offline. Keep answering — {pending ? `${pending} change(s) are` : 'everything is'} saved on this device and will sync automatically. The timer keeps running.
        </div>
      )}
      {announcements[0] && (
        <div className="flex items-center gap-2 border-b border-line bg-accent-soft px-4 py-2 text-sm text-accent">
          <Megaphone className="size-4 shrink-0" />
          <span className="font-medium">Examiner:</span>
          <span className="truncate">{announcements[0].message}</span>
          <span className="ml-auto shrink-0 text-xs opacity-70">{fmtTime(announcements[0].createdAt)}</span>
        </div>
      )}

      <div inert={screen === 'gate' || (screen === 'exam' && !!settings?.requireFullscreen && document.fullscreenEnabled && !isFullscreen)} className={cx('flex min-h-0 flex-1', paletteSide === 'right' && 'flex-row-reverse')}>
        {paletteSide !== 'hidden' && <aside className="hidden w-[260px] shrink-0 border-line bg-surface p-4 md:block md:border-r">{palette}</aside>}
        <main id="exam-main" className="relative min-w-0 flex-1 overflow-y-auto">
          <Watermark text={watermark} />
          <div key={layout === 'single' ? current : 'all'} className="margin-line page-enter relative mx-auto min-h-full max-w-3xl py-8 pl-10 pr-4 sm:pl-14 sm:pr-8 [&::before]:left-4 sm:[&::before]:left-7">
            {layout === 'single' && q && (
              <QuestionView key={q.id} q={q} a={answers[q.id]} total={questions.length} onAnswer={(r) => answer(q.id, r)} onFlag={() => persist(q.id, { flagged: !answers[q.id]?.flagged })} onTyping={(e, p) => onTyping(q.id, e, p)} disabled={paused} />
            )}
            {layout === 'scroll' &&
              questions.map((x, i) => (
                <div key={x.id} id={`qwrap-${x.id}`} className="mb-12 scroll-mt-6 border-b border-line pb-12 last:border-0" onFocusCapture={() => i !== current && setCurrent(i)}>
                  <QuestionView q={x} a={answers[x.id]} total={questions.length} onAnswer={(r) => answer(x.id, r)} onFlag={() => persist(x.id, { flagged: !answers[x.id]?.flagged })} onTyping={(e, p) => onTyping(x.id, e, p)} disabled={paused} />
                </div>
              ))}
          </div>
        </main>
      </div>

      {/* bottom nav */}
      <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-3 py-3 sm:px-5">
        <Button variant="outline" onClick={() => go(current - 1)} disabled={current === 0 || settings?.allowBackNav === false || layout === 'scroll'} icon={<ArrowLeft className="size-4" />}>
          <span className="hidden sm:inline">Previous</span>
        </Button>
        <div className="flex-1 px-2">
          <div className="mb-1 flex justify-between text-xs text-muted md:hidden">
            <span>Q{current + 1} of {questions.length}</span>
            <span>{stats.answered} answered</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(stats.answered / Math.max(1, questions.length)) * 100}%` }} /></div>
        </div>
        <Button variant="outline" className="md:hidden" onClick={() => setPaletteOpen(true)}>Questions</Button>
        {current < questions.length - 1 && layout === 'single' ? (
          <Button onClick={() => go(current + 1)} icon={<ArrowRight className="size-4" />} className="flex-row-reverse">
            <span className="hidden sm:inline">Next</span>
          </Button>
        ) : (
          <Button onClick={() => { commitTime(); setReviewOpen(true); }} icon={<CheckCircle2 className="size-4" />}>Finish</Button>
        )}
      </footer>

      <Scratchpad
        open={scratchOpen}
        onClose={() => setScratchOpen(false)}
        initial={data?.scratchpad ?? null}
        onSave={(d) => api(`/candidate/attempts/${attemptId}/scratchpad`, { method: 'PUT', headers: sessionHeaders(), body: d }).catch(() => null)}
      />

      {/* overlays */}
      {(screen === 'gate' || (screen === 'exam' && settings?.requireFullscreen && document.fullscreenEnabled && !isFullscreen)) && (
        <FullscreenGate
          first={screen === 'gate'}
          title={data?.exam.title ?? ''}
          maxViolations={settings?.maxViolations ?? 0}
          onEnter={async () => {
            const ok = await enterFullscreen();
            if (!ok) toast.error('Your browser blocked full-screen. Please allow it to continue.');
            else {
              setScreen('exam');
              enteredAt.current = performance.now();
            }
          }}
        />
      )}
      {paused && screen === 'exam' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-2xl">
            <PauseCircle className="mx-auto size-10 text-warn" />
            <h2 className="mt-3 text-xl font-semibold">Exam paused</h2>
            <p className="mt-2 text-sm text-ink-2">Your examiner has paused the exam. Your timer is frozen and the paused time will be added back when it resumes. Please stay on this page.</p>
          </div>
        </div>
      )}
      {screen === 'finishing' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="rounded-2xl border border-line bg-surface p-8 text-center shadow-2xl">
            <Loader2 className="mx-auto size-8 animate-spin text-accent" />
            <p className="mt-3 font-medium">Submitting your answers…</p>
            <p className="mt-1 text-sm text-muted">Please don't close this window.</p>
          </div>
        </div>
      )}
      <Modal
        open={!!warning}
        onClose={() => setWarning(null)}
        title="Integrity warning"
        size="sm"
        footer={<Button onClick={() => { setWarning(null); if (settings?.requireFullscreen && !document.fullscreenElement) enterFullscreen(); }} data-autofocus>I understand — continue</Button>}
      >
        <div className="flex gap-3">
          <ShieldAlert className="size-6 shrink-0 text-warn" />
          <div className="text-sm">
            <p className="font-medium">{warning?.text}</p>
            <p className="mt-2 text-ink-2">This has been recorded for your examiner to review.{settings?.maxViolations ? <> You have <strong>{warning?.left}</strong> warning{warning?.left === 1 ? '' : 's'} left before the exam is submitted automatically.</> : null}</p>
          </div>
        </div>
      </Modal>
      <Modal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="Review before submitting"
        description="Once submitted, you can't change your answers."
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviewOpen(false)} data-autofocus>Keep working</Button>
            <HoldButton holdTime={1200} backgroundColor="var(--accent)" fillColor="var(--hl)" textColor="var(--accent-ink)" fillTextColor="var(--hl-ink)" radius={10} size="md" doneLabel="Submitting…" onHold={() => submit(false)}>
              Hold to submit
            </HoldButton>
          </>
        }
      >
        <p className="mb-3 text-xs text-muted">Press and hold the button (or hold Space/Enter on it) for a moment to submit — it prevents accidental submissions.</p>
        <div className="stagger grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-accent-soft p-3"><div className="tabular text-2xl font-semibold text-accent">{stats.answered}</div><div className="text-xs text-muted">Answered</div></div>
          <div className="rounded-xl bg-surface-2 p-3"><div className="tabular text-2xl font-semibold">{stats.unanswered}</div><div className="text-xs text-muted">Unanswered</div></div>
          <div className="rounded-xl bg-warn-soft p-3"><div className="tabular text-2xl font-semibold text-warn">{stats.flagged}</div><div className="text-xs text-muted">Marked for review</div></div>
        </div>
        {(stats.unanswered > 0 || stats.flagged > 0) && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium">Jump to a question:</p>
            <div className="flex flex-wrap gap-1.5">
              {questions.map((x, i) =>
                !isAnswered(answers[x.id]) || answers[x.id]?.flagged ? (
                  <button key={x.id} onClick={() => { setReviewOpen(false); go(i); }} className={cx('tabular h-9 min-w-9 rounded-lg border px-2 text-sm font-medium', answers[x.id]?.flagged ? 'border-warn bg-warn-soft text-warn' : 'border-line-strong')}>
                    {i + 1}
                  </button>
                ) : null,
              )}
            </div>
          </div>
        )}
        {pending > 0 && <p className="mt-4 flex items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn"><CloudOff className="size-4" /> {pending} change(s) haven't reached the server yet — we'll upload them before submitting.</p>}
        <p className="mt-4 text-sm text-muted">Time remaining: <span className="font-mono font-semibold text-ink">{fmtDuration(remaining)}</span></p>
      </Modal>
      <Modal open={prefsOpen} onClose={() => setPrefsOpen(false)} title="Display settings" description="Saved to your profile and remembered for future exams.">
        <PreferenceControls prefs={prefs} onChange={updateLocalPrefs} compact />
      </Modal>
      <Modal open={paletteOpen} onClose={() => setPaletteOpen(false)} title="Questions" size="sm">
        <div className="h-[60vh]" onClick={(e) => (e.target as HTMLElement).closest('ol button') && setPaletteOpen(false)}>
          {palette}
        </div>
      </Modal>
      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts" size="sm">
        <ul className="space-y-2.5 text-sm">
          {[
            ['N or →', 'Next question'],
            ['P or ←', 'Previous question'],
            ['1 – 9', 'Choose an option'],
            ['F', 'Mark / unmark for review'],
            ['S', 'Open the scratchpad'],
            ['?', 'Show this help'],
          ].map(([k, v]) => (
            <li key={k} className="flex justify-between"><span className="text-ink-2">{v}</span><Kbd>{k}</Kbd></li>
          ))}
        </ul>
      </Modal>
    </div>
  );

  function FullCenter({ children }: { children: React.ReactNode }) {
    return <div className="flex min-h-full flex-col items-center justify-center p-6 text-center">{children}</div>;
  }
}

function IconBtn({ children, label, onClick, active, className }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean; className?: string }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} aria-pressed={active} className={cx('grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-2', active && 'bg-accent-soft text-accent', className)}>
      {children}
    </button>
  );
}

function ConnectionPill({ net, save, pending, lastSavedAt }: { net: Net; save: Save; pending: number; lastSavedAt: number | null }) {
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((x) => x + 1), 10000);
    return () => clearInterval(iv);
  }, []);
  const since = lastSavedAt ? Math.round((Date.now() - lastSavedAt) / 1000) : null;
  const cfg =
    net === 'offline'
      ? { icon: <WifiOff className="size-3.5" />, text: `Offline · ${pending} queued`, tone: 'bg-warn-soft text-warn' }
      : net === 'unstable'
        ? { icon: <Wifi className="size-3.5" />, text: pending ? `Unstable · ${pending} queued` : 'Unstable connection', tone: 'bg-warn-soft text-warn' }
        : save === 'saving'
          ? { icon: <Loader2 className="size-3.5 animate-spin" />, text: 'Saving…', tone: 'bg-surface-2 text-ink-2' }
          : save === 'queued' || pending
            ? { icon: <Cloud className="size-3.5" />, text: `${pending} pending`, tone: 'bg-warn-soft text-warn' }
            : { icon: <CheckCircle2 className="size-3.5" />, text: since !== null && since < 60 ? 'All changes saved' : 'Saved', tone: 'bg-ok-soft text-ok' };
  return (
    <span role="status" aria-live="polite" aria-label={cfg.text} title={cfg.text} className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium sm:px-2.5', cfg.tone)}>
      {cfg.icon}
      <span className="hidden sm:inline">{cfg.text}</span>
    </span>
  );
}

function Watermark({ text }: { text: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.045]">
      <div className="absolute -inset-[50%] flex rotate-[-24deg] flex-wrap content-start gap-x-16 gap-y-20">
        {Array.from({ length: 120 }).map((_, i) => (
          <span key={i} className="whitespace-nowrap font-mono text-sm text-ink">{text}</span>
        ))}
      </div>
    </div>
  );
}

function FullscreenGate({ onEnter, first, title, maxViolations }: { onEnter: () => void; first: boolean; title: string; maxViolations: number }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-bg/95 p-4 backdrop-blur">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-8 shadow-2xl">
        <div className={cx('mb-4 grid size-12 place-items-center rounded-xl', first ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger')}>
          {first ? <Expand className="size-6" /> : <ShieldAlert className="size-6" />}
        </div>
        <h2 className="display text-2xl font-semibold">{first ? 'Ready to begin' : 'Return to full screen'}</h2>
        <p className="mt-2 text-sm text-ink-2">{first ? `${title} runs in full-screen mode. Your timer is already running on the server.` : 'You left full-screen mode. This has been recorded. Return to full screen to continue your exam — your timer is still running.'}</p>
        {first && (
          <ul className="mt-5 space-y-2 text-sm text-ink-2">
            <li className="flex gap-2"><Lock className="mt-0.5 size-4 shrink-0 text-muted" /> Switching tabs, leaving full screen, copying or pasting is recorded for your examiner.</li>
            {maxViolations > 0 && <li className="flex gap-2"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted" /> After {maxViolations} warnings your exam is submitted automatically.</li>}
            <li className="flex gap-2"><CloudOff className="mt-0.5 size-4 shrink-0 text-muted" /> If your internet drops, keep going — answers are stored on this device and sync later.</li>
            <li className="flex gap-2"><NotebookPen className="mt-0.5 size-4 shrink-0 text-muted" /> A scratchpad and calculator are built in. No camera or microphone is used.</li>
          </ul>
        )}
        <Button size="lg" className="mt-6 w-full" onClick={onEnter} icon={<Expand className="size-4" />}>
          {first ? 'Enter full screen & start' : 'Return to full screen'}
        </Button>
      </div>
    </div>
  );
}

function LockedScreen({ examId, onRetry }: { examId?: string; onRetry: () => void }) {
  const nav = useNavigate();
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-warn-soft text-warn"><Lock className="size-7" /></div>
        <h1 className="display mt-4 text-2xl font-semibold">Exam open on another device</h1>
        <p className="mt-2 text-sm text-ink-2">For security, an exam can only be active on one device at a time. If your other device failed, ask your examiner to approve the switch — your saved answers and remaining time will carry over. If the other device has been offline for 90 seconds, the switch is approved automatically.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => (examId ? nav(`/candidate/exams/${examId}`) : onRetry())}>Request access again</Button>
          <Button variant="outline" onClick={onRetry}>Check again</Button>
        </div>
      </div>
    </div>
  );
}

function DoneScreen({ finish, sandbox, examId, answered, total, pending }: { finish: { status: string; reason?: string; score?: number; maxScore?: number; at: number }; sandbox: boolean; examId?: string; answered: number; total: number; pending: number }) {
  const pendingSync = finish.status === 'PENDING_SYNC';
  const forced = finish.status === 'FORCE_SUBMITTED';
  const happy = !pendingSync && !forced;
  useEffect(() => {
    if (happy) setTimeout(() => confetti(), 350);
  }, [happy]);
  return (
    <div className="grid-paper flex min-h-full items-center justify-center p-6">
      <div className="pop-in w-full max-w-lg rounded-2xl border border-line bg-surface p-8 text-center shadow-[var(--shadow-lift)]">
        {happy ? (
          <div className="mx-auto grid w-fit place-items-center">
            <StatusMark status="done" size={64} strokeWidth={3} color="var(--ink)" doneColor="var(--ok)" drawDuration={0.7} />
          </div>
        ) : (
          <div className={cx('wiggle mx-auto grid size-14 place-items-center rounded-2xl', pendingSync ? 'bg-warn-soft text-warn' : 'bg-danger-soft text-danger')}>
            {pendingSync ? <CloudOff className="size-7" /> : <ShieldAlert className="size-7" />}
          </div>
        )}
        <h1 className="display mt-4 text-[28px] font-bold">
          {pendingSync ? "Time's up — waiting to upload" : forced ? 'Exam submitted automatically' : finish.reason === 'time_expired' || finish.status === 'AUTO_SUBMITTED' ? "Time's up — exam submitted" : 'Exam submitted'}
        </h1>
        <p className="mt-2 text-sm text-ink-2">
          {pendingSync
            ? `${pending} answer(s) made before the deadline are saved on this device. Keep this page open and reconnect within 10 minutes — they'll be uploaded and accepted because they were written in time.`
            : forced
              ? finish.reason === 'integrity_violation_limit'
                ? 'The integrity warning limit was reached. Your answers up to that point were submitted, and your examiner will review the recorded events.'
                : 'Your examiner ended this attempt. Your saved answers were submitted.'
              : `Your answers were received at ${fmtTime(new Date(finish.at))}. ${answered} of ${total} questions answered.`}
        </p>
        {sandbox && finish.score !== undefined && (
          <div className="mt-5 rounded-xl bg-info-soft p-4 text-info">
            <div className="text-xs font-semibold uppercase tracking-wide">Sandbox auto-score</div>
            <div className="tabular mt-1 text-3xl font-semibold">{finish.score} / {finish.maxScore}</div>
            <div className="mt-1 text-xs">Written answers aren't scored in the sandbox. Nothing was recorded.</div>
          </div>
        )}
        {!sandbox && !pendingSync && <p className="mt-4 text-sm text-muted">Results will appear on your dashboard once your examiner publishes them.</p>}
        <div className="mt-6 flex justify-center gap-2">
          {sandbox && examId ? <Link to={`/examiner/exams/${examId}`}><Button>Back to exam editor</Button></Link> : <Link to="/candidate"><Button>Back to my exams</Button></Link>}
        </div>
      </div>
    </div>
  );
}
