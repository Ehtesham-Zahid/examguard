import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';
import { Logo } from '@/layouts/AppShell';

/** Centered card on graph paper, shared by the password pages. */
export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid-paper grid min-h-dvh place-items-center px-5 py-12">
      <div className="page-enter w-full max-w-[430px] rounded-2xl border-2 border-ink bg-surface p-7 shadow-[6px_6px_0_var(--ink)] sm:p-8">
        <div className="mb-7">
          <Logo />
        </div>
        {children}
      </div>
    </main>
  );
}

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr('Enter a valid email address');
    setErr('');
    setBusy(true);
    try {
      await api('/auth/password/forgot', { body: { email: email.trim() } });
      setSent(true);
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard>
      {sent ? (
        <div role="status">
          <span className="mb-5 grid size-12 place-items-center rounded-xl bg-ok-soft text-ok">
            <MailCheck className="size-6" aria-hidden />
          </span>
          <h1 className="display text-[28px] font-bold">Check your inbox</h1>
          <p className="mt-2 text-[15px] text-ink-2">
            If <strong className="text-ink">{email.trim()}</strong> has an ExamGuard account, a link to reset the password is on its way. It works once and expires in 1 hour.
          </p>
          <p className="mt-4 text-sm text-muted">Nothing after a few minutes? Check spam, or ask your administrator to reset it for you.</p>
          <Button variant="outline" className="mt-6 w-full" onClick={() => setSent(false)}>
            Use a different email
          </Button>
        </div>
      ) : (
        <>
          <h1 className="display text-[30px] font-bold">
            <span className="hl-swipe">Forgot password?</span>
          </h1>
          <p className="mt-1 text-[15px] text-ink-2">Enter your account email and we'll send you a link to choose a new one.</p>
          <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
            <Field label="Email" error={err} required>
              {(id) => <Input id={id} type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!err} placeholder="you@university.edu" />}
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={busy}>
              Send reset link
            </Button>
          </form>
        </>
      )}
      <Link to="/login" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Back to sign in
      </Link>
    </AuthCard>
  );
}
