import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, Clock, Laptop, MoreHorizontal, Send, Wifi, X } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { fmtTime, relative } from '@/lib/format';
import { Badge, Button, cx, Field, Input, Modal, Textarea } from '@/components/ui';
import { SeverityBadge } from '@/components/status';
import type { Compensation, Incident, IncidentStatus, Transfer } from './types';
import { deviceLabel, fmtSec } from './bits';

/** Invalidate everything an examiner action can affect. */
export function useInvalidateOps() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['monitor'] });
    qc.invalidateQueries({ queryKey: ['attempt'] });
    qc.invalidateQueries({ queryKey: ['results'] });
    qc.invalidateQueries({ queryKey: ['analytics'] });
  };
}

/* ------------------------------ extend time ------------------------------ */

export function ExtendTimeModal({ attemptId, name, open, onClose }: { attemptId: string; name: string; open: boolean; onClose: () => void }) {
  const [minutes, setMinutes] = useState('10');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const invalidate = useInvalidateOps();
  const m = Number(minutes);
  const minErr = !Number.isInteger(m) || m < 1 || m > 120 ? 'Whole minutes between 1 and 120' : null;
  const reasonErr = reason.trim().length < 3 ? 'Give a short reason (at least 3 characters) — it is shown in the audit log' : null;
  const mut = useMutation({
    mutationFn: () => api<{ deadline: string }>(`/staff/attempts/${attemptId}/extend`, { method: 'POST', body: { minutes: m, reason: reason.trim() } }),
    onSuccess: (r) => {
      toast.success(`Added ${m} min for ${name}`, { description: `New deadline ${fmtTime(r.deadline)}. The candidate was notified.` });
      invalidate();
      close();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const close = () => {
    setTouched(false);
    setReason('');
    setMinutes('10');
    onClose();
  };
  const submit = () => {
    setTouched(true);
    if (!minErr && !reasonErr) mut.mutate();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title={`Extend time for ${name}`}
      description="The extra minutes are added to this candidate's deadline only."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mut.isPending} icon={<Clock className="size-4" />}>
            Add {Number.isFinite(m) && m > 0 ? m : ''} min
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Minutes to add" required error={touched ? (minErr ?? undefined) : undefined}>
          {(id) => (
            <div className="flex flex-wrap items-center gap-2">
              <Input id={id} type="number" min={1} max={120} step={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="tabular w-24" invalid={touched && !!minErr} />
              {[5, 10, 15, 30].map((p) => (
                <button key={p} type="button" onClick={() => setMinutes(String(p))} aria-pressed={m === p} className={cx('tabular h-10 rounded-lg border px-3 text-sm', m === p ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line hover:border-line-strong')}>
                  +{p}
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field label="Reason" required error={touched ? (reasonErr ?? undefined) : undefined} hint="e.g. Approved accommodation, power cut in exam hall">
          {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="min-h-20" />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/* ------------------------------ force submit ------------------------------ */

export function ForceSubmitModal({ attemptId, name, open, onClose, onDone }: { attemptId: string; name: string; open: boolean; onClose: () => void; onDone?: () => void }) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const invalidate = useInvalidateOps();
  const err = reason.trim().length < 3 ? 'A reason is required (at least 3 characters)' : null;
  const mut = useMutation({
    mutationFn: () => api(`/staff/attempts/${attemptId}/force-submit`, { method: 'POST', body: { reason: reason.trim() } }),
    onSuccess: () => {
      toast.success(`${name}'s attempt was submitted`, { description: 'Everything they had saved so far will be graded.' });
      invalidate();
      setReason('');
      setTouched(false);
      onClose();
      onDone?.();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Force-submit this attempt?"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep writing
          </Button>
          <Button
            variant="danger"
            loading={mut.isPending}
            onClick={() => {
              setTouched(true);
              if (!err) mut.mutate();
            }}
          >
            Force submit
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong>{name}</strong> will be removed from the exam immediately and cannot continue. This cannot be undone.
          </span>
        </div>
        <Field label="Reason (recorded in the audit log)" required error={touched ? (err ?? undefined) : undefined}>
          {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="min-h-20" />}
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------ incidents ------------------------------ */

const REVIEW_OPTS: { id: Exclude<IncidentStatus, 'OPEN'>; label: string; hint: string }[] = [
  { id: 'REVIEWED', label: 'Reviewed — no concern', hint: 'You looked at it and it is explained.' },
  { id: 'DISMISSED', label: 'Dismiss', hint: 'False signal (e.g. notification, accidental key).' },
  { id: 'ESCALATED', label: 'Escalate', hint: 'Needs a formal integrity review. Not a verdict.' },
];
const STATUS_TONE: Record<IncidentStatus, 'warn' | 'ok' | 'neutral' | 'danger'> = { OPEN: 'warn', REVIEWED: 'ok', DISMISSED: 'neutral', ESCALATED: 'danger' };

export function IncidentStatusBadge({ s }: { s: IncidentStatus }) {
  return <Badge tone={STATUS_TONE[s]}>{s === 'OPEN' ? 'Needs review' : s.charAt(0) + s.slice(1).toLowerCase()}</Badge>;
}

export function IncidentReviewModal({ incident, onClose }: { incident: Incident | null; onClose: () => void }) {
  const [status, setStatus] = useState<Exclude<IncidentStatus, 'OPEN'>>('REVIEWED');
  const [note, setNote] = useState('');
  const invalidate = useInvalidateOps();
  const mut = useMutation({
    mutationFn: () => api(`/staff/incidents/${incident!.id}`, { method: 'PATCH', body: { status, note: note.trim() || undefined } }),
    onSuccess: () => {
      toast.success('Incident updated');
      invalidate();
      setNote('');
      setStatus('REVIEWED');
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Modal
      open={!!incident}
      onClose={onClose}
      title="Review integrity signal"
      description={incident ? `${incident.candidate ? incident.candidate + ' · ' : ''}${fmtTime(incident.createdAt)}` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mut.mutate()} loading={mut.isPending} variant={status === 'ESCALATED' ? 'danger' : 'primary'}>
            Save review
          </Button>
        </>
      }
    >
      {incident && (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-line bg-surface-2/50 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <SeverityBadge s={incident.severity} />
              <span className="text-sm font-medium">{incident.label}</span>
            </div>
            {incident.details && incident.details !== incident.label && <p className="mt-1 text-[13px] text-ink-2">{incident.details}</p>}
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-medium text-ink-2">Outcome</legend>
            {REVIEW_OPTS.map((o) => (
              <label key={o.id} className={cx('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5', status === o.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong')}>
                <input type="radio" name="incident-status" checked={status === o.id} onChange={() => setStatus(o.id)} className="mt-1 accent-[var(--accent)]" />
                <span>
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className="block text-xs text-muted">{o.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field label="Note (optional)">{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="min-h-16" />}</Field>
        </div>
      )}
    </Modal>
  );
}

export function IncidentItem({ i, onReview, showCandidate, href }: { i: Incident; onReview: (i: Incident) => void; showCandidate?: boolean; href?: string }) {
  return (
    <li className={cx('flex items-start gap-3 py-2.5', i.status !== 'OPEN' && 'opacity-70')}>
      <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', i.severity === 'HIGH' ? 'bg-danger' : i.severity === 'MEDIUM' ? 'bg-warn' : 'bg-line-strong')} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-ink">{i.label}</span>
          <SeverityBadge s={i.severity} />
          {i.status !== 'OPEN' && <IncidentStatusBadge s={i.status} />}
        </div>
        <div className="mt-0.5 text-[12px] text-muted">
          {showCandidate && i.candidate && (href ? <Link className="font-medium text-ink-2 hover:underline" to={href}>{i.candidate}</Link> : <span className="font-medium text-ink-2">{i.candidate}</span>)}
          {showCandidate && i.candidate && ' · '}
          <time dateTime={i.createdAt} title={new Date(i.createdAt).toLocaleString()}>
            {fmtTime(i.createdAt)} ({relative(i.createdAt)})
          </time>
        </div>
        {i.reviewNote && <p className="mt-1 text-[12px] italic text-ink-2">“{i.reviewNote}”</p>}
      </div>
      <Button size="sm" variant={i.status === 'OPEN' ? 'outline' : 'ghost'} onClick={() => onReview(i)} aria-label={`Review: ${i.label}${i.candidate ? ' — ' + i.candidate : ''}`}>
        {i.status === 'OPEN' ? 'Review' : <MoreHorizontal className="size-4" aria-hidden />}
      </Button>
    </li>
  );
}

/* ------------------------------ compensation & transfers ------------------------------ */

export function CompensationCard({ c, name, attemptStatus }: { c: Compensation; name: string; attemptStatus?: string }) {
  const invalidate = useInvalidateOps();
  const ev = c.evidence ?? {};
  const mut = useMutation({
    mutationFn: (approve: boolean) => api<{ ok: boolean; reopened: boolean }>(`/staff/compensations/${c.id}/decide`, { method: 'POST', body: { approve } }),
    onSuccess: (r, approve) => {
      toast.success(approve ? `Restored ${fmtSec(c.seconds)} to ${name}` : 'Compensation rejected', { description: r.reopened ? 'The attempt was reopened — the candidate has been notified.' : undefined });
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const decided = c.status !== 'PENDING';
  const status = attemptStatus ?? c.attempt?.status;
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Wifi className="size-4 text-warn" aria-hidden /> Lost time · {name}
        </div>
        {decided ? <Badge tone={c.status === 'APPROVED' ? 'ok' : 'neutral'}>{c.status.toLowerCase()}</Badge> : <Badge tone="warn">+{fmtSec(c.seconds)}</Badge>}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        The connection dropped{ev.gapStart ? ` at ${fmtTime(ev.gapStart)}` : ''} for <strong className="text-ink">{fmtSec(ev.gapSec ?? c.seconds)}</strong>. At that moment {name.split(' ')[0]} had <strong className="text-ink">{fmtSec(ev.remainingAtGapStartSec ?? 0)}</strong> left.{' '}
        {(ev.offlineAnswers ?? 0) === 0 ? (
          <>No answers were saved on the device during the outage, so they most likely could not work at all (device off or frozen, not just Wi-Fi).</>
        ) : (
          <>They saved {ev.offlineAnswers} answer(s) offline, so they kept working during part of the outage.</>
        )}{' '}
        Suggested: restore exactly <strong className="text-ink">{fmtSec(c.seconds)}</strong>.
      </p>
      {status === 'AUTO_SUBMITTED' && !decided && <p className="mt-1.5 text-[12px] font-medium text-warn">Their attempt was auto-submitted during the outage — approving reopens it with that time.</p>}
      {!decided && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" icon={<Check className="size-4" />} loading={mut.isPending && mut.variables === true} disabled={mut.isPending} onClick={() => mut.mutate(true)}>
            Approve
          </Button>
          <Button size="sm" variant="ghost" icon={<X className="size-4" />} loading={mut.isPending && mut.variables === false} disabled={mut.isPending} onClick={() => mut.mutate(false)}>
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}

export function TransferCard({ t, name, stale }: { t: Transfer; name: string; stale?: boolean }) {
  const invalidate = useInvalidateOps();
  const mut = useMutation({
    mutationFn: (approve: boolean) => api(`/staff/transfers/${t.id}/decide`, { method: 'POST', body: { approve } }),
    onSuccess: (_r, approve) => {
      toast.success(approve ? `${name} can continue on the new device` : 'Device switch rejected', { description: approve ? 'The old device has been signed out of the exam.' : 'The candidate stays on their original device.' });
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const decided = t.status !== 'PENDING';
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Laptop className="size-4 text-info" aria-hidden /> Device switch · {name}
        </div>
        {decided ? <Badge tone={t.status === 'APPROVED' ? 'ok' : 'neutral'}>{t.status.toLowerCase()}</Badge> : <span className="text-[12px] text-muted">{relative(t.createdAt)}</span>}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        Wants to continue on <strong className="text-ink">{deviceLabel(t.userAgent)}</strong>
        {t.ipAddress ? <> ({t.ipAddress})</> : null} while the original device is still connected. Approve if you have confirmed why — e.g. a dying battery.
        {t.reason && <span className="mt-1 block italic">“{t.reason}”</span>}
      </p>
      {stale && !decided && <p className="mt-1.5 text-[12px] font-medium text-muted">The attempt has already been submitted, so this request is out of date — reject it to clear the queue.</p>}
      {!decided && (
        <div className="mt-3 flex gap-2">
          {!stale && <Button size="sm" icon={<Send className="size-4" />} loading={mut.isPending && mut.variables === true} disabled={mut.isPending} onClick={() => mut.mutate(true)}>
            Allow switch
          </Button>}
          <Button size="sm" variant="ghost" loading={mut.isPending && mut.variables === false} disabled={mut.isPending} onClick={() => mut.mutate(false)}>
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
