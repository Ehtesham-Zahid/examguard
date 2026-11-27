import type { Phase, Role } from '@/lib/types';

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type QType = 'SINGLE' | 'MULTI' | 'WRITTEN';
export type MultiScheme = 'ALL_OR_NOTHING' | 'PARTIAL' | 'PARTIAL_NEGATIVE';

export interface ExamSettings {
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  allowBackNav: boolean;
  requireFullscreen: boolean;
  maxViolations: number;
  showCorrectAnswers: boolean;
  lateJoinMin: number;
  gracePeriodSec: number;
  autoCompensate: boolean;
}

export const DEFAULT_SETTINGS: ExamSettings = {
  shuffleQuestions: true,
  shuffleOptions: true,
  allowBackNav: true,
  requireFullscreen: true,
  maxViolations: 5,
  showCorrectAnswers: false,
  lateJoinMin: 0,
  gracePeriodSec: 10,
  autoCompensate: false,
};

export interface ExamStats {
  enrolled: number;
  inProgress: number;
  submitted: number;
  questionCount: number;
}

export interface Slot {
  topicId: string;
  difficulty: Difficulty;
  count: number;
  marks: number;
}

export interface ExamBase {
  id: string;
  title: string;
  description: string;
  instructions: string;
  windowStart: string;
  windowEnd: string;
  durationMin: number;
  totalMarks: number;
  passMarks: number;
  status: 'DRAFT' | 'PUBLISHED' | 'COMPLETED' | 'ARCHIVED';
  mode: 'FIXED' | 'BLUEPRINT';
  blueprint: Slot[] | null;
  pausedAt: string | null;
  publishedAt: string | null;
  resultsPublishedAt: string | null;
  phase: Phase;
  stats: ExamStats;
  createdAt: string;
  updatedAt: string;
}

export interface ExamListItem extends ExamBase {
  hasAccessCode: boolean;
  questionCount: number;
  owner?: { name: string };
  settings: Partial<ExamSettings>;
}

export interface ExamQuestionItem {
  id: string;
  position: number;
  type: QType;
  difficulty: Difficulty;
  topic: string;
  body: string;
  marks: number;
  options: { id: string; text: string }[];
  correct: string[];
  version: number;
}

export interface ExamDetail extends ExamBase {
  accessCode: string | null;
  settings: ExamSettings;
  questions: ExamQuestionItem[];
}

export interface QuestionVersion {
  id: string;
  version: number;
  body: string;
  options: { id: string; text: string }[];
  correct: string[];
  marks: number;
  negativeMarks: number;
  multiScheme: MultiScheme;
  rubric: string | null;
  createdAt: string;
}

export interface QuestionItem {
  id: string;
  ownerId: string;
  topicId: string;
  topic: { id: string; name: string };
  type: QType;
  difficulty: Difficulty;
  tags: string[];
  currentVersion: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  current: QuestionVersion;
  versionCount: number;
  usedInExams: number;
}

export interface QuestionDetail extends QuestionItem {
  versions: QuestionVersion[];
}

export interface Topic {
  id: string;
  name: string;
  questionCount: number;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'ACTIVE' | 'DISABLED';
  groupName: string | null;
  mustChangePassword: boolean;
  createdAt: string;
  lockedUntil: string | null;
}

export interface Group {
  name: string;
  count: number;
}

export interface Enrollment {
  id: string;
  name: string;
  email: string;
  groupName: string | null;
  extraTimePct: number;
  enrolledAt: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'ABSENT';
  attemptId?: string;
  score?: number | null;
  attemptStatus?: string;
}

export interface ReviewCheck {
  label: string;
  ok: boolean;
  blocking: boolean;
  detail?: string;
}

export const DIFFICULTIES: Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];
export const DIFF_LABEL: Record<Difficulty, string> = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' };
