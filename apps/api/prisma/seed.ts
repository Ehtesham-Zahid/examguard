import { PrismaClient, type Difficulty, type QuestionType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { buildPaper, gradeAttempt, snapshotBlueprintPool } from '../src/services/attempts.service.js';
import { issueCertificate } from '../src/services/certificates.service.js';
import { defaultSettings } from '../src/domain/examPhase.js';
import { rng } from '../src/domain/random.js';
import { audit } from '../src/core/audit.js';

const prisma = new PrismaClient();
const H = 3600_000;
const now = Date.now();

type Q = { topic: string; type: QuestionType; difficulty: Difficulty; body: string; options?: string[]; correct?: number[]; marks: number; neg?: number; rubric?: string };

const QUESTIONS: Q[] = [
  // Data Structures
  { topic: 'Data Structures', type: 'SINGLE', difficulty: 'EASY', body: 'Which data structure follows the Last-In-First-Out (LIFO) principle?', options: ['Queue', 'Stack', 'Linked list', 'Heap'], correct: [1], marks: 2 },
  { topic: 'Data Structures', type: 'SINGLE', difficulty: 'EASY', body: 'What is the time complexity of accessing an element by index in an array?', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], correct: [0], marks: 2 },
  { topic: 'Data Structures', type: 'SINGLE', difficulty: 'MEDIUM', body: 'In a binary search tree, an in-order traversal visits keys in which order?', options: ['Random order', 'Descending order', 'Ascending order', 'Level order'], correct: [2], marks: 2, neg: 0.5 },
  { topic: 'Data Structures', type: 'MULTI', difficulty: 'MEDIUM', body: 'Which of the following are self-balancing binary search trees? (Select all that apply)', options: ['AVL tree', 'Red-black tree', 'Binary heap', 'Trie'], correct: [0, 1], marks: 4 },
  { topic: 'Data Structures', type: 'SINGLE', difficulty: 'MEDIUM', body: 'What is the worst-case time complexity of searching in a hash table with chaining?', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], correct: [2], marks: 2 },
  { topic: 'Data Structures', type: 'SINGLE', difficulty: 'HARD', body: 'A min-heap stored in an array has its root at index 0. What is the index of the right child of the node at index i?', options: ['2i', '2i + 1', '2i + 2', 'i / 2'], correct: [2], marks: 3, neg: 1 },
  { topic: 'Data Structures', type: 'MULTI', difficulty: 'HARD', body: 'Which operations run in O(log n) time on a balanced BST with n nodes?', options: ['Insert', 'Find minimum', 'Delete', 'In-order traversal of all nodes'], correct: [0, 1, 2], marks: 4 },
  { topic: 'Data Structures', type: 'WRITTEN', difficulty: 'MEDIUM', body: 'Explain the difference between a stack and a queue, and give one real-world use case for each.', marks: 5, rubric: '2 marks: correct LIFO vs FIFO definitions\n2 marks: one valid use case each\n1 mark: clarity' },
  { topic: 'Data Structures', type: 'SINGLE', difficulty: 'EASY', body: 'Which structure is best suited for implementing a breadth-first search?', options: ['Stack', 'Queue', 'Set', 'Tree'], correct: [1], marks: 2 },
  { topic: 'Data Structures', type: 'SINGLE', difficulty: 'HARD', body: 'What is the amortised cost of an append on a dynamic array that doubles its capacity when full?', options: ['O(1)', 'O(log n)', 'O(n)', 'O(√n)'], correct: [0], marks: 3 },
  // Algorithms
  { topic: 'Algorithms', type: 'SINGLE', difficulty: 'EASY', body: 'What is the time complexity of binary search on a sorted array?', options: ['O(n)', 'O(log n)', 'O(1)', 'O(n log n)'], correct: [1], marks: 2 },
  { topic: 'Algorithms', type: 'SINGLE', difficulty: 'EASY', body: 'Which sorting algorithm repeatedly swaps adjacent elements that are out of order?', options: ['Merge sort', 'Quick sort', 'Bubble sort', 'Heap sort'], correct: [2], marks: 2 },
  { topic: 'Algorithms', type: 'SINGLE', difficulty: 'EASY', body: 'Which algorithm design technique does merge sort use?', options: ['Greedy', 'Divide and conquer', 'Dynamic programming', 'Backtracking'], correct: [1], marks: 2 },
  { topic: 'Algorithms', type: 'SINGLE', difficulty: 'MEDIUM', body: "Dijkstra's algorithm fails to produce correct shortest paths when the graph contains:", options: ['Cycles', 'Negative edge weights', 'More than 1000 vertices', 'Undirected edges'], correct: [1], marks: 3 },
  { topic: 'Algorithms', type: 'MULTI', difficulty: 'MEDIUM', body: 'Which of these sorting algorithms are stable?', options: ['Merge sort', 'Insertion sort', 'Quick sort (Lomuto)', 'Heap sort'], correct: [0, 1], marks: 4 },
  { topic: 'Algorithms', type: 'SINGLE', difficulty: 'MEDIUM', body: 'The 0/1 knapsack problem is typically solved optimally using:', options: ['Greedy by value/weight ratio', 'Dynamic programming', 'Binary search', 'Breadth-first search'], correct: [1], marks: 3 },
  { topic: 'Algorithms', type: 'SINGLE', difficulty: 'MEDIUM', body: 'What is the average-case time complexity of quicksort?', options: ['O(n)', 'O(n log n)', 'O(n²)', 'O(log n)'], correct: [1], marks: 3 },
  { topic: 'Algorithms', type: 'SINGLE', difficulty: 'HARD', body: 'Which problem is NP-complete?', options: ['Shortest path', 'Minimum spanning tree', 'Boolean satisfiability (SAT)', 'Sorting'], correct: [2], marks: 3, neg: 1 },
  { topic: 'Algorithms', type: 'SINGLE', difficulty: 'HARD', body: 'Using the master theorem, T(n) = 2T(n/2) + n solves to:', options: ['Θ(n)', 'Θ(n log n)', 'Θ(n²)', 'Θ(log n)'], correct: [1], marks: 3 },
  { topic: 'Algorithms', type: 'MULTI', difficulty: 'HARD', body: 'Which algorithms compute a minimum spanning tree?', options: ["Kruskal's", "Prim's", "Bellman-Ford", "Floyd-Warshall"], correct: [0, 1], marks: 4 },
  { topic: 'Algorithms', type: 'WRITTEN', difficulty: 'HARD', body: 'Describe how dynamic programming differs from divide and conquer. Use the Fibonacci sequence to illustrate memoisation.', marks: 6, rubric: '2 marks: overlapping sub-problems vs independent sub-problems\n2 marks: memoisation explained with Fibonacci\n2 marks: complexity improvement (exponential → linear)' },
  { topic: 'Algorithms', type: 'SINGLE', difficulty: 'MEDIUM', body: 'Topological sorting is possible only on which kind of graph?', options: ['Complete graph', 'Directed acyclic graph', 'Undirected tree', 'Bipartite graph'], correct: [1], marks: 3 },
  // Databases
  { topic: 'Databases', type: 'SINGLE', difficulty: 'EASY', body: 'Which SQL clause filters rows after aggregation?', options: ['WHERE', 'HAVING', 'ORDER BY', 'GROUP BY'], correct: [1], marks: 2 },
  { topic: 'Databases', type: 'SINGLE', difficulty: 'EASY', body: 'A primary key must be:', options: ['Unique and not null', 'Nullable', 'A foreign key', 'Always an integer'], correct: [0], marks: 2 },
  { topic: 'Databases', type: 'MULTI', difficulty: 'MEDIUM', body: 'Which of the following are ACID properties?', options: ['Atomicity', 'Consistency', 'Isolation', 'Distribution'], correct: [0, 1, 2], marks: 3 },
  { topic: 'Databases', type: 'SINGLE', difficulty: 'MEDIUM', body: 'A table is in 2NF if it is in 1NF and:', options: ['Has no transitive dependencies', 'Has no partial dependency on a composite key', 'Has only one column', 'Uses surrogate keys'], correct: [1], marks: 3 },
  { topic: 'Databases', type: 'SINGLE', difficulty: 'HARD', body: 'Which isolation level prevents phantom reads?', options: ['Read uncommitted', 'Read committed', 'Repeatable read (per SQL standard)', 'Serializable'], correct: [3], marks: 3 },
  { topic: 'Databases', type: 'WRITTEN', difficulty: 'MEDIUM', body: 'Explain what a database index is and one trade-off of adding many indexes to a table.', marks: 4, rubric: '2 marks: index speeds lookups via an auxiliary structure (e.g. B-tree)\n2 marks: trade-off — slower writes / extra storage' },
  { topic: 'Databases', type: 'SINGLE', difficulty: 'MEDIUM', body: 'Which JOIN returns all rows from the left table and matching rows from the right?', options: ['INNER JOIN', 'LEFT JOIN', 'CROSS JOIN', 'RIGHT JOIN'], correct: [1], marks: 2 },
  { topic: 'Databases', type: 'SINGLE', difficulty: 'HARD', body: 'In a B+ tree, where are the actual data records (or pointers to them) stored?', options: ['Only in the root', 'In all internal nodes', 'Only in the leaf nodes', 'In a separate hash table'], correct: [2], marks: 3 },
  // Networking
  { topic: 'Networking', type: 'SINGLE', difficulty: 'EASY', body: 'Which protocol is connection-oriented?', options: ['UDP', 'TCP', 'IP', 'ICMP'], correct: [1], marks: 2 },
  { topic: 'Networking', type: 'SINGLE', difficulty: 'EASY', body: 'What is the default port for HTTPS?', options: ['80', '21', '443', '8080'], correct: [2], marks: 2 },
  { topic: 'Networking', type: 'MULTI', difficulty: 'MEDIUM', body: 'Which layers belong to the TCP/IP model?', options: ['Application', 'Transport', 'Presentation', 'Internet'], correct: [0, 1, 3], marks: 3 },
  { topic: 'Networking', type: 'SINGLE', difficulty: 'MEDIUM', body: 'DNS primarily translates:', options: ['MAC to IP addresses', 'Domain names to IP addresses', 'IP to port numbers', 'Private to public IPs'], correct: [1], marks: 2 },
  { topic: 'Networking', type: 'SINGLE', difficulty: 'HARD', body: 'How many usable host addresses are in a /26 IPv4 subnet?', options: ['64', '62', '30', '126'], correct: [1], marks: 3, neg: 1 },
  // OOP
  { topic: 'Object-Oriented Programming', type: 'SINGLE', difficulty: 'EASY', body: 'Which OOP principle hides internal state behind a public interface?', options: ['Inheritance', 'Encapsulation', 'Polymorphism', 'Recursion'], correct: [1], marks: 2 },
  { topic: 'Object-Oriented Programming', type: 'MULTI', difficulty: 'MEDIUM', body: 'Which of these are SOLID principles?', options: ['Single responsibility', 'Open/closed', 'Dependency inversion', 'Don\'t repeat yourself'], correct: [0, 1, 2], marks: 3 },
  { topic: 'Object-Oriented Programming', type: 'SINGLE', difficulty: 'MEDIUM', body: 'Method overriding is an example of:', options: ['Compile-time polymorphism', 'Runtime polymorphism', 'Encapsulation', 'Abstraction leakage'], correct: [1], marks: 2 },
  { topic: 'Object-Oriented Programming', type: 'WRITTEN', difficulty: 'HARD', body: 'Explain the Strategy design pattern and describe a scenario where it is preferable to inheritance.', marks: 5, rubric: '2 marks: interchangeable algorithms behind a common interface\n2 marks: realistic scenario (e.g. payment methods)\n1 mark: why composition beats inheritance here' },
];

