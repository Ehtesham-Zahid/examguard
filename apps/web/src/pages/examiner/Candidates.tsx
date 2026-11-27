import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, Upload, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Badge, Button, Card, cx, EmptyState, ErrorBox, Input, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { CandidateImport } from '@/components/setup/CandidateImport';
import { Avatar, Pager, useDebounced } from '@/components/setup/shared';
import type { Group, UserRow } from '@/components/setup/types';

const PAGE = 25;

export default function Candidates() {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const s = useDebounced(search.trim());

  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api<Group[]>('/users/groups') });
  const params = new URLSearchParams({ role: 'CANDIDATE', page: String(page), pageSize: String(PAGE) });
  if (s) params.set('search', s);
  if (group) params.set('group', group);
  const q = useQuery({ queryKey: ['users', 'candidates-dir', params.toString()], queryFn: () => api<{ items: UserRow[]; total: number }>(`/users?${params}`), placeholderData: keepPreviousData });

  const pickGroup = (g: string) => {
    setGroup(g);
    setPage(1);
  };
  const totalInGroups = groups.data?.reduce((a, g) => a + g.count, 0) ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Candidates"
        subtitle="Everyone who can be enrolled in your examinations. Import a class list to create accounts in one go."
        actions={
          <Button icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>
            Import candidates
          </Button>
        }
      />

      {groups.data && groups.data.length > 0 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by group">
          <GroupChip active={!group} onClick={() => pickGroup('')} label="All groups" />
          {groups.data.map((g) => (
            <GroupChip key={g.name} active={group === g.name} onClick={() => pickGroup(g.name)} label={g.name} count={g.count} />
          ))}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" aria-hidden />
            <Input
              type="search"
              aria-label="Search candidates by name or email"
              placeholder="Search name or email"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          {q.data && (
            <span className="tabular text-[13px] text-muted">
              {q.data.total} candidate{q.data.total === 1 ? '' : 's'}
              {group ? ` in ${group}` : totalInGroups ? ` · ${groups.data?.length} groups` : ''}
            </span>
          )}
        </div>

        {q.isLoading ? (
          <Spinner label="Loading candidates" />
        ) : q.isError ? (
          <div className="p-5">
            <ErrorBox error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : !q.data?.items.length ? (
          <EmptyState
            icon={<Users className="size-6" />}
            title={s || group ? 'No candidates match' : 'No candidates yet'}
            body={s || group ? 'Try another search or group.' : 'Import a CSV with name, email and group columns to create accounts.'}
            action={
              !s && !group ? (
                <Button icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>
                  Import candidates
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Candidate</Th>
                  <Th>Group</Th>
                  <Th>Account</Th>
                  <Th>Added</Th>
                </tr>
              </thead>
              <tbody className={cx(q.isFetching && 'opacity-70 transition')}>
                {q.data.items.map((u) => (
                  <tr key={u.id} className="hover:bg-surface-2/50">
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{u.name}</div>
                          <div className="truncate text-[13px] text-muted">{u.email}</div>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      {u.groupName ? (
                        <button type="button" onClick={() => pickGroup(u.groupName!)} className="rounded-full hover:ring-1 hover:ring-line-strong" aria-label={`Show group ${u.groupName}`}>
                          <Badge>{u.groupName}</Badge>
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                    <Td>
                      {u.status === 'DISABLED' ? <Badge tone="danger">Disabled</Badge> : u.mustChangePassword ? <Badge tone="warn">Awaiting first sign-in</Badge> : <Badge tone="ok">Active</Badge>}
                    </Td>
                    <Td className="tabular whitespace-nowrap text-[13px] text-muted">{fmtDate(u.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={page} pageSize={PAGE} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <CandidateImport open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}

function GroupChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cx('inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition', active ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-ink-2 hover:border-line-strong')}>
      {label}
      {count !== undefined && <span className="tabular text-[12px] text-muted">{count}</span>}
    </button>
  );
}
