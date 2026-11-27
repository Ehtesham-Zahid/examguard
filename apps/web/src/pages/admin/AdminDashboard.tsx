import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowRight, ClipboardCheck, FileQuestion, Gavel, Radio, ScrollText, ShieldAlert, ShieldCheck, UserCog, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Card, CardHeader, cx, ErrorBox, PageHeader, Spinner, Stat } from '@/components/ui';

interface Overview {
  users: Partial<Record<'ADMIN' | 'EXAMINER' | 'CANDIDATE', number>>;
  exams: number;
  liveExams: number;
  activeAttempts: number;
  openIncidents: number;
  openDisputes: number;
  auditChain: { valid: boolean; total: number; brokenAt?: number };
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<Overview>('/users/admin/overview'), refetchInterval: 30000 });

  return (
    <div>
      <PageHeader eyebrow="Administration" title={`Good ${greeting()}, ${(user?.name ?? 'admin').replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, '').split(' ')[0]}`} subtitle="Platform health at a glance — people, live activity, and the integrity of the audit trail." />
      {q.isLoading ? (
        <Spinner label="Loading overview" />
      ) : q.isError ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : (
        q.data && <Body d={q.data} />
      )}
    </div>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
};

function Body({ d }: { d: Overview }) {
  const totalUsers = (d.users.ADMIN ?? 0) + (d.users.EXAMINER ?? 0) + (d.users.CANDIDATE ?? 0);
  const attention = d.openIncidents + d.openDisputes;
  return (
    <div className="space-y-6">
      <ChainBanner chain={d.auditChain} />

      <section aria-labelledby="live-h">
        <h2 id="live-h" className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted">
          Right now
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Live examinations" value={d.liveExams} tone={d.liveExams ? 'ok' : undefined} icon={<Radio className="size-4" />} hint={d.liveExams ? 'Window open now' : 'Nothing running'} />
          <Stat label="Active attempts" value={d.activeAttempts} tone={d.activeAttempts ? 'info' : undefined} icon={<Activity className="size-4" />} hint="Candidates writing (excl. sandbox)" />
          <Stat label="Open incidents" value={d.openIncidents} tone={d.openIncidents ? 'warn' : undefined} icon={<ShieldAlert className="size-4" />} hint="Integrity flags awaiting review" />
          <Stat label="Open disputes" value={d.openDisputes} tone={d.openDisputes ? 'danger' : undefined} icon={<Gavel className="size-4" />} hint="Open or under review" />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title="People" subtitle={`${totalUsers} accounts across three roles`} actions={<Link to="/admin/users" className="text-[13px] font-medium text-accent hover:underline">Manage users</Link>} />
          <div className="space-y-4 p-5">
            <RoleBar label="Candidates" value={d.users.CANDIDATE ?? 0} total={totalUsers} tone="bg-accent" />
            <RoleBar label="Examiners" value={d.users.EXAMINER ?? 0} total={totalUsers} tone="bg-info" />
            <RoleBar label="Administrators" value={d.users.ADMIN ?? 0} total={totalUsers} tone="bg-warn" />
            <div className="flex items-center justify-between border-t border-line pt-4 text-sm">
              <span className="text-ink-2">Examinations on the platform</span>
              <span className="tabular text-lg font-semibold">{d.exams}</span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Quick actions" subtitle={attention ? `${attention} item${attention === 1 ? '' : 's'} need a decision` : 'Everything is calm'} />
          <ul className="divide-y divide-line">
            <QuickLink to="/admin/users" icon={<UserCog className="size-4" />} title="Users & roles" body="Create accounts, reset passwords, import candidates" />
            <QuickLink to="/examiner/disputes" icon={<Gavel className="size-4" />} title="Disputes" body="Review candidate challenges" badge={d.openDisputes ? <Badge tone="danger">{d.openDisputes}</Badge> : undefined} />
            <QuickLink to="/examiner/exams" icon={<ClipboardCheck className="size-4" />} title="All examinations" body="Monitor, grade and publish" badge={d.liveExams ? <Badge tone="ok" dot>{d.liveExams} live</Badge> : undefined} />
            <QuickLink to="/examiner/questions" icon={<FileQuestion className="size-4" />} title="Question bank" body="Versioned questions across all examiners" />
            <QuickLink to="/admin/audit" icon={<ScrollText className="size-4" />} title="Audit log" body="Tamper-evident history of every action" />
          </ul>
        </Card>
      </div>
    </div>
  );
}

function ChainBanner({ chain }: { chain: Overview['auditChain'] }) {
  return (
    <Link
      to="/admin/audit"
      className={cx(
        'group flex flex-wrap items-center gap-4 rounded-xl border px-5 py-4 transition',
        chain.valid ? 'border-transparent bg-ok-soft hover:brightness-[0.98]' : 'border-danger/40 bg-danger-soft',
      )}
    >
      <span className={cx('grid size-10 place-items-center rounded-full', chain.valid ? 'bg-ok text-surface' : 'bg-danger text-white')} aria-hidden>
        {chain.valid ? <ShieldCheck className="size-5" /> : <AlertTriangle className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cx('font-semibold', chain.valid ? 'text-ok' : 'text-danger')}>{chain.valid ? 'Audit chain verified' : `Audit chain broken at entry #${chain.brokenAt}`}</div>
        <div className="text-[13px] text-ink-2">
          {chain.valid
            ? `All ${chain.total.toLocaleString()} entries re-hashed and linked correctly — no record has been altered or removed.`
            : 'A record was modified or deleted outside the application. Every entry after it is now untrusted.'}
        </div>
      </div>
      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 group-hover:text-ink">
        View log <ArrowRight className="size-4" aria-hidden />
      </span>
    </Link>
  );
}

function RoleBar({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const p = total ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2">
          <Users className="size-3.5 text-muted" aria-hidden /> {label}
        </span>
        <span className="tabular font-semibold">{value.toLocaleString()}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className={cx('h-full rounded-full', tone)} style={{ width: `${Math.max(p, value ? 2 : 0)}%` }} />
      </div>
    </div>
  );
}

function QuickLink({ to, icon, title, body, badge }: { to: string; icon: ReactNode; title: string; body: string; badge?: ReactNode }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 px-5 py-3 transition hover:bg-surface-2">
        <span className="rounded-lg bg-surface-2 p-2 text-ink-2">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block truncate text-[13px] text-muted">{body}</span>
        </span>
        {badge}
        <ArrowRight className="size-4 text-muted" aria-hidden />
      </Link>
    </li>
  );
}
