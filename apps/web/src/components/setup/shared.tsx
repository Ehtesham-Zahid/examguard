import { useEffect, useState, type ReactNode } from 'react';
import { Check, Copy, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { Button, cx } from '@/components/ui';

/* ----------------------------- file helpers ----------------------------- */

export function downloadText(name: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');

export const readTextFile = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsText(f);
  });

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
    return true;
  } catch {
    toast.error('Copy failed — select the text and copy it manually');
    return false;
  }
}

/* ----------------------------- error helpers ----------------------------- */

/** Turns a zod VALIDATION_ERROR into a field → message map (first message per path). */
export function fieldErrors(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (e instanceof ApiError && Array.isArray(e.details)) {
    for (const d of e.details as { path?: string; message?: string }[]) {
      if (d && typeof d === 'object' && d.path !== undefined && d.message && !out[d.path]) out[d.path] = d.message;
    }
  }
  return out;
}

/** String list from ApiError.details (blueprint problems are plain strings, publish failures are check objects). */
export function detailList(e: unknown): string[] {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return [];
  return (e.details as unknown[]).map((d) => {
    if (typeof d === 'string') return d;
    if (d && typeof d === 'object') {
      const o = d as { label?: string; detail?: string; message?: string; path?: string };
      if (o.label) return o.detail ? `${o.label} — ${o.detail}` : o.label;
      if (o.message) return o.path ? `${o.path}: ${o.message}` : o.message;
    }
    return String(d);
  });
}

/* ----------------------------- UI pieces ----------------------------- */

/** Shows a one-time secret (temporary password) with a copy button. */
export function SecretReveal({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-warn/40 bg-warn-soft p-4">
      <div className="text-[13px] font-medium text-warn">{label}</div>
      <div className="mt-2 flex items-center gap-2">
        <code className="tabular min-w-0 flex-1 select-all truncate rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[15px] text-ink" aria-label={label}>
          {value}
        </code>
        <Button
          variant="outline"
          size="md"
          icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          onClick={async () => {
            if (await copyText(value)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="mt-2 text-xs text-ink-2">{note ?? 'This is shown only once. The user will be asked to choose a new password at first sign-in.'}</p>
    </div>
  );
}

export function LockNotice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
      <Lock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <div>
        <div className="font-medium">{title}</div>
        {children && <div className="mt-0.5 text-ink-2">{children}</div>}
      </div>
    </div>
  );
}

/** Segmented control (radio-group semantics). */
export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode; count?: number }[]; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex flex-wrap gap-1 rounded-lg border border-line bg-surface-2 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition', value === o.id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}
        >
          {o.label}
          {o.count !== undefined && <span className="tabular rounded-full bg-surface-2 px-1.5 text-[11px] text-ink-2">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[13px] text-muted">
      <span className="tabular">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span className="tabular">
          Page {page} / {pages}
        </span>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cx('grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent', className)}>
      {initials(name) || '?'}
    </span>
  );
}

export function IconBtn({ label, onClick, children, danger, disabled }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cx('rounded-lg p-2 transition disabled:cursor-not-allowed disabled:opacity-40', danger ? 'text-muted hover:bg-danger-soft hover:text-danger' : 'text-muted hover:bg-surface-2 hover:text-ink')}
    >
      {children}
    </button>
  );
}
