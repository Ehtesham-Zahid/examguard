import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, ErrorBox, PageHeader, Spinner, Tabs } from '@/components/ui';
import { ResultsTab } from '@/components/ops/results/ResultsTab';
import { AnalyticsTab } from '@/components/ops/results/AnalyticsTab';
import { QuestionsTab } from '@/components/ops/results/QuestionsTab';
import { SimilarityTab } from '@/components/ops/results/SimilarityTab';
import type { AnalyticsData, ResultsData, SimilarityData } from '@/components/ops/types';

type Tab = 'results' | 'analytics' | 'questions' | 'similarity';
const TABS: Tab[] = ['results', 'analytics', 'questions', 'similarity'];

export default function Results() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'results') as Tab;
  const setTab = (t: Tab) => setParams(t === 'results' ? {} : { tab: t }, { replace: true });

  const results = useQuery({ queryKey: ['results', id], queryFn: () => api<ResultsData>(`/staff/exams/${id}/results`) });
  const analytics = useQuery({ queryKey: ['analytics', id], queryFn: () => api<AnalyticsData>(`/staff/exams/${id}/analytics`), enabled: tab === 'analytics' || tab === 'questions' });
  const similarity = useQuery({ queryKey: ['similarity', id], queryFn: () => api<SimilarityData>(`/staff/exams/${id}/similarity`), enabled: tab === 'similarity' });

  const exam = results.data?.exam;
  const flaggedQs = analytics.data?.questions.filter((q) => q.flags.length).length;
  const simCount = similarity.data ? similarity.data.written.length + similarity.data.identicalWrongAnswers.length : undefined;

  const body = (() => {
    const q = tab === 'results' ? results : tab === 'similarity' ? similarity : analytics;
    if (q.isLoading) return <Spinner label={tab === 'similarity' ? 'Comparing answers' : 'Crunching numbers'} />;
    if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
    if (tab === 'results') return <ResultsTab data={results.data!} />;
    if (tab === 'analytics') return <AnalyticsTab data={analytics.data!} />;
    if (tab === 'questions') return <QuestionsTab data={analytics.data!} examId={id} />;
    return <SimilarityTab data={similarity.data!} />;
  })();

  return (
    <div>
      <PageHeader
        eyebrow="Results & insights"
        title={exam?.title ?? 'Results'}
        subtitle={exam ? `Total ${exam.totalMarks} marks · pass mark ${exam.passMarks}` : undefined}
        actions={
          <>
            {exam && (exam.resultsPublishedAt ? <Badge tone="ok" dot>Published</Badge> : <Badge>Not published</Badge>)}
            <Link to={`/examiner/exams/${id}/monitor`} className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
              <Activity className="size-4" aria-hidden /> Monitor
            </Link>
          </>
        }
      />
      <Tabs<Tab>
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'results', label: 'Results', count: results.data?.attempts.length },
          { id: 'analytics', label: 'Analytics' },
          { id: 'questions', label: 'Question analysis', count: flaggedQs || undefined },
          { id: 'similarity', label: 'Similarity', count: simCount },
        ]}
      />
      <div role="tabpanel" aria-label={tab}>
        {body}
      </div>
    </div>
  );
}
