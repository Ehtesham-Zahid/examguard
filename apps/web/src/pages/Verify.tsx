import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BadgeCheck, Search, ShieldAlert } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { Button, Card, Input, Spinner } from '@/components/ui';
import { Logo } from '@/layouts/AppShell';

interface Result {
  valid: boolean;
  reason?: string;
  signature?: string;
  payload?: { code: string; exam: string; candidate: string; score: number; maxScore: number; percentage: number; result: string; issuedAt: string; ref: string };
}

export default function Verify() {
  const { code } = useParams();
  const nav = useNavigate();
  const [input, setInput] = useState(code ?? '');
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!code) return;
    setLoading(true);
    setError('');
    api<Result>(`/verify/${encodeURIComponent(code)}`)
      .then(setRes)
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [code]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (input.trim()) nav(`/verify/${input.trim().toUpperCase()}`);
  };
  return (
    <div className="min-h-full px-4 py-10">
      <div className="mx-auto max-w-xl">
        <Link to="/" className="inline-block">
          <Logo />
        </Link>
        <h1 className="display mt-10 text-[34px] font-semibold">Verify a result report</h1>
        <p className="mt-2 text-ink-2">Enter the verification code printed on the report, or scan its QR code. We check the record's digital signature and show only the minimum details needed.</p>
        <form onSubmit={submit} className="mt-6 flex gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="EG-XXXX-XXXX-XX" className="h-12 font-mono uppercase" aria-label="Verification code" />
          <Button type="submit" size="lg" icon={<Search className="size-4" />}>Verify</Button>
        </form>
        <div className="mt-8" aria-live="polite">
          {loading && <Spinner label="Checking signature" />}
          {error && <p className="text-danger">{error}</p>}
          {res && !loading && (
            <Card className={res.valid ? 'border-ok/40' : 'border-danger/40'}>
              <div className={`flex items-center gap-3 rounded-t-xl px-5 py-4 ${res.valid ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
                {res.valid ? <BadgeCheck className="size-6" /> : <ShieldAlert className="size-6" />}
                <div>
                  <div className="font-semibold">{res.valid ? 'Authentic report' : 'Could not verify'}</div>
                  <div className="text-sm opacity-90">{res.valid ? 'Signature valid — issued by ExamGuard and unmodified.' : res.reason}</div>
                </div>
              </div>
              {res.payload && (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 text-sm">
                  {[
                    ['Examination', res.payload.exam],
                    ['Candidate', res.payload.candidate],
                    ['Score', `${res.payload.score} / ${res.payload.maxScore} (${res.payload.percentage}%)`],
                    ['Result', res.payload.result],
                    ['Issued', new Date(res.payload.issuedAt).toLocaleString()],
                    ['Code', res.payload.code],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
                      <dd className="mt-0.5 font-medium">{v}</dd>
                    </div>
                  ))}
                  {res.signature && (
                    <div className="col-span-2">
                      <dt className="text-xs uppercase tracking-wide text-muted">Ed25519 signature</dt>
                      <dd className="mt-0.5 break-all font-mono text-[11px] text-muted">{res.signature}</dd>
                    </div>
                  )}
                </dl>
              )}
            </Card>
          )}
        </div>
        <p className="mt-8 text-xs text-muted">For privacy, verification never reveals the candidate's full name, email, or answers.</p>
      </div>
    </div>
  );
}
