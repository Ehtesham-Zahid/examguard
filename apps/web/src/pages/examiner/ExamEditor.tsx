import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, BarChart3, CalendarClock, ClipboardPen, Clock, Copy, Eye, FileQuestion, KeyRound, MonitorPlay, Rocket, Shuffle, Square, Trash2, Undo2, Users } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { sessionHeaders } from '@/lib/session';
import { fmtDate, relative } from '@/lib/format';
import { Button, ConfirmDialog, ErrorBox, Spinner, Tabs } from '@/components/ui';
import { PhaseBadge } from '@/components/status';
import type { ExamDetail } from '@/components/setup/types';
import { examKey, invalidateExam, linkBtn, Menu, usePublish } from '@/components/setup/editor/common';
import { DetailsTab } from '@/components/setup/editor/DetailsTab';
import { QuestionsTab } from '@/components/setup/editor/QuestionsTab';
import { CandidatesTab } from '@/components/setup/editor/CandidatesTab';
import { ReviewTab } from '@/components/setup/editor/ReviewTab';
import { FairnessTab } from '@/components/setup/editor/FairnessTab';

type Tab = 'details' | 'questions' | 'candidates' | 'review' | 'fairness';
type Confirm = 'close' | 'unpublish' | 'archive' | 'delete' | null;

export default function ExamEditor() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: examKey(id), queryFn: () => api<ExamDetail>(`/exams/${id}`) });
  if (q.isLoading) return <Spinner label="Opening examination" />;
  if (q.isError)
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      </div>
    );
  return <Workspace exam={q.data!} />;
}

const BackLink = () => (
  <Link to="/examiner/exams" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
    <ArrowLeft className="size-4" aria-hidden /> All examinations
  </Link>
);

