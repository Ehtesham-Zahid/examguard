import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { MoreHorizontal, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, errMsg } from '@/lib/api';
import { Button, cx, Modal } from '@/components/ui';
import { detailList } from '../shared';
import type { ExamDetail } from '../types';

export const examKey = (id: string) => ['exam', id] as const;

export function invalidateExam(qc: QueryClient, id: string) {
  qc.invalidateQueries({ queryKey: examKey(id) });
  qc.invalidateQueries({ queryKey: ['exams'] });
  qc.invalidateQueries({ queryKey: ['review', id] });
  qc.invalidateQueries({ queryKey: ['fairness', id] });
}

/** Publish with a readable list of failed checks when the server refuses. */
export function usePublish(exam: ExamDetail) {
  const qc = useQueryClient();
  const [failed, setFailed] = useState<string[] | null>(null);
  const m = useMutation({
    mutationFn: () => api(`/exams/${exam.id}/publish`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Published — enrolled candidates have been notified');
      invalidateExam(qc, exam.id);
    },
    onError: (e) => {
      const list = detailList(e);
      if (e instanceof ApiError && e.status === 400 && list.length) setFailed(list);
      else toast.error(errMsg(e));
      qc.invalidateQueries({ queryKey: ['review', exam.id] });
    },
  });
  const modal = (
    <Modal open={!!failed} onClose={() => setFailed(null)} title="Not ready to publish" description="Fix these blocking checks, then try again." size="sm" footer={<Button onClick={() => setFailed(null)}>Got it</Button>}>
      <ul className="space-y-2">
        {failed?.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            {f}
          </li>
        ))}
      </ul>
    </Modal>
  );
  return { publish: () => m.mutate(), publishing: m.isPending, modal };
}

/** Small accessible overflow menu. */
export function Menu({ label, items }: { label: string; items: { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; hidden?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const visible = items.filter((i) => !i.hidden);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const els = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
        const i = els.indexOf(document.activeElement as HTMLElement);
        els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!visible.length) return null;
  return (
    <div ref={ref} className="relative">
      <Button variant="outline" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)} className="px-2.5">
        <MoreHorizontal className="size-4" />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1.5 min-w-48 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl">
          {visible.map((i) => (
            <button
              key={i.label}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                i.onSelect();
              }}
              className={cx('flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm focus:outline-none', i.danger ? 'text-danger hover:bg-danger-soft focus:bg-danger-soft' : 'hover:bg-surface-2 focus:bg-surface-2')}
            >
              {i.icon}
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const linkBtn = {
  primary: 'inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink shadow-sm transition hover:brightness-110',
  outline: 'inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-ink transition hover:bg-surface-2',
  live: 'inline-flex h-10 items-center gap-2 rounded-lg bg-ok px-4 text-sm font-medium text-surface shadow-sm transition hover:brightness-110',
};
