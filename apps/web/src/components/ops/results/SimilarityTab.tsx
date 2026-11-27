import { Link } from 'react-router-dom';
import { ExternalLink, Fingerprint, Scale } from 'lucide-react';
import { Badge, Card, CardHeader, cx, EmptyState, Table, Td, Th } from '@/components/ui';
import type { SimilarityData } from '../types';

function Side({ name, attemptId, excerpt }: { name: string; attemptId: string; excerpt: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface-2/40 p-3">
      <Link to={`/examiner/attempts/${attemptId}`} className="mb-1.5 inline-flex items-center gap-1 text-sm font-semibold hover:underline">
        {name} <ExternalLink className="size-3.5 text-muted" aria-hidden />
      </Link>
      <p className="font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-2">
        “{excerpt}
        {excerpt.length >= 160 ? '…' : ''}”
      </p>
    </div>
  );
}

export function SimilarityTab({ data }: { data: SimilarityData }) {
  return (
    <div className="flex flex-col gap-5">
      <div role="note" className="flex items-start gap-3 rounded-xl border-2 border-info/30 bg-info-soft px-5 py-4">
        <Scale className="mt-0.5 size-6 shrink-0 text-info" aria-hidden />
        <div>
          <div className="font-semibold text-ink">Similarity is a reason to look closer — never a verdict.</div>
          <p className="mt-0.5 text-sm text-ink-2">{data.note} Common textbook phrasing, shared study groups and a small answer space all raise similarity innocently.</p>
        </div>
      </div>

      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Fingerprint className="size-4 text-accent" aria-hidden /> Similar written answers <span className="tabular text-muted">({data.written.length})</span></span>} subtitle="Pairs of answers to the same question that share ≥ 50% of their word sequences" />
        {!data.written.length ? (
          <EmptyState title="No near-identical written answers" body="Pairs are only compared when both answers have at least 8 words." />
        ) : (
          <ul className="divide-y divide-line">
            {data.written.map((p, i) => (
              <li key={`${p.attemptA}-${p.attemptB}-${i}`} className="px-5 py-4">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <span className={cx('tabular rounded-lg px-2.5 py-1 text-lg font-bold', p.similarity >= 80 ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn')}>{p.similarity}%</span>
                  <span className="min-w-0 flex-1 text-[13px] text-ink-2">
                    <span className="font-medium text-ink">Question:</span> {p.question}
                    {p.question.length >= 80 ? '…' : ''}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Side name={p.a} attemptId={p.attemptA} excerpt={p.excerptA} />
                  <Side name={p.b} attemptId={p.attemptB} excerpt={p.excerptB} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={`Identical wrong answers (${data.identicalWrongAnswers.length})`} subtitle="Pairs who picked exactly the same incorrect option on 3 or more questions" />
        {!data.identicalWrongAnswers.length ? (
          <EmptyState title="No unusual shared mistakes" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Candidate A</Th>
                <Th>Candidate B</Th>
                <Th>Shared wrong answers</Th>
              </tr>
            </thead>
            <tbody>
              {data.identicalWrongAnswers.map((p) => (
                <tr key={`${p.attemptA}-${p.attemptB}`}>
                  <Td>
                    <Link className="font-medium hover:underline" to={`/examiner/attempts/${p.attemptA}`}>
                      {p.a}
                    </Link>
                  </Td>
                  <Td>
                    <Link className="font-medium hover:underline" to={`/examiner/attempts/${p.attemptB}`}>
                      {p.b}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={p.shared >= 5 ? 'danger' : 'warn'}>{p.shared} questions</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
