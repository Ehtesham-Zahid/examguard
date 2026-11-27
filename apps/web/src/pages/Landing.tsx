import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BookOpenCheck,
  ChevronDown,
  ClipboardList,
  CloudOff,
  Eye,
  EyeOff,
  FileQuestion,
  Gavel,
  GraduationCap,
  Hand,
  Keyboard,
  Layers,
  Lock,
  Menu,
  Mic,
  Monitor,
  MousePointerClick,
  NotebookPen,
  Scale,
  ScrollText,
  Search,
  ShieldCheck,
  Upload,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { cx } from '@/components/ui';
import { Logo } from '@/layouts/AppShell';
import { useThemeMode } from '@/lib/theme';
import CursorGrid from '@/components/bits/CursorGrid';
import RotatingText from '@/components/bits/RotatingText';
import CountUp from '@/components/bits/CountUp';
import Magnet from '@/components/bits/Magnet';
import LogoLoop from '@/components/bits/LogoLoop';
import StickerPeel from '@/components/bits/StickerPeel';
import DecryptedText from '@/components/bits/DecryptedText';
import SpringCheck from '@/components/bits/SpringCheck';
import ClickSpark from '@/components/bits/ClickSpark';
import { FairnessPlot, HeroMock, OfflineDemo } from './landing/demos';
import { Reveal, SectionHead } from './landing/Reveal';

const HOME: Record<string, string> = { ADMIN: '/admin', EXAMINER: '/examiner', CANDIDATE: '/candidate' };

const MARQUEE = [
  [CloudOff, 'Offline autosave'],
  [Scale, 'Fair random papers'],
  [BadgeCheck, 'Signed result reports'],
  [Activity, 'Live proctoring'],
  [ScrollText, 'Tamper-evident audit log'],
  [Hand, 'Hold to submit'],
  [Gavel, 'Fair disputes'],
  [BarChart3, 'Question analytics'],
  [BookOpenCheck, 'Dyslexia-friendly fonts'],
  [Upload, 'CSV / JSON import'],
  [NotebookPen, 'Built-in scratchpad'],
  [Lock, 'One device per exam'],
] as const;

function PrimaryCta({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Magnet padding={60} magnetStrength={4} maxOffset={14}>
      <Link
        to={to}
        className="group inline-flex h-14 items-center gap-2 rounded-xl bg-accent px-7 text-[17px] font-bold text-accent-ink shadow-[0_3px_0_rgb(0_0_0/0.25)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_0_rgb(0_0_0/0.22)] active:translate-y-0 active:scale-[0.98]"
      >
        {children}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
      </Link>
    </Magnet>
  );
}

function Nav() {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 12);
    h();
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);
  const links = [
    ['#features', 'Features'],
    ['#resilience', 'Offline-proof'],
    ['#fairness', 'Fairness'],
    ['#integrity', 'Privacy'],
    ['#how', 'How it works'],
  ];
  return (
    <header className={cx('fixed inset-x-0 top-0 z-40 transition-all duration-300', scrolled ? 'border-b border-line bg-surface/90 shadow-[var(--shadow)] backdrop-blur' : 'bg-transparent')}>
      <nav className="mx-auto flex h-16 max-w-[1440px] items-center gap-6 px-5 sm:px-8 lg:px-10" aria-label="Main">
        <Link to="/" aria-label="ExamGuard home">
          <Logo />
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {links.map(([href, label]) => (
            <li key={href}>
              <a href={href} className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink">
                {label}
              </a>
            </li>
          ))}
        </ul>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Link to="/verify" className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">
            Verify a result
          </Link>
          {user ? (
            <Link to={HOME[user.role]} className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-bold text-accent-ink shadow-[0_2px_0_rgb(0_0_0/0.2)] hover:-translate-y-px">
              Open dashboard <ArrowRight className="size-4" />
            </Link>
          ) : (
            <Link to="/login" className="inline-flex h-10 items-center gap-2 rounded-lg bg-hl px-4 text-sm font-bold text-hl-ink shadow-[0_2px_0_rgb(23_42_70/0.25)] transition-all hover:-translate-y-px">
              Sign in
            </Link>
          )}
        </div>
        <button className="ml-auto rounded-lg p-2 hover:bg-surface-2 md:hidden" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>
      {open && (
        <div className="pop-in border-t border-line bg-surface px-4 py-3 md:hidden">
          {links.map(([href, label]) => (
            <a key={href} href={href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 font-semibold text-ink-2 hover:bg-surface-2">
              {label}
            </a>
          ))}
          <Link to="/verify" className="block rounded-lg px-3 py-2.5 font-semibold text-ink-2 hover:bg-surface-2">
            Verify a result
          </Link>
          <Link to={user ? HOME[user.role] : '/login'} className="mt-2 block rounded-lg bg-accent px-3 py-2.5 text-center font-bold text-accent-ink">
            {user ? 'Open dashboard' : 'Sign in'}
          </Link>
        </div>
      )}
    </header>
  );
}

