# ExamGuard — Secure Examination Management System

> Technoverse 5.0 · Web-e-Thon. A full-stack platform to **create, conduct, monitor and evaluate** online examinations that stay **fair, secure and resilient**, even when a candidate's internet or power fails.

---

## Test credentials

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@examguard.test` | `Admin@123` |
| Examiner | `examiner@examguard.test` | `Examiner@123` |
| Examiner (second, owns nothing, used to show ownership isolation) | `examiner2@examguard.test` | `Examiner@123` |
| Candidate | `student@examguard.test` | `Student@123` |
| More candidates | `student1@examguard.test` … `student12@examguard.test` | `Student@123` |

The seed creates realistic data:
- a **live** fixed exam (*DSA Midterm*) and a **live** fair-randomised exam (*Algorithms Quiz*)
- a **completed** exam with published results, certificates, an open dispute and a copied written answer (*Database Systems Final*)
- a completed exam **awaiting manual grading** (*OOP Quiz 2*)
- an **upcoming** exam protected by the access code `NET2026`
- a **draft**

---

## Quick start

Requirements: Node 20+, pnpm, PostgreSQL 14+.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # set DATABASE_URL and JWT_SECRET
pnpm --filter api db:push                  # create the schema
pnpm --filter api db:seed                  # demo data (resets the DB)
pnpm dev:api                               # API + WebSockets on :4000
pnpm dev:web                               # React app on :5173 (proxies /api)
```

To run everything in Docker instead: `docker compose up --build`, then open http://localhost:4000 and run the seed with `docker compose exec app sh -c "cd apps/api && npx tsx prisma/seed.ts"`.

### Tests

```bash
pnpm --filter api test     # unit tests: marking engine, timing, fair paper generator, similarity
pnpm --filter api smoke    # 54-check end-to-end API test against a freshly seeded DB with the API running
pnpm --filter api scenarios  # 62 scenario checks (expiry sweeper, violation limit, device switch, power-cut reopen,
                             # offline merge after deadline, pause/resume, version pinning, disputes, account security).
                             # Rewrites timestamps directly — run it against a dedicated, freshly seeded database:
                             # DATABASE_URL=<test db> API=http://localhost:<port>/api pnpm --filter api scenarios
```

The smoke test covers RBAC, ownership isolation, lifecycle rules, time windows, answer-key secrecy, idempotent autosave, rejecting late answers, single-device sessions, exactly-once submission under concurrent requests, grading validation, publishing guards, analytics, collusion detection, fairness, PDF access control, signature verification, dispute re-grading, sandbox isolation, CSV import validation and audit-chain integrity.

### Deployment

`render.yaml` is a one-click Render Blueprint (free Postgres plus one web service). In production the API also serves the built React app from the **same origin**, so cookies, CORS and WebSockets need no extra configuration. A `Dockerfile` is included for any container host.

---

## Requirement coverage

### Core (Section 03)
| Requirement | Implementation |
|---|---|
| 3.1 Auth & authorization | JWT access token plus httpOnly refresh cookie, bcrypt, login lockout after 5 failures, rate limiting, force password change, logout from all devices. **Three backend layers:** `authenticate` → `requireRole` → resource policies (`core/policy.ts`: an examiner owns the exam; a candidate is enrolled or owns the attempt). Admin user and role management. |
| 3.2 Exam management | Create/edit with schedule, duration, marks, pass mark, access code and rules. Lifecycle `DRAFT → PUBLISHED → ONGOING → COMPLETED → ARCHIVED`; *ongoing* is derived from the **server clock**. Pre-publish checklist (blocking and warning items). Rules on what may change while an exam is live. Close early, pause/resume, duplicate. |
| 3.3 Question bank | Topics, difficulty, tags, **immutable versions** (editing creates v2; attempts keep v1). Single choice, multiple select (all-or-nothing / partial / partial-with-penalty) and written (rubric). Negative marking. Question and option randomisation, **frozen per attempt**. Duplicate detection. |
| 3.4 Candidates | Enrol individually, by group, or by pasted email list. Per-candidate time accommodation (e.g. +25%). Dashboard grouped into *Available / Upcoming / Completed*. Eligibility, window, late-entry cutoff and access code enforced on the server. |
| 3.5 Exam interface | Navigator showing answered / visited / not visited / flagged (colour **plus** shape). Server-authoritative timer. Autosave on every change. Survives refresh. Review screen, then exactly-once submit. Auto-finalised at expiry by a background sweeper, using only answers the server accepted in time. |
| 3.6 Monitoring | Live dashboard over WebSockets: progress, connection state, time left, integrity score. Incident feed with review states (*signals, not proof*). Broadcast or direct announcements. Extend time, force-submit, approve device switches and time compensation. |
| 3.7 Grading | Objective questions graded automatically on submit. Written answers graded question by question, optionally anonymised, with keyboard shortcuts. Marks validated to the range 0 to the question's maximum. Consistent grading state (`PENDING / NEEDS_MANUAL / GRADED`). Changing a grade after publication requires a reason and is audited. |
| 3.8 Results & analytics | Publishing is blocked until every attempt is graded and nobody is still writing. Candidates see only their own results. Exam summary (mean, median, SD, pass rate, distribution), topic performance, rank and percentile. All attempts kept. |

