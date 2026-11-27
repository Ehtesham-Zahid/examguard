import { useEffect, useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarPlus, CheckCircle2, Mail, MailWarning, RefreshCw, RotateCcw, Search, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { fmtDate, relative } from '@/lib/format';
import { Badge, Button, Card, CardHeader, cx, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td, Th } from '@/components/ui';

type Status = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
interface Row {
  id: string;
  to: string;
  kind: string;
  category: 'exams' | 'results' | 'disputes' | 'account';
  subject: string;
  status: Status;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
  sendAfter: string;
  user: { name: string; role: string } | null;
}
interface ListResp {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<Status, number>;
  config: { configured: boolean; from: string; host: string; user: string | null; timeZone: string };
}
interface Detail extends Row {
  html: string;
  text: string;
  messageId: string | null;
  hasCalendarInvite: boolean;
  linkRedacted: boolean;
}

const KIND_LABEL: Record<string, string> = {
  exam_scheduled: 'Exam scheduled',
  exam_reminder: 'Exam reminder',
  exam_open: 'Exam open',
  exam_reopened: 'Exam reopened',
  results_published: 'Results published',
  score_updated: 'Score updated',
  dispute_decided: 'Dispute decided',
  dispute_raised: 'New dispute',
  welcome: 'Welcome',
  password_reset: 'Password reset (admin)',
  password_forgot: 'Forgot password',
  password_changed: 'Password changed',
  test: 'Test',
};
const STATUS: Record<Status, { label: string; tone: 'ok' | 'info' | 'warn' | 'danger' | 'neutral' }> = {
  SENT: { label: 'Sent', tone: 'ok' },
  PENDING: { label: 'Queued', tone: 'info' },
  SENDING: { label: 'Sending', tone: 'info' },
  FAILED: { label: 'Failed', tone: 'danger' },
  SKIPPED: { label: 'Not sent', tone: 'neutral' },
};
type Filter = 'all' | Status;

export default function AdminEmails() {
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [filter, category, query]);

  const params = new URLSearchParams({ page: String(page), pageSize: '25', ...(filter !== 'all' ? { status: filter } : {}), ...(category ? { category } : {}), ...(query ? { q: query } : {}) });
  const list = useQuery({
    queryKey: ['admin-emails', params.toString()],
    queryFn: () => api<ListResp>(`/admin/emails?${params}`),
    placeholderData: keepPreviousData,
    // keep the log live while anything is still in flight
    refetchInterval: (qq) => ((qq.state.data?.counts.PENDING ?? 0) + (qq.state.data?.counts.SENDING ?? 0) > 0 ? 3000 : 20000),
  });
  const d = list.data;
  const all = d ? Object.values(d.counts).reduce((a, b) => a + b, 0) : 0;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Email log"
        subtitle="Every email ExamGuard sends — exam schedules, reminders, results, dispute decisions and account links — with a preview of exactly what the recipient saw."
        actions={
          <Button variant="outline" icon={<RefreshCw className={cx('size-4', list.isFetching && 'animate-spin')} />} onClick={() => list.refetch()}>
            Refresh
          </Button>
        }
      />
      {d && <DeliveryCard cfg={d.config} />}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 pt-3">
          <Tabs
            value={filter}
            onChange={setFilter}
            tabs={[
              { id: 'all', label: 'All', count: all },
              { id: 'SENT', label: 'Sent', count: d?.counts.SENT },
              { id: 'PENDING', label: 'Queued', count: (d?.counts.PENDING ?? 0) + (d?.counts.SENDING ?? 0) },
              { id: 'FAILED', label: 'Failed', count: d?.counts.FAILED },
              { id: 'SKIPPED', label: 'Not sent', count: d?.counts.SKIPPED },
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-3 px-4 py-3">
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">Search recipient or subject</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipient or subject" className="pl-9" />
          </label>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Email type" className="w-auto">
            <option value="">All types</option>
            <option value="exams">Exam schedule & reminders</option>
            <option value="results">Results</option>
            <option value="disputes">Disputes</option>
            <option value="account">Account & security</option>
          </Select>
        </div>
        {list.isLoading && <Spinner />}
        {list.error && <ErrorBox error={list.error} onRetry={list.refetch} />}
        {d && !d.items.length && (
          <EmptyState icon={<Mail className="size-6" />} title={all ? 'No emails match these filters' : 'No emails yet'} body={all ? undefined : 'Emails appear here when exams are published, results go out, disputes are decided or accounts are created. Send a test email above to try it.'} />
        )}
        {d && d.items.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Recipient</Th>
                <Th>Email</Th>
                <Th>Status</Th>
                <Th className="text-right">Queued</Th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => setOpen(r.id)}>
                  <Td>
                    <div className="font-medium">{r.user?.name ?? r.to}</div>
                    <div className="font-mono text-[12px] text-muted">{r.to}</div>
                  </Td>
                  <Td className="max-w-[420px]">
                    <button type="button" className="block max-w-full truncate text-left font-medium hover:underline" onClick={(e) => (e.stopPropagation(), setOpen(r.id))}>
                      {r.subject}
                    </button>
                    <div className="text-[12px] text-muted">{KIND_LABEL[r.kind] ?? r.kind}</div>
                  </Td>
                  <Td>
                    <Badge tone={STATUS[r.status].tone} dot>
                      {STATUS[r.status].label}
                    </Badge>
                    {r.status !== 'SENT' && r.lastError && <div className="mt-1 max-w-[260px] truncate text-[12px] text-muted" title={r.lastError}>{r.lastError}</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-right text-[13px] text-ink-2" title={fmtDate(r.createdAt)}>
                    {relative(r.createdAt)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {d && pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
            <span className="text-muted">
              Page {page} of {pages} · {d.total} emails
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
      <EmailPreview id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function DeliveryCard({ cfg }: { cfg: ListResp['config'] }) {
  const qc = useQueryClient();
  const [to, setTo] = useState('');
  const [err, setErr] = useState('');
  const [sentId, setSentId] = useState<string | null>(null);
  const status = useQuery({ queryKey: ['admin-emails-status'], queryFn: () => api<{ check: { ok: boolean; error?: string } }>('/admin/emails/status'), enabled: cfg.configured, staleTime: 60_000 });
  const send = useMutation({
    mutationFn: () => api<{ id: string }>('/admin/emails/test', { body: { to: to.trim() } }),
    onSuccess: (r) => {
      setSentId(r.id);
      toast.success('Test email queued', { description: cfg.configured ? `Watch for it at ${to.trim()}` : 'Email isn’t configured yet, so it will be recorded but not delivered.' });
      qc.invalidateQueries({ queryKey: ['admin-emails'] });
    },
    onError: (e) => setErr(errMsg(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(to.trim())) return setErr('Enter a valid email address');
    setErr('');
    send.mutate();
  };
  const sent = useQuery({ queryKey: ['admin-email', sentId], queryFn: () => api<Detail>(`/admin/emails/${sentId}`), enabled: !!sentId, refetchInterval: (qq) => (qq.state.data && ['SENT', 'FAILED', 'SKIPPED'].includes(qq.state.data.status) ? false : 1500) });
  const ok = cfg.configured && status.data?.check.ok !== false;

  return (
    <Card className={cx('mb-6 overflow-hidden', !ok && 'border-warn/50')}>
      <div className="grid gap-0 lg:grid-cols-[1.2fr_1fr]">
        <div className="flex items-start gap-3 p-5">
          <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', ok ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn')}>{ok ? <CheckCircle2 className="size-5" aria-hidden /> : <MailWarning className="size-5" aria-hidden />}</span>
          <div className="min-w-0 text-sm">
            {cfg.configured ? (
              <>
                <div className="font-semibold">{status.data?.check.ok === false ? 'Email delivery has a problem' : 'Email delivery is on'}</div>
                <p className="mt-0.5 text-ink-2">
                  Sending as <strong className="text-ink">{cfg.from}</strong> via <span className="font-mono text-[12px]">{cfg.host}</span>. Times in emails use {cfg.timeZone}.
                </p>
                {status.data?.check.ok === false && (
                  <p role="alert" className="mt-2 flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-warn">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {status.data.check.error}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="font-semibold">Email delivery isn’t configured yet</div>
                <p className="mt-0.5 text-ink-2">
                  Emails are still created and previewable here, but nothing leaves the server. Set <code className="font-mono text-[12px]">SMTP_USER</code> (the Gmail address) and <code className="font-mono text-[12px]">SMTP_PASS</code> (a Google App Password) in the server environment, then retry anything you want delivered.
                </p>
              </>
            )}
            <p className="mt-2 text-[12px] text-muted">Demo accounts on <span className="font-mono">examguard.test</span> can never receive mail, so their emails show as “Not sent” — open one to see the preview.</p>
          </div>
        </div>
        <form onSubmit={submit} className="border-t border-line bg-surface-2/50 p-5 lg:border-l lg:border-t-0" noValidate>
          <Field label="Send a test email" error={err} hint="Use your own inbox to check delivery end to end.">
            {(id) => (
              <div className="flex gap-2">
                <Input id={id} type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@gmail.com" invalid={!!err} />
                <Button type="submit" loading={send.isPending} icon={<Send className="size-4" />}>
                  Send
                </Button>
              </div>
            )}
          </Field>
          {sent.data && (
            <p role="status" className="mt-2 flex items-center gap-2 text-[13px]">
              <Badge tone={STATUS[sent.data.status].tone} dot>
                {STATUS[sent.data.status].label}
              </Badge>
              <span className="truncate text-muted" title={sent.data.lastError ?? undefined}>
                {sent.data.status === 'SENT' ? `Delivered to ${sent.data.to}` : sent.data.lastError ?? 'Sending…'}
              </span>
            </p>
          )}
        </form>
      </div>
    </Card>
  );
}

function EmailPreview({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [view, setView] = useState<'html' | 'text'>('html');
  const q = useQuery({ queryKey: ['admin-email', id], queryFn: () => api<Detail>(`/admin/emails/${id}`), enabled: !!id });
  const retry = useMutation({
    mutationFn: () => api<{ id: string }>(`/admin/emails/${id}/retry`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(q.data?.status === 'SENT' ? 'A copy was queued' : 'Queued for delivery');
      qc.invalidateQueries({ queryKey: ['admin-emails'] });
      qc.invalidateQueries({ queryKey: ['admin-email', id] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const r = q.data;
  return (
    <Modal
      open={!!id}
      onClose={() => {
        setView('html');
        onClose();
      }}
      size="xl"
      title={r?.subject ?? 'Email'}
      description={r ? `To ${r.user?.name ? `${r.user.name} <${r.to}>` : r.to} · ${KIND_LABEL[r.kind] ?? r.kind}` : undefined}
      footer={
        r && (
          <>
            {r.status !== 'PENDING' && r.status !== 'SENDING' && !(r.linkRedacted && r.status === 'SENT') && !/reserved domain/.test(r.lastError ?? '') && (
              <Button variant="outline" icon={<RotateCcw className="size-4" />} loading={retry.isPending} onClick={() => retry.mutate()}>
                {r.status === 'SENT' ? 'Send again' : 'Retry delivery'}
              </Button>
            )}
            <Button onClick={onClose}>Close</Button>
          </>
        )
      }
    >
      {q.isLoading && <Spinner />}
      {q.error && <ErrorBox error={q.error} />}
      {r && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Badge tone={STATUS[r.status].tone} dot>
              {STATUS[r.status].label}
            </Badge>
            {r.sentAt && <span className="text-ink-2">Delivered {fmtDate(r.sentAt)}</span>}
            {!r.sentAt && <span className="text-ink-2">Queued {fmtDate(r.createdAt)}</span>}
            {r.attempts > 1 && <span className="text-muted">· {r.attempts} attempts</span>}
            {r.hasCalendarInvite && (
              <Badge tone="info">
                <CalendarPlus className="size-3.5" aria-hidden /> Calendar invite attached
              </Badge>
            )}
            <div className="ml-auto inline-flex rounded-lg border border-line p-0.5" role="group" aria-label="Preview format">
              {(['html', 'text'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cx('rounded-md px-2.5 py-1 text-[12px] font-semibold', view === v ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-surface-2')}>
                  {v === 'html' ? 'Designed' : 'Plain text'}
                </button>
              ))}
            </div>
          </div>
          {r.lastError && r.status !== 'SENT' && (
            <div role="note" className={cx('flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm', r.status === 'FAILED' ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-ink-2')}>
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {r.lastError}
            </div>
          )}
          {r.linkRedacted && <p className="text-[12px] text-muted">The one-time link in this email was removed from the log after delivery, so the preview shows a placeholder.</p>}
          {view === 'html' ? (
            // sandboxed: email HTML can't run scripts or touch the app
            <iframe title="Email preview" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={r.html} className="h-[62vh] w-full rounded-xl border border-line bg-white" />
          ) : (
            <pre className="h-[62vh] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface-2 p-4 font-mono text-[13px] leading-relaxed text-ink">{r.text}</pre>
          )}
        </div>
      )}
    </Modal>
  );
}
