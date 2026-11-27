import { useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileUp, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { Badge, Button, cx, Field, Modal, Select, Table, Td, Textarea, Th } from '@/components/ui';
import { downloadText, readTextFile, Segmented } from './shared';

export interface ImportRowResult {
  row: number;
  ok: boolean;
  errors: string[];
  data?: Record<string, unknown>;
  preview?: string;
}
export interface ImportResponse {
  total: number;
  valid?: number;
  invalid?: number;
  created?: number;
  skipped?: number;
  results: ImportRowResult[];
  credentials?: { name: string; email: string; temporaryPassword: string }[];
}

type Step = 'input' | 'preview' | 'done';

/**
 * Two-phase bulk import: validate (dryRun) → review row-level errors → commit valid rows.
 * Shared by candidate import (users) and question import.
 */
export function ImportWizard({
  open,
  onClose,
  title,
  description,
  endpoint,
  extraBody,
  templateName,
  templateCsv,
  sampleJson,
  columnsHint,
  previewHeader,
  previewCell,
  noun,
  renderDone,
  onCommitted,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  endpoint: string;
  extraBody?: Record<string, unknown>;
  templateName: string;
  templateCsv: string;
  sampleJson: string;
  columnsHint: ReactNode;
  previewHeader: string;
  previewCell: (r: ImportRowResult) => ReactNode;
  noun: [string, string];
  renderDone?: (r: ImportResponse) => ReactNode;
  onCommitted?: (r: ImportResponse) => void;
}) {
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('input');
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [done, setDone] = useState<ImportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'errors'>('all');
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setContent('');
    setFileName(null);
    setStep('input');
    setPreview(null);
    setDone(null);
    setError(null);
    setFilter('all');
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) {
      setError('File is larger than 2 MB. Split it into smaller files.');
      return;
    }
    try {
      const text = await readTextFile(f);
      setContent(text);
      setFileName(f.name);
      setFormat(f.name.toLowerCase().endsWith('.json') ? 'json' : 'csv');
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const run = async (dryRun: boolean) => {
    if (!content.trim()) {
      setError('Paste some rows or choose a file first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<ImportResponse>(endpoint, { method: 'POST', body: { format, content, dryRun, ...extraBody }, timeoutMs: 60000 });
      if (dryRun) {
        setPreview(r);
        setFilter(r.invalid ? 'errors' : 'all');
        setStep('preview');
      } else {
        setDone(r);
        setStep('done');
        toast.success(`Imported ${r.created ?? 0} ${(r.created ?? 0) === 1 ? noun[0] : noun[1]}`);
        onCommitted?.(r);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const validCount = preview?.valid ?? 0;
  const rows = (preview?.results ?? []).filter((r) => filter === 'all' || !r.ok);

  const footer =
    step === 'input' ? (
      <>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button onClick={() => run(true)} loading={busy} disabled={!content.trim()}>
          Validate
        </Button>
      </>
    ) : step === 'preview' ? (
      <>
        <Button variant="ghost" onClick={() => setStep('input')} disabled={busy}>
          Back to edit
        </Button>
        <Button onClick={() => run(false)} loading={busy} disabled={!validCount}>
          Import {validCount} valid {validCount === 1 ? noun[0] : noun[1]}
        </Button>
      </>
    ) : (
      <Button onClick={close}>Done</Button>
    );

  return (
    <Modal open={open} onClose={close} title={title} description={description} size="lg" footer={footer} dismissable={!busy}>
      <ol className="mb-4 flex flex-wrap items-center gap-2 text-[12px] font-medium" aria-label="Import progress">
        {(['input', 'preview', 'done'] as Step[]).map((s, i) => {
          const idx = ['input', 'preview', 'done'].indexOf(step);
          const state = i < idx ? 'done' : i === idx ? 'current' : 'todo';
          return (
            <li key={s} className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
              <span className={cx('grid size-5 place-items-center rounded-full text-[11px]', state === 'todo' ? 'bg-surface-2 text-muted' : 'bg-accent text-accent-ink')}>{i + 1}</span>
              <span className={state === 'todo' ? 'text-muted' : 'text-ink'}>{['Provide data', 'Review', 'Imported'][i]}</span>
              {i < 2 && <span className="mx-1 h-px w-6 bg-line-strong" aria-hidden />}
            </li>
          );
        })}
      </ol>

      {error && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      {step === 'input' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Segmented
              label="File format"
              value={format}
              onChange={setFormat}
              options={[
                { id: 'csv', label: 'CSV' },
                { id: 'json', label: 'JSON' },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" icon={<Download className="size-4" />} onClick={() => downloadText(templateName, templateCsv)}>
                CSV template
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setFormat('json'); setContent(sampleJson); setFileName(null); }}>
                Insert JSON example
              </Button>
            </div>
          </div>

          <div
            className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong bg-surface-2/40 px-4 py-6 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFile(e.dataTransfer.files[0]);
            }}
          >
            <FileUp className="size-6 text-muted" aria-hidden />
            <div className="text-sm">
              Drop a <strong>.csv</strong> or <strong>.json</strong> file here, or{' '}
              <button type="button" className="font-medium text-accent underline underline-offset-2" onClick={() => fileRef.current?.click()}>
                browse
              </button>
            </div>
            {fileName && <Badge tone="accent">{fileName}</Badge>}
            <input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" className="sr-only" aria-label="Choose import file" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>

          <Field label="…or paste the contents" hint={columnsHint}>
            {(id) => <Textarea id={id} value={content} onChange={(e) => { setContent(e.target.value); setFileName(null); }} className="min-h-40 font-mono text-[12.5px]" spellCheck={false} placeholder={format === 'csv' ? templateCsv.split('\n')[0] : '[{ … }]'} />}
          </Field>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <SummaryTile label="Rows read" value={preview.total} />
            <SummaryTile label="Ready to import" value={preview.valid ?? 0} tone="ok" />
            <SummaryTile label="With errors" value={preview.invalid ?? 0} tone={preview.invalid ? 'danger' : undefined} />
          </div>
          {!!preview.invalid && (
            <p className="text-[13px] text-ink-2">Rows with errors will be skipped. Fix them in your file and import again later, or go back and edit the pasted text now.</p>
          )}
          <div className="flex justify-between gap-2 [&>select]:w-auto">
            <Select aria-label="Show rows" value={filter} onChange={(e) => setFilter(e.target.value as 'all' | 'errors')}>
              <option value="all">All rows ({preview.results.length})</option>
              <option value="errors">Only rows with errors ({preview.invalid ?? 0})</option>
            </Select>
          </div>
          <div className="max-h-[42vh] overflow-y-auto rounded-xl border border-line">
            <Table className="min-w-0">
              <thead className="sticky top-0">
                <tr>
                  <Th className="w-16">Row</Th>
                  <Th>{previewHeader}</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row} className={cx(!r.ok && 'bg-danger-soft/40')}>
                    <Td className="tabular text-muted">{r.row}</Td>
                    <Td className="max-w-[340px]">{previewCell(r)}</Td>
                    <Td>
                      {r.ok ? (
                        <span className="inline-flex items-center gap-1.5 text-ok">
                          <CheckCircle2 className="size-4" aria-hidden /> Valid
                        </span>
                      ) : (
                        <ul className="space-y-0.5 text-[13px] text-danger">
                          {r.errors.map((e, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                              {e}
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <Td colSpan={3} className="py-8 text-center text-muted">
                      No rows to show.
                    </Td>
                  </tr>
                )}
              </tbody>
            </Table>
          </div>
        </div>
      )}

      {step === 'done' && done && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-ok-soft px-4 py-3 text-ok">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div className="text-sm">
              <div className="font-semibold">
                {done.created} {done.created === 1 ? noun[0] : noun[1]} imported
              </div>
              {!!done.skipped && <div className="text-ink-2">{done.skipped} row(s) skipped because of errors.</div>}
            </div>
          </div>
          {renderDone?.(done)}
        </div>
      )}
    </Modal>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'danger' }) {
  return (
    <div className={cx('rounded-xl border px-3 py-2.5', tone === 'ok' ? 'border-transparent bg-ok-soft' : tone === 'danger' ? 'border-transparent bg-danger-soft' : 'border-line bg-surface-2')}>
      <div className="text-[12px] text-muted">{label}</div>
      <div className={cx('tabular text-xl font-semibold', tone === 'ok' && 'text-ok', tone === 'danger' && 'text-danger')}>{value}</div>
    </div>
  );
}
