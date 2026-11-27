import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { KeyRound, LogOut, Mail, Palette } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api, errMsg, setAccessToken } from '@/lib/api';
import type { Prefs, User } from '@/lib/types';
import { Button, Card, CardHeader, cx, Field, Input, PageHeader, Toggle } from '@/components/ui';
import { localPrefs } from '@/lib/theme';

export function PreferenceControls({ prefs, onChange, compact }: { prefs: Prefs; onChange: (p: Prefs) => void; compact?: boolean }) {
  const opt = <K extends keyof Prefs>(k: K, v: Prefs[K], label: string) => (
    <button key={String(v)} type="button" onClick={() => onChange({ [k]: v } as Prefs)} aria-pressed={prefs[k] === v} className={cx('rounded-lg border px-3 py-2 text-sm transition', prefs[k] === v ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line hover:border-line-strong')}>
      {label}
    </button>
  );
  return (
    <div className={cx('grid gap-5', !compact && 'sm:grid-cols-2')}>
      <div>
        <div className="mb-2 text-[13px] font-medium text-ink-2">Theme</div>
        <div className="flex flex-wrap gap-2">{[opt('theme', 'light', 'Light'), opt('theme', 'dark', 'Dark'), opt('theme', 'contrast', 'High contrast'), opt('theme', 'system', 'System')]}</div>
      </div>
      <div>
        <div className="mb-2 text-[13px] font-medium text-ink-2">Reading font</div>
        <div className="flex flex-wrap gap-2">{[opt('font', 'default', 'Hyperlegible (default)'), opt('font', 'legible', 'Grotesk'), opt('font', 'dyslexic', 'Dyslexia-friendly'), opt('font', 'serif', 'Serif')]}</div>
      </div>
      <div>
        <label className="mb-2 flex justify-between text-[13px] font-medium text-ink-2">
          Text size <span className="tabular text-muted">{prefs.fontSize ?? 17}px</span>
        </label>
        <input type="range" min={13} max={26} value={prefs.fontSize ?? 17} onChange={(e) => onChange({ fontSize: Number(e.target.value) })} className="w-full accent-[var(--accent)]" aria-label="Text size" />
      </div>
      <div>
        <label className="mb-2 flex justify-between text-[13px] font-medium text-ink-2">
          Line spacing <span className="tabular text-muted">{(prefs.lineHeight ?? 1.65).toFixed(2)}</span>
        </label>
        <input type="range" min={1.3} max={2.2} step={0.05} value={prefs.lineHeight ?? 1.65} onChange={(e) => onChange({ lineHeight: Number(e.target.value) })} className="w-full accent-[var(--accent)]" aria-label="Line spacing" />
      </div>
      <div>
        <div className="mb-2 text-[13px] font-medium text-ink-2">Question navigator position</div>
        <div className="flex flex-wrap gap-2">{[opt('paletteSide', 'left', 'Left'), opt('paletteSide', 'right', 'Right'), opt('paletteSide', 'hidden', 'Hidden')]}</div>
      </div>
      <div>
        <div className="mb-2 text-[13px] font-medium text-ink-2">Question layout</div>
        <div className="flex flex-wrap gap-2">{[opt('layout', 'single', 'One per page'), opt('layout', 'scroll', 'All on one page')]}</div>
      </div>
      <div className={cx(!compact && 'sm:col-span-2')}>
        <Toggle checked={!!prefs.reduceMotion} onChange={(v) => onChange({ reduceMotion: v })} label="Reduce motion" description="Turns off animations and transitions." />
      </div>
    </div>
  );
}

/** Per-category email opt-outs; account & security emails are always sent. */
function EmailPreferences() {
  const { user, setUser } = useAuth();
  const [saving, setSaving] = useState<Set<string>>(new Set());
  if (!user) return null;
  const prefs = user.prefs ?? {};
  const candidate = user.role === 'CANDIDATE';
  const items: { key: 'emailExams' | 'emailResults' | 'emailDisputes'; label: string; description: string }[] = candidate
    ? [
        { key: 'emailExams', label: 'Exam schedule & reminders', description: 'When you’re enrolled (with a calendar invite), a reminder the day before, and when the exam opens.' },
        { key: 'emailResults', label: 'Results', description: 'When your results are published or a score changes after a review.' },
        { key: 'emailDisputes', label: 'Dispute decisions', description: 'When your examiner decides a dispute you raised.' },
      ]
    : [{ key: 'emailDisputes', label: 'New result disputes', description: 'When a candidate disputes a result on one of your exams.' }];
  const set = async (key: (typeof items)[number]['key'], v: boolean) => {
    setSaving((s) => new Set(s).add(key));
    try {
      const r = await api<{ prefs: Prefs }>('/auth/prefs', { method: 'PUT', body: { [key]: v } });
      setUser({ ...user, prefs: r.prefs });
      toast.success(v ? 'Emails turned on' : 'Emails turned off');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  };
  return (
    <Card className="mb-6">
      <CardHeader title={<span className="flex items-center gap-2"><Mail className="size-4" /> Email notifications</span>} subtitle={<>Sent to <strong className="text-ink">{user.email}</strong>. You’ll always see these in the app’s notification bell too.</>} />
      <div className="divide-y divide-line px-5">
        {items.map((i) => (
          <div key={i.key} className={cx('py-4', saving.has(i.key) && 'opacity-70')}>
            <Toggle checked={prefs[i.key] !== false} disabled={saving.has(i.key)} onChange={(v) => set(i.key, v)} label={i.label} description={i.description} />
          </div>
        ))}
        <p className="py-4 text-[13px] text-muted">Account and security emails — welcome links, password resets and password-change alerts — are always sent.</p>
      </div>
    </Card>
  );
}

export default function Settings() {
  const { user, setUser, updatePrefs, logout } = useAuth();
  const [params] = useSearchParams();
  const force = params.get('force') === '1' || user?.mustChangePassword;
  const nav = useNavigate();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const prefs = { ...localPrefs(), ...(user?.prefs ?? {}) };

  const change = async (e: FormEvent) => {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (!cur) fe.cur = 'Required';
    if (next.length < 8) fe.next = 'At least 8 characters';
    else if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) fe.next = 'Include at least one letter and one number';
    if (next !== confirm) fe.confirm = 'Passwords do not match';
    setErr(fe);
    if (Object.keys(fe).length) return;
    setBusy(true);
    try {
      const r = await api<{ accessToken: string; user: User }>('/auth/change-password', { body: { currentPassword: cur, newPassword: next } });
      setAccessToken(r.accessToken);
      setUser(r.user);
      toast.success('Password updated');
      setCur('');
      setNext('');
      setConfirm('');
      if (force) nav('/app');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle="Personalise how Examify looks and reads. Preferences are saved to your account and apply inside the exam workspace too." />
      {force && (
        <div role="alert" className="mb-6 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
          For your security, please set a new password before continuing.
        </div>
      )}
      {!force && (
        <Card className="mb-6">
          <CardHeader title={<span className="flex items-center gap-2"><Palette className="size-4" /> Appearance & accessibility</span>} />
          <div className="p-5">
            <PreferenceControls prefs={prefs} onChange={(p) => updatePrefs(p)} />
            <div className="exam-text mt-5 rounded-lg border border-line bg-surface-2 p-4">Preview: Which data structure follows the Last-In-First-Out principle?</div>
          </div>
        </Card>
      )}
      {!force && <EmailPreferences />}
      <Card className="mb-6">
        <CardHeader title={<span className="flex items-center gap-2"><KeyRound className="size-4" /> Change password</span>} />
        <form onSubmit={change} className="grid gap-4 p-5 sm:grid-cols-3" noValidate>
          <Field label="Current password" error={err.cur}>{(id) => <Input id={id} type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />}</Field>
          <Field label="New password" error={err.next} hint="8+ chars, a letter and a number">{(id) => <Input id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
          <Field label="Confirm new password" error={err.confirm}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
          <div className="sm:col-span-3">
            <Button type="submit" loading={busy}>Update password</Button>
          </div>
        </form>
      </Card>
      {!force && (
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><LogOut className="size-4" /> Sessions</span>} subtitle="Sign out everywhere if you used a shared or lost device." />
          <div className="p-5">
            <Button
              variant="outline"
              onClick={async () => {
                await api('/auth/logout-all', { method: 'POST' });
                await logout();
                toast.success('Signed out of all devices');
                nav('/login');
              }}
            >
              Sign out of all devices
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
