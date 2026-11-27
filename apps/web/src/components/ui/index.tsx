import { clsx } from 'clsx';
import { Loader2, X } from 'lucide-react';
import CountUp from '@/components/bits/CountUp';
import { forwardRef, useEffect, useId, useRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';

export const cx = clsx;

/* ------------------------------- Button ------------------------------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'highlight';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink shadow-[0_2px_0_rgb(0_0_0/0.18)] hover:brightness-110 hover:-translate-y-px',
  highlight: 'bg-hl text-hl-ink shadow-[0_2px_0_rgb(23_42_70/0.25)] hover:brightness-105 hover:-translate-y-px',
  secondary: 'bg-surface-2 text-ink hover:bg-line',
  outline: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'bg-danger text-danger-ink hover:brightness-110',
};
export const buttonClass = (variant: Variant = 'primary', size: 'sm' | 'md' | 'lg' = 'md', className?: string) =>
  cx(
    'inline-flex select-none items-center justify-center gap-2 rounded-lg font-semibold transition-all duration-150 active:translate-y-0 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
    size === 'sm' && 'h-8 px-3 text-[13px]',
    size === 'md' && 'h-10 px-4 text-sm',
    size === 'lg' && 'h-12 px-6 text-[15px]',
    variants[variant],
    className,
  );
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }>(
  ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

/** A router link that looks like a Button (avoids invalid <a><button> nesting). */
export function ButtonLink({ to, variant, size, icon, className, children, ...rest }: { to: string; variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; className?: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <Link to={to} className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

/* ------------------------------- Fields ------------------------------- */
export function Field({ label, hint, error, children, required, className }: { label: string; hint?: ReactNode; error?: string; children: (id: string) => ReactNode; required?: boolean; className?: string }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
        {label} {required && <span className="text-danger" aria-hidden>*</span>}
      </label>
      {children(id)}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
const inputBase = 'w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(({ className, invalid, ...p }, ref) => (
  <input ref={ref} aria-invalid={invalid || undefined} className={cx(inputBase, 'h-10', invalid && 'border-danger', className)} {...p} />
));
Input.displayName = 'Input';
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cx(inputBase, 'min-h-24 py-2.5 leading-relaxed', className)} {...p} />
));
Textarea.displayName = 'Textarea';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cx(inputBase, 'h-10 pr-8', className)} {...p}>
    {children}
  </select>
));
Select.displayName = 'Select';

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className={cx('flex cursor-pointer items-start justify-between gap-4 py-2', disabled && 'opacity-50')}>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-accent' : 'bg-line-strong')}
      >
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

/* ------------------------------- Surfaces ------------------------------- */
export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-xl border border-line bg-surface shadow-[var(--shadow)]', className)} {...p}>
      {children}
    </div>
  );
}
export function CardHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="page-enter mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-2 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">
            <span className="h-[2px] w-5 rounded bg-margin" aria-hidden />
            {eyebrow}
          </div>
        )}
        <h1 className="display text-[30px] font-bold leading-tight sm:text-[36px]">
          <span className="hl-swipe">{title}</span>
        </h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[15px] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

