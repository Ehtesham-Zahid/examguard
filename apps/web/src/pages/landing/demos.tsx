import { Check, CheckCircle2, Cloud, CloudOff, Loader2, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import Counter from '@/components/bits/Counter';
import { cx } from '@/components/ui';
import { useInView } from './Reveal';

const OPTIONS = ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'];

/** A living miniature of the exam workspace: answers get highlighted, the timer ticks, the network drops and recovers. */
export function HeroMock() {
  const [sel, setSel] = useState(1);
  const [answered, setAnswered] = useState(6);
  const [secs, setSecs] = useState(42 * 60 + 18);
  const [net, setNet] = useState<'online' | 'offline' | 'syncing'>('online');
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 42 * 60 + 18)), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let step = 0;
    const t = setInterval(() => {
      step++;
      setSel((s) => (s + 1 + (step % 2)) % 4);
      setAnswered((a) => (a >= 12 ? 6 : a + 1));
      // every few beats, simulate an outage: answers queue on the device, then sync
      const phase = step % 6;
      if (phase === 3) setNet('offline');
      if (phase === 3 || phase === 4) setQueued((q) => q + 1);
      if (phase === 5) setNet('syncing');
      if (phase === 0) {
        setNet('online');
        setQueued(0);
      }
    }, 1900);
    return () => clearInterval(t);
  }, []);

  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-2xl border-2 border-ink bg-surface shadow-[6px_6px_0_var(--ink)]">
        {/* window bar */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="display truncate text-[16px] font-bold">DSA Midterm</div>
            <div className="text-[12px] text-muted">Question 7 of 12 · 4 marks</div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cx(
                'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold transition-colors',
                net === 'online' ? 'bg-ok-soft text-ok' : net === 'offline' ? 'bg-warn-soft text-warn' : 'bg-info-soft text-info',
              )}
            >
              {net === 'online' ? <CheckCircle2 className="size-3" /> : net === 'offline' ? <CloudOff className="size-3" /> : <Loader2 className="size-3 animate-spin" />}
              {net === 'online' ? 'Saved' : net === 'offline' ? `Offline · ${queued} queued` : 'Syncing…'}
            </span>
            <span className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 font-mono text-[16px] font-semibold" aria-label={`Timer ${mm}:${ss}`}>
              <span className="size-1.5 rounded-full bg-ok pulse-dot" />
              <Counter value={mm} minDigits={2} fontSize={15} fontWeight={600} textColor="var(--ink)" tabular padding={0} />
              :
              <Counter value={ss} minDigits={2} fontSize={15} fontWeight={600} textColor="var(--ink)" tabular padding={0} />
            </span>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_96px] sm:grid-cols-[1fr_118px]">
          <div className="margin-line relative py-4 pl-9 pr-4 [&::before]:left-4">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Single choice</div>
            <p className="mt-1.5 text-[15px] leading-snug">Worst-case time to search a balanced binary search tree?</p>
            <div className="mt-3 space-y-1.5">
              {OPTIONS.map((o, i) => (
                <div
                  key={o + (i === sel ? '-on' : '')}
                  className={cx('flex items-center gap-2 rounded-lg border-[1.5px] px-2.5 py-1.5 text-[14px] transition-colors', i === sel ? 'hl-answer border-ink' : 'border-line')}
                >
                  <span className={cx('grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] font-mono text-[11px] font-bold', i === sel ? 'pop border-ink bg-ink text-surface' : 'border-line-strong text-muted')}>
                    {i === sel ? <Check className="size-3" strokeWidth={3} /> : String.fromCharCode(65 + i)}
                  </span>
                  <span className="font-mono">{o}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="border-l border-line p-2.5">
            <div className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted">Navigator</div>
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }, (_, i) => (
                <span
                  key={i + (i < answered ? 'a' : 'b')}
                  className={cx(
                    'grid aspect-square place-items-center rounded-md border-[1.5px] font-mono text-[10px] font-semibold',
                    i < answered ? 'pop border-ink bg-ink text-surface' : 'border-line text-muted',
                    i === 6 && 'ring-2 ring-margin ring-offset-1 ring-offset-[var(--surface)]',
                    i === 3 && i >= answered && 'border-dashed border-margin',
                  )}
                >
                  {i + 1}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* sticky notes */}
      <div className="sticky-note absolute -bottom-7 -left-5 hidden w-44 rounded-md bg-hl p-3 text-[13px] font-semibold leading-snug text-hl-ink shadow-[0_8px_18px_-8px_rgb(23_42_70/0.45)] sm:block" style={{ ['--r' as string]: '-5deg', ['--d' as string]: '0.9s' }}>
        Wi-Fi dropped? Keep going. Answers are saved on this device ✓
      </div>
      <div className="sticky-note absolute -right-4 -top-6 hidden rounded-md border-2 border-ink bg-surface px-3 py-2 font-mono text-[12px] font-bold text-ink shadow-[3px_3px_0_var(--ink)] sm:block" style={{ ['--r' as string]: '6deg', ['--d' as string]: '1.2s' }}>
        timer = server clock ⏱
      </div>
    </div>
  );
}

