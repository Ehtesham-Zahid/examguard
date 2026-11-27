/** Layer 3: resource-level policies — do you own / are you enrolled in this resource */
import type { AuthUser } from './auth.js';
import { forbidden, notFound } from './errors.js';
import { prisma } from './prisma.js';

export async function loadExamForStaff(user: AuthUser, examId: string) {
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam) throw notFound('Exam not found');
  if (user.role === 'ADMIN') return exam;
  if (user.role === 'EXAMINER' && exam.ownerId === user.id) return exam;
  throw forbidden('You can only manage examinations you own');
}

export async function loadQuestionForStaff(user: AuthUser, questionId: string) {
  const q = await prisma.question.findUnique({ where: { id: questionId } });
  if (!q) throw notFound('Question not found');
  if (user.role === 'ADMIN' || q.ownerId === user.id) return q;
  throw forbidden('You can only edit questions you own');
}

export async function loadAttemptForStaff(user: AuthUser, attemptId: string) {
  const attempt = await prisma.attempt.findUnique({ where: { id: attemptId }, include: { exam: true } });
  if (!attempt) throw notFound('Attempt not found');
  if (user.role === 'ADMIN' || attempt.exam.ownerId === user.id) return attempt;
  throw forbidden();
}

export async function loadOwnAttempt(user: AuthUser, attemptId: string) {
  const attempt = await prisma.attempt.findUnique({ where: { id: attemptId }, include: { exam: true } });
  if (!attempt || attempt.candidateId !== user.id) throw notFound('Attempt not found');
  return attempt;
}