type Tone = 'neutral' | 'accent' | 'info' | 'warn' | 'danger' | 'ok';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2 border-line',
  accent: 'bg-accent-soft text-accent border-transparent',
  info: 'bg-info-soft text-info border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  ok: 'bg-ok-soft text-ok border-transparent',
};
export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; icon?: ReactNode }) {
  return (
    <Card className="lift p-4">
      <div className="flex items-center justify-between text-[13px] text-muted">
        <span>{label}</span>
        {icon && <span className={cx('rounded-md p-1.5', tone ? tones[tone] : 'bg-surface-2 text-ink-2')}>{icon}</span>}
      </div>
      <div className="display tabular mt-2 text-[28px] font-bold leading-none">
        {typeof value === 'number' ? <CountUp to={value} duration={0.9} separator="," decimals={Number.isInteger(value) ? 0 : 1} trigger="load" /> : value}
      </div>
      {hint && <div className="mt-1.5 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-12 text-sm text-muted" role="status">
      <svg width="64" height="28" viewBox="0 0 64 28" aria-hidden className="text-accent">
        <path d="M4 18c6-10 10-10 14 0s8 10 12 0 8-10 12 0 8 10 14-2" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="120" style={{ animation: 'scribble-load 1.4s ease-in-out infinite' }} />
        <rect x="2" y="21" width="60" height="5" rx="2" fill="var(--hl)" opacity=".7" />
      </svg>
      <span>{label}…</span>
    </div>
  );
}
export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="fade-in flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="relative mb-4">
        <svg width="120" height="84" viewBox="0 0 120 84" aria-hidden className="float" style={{ ['--r' as string]: '-3deg' }}>
          <rect x="18" y="6" width="84" height="72" rx="6" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="2" />
          <path d="M18 22h84M18 36h84M18 50h84M18 64h84" stroke="var(--line)" strokeWidth="1.5" />
          <path d="M32 6v72" stroke="var(--margin)" strokeWidth="1.5" opacity=".7" />
          <rect x="40" y="29" width="46" height="9" rx="2" fill="var(--hl)" opacity=".85" />
        </svg>
        {icon && <div className="absolute -bottom-2 -right-3 grid size-10 place-items-center rounded-full border-2 border-surface bg-accent text-accent-ink shadow-[var(--shadow)]">{icon}</div>}
      </div>
      <h3 className="display text-[17px] font-bold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-4 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
      <span>{error instanceof Error ? error.message : 'Something went wrong'}</span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/* ------------------------------- Modal ------------------------------- */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', dismissable = true }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; dismissable?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // keep the latest handlers in refs so parent re-renders (new onClose identity, ticking clocks) never re-run the focus effect
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissRef = useRef(dismissable);
  dismissRef.current = dismissable;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => (ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('input:not([type=hidden]),textarea,select') ?? ref.current?.querySelector<HTMLElement>('button'))?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissRef.current) onCloseRef.current();
      if (e.key === 'Tab' && ref.current) {
        const els = ref.current.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])');
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="fade-in fixed inset-0 z-50 flex items-end justify-center bg-[rgb(15_26_43/0.5)] p-0 backdrop-blur-[3px] sm:items-center sm:p-4" onMouseDown={(e) => dismissable && e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cx(
          'pop-in flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-xl',
          size === 'lg' && 'sm:max-w-3xl',
          size === 'xl' && 'sm:max-w-5xl',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {dismissable && (
            <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close dialog">
              <X className="size-5" />
            </button>
          )}
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2/50 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', tone = 'primary', loading, children }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; body?: ReactNode; confirmLabel?: string; tone?: 'primary' | 'danger'; loading?: boolean; children?: ReactNode }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          {/* destructive actions focus Cancel first so a stray Enter can't confirm them */}
          <Button variant="ghost" onClick={onClose} data-autofocus={tone === 'danger' && !children ? true : undefined}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading} data-autofocus={tone === 'danger' ? undefined : true}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body && <div className="text-sm text-ink-2">{body}</div>}
      {children}
    </Modal>
  );
}

/* ------------------------------- Tabs ------------------------------- */
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('flex gap-1 overflow-x-auto border-b border-line', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx('relative -mb-px flex items-center gap-2 whitespace-nowrap px-3 py-2.5 text-sm font-semibold transition-colors', value === t.id ? 'text-ink' : 'text-muted hover:text-ink')}
        >
          {t.label}
          {t.count !== undefined && <span className="tabular rounded-full bg-surface-2 px-1.5 text-[11px] text-ink-2">{t.count}</span>}
          <span aria-hidden className={cx('absolute inset-x-2 bottom-0 h-[3px] origin-left rounded-full bg-ink transition-transform duration-300', value === t.id ? 'scale-x-100' : 'scale-x-0')} />
        </button>
      ))}
    </div>
  );
}

/* ------------------------------- Table ------------------------------- */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ children, className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cx('border-b border-line bg-surface-2/60 px-4 py-2.5 text-left text-[12px] font-semibold uppercase tracking-wide text-muted', className)} {...p}>
    {children}
  </th>
);
export const Td = ({ children, className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cx('border-b border-line px-4 py-3 align-middle', className)} {...p}>
    {children}
  </td>
);

export function ProgressBar({ value, max = 100, tone = 'accent', className, label }: { value: number; max?: number; tone?: 'accent' | 'warn' | 'danger' | 'ok' | 'info'; className?: string; label?: string }) {
  const p = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  const color = { accent: 'bg-accent', warn: 'bg-warn', danger: 'bg-danger', ok: 'bg-ok', info: 'bg-info' }[tone];
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)} role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cx('h-full rounded-full transition-all', color)} style={{ width: `${p}%` }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{children}</kbd>;
}