### Secondary (Section 04)
| # | Feature | Implementation |
|---|---|---|
| 4.1 | Network-aware UI | Status pill (Saved / Saving / *n* pending / Offline / Unstable), offline banner, reconnect toast, heartbeat-based detection (not just `navigator.onLine`). |
| 4.2 | PDF reports | Candidate result report and examiner summary report (distribution chart, item analysis, score table), generated server-side with access checks. |
| 4.3 | Sandbox | "Preview as candidate" creates a sandbox attempt that is excluded from every results, analytics and fairness query, and is replaced on each preview. |
| 4.4 | Bulk import | Candidates and questions from CSV or JSON, with a **dry-run preview of row-level errors**, then commit in one transaction. Downloadable templates. |
| 4.5 | Question analytics | Difficulty index, **discrimination index** (top vs bottom 27%), how often each wrong option is picked, skip rate, average time, flagged count, and automatic warnings such as *"possibly ambiguous"*. |
| 4.6 | Verifiable reports | Each report carries a short code and QR code. The payload is **signed with Ed25519**. The public `/verify` page re-checks the signature and shows only initials, exam, score and date. |
| 4.7 | Custom workspace | Theme (light, dark, high contrast), reading font (including Hyperlegible and dyslexia-friendly), text size, line spacing, navigator position, one-per-page or scrolling layout, reduced motion. Saved to the user's profile. |
| 4.8 | Scratchpad | Drawing canvas (pen, eraser, colours, undo), notes and a safe calculator. Autosaved, never graded, visible to the examiner as context. |

---

## Innovation challenges

### 5.3 Failure-resilient examinations (primary)
**Problem:** a dropped connection or dead laptop should not cost a candidate marks, and it should not give anyone extra time either.

- **Local-first answers.** Every change is written to IndexedDB *before* the network. An outbox syncs it with per-question, monotonically increasing sequence numbers, so retries and out-of-order deliveries are harmless (idempotent).
- **Time is never taken from the device clock.** The server sets the deadline. The client estimates server time from a synced offset plus `performance.now()`, which is monotonic and can't be changed by editing the system clock.
- **Offline work after the deadline.** If the connection is down at expiry, answers written offline are still accepted for 10 minutes. The condition is evidence: each answer's claimed time must be **before the deadline** and **after the last moment the server heard from the device**. Anything else is rejected.
- **Evidence-based compensation.** The server logs heartbeat gaps:
  - *Network-only drop, candidate kept working offline* → no time was lost → **no compensation**.
  - *Device or power failure, no activity during the gap* → the system suggests restoring exactly the lost time. If the attempt was auto-submitted meanwhile, approving it **reopens the attempt with the time that remained**.
- **Pause/resume** adds exactly the paused duration to every active attempt.
- **Device switch.** One active device per attempt. A second device needs examiner approval, or is approved automatically once the first device has been silent for 90 s. Saved answers carry over.

### 5.2 Fairness of randomised exams
**Problem:** a random paper can be unluckily harder than someone else's.

- The examiner defines a **blueprint** of topic × difficulty slots.
- Each question has an expected success rate *p*: the label provides the prior (Easy 0.8, Medium 0.55, Hard 0.3), and **real attempt data recalibrates it** with a Bayesian blend (*Recalibrate* button).
- For every candidate the generator samples 60 papers that satisfy the blueprint and keeps the one whose mark-weighted expected score is **closest to the target**, with a small penalty for overlap with papers already issued. The result is equal difficulty *and* meaningful variation.
- A **fairness report** compares 40 simulated fair papers with naive random papers. On the seed data the standard deviation drops from roughly 3.4 to 0.1 percentage points while keeping papers varied. It also lists each issued paper's expected vs actual score.
- Generation is seeded and deterministic, so any paper can be regenerated for audit.

