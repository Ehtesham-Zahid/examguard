import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BookOpen, ClipboardCheck, FileQuestion, Gavel, GraduationCap, LayoutDashboard, LogOut, Menu, Moon, ScrollText, Search, Settings, ShieldCheck, Sun, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getSocket } from '@/lib/socket';
import { relative } from '@/lib/format';
import { cx, Kbd } from '@/components/ui';
import type { Role } from '@/lib/types';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}
const NAV: Record<Role, NavItem[]> = {
  ADMIN: [
    { to: '/admin', label: 'Overview', icon: <LayoutDashboard className="size-4" /> },
    { to: '/admin/users', label: 'Users & roles', icon: <Users className="size-4" /> },
    { to: '/examiner/exams', label: 'All examinations', icon: <ClipboardCheck className="size-4" /> },
    { to: '/examiner/questions', label: 'Question bank', icon: <FileQuestion className="size-4" /> },
    { to: '/examiner/disputes', label: 'Disputes', icon: <Gavel className="size-4" /> },
    { to: '/admin/audit', label: 'Audit log', icon: <ScrollText className="size-4" /> },
  ],
  EXAMINER: [
    { to: '/examiner', label: 'Dashboard', icon: <LayoutDashboard className="size-4" /> },
    { to: '/examiner/exams', label: 'Examinations', icon: <ClipboardCheck className="size-4" /> },
    { to: '/examiner/questions', label: 'Question bank', icon: <FileQuestion className="size-4" /> },
    { to: '/examiner/candidates', label: 'Candidates', icon: <Users className="size-4" /> },
    { to: '/examiner/disputes', label: 'Disputes', icon: <Gavel className="size-4" /> },
  ],
  CANDIDATE: [
    { to: '/candidate', label: 'My exams', icon: <BookOpen className="size-4" /> },
    { to: '/candidate/results', label: 'Results', icon: <GraduationCap className="size-4" /> },
    { to: '/candidate/disputes', label: 'Disputes', icon: <Gavel className="size-4" /> },
  ],
};

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-ink">
        <ShieldCheck className="size-[18px]" aria-hidden />
      </span>
      {!compact && <span className="display text-[19px] font-semibold tracking-tight">ExamGuard</span>}
    </span>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ items: { id: string; title: string; body: string; link: string | null; read: boolean; createdAt: string }[]; unread: number }>('/candidate/notifications'), refetchInterval: 60000 });
  useEffect(() => {
    const s = getSocket();
    const h = (n: { title: string; body: string }) => {
      toast(n.title, { description: n.body });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    };
    s.on('notification', h);
    return () => {
      s.off('notification', h);
    };
  }, [qc]);
  const markRead = async () => {
    await api('/candidate/notifications/read', { method: 'POST' });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-ink-2 hover:bg-surface-2" aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`} aria-expanded={open}>
        <Bell className="size-[18px]" />
        {!!data?.unread && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{data.unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-[min(360px,90vw)] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-sm font-semibold">Notifications</span>
              {!!data?.unread && (
                <button onClick={markRead} className="text-xs font-medium text-accent hover:underline">
                  Mark all read
                </button>
              )}
            </div>
            <ul className="max-h-96 overflow-y-auto">
              {!data?.items.length && <li className="px-4 py-8 text-center text-sm text-muted">You're all caught up.</li>}
              {data?.items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      setOpen(false);
                      if (n.link) nav(n.link);
                    }}
                    className={cx('flex w-full gap-3 border-b border-line px-4 py-3 text-left hover:bg-surface-2', !n.read && 'bg-accent-soft/40')}
                  >
                    <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-accent')} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{n.title}</span>
                      <span className="block truncate text-xs text-muted">{n.body}</span>
                      <span className="mt-0.5 block text-[11px] text-muted">{relative(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function CommandPalette({ items, open, onClose }: { items: NavItem[]; open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const all = useMemo(() => [...items, { to: '/settings', label: 'Settings & accessibility', icon: <Settings className="size-4" /> }], [items]);
  const list = all.filter((x) => x.label.toLowerCase().includes(q.toLowerCase()));
  useEffect(() => {
    if (open) {
      setQ('');
      setI(0);
    }
  }, [open]);
  if (!open) return null;
  const go = (to: string) => {
    nav(to);
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[15vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-2xl" role="dialog" aria-label="Command palette">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="size-4 text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setI(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setI((x) => Math.min(list.length - 1, x + 1));
              if (e.key === 'ArrowUp') setI((x) => Math.max(0, x - 1));
              if (e.key === 'Enter' && list[i]) go(list[i].to);
              if (e.key === 'Escape') onClose();
            }}
            placeholder="Jump to…"
            className="h-12 flex-1 bg-transparent text-sm outline-none"
            aria-label="Search pages"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-1.5">
          {list.map((x, idx) => (
            <li key={x.to}>
              <button onClick={() => go(x.to)} onMouseEnter={() => setI(idx)} className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm', idx === i ? 'bg-accent-soft text-accent' : 'text-ink-2')}>
                {x.icon}
                {x.label}
              </button>
            </li>
          ))}
          {!list.length && <li className="px-3 py-6 text-center text-sm text-muted">No matches</li>}
        </ul>
      </div>
    </div>
  );
}

export function AppShell() {
  const { user, logout, updatePrefs } = useAuth();
  const [mobile, setMobile] = useState(false);
  const [palette, setPalette] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => setMobile(false), [loc.pathname]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  if (!user) return null;
  const items = NAV[user.role];
  const dark = document.documentElement.dataset.theme !== 'light';
  const roleLabel = { ADMIN: 'Administrator', EXAMINER: 'Examiner', CANDIDATE: 'Candidate' }[user.role];

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Link to="/" aria-label="ExamGuard home">
          <Logo />
        </Link>
      </div>
      <div className="px-3">
        <button onClick={() => setPalette(true)} className="mb-4 flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-[13px] text-muted hover:border-line-strong">
          <Search className="size-4" /> Quick jump <span className="ml-auto"><Kbd>⌘K</Kbd></span>
        </button>
      </div>
      <ul className="flex-1 space-y-0.5 px-3">
        {items.map((it) => (
          <li key={it.to}>
            <NavLink
              to={it.to}
              end={it.to.split('/').length <= 2}
              className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition', isActive ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}
            >
              {it.icon}
              {it.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-line p-3">
        <NavLink to="/settings" className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2')}>
          <Settings className="size-4" /> Settings
        </NavLink>
        <div className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-ink-2">{user.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-xs text-muted">{roleLabel}</span>
          </span>
          <button
            onClick={async () => {
              await logout();
              nav('/login');
            }}
            className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-danger"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-full">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-line bg-bg lg:block">{sidebar}</aside>
      {mobile && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobile(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-bg shadow-2xl">
            <button className="absolute right-3 top-4 rounded-md p-1.5 hover:bg-surface-2" onClick={() => setMobile(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 hover:bg-surface-2 lg:hidden" onClick={() => setMobile(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <span className="lg:hidden">
            <Logo compact />
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => updatePrefs({ theme: dark ? 'light' : 'dark' })} className="rounded-lg p-2 text-ink-2 hover:bg-surface-2" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
              {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
            </button>
            <Notifications />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
      <CommandPalette items={items} open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