const SAMPLE_TEXT = [
  'A stack is LIFO: the last element pushed is the first popped, like the undo history in an editor. A queue is FIFO: elements leave in the order they arrived, like a printer job queue.',
  'Stacks remove the most recent item first (last in first out) e.g. browser back button. Queues serve the oldest item first (first in first out) e.g. customers waiting at a ticket counter.',
  'stack uses push pop at one end, queue adds at rear removes at front. stack used in recursion call stack, queue in scheduling.',
];
const COPIED = 'A stack is LIFO: the last element pushed is the first popped, like the undo history in an editor. A queue is FIFO: elements leave in the order they arrived, like a printer job queue at the office.';

async function main() {
  if (process.env.SEED_IF_EMPTY === 'true' && (await prisma.user.count()) > 0) {
    // one-time rename (ExamGuard → Examify): demo accounts created before the rebrand keep working under the new domain.
    // Idempotent; only touches @examguard.test addresses whose @examify.test twin doesn't exist yet.
    const renamed = await prisma.$executeRaw`
      UPDATE "User" u SET "email" = replace(u."email", '@examguard.test', '@examify.test')
      WHERE u."email" LIKE '%@examguard.test'
        AND NOT EXISTS (SELECT 1 FROM "User" v WHERE v."email" = replace(u."email", '@examguard.test', '@examify.test'))`;
    if (renamed) console.log(`Renamed ${renamed} demo account(s) to @examify.test`);
    console.log('Database already has data — skipping seed.');
    return;
  }
  console.log('Resetting data…');
  await prisma.$transaction([
    prisma.auditLog.deleteMany(), prisma.notification.deleteMany(), prisma.dispute.deleteMany(), prisma.certificate.deleteMany(),
    prisma.attempt.deleteMany(), prisma.announcement.deleteMany(), prisma.enrollment.deleteMany(), prisma.examQuestion.deleteMany(),
    prisma.exam.deleteMany(), prisma.questionVersion.deleteMany(), prisma.question.deleteMany(), prisma.topic.deleteMany(), prisma.user.deleteMany(),
  ]);

  const hash = (p: string) => bcrypt.hash(p, 10);
  const admin = await prisma.user.create({ data: { name: 'Sana Umer', email: 'admin@examify.test', role: 'ADMIN', passwordHash: await hash('Admin@123') } });
  const examiner = await prisma.user.create({ data: { name: 'Dr. Hamza Qureshi', email: 'examiner@examify.test', role: 'EXAMINER', passwordHash: await hash('Examiner@123') } });
  await prisma.user.create({ data: { name: 'Prof. Sana Iqbal', email: 'examiner2@examify.test', role: 'EXAMINER', passwordHash: await hash('Examiner@123') } });
  const names = ['Ali Raza', 'Fatima Noor', 'Usman Tariq', 'Zainab Hussain', 'Bilal Ahmed', 'Hira Shah', 'Omar Farooq', 'Maryam Javed', 'Hassan Ali', 'Areeba Khan', 'Saad Mehmood', 'Laiba Aslam'];
  const studentPw = await hash('Student@123');
  const candidates = [await prisma.user.create({ data: { name: 'Ahmed Khan', email: 'student@examify.test', role: 'CANDIDATE', groupName: 'BSCS-5A', passwordHash: studentPw } })];
  for (let i = 0; i < names.length; i++)
    candidates.push(await prisma.user.create({ data: { name: names[i], email: `student${i + 1}@examify.test`, role: 'CANDIDATE', groupName: i % 2 ? 'BSCS-5B' : 'BSCS-5A', passwordHash: studentPw } }));
  const student2 = candidates[1];

  console.log('Creating question bank…');
  const topicIds: Record<string, string> = {};
  const qByTopic: Record<string, { id: string; type: QuestionType; difficulty: Difficulty }[]> = {};
  for (const q of QUESTIONS) {
    topicIds[q.topic] ??= (await prisma.topic.create({ data: { name: q.topic } })).id;
    const L = 'abcdefgh';
    const created = await prisma.question.create({
      data: {
        ownerId: examiner.id, topicId: topicIds[q.topic], type: q.type, difficulty: q.difficulty, tags: [q.topic.split(' ')[0].toLowerCase()],
        versions: { create: { version: 1, body: q.body, options: (q.options ?? []).map((t, i) => ({ id: L[i], text: t })), correct: (q.correct ?? []).map((i) => L[i]), marks: q.marks, negativeMarks: q.neg ?? 0, multiScheme: 'PARTIAL', rubric: q.rubric ?? null } },
      },
    });
    (qByTopic[q.topic] ??= []).push({ id: created.id, type: q.type, difficulty: q.difficulty });
  }

  // difficulty calibrated from previous semesters' data (spread around the label prior) — feeds fair paper generation
  const cr = rng('calibration');
  for (const t of Object.keys(qByTopic))
    for (const q of qByTopic[t]) {
      const prior = q.difficulty === 'EASY' ? 0.8 : q.difficulty === 'MEDIUM' ? 0.55 : 0.3;
      await prisma.question.update({ where: { id: q.id }, data: { calibratedDifficulty: Math.round(Math.min(0.97, Math.max(0.05, prior + (cr() - 0.5) * 0.4)) * 1000) / 1000 } });
    }

  const S = (o: Partial<typeof defaultSettings> = {}) => ({ ...defaultSettings, ...o });
  const pick = (topic: string) => qByTopic[topic].map((q) => q.id);

  console.log('Creating exams…');
  // 1. Live fixed exam (for the live demo)
  const live = await prisma.exam.create({
    data: {
      ownerId: examiner.id, title: 'Data Structures & Algorithms — Midterm', description: 'Covers stacks, queues, trees, hashing, sorting and graph algorithms.',
      instructions: '• Answer all questions. Some questions carry negative marking — it is shown on the question.\n• Your answers save automatically, even if your connection drops.\n• The exam runs in full-screen. Leaving full-screen, switching tabs or pasting text is recorded for the examiner.\n• Use the scratchpad for rough work; it is never graded.\n• The timer is controlled by the server; refreshing the page does not reset it.',
      windowStart: new Date(now - 0.5 * H), windowEnd: new Date(now + 48 * H), durationMin: 45, passMarks: 20, status: 'PUBLISHED', publishedAt: new Date(now - H), settings: S(),
      questions: { create: [...pick('Data Structures').slice(0, 7), ...pick('Algorithms').slice(0, 6), pick('Algorithms')[10]].map((questionId, i) => ({ questionId, position: i + 1 })) },
    },
  });
  // 2. Live blueprint (fair randomised) exam
  const tid = (n: string) => topicIds[n];
  const blueprint = [
    { topicId: tid('Data Structures'), difficulty: 'EASY', count: 2, marks: 2 },
    { topicId: tid('Data Structures'), difficulty: 'MEDIUM', count: 2, marks: 3 },
    { topicId: tid('Algorithms'), difficulty: 'EASY', count: 2, marks: 2 },
    { topicId: tid('Algorithms'), difficulty: 'MEDIUM', count: 2, marks: 3 },
    { topicId: tid('Algorithms'), difficulty: 'HARD', count: 2, marks: 4 },
  ];
  const fairExam = await prisma.exam.create({
    data: {
      ownerId: examiner.id, title: 'Algorithms Quiz — Fair Randomised Paper', description: 'Every candidate receives a different paper with equal expected difficulty.',
      instructions: 'Each candidate gets a different set of questions drawn from the same blueprint (topic × difficulty), balanced so that every paper is equally hard.',
      windowStart: new Date(now - 0.25 * H), windowEnd: new Date(now + 48 * H), durationMin: 20, passMarks: 14, status: 'PUBLISHED', publishedAt: new Date(now - H), mode: 'BLUEPRINT', blueprint, totalMarks: 28,
      settings: S({ requireFullscreen: true, maxViolations: 5 }),
    },
  });
  // 3. Completed exam with published results
  const done = await prisma.exam.create({
    data: {
      ownerId: examiner.id, title: 'Database Systems — Final Exam', description: 'SQL, normalisation, transactions and indexing.', instructions: 'Answer all questions.',
      windowStart: new Date(now - 72 * H), windowEnd: new Date(now - 70 * H), durationMin: 60, passMarks: 15, status: 'COMPLETED', publishedAt: new Date(now - 100 * H), settings: S({ showCorrectAnswers: true }),
      questions: { create: [...pick('Databases'), ...pick('Data Structures').slice(7, 8)].map((questionId, i) => ({ questionId, position: i + 1 })) },
    },
  });
  // 4. Completed exam awaiting grading
  const grading = await prisma.exam.create({
    data: {
      ownerId: examiner.id, title: 'OOP & Design Patterns — Quiz 2', description: 'SOLID, polymorphism and design patterns.', instructions: 'Answer all questions.',
      windowStart: new Date(now - 26 * H), windowEnd: new Date(now - 25 * H), durationMin: 30, passMarks: 6, status: 'COMPLETED', publishedAt: new Date(now - 30 * H), settings: S(),
      questions: { create: [...pick('Object-Oriented Programming'), pick('Data Structures')[7]].map((questionId, i) => ({ questionId, position: i + 1 })) },
    },
  });
  // 5. Upcoming
  const upcoming = await prisma.exam.create({
    data: {
      ownerId: examiner.id, title: 'Computer Networks — Quiz 1', description: 'TCP/IP, DNS and subnetting.', instructions: 'Calculators are not allowed. Use the built-in scratchpad.',
      windowStart: new Date(now + 26 * H), windowEnd: new Date(now + 28 * H), durationMin: 30, passMarks: 6, status: 'PUBLISHED', publishedAt: new Date(now), accessCode: 'NET2026', settings: S(),
      questions: { create: pick('Networking').map((questionId, i) => ({ questionId, position: i + 1 })) },
    },
  });
  // 6. Draft
  await prisma.exam.create({
    data: {
      ownerId: examiner.id, title: 'Operating Systems — Draft', description: 'Work in progress.', instructions: '',
      windowStart: new Date(now + 7 * 24 * H), windowEnd: new Date(now + 7 * 24 * H + 2 * H), durationMin: 60, passMarks: 0, status: 'DRAFT', settings: S(),
    },
  });

  // published exams pin their question versions and freeze blueprint pools (as POST /exams/:id/publish does)
  await prisma.examQuestion.updateMany({ where: { exam: { status: { not: 'DRAFT' } } }, data: { version: 1 } });
  await prisma.$transaction((tx) => snapshotBlueprintPool(tx, fairExam));

  for (const e of [live, fairExam, done, grading, upcoming]) {
    await prisma.enrollment.createMany({ data: candidates.map((c, i) => ({ examId: e.id, candidateId: c.id, extraTimePct: i === 3 ? 25 : 0 })) });
  }

  // totals for fixed exams
  for (const e of [live, done, grading, upcoming]) {
    const eqs = await prisma.examQuestion.findMany({ where: { examId: e.id }, include: { question: { include: { versions: true } } } });
    await prisma.exam.update({ where: { id: e.id }, data: { totalMarks: eqs.reduce((s, x) => s + x.question.versions[0].marks, 0) } });
  }

  console.log('Simulating completed attempts…');
  async function simulate(examId: string, startOffsetH: number, gradeWritten: boolean) {
    const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
    const r = rng(examId);
    let i = 0;
    for (const c of candidates.slice(1)) {
      i++;
      const ability = 0.3 + r() * 0.65;
      const started = new Date(now - startOffsetH * H + i * 60000);
      const attempt = await prisma.$transaction(async (tx) => {
        const paper = await buildPaper(tx, exam, crypto.randomUUID());
        return tx.attempt.create({
          data: {
            examId, candidateId: c.id, startedAt: started, deadline: new Date(started.getTime() + exam.durationMin * 60000), submittedAt: new Date(started.getTime() + exam.durationMin * (0.55 + r() * 0.43) * 60000),
            status: i === 4 ? 'AUTO_SUBMITTED' : 'SUBMITTED', maxScore: paper.items.reduce((s, x) => s + x.marks, 0), paperDifficulty: paper.difficulty, lastHeartbeatAt: started,
            integrityScore: i === 5 ? 76 : 100 - Math.floor(r() * 8), violationCount: i === 5 ? 4 : 0,
            questions: { create: paper.items.map((it, idx) => ({ position: idx + 1, questionVersionId: it.v.id, optionOrder: (it.v.options as { id: string }[]).map((o) => o.id), marks: it.marks, negativeMarks: it.negativeMarks, multiScheme: it.v.multiScheme })) },
          },
          include: { questions: { include: { questionVersion: { include: { question: true } } } } },
        });
      });
      for (const aq of attempt.questions) {
        const v = aq.questionVersion;
        const ease = v.question.difficulty === 'EASY' ? 0.25 : v.question.difficulty === 'HARD' ? -0.2 : 0;
        const skip = r() < 0.06;
        let response: unknown = null;
        if (!skip) {
          if (v.question.type === 'WRITTEN') response = { text: i === 2 ? COPIED : SAMPLE_TEXT[i % SAMPLE_TEXT.length] + (i > 3 ? ` (${c.name.split(' ')[0]}'s own words: complexity is O(1) for push and pop.)` : '') };
          else {
            const correct = v.correct as string[];
            const ids = (v.options as { id: string }[]).map((o) => o.id);
            const right = r() < ability + ease;
            // the third DB option is a strong distractor on the isolation-level question → shows up in analytics
            response = right ? correct : [ids.filter((x) => !correct.includes(x))[Math.floor(r() * (ids.length - correct.length))] ?? ids[0]];
          }
        }
        await prisma.answer.create({ data: { attemptId: attempt.id, attemptQuestionId: aq.id, response: response as never, visited: true, timeSpentMs: Math.floor(20000 + r() * 90000), flagged: r() < 0.08 } });
      }
      await prisma.$transaction((tx) => gradeAttempt(tx, attempt.id));
      if (gradeWritten) {
        const written = await prisma.answer.findMany({ where: { attemptId: attempt.id, autoScore: null }, include: { attemptQuestion: true } });
        for (const w of written) await prisma.answer.update({ where: { id: w.id }, data: { manualScore: Math.round(w.attemptQuestion.marks * (0.4 + ability * 0.6) * 2) / 2, feedback: 'Good explanation; add a concrete example next time.', gradedById: examiner.id, gradedAt: new Date() } });
        await prisma.$transaction((tx) => gradeAttempt(tx, attempt.id));
      }
      if (i === 5) {
        await prisma.incident.createMany({ data: [
          { attemptId: attempt.id, type: 'TAB_HIDDEN', severity: 'MEDIUM', details: 'Switched tab or minimised the window — away for 14s' },
          { attemptId: attempt.id, type: 'PASTE_ATTEMPT', severity: 'MEDIUM', details: 'Tried to paste external text' },
          { attemptId: attempt.id, type: 'FULLSCREEN_EXIT', severity: 'MEDIUM', details: 'Exited full-screen mode' },
        ] });
      }
    }
  }
  await simulate(done.id, 72, true);
  await simulate(grading.id, 26, false);

  // publish DB final results
  const doneAttempts = await prisma.attempt.findMany({ where: { examId: done.id } });
  for (const a of doneAttempts) await issueCertificate(a.id);
  await prisma.exam.update({ where: { id: done.id }, data: { resultsPublishedAt: new Date(now - 24 * H) } });

  // an open dispute for the demo (on the isolation-level question)
  const s2Attempt = doneAttempts.find((a) => a.candidateId === student2.id)!;
  const isoQ = await prisma.attemptQuestion.findFirst({ where: { attemptId: s2Attempt.id, questionVersion: { body: { contains: 'phantom' } } } });
  if (isoQ) {
    // the disputing student chose "Repeatable read" (option c)
    await prisma.answer.update({ where: { attemptQuestionId: isoQ.id }, data: { response: ['c'] } });
    await prisma.$transaction((tx) => gradeAttempt(tx, s2Attempt.id));
    await issueCertificate(s2Attempt.id);
    const disp = await prisma.dispute.create({ data: { attemptId: s2Attempt.id, attemptQuestionId: isoQ.id, raisedById: student2.id, category: 'AMBIGUOUS_QUESTION', message: 'In PostgreSQL and MySQL InnoDB, Repeatable Read also prevents phantom reads, so option C should also be accepted. The question does not say "per SQL standard only".', scoreBefore: s2Attempt.score } });
    await audit(student2.id, 'dispute.open', 'Dispute', disp.id, { attemptId: s2Attempt.id, category: 'AMBIGUOUS_QUESTION' });
  }

  await prisma.announcement.create({ data: { examId: live.id, authorId: examiner.id, message: 'Welcome! Question 6 uses 0-based array indexing.' } });
  await prisma.notification.createMany({ data: candidates.map((c) => ({ userId: c.id, title: 'Results published', body: 'Your result for Database Systems — Final Exam is available', link: '/candidate/results' })) });

  await audit(admin.id, 'system.seed', 'System', null, { candidates: candidates.length, questions: QUESTIONS.length });
  console.log('Seed complete.');
  console.log('  admin@examify.test / Admin@123');
  console.log('  examiner@examify.test / Examiner@123');
  console.log('  student@examify.test / Student@123 (also student1..12@examify.test)');
}

main().finally(() => prisma.$disconnect());
