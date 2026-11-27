/**
 * A tiny stand-in for the Claude Messages API, for tests and offline demos of the AI marking assistant.
 * It speaks the real wire format, so the Anthropic SDK code path is exercised end to end:
 *   npx tsx scripts/mock-claude.ts            (listens on :4600)
 *   ANTHROPIC_BASE_URL=http://localhost:4600 ANTHROPIC_API_KEY=mock npx tsx src/server.ts
 * Marks deterministically by rubric keyword overlap; quotes the answer verbatim; flags marker-directed text.
 */
import http from 'node:http';

export const requests: any[] = [];
export let mode: 'ok' | 'refusal' | 'error' | 'unverifiable' = 'ok';
export const setMode = (m: typeof mode) => (mode = m);

const words = (t: string) => new Set(t.toLowerCase().match(/[a-z]{4,}/g) ?? []);

function mark(system: string, user: string) {
  const max = Number(system.match(/worth ([\d.]+) marks/)?.[1] ?? 10);
  const rubric = system.split('Rubric:\n')[1] ?? '';
  const answer = (user.match(/<answer>\n([\s\S]*)\n<\/answer>/)?.[1] ?? '').trim();
  const points = rubric.split('\n').map((l) => l.replace(/^[-*•\s]+/, '').trim()).filter((l) => l && l !== '(none provided)');
  const aw = words(answer);
  const criteria = (points.length ? points : ['Addresses the question']).map((p) => {
    const pw = [...words(p)];
    const hit = pw.length ? pw.filter((w) => aw.has(w)).length / pw.length : aw.size > 5 ? 0.6 : 0;
    return { criterion: p.slice(0, 80), verdict: hit >= 0.5 ? 'met' : hit > 0 ? 'partial' : 'missed', comment: hit >= 0.5 ? 'Covered clearly.' : hit > 0 ? 'Mentioned but not fully explained.' : 'Not addressed.' } as const;
  });
  const ratio = criteria.reduce((s, c) => s + (c.verdict === 'met' ? 1 : c.verdict === 'partial' ? 0.5 : 0), 0) / criteria.length;
  const manipulation = /(full marks|ignore (the )?rubric|dear (marker|examiner)|give me)/i.test(answer);
  const sentences = answer.split(/(?<=[.!?])\s+/).filter((s) => s.length > 12);
  const quote = (sentences[0] ?? answer).slice(0, 160);
  return {
    score: Math.round(ratio * max * 2) / 2,
    confidence: ratio > 0.8 || ratio < 0.2 ? 'high' : 'medium',
    summary: `Meets ${criteria.filter((c) => c.verdict === 'met').length} of ${criteria.length} rubric points.`,
    criteria,
    evidence: answer ? [{ quote: mode === 'unverifiable' ? 'A sentence the candidate never wrote.' : quote, supports: 'Shows the main idea of the answer.' }] : [],
    feedback: ratio > 0.8 ? 'You covered the key points well.' : 'You have the start of the idea; explain each rubric point more fully and give an example.',
    flags: [...(manipulation ? ['possible_manipulation'] : []), ...(points.length ? [] : ['rubric_unclear'])],
  };
}

export function startMockClaude(port = Number(process.env.MOCK_CLAUDE_PORT ?? 4600)) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) return res.writeHead(404).end();
      const r = JSON.parse(body);
      requests.push({ ...r, headers: req.headers });
      if (!req.headers['x-api-key'] && !req.headers.authorization) return res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'missing key' } }));
      if (mode === 'error') return res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'mock failure' } }));
      const system = (r.system ?? []).map((b: { text: string }) => b.text).join('\n');
      const user = typeof r.messages?.[0]?.content === 'string' ? r.messages[0].content : '';
      const refusal = mode === 'refusal';
      const out = refusal ? null : mark(system, user);
      setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          id: `msg_mock_${requests.length}`,
          type: 'message',
          role: 'assistant',
          model: r.model,
          content: refusal ? [] : [{ type: 'text', text: JSON.stringify(out) }],
          stop_reason: refusal ? 'refusal' : 'end_turn',
          stop_sequence: null,
          stop_details: refusal ? { type: 'refusal', category: null, explanation: 'mock refusal' } : null,
          usage: { input_tokens: 900, output_tokens: 250, cache_read_input_tokens: requests.length > 1 ? 400 : 0, cache_creation_input_tokens: 0 },
        }),
      ), Number(process.env.MOCK_CLAUDE_DELAY_MS ?? 0));
    });
  });
  return new Promise<http.Server>((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1]?.endsWith('mock-claude.ts')) startMockClaude().then(() => console.log('mock Claude API on :' + (process.env.MOCK_CLAUDE_PORT ?? 4600)));
