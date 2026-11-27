import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Client-side integrity guard (Innovation 5.1 — "integrity in the AI era").
 * Privacy-first: no camera, microphone or screen recording. We block the common shortcuts for
 * copying questions into an AI tool / pasting answers back, and record behavioural signals that a
 * human examiner reviews. Signals are evidence, never an automatic verdict (except the configurable
 * warning limit that the candidate is told about up front).
 */
export type Signal =
  | 'TAB_HIDDEN'
  | 'WINDOW_BLUR'
  | 'FULLSCREEN_EXIT'
  | 'COPY_ATTEMPT'
  | 'CUT_ATTEMPT'
  | 'PASTE_ATTEMPT'
  | 'CONTEXT_MENU'
  | 'BLOCKED_SHORTCUT'
  | 'SCREENSHOT_KEY'
  | 'DEVTOOLS_OPEN'
  | 'MULTI_SCREEN'
  | 'PASTE_LIKE_INPUT'
  | 'TYPING_ANOMALY'
  | 'RAPID_ANSWERS'
  | 'SPLIT_SCREEN'
  | 'FULLSCREEN_ENTER'
  | 'TAB_VISIBLE';

const COUNTED = new Set<Signal>(['TAB_HIDDEN', 'WINDOW_BLUR', 'FULLSCREEN_EXIT', 'COPY_ATTEMPT', 'CUT_ATTEMPT', 'PASTE_ATTEMPT', 'BLOCKED_SHORTCUT', 'SCREENSHOT_KEY', 'DEVTOOLS_OPEN', 'MULTI_SCREEN', 'PASTE_LIKE_INPUT']);
export const isCounted = (s: Signal) => COUNTED.has(s);

export const SIGNAL_TEXT: Partial<Record<Signal, string>> = {
  TAB_HIDDEN: 'You left the exam tab.',
  WINDOW_BLUR: 'The exam window lost focus.',
  FULLSCREEN_EXIT: 'You exited full-screen mode.',
  COPY_ATTEMPT: 'Copying exam content is not allowed.',
  CUT_ATTEMPT: 'Cutting text is not allowed.',
  PASTE_ATTEMPT: 'Pasting text from outside the exam is not allowed.',
  BLOCKED_SHORTCUT: 'That keyboard shortcut is disabled during the exam.',
  SCREENSHOT_KEY: 'Screenshots are not allowed during the exam.',
  DEVTOOLS_OPEN: 'Browser developer tools must stay closed.',
  MULTI_SCREEN: 'A second screen was detected. Please disconnect it.',
  PASTE_LIKE_INPUT: 'A large block of text appeared at once.',
};