function Hero() {
  const { user } = useAuth();
  const mode = useThemeMode();
  const dark = mode !== 'light';
  return (
    <section className="relative overflow-hidden pb-20 pt-28 sm:pt-32">
      <CursorGrid className="!absolute inset-0" cellSize={28} color="#F7E64A" gridColor={mode === 'contrast' ? '#333333' : dark ? '#1C3050' : '#E3EFF9'} gridOpacity={1} radius={90} maxOpacity={0.75} fillOpacity={0.45} falloff="smooth" holdTime={250} fadeDuration={800} lightMode={!dark} edgeFade={0.15} />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-3 w-[1.5px] bg-margin/50 sm:left-6" />
      <div className="pointer-events-none relative mx-auto grid max-w-[1440px] items-center gap-14 pl-8 pr-5 sm:pl-12 sm:pr-8 lg:pr-10 lg:grid-cols-[1.05fr_1fr]">
        <div className="pointer-events-auto">
          <div className="page-enter mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-2 shadow-[var(--shadow)]">
            <span className="size-1.5 rounded-full bg-ok pulse-dot" /> Secure examination management
          </div>
          <h1 className="display text-[42px] font-bold leading-[1.02] sm:text-[60px] lg:text-[60px] xl:text-[78px] 2xl:text-[88px]">
            Exams that are fair, secure and <span className="hl-swipe">survive a power cut.</span>
          </h1>
          <p className="page-enter mt-6 max-w-xl text-[21px] leading-relaxed text-ink-2" style={{ animationDelay: '0.15s' }}>
            Create, run, monitor and grade online exams in one place. ExamGuard keeps working through dropped connections, makes every random paper equally hard, and uses no webcam.
          </p>
          <div className="page-enter mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: '0.25s' }}>
            <PrimaryCta to={user ? HOME[user.role] : '/login'}>{user ? 'Open your dashboard' : 'Try the live demo'}</PrimaryCta>
            <a href="#resilience" className="inline-flex h-14 items-center gap-2 rounded-xl border-2 border-ink bg-surface px-5 text-[17px] font-bold transition-all hover:-translate-y-0.5 hover:bg-hl hover:text-hl-ink">
              <CloudOff className="size-4" /> See it go offline
            </a>
          </div>
          <div className="page-enter mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[16px] font-semibold text-ink-2" style={{ animationDelay: '0.35s' }}>
            <span>Built for</span>
            <RotatingText
              texts={['universities', 'schools', 'hackathons', 'certification bodies', 'coding bootcamps']}
              mainClassName="inline-flex overflow-hidden rounded-md bg-ink px-2 py-0.5 font-mono text-[15px] text-surface"
              staggerFrom="first"
              staggerDuration={0.02}
              rotationInterval={2200}
              splitLevelClassName="overflow-hidden"
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            />
          </div>
        </div>
        <div className="page-enter pointer-events-auto lg:pl-6 xl:[zoom:1.12] 2xl:[zoom:1.2]" style={{ animationDelay: "0.2s" }}>
          <HeroMock />
        </div>
      </div>
    </section>
  );
}

function Marquee() {
  return (
    <section aria-label="Highlights" className="border-y-2 border-ink bg-hl py-4 text-hl-ink">
      <LogoLoop
        logos={MARQUEE.map(([Icon, label]) => ({
          node: (
            <span className="inline-flex items-center gap-2 whitespace-nowrap font-mono text-[16px] font-bold uppercase tracking-wide">
              <Icon className="size-4" /> {label} <span className="ml-3 text-margin">✦</span>
            </span>
          ),
          title: label,
        }))}
        speed={60}
        gap={28}
        logoHeight={22}
        pauseOnHover
        fadeOut={false}
        ariaLabel="ExamGuard highlights"
      />
    </section>
  );
}