function Workspace({ exam }: { exam: ExamDetail }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const requested = (params.get('tab') as Tab) || (exam.status === 'DRAFT' ? 'questions' : 'details');
  const tab: Tab = requested === 'fairness' && exam.mode !== 'BLUEPRINT' ? 'details' : requested;
  const setTab = (t: Tab) => setParams(t === 'details' ? {} : { tab: t }, { replace: true });
  const [confirm, setConfirm] = useState<Confirm>(null);
  const { publish, publishing, modal } = usePublish(exam);
  const phase = exam.phase;

  const action = useMutation({
    mutationFn: (a: Exclude<Confirm, null>) => (a === 'delete' ? api(`/exams/${exam.id}`, { method: 'DELETE' }) : api(`/exams/${exam.id}/${a}`, { method: 'POST' })),
    onSuccess: (_r, a) => {
      setConfirm(null);
      if (a === 'delete') {
        toast.success('Draft deleted');
        qc.removeQueries({ queryKey: examKey(exam.id) });
        qc.invalidateQueries({ queryKey: ['exams'] });
        nav('/examiner/exams');
        return;
      }
      toast.success({ close: 'Examination closed — in-progress attempts were submitted', unpublish: 'Back to draft — candidates can no longer see it', archive: 'Examination archived' }[a]);
      invalidateExam(qc, exam.id);
    },
    onError: (e) => {
      setConfirm(null);
      toast.error(errMsg(e));
    },
  });
  const duplicate = useMutation({
    mutationFn: () => api<{ id: string }>(`/exams/${exam.id}/duplicate`, { method: 'POST' }),
    onSuccess: (c) => {
      toast.success('Copy created as a draft');
      qc.invalidateQueries({ queryKey: ['exams'] });
      nav(`/examiner/exams/${c.id}`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const sandbox = useMutation({
    mutationFn: () => api<{ attemptId: string }>(`/candidate/exams/${exam.id}/start`, { method: 'POST', body: { sandbox: true }, headers: sessionHeaders() }),
    onSuccess: (r) => nav(`/exam/${r.attemptId}?sandbox=1`),
    onError: (e) => toast.error(errMsg(e)),
  });

  const sameDay = new Date(exam.windowStart).toDateString() === new Date(exam.windowEnd).toDateString();
  const qCount = exam.mode === 'BLUEPRINT' ? (exam.blueprint ?? []).reduce((a, s) => a + s.count, 0) : exam.questions.length;

  const tabs: { id: Tab; label: ReactNode; count?: number }[] = [
    { id: 'details', label: 'Details & rules' },
    { id: 'questions', label: 'Questions', count: qCount },
    { id: 'candidates', label: 'Candidates', count: exam.stats.enrolled },
    { id: 'review', label: exam.status === 'DRAFT' ? 'Review & publish' : 'Checklist' },
    ...(exam.mode === 'BLUEPRINT' ? [{ id: 'fairness' as Tab, label: <span className="inline-flex items-center gap-1.5"><Shuffle className="size-3.5" aria-hidden />Fairness</span> }] : []),
  ];

  return (
    <div>
      <BackLink />
      <header className="mb-5 mt-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <PhaseBadge phase={phase} paused={!!exam.pausedAt && phase === 'ONGOING'} />
              {exam.mode === 'BLUEPRINT' && <span className="inline-flex items-center gap-1 text-[12px] font-medium text-accent"><Shuffle className="size-3.5" aria-hidden /> Fair random paper</span>}
            </div>
            <h1 className="display text-[26px] font-semibold leading-tight sm:text-[32px]">{exam.title}</h1>
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-2">
              <Fact icon={<CalendarClock className="size-4" />} label="Window">
                {fmtDate(exam.windowStart)} – {sameDay ? new Date(exam.windowEnd).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : fmtDate(exam.windowEnd)}
                <span className="ml-1 text-muted">({phase === 'PUBLISHED' || phase === 'DRAFT' ? `opens ${relative(exam.windowStart)}` : phase === 'ONGOING' ? `closes ${relative(exam.windowEnd)}` : `closed ${relative(exam.windowEnd)}`})</span>
              </Fact>
              <Fact icon={<Clock className="size-4" />} label="Duration">{exam.durationMin} min</Fact>
              <Fact icon={<FileQuestion className="size-4" />} label="Paper">
                {qCount} questions · {exam.totalMarks} marks · pass {exam.passMarks}
              </Fact>
              <Fact icon={<Users className="size-4" />} label="Candidates">
                {exam.stats.enrolled} enrolled
                {(phase === 'ONGOING' || phase === 'COMPLETED') && ` · ${exam.stats.submitted} submitted`}
              </Fact>
              {exam.accessCode && (
                <Fact icon={<KeyRound className="size-4" />} label="Access code">
                  <code className="font-mono">{exam.accessCode}</code>
                </Fact>
              )}
            </dl>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {phase !== 'ARCHIVED' && phase !== 'COMPLETED' && (
              <Button variant="outline" icon={<Eye className="size-4" />} onClick={() => sandbox.mutate()} loading={sandbox.isPending}>
                Preview as candidate
              </Button>
            )}
            {phase === 'DRAFT' && (
              <Button icon={<Rocket className="size-4" />} onClick={publish} loading={publishing}>
                Publish
              </Button>
            )}
            {phase === 'PUBLISHED' && (
              <Button variant="outline" icon={<Undo2 className="size-4" />} onClick={() => setConfirm('unpublish')}>
                Unpublish
              </Button>
            )}
            {phase === 'ONGOING' && (
              <>
                <Button variant="danger" icon={<Square className="size-4" />} onClick={() => setConfirm('close')}>
                  Close early
                </Button>
                <Link to={`/examiner/exams/${exam.id}/monitor`} className={linkBtn.live}>
                  <MonitorPlay className="size-4" aria-hidden /> Monitor
                </Link>
              </>
            )}
            {(phase === 'COMPLETED' || phase === 'ARCHIVED') && (
              <>
                <Link to={`/examiner/exams/${exam.id}/grading`} className={linkBtn.outline}>
                  <ClipboardPen className="size-4" aria-hidden /> Grading
                </Link>
                <Link to={`/examiner/exams/${exam.id}/results`} className={linkBtn.primary}>
                  <BarChart3 className="size-4" aria-hidden /> Results
                </Link>
              </>
            )}
            <Menu
              label="More actions"
              items={[
                { label: 'Open monitor', icon: <MonitorPlay className="size-4" />, onSelect: () => nav(`/examiner/exams/${exam.id}/monitor`), hidden: phase !== 'PUBLISHED' },
                { label: 'Preview as candidate', icon: <Eye className="size-4" />, onSelect: () => sandbox.mutate(), hidden: phase !== 'COMPLETED' },
                { label: 'Duplicate', icon: <Copy className="size-4" />, onSelect: () => duplicate.mutate() },
                { label: 'Archive', icon: <Archive className="size-4" />, onSelect: () => setConfirm('archive'), hidden: phase !== 'COMPLETED' },
                { label: 'Delete draft', icon: <Trash2 className="size-4" />, onSelect: () => setConfirm('delete'), danger: true, hidden: phase !== 'DRAFT' },
              ]}
            />
          </div>
        </div>
      </header>

      <Tabs<Tab> className="mb-5" value={tab} onChange={setTab} tabs={tabs} />

      <div role="tabpanel" aria-label={typeof tabs.find((t) => t.id === tab)?.label === 'string' ? (tabs.find((t) => t.id === tab)!.label as string) : tab}>
        {tab === 'details' && <DetailsTab exam={exam} />}
        {tab === 'questions' && <QuestionsTab exam={exam} onOpenFairness={() => setTab('fairness')} />}
        {tab === 'candidates' && <CandidatesTab exam={exam} />}
        {tab === 'review' && <ReviewTab exam={exam} onPreview={() => sandbox.mutate()} previewing={sandbox.isPending} />}
        {tab === 'fairness' && <FairnessTab exam={exam} />}
      </div>

      {modal}
      <ConfirmDialog
        open={confirm === 'close'}
        onClose={() => setConfirm(null)}
        onConfirm={() => action.mutate('close')}
        loading={action.isPending}
        tone="danger"
        title="Close this examination now?"
        confirmLabel="Close examination"
        body={
          <>
            <strong className="text-ink">{exam.stats.inProgress}</strong> candidate{exam.stats.inProgress === 1 ? ' is' : 's are'} still writing. Their attempts will be submitted immediately with whatever they have answered, and nobody else can start. This can’t be undone.
          </>
        }
      />
      <ConfirmDialog
        open={confirm === 'unpublish'}
        onClose={() => setConfirm(null)}
        onConfirm={() => action.mutate('unpublish')}
        loading={action.isPending}
        title="Return to draft?"
        confirmLabel="Unpublish"
        body="Candidates will no longer see this examination until you publish it again. Enrolments are kept."
      />
      <ConfirmDialog
        open={confirm === 'archive'}
        onClose={() => setConfirm(null)}
        onConfirm={() => action.mutate('archive')}
        loading={action.isPending}
        title="Archive this examination?"
        confirmLabel="Archive"
        body="It moves out of your active lists. Results, attempts and the audit trail are kept and remain viewable."
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={() => action.mutate('delete')}
        loading={action.isPending}
        tone="danger"
        title="Delete this draft?"
        confirmLabel="Delete permanently"
        body={
          <>
            <strong className="text-ink">{exam.title}</strong>, its question list and enrolments will be permanently deleted. Questions stay in your bank. This can’t be undone.
          </>
        }
      />
    </div>
  );
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="text-muted">
        <span aria-hidden>{icon}</span>
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="tabular">{children}</dd>
    </div>
  );
}
