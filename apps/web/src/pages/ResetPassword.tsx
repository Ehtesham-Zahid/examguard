import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, LinkIcon, WifiOff } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { Button, ButtonLink, Field, Input, Spinner } from '@/components/ui';
import { AuthCard } from './ForgotPassword';

interface TokenInfo {
  valid: boolean;
  purpose?: 'welcome' | 'reset' | 'forgot';
  name?: string;
  email?: string;
}

/** Landing page for the one-time links in welcome and password-reset emails. */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const info = useQuery({ queryKey: ['pw-token', token], queryFn: () => api<TokenInfo>(`/auth/password/token?token=${encodeURIComponent(token)}`), enabled: !!token, retry: false, staleTime: Infinity });
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errs, setErrs] = useState<{ pw?: string; confirm?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const fe: typeof errs = {};
    if (pw.length < 8) fe.pw = 'At least 8 characters';
    else if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) fe.pw = 'Include at least one letter and one number';
    if (pw !== confirm) fe.confirm = 'Passwords do not match';
    setErrs(fe);
    if (Object.keys(fe).length) return;
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; email: string }>('/auth/password/reset', { body: { token, password: pw } });
      setDone(r.email);
      toast.success('Password saved');
      // every session was signed out server-side; drop any stale one in this tab so "Sign in" really signs in
      if (user) await logout();
    } catch (e2) {
      setErrs({ form: errMsg(e2) });
    } finally {
      setBusy(false);
    }
  };

  if (token && info.isLoading)
    return (
      <AuthCard>
        <Spinner label="Checking your link" />
      </AuthCard>
    );

  if (done)
    return (
      <AuthCard>
        <div role="status">
          <span className="mb-5 grid size-12 place-items-center rounded-xl bg-ok-soft text-ok">
            <CheckCircle2 className="size-6" aria-hidden />
          </span>
          <h1 className="display text-[28px] font-bold">You're all set</h1>
          <p className="mt-2 text-[15px] text-ink-2">Your password was saved and every other device was signed out. Sign in with your new password.</p>
          <Button size="lg" className="mt-6 w-full" onClick={() => nav('/login', { replace: true })}>
            Go to sign in
          </Button>
        </div>
      </AuthCard>
    );

  if (token && info.isError)
    return (
      <AuthCard>
        <span className="mb-5 grid size-12 place-items-center rounded-xl bg-warn-soft text-warn">
          <WifiOff className="size-6" aria-hidden />
        </span>
        <h1 className="display text-[28px] font-bold">Couldn't check your link</h1>
        <p className="mt-2 text-[15px] text-ink-2">The server didn't answer in time (it may be waking up). Your link is probably still fine.</p>
        <Button size="lg" className="mt-6 w-full" onClick={() => info.refetch()} loading={info.isFetching}>
          Try again
        </Button>
      </AuthCard>
    );

  if (!token || !info.data?.valid)
    return (
      <AuthCard>
        <span className="mb-5 grid size-12 place-items-center rounded-xl bg-warn-soft text-warn">
          <LinkIcon className="size-6" aria-hidden />
        </span>
        <h1 className="display text-[28px] font-bold">This link has expired</h1>
        <p className="mt-2 text-[15px] text-ink-2">Password links work once and expire for your security. Request a fresh one and use the newest email.</p>
        <ButtonLink to="/forgot-password" size="lg" className="mt-6 w-full">
          Send a new link
        </ButtonLink>
        <Link to="/login" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Back to sign in
        </Link>
      </AuthCard>
    );

  const welcome = info.data.purpose === 'welcome';
  return (
    <AuthCard>
      <h1 className="display text-[30px] font-bold">
        <span className="hl-swipe">{welcome ? `Welcome, ${info.data.name}` : 'Choose a new password'}</span>
      </h1>
      <p className="mt-1 text-[15px] text-ink-2">
        {welcome ? 'Set a password to finish creating your account' : 'Set a new password for'} <strong className="text-ink">{info.data.email}</strong>.
      </p>
      <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
        <Field label="New password" error={errs.pw} hint="8+ characters with a letter and a number" required>
          {(id) => <Input id={id} type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} invalid={!!errs.pw} />}
        </Field>
        <Field label="Confirm password" error={errs.confirm} required>
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} invalid={!!errs.confirm} />}
        </Field>
        {errs.form && (
          <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
            {errs.form}
          </div>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {welcome ? 'Create my password' : 'Save new password'}
        </Button>
      </form>
    </AuthCard>
  );
}
