import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import type { Role } from '@/lib/types';
import { Button, Field, Input, Modal, Select } from '@/components/ui';
import { fieldErrors, SecretReveal } from './shared';
import type { UserRow } from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Administrator', EXAMINER: 'Examiner', CANDIDATE: 'Candidate' };
export const ROLE_TONE = { ADMIN: 'warn', EXAMINER: 'info', CANDIDATE: 'neutral' } as const;

export function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', role: 'CANDIDATE' as Role, groupName: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ user: UserRow; temporaryPassword?: string } | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ name: '', email: '', role: 'CANDIDATE', groupName: '' });
      setErrs({});
      setResult(null);
    }
  }, [open]);

  const m = useMutation({
    mutationFn: () => api<{ user: UserRow; temporaryPassword?: string }>('/users', { method: 'POST', body: { name: form.name.trim(), email: form.email.trim(), role: form.role, groupName: form.groupName.trim() || null } }),
    onSuccess: (r) => {
      setResult(r);
      toast.success(`Account created for ${r.user.name}`);
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['admin-overview'] });
    },
    onError: (e) => {
      const fe = fieldErrors(e);
      setErrs(fe);
      if (!Object.keys(fe).length) toast.error(errMsg(e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (form.name.trim().length < 2) fe.name = 'Name is too short';
    if (!EMAIL_RE.test(form.email.trim())) fe.email = 'Enter a valid email address';
    if (form.groupName.length > 60) fe.groupName = 'At most 60 characters';
    setErrs(fe);
    if (!Object.keys(fe).length) m.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={result ? 'Account created' : 'Create user'}
      description={result ? undefined : 'A temporary password is generated; the user must change it at first sign-in.'}
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="create-user" loading={m.isPending}>
              Create account
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            <strong className="text-ink">{result.user.name}</strong> ({result.user.email}) can now sign in as {ROLE_LABEL[result.user.role].toLowerCase()}.
          </p>
          <p className="text-sm text-ink-2">A welcome email with a link to set their own password is on its way (valid for 7 days).</p>
          {result.temporaryPassword && <SecretReveal label="Temporary password (if email can’t reach them)" value={result.temporaryPassword} />}
        </div>
      ) : (
        <form id="create-user" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Full name" required error={errs.name} className="sm:col-span-2">
            {(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} invalid={!!errs.name} autoComplete="off" />}
          </Field>
          <Field label="Email" required error={errs.email} className="sm:col-span-2">
            {(id) => <Input id={id} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} invalid={!!errs.email} autoComplete="off" />}
          </Field>
          <Field label="Role" required>
            {(id) => (
              <Select id={id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                <option value="CANDIDATE">Candidate</option>
                <option value="EXAMINER">Examiner</option>
                <option value="ADMIN">Administrator</option>
              </Select>
            )}
          </Field>
          <Field label="Group / cohort" error={errs.groupName} hint="Optional. Used to enrol a whole class at once.">
            {(id) => <Input id={id} value={form.groupName} onChange={(e) => setForm({ ...form, groupName: e.target.value })} placeholder="e.g. CS-2026-A" />}
          </Field>
        </form>
      )}
    </Modal>
  );
}

export function EditUserModal({ user, onClose, isSelf }: { user: UserRow | null; onClose: () => void; isSelf: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', role: 'CANDIDATE' as Role, status: 'ACTIVE' as 'ACTIVE' | 'DISABLED', groupName: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (user) setForm({ name: user.name, role: user.role, status: user.status, groupName: user.groupName ?? '' });
    setErrs({});
  }, [user]);

  const m = useMutation({
    mutationFn: () => api(`/users/${user!.id}`, { method: 'PATCH', body: { name: form.name.trim(), role: form.role, status: form.status, groupName: form.groupName.trim() || null } }),
    onSuccess: () => {
      toast.success('User updated');
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['admin-overview'] });
      qc.invalidateQueries({ queryKey: ['groups'] });
      onClose();
    },
    onError: (e) => {
      const fe = fieldErrors(e);
      setErrs(fe);
      if (!Object.keys(fe).length) toast.error(errMsg(e));
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (form.name.trim().length < 2) fe.name = 'Name is too short';
    setErrs(fe);
    if (!Object.keys(fe).length) m.mutate();
  };
  const roleChanged = user && form.role !== user.role;

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title="Edit user"
      description={user?.email}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-user" loading={m.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-user" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Full name" required error={errs.name} className="sm:col-span-2">
          {(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} invalid={!!errs.name} />}
        </Field>
        <Field label="Role" hint={isSelf ? 'You cannot change your own role.' : roleChanged ? 'Changing the role signs the user out everywhere.' : undefined}>
          {(id) => (
            <Select id={id} value={form.role} disabled={isSelf} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="CANDIDATE">Candidate</option>
              <option value="EXAMINER">Examiner</option>
              <option value="ADMIN">Administrator</option>
            </Select>
          )}
        </Field>
        <Field label="Status" hint={isSelf ? 'You cannot disable your own account.' : undefined}>
          {(id) => (
            <Select id={id} value={form.status} disabled={isSelf} onChange={(e) => setForm({ ...form, status: e.target.value as 'ACTIVE' | 'DISABLED' })}>
              <option value="ACTIVE">Active</option>
              <option value="DISABLED">Disabled</option>
            </Select>
          )}
        </Field>
        <Field label="Group / cohort" className="sm:col-span-2" hint="Leave empty to remove from a group.">
          {(id) => <Input id={id} value={form.groupName} onChange={(e) => setForm({ ...form, groupName: e.target.value })} maxLength={60} />}
        </Field>
      </form>
    </Modal>
  );
}
