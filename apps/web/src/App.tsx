import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import type { Role } from '@/lib/types';
import { AppShell } from '@/layouts/AppShell';
import { Spinner } from '@/components/ui';

const Login = lazy(() => import('@/pages/Login'));
const Landing = lazy(() => import('@/pages/Landing'));
const Verify = lazy(() => import('@/pages/Verify'));
const Settings = lazy(() => import('@/pages/Settings'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'));
const AdminUsers = lazy(() => import('@/pages/admin/AdminUsers'));
const AdminAudit = lazy(() => import('@/pages/admin/AdminAudit'));
const ExaminerDashboard = lazy(() => import('@/pages/examiner/ExaminerDashboard'));
const ExamList = lazy(() => import('@/pages/examiner/ExamList'));
const ExamEditor = lazy(() => import('@/pages/examiner/ExamEditor'));
const QuestionBank = lazy(() => import('@/pages/examiner/QuestionBank'));
const Candidates = lazy(() => import('@/pages/examiner/Candidates'));
const Monitor = lazy(() => import('@/pages/examiner/Monitor'));
const Grading = lazy(() => import('@/pages/examiner/Grading'));
const Results = lazy(() => import('@/pages/examiner/Results'));
const AttemptReview = lazy(() => import('@/pages/examiner/AttemptReview'));
const Disputes = lazy(() => import('@/pages/examiner/Disputes'));
const CandidateDashboard = lazy(() => import('@/pages/candidate/CandidateDashboard'));
const ExamLobby = lazy(() => import('@/pages/candidate/ExamLobby'));
const ExamWorkspace = lazy(() => import('@/pages/candidate/ExamWorkspace'));
const MyResults = lazy(() => import('@/pages/candidate/MyResults'));
const ResultDetail = lazy(() => import('@/pages/candidate/ResultDetail'));
const MyDisputes = lazy(() => import('@/pages/candidate/MyDisputes'));

const HOME: Record<Role, string> = { ADMIN: '/admin', EXAMINER: '/examiner', CANDIDATE: '/candidate' };

function Guard({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner label="Restoring your session" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (user.mustChangePassword && loc.pathname !== '/settings') return <Navigate to="/settings?force=1" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={HOME[user.role]} replace />;
  return <>{children}</>;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return <Navigate to={user ? HOME[user.role] : '/login'} replace />;
}

const STAFF: Role[] = ['ADMIN', 'EXAMINER'];

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/verify/:code" element={<Verify />} />
        <Route
          path="/exam/:attemptId"
          element={
            <Guard>
              <ExamWorkspace />
            </Guard>
          }
        />
        <Route
          element={
            <Guard>
              <AppShell />
            </Guard>
          }
        >
          <Route path="/settings" element={<Settings />} />
          <Route path="/admin" element={<Guard roles={['ADMIN']}><AdminDashboard /></Guard>} />
          <Route path="/admin/users" element={<Guard roles={['ADMIN']}><AdminUsers /></Guard>} />
          <Route path="/admin/audit" element={<Guard roles={['ADMIN']}><AdminAudit /></Guard>} />
          <Route path="/examiner" element={<Guard roles={STAFF}><ExaminerDashboard /></Guard>} />
          <Route path="/examiner/exams" element={<Guard roles={STAFF}><ExamList /></Guard>} />
          <Route path="/examiner/exams/:id" element={<Guard roles={STAFF}><ExamEditor /></Guard>} />
          <Route path="/examiner/exams/:id/monitor" element={<Guard roles={STAFF}><Monitor /></Guard>} />
          <Route path="/examiner/exams/:id/grading" element={<Guard roles={STAFF}><Grading /></Guard>} />
          <Route path="/examiner/exams/:id/results" element={<Guard roles={STAFF}><Results /></Guard>} />
          <Route path="/examiner/attempts/:id" element={<Guard roles={STAFF}><AttemptReview /></Guard>} />
          <Route path="/examiner/questions" element={<Guard roles={STAFF}><QuestionBank /></Guard>} />
          <Route path="/examiner/candidates" element={<Guard roles={STAFF}><Candidates /></Guard>} />
          <Route path="/examiner/disputes" element={<Guard roles={STAFF}><Disputes /></Guard>} />
          <Route path="/candidate" element={<Guard roles={['CANDIDATE']}><CandidateDashboard /></Guard>} />
          <Route path="/candidate/exams/:id" element={<Guard roles={['CANDIDATE']}><ExamLobby /></Guard>} />
          <Route path="/candidate/results" element={<Guard roles={['CANDIDATE']}><MyResults /></Guard>} />
          <Route path="/candidate/results/:attemptId" element={<Guard roles={['CANDIDATE']}><ResultDetail /></Guard>} />
          <Route path="/candidate/disputes" element={<Guard roles={['CANDIDATE']}><MyDisputes /></Guard>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