### 5.4 Trust & dispute resolution
- Candidates raise disputes per question or per result (grading error, ambiguous question, technical issue) within a 7-day window, with a required explanation.
- A dispute moves `OPEN → UNDER_REVIEW → UPHELD/REJECTED`. Every decision needs a written reason.
- Upheld disputes apply a concrete remedy:
  - *adjust this score*
  - *accept an additional answer* — re-grades **every** candidate who received that question
  - *void the question* — full marks for everyone
- Affected candidates are notified, and certificates are **re-signed** automatically.
- Every step is written to a **hash-chained audit log** (each row stores `sha256(prevHash + canonical(row))`). The admin dashboard verifies the whole chain, so tampering with any grade, override or decision is detectable.

### 5.1 Integrity in the AI era (privacy-first)
**No webcam, no microphone, no screen capture.**

- **Blocked:** copy, cut, paste, right-click, print, view-source, devtools shortcuts, screenshot keys. Text selection on questions is disabled.
- **Recorded:** tab switches (with time away), focus loss, leaving full screen, a second monitor (`screen.isExtended`), devtools opening, split-screen windows.
- **AI and auto-typer signals:** large blocks of text appearing in a single input event, machine-uniform keystroke rhythm, and runs of answers given in under 2.5 s each.
- **Deterrent watermark:** candidate name, email and attempt ID tiled across the exam, so leaked photos are traceable.
- **Server-side safeguards:** answer keys and rubrics are never sent to the browser. Options are shuffled per candidate. One active device per attempt.
- **Collusion report:** near-identical written answers (3-word shingles, Jaccard similarity) and shared identical wrong objective answers.
- **Signals are evidence, not proof.** Each one becomes a reviewable incident with severity. The only automatic action is the **configurable warning limit**, which candidates see before they start and are reminded of at every warning.

---

## Design: "Graph Notebook"

The interface is styled like rough-work paper. The design is student-friendly, and it ties in with the built-in scratchpad.

**Palette**
- Pen navy `#172A46` for primary actions
- Highlighter `#F7E64A` for the selected answer, active navigation and key words
- Margin red `#E04F5F` for the margin line, the current question and flags
- Grid line `#D6E8F5` for graph-paper backgrounds
- Page `#FFFFFF`

Red, amber and green stay reserved for status. A "night notebook" dark mode and a high-contrast theme are included.

**Type**
- Familjen Grotesk (headings)
- Atkinson Hyperlegible (body, chosen for accessibility)
- JetBrains Mono (timers and codes)

**Motion** (all disabled for *reduce motion*)
- Highlighter swipes on titles and on the selected answer
- Staggered entrances, page transitions and pop-in dialogs
- Confetti on submission and on passing results

