import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, BadgeCheck, CloudOff, Scale, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { errMsg } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';
import { Logo } from '@/layouts/AppShell';
import { useThemeMode } from '@/lib/theme';
import CursorGrid from '@/components/bits/CursorGrid';
import RotatingText from '@/components/bits/RotatingText';

const DEMO = [
  { role: 'Administrator', email: 'admin@examify.test', password: 'Admin@123' },
  { role: 'Examiner', email: 'examiner@examify.test', password: 'Examiner@123' },
  { role: 'Candidate', email: 'student@examify.test', password: 'Student@123' },
];

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  // landing-page role cards link here with ?as=admin|examiner|candidate to prefill that demo account
  const preset = DEMO.find((d) => d.role.toLowerCase().startsWith(new URLSearchParams(window.location.search).get('as') ?? '_'));
  const [email, setEmail] = useState(preset?.email ?? '');
  const [password, setPassword] = useState(preset?.password ?? '');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const mode = useThemeMode();
  const dark = mode !== 'light';
  const home = (u: { role: string }) => ({ ADMIN: '/admin', EXAMINER: '/examiner', CANDIDATE: '/candidate' })[u.role] ?? '/';
  if (user) return <Navigate to={loc.state?.from ?? home(user)} replace />;

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
      const u = await login(email.trim(), password);
      nav(loc.state?.from ?? home(u), { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    // One composition on one sheet of graph paper: the story and the sign-in card sit side by side, centred,
    // instead of two separately-coloured halves with an empty band between them.
    <div className="relative min-h-full overflow-hidden bg-surface">
      <div aria-hidden className="grid-paper absolute inset-0 lg:hidden" />
      {/* React Bits CursorGrid: the graph paper lights up in highlighter yellow under the cursor */}
      <CursorGrid className="!absolute inset-0 hidden lg:block" cellSize={28} color="#F7E64A" gridColor={mode === 'contrast' ? '#333333' : dark ? '#25395A' : '#D6E8F5'} gridOpacity={1} radius={85} maxOpacity={0.8} fillOpacity={0.5} falloff="smooth" holdTime={250} fadeDuration={700} clickPulse lightMode={!dark} />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-3 hidden w-[1.5px] bg-margin/50 sm:left-6 lg:block" />
      <div className="pointer-events-none relative mx-auto flex min-h-dvh max-w-[1440px] flex-col px-5 py-8 sm:px-8 lg:py-10 lg:pl-12 lg:pr-10">
        <header className="pointer-events-auto w-fit">
          <Logo to="/" />
        </header>
        <div className="flex flex-1 items-center py-8">
          <div className="grid w-full items-center gap-12 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-16 xl:gap-24">
            <div className="hidden lg:block">
              <p className="mb-5 font-mono text-[13px] font-semibold uppercase tracking-[0.16em] text-ink-2">Online exams, done properly</p>
              <h1 className="display text-[56px] font-bold leading-[1.02] text-ink xl:text-[72px] 2xl:text-[80px]">
                Exams that stay
                <br />
                <RotatingText
                  texts={['fair.', 'secure.', 'offline-proof.', 'verifiable.', 'calm.']}
                  mainClassName="inline-flex overflow-hidden rounded-md bg-hl px-2 text-hl-ink"
                  staggerFrom="last"
                  staggerDuration={0.025}
                  rotationInterval={2400}
                  splitLevelClassName="overflow-hidden pb-1"
                  transition={{ type: 'spring', damping: 30, stiffness: 400 }}
                />
              </h1>
              <p className="mt-6 max-w-xl text-[20px] leading-relaxed text-ink-2">Create, conduct, monitor and grade online exams, using integrity signals examiners can review instead of webcams.</p>
              <ul className="stagger mt-10 max-w-xl space-y-4 text-[17px] text-ink">
                {[
                  [<CloudOff key="a" className="size-5" />, 'Answers keep saving offline and sync later, without giving anyone extra time.'],
                  [<Scale key="b" className="size-5" />, 'Randomised papers balanced to equal difficulty, with a fairness report to prove it.'],
                  [<BadgeCheck key="c" className="size-5" />, 'Digitally signed result reports anyone can verify with a QR code.'],
                ].map(([icon, text], i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink">{icon}</span>
                    <span className="pt-1.5">{text}</span>
                  </li>
                ))}
              </ul>
            </div>

        <div className="page-enter pointer-events-auto mx-auto w-full max-w-[460px] rounded-2xl border border-line bg-surface p-7 shadow-[var(--shadow-lift)] sm:p-9">
          <h2 className="display text-[36px] font-bold"><span className="hl-swipe">Sign in</span></h2>
          <p className="mt-1.5 text-[16px] text-ink-2">Use the account issued by your institution.</p>
          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            <Field label="Email" error={errors.email} required>
              {(id) => <Input id={id} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!errors.email} placeholder="you@university.edu" />}
            </Field>
            <Field label="Password" error={errors.password} required>
              {(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!errors.password} />}
            </Field>
            <div className="-mt-2 flex justify-end">
              <Link to="/forgot-password" className="text-[13px] font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline">
                Forgot password?
              </Link>
            </div>
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
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-lg bg-surface-2 px-3 py-2 text-left text-sm hover:bg-line"
                >
                  <span className="font-medium">{d.role}</span>
                  <span className="min-w-0 break-all font-mono text-xs text-ink-2">{d.email}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="mt-6 text-center text-sm text-muted">
            Have a result report? <Link to="/verify" className="font-medium text-accent hover:underline">Verify it here</Link>
          </p>
        </div>
          </div>
        </div>
        <p className="hidden font-mono text-[13px] text-muted lg:block">Technoverse 5.0 · Web-e-Thon · move your cursor over the page ✎</p>
      </div>
    </div>
  );
}
