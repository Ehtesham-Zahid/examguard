/** Response shapes for the staff (examiner) API. Mirrors apps/api/src/modules/staff.routes.ts. */

export type Connection = 'online' | 'unstable' | 'offline' | 'done';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';
export type IncidentStatus = 'OPEN' | 'REVIEWED' | 'DISMISSED' | 'ESCALATED';
export type Decision = 'PENDING' | 'APPROVED' | 'REJECTED';
export type QType = 'SINGLE' | 'MULTI' | 'WRITTEN';

export interface PersonLite {
  id: string;
  name: string;
  email: string;
}

export interface MonitorAttempt {
  id: string;
  candidate: PersonLite;
  status: string;
  startedAt: string;
  deadline: string;
  submittedAt: string | null;
  total: number;
  answered: number;
  flagged: number;
  connection: Connection;
  lastSeenAt: string | null;
  violations: number;
  integrityScore: number;
  openIncidents: number;
  extraTimeSec: number;
}

export interface Incident {
  id: string;
  attemptId: string;
  type: string;
  label: string;
  severity: Severity;
  details: string;
  status: IncidentStatus;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  candidate?: string;
}

export interface CompensationEvidence {
  gapStart?: string;
  gapEnd?: string;
  gapSec?: number;
  remainingAtGapStartSec?: number;
  offlineAnswers?: number;
}

export interface Compensation {
  id: string;
  attemptId: string;
  seconds: number;
  reason: string;
  evidence: CompensationEvidence;
  status: Decision;
  createdAt: string;
  decidedAt: string | null;
  attempt?: { candidate: { name: string }; status: string };
}

export interface Transfer {
  id: string;
  attemptId: string;
  sessionId: string;
  userAgent: string | null;
  ipAddress: string | null;
  reason: string;
  status: Decision;
  createdAt: string;
  decidedAt: string | null;
  attempt?: { candidate: { name: string } };
}

export interface MonitorData {
  serverNow: number;
  exam: { id: string; title: string; pausedAt: string | null; windowStart: string; windowEnd: string; status: string };
  attempts: MonitorAttempt[];
  notStarted: PersonLite[];
  transfers: Transfer[];
  compensations: Compensation[];
  incidents: Incident[];
}

export interface Announcement {
  id: string;
  examId: string;
  candidateId: string | null;
  authorId: string;
  message: string;
  createdAt: string;
}

export interface Option {
  id: string;
  text: string;
}

export interface ReviewQuestion {
  id: string;
  answerId?: string;
  position: number;
  type: QType;
  topic: string;
  body: string;
  options: Option[] | null;
  optionOrder: string[] | null;
  correct: string[];
  rubric: string | null;
  marks: number;
  voided: boolean;
  response: string[] | { text?: string } | null;
  flagged: boolean;
  timeSpentMs: number;
  autoScore: number | null;
  manualScore: number | null;
  feedback: string | null;
  score: number;
}

export interface AttemptEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AttemptDetail {
  attempt: {
    id: string;
    examId: string;
    candidateId: string;
    status: string;
    startedAt: string;
    deadline: string;
    submittedAt: string | null;
    extraTimeSec: number;
    score: number | null;
    maxScore: number;
    gradingStatus: string;
    paperDifficulty: number | null;
    violationCount: number;
    integrityScore: number;
    ipAddress: string | null;
    userAgent: string | null;
    lastHeartbeatAt: string | null;
    exam: { id: string; title: string; passMarks: number; resultsPublishedAt: string | null };
  };
  candidate: { id: string; name: string; email: string; groupName: string | null };
  questions: ReviewQuestion[];
  events: AttemptEvent[];
  incidents: Incident[];
  scratchpad: { canvas: string; notes: string; updatedAt: string } | null;
  compensations: Compensation[];
  transfers: Transfer[];
  disputes: { id: string; status: string; category: string; message: string; attemptQuestionId: string | null }[];
}