**[React Bits](https://reactbits.dev) components** (`apps/web/src/components/bits`)
| Component | Where it is used |
|---|---|
| CursorGrid | Login page: the graph paper lights up under the cursor |
| RotatingText | Login headline |
| HoldButton | **Hold to submit**, which prevents accidental submissions |
| SpringCheck | Honour pledge |
| StatusMark | "Submitted" and "verified" checks |
| FlipCard + CountUp | Result reveal |
| DecryptedText | Verification code |
| ClickSpark | Click sparks in the app shell |
| CountUp | Dashboard stats |

The React Bits registry is configured in `apps/web/components.json`. `.mcp.json` registers the shadcn MCP server, so Claude Code can browse and add React Bits components in this repo.

---

## Architecture

```
React (Vite) SPA ── REST /api ──► Express (TypeScript) ──► PostgreSQL (Prisma)
   │  IndexedDB outbox            │  modules: auth · users · questions · exams ·
   │  server-clock sync           │           candidate · staff · reports · verify
   └─ Socket.IO ◄──────────────── ┤  services: attempts · integrity · certificates
                                  │  domain (pure, unit-tested): marking · examPhase ·
                                  │           fairness · similarity · random
                                  └─ background sweeper: auto-finalise expired attempts
```

**Modular monolith.** Each domain module has its own routes, service and policy layer, and could be split into a service later. We chose this over microservices because a 10-hour build and ACID transactions across attempt, answer and grading favour one deployable unit.

Patterns we can explain in the demo:
- **Attempt snapshot:** `AttemptQuestion` freezes the question version, option order, marks and scheme at start.
- **Exactly-once finalisation:** a conditional `UPDATE … WHERE status='IN_PROGRESS'` plus an idempotency key. Double clicks, retries and the expiry sweeper can race safely.
- **Idempotent autosave:** per-question `clientSeq`; stale writes are ignored.
- **State machines** for exam, attempt, grading and dispute status.
- **Pure domain layer**, unit-tested separately from I/O.
- **Hash-chained audit log** and **Ed25519-signed** certificates.
- Zod validation on every input. A consistent JSON error shape (`{error:{code,message,details}}`). Front-end validation mirrors the backend rules.

### Technology choices
| Choice | Why |
|---|---|
| TypeScript end to end | One language, shared mental model, type safety across the API boundary |
| Express 5 + Zod | Minimal, explicit middleware layers (auth → role → policy); async errors handled natively |
| PostgreSQL + Prisma | Relational integrity (unique constraints prevent duplicate attempts and submissions), transactions, JSONB for flexible settings |
| Socket.IO | Live monitoring, announcements, pause/resume, deadline changes |
| React + TanStack Query + Tailwind v4 | Fast iteration; design tokens as CSS variables make dark and high-contrast themes work everywhere |
| Dexie (IndexedDB) | Durable local storage for the offline outbox |
| pdfkit + qrcode + Node `crypto` | Free, local, no paid APIs (as the rules require) |

### Data model (main tables)
`User`, `Topic`, `Question`, `QuestionVersion`, `Exam`, `ExamQuestion`, `Enrollment`, `Attempt`, `AttemptQuestion` (snapshot), `Answer`, `AttemptEvent` (append-only timeline), `Incident`, `Announcement`, `Scratchpad`, `Certificate`, `Dispute`, `TimeCompensation`, `SessionTransfer`, `Notification`, `AuditLog` (hash chain). See `apps/api/prisma/schema.prisma`.

---

## Assumptions & resolved ambiguities

1. **"Ongoing" status** is not stored. It is derived from the server clock (`PUBLISHED` and inside the window), so there is no cron dependency and no drift.
2. **Attempt deadline** = `min(start + duration × (1 + accommodation) + compensation, window end + accommodation)`. A late starter gets the remaining window, not the full duration.
3. **Multiple-select marking** is configurable per question:
   - *All-or-nothing:* exact set, otherwise 0 (minus any negative mark).
   - *Partial:* proportional credit, but any wrong option scores 0.
   - *Partial with penalty:* each wrong option cancels a right one, floored at 0.
4. **Unanswered questions are never penalised**, even when negative marking is on.
5. **Answers "accepted within the permitted period"** means received by the deadline plus a configurable network grace (default 10 s), or provably written offline before the deadline (see 5.3).
6. **Editing a published exam:** structural fields lock once the exam is live. Only text and *extending* the window are allowed. Questions can only change in `DRAFT`, and unpublishing is allowed only before anyone starts.
7. **Grades after publication** can change only with a recorded reason or through a dispute. Certificates are re-signed and old signatures stop verifying.
8. **Monitoring indicators are not evidence of misconduct.** Incidents default to `OPEN` and need a human decision. Auto-submit happens only at the warning limit the candidate was told about.
9. **Sandbox attempts** belong to the examiner, are flagged `isSandbox`, and are excluded by every results query. Starting a new preview replaces the old one.
10. **Privacy on verification:** the public page shows initials, never full name, email or answers.
11. **Full-screen on unsupported devices** (e.g. iPhone Safari): the exam continues and a note is recorded for the examiner, instead of locking the candidate out.

---

## Suggested 15-minute demo
1. **Admin:** overview, verified audit chain, create a user.
2. **Examiner:** import questions from CSV and show the row-level error preview, then the question bank and versions.
3. **Exam editor:** blueprint, fairness report, review checklist, sandbox preview.
4. **Candidate:** lobby system check, full-screen workspace, a tab switch triggers a warning, scratchpad. **Turn Wi-Fi off:** answers queue. Turn it back on: they sync, and the timer was never paused.
5. **Examiner monitor:** live progress, incidents, announcement, device-switch approval.
6. **Grading** (anonymous) → publish results → **PDF** → scan the **QR** on a phone → verified.
7. **Dispute:** candidate raises one → examiner upholds with *accept answer* → every affected candidate is re-graded, with an audit trail.
