/* End-to-end API smoke test: run against a freshly seeded DB with the API on :4000 */
const BASE = process.env.API ?? 'http://localhost:4000/api';
let failures = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};
async function call(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
const login = async (email: string, password: string) => (await call('POST', '/auth/login', undefined, { email, password })).json.accessToken as string;

async function main() {
  // --- auth & RBAC
  const bad = await call('POST', '/auth/login', undefined, { email: 'admin@examguard.test', password: 'nope' });
  ok(bad.status === 401, 'wrong password rejected');
  const admin = await login('admin@examguard.test', 'Admin@123');
  const examiner = await login('examiner@examguard.test', 'Examiner@123');
  const examiner2 = await login('examiner2@examguard.test', 'Examiner@123');
  const student = await login('student@examguard.test', 'Student@123');
  const s3 = await login('student3@examguard.test', 'Student@123');
  ok(admin && examiner && student, 'all roles can log in');
  ok((await call('GET', '/users', student)).status === 403, 'candidate cannot list users (backend RBAC)');
  ok((await call('POST', '/users', examiner, { name: 'X', email: 'x@x.com', role: 'ADMIN' })).status === 403, 'examiner cannot create users');
  ok((await call('GET', '/exams')).status === 401, 'unauthenticated request rejected');
  const ov = await call('GET', '/users/admin/overview', admin);
  ok(ov.status === 200 && ov.json.auditChain.valid, 'admin overview + audit chain valid');

  // --- exams & ownership
  const exams = (await call('GET', '/exams', examiner)).json as any[];
  ok(exams.length >= 5, `examiner sees own exams (${exams.length})`);
  ok(((await call('GET', '/exams', examiner2)).json as any[]).length === 0, 'other examiner sees none of them');
  const live = exams.find((e) => e.title.includes('Midterm'));
  const fair = exams.find((e) => e.title.includes('Fair'));
  const upcoming = exams.find((e) => e.title.includes('Networks'));
  const draft = exams.find((e) => e.status === 'DRAFT');
  ok((await call('GET', `/exams/${live.id}`, examiner2)).status === 403, 'examiner2 cannot open examiner1 exam');
  ok(live.phase === 'ONGOING' && upcoming.phase === 'PUBLISHED' && draft.phase === 'DRAFT', 'lifecycle phases derived');

  // validation
  const v = await call('POST', '/exams', examiner, { title: 'ab', windowStart: new Date().toISOString(), windowEnd: new Date(Date.now() - 1000).toISOString(), durationMin: 10 });
  ok(v.status === 400, `exam validation: ${v.json.error?.message}`);
  const pub = await call('POST', `/exams/${draft.id}/publish`, examiner);
  ok(pub.status === 400, `draft without questions cannot publish: ${pub.json.error?.message}`);

  // --- candidate dashboard & access window
  const dash = await call('GET', '/candidate/exams', student);
  ok(dash.json.items.some((i: any) => i.category === 'available') && dash.json.items.some((i: any) => i.category === 'upcoming'), 'candidate dashboard categories');
  ok(!dash.json.items.some((i: any) => i.phase === 'DRAFT'), 'drafts hidden from candidates');
  const sess = { 'x-session-id': 'session-device-A-123' };
  const early = await call('POST', `/candidate/exams/${upcoming.id}/start`, student, {}, sess);
  ok(early.status === 403, `cannot start before window: ${early.json.error?.message}`);

  // --- start, snapshot, no answer keys leaked
  const start = await call('POST', `/candidate/exams/${live.id}/start`, student, {}, sess);
  ok(start.status === 201, 'attempt started');
  const attemptId = start.json.attemptId;
  const again = await call('POST', `/candidate/exams/${live.id}/start`, student, {}, sess);
  ok(again.status === 200 && again.json.attemptId === attemptId, 'same device resumes same attempt');
  const other = await call('POST', `/candidate/exams/${live.id}/start`, student, {}, { 'x-session-id': 'session-device-B-999' });
  ok(other.status === 409 && other.json.error.code === 'SESSION_LOCKED', 'second device blocked (SESSION_LOCKED)');
  const st = await call('GET', `/candidate/attempts/${attemptId}`, student, undefined, sess);
  ok(st.status === 200 && st.json.questions.length > 0, `attempt state loaded (${st.json.questions.length} questions)`);
  ok(!JSON.stringify(st.json).includes('"correct"') && !JSON.stringify(st.json).includes('rubric'), 'answer keys & rubric never sent to candidate');
  ok((await call('GET', `/candidate/attempts/${attemptId}`, s3, undefined, sess)).status === 404, 'other candidate cannot read this attempt');

  // --- autosave idempotency
  const q1 = st.json.questions.find((q: any) => q.type === 'SINGLE');
  const qw = st.json.questions.find((q: any) => q.type === 'WRITTEN');
  const save = await call('PUT', `/candidate/attempts/${attemptId}/answers`, student, { items: [{ questionId: q1.id, response: [q1.options[0].id], seq: 5, visited: true }] }, sess);
  ok(save.status === 200 && save.json.accepted.length === 1, 'answer saved');
  await call('PUT', `/candidate/attempts/${attemptId}/answers`, student, { items: [{ questionId: q1.id, response: [q1.options[1].id], seq: 3 }] }, sess);
  const st2 = await call('GET', `/candidate/attempts/${attemptId}`, student, undefined, sess);
  ok(st2.json.answers[q1.id].response[0] === q1.options[0].id, 'stale (lower seq) write ignored');
  if (qw) await call('PUT', `/candidate/attempts/${attemptId}/answers`, student, { items: [{ questionId: qw.id, response: { text: 'A stack is LIFO and a queue is FIFO.' }, seq: 6 }] }, sess);
  const lateClaim = await call('PUT', `/candidate/attempts/${attemptId}/answers`, student, { items: [{ questionId: q1.id, response: [q1.options[0].id], seq: 7, offline: true, claimedAt: Date.now() + 10 * 3600_000 }] }, sess);
  ok(lateClaim.json.rejected?.length === 1, 'answer claimed after deadline rejected');

  // --- integrity events
  const ev = await call('POST', `/candidate/attempts/${attemptId}/events`, student, { events: [{ type: 'TAB_HIDDEN', details: 'away 3s' }, { type: 'PASTE_ATTEMPT' }] }, sess);
  ok(ev.status === 200 && ev.json.violations === 2, `integrity events recorded (violations=${ev.json.violations}, warnings left=${ev.json.warnings})`);
  const hb = await call('POST', `/candidate/attempts/${attemptId}/heartbeat`, student, { answered: 1 }, sess);
  ok(hb.status === 200 && hb.json.deadline, 'heartbeat returns server deadline');

  // --- monitoring
  const mon = await call('GET', `/staff/exams/${live.id}/monitor`, examiner);
  ok(mon.status === 200 && mon.json.attempts.some((a: any) => a.id === attemptId && a.connection === 'online'), 'examiner sees live attempt online');
  ok(mon.json.transfers.length === 1, 'pending device-switch request visible');
  ok(mon.json.incidents.length >= 3, 'incidents visible');
  const ann = await call('POST', `/exams/${live.id}/announcements`, examiner, { message: 'Ten minutes left for early starters' });
  ok(ann.status === 201, 'announcement sent');
  const ext = await call('POST', `/staff/attempts/${attemptId}/extend`, examiner, { minutes: 5, reason: 'Late start due to lab power' });
  ok(ext.status === 200, 'examiner extended time');

  // --- submit exactly once
  const key = 'submit-key-123456';
  const [s1, s2] = await Promise.all([
    call('POST', `/candidate/attempts/${attemptId}/submit`, student, { idempotencyKey: key }, sess),
    call('POST', `/candidate/attempts/${attemptId}/submit`, student, { idempotencyKey: key }, sess),
  ]);
  ok(s1.status === 200 && s2.status === 200 && [s1.json.alreadySubmitted, s2.json.alreadySubmitted].filter(Boolean).length === 1, 'concurrent double-submit finalises exactly once');
  const after = await call('PUT', `/candidate/attempts/${attemptId}/answers`, student, { items: [{ questionId: q1.id, response: [q1.options[2].id], seq: 99 }] }, sess);
  ok(after.status === 409, 'cannot change answers after submission');

  // --- grading
  const grading = exams.find((e) => e.title.includes('OOP'));
  const g = await call('GET', `/staff/exams/${grading.id}/grading`, examiner);
  ok(g.status === 200 && g.json.progress.total > 0, `grading queue (${g.json.progress.done}/${g.json.progress.total})`);
  const item = g.json.groups[0].items.find((i: any) => !i.graded && i.answerId);
  const over = await call('PUT', `/staff/answers/${item.answerId}/grade`, examiner, { score: 999 });
  ok(over.status === 400, `manual grade validated: ${over.json.error?.message}`);
  const good = await call('PUT', `/staff/answers/${item.answerId}/grade`, examiner, { score: 3, feedback: 'Solid' });
  ok(good.status === 200, 'manual grade saved');
  const pubEarly = await call('POST', `/staff/exams/${grading.id}/results/publish`, examiner);
  ok(pubEarly.status === 409, `cannot publish with ungraded work: ${pubEarly.json.error?.message}`);

  // --- results, analytics, reports, verification
  const done = exams.find((e) => e.title.includes('Database'));
  const an = await call('GET', `/staff/exams/${done.id}/analytics`, examiner);
  ok(an.status === 200 && an.json.questions.length > 0 && an.json.summary.count > 0, `analytics (mean ${an.json.summary.mean}, ${an.json.questions.length} questions)`);
  const sim = await call('GET', `/staff/exams/${done.id}/similarity`, examiner);
  ok(sim.json.written.length > 0, `similarity detects copied written answers (${sim.json.written[0]?.similarity}%)`);
  const fr = await call('GET', `/exams/${fair.id}/fairness`, examiner);
  ok(fr.status === 200 && fr.json.fair.sd < fr.json.naive.sd, `fair papers less variable: sd ${fr.json.fair.sd} vs naive ${fr.json.naive.sd}`);
  const s2tok = await login('student1@examguard.test', 'Student@123');
  const myRes = await call('GET', '/candidate/results', s2tok);
  ok(myRes.json.length >= 1 && myRes.json[0].certificateCode, 'candidate sees own published result with certificate');
  const code = myRes.json[0].certificateCode;
  const ver = await call('GET', `/verify/${code}`);
  ok(ver.json.valid === true && !JSON.stringify(ver.json).includes('@'), 'public verification valid and hides email');
  ok((await call('GET', '/verify/EG-FAKE-CODE-00')).json.valid === false, 'fake code rejected');
  const pdf = await fetch(`${BASE}/reports/attempts/${myRes.json[0].attemptId}/pdf`, { headers: { authorization: `Bearer ${s2tok}` } });
  ok(pdf.status === 200 && pdf.headers.get('content-type') === 'application/pdf', 'candidate PDF report downloads');
  const pdfOther = await fetch(`${BASE}/reports/attempts/${myRes.json[0].attemptId}/pdf`, { headers: { authorization: `Bearer ${s3}` } });
  ok(pdfOther.status === 404, 'another candidate cannot download that PDF');
  const epdf = await fetch(`${BASE}/reports/exams/${done.id}/pdf`, { headers: { authorization: `Bearer ${examiner}` } });
  ok(epdf.status === 200, 'exam summary PDF downloads');

  // --- disputes
  const ds = await call('GET', '/staff/disputes', examiner);
  const d = ds.json.find((x: any) => x.status === 'OPEN');
  ok(!!d, 'open dispute listed');
  if (d) {
    const res = await call('POST', `/staff/disputes/${d.id}/resolve`, examiner, { decision: 'UPHELD', resolution: 'Repeatable read in major engines prevents phantoms; accepting option C for everyone.', action: 'ACCEPT_ANSWER', optionIds: ['c'] });
    ok(res.status === 200, `dispute upheld: ${res.json.scoreBefore} → ${res.json.scoreAfter}, ${res.json.affectedCandidates} candidate(s) re-graded`);
    const ver2 = await call('GET', `/verify/${code}`);
    ok(ver2.json.valid, 'certificate re-signed after regrade still verifies');
  }

  // --- sandbox isolation
  const sb = await call('POST', `/candidate/exams/${live.id}/start`, examiner, { sandbox: true }, { 'x-session-id': 'sandbox-session-1' });
  ok(sb.status === 201, 'examiner sandbox attempt started');
  const sbres = await call('GET', `/staff/exams/${live.id}/results`, examiner);
  ok(!sbres.json.attempts.some((a: any) => a.id === sb.json.attemptId), 'sandbox attempt excluded from results');
  ok((await call('POST', `/candidate/exams/${live.id}/start`, student, { sandbox: true }, sess)).status === 403, 'candidates cannot use sandbox');

  // --- imports
  const csv = 'name,email,group\nNew Person,new.person@uni.test,BSCS-5C\nBad Row,not-an-email,\n,missing@uni.test,';
  const imp = await call('POST', '/users/import', examiner, { format: 'csv', content: csv, dryRun: true });
  ok(imp.json.valid === 1 && imp.json.invalid === 2, `candidate CSV import preview: ${imp.json.valid} valid, ${imp.json.invalid} invalid`);
  const qcsv = 'type,topic,difficulty,question,options,correct,marks\nSINGLE,Networking,EASY,What does HTTP stand for in web protocols?,HyperText Transfer Protocol|High Transfer|Host Text,A,2\nSINGLE,Networking,EASY,Broken,,A,2';
  const qi = await call('POST', '/questions/import', examiner, { format: 'csv', content: qcsv, dryRun: false });
  ok(qi.json.created === 1 && qi.json.skipped === 1, `question CSV import: ${qi.json.created} created, ${qi.json.skipped} skipped`);

  // --- audit chain still intact
  await new Promise((r) => setTimeout(r, 500));
  const audit = await call('GET', '/users/admin/audit', admin);
  ok(audit.json.chain.valid && audit.json.logs.length > 10, `audit chain valid (${audit.json.chain.total} entries)`);

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}
main();
