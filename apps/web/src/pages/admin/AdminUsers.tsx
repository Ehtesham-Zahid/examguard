import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, KeyRound, Pencil, Search, Upload, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import type { Role } from '@/lib/types';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Input, Modal, PageHeader, Spinner, Table, Tabs, Td, Th } from '@/components/ui';
import { Avatar, IconBtn, Pager, SecretReveal, useDebounced } from '@/components/setup/shared';
import { CreateUserModal, EditUserModal, ROLE_LABEL, ROLE_TONE } from '@/components/setup/UserForms';
import { CandidateImport } from '@/components/setup/CandidateImport';
import type { UserRow } from '@/components/setup/types';

const PAGE = 25;
type RoleFilter = 'ALL' | Role;

export default function AdminUsers() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<RoleFilter>('ALL');
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim());
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [toggling, setToggling] = useState<UserRow | null>(null);
  const [secret, setSecret] = useState<{ user: UserRow; password: string } | null>(null);

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE) });
  if (q) params.set('search', q);
  if (role !== 'ALL') params.set('role', role);
  const list = useQuery({ queryKey: ['users', 'admin', q, role, page], queryFn: () => api<{ items: UserRow[]; total: number }>(`/users?${params}`), placeholderData: keepPreviousData });
  const overview = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<{ users: Partial<Record<Role, number>> }>('/users/admin/overview') });
  const counts = overview.data?.users ?? {};

  const reset = useMutation({
    mutationFn: (u: UserRow) => api<{ temporaryPassword: string }>(`/users/${u.id}/reset-password`, { method: 'POST' }),
    onSuccess: (r, u) => {
      setResetting(null);
      setSecret({ user: u, password: r.temporaryPassword });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const toggle = useMutation({
    mutationFn: (u: UserRow) => api(`/users/${u.id}`, { method: 'PATCH', body: { status: u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' } }),
    onSuccess: (_r, u) => {
      toast.success(u.status === 'ACTIVE' ? `${u.name} disabled and signed out` : `${u.name} re-enabled`);
      setToggling(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const total = (counts.ADMIN ?? 0) + (counts.EXAMINER ?? 0) + (counts.CANDIDATE ?? 0);

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Users & roles"
        subtitle="Create accounts, assign roles, reset access and bulk-import candidate cohorts."
        actions={
          <>
            <Button variant="outline" icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>
              Import candidates
            </Button>
            <Button icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>
              New user
            </Button>
          </>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-line px-5 pt-4 sm:flex-row sm:items-end sm:justify-between">
          <Tabs<RoleFilter>
            className="border-b-0"
            value={role}
            onChange={(r) => {
              setRole(r);
              setPage(1);
            }}
            tabs={[
              { id: 'ALL', label: 'Everyone', count: overview.data ? total : undefined },
              { id: 'CANDIDATE', label: 'Candidates', count: counts.CANDIDATE },
              { id: 'EXAMINER', label: 'Examiners', count: counts.EXAMINER },
              { id: 'ADMIN', label: 'Admins', count: counts.ADMIN },
            ]}
          />
          <div className="relative pb-3 sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" aria-hidden />
            <Input
              type="search"
              aria-label="Search users by name or email"
              placeholder="Search name or email"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        {list.isLoading ? (
          <Spinner label="Loading users" />
        ) : list.isError ? (
          <div className="p-5">
            <ErrorBox error={list.error} onRetry={() => list.refetch()} />
          </div>
        ) : !list.data?.items.length ? (
          <EmptyState icon={<Users className="size-6" />} title={q ? `No users match “${q}”` : 'No users yet'} body={q ? 'Try a different name or email.' : 'Create the first account or import a cohort of candidates.'} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>User</Th>
                  <Th>Role</Th>
                  <Th>Group</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className={list.isFetching ? 'opacity-70 transition' : undefined}>
                {list.data.items.map((u) => {
                  const self = u.id === me?.id;
                  const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
                  return (
                    <tr key={u.id} className="hover:bg-surface-2/50">
                      <Td>
                        <div className="flex items-center gap-3">
                          <Avatar name={u.name} />
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {u.name} {self && <span className="text-[12px] font-normal text-muted">(you)</span>}
                            </div>
                            <div className="truncate text-[13px] text-muted">{u.email}</div>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                      </Td>
                      <Td className="text-ink-2">{u.groupName ?? <span className="text-muted">—</span>}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {u.status === 'DISABLED' ? <Badge tone="danger">Disabled</Badge> : locked ? <Badge tone="warn">Locked</Badge> : <Badge tone="ok">Active</Badge>}
                          {u.mustChangePassword && u.status === 'ACTIVE' && <Badge tone="neutral">Temp password</Badge>}
                        </div>
                      </Td>
                      <Td className="tabular whitespace-nowrap text-[13px] text-muted">{fmtDate(u.createdAt)}</Td>
                      <Td>
                        <div className="flex justify-end gap-1">
                          <IconBtn label={`Edit ${u.name}`} onClick={() => setEditing(u)}>
                            <Pencil className="size-4" />
                          </IconBtn>
                          {!self && (
                            <IconBtn label={`Reset password for ${u.name}`} onClick={() => setResetting(u)}>
                              <KeyRound className="size-4" />
                            </IconBtn>
                          )}
                          {!self && (
                            <IconBtn label={u.status === 'ACTIVE' ? `Disable ${u.name}` : `Enable ${u.name}`} onClick={() => setToggling(u)} danger={u.status === 'ACTIVE'}>
                              {u.status === 'ACTIVE' ? <Ban className="size-4" /> : <CheckCircle2 className="size-4" />}
                            </IconBtn>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pager page={page} pageSize={PAGE} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <CreateUserModal open={creating} onClose={() => setCreating(false)} />
      <EditUserModal user={editing} onClose={() => setEditing(null)} isSelf={editing?.id === me?.id} />
      <CandidateImport open={importing} onClose={() => setImporting(false)} />

      <ConfirmDialog
        open={!!resetting}
        onClose={() => setResetting(null)}
        onConfirm={() => resetting && reset.mutate(resetting)}
        loading={reset.isPending}
        title="Reset password?"
        confirmLabel="Reset password"
        body={
          <>
            <strong className="text-ink">{resetting?.name}</strong> will be signed out of every device and must choose a new password using the temporary one you’ll see next. Account lockouts are also cleared.
          </>
        }
      />
      <ConfirmDialog
        open={!!toggling}
        onClose={() => setToggling(null)}
        onConfirm={() => toggling && toggle.mutate(toggling)}
        loading={toggle.isPending}
        tone={toggling?.status === 'ACTIVE' ? 'danger' : 'primary'}
        title={toggling?.status === 'ACTIVE' ? 'Disable this account?' : 'Re-enable this account?'}
        confirmLabel={toggling?.status === 'ACTIVE' ? 'Disable account' : 'Enable account'}
        body={
          toggling?.status === 'ACTIVE' ? (
            <>
              <strong className="text-ink">{toggling?.name}</strong> will be signed out immediately and can’t sign in until re-enabled. Their exam history is kept.
            </>
          ) : (
            <>
              <strong className="text-ink">{toggling?.name}</strong> will be able to sign in again.
            </>
          )
        }
      />
      <Modal open={!!secret} onClose={() => setSecret(null)} title="Password reset" size="sm" footer={<Button onClick={() => setSecret(null)}>Done</Button>}>
        {secret && (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">
              Share this with <strong className="text-ink">{secret.user.name}</strong> through a trusted channel.
            </p>
            <SecretReveal label="Temporary password" value={secret.password} />
          </div>
        )}
      </Modal>
    </div>
  );
}

