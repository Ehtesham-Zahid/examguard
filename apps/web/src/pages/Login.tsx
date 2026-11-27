import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, BadgeCheck, CloudOff, Scale, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { errMsg } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';
import { Logo } from '@/layouts/AppShell';

const DEMO = [
  { role: 'Administrator', email: 'admin@examguard.test', password: 'Admin@123' },
  { role: 'Examiner', email: 'examiner@examguard.test', password: 'Examiner@123' },
  { role: 'Candidate', email: 'student@examguard.test', password: 'Student@123' },
];

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={loc.state?.from ?? '/'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const fe: typeof errors = {};
    if (!/^\S+@\S+\.\S+$/.test(email)) fe.email = 'Enter a valid email address';
    if (!password) fe.password = 'Enter your password';
    setErrors(fe);
    if (Object.keys(fe).length) return;
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
      nav(loc.state?.from ?? '/', { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-accent text-accent-ink lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="paper-grid absolute inset-0 opacity-[0.08]" aria-hidden />
        <div className="relative flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-accent-ink/15">
            <ShieldCheck className="size-5" />
          </span>
          <span className="display text-xl font-semibold">ExamGuard</span>
        </div>
        <div className="relative max-w-lg">
          <h1 className="display text-[44px] font-semibold leading-[1.05]">Examinations that are fair, secure and survive a power cut.</h1>
          <p className="mt-4 text-[17px] opacity-80">Create, conduct, monitor and grade online exams — with evidence-based integrity signals instead of invasive webcams.</p>
          <ul className="mt-8 space-y-4 text-[15px]">
            {[
              [<CloudOff key="a" className="size-5" />, 'Answers keep saving offline and sync when you reconnect — without extra time for anyone.'],
              [<Scale key="b" className="size-5" />, 'Randomised papers balanced to equal difficulty, with a fairness report to prove it.'],
              [<BadgeCheck key="c" className="size-5" />, 'Digitally signed result reports anyone can verify with a QR code.'],
            ].map(([icon, text], i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 opacity-90">{icon}</span>
                <span className="opacity-90">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm opacity-60">Technoverse 5.0 · Web-e-Thon</p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h2 className="display text-[30px] font-semibold">Sign in</h2>
          <p className="mt-1 text-[15px] text-ink-2">Use the account issued by your institution.</p>
          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            <Field label="Email" error={errors.email} required>
              {(id) => <Input id={id} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!errors.email} placeholder="you@university.edu" />}
            </Field>
            <Field label="Password" error={errors.password} required>
              {(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!errors.password} />}
            </Field>
            {error && (
              <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
                {error}
              </div>
            )}
            <Button type="submit" size="lg" className="w-full" loading={busy} icon={!busy && <ArrowRight className="size-4" />}>
              Sign in
            </Button>
          </form>

          <div className="mt-10 rounded-xl border border-dashed border-line-strong p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Demo accounts</p>
            <div className="mt-3 grid gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(d.password);
                    setErrors({});
                  }}
                  className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-left text-sm hover:bg-line"
                >
                  <span className="font-medium">{d.role}</span>
                  <span className="font-mono text-xs text-muted">{d.email}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="mt-6 text-center text-sm text-muted">
            Have a result report? <a href="/verify" className="font-medium text-accent hover:underline">Verify it here</a>
          </p>
        </div>
      </section>
    </div>
  );
}