function Stats() {
  const items: [number, string, string][] = [
    [135, '', 'automated checks in the test suites'],
    [8, '/8', 'secondary features, all working'],
    [4, '', 'innovation challenges tackled'],
    [0, '', 'webcams, microphones or screen recordings'],
  ];
  return (
    <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-10">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([n, suf, label], i) => (
          <Reveal key={label} delay={i * 0.08} className="lift rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow)]">
            <div className="display text-[54px] font-bold leading-none">
              <CountUp to={n} duration={1.4} trigger="view" />
              <span className="text-muted">{suf}</span>
            </div>
            <div className="mt-2 text-[16px] text-ink-2">{label}</div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

const FEATURE_GROUPS: { title: string; tag: string; icon: typeof FileQuestion; items: [typeof FileQuestion, string, string][] }[] = [
  {
    title: 'Create',
    tag: 'for examiners',
    icon: FileQuestion,
    items: [
      [Layers, 'Versioned question bank', 'Topics, difficulty, three question types. Edits never change a paper someone already received.'],
      [Upload, 'Bulk import with a preview', 'CSV or JSON, with row-level errors before anything is saved.'],
      [Scale, 'Fair randomised papers', 'Describe the mix; every candidate gets a different, equally hard paper.'],
    ],
  },
  {
    title: 'Conduct',
    tag: 'for candidates',
    icon: GraduationCap,
    items: [
      [CloudOff, 'Works offline', 'Answers save on the device first and sync later. The server keeps the time.'],
      [NotebookPen, 'Scratchpad + calculator', 'Draw, jot notes and calculate without leaving the exam.'],
      [Keyboard, 'Your exam, your way', 'Dark mode, dyslexia-friendly fonts, text size, layout and keyboard shortcuts.'],
    ],
  },
  {
    title: 'Monitor',
    tag: 'live',
    icon: Monitor,
    items: [
      [Activity, 'Live dashboard', "See who's writing, offline or stuck, with time left and progress."],
      [ShieldCheck, 'Integrity signals', 'Tab switches, pastes, second screens: recorded for review, with clear warnings to the candidate.'],
      [ClipboardList, 'Pause, extend, announce', 'Pause everyone, extend one candidate, broadcast a correction.'],
    ],
  },
  {
    title: 'Evaluate',
    tag: 'with proof',
    icon: BarChart3,
    items: [
      [MousePointerClick, 'Auto + blind grading', 'Objective answers mark themselves; written ones are graded anonymously.'],
      [BarChart3, 'Question analytics', 'Difficulty, discrimination, distractors and skip rates for every question.'],
      [BadgeCheck, 'Signed PDF reports', 'Every result has a QR code anyone can verify. Edited copies fail.'],
    ],
  },
];

function Features() {
  return (
    <section id="features" className="scroll-mt-20 mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-10">
      <SectionHead eyebrow="Everything in one notebook" title={<>The whole exam, from <span className="hl">first question</span> to signed result.</>} sub="Built for administrators, examiners and candidates, with the parts that usually break (bad Wi-Fi, unfair papers, disputed marks) designed in from day one." />
      <div className="grid gap-5 md:grid-cols-2">
        {FEATURE_GROUPS.map((g, gi) => (
          <Reveal key={g.title} delay={gi * 0.08} className="group lift rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow)] hover:border-ink">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-accent text-accent-ink transition-transform group-hover:-rotate-6">
                <g.icon className="size-5" />
              </span>
              <h3 className="display text-2xl font-bold">
                <span className="bg-[length:0%_100%] bg-no-repeat transition-[background-size] duration-500 group-hover:bg-[length:100%_100%]" style={{ backgroundImage: 'linear-gradient(transparent 60%, var(--hl-wash) 60%)' }}>
                  {g.title}
                </span>
              </h3>
              <span className="ml-auto rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[12px] font-semibold text-ink-2">{g.tag}</span>
            </div>
            <ul className="space-y-4">
              {g.items.map(([Icon, t, d]) => (
                <li key={t} className="flex gap-3">
                  <Icon className="mt-0.5 size-5 shrink-0 text-margin" />
                  <div>
                    <div className="font-bold">{t}</div>
                    <div className="text-[16px] leading-relaxed text-ink-2">{d}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Resilience() {
  return (
    <section id="resilience" className="scroll-mt-20 border-y border-line bg-surface">
      <div className="mx-auto grid max-w-[1440px] items-center gap-12 px-5 py-20 sm:px-8 lg:px-10 lg:grid-cols-2">
        <div>
          <SectionHead eyebrow="Failure-resilient" title={<>Wi-Fi drops. Laptops die. <span className="hl">Nobody loses marks.</span></>} />
          <Reveal className="-mt-6 space-y-4 text-[18px] leading-relaxed text-ink-2">
            <p>Every answer is written to the candidate's device before it goes to the network, so a dropped connection or a refresh never loses work.</p>
            <p>The timer runs on the server. Answers written offline are accepted only if they were made before the deadline, so nobody gains extra time.</p>
            <p>
              If a laptop dies mid-exam, the examiner gets a <b className="text-ink">time-compensation request with the evidence</b>. Approving it reopens the attempt with exactly the time that was left, on any device.
            </p>
          </Reveal>
        </div>
        <Reveal delay={0.1}>
          <OfflineDemo />
        </Reveal>
      </div>
    </section>
  );
}

function Fairness() {
  return (
    <section id="fairness" className="scroll-mt-20 mx-auto grid max-w-[1440px] items-center gap-12 px-5 py-20 sm:px-8 lg:px-10 lg:grid-cols-2">
      <Reveal className="order-2 lg:order-1">
        <FairnessPlot />
      </Reveal>
      <div className="order-1 lg:order-2">
        <SectionHead eyebrow="Fairness of random papers" title={<>Different papers. <span className="hl">Same difficulty.</span></>} />
        <Reveal className="-mt-6 space-y-4 text-[18px] leading-relaxed text-ink-2">
          <p>Random papers stop copying, but pure chance can hand one student a much harder exam than the next.</p>
          <p>ExamGuard samples many papers that fit your blueprint and keeps the one closest to the target difficulty. Difficulty is recalibrated from real results, and a fairness report shows examiners the evidence.</p>
        </Reveal>
      </div>
    </section>
  );
}

function Integrity() {
  const watch = ['Leaving the exam tab or full screen', 'Copying, pasting and blocked shortcuts', 'A second monitor or developer tools', 'Text appearing in one burst (AI paste)', 'Machine-like typing rhythm', 'Near-identical written answers'];
  const [checked, setChecked] = useState<boolean[]>(watch.map(() => false));
  const [ref, setRef] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      watch.forEach((_, i) => setTimeout(() => setChecked((c) => c.map((v, j) => (j === i ? true : v))), 250 + i * 260));
    }, { threshold: 0.4 });
    io.observe(ref);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
  const never: [typeof Video, string][] = [
    [Video, 'No webcam'],
    [Mic, 'No microphone'],
    [EyeOff, 'No screen recording'],
    [Gavel, 'No hidden penalties'],
  ];
  return (
    <section id="integrity" className="scroll-mt-20 relative overflow-hidden border-y-2 border-ink bg-accent text-accent-ink">
      <div className="paper-grid pointer-events-none absolute inset-0 opacity-[0.07]" aria-hidden />
      <div className="relative mx-auto grid max-w-[1440px] gap-12 px-5 py-20 sm:px-8 lg:px-10 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <Reveal>
            <div className="mb-3 flex items-center gap-2 font-mono text-[13px] font-semibold uppercase tracking-[0.16em] opacity-80">
              <span className="h-[2px] w-6 rounded bg-margin" aria-hidden /> Integrity in the AI era
            </div>
            <h2 className="display text-[38px] font-bold leading-[1.08] sm:text-[48px]">Catches cheating, not students.</h2>
            <p className="mt-4 max-w-lg text-[19px] leading-relaxed opacity-85">Privacy-first signals that an examiner reviews. Candidates see the rules up front and get a clear warning every time. The only automatic step is the warning limit the examiner sets, and the candidate is told about it before starting.</p>
          </Reveal>
          <div ref={setRef} className="mt-8 grid gap-2 rounded-2xl bg-surface p-5 text-ink shadow-[6px_6px_0_var(--hl)] sm:grid-cols-2">
            <div className="col-span-full mb-1 flex items-center gap-2 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-muted">
              <Eye className="size-4" /> What we watch for
            </div>
            <ul className="sr-only">
              {watch.map((w) => <li key={w}>{w}</li>)}
            </ul>
            {watch.map((w, i) => (
              <div key={w} aria-hidden inert className="pointer-events-none"><SpringCheck checked={checked[i]} onChange={(v) => setChecked((c) => c.map((x, j) => (j === i ? v : x)))} label={w} color="var(--ink)" fillColor="var(--ink)" checkColor="var(--hl)" boxSize={18} boxRadius={5} fontSize={14} strike="none" doneOpacity={1} /></div>
            ))}
          </div>
        </div>
        <div className="relative flex flex-col justify-center">
          <Reveal className="grid grid-cols-2 gap-3">
            {never.map(([Icon, t], i) => (
              <div key={t} className="rounded-xl border border-accent-ink/20 bg-accent-ink/5 p-4" style={{ transitionDelay: `${i * 60}ms` }}>
                <span className="relative inline-grid size-10 place-items-center rounded-lg bg-accent-ink/10">
                  <Icon className="size-5" />
                  <span className="absolute h-[2px] w-9 rotate-[-35deg] rounded bg-margin" aria-hidden />
                </span>
                <div className="mt-3 font-bold">{t}</div>
              </div>
            ))}
          </Reveal>
          <p className="mt-4 text-[15px] opacity-70">Peel the sticker ↓ (it's draggable)</p>
          <div className="relative mt-2 h-44">
            <StickerPeel imageSrc="/sticker-no-webcam.svg" width={150} rotate={-8} peelBackHoverPct={20} peelBackActivePct={45} draggable shadowIntensity={0.5} lightingIntensity={0.15} initialPosition={{ x: 20, y: 0 }} />
          </div>
        </div>
      </div>
    </section>
  );
}

function How() {
  const steps: [typeof FileQuestion, string, string][] = [
    [FileQuestion, 'Build', 'Write or import questions, set the rules, pick a fixed list or a fair blueprint.'],
    [Users, 'Publish', 'Check the pre-flight list, enrol a whole class, preview it yourself in a sandbox.'],
    [Activity, 'Run', 'Watch it live. Answer device switches, pause for a fire drill, extend time with a reason.'],
    [BadgeCheck, 'Grade & publish', 'Blind-grade written answers, publish signed results, resolve disputes in the open.'],
  ];
  return (
    <section id="how" className="scroll-mt-20 mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-10">
      <SectionHead center eyebrow="How it works" title={<>Four steps. <span className="hl">No surprises.</span></>} />
      <div className="relative grid gap-6 md:grid-cols-4">
        <svg className="pointer-events-none absolute left-[12%] right-[12%] top-8 hidden h-2 w-[76%] md:block" preserveAspectRatio="none" viewBox="0 0 100 2" aria-hidden>
          <line x1="0" y1="1" x2="100" y2="1" stroke="var(--line-strong)" strokeWidth="2" className="dash-flow" vectorEffect="non-scaling-stroke" />
        </svg>
        {steps.map(([Icon, t, d], i) => (
          <Reveal key={t} delay={i * 0.12} className="relative text-center">
            <div className="relative mx-auto grid size-16 place-items-center rounded-full border-2 border-ink bg-surface shadow-[3px_3px_0_var(--ink)] transition-transform hover:-rotate-6 hover:scale-105">
              <Icon className="size-6" />
              <span className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full bg-hl font-mono text-[13px] font-bold text-hl-ink ring-2 ring-ink">{i + 1}</span>
            </div>
            <h3 className="display mt-5 text-xl font-bold">{t}</h3>
            <p className="mx-auto mt-2 max-w-[240px] text-[16px] leading-relaxed text-ink-2">{d}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Roles() {
  const roles: [typeof Users, string, string, string[]][] = [
    [ShieldCheck, 'Administrator', 'admin@examguard.test', ['Manage users and roles', 'Verify the audit chain', 'Oversee every exam']],
    [ClipboardList, 'Examiner', 'examiner@examguard.test', ['Build and publish exams', 'Monitor live attempts', 'Grade, publish, resolve disputes']],
    [GraduationCap, 'Candidate', 'student@examguard.test', ['Take exams anywhere', 'Flip open your result', 'Raise a dispute in two clicks']],
  ];
  return (
    <section className="border-y border-line bg-surface">
      <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-10">
        <SectionHead eyebrow="Try it yourself" title={<>Pick a seat and <span className="hl">look around.</span></>} sub="The demo is loaded with real-looking exams: one live now, one being graded, one with published results and an open dispute." />
        <div className="grid gap-5 md:grid-cols-3">
          {roles.map(([Icon, title, email, bullets], i) => (
            <Reveal key={title} delay={i * 0.1}>
              <Link to={`/login?as=${title.toLowerCase().slice(0, 5)}`} className="group lift flex h-full flex-col rounded-2xl border-2 border-line bg-bg p-6 hover:border-ink">
                <span className="grid size-12 place-items-center rounded-xl bg-hl text-hl-ink transition-transform group-hover:rotate-6">
                  <Icon className="size-6" />
                </span>
                <h3 className="display mt-4 text-2xl font-bold">{title}</h3>
                <p className="font-mono text-[13px] text-muted">{email}</p>
                <ul className="mt-4 flex-1 space-y-2 text-[16px] text-ink-2">
                  {bullets.map((b) => (
                    <li key={b} className="flex gap-2">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-margin" /> {b}
                    </li>
                  ))}
                </ul>
                <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold">
                  Sign in as {title.toLowerCase()} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function VerifyTeaser() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim()) nav(`/verify/${code.trim().toUpperCase()}`);
    else nav('/verify');
  };
  return (
    <section className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-10">
      <Reveal className="relative overflow-hidden rounded-3xl border-2 border-ink bg-surface p-8 shadow-[8px_8px_0_var(--ink)] sm:p-12">
        <div className="paper-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="relative grid items-center gap-8 md:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="mb-3 flex items-center gap-2 font-mono text-[13px] font-semibold uppercase tracking-[0.16em] text-ink-2">
              <span className="h-[2px] w-6 rounded bg-margin" aria-hidden /> Trust & disputes
            </div>
            <h2 className="display text-[36px] font-bold leading-tight sm:text-[46px]">
              Every result is <span className="hl">signed.</span> Check one in seconds.
            </h2>
            <p className="mt-3 text-[18px] text-ink-2">Employers and universities scan the QR code on a report, or type its code, to confirm it's genuine and unedited. Only initials, exam, score and date are shown.</p>
          </div>
          <form onSubmit={submit} className="rounded-2xl border border-line bg-bg p-5">
            <div className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-muted">Verification code</div>
            <div className="mt-2 font-mono text-2xl font-bold">
              <DecryptedText text="EG-7Q4K-22MX-PL" animateOn="view" sequential revealDirection="start" speed={55} encryptedClassName="text-muted" />
            </div>
            <div className="mt-4 flex gap-2">
              <label htmlFor="lv-code" className="sr-only">
                Verification code
              </label>
              <input id="lv-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="EG-XXXX-XXXX-XX" className="h-11 min-w-0 flex-1 rounded-lg border-2 border-line-strong bg-surface px-3 font-mono uppercase outline-none focus:border-ink" />
              <button className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-accent px-4 font-bold text-accent-ink transition-all hover:-translate-y-px active:scale-95">
                <Search className="size-4" /> Verify
              </button>
            </div>
          </form>
        </div>
      </Reveal>
    </section>
  );
}

function Faq() {
  const qs: [string, string][] = [
    ['Does ExamGuard use the webcam or microphone?', "No. Integrity comes from behavioural signals (tab switches, pastes, full-screen exits and similar) that an examiner reviews. Nothing is recorded from the camera, microphone or screen."],
    ['What happens if a student loses internet during the exam?', 'They keep working. Answers are stored on the device and sync automatically when the connection returns. The timer is controlled by the server, so going offline never adds time.'],
    ['How do you stop someone from getting an easier random paper?', 'Papers are generated from a topic × difficulty blueprint, and each one is balanced to the same expected difficulty. Examiners get a fairness report comparing it with pure random selection.'],
    ['Can results be faked?', 'Each published result is signed with an Ed25519 key. The public verify page checks the signature, so an edited PDF or invented code fails immediately.'],
    ['What if a student thinks a question was marked wrongly?', 'They raise a dispute from their result. The examiner must give a written reason, and an upheld dispute can re-grade every affected candidate. Every step is in a tamper-evident audit log.'],
    ['Is it accessible?', 'Yes: keyboard shortcuts throughout, screen-reader labels, high-contrast and dark modes, dyslexia-friendly fonts, adjustable text size and spacing, and reduced motion.'],
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="mx-auto max-w-4xl px-5 py-24 sm:px-8 lg:px-10">
      <SectionHead center eyebrow="Questions" title={<>Frequently <span className="hl">asked.</span></>} />
      <div className="space-y-3">
        {qs.map(([q, a], i) => (
          <Reveal key={q} delay={i * 0.04}>
            <div className={cx('overflow-hidden rounded-xl border-2 bg-surface transition-colors', open === i ? 'border-ink' : 'border-line hover:border-line-strong')}>
              <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-bold">
                {q}
                <ChevronDown className={cx('size-5 shrink-0 transition-transform duration-300', open === i && 'rotate-180')} />
              </button>
              <div className={cx('grid transition-[grid-template-rows] duration-300', open === i ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                <div className="overflow-hidden">
                  <p className="px-5 pb-5 text-[17px] leading-relaxed text-ink-2">{a}</p>
                </div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  const { user } = useAuth();
  return (
    <section className="px-5 pb-24 sm:px-8 lg:px-10">
      <Reveal className="relative mx-auto max-w-[1440px] overflow-hidden rounded-3xl bg-hl px-8 py-16 text-center text-hl-ink sm:py-20">
        <div className="paper-grid pointer-events-none absolute inset-0 opacity-25" aria-hidden />
        <div className="relative">
          <h2 className="display mx-auto max-w-3xl text-[44px] font-bold leading-[1.05] sm:text-[64px]">Ready when your students are.</h2>
          <p className="mx-auto mt-4 max-w-xl text-[19px] opacity-80">Sign in with a demo account and run a full exam: create it, sit it, watch it live and publish signed results.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Magnet padding={60} magnetStrength={4} maxOffset={14}>
              <Link to={user ? HOME[user.role] : '/login'} className="group inline-flex h-14 items-center gap-2 rounded-xl bg-[#172A46] px-7 text-[17px] font-bold text-white shadow-[0_3px_0_rgb(0_0_0/0.3)] transition-all hover:-translate-y-0.5">
                {user ? 'Open your dashboard' : 'Start the demo'} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </Magnet>
            <Link to="/verify" className="inline-flex h-14 items-center gap-2 rounded-xl border-2 border-[#172A46] px-5 text-[17px] font-bold text-[#172A46] transition-all hover:-translate-y-0.5 hover:bg-white/40">
              <BadgeCheck className="size-4" /> Verify a result
            </Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-5 py-8 sm:px-8 lg:px-10">
        <Logo />
        <p className="font-mono text-[13px] text-muted">Technoverse 5.0 · Web-e-Thon · Secure Examination Management System</p>
        <div className="flex gap-4 text-sm font-semibold text-ink-2">
          <Link to="/login" className="hover:text-ink">
            Sign in
          </Link>
          <Link to="/verify" className="hover:text-ink">
            Verify
          </Link>
          <a href="#features" className="hover:text-ink">
            Features
          </a>
        </div>
      </div>
    </footer>
  );
}

export default function Landing() {
  useEffect(() => {
    document.title = 'ExamGuard: fair, secure, offline-proof online exams';
    return () => {
      document.title = 'ExamGuard';
    };
  }, []);
  return (
    <ClickSpark sparkColor={['#E04F5F', '#F7E64A', '#5B8FD6']} sparkSize={9} sparkRadius={18} sparkCount={7} duration={380} shape="line" className="!h-auto">
      <div className="grid-paper min-h-full">
        <a href="#main-landing" className="skip-link">
          Skip to content
        </a>
        <Nav />
        <main id="main-landing">
          <Hero />
          <Marquee />
          <Stats />
          <Features />
          <Resilience />
          <Fairness />
          <Integrity />
          <How />
          <Roles />
          <VerifyTeaser />
          <Faq />
          <FinalCta />
        </main>
        <Footer />
      </div>
    </ClickSpark>
  );
}
