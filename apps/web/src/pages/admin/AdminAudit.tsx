import { Fragment, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, Link2, Link2Off, RefreshCw, ScrollText, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, relative } from '@/lib/format';
import type { Role } from '@/lib/types';
import { Badge, Button, Card, cx, EmptyState, ErrorBox, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';

interface Log {
  id: string;
  seq: number;
  actorId: string | null;
  actor: { id: string; name: string; role: Role } | null;
  action: string;
  entity: string;
  entityId: string | null;
  data: unknown;
  prevHash: string;
  hash: string;
  createdAt: string;
}
interface AuditResp {
  logs: Log[];
  chain: { valid: boolean; total: number; brokenAt?: number };
}

const ENTITIES = ['User', 'Exam', 'Question', 'Attempt', 'Dispute', 'Incident', 'System'];
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;
const actionTone = (a: string) =>
  /delete|force|locked|reject|close|disable/.test(a) ? 'danger' : /publish|create|import|restore/.test(a) ? 'ok' : /update|extend|accommodation|blueprint|pause|resume/.test(a) ? 'info' : 'neutral';

export default function AdminAudit() {
  const [entity, setEntity] = useState('');
  const [take, setTake] = useState(100);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const q = useQuery({
    queryKey: ['audit', entity, take],
    queryFn: () => api<AuditResp>(`/users/admin/audit?take=${take}${entity ? `&entity=${encodeURIComponent(entity)}` : ''}`),
    placeholderData: keepPreviousData,
  });

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const logs = q.data?.logs ?? [];
  // With no entity filter, rows are consecutive seq numbers — we can visibly show each link of the chain.
  const linked = useMemo(() => logs.map((l, i) => (entity ? null : logs[i + 1] ? logs[i + 1].hash === l.prevHash : null)), [logs, entity]);

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Audit log"
        subtitle="Every privileged action, append-only. Each entry stores the SHA-256 of the one before it, so altering or deleting any row breaks the chain from that point on."
        actions={
          <Button variant="outline" icon={<RefreshCw className={cx('size-4', q.isFetching && 'animate-spin')} />} onClick={() => q.refetch()}>
            Re-verify
          </Button>
        }
      />

      {q.data && <ChainStatus chain={q.data.chain} />}

      <Card className="mt-5">
        <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-4">
          <label className="flex w-44 flex-col gap-1.5 text-[13px] font-medium text-ink-2">
            Entity
            <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">All entities</option>
              {ENTITIES.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex w-36 flex-col gap-1.5 text-[13px] font-medium text-ink-2">
            Show
            <Select value={take} onChange={(e) => setTake(Number(e.target.value))}>
              {[50, 100, 250, 500].map((n) => (
                <option key={n} value={n}>
                  Latest {n}
                </option>
              ))}
            </Select>
          </label>
          <p className="ml-auto text-[13px] text-muted">{entity ? 'Filtered view — chain links are shown on the unfiltered log.' : 'Newest first. The link icon confirms each entry points at the hash of the entry before it.'}</p>
        </div>

        {q.isLoading ? (
          <Spinner label="Verifying chain" />
        ) : q.isError ? (
          <div className="p-5">
            <ErrorBox error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : !logs.length ? (
          <EmptyState icon={<ScrollText className="size-6" />} title="No entries" body={entity ? `Nothing has been recorded for ${entity} yet.` : 'Actions will appear here as people use the platform.'} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-10">
                  <span className="sr-only">Expand</span>
                </Th>
                <Th>Seq</Th>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Hash</Th>
                <Th>Prev hash</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => {
                const isOpen = open.has(l.id);
                const broken = q.data?.chain.brokenAt === l.seq;
                return (
                  <Fragment key={l.id}>
                    <tr className={cx('cursor-pointer hover:bg-surface-2/50', broken && 'bg-danger-soft', isOpen && 'bg-surface-2/40')} onClick={() => toggle(l.id)}>
                      <Td className="pr-0">
                        <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} details for entry ${l.seq}`} onClick={(e) => { e.stopPropagation(); toggle(l.id); }} className="rounded p-1 text-muted hover:text-ink">
                          {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                      </Td>
                      <Td className="tabular font-mono text-[13px] text-ink-2">#{l.seq}</Td>
                      <Td className="whitespace-nowrap">
                        <div className="tabular text-[13px]">{fmtDate(l.createdAt)}</div>
                        <div className="text-[12px] text-muted">{relative(l.createdAt)}</div>
                      </Td>
                      <Td>
                        {l.actor ? (
                          <div>
                            <div className="text-[13px] font-medium">{l.actor.name}</div>
                            <div className="text-[12px] lowercase text-muted">{l.actor.role}</div>
                          </div>
                        ) : (
                          <span className="text-[13px] text-muted">System</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={actionTone(l.action)} className="font-mono">
                          {l.action}
                        </Badge>
                      </Td>
                      <Td className="text-[13px]">
                        {l.entity}
                        {l.entityId && <span className="ml-1 font-mono text-[12px] text-muted">{l.entityId.slice(-6)}</span>}
                      </Td>
                      <Td className="font-mono text-[12px]" title={l.hash}>
                        {short(l.hash)}
                      </Td>
                      <Td className="font-mono text-[12px] text-muted" title={l.prevHash}>
                        <span className="inline-flex items-center gap-1.5">
                          {linked[i] === true && <Link2 className="size-3.5 text-ok" aria-label="Links to previous entry" />}
                          {linked[i] === false && <Link2Off className="size-3.5 text-danger" aria-label="Does not match previous entry" />}
                          {/^0+$/.test(l.prevHash) ? 'genesis' : short(l.prevHash)}
                        </span>
                      </Td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-surface-2/40">
                        <Td colSpan={8} className="pt-0">
                          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
                            <div>
                              <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Data</div>
                              <pre className="max-h-72 overflow-auto rounded-lg border border-line bg-surface p-3 font-mono text-[12px] leading-relaxed">{JSON.stringify(l.data, null, 2)}</pre>
                            </div>
                            <dl className="space-y-2 text-[12px]">
                              <div>
                                <dt className="font-semibold uppercase tracking-wide text-muted">Hash</dt>
                                <dd className="break-all font-mono">{l.hash}</dd>
                              </div>
                              <div>
                                <dt className="font-semibold uppercase tracking-wide text-muted">Previous hash</dt>
                                <dd className="break-all font-mono">{l.prevHash}</dd>
                              </div>
                              {l.entityId && (
                                <div>
                                  <dt className="font-semibold uppercase tracking-wide text-muted">Entity id</dt>
                                  <dd className="break-all font-mono">{l.entityId}</dd>
                                </div>
                              )}
                            </dl>
                          </div>
                        </Td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function ChainStatus({ chain }: { chain: AuditResp['chain'] }) {
  return (
    <div role="status" className={cx('flex items-start gap-3 rounded-xl px-5 py-4', chain.valid ? 'bg-ok-soft' : 'border border-danger/40 bg-danger-soft')}>
      {chain.valid ? <ShieldCheck className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden /> : <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />}
      <div className="text-sm">
        <div className={cx('font-semibold', chain.valid ? 'text-ok' : 'text-danger')}>{chain.valid ? 'Chain intact' : `Tampering detected at entry #${chain.brokenAt}`}</div>
        <div className="text-ink-2">
          {chain.valid
            ? `${chain.total.toLocaleString()} entries were re-hashed from the genesis block just now and every link matches.`
            : `Entry #${chain.brokenAt} does not hash to the value recorded — it, or one before it, was edited or removed directly in the database. ${chain.total.toLocaleString()} entries checked.`}
        </div>
      </div>
    </div>
  );
}
