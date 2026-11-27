import { useQueryClient } from '@tanstack/react-query';
import { Download, KeyRound } from 'lucide-react';
import { Button, Table, Td, Th } from '@/components/ui';
import { ImportWizard, type ImportResponse } from './ImportWizard';
import { downloadText, toCsv } from './shared';

const TEMPLATE = `name,email,group
Aisha Khan,aisha.khan@example.edu,CS-2026-A
Daniel Okafor,daniel.okafor@example.edu,CS-2026-A
Mei Lin,mei.lin@example.edu,CS-2026-B`;

const SAMPLE_JSON = `[
  { "name": "Aisha Khan", "email": "aisha.khan@example.edu", "group": "CS-2026-A" },
  { "name": "Daniel Okafor", "email": "daniel.okafor@example.edu", "group": "CS-2026-B" }
]`;

export function downloadCredentials(creds: NonNullable<ImportResponse['credentials']>) {
  downloadText(`examguard-credentials-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(['name', 'email', 'temporary_password'], creds.map((c) => [c.name, c.email, c.temporaryPassword])));
}

export function CandidateImport({ open, onClose, enrollExamId }: { open: boolean; onClose: () => void; enrollExamId?: string }) {
  const qc = useQueryClient();
  return (
    <ImportWizard
      open={open}
      onClose={onClose}
      title="Import candidates"
      description={enrollExamId ? 'New accounts are created and enrolled in this examination.' : 'Create many candidate accounts at once. Each gets a temporary password.'}
      endpoint="/users/import"
      extraBody={enrollExamId ? { enrollExamId } : undefined}
      templateName="examguard-candidates-template.csv"
      templateCsv={TEMPLATE}
      sampleJson={SAMPLE_JSON}
      columnsHint={
        <>
          Columns: <code>name</code>, <code>email</code> (required) and <code>group</code> (optional). Up to 2,000 rows.
        </>
      }
      previewHeader="Candidate"
      previewCell={(r) => {
        const d = (r.data ?? {}) as { name?: string; email?: string; group?: string | null };
        return (
          <div className="min-w-0">
            <div className="truncate font-medium">{d.name || <span className="text-muted">(no name)</span>}</div>
            <div className="truncate text-[13px] text-muted">
              {d.email || '(no email)'}
              {d.group ? ` · ${d.group}` : ''}
            </div>
          </div>
        );
      }}
      noun={['candidate', 'candidates']}
      onCommitted={() => {
        qc.invalidateQueries({ queryKey: ['users'] });
        qc.invalidateQueries({ queryKey: ['groups'] });
        if (enrollExamId) qc.invalidateQueries({ queryKey: ['enrollments', enrollExamId] });
      }}
      renderDone={(r) =>
        r.credentials?.length ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2 text-sm">
                <KeyRound className="mt-0.5 size-4 text-warn" aria-hidden />
                <span>
                  <strong>Download these credentials now.</strong> Temporary passwords are not stored in readable form and won’t be shown again.
                </span>
              </div>
              <Button icon={<Download className="size-4" />} onClick={() => downloadCredentials(r.credentials!)}>
                Download credentials CSV
              </Button>
            </div>
            <div className="max-h-[38vh] overflow-y-auto rounded-xl border border-line">
              <Table className="min-w-0">
                <thead className="sticky top-0">
                  <tr>
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th>Temporary password</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.credentials.map((c) => (
                    <tr key={c.email}>
                      <Td>{c.name}</Td>
                      <Td className="text-ink-2">{c.email}</Td>
                      <Td>
                        <code className="select-all font-mono text-[13px]">{c.temporaryPassword}</code>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        ) : null
      }
    />
  );
}
