import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, BadgeCheck, CloudOff, Scale, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { errMsg } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';
import { Logo } from '@/layouts/AppShell';
import CursorGrid from '@/components/bits/CursorGrid';
import RotatingText from '@/components/bits/RotatingText';

const DEMO = [
  { role: 'Administrator', email: 'admin@examguard.test', password: 'Admin@123' },
  { role: 'Examiner', email: 'examiner@examguard.test', password: 'Examiner@123' },
  { role: 'Candidate', email: 'student@examguard.test', password: 'Student@123' },
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
  const dark = document.documentElement.dataset.theme === 'dark';
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
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between">
        {/* React Bits CursorGrid: the graph paper lights up in highlighter yellow under the cursor */}
        <CursorGrid className="!absolute inset-0" cellSize={28} color="#F7E64A" gridColor={dark ? '#25395A' : '#D6E8F5'} gridOpacity={1} radius={85} maxOpacity={0.8} fillOpacity={0.5} falloff="smooth" holdTime={250} fadeDuration={700} clickPulse lightMode={!dark} />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-16 w-[1.5px] bg-margin/60" />
        <div className="pointer-events-none relative flex flex-1 flex-col justify-between py-12 pl-24 pr-12">
          <Logo />
          <div className="max-w-lg">
            <p className="mb-4 font-mono text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-2">Online exams, done properly</p>
            <h1 className="display text-[50px] font-bold leading-[1.02] text-ink">
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
            <p className="mt-5 max-w-md text-[17px] text-ink-2">Create, conduct, monitor and grade online exams, using integrity signals examiners can review instead of webcams.</p>
            <ul className="stagger mt-8 space-y-3.5 text-[15px] text-ink">
              {[
                [<CloudOff key="a" className="size-[18px]" />, 'Answers keep saving offline and sync later, without giving anyone extra time.'],
                [<Scale key="b" className="size-[18px]" />, 'Randomised papers balanced to equal difficulty, with a fairness report to prove it.'],
                [<BadgeCheck key="c" className="size-[18px]" />, 'Digitally signed result reports anyone can verify with a QR code.'],
              ].map(([icon, text], i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-accent text-accent-ink">{icon}</span>
                  <span className="pt-1">{text}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="font-mono text-[12px] text-muted">Technoverse 5.0 · Web-e-Thon · move your cursor over the page ✎</p>
        </div>
      </section>

      <section className="grid-paper flex items-center justify-center px-5 py-12">
        <div className="page-enter w-full max-w-[410px] rounded-2xl border border-line bg-surface p-7 shadow-[var(--shadow-lift)] sm:p-8">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h2 className="display text-[32px] font-bold"><span className="hl-swipe">Sign in</span></h2>
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