export function useIntegrity(opts: { enabled: boolean; requireFullscreen: boolean; onSignal: (s: Signal, details?: string) => void }) {
  const { enabled, requireFullscreen, onSignal } = opts;
  const cb = useRef(onSignal);
  cb.current = onSignal;
  const [isFullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const hiddenAt = useRef<number | null>(null);
  const lastBlur = useRef(0);
  const devtoolsOpen = useRef(false);
  const once = useRef(new Set<string>());
  const baseline = useRef<number | null>(null);
  const lastDpr = useRef(window.devicePixelRatio || 1);
  const streak = useRef(0);

  const emit = useCallback((s: Signal, d?: string) => cb.current(s, d), []);

  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement);
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [enabled]);

  // keep the device awake (a phone auto-locking would otherwise look like leaving the tab)
  useEffect(() => {
    if (!enabled) return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const acquire = () => nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => null);
    acquire();
    const onVis = () => document.visibilityState === 'visible' && acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => null);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        emit('TAB_HIDDEN');
      } else if (hiddenAt.current) {
        const away = Math.round((Date.now() - hiddenAt.current) / 1000);
        hiddenAt.current = null;
        emit('TAB_VISIBLE', `returned after ${away}s`);
      }
    };
    const onBlur = () => {
      // visibilitychange already covers tab switches; only report pure focus loss (other window/app on top)
      setTimeout(() => {
        if (document.visibilityState === 'visible' && !document.hasFocus() && Date.now() - lastBlur.current > 3000) {
          lastBlur.current = Date.now();
          emit('WINDOW_BLUR');
        }
      }, 150);
    };
    const onFs = () => {
      const fs = !!document.fullscreenElement;
      if (requireFullscreen) emit(fs ? 'FULLSCREEN_ENTER' : 'FULLSCREEN_EXIT');
      if (fs) lockEscape();
    };
    const lockEscape = () => (navigator as Navigator & { keyboard?: { lock?: (k: string[]) => Promise<void> } }).keyboard?.lock?.(['Escape']).catch(() => null);
    if (document.fullscreenElement) lockEscape();
    const block = (type: Signal) => (e: ClipboardEvent) => {
      // rough-work notes in the scratchpad may use the clipboard; graded answers and questions may not
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-allow-clipboard]')) return;
      e.preventDefault();
      emit(type);
    };
    const onCopy = block('COPY_ATTEMPT');
    const onCut = block('CUT_ATTEMPT');
    const onPaste = block('PASTE_ATTEMPT');
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      emit('CONTEXT_MENU');
    };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (k === 'printscreen') {
        e.preventDefault();
        emit('SCREENSHOT_KEY');
        return;
      }
      if (e.metaKey && e.shiftKey && ['3', '4', '5', 's'].includes(k)) {
        e.preventDefault();
        emit('SCREENSHOT_KEY');
        return;
      }
      if (k === 'f12' || (mod && e.shiftKey && ['i', 'j', 'c'].includes(k)) || (mod && e.altKey && ['i', 'j'].includes(k))) {
        e.preventDefault();
        emit('BLOCKED_SHORTCUT', `${e.ctrlKey ? 'Ctrl+' : e.metaKey ? 'Cmd+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.key}`);
        return;
      }
      if (mod && ['p', 's', 'u', 'f', 'g'].includes(k)) {
        e.preventDefault();
        emit('BLOCKED_SHORTCUT', `${e.ctrlKey ? 'Ctrl' : 'Cmd'}+${e.key.toUpperCase()}`);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') navigator.clipboard?.writeText('').catch(() => null); // keydown already recorded it
    };
    const checkDevtools = () => {
      if (document.fullscreenElement) return;
      // docked devtools shrink the viewport; require the gap to *appear* after the exam started and persist for 2 checks
      // browser zoom changes the gap too — re-baseline whenever the zoom level (devicePixelRatio) changes
      const gap = Math.max(window.outerWidth - window.innerWidth, window.outerHeight - window.innerHeight - 140);
      if (window.devicePixelRatio !== lastDpr.current) {
        lastDpr.current = window.devicePixelRatio;
        baseline.current = null;
        streak.current = 0;
      }
      if (baseline.current === null) baseline.current = gap;
      const open = gap - baseline.current > 200;
      streak.current = open ? streak.current + 1 : 0;
      if (streak.current === 2 && !devtoolsOpen.current) {
        devtoolsOpen.current = true;
        emit('DEVTOOLS_OPEN');
      }
      if (!open) devtoolsOpen.current = false;
      const s = window.screen as Screen & { isExtended?: boolean };
      if (s.isExtended && !once.current.has('multi')) {
        once.current.add('multi');
        emit('MULTI_SCREEN');
      }
      if (!document.fullscreenElement && window.outerWidth < screen.availWidth * 0.55 && !once.current.has('split')) {
        once.current.add('split');
        emit('SPLIT_SCREEN', `window ${window.outerWidth}px of ${screen.availWidth}px`);
      }
    };
    const beforePrint = () => emit('BLOCKED_SHORTCUT', 'print');
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    document.addEventListener('contextmenu', onCtx);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('beforeprint', beforePrint);
    const iv = setInterval(checkDevtools, 2000);
    checkDevtools();
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('beforeprint', beforePrint);
      clearInterval(iv);
    };
  }, [enabled, requireFullscreen, emit]);

  const enterFullscreen = useCallback(async () => {
    try {
      const r = await Promise.race([document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => true), new Promise<boolean>((res) => setTimeout(() => res(!!document.fullscreenElement), 1500))]);
      return r || !!document.fullscreenElement;
    } catch {
      return false;
    }
  }, []);

  return { isFullscreen, enterFullscreen };
}

/**
 * Typing-behaviour monitor for written answers: detects text that appears in one burst (pasted or
 * injected by an AI extension) and machine-like uniform keystroke rhythm (auto-typers).
 */
export function useTypingMonitor(onSignal: (s: Signal, details?: string) => void) {
  const intervals = useRef<number[]>([]);
  const last = useRef(0);
  const flagged = useRef(new Set<string>());
  return useCallback(
    (questionId: string, e: React.FormEvent<HTMLTextAreaElement>, prevLength: number) => {
      const ne = e.nativeEvent as InputEvent;
      const len = e.currentTarget.value.length;
      const inserted = len - prevLength;
      if (ne.inputType?.startsWith('history')) return; // undo/redo restores the candidate's own text
      if (inserted > 40 && ne.inputType !== 'insertText' && ne.inputType !== 'insertLineBreak') onSignal('PASTE_LIKE_INPUT', `${inserted} characters inserted at once (${ne.inputType || 'unknown'})`);
      else if (inserted > 60) onSignal('PASTE_LIKE_INPUT', `${inserted} characters in one input event`);
      if (ne.inputType === 'insertText') {
        const now = performance.now();
        if (last.current) intervals.current.push(now - last.current);
        last.current = now;
        if (intervals.current.length > 80) intervals.current.shift();
        if (intervals.current.length >= 60 && !flagged.current.has(questionId)) {
          const xs = intervals.current;
          const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
          const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
          if (sd < 6 && mean < 120) {
            flagged.current.add(questionId);
            onSignal('TYPING_ANOMALY', `keystroke interval ${mean.toFixed(0)}±${sd.toFixed(1)}ms`);
          }
        }
      }
    },
    [onSignal],
  );
}