export interface AiCriterion {
  criterion: string;
  verdict: 'met' | 'partial' | 'missed';
  comment: string;
}
export interface AiEvidence {
  quote: string;
  supports: string;
  verified: boolean;
}
export type AiFlag = 'blank_or_off_topic' | 'possible_manipulation' | 'rubric_unclear' | 'needs_human_review';
export interface AiSuggestion {
  id: string;
  status: 'READY' | 'FAILED';
  score: number | null;
  maxScore: number;
  confidence: 'high' | 'medium' | 'low' | null;
  summary: string | null;
  criteria: AiCriterion[];
  evidence: AiEvidence[];
  feedback: string | null;
  flags: AiFlag[];
  error: string | null;
  model: string;
  createdAt: string;
  decision: 'ACCEPTED' | 'ADJUSTED' | null;
  finalScore: number | null;
  stale: boolean;
}
export interface AiJob {
  questionId: string | null;
  total: number;
  done: number;
  failed: number;
  running: boolean;
  lastError: string | null;
}
export interface GradingItem {
  ai?: AiSuggestion;
  answerId?: string;
  attemptId: string;
  candidate: string;
  text: string;
  marks: number;
  manualScore: number | null;
  autoScore: number | null;
  feedback: string;
  graded: boolean;
}
export interface GradingGroup {
  questionId: string;
  body: string;
  rubric: string | null;
  marks: number;
  items: GradingItem[];
}
export interface GradingData {
  groups: GradingGroup[];
  progress: { total: number; done: number };
  ai?: { enabled: boolean; model: string; job: AiJob | null };
}

export interface SummaryStats {
  count: number;
  mean: number;
  median: number;
  max: number;
  min: number;
  sd: number;
  passRate: number;
}

export interface ResultRow {
  id: string;
  candidate: { name: string; email: string; groupName: string | null };
  status: string;
  score: number | null;
  maxScore: number;
  gradingStatus: string;
  submittedAt: string | null;
  startedAt: string;
  durationSec: number | null;
  passed: boolean;
  rank: number | null;
  integrityScore: number;
  incidents: number;
  certificateCode?: string;
}
export interface ResultsData {
  exam: { id: string; title: string; totalMarks: number; passMarks: number; resultsPublishedAt: string | null; status: string; windowEnd: string };
  summary: SummaryStats;
  grading: { total: number; graded: number; inProgress: number };
  attempts: ResultRow[];
}

export interface QuestionStats {
  questionId: string;
  body: string;
  type: QType;
  topic: string;
  labelledDifficulty: 'EASY' | 'MEDIUM' | 'HARD';
  observedDifficulty: 'EASY' | 'MEDIUM' | 'HARD';
  calibrated: number | null;
  n: number;
  attempted: number;
  skipRate: number;
  difficultyIndex: number;
  discrimination: number | null;
  avgTimeSec: number;
  flaggedForReview: number;
  options: { id: string; text: string; correct: boolean; picks: number }[];
  flags: string[];
}
export interface AnalyticsData {
  exam: { id: string; title: string; totalMarks: number; passMarks: number; windowStart: string; windowEnd: string; durationMin: number };
  summary: SummaryStats;
  distribution: { label: string; count: number }[];
  avgDurationMin: number;
  avgIntegrity: number;
  topics: { name: string; pct: number }[];
  questions: QuestionStats[];
}

export interface SimilarityData {
  written: { question: string; a: string; b: string; attemptA: string; attemptB: string; similarity: number; excerptA: string; excerptB: string }[];
  identicalWrongAnswers: { a: string; b: string; attemptA: string; attemptB: string; shared: number }[];
  note: string;
}

export interface Dispute {
  id: string;
  attemptId: string;
  attemptQuestionId: string | null;
  category: 'GRADING_ERROR' | 'AMBIGUOUS_QUESTION' | 'TECHNICAL_ISSUE' | 'OTHER';
  message: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'UPHELD' | 'REJECTED';
  resolution: string | null;
  scoreBefore: number | null;
  scoreAfter: number | null;
  affectedCount: number | null;
  createdAt: string;
  resolvedAt: string | null;
  raisedBy: { name: string; email: string };
  attempt: { id: string; score: number | null; maxScore: number; exam: { id: string; title: string } };
  question: {
    position: number;
    body: string;
    type: QType;
    options: Option[] | null;
    correct: string[];
    marks: number;
    response: string[] | { text?: string } | null;
    score: number;
    voided: boolean;
  } | null;
  timeline: { action: string; at: string; data: Record<string, unknown> | null; hash: string }[];
}
