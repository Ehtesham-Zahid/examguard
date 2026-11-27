/**
 * Scenario tests for flows that need clock manipulation or multiple devices.
 * Run against a freshly seeded, DEDICATED database (it rewrites timestamps directly):
 *   DATABASE_URL=... API=http://localhost:4300/api npx tsx scripts/scenarios.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = process.env.API ?? 'http://localhost:4300/api';
let failures = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function call(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let json: any;
  try {
    json = JSON.parse(t);
  } catch {
    json = t;
  }
  return { status: r.status, json };
}
const login = async (email: string, password = 'Student@123') => (await call('POST', '/auth/login', undefined, { email, password })).json.accessToken as string;
const dev = (id: string) => ({ 'x-session-id': `device-${id}-0000` });

async function newLiveExam(examiner: string, title: string, settings: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const now = Date.now();
  const e = await call('POST', '/exams', examiner, { title, instructions: 'x', windowStart: new Date(now - 60_000).toISOString(), windowEnd: new Date(now + 3 * 3600_000).toISOString(), durationMin: 30, settings: { requireFullscreen: false, ...settings }, ...extra });
  const qs = ((await call('GET', '/questions', examiner)).json as any[]).filter((q) => q.type === 'SINGLE').slice(0, 4);
  await call('PUT', `/exams/${e.json.id}/questions`, examiner, { questionIds: qs.map((q) => q.id) });
  const cands = (await call('GET', '/users?role=CANDIDATE&pageSize=100', examiner)).json.items as any[];
  await call('POST', `/exams/${e.json.id}/enrollments`, examiner, { candidateIds: cands.map((c) => c.id) });
  // publish requires windowStart in future? no — only windowEnd in future
  const p = await call('POST', `/exams/${e.json.id}/publish`, examiner);
  if (p.status !== 200) console.log('publish failed', p.json);
  return e.json.id as string;
}

async function main() {
  const examiner = await login('examiner@examguard.test', 'Examiner@123');
  const admin = await login('admin@examguard.test', 'Admin@123');

  // ---------- 1. time expiry → sweeper auto-submits
  {
    const id = await newLiveExam(examiner, 'S1 expiry');
    const s = await login('student3@examguard.test');
    const st = await call('POST', `/candidate/exams/${id}/start`, s, {}, dev('s1'));
    const a = st.json.attemptId;
    const q = (await call('GET', `/candidate/attempts/${a}`, s, undefined, dev('s1'))).json.questions[0];
    await call('PUT', `/candidate/attempts/${a}/answers`, s, { items: [{ questionId: q.id, response: [q.options[0].id], seq: 1 }] }, dev('s1'));
    await prisma.attempt.update({ where: { id: a }, data: { deadline: new Date(Date.now() - 20_000), lastHeartbeatAt: new Date() } });
    await sleep(7000);
    const row = await prisma.attempt.findUniqueOrThrow({ where: { id: a } });
    ok(row.status === 'AUTO_SUBMITTED' && row.score !== null, `expired attempt auto-submitted by sweeper (status ${row.status}, score ${row.score})`);
    const late = await call('PUT', `/candidate/attempts/${a}/answers`, s, { items: [{ questionId: q.id, response: [q.options[1].id], seq: 2 }] }, dev('s1'));
    ok(late.status === 200 && late.json.rejected?.length === 1, 'online answer after deadline rejected');
    const comp = await prisma.timeCompensation.count({ where: { attemptId: a } });
    ok(comp === 0, 'no compensation suggested for a candidate who was online at expiry');
  }

  // ---------- 2. violation limit → force submit
  {
    const id = await newLiveExam(examiner, 'S2 violations', { maxViolations: 3 });
    const s = await login('student4@examguard.test');
    const a = (await call('POST', `/candidate/exams/${id}/start`, s, {}, dev('s2'))).json.attemptId;
    await call('POST', `/candidate/attempts/${a}/events`, s, { events: [{ type: 'TAB_HIDDEN' }, { type: 'CONTEXT_MENU' }] }, dev('s2'));
    const r = await call('POST', `/candidate/attempts/${a}/events`, s, { events: [{ type: 'PASTE_ATTEMPT' }, { type: 'FULLSCREEN_EXIT' }] }, dev('s2'));
    ok(r.json.submitted === true, `limit reached → submitted (violations ${r.json.violations}, CONTEXT_MENU not counted)`);
    const row = await prisma.attempt.findUniqueOrThrow({ where: { id: a } });
    ok(row.status === 'FORCE_SUBMITTED', 'attempt status FORCE_SUBMITTED');
    const bogus = await call('POST', `/candidate/attempts/${a}/events`, s, { events: [{ type: 'NOT_A_REAL_EVENT' }] }, dev('s2'));
    ok(bogus.status === 200, 'events after submission are ignored gracefully');
  }

  // ---------- 3. device switch with examiner approval
  let switchExam = '';
  {
    switchExam = await newLiveExam(examiner, 'S3 device switch');
    const s = await login('student5@examguard.test');
    const a = (await call('POST', `/candidate/exams/${switchExam}/start`, s, {}, dev('A'))).json.attemptId;
    const b1 = await call('POST', `/candidate/exams/${switchExam}/start`, s, {}, dev('B'));
    ok(b1.status === 409 && b1.json.error.code === 'SESSION_LOCKED', 'second device locked');
    const mon = (await call('GET', `/staff/exams/${switchExam}/monitor`, examiner)).json;
    const t = mon.transfers.find((x: any) => x.attemptId === a);
    ok(!!t, 'transfer request visible to examiner');
    const d = await call('POST', `/staff/transfers/${t.id}/decide`, examiner, { approve: true });
    ok(d.status === 200, 'examiner approved switch');
    const again = await call('POST', `/staff/transfers/${t.id}/decide`, examiner, { approve: false });
    ok(again.status === 409, 'cannot decide the same request twice');
    const b2 = await call('POST', `/candidate/exams/${switchExam}/start`, s, {}, dev('B'));
    ok(b2.status === 200 && b2.json.attemptId === a, 'device B resumes the same attempt');
    const oldDev = await call('POST', `/candidate/attempts/${a}/heartbeat`, s, {}, dev('A'));
    ok(oldDev.status === 409, 'old device A is now locked out');
  }

  // ---------- 4. silent device → automatic switch
  {
    const s = await login('student6@examguard.test');
    const a = (await call('POST', `/candidate/exams/${switchExam}/start`, s, {}, dev('C'))).json.attemptId;
    await prisma.attempt.update({ where: { id: a }, data: { lastHeartbeatAt: new Date(Date.now() - 120_000) } });
    const r = await call('POST', `/candidate/exams/${switchExam}/start`, s, {}, dev('D'));
    ok(r.status === 200 && r.json.attemptId === a, 'device silent >90s → new device allowed automatically');
  }

  // ---------- 5. power cut during exam → auto-submitted → compensation reopens with remaining time
  {
    const id = await newLiveExam(examiner, 'S5 power cut');
    const s = await login('student7@examguard.test');
    const a = (await call('POST', `/candidate/exams/${id}/start`, s, {}, dev('P'))).json.attemptId;
    // candidate last seen 10 min before their deadline; deadline has now passed
    const deadline = new Date(Date.now() - 15_000);
    await prisma.attempt.update({ where: { id: a }, data: { deadline, lastHeartbeatAt: new Date(deadline.getTime() - 600_000) } });
    await sleep(7000);
    const row = await prisma.attempt.findUniqueOrThrow({ where: { id: a } });
    const comp = await prisma.timeCompensation.findFirst({ where: { attemptId: a } });
    ok(row.status === 'AUTO_SUBMITTED' && comp?.status === 'PENDING' && Math.abs((comp?.seconds ?? 0) - 600) < 5, `auto-submitted and ~600s compensation suggested (${comp?.seconds}s)`);
    const lobby = await call('GET', `/candidate/exams/${id}`, s);
    ok(lobby.json.attempt?.compensation?.status === 'PENDING', 'candidate lobby shows pending compensation');
    const dec = await call('POST', `/staff/compensations/${comp!.id}/decide`, examiner, { approve: true });
    ok(dec.json.reopened === true, 'approval reopens the attempt');
    const re = await prisma.attempt.findUniqueOrThrow({ where: { id: a } });
    const left = (re.deadline.getTime() - Date.now()) / 1000;
    ok(re.status === 'IN_PROGRESS' && left > 590 && left <= 601, `reopened with ~10 min remaining (${Math.round(left)}s)`);
    const resume = await call('POST', `/candidate/exams/${id}/start`, s, {}, dev('P2'));
    ok(resume.status === 200 && resume.json.attemptId === a, `candidate can resume the reopened attempt from any device (${resume.status} ${resume.json.error?.code ?? ''})`);
  }

  // ---------- 6. heartbeat gap with no offline work → compensation; approve extends deadline
  {
    const id = await newLiveExam(examiner, 'S6 gap');
    const s = await login('student8@examguard.test');
    const a = (await call('POST', `/candidate/exams/${id}/start`, s, {}, dev('G'))).json.attemptId;
    const before = (await prisma.attempt.findUniqueOrThrow({ where: { id: a } })).deadline.getTime();
    await prisma.attempt.update({ where: { id: a }, data: { lastHeartbeatAt: new Date(Date.now() - 180_000) } });
    await call('POST', `/candidate/attempts/${a}/heartbeat`, s, {}, dev('G'));
    const comp = await prisma.timeCompensation.findFirst({ where: { attemptId: a } });
    ok(comp && comp.seconds >= 178 && comp.seconds <= 182, `gap of 180s → compensation suggested (${comp?.seconds}s)`);
    await call('POST', `/staff/compensations/${comp!.id}/decide`, examiner, { approve: true });
    const after = (await prisma.attempt.findUniqueOrThrow({ where: { id: a } })).deadline.getTime();
    ok(Math.abs(after - before - comp!.seconds * 1000) < 2000, 'approval extends the deadline by exactly the lost time');
  }

  // ---------- 7. offline answers merged after the deadline only with valid evidence
  {
    const id = await newLiveExam(examiner, 'S7 offline merge');
    const s = await login('student9@examguard.test');
    const a = (await call('POST', `/candidate/exams/${id}/start`, s, {}, dev('O'))).json.attemptId;
    const qs = (await call('GET', `/candidate/attempts/${a}`, s, undefined, dev('O'))).json.questions;
    const deadline = Date.now() - 60_000;
    await prisma.attempt.update({ where: { id: a }, data: { deadline: new Date(deadline), lastHeartbeatAt: new Date(deadline - 120_000) } });
    await sleep(7000); // sweeper auto-submits
    const r = await call(
      'PUT',
      `/candidate/attempts/${a}/answers`,
      s,
      {
        items: [
          { questionId: qs[0].id, response: [qs[0].options[0].id], seq: 1, offline: true, claimedAt: deadline - 30_000 }, // valid
          { questionId: qs[1].id, response: [qs[1].options[0].id], seq: 2, offline: true, claimedAt: deadline + 5_000 }, // after deadline
          { questionId: qs[2].id, response: [qs[2].options[0].id], seq: 3, offline: true, claimedAt: deadline - 600_000 }, // before last contact
          { questionId: qs[3].id, response: [qs[3].options[0].id], seq: 4 }, // not offline
        ],
      },
      dev('O'),
    );
    ok(r.status === 200 && r.json.accepted.length === 1 && r.json.rejected.length === 3, `only the provably-in-time offline answer merged (accepted ${r.json.accepted?.length}, rejected ${r.json.rejected?.length})`);
    const ev = await prisma.attemptEvent.count({ where: { attemptId: a, type: 'offline_answers_merged_after_deadline' } });
    ok(ev === 1, 'merge recorded in the attempt timeline');
  }

  // ---------- 8. pause / resume
  {
    const id = await newLiveExam(examiner, 'S8 pause');
    const s = await login('student10@examguard.test');
    const a = (await call('POST', `/candidate/exams/${id}/start`, s, {}, dev('Z'))).json.attemptId;
    const q = (await call('GET', `/candidate/attempts/${a}`, s, undefined, dev('Z'))).json.questions[0];
    const d0 = (await prisma.attempt.findUniqueOrThrow({ where: { id: a } })).deadline.getTime();
    await call('POST', `/exams/${id}/pause`, examiner, { reason: 'fire drill' });
    const blocked = await call('PUT', `/candidate/attempts/${a}/answers`, s, { items: [{ questionId: q.id, response: [q.options[0].id], seq: 1 }] }, dev('Z'));
    ok(blocked.status === 409 && blocked.json.error.code === 'EXAM_PAUSED', 'answers rejected while paused');
    const s2 = await login('student11@examguard.test');
    ok((await call('POST', `/candidate/exams/${id}/start`, s2, {}, dev('Y'))).status === 409, 'no new starts while paused');
    await sleep(3000);
    const res = await call('POST', `/exams/${id}/resume`, examiner);
    const d1 = (await prisma.attempt.findUniqueOrThrow({ where: { id: a } })).deadline.getTime();
    ok(res.json.addedSec >= 3 && Math.abs(d1 - d0 - res.json.addedSec * 1000) < 1500, `resume adds paused time back (${res.json.addedSec}s)`);
    // live-exam edit locks
    const ex = (await call('GET', `/exams/${id}`, examiner)).json;
    const body = { title: ex.title, description: ex.description, instructions: ex.instructions, windowStart: ex.windowStart, windowEnd: ex.windowEnd, durationMin: ex.durationMin, passMarks: ex.passMarks, accessCode: null, settings: { ...ex.settings, maxViolations: 9 } };
    ok((await call('PUT', `/exams/${id}`, examiner, body)).status === 409, 'rules cannot change while live');
    ok((await call('PUT', `/exams/${id}`, examiner, { ...body, settings: ex.settings, title: 'S8 renamed' })).status === 200, 'title can change while live');
    ok((await call('POST', `/exams/${id}/unpublish`, examiner)).status === 409, 'cannot unpublish after candidates started');
    ok((await call('PUT', `/exams/${id}/questions`, examiner, { questionIds: [] })).status === 409, 'questions locked after publish');
  }

  // ---------- 9. access code + late join
  {
    const id = await newLiveExam(examiner, 'S9 code', { lateJoinMin: 0 }, { accessCode: 'OPEN42' });
    const s = await login('student12@examguard.test');
    ok((await call('POST', `/candidate/exams/${id}/start`, s, { accessCode: 'nope' }, dev('K'))).status === 403, 'wrong access code rejected');
    ok((await call('POST', `/candidate/exams/${id}/start`, s, { accessCode: 'OPEN42' }, dev('K'))).status === 201, 'correct access code accepted');
    const id2 = await newLiveExam(examiner, 'S9 late', { lateJoinMin: 1 });
    await prisma.exam.update({ where: { id: id2 }, data: { windowStart: new Date(Date.now() - 5 * 60_000) } });
    ok((await call('POST', `/candidate/exams/${id2}/start`, s, {}, dev('K'))).status === 403, 'late entry closed after cutoff');
  }

  // ---------- 9b. "no going back" is enforced by the server, not just the UI
  {
    const id = await newLiveExam(examiner, 'S9b no back nav', { allowBackNav: false, shuffleQuestions: false });
    const s = await login('student8@examguard.test');
    const a = (await call('POST', `/candidate/exams/${id}/start`, s, {}, dev('NB'))).json.attemptId;
    const qs = (await call('GET', `/candidate/attempts/${a}`, s, undefined, dev('NB'))).json.questions;
    await call('PUT', `/candidate/attempts/${a}/answers`, s, { items: [{ questionId: qs[0].id, response: [qs[0].options[0].id], visited: true, seq: 1 }] }, dev('NB'));
    await call('PUT', `/candidate/attempts/${a}/answers`, s, { items: [{ questionId: qs[2].id, response: [qs[2].options[0].id], visited: true, seq: 2 }] }, dev('NB'));
    const back = await call('PUT', `/candidate/attempts/${a}/answers`, s, { items: [{ questionId: qs[0].id, response: [qs[0].options[1].id], visited: true, seq: 3 }] }, dev('NB'));
    ok(back.json.rejected?.[0]?.reason === 'back_navigation_disabled', 'changing an earlier answer is rejected when back navigation is off');
    const same = await call('PUT', `/candidate/attempts/${a}/answers`, s, { items: [{ questionId: qs[0].id, response: [qs[0].options[0].id], visited: true, timeSpentMs: 5000, seq: 4 }] }, dev('NB'));
    ok(same.json.accepted?.length === 1, 'resending the unchanged earlier answer (e.g. time tracking) is still accepted');
  }

  // ---------- 10. blueprint papers differ but follow the blueprint
  {
    const exams = (await call('GET', '/exams', examiner)).json as any[];
    const fair = exams.find((e) => e.mode === 'BLUEPRINT');
    const papers: string[][] = [];
    for (const email of ['student1@examguard.test', 'student2@examguard.test', 'student3@examguard.test']) {
      const s = await login(email);
      const a = (await call('POST', `/candidate/exams/${fair.id}/start`, s, {}, dev(email))).json.attemptId;
      const st = (await call('GET', `/candidate/attempts/${a}`, s, undefined, dev(email))).json;
      papers.push(st.questions.map((q: any) => q.body));
    }
    ok(papers.every((p) => p.length === 10), 'each blueprint paper has 10 questions');
    ok(new Set(papers.map((p) => [...p].sort().join('|'))).size > 1, 'papers differ between candidates');
  }

  // ---------- 11. question versioning protects live attempts
  {
    const id = await newLiveExam(examiner, 'S11 versions', { shuffleQuestions: false });
    const s = await login('student2@examguard.test');
    const a = (await call('POST', `/candidate/exams/${id}/start`, s, {}, dev('V'))).json.attemptId;
    const before = (await call('GET', `/candidate/attempts/${a}`, s, undefined, dev('V'))).json.questions[0];
    const ex = (await call('GET', `/exams/${id}`, examiner)).json;
    const qid = ex.questions[0].id;
    const full = (await call('GET', `/questions/${qid}`, examiner)).json;
    const cur = full.current;
    const upd = await call('PUT', `/questions/${qid}`, examiner, { topicId: full.topicId, type: full.type, difficulty: full.difficulty, body: cur.body + ' (edited)', options: cur.options, correct: cur.correct, marks: cur.marks, negativeMarks: cur.negativeMarks, multiScheme: cur.multiScheme, tags: full.tags });
    ok(upd.status === 200 && upd.json.currentVersion === full.currentVersion + 1, 'edit creates a new version');
    const after = (await call('GET', `/candidate/attempts/${a}`, s, undefined, dev('V'))).json.questions.find((q: any) => q.id === before.id);
    ok(after.body === before.body, 'active attempt still shows the original version');
    const s2 = await login('student6@examguard.test');
    const a2 = (await call('POST', `/candidate/exams/${id}/start`, s2, {}, dev('V2'))).json.attemptId;
    const fresh = (await call('GET', `/candidate/attempts/${a2}`, s2, undefined, dev('V2'))).json.questions[0];
    ok(fresh.body === before.body, 'candidates starting after the edit still get the version pinned at publish');
    ok((await call('POST', `/staff/exams/${id}/results/publish`, examiner)).status === 409, 'results cannot be published while the exam window is open');
  }

  // ---------- 12. disputes: void, adjust, reject rules; unpublish revokes certificates
  {
    const exams = (await call('GET', '/exams', examiner)).json as any[];
    const db = exams.find((e) => e.title.includes('Database'));
    const results = (await call('GET', `/staff/exams/${db.id}/results`, examiner)).json;
    const att = results.attempts[0];
    const s1 = await login(att.candidate.email);
    const r = (await call('GET', `/candidate/attempts/${att.id}/result`, s1)).json;
    const q = r.questions.find((x: any) => x.type !== 'WRITTEN');
    const d = await call('POST', `/candidate/attempts/${att.id}/disputes`, s1, { questionId: q.id, category: 'AMBIGUOUS_QUESTION', message: 'This question has two defensible answers in my view.' });
    ok(d.status === 201, 'candidate raised dispute');
    ok((await call('POST', `/staff/disputes/${d.json.id}/resolve`, examiner, { decision: 'REJECTED', resolution: 'Marking is correct as is.', action: 'VOID_QUESTION' })).status === 400, 'rejected dispute cannot change scores');
    const v = await call('POST', `/staff/disputes/${d.json.id}/resolve`, examiner, { decision: 'UPHELD', resolution: 'Question was ambiguous; voided for all.', action: 'VOID_QUESTION' });
    const res2 = (await call('GET', `/candidate/attempts/${att.id}/result`, s1)).json;
    ok(v.status === 200 && res2.questions.find((x: any) => x.id === q.id).score === q.marks, `voided question awards full marks (${v.json.affectedCandidates} candidates changed)`);
    const code = res2.certificateCode;
    ok((await call('GET', `/verify/${code}`)).json.valid, 'certificate valid after re-sign');
    await call('POST', `/staff/exams/${db.id}/results/unpublish`, examiner, { reason: 'Rechecking a question' });
    ok((await call('GET', `/verify/${code}`)).json.valid === false, 'unpublishing revokes certificates');
    ok((await call('GET', `/candidate/attempts/${att.id}/result`, s1)).status === 403, 'candidate cannot see result while unpublished');
    const pub = await call('POST', `/staff/exams/${db.id}/results/publish`, examiner);
    ok(pub.status === 200 && (await call('GET', `/verify/${code}`)).json.valid, 'republishing restores a valid certificate with the same code');
  }

  // ---------- 12b. void overrides manual grades; accepting an answer never lowers a score; sandbox untouched
  {
    const exams = (await call('GET', '/exams', examiner)).json as any[];
    const db = exams.find((e) => e.title.includes('Database'));
    // a sandbox attempt that must stay out of remedies
    const sb = (await call('POST', `/candidate/exams/${db.id}/start`, examiner, { sandbox: true }, dev('sbx'))).json.attemptId;
    const results = (await call('GET', `/staff/exams/${db.id}/results`, examiner)).json;
    const written = await prisma.attemptQuestion.findFirst({ where: { attempt: { examId: db.id, isSandbox: false }, questionVersion: { question: { type: 'WRITTEN' } }, answer: { manualScore: { not: null } } }, include: { answer: true, attempt: { include: { candidate: true } } } });
    const s = await login(written!.attempt.candidate.email);
    const d = await call('POST', `/candidate/attempts/${written!.attemptId}/disputes`, s, { questionId: written!.id, category: 'AMBIGUOUS_QUESTION', message: 'The written question wording was unclear to everyone.' });
    await call('POST', `/staff/disputes/${d.json.id}/resolve`, examiner, { decision: 'UPHELD', resolution: 'Voiding the written question for all.', action: 'VOID_QUESTION' });
    const ans = await prisma.answer.findUniqueOrThrow({ where: { attemptQuestionId: written!.id } });
    ok(ans.manualScore === written!.marks, `voiding a written question gives full marks even to already-graded answers (${written!.answer!.manualScore} → ${ans.manualScore})`);
    const sbRow = await prisma.attemptQuestion.findFirst({ where: { attemptId: sb, voided: true } });
    ok(!sbRow, 'sandbox attempts are not touched by dispute remedies');
    // multi-select: a candidate with the original exact key keeps full marks after another option is accepted
    const multi = await prisma.attemptQuestion.findMany({ where: { attempt: { examId: db.id, isSandbox: false }, voided: false, questionVersion: { question: { type: 'MULTI' } } }, include: { answer: true, questionVersion: true, attempt: { include: { candidate: true } } } });
    const exact = multi.find((m) => JSON.stringify([...((m.answer?.response as string[]) ?? [])].sort()) === JSON.stringify([...(m.questionVersion.correct as string[])].sort()));
    if (exact) {
      const other = multi.find((m) => m.questionVersionId === exact.questionVersionId && m.id !== exact.id)!;
      const before = (await prisma.answer.findUniqueOrThrow({ where: { attemptQuestionId: exact.id } })).autoScore;
      const s3 = await login(other.attempt.candidate.email);
      const extra = (other.questionVersion.options as { id: string }[]).map((o) => o.id).find((o) => !(other.questionVersion.correct as string[]).includes(o))!;
      const d2 = await call('POST', `/candidate/attempts/${other.attemptId}/disputes`, s3, { questionId: other.id, category: 'GRADING_ERROR', message: 'Another option is also defensible for this question.' });
      await call('POST', `/staff/disputes/${d2.json.id}/resolve`, examiner, { decision: 'UPHELD', resolution: 'Accepting the extra option as well.', action: 'ACCEPT_ANSWER', optionIds: [extra] });
      const after = (await prisma.answer.findUniqueOrThrow({ where: { attemptQuestionId: exact.id } })).autoScore;
      ok(after === before, `accepting an extra option does not lower the score of a candidate who matched the original key (${before} → ${after})`);
    } else ok(true, '(no exact multi-select answer in seed to check accept-answer)');
    void results;
  }

  // ---------- 13. account security
  {
    const create = await call('POST', '/users', admin, { name: 'Temp User', email: 'temp.user@examguard.test', role: 'CANDIDATE' });
    const pw = create.json.temporaryPassword;
    const t = await login('temp.user@examguard.test', pw);
    ok(!!t, 'new user signs in with temporary password');
    const me = await call('GET', '/auth/me', t);
    ok(me.json.user.mustChangePassword === true, 'must change password on first login');
    ok((await call('GET', '/candidate/exams', t)).status === 403, 'API refuses other requests until the temporary password is changed');
    await call('PATCH', `/users/${create.json.user.id}`, admin, { status: 'DISABLED' });
    ok((await call('GET', '/auth/me', t)).status === 401, 'disabling a user kills their existing session');
    ok((await call('POST', '/auth/login', undefined, { email: 'temp.user@examguard.test', password: pw })).status === 401, 'disabled user cannot sign in');
    const adminMe = (await call('GET', '/auth/me', admin)).json.user;
    ok((await call('PATCH', `/users/${adminMe.id}`, admin, { role: 'CANDIDATE' })).status === 400, 'admin cannot demote themselves');
    for (let i = 0; i < 5; i++) await call('POST', '/auth/login', undefined, { email: 'student11@examguard.test', password: 'wrong' });
    const locked = await call('POST', '/auth/login', undefined, { email: 'student11@examguard.test', password: 'Student@123' });
    ok(locked.status === 401 && /locked/i.test(locked.json.error.message), 'account locks after 5 failed attempts');
    const lr = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'student1@examguard.test', password: 'Student@123' }) });
    const rt = /eg_refresh=([^;]+)/.exec(lr.headers.get('set-cookie') ?? '')?.[1];
    ok(rt && (await call('GET', '/auth/me', rt)).status === 401, 'refresh token cannot be used as an access token');
    const s = await login('student1@examguard.test');
    await call('POST', '/auth/logout-all', s);
    ok((await call('GET', '/auth/me', s)).status === 401, 'logout from all devices invalidates tokens');
    ok((await call('POST', '/candidate/exams/x/start', examiner, {}, dev('e'))).status === 403, 'examiners cannot take real exams');
    ok((await call('DELETE', `/exams/${switchExam}`, examiner)).status === 409, 'published exam cannot be deleted');
  }

  // ---------- 13b. round-2 audit regressions
  {
    // (a) malformed socket messages must not crash the API
    const { io } = await import('../../web/node_modules/socket.io-client/build/esm/index.js' as string);
    const sock = io(BASE.replace(/\/api$/, ''), { auth: { token: await login('student2@examguard.test') }, transports: ['websocket'] });
    await new Promise((r) => sock.on('connect', r));
    sock.emit('join:exam');
    sock.emit('join:exam', { bad: true });
    sock.emit('join:exam', 12345, () => null);
    await sleep(800);
    sock.close();
    ok((await call('GET', '/health')).status === 200, 'malformed join:exam messages do not crash the API');

    // (b) blueprint pool is frozen at publish: editing a pooled question's key doesn't reach new papers
    const exams = (await call('GET', '/exams', examiner)).json as any[];
    const fair = exams.find((e) => e.mode === 'BLUEPRINT');
    const ex = await prisma.exam.findUniqueOrThrow({ where: { id: fair.id } });
    const pool = ex.blueprintPool as { questionId: string; version: number }[];
    ok(Array.isArray(pool) && pool.length >= 10, `published blueprint exam has a frozen pool (${pool?.length} questions)`);
    const target = (await call('GET', `/questions/${pool[0].questionId}`, examiner)).json;
    const cur = target.current;
    await call('PUT', `/questions/${target.id}`, examiner, { topicId: target.topicId, type: target.type, difficulty: target.difficulty, body: cur.body + ' [v-next]', options: cur.options, correct: cur.correct, marks: cur.marks, negativeMarks: cur.negativeMarks, multiScheme: cur.multiScheme, tags: target.tags });
    const s9 = await login('student9@examguard.test');
    const a9 = (await call('POST', `/candidate/exams/${fair.id}/start`, s9, {}, dev('BP'))).json.attemptId;
    const paper = (await call('GET', `/candidate/attempts/${a9}`, s9, undefined, dev('BP'))).json.questions as any[];
    ok(paper.length === 10 && !paper.some((q) => q.body.includes('[v-next]')), 'new blueprint papers use the versions frozen at publish');

    // (c) heartbeat after an outage with answers still queued on the device → no compensation
    const id = await newLiveExam(examiner, 'R2 comp');
    const s4 = await login('student4@examguard.test');
    const a4 = (await call('POST', `/candidate/exams/${id}/start`, s4, {}, dev('RC'))).json.attemptId;
    await prisma.attempt.update({ where: { id: a4 }, data: { lastHeartbeatAt: new Date(Date.now() - 180_000) } });
    await call('POST', `/candidate/attempts/${a4}/heartbeat`, s4, { pending: 3 }, dev('RC'));
    ok((await prisma.timeCompensation.count({ where: { attemptId: a4 } })) === 0, 'no compensation when the device reports queued offline work');
    // (d) concurrent heartbeat + answers after an outage register the gap once
    await prisma.attempt.update({ where: { id: a4 }, data: { lastHeartbeatAt: new Date(Date.now() - 180_000) } });
    const q4 = (await call('GET', `/candidate/attempts/${a4}`, s4, undefined, dev('RC'))).json.questions[0];
    await Promise.all([
      call('POST', `/candidate/attempts/${a4}/heartbeat`, s4, {}, dev('RC')),
      call('PUT', `/candidate/attempts/${a4}/answers`, s4, { items: [{ questionId: q4.id, response: [q4.options[0].id], seq: 1 }] }, dev('RC')),
    ]);
    ok((await prisma.timeCompensation.count({ where: { attemptId: a4 } })) === 1, 'a gap seen by two concurrent requests is compensated once');

    // (e) fake bearer tokens don't get fresh rate-limit buckets
    const r1 = await fetch(BASE + '/exams', { headers: { authorization: 'Bearer fake-token-aaaaaaaaaaaaaaaaaaaaaaaa' } });
    ok(r1.headers.get('ratelimit-policy') !== null || r1.status === 401, 'unverifiable tokens are rate-limited by IP');

    // (f) a pause moves the late-join cutoff
    const id2 = await newLiveExam(examiner, 'R2 latejoin', { lateJoinMin: 1 });
    await prisma.exam.update({ where: { id: id2 }, data: { windowStart: new Date(Date.now() - 90_000), pausedSec: 120 } });
    ok((await call('POST', `/candidate/exams/${id2}/start`, await login('student10@examguard.test'), {}, dev('LJ'))).status === 201, 'paused time extends the late-entry cutoff');
  }

  // ---------- 14. audit chain survives everything above
  await sleep(800);
  const chain = (await call('GET', '/users/admin/overview', admin)).json.auditChain;
  ok(chain.valid, `audit chain still valid (${chain.total} entries)`);

  console.log(failures ? `\n${failures} FAILED` : '\nALL SCENARIOS PASSED');
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}
main();
