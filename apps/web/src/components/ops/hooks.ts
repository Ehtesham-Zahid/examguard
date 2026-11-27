import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { downloadFile, errMsg } from '@/lib/api';
import { getSocket } from '@/lib/socket';

/** Re-renders every `ms` milliseconds and returns Date.now(). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export const MONITOR_EVENTS = ['attempt:update', 'attempt:progress', 'attempt:heartbeat', 'incident:new', 'compensation:new', 'transfer:new', 'exam:paused', 'exam:resumed'] as const;
export type MonitorEvent = (typeof MONITOR_EVENTS)[number];
type Handler = (event: MonitorEvent, data: Record<string, unknown>) => void;

/**
 * Joins the staff monitor room for an exam and forwards every monitor event to `onEvent`.
 * Re-joins after reconnects; removes all listeners on unmount.
 */
export function useMonitorSocket(examId: string | undefined, onEvent: Handler) {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });
  const [state, setState] = useState<'connecting' | 'live' | 'offline' | 'denied'>('connecting');

  useEffect(() => {
    if (!examId) return;
    const s = getSocket();
    const join = () => s.emit('join:exam', examId, (ok: boolean) => setState(ok ? 'live' : 'denied'));
    const onConnect = () => join();
    const onDisconnect = () => setState('offline');
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    if (s.connected) join();
    const listeners = MONITOR_EVENTS.map((ev) => {
      const fn = (data: Record<string, unknown>) => handler.current(ev, data ?? {});
      s.on(ev, fn);
      return [ev, fn] as const;
    });
    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      listeners.forEach(([ev, fn]) => s.off(ev, fn));
    };
  }, [examId]);

  return state;
}

/** Wraps downloadFile with a busy flag and error toast. */
export function useDownload() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (path: string, name: string) => {
    setBusy(path);
    try {
      await downloadFile(path, name);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/** Keyboard shortcuts that are ignored while typing in a field (unless `allowInFields`). */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, allowInFields: string[] = []) {
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (document.querySelector('[role="dialog"]')) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      // letters can't be typed into a number field, so letter shortcuts still work there
      const numberField = t?.tagName === 'INPUT' && (t as HTMLInputElement).type === 'number' && /^[a-z]$/.test(key);
      const typing = !!t && !numberField && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const fn = ref.current[key];
      if (!fn) return;
      if (typing && !fields.includes(key)) return;
      if (numberField) e.preventDefault();
      fn(e);
    };
    const fields = allowInFields;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowInFields.join(',')]);
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