/** "Pull the plug": candidates answer while offline; reconnecting syncs every answer that was made before the deadline. */
export function OfflineDemo() {
  const [online, setOnline] = useState(true);
  const [answers, setAnswers] = useState<{ q: number; state: 'saved' | 'queued' | 'syncing' }[]>([
    { q: 1, state: 'saved' },
    { q: 2, state: 'saved' },
  ]);
  const next = answers.length + 1;

  const answer = () => {
    if (next > 8) return;
    setAnswers((a) => [...a, { q: next, state: online ? 'saved' : 'queued' }]);
  };
  const toggle = () => {
    if (online) return setOnline(false);
    setOnline(true);
    // queued answers sync one after another
    const queued = answers.filter((a) => a.state === 'queued').map((a) => a.q);
    queued.forEach((q, i) => {
      setTimeout(() => setAnswers((a) => a.map((x) => (x.q === q ? { ...x, state: 'syncing' } : x))), 250 + i * 380);
      setTimeout(() => setAnswers((a) => a.map((x) => (x.q === q ? { ...x, state: 'saved' } : x))), 520 + i * 380);
    });
  };
  const queuedCount = answers.filter((a) => a.state !== 'saved').length;

  return (
    <div className="rounded-2xl border-2 border-ink bg-surface p-5 shadow-[6px_6px_0_var(--ink)] sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">Try it</div>
          <div className="display text-xl font-bold">Pull the plug</div>
        </div>
        <button
          onClick={toggle}
          role="switch"
          aria-checked={online}
          aria-label="Internet connection"
          className={cx('flex items-center gap-2 rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-all active:scale-95', online ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn')}
        >
          {online ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
          {online ? 'Wi-Fi on' : 'Wi-Fi off'}
          <span className={cx('relative h-5 w-9 rounded-full transition-colors', online ? 'bg-ok' : 'bg-line-strong')}>
            <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', online ? 'left-[18px]' : 'left-0.5')} />
          </span>
        </button>
      </div>
      <div className={cx('mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] font-semibold transition-colors', online ? (queuedCount ? 'bg-info-soft text-info' : 'bg-ok-soft text-ok') : 'bg-warn-soft text-warn')} role="status" aria-live="polite">
        {online ? queuedCount ? <Loader2 className="size-4 animate-spin" /> : <Cloud className="size-4" /> : <CloudOff className="size-4" />}
        {online ? (queuedCount ? `Back online, syncing ${queuedCount} answer(s)…` : 'All answers are on the server') : `Offline: ${queuedCount} answer(s) safe on this device`}
      </div>
      <ol className="mt-4 grid grid-cols-4 gap-2">
        {Array.from({ length: 8 }, (_, i) => {
          const a = answers.find((x) => x.q === i + 1);
          return (
            <li
              key={i + (a?.state ?? 'none')}
              className={cx(
                'relative grid h-14 place-items-center rounded-lg border-[1.5px] font-mono text-sm font-bold transition-all',
                !a && 'border-dashed border-line-strong text-muted',
                a?.state === 'saved' && 'pop border-ink bg-ink text-surface',
                a?.state === 'queued' && 'pop border-warn bg-warn-soft text-warn',
                a?.state === 'syncing' && 'border-info bg-info-soft text-info',
              )}
            >
              Q{i + 1}
              {a?.state === 'queued' && <CloudOff className="absolute right-1 top-1 size-3" />}
              {a?.state === 'saved' && <Check className="absolute right-1 top-1 size-3" />}
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button onClick={answer} disabled={next > 8} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink shadow-[0_2px_0_rgb(0_0_0/0.2)] transition-all hover:-translate-y-px active:scale-95 disabled:opacity-40">
          Answer next question
        </button>
        <button onClick={() => { setOnline(true); setAnswers([{ q: 1, state: 'saved' }, { q: 2, state: 'saved' }]); }} className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-surface-2">
          Reset
        </button>
      </div>
      <p className="mt-3 text-[13px] text-muted">Answers written offline are accepted only if they were made before the deadline, so nobody gains extra time.</p>
    </div>
  );
}

/** Dot plot: expected score of 40 simulated papers, pure random vs balanced. */
export function FairnessPlot() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const rows = useMemo(() => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
    return {
      naive: Array.from({ length: 40 }, () => 50 + gauss() * 3.4 * 2.6),
      fair: Array.from({ length: 40 }, () => 50 + gauss() * 0.1 * 2.6),
    };
  }, []);
  const x = (v: number) => `${Math.min(98, Math.max(2, ((v - 38) / 24) * 100))}%`;
  return (
    <div ref={ref} className="rounded-2xl border-2 border-ink bg-surface p-5 shadow-[6px_6px_0_var(--ink)] sm:p-6">
      <div className="font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">Expected score of 40 randomised papers</div>
      {(['naive', 'fair'] as const).map((k) => (
        <div key={k} className="mt-5">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="font-semibold">{k === 'naive' ? 'Picked at random' : 'Balanced by ExamGuard'}</span>
            <span className={cx('font-mono text-[14px] font-bold', k === 'naive' ? 'text-danger' : 'text-ok')}>{k === 'naive' ? '±3.4 pts' : '±0.1 pts'}</span>
          </div>
          <div className="paper-grid relative h-14 overflow-hidden rounded-lg border border-line">
            <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-margin/70" aria-hidden />
            {rows[k].map((v, i) => (
              <span
                key={i}
                className={cx('absolute top-1/2 size-3 -translate-x-1/2 rounded-full border-2 transition-all duration-700', k === 'naive' ? 'border-ink bg-surface' : 'border-ink bg-hl')}
                style={{ left: inView ? x(v) : '50%', marginTop: `${((i % 5) - 2) * 7 - 6}px`, opacity: inView ? 1 : 0, transitionDelay: `${i * 18}ms` }}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="mt-3 flex justify-between font-mono text-[11px] text-muted">
        <span>easier paper</span>
        <span className="text-margin">target</span>
        <span>harder paper</span>
      </div>
    </div>
  );
}
