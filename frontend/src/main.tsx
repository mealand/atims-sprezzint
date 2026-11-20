import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import Home from './pages/Home';
import Trace from './pages/Trace';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import VerifyEmail from './pages/auth/VerifyEmail';
import PendingVerification from './pages/auth/PendingVerification';
import RoleDashboard from './pages/dashboards';
import CreateBatch from './pages/dashboards/CreateBatch';
import BatchDetail from './pages/dashboard/BatchDetail';
import HandoverAccept from './pages/handover/HandoverAccept';
import Settings from './pages/Settings';
import Verify from './pages/Verify';
import './styles.css';

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } } });

/** Route guards mirror the API's access rules (api/src/services/access.ts); the API stays the authority. */
const ALL_ROLES = ['farmer', 'aggregator', 'processor', 'exporter', 'lab', 'inspector', 'buyer', 'regulator', 'admin'];
/** Roles that can take custody through a handover (shared/src/roles.ts CUSTODY_ROLES). */
const CUSTODY_ROLES = ['farmer', 'aggregator', 'processor', 'exporter', 'buyer'];

function Loading() {
  return (
    <div role="status" className="flex min-h-dvh items-center justify-center bg-canvas text-sm text-ink-muted">
      <span className="mr-2 size-4 animate-spin rounded-full border-2 border-line-strong border-t-primary" aria-hidden />
      Loading
    </div>
  );
}

function Protected({ allow, children }: { allow: string[]; children: React.ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  if (!allow.includes(me.role)) return <Navigate to="/" replace />;
  return children;
}

function HomeByRole() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <Home />;
  return <RoleDashboard role={me.role} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomeByRole />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/pending" element={<PendingVerification />} />
            <Route path="/settings" element={<Protected allow={ALL_ROLES}><Settings /></Protected>} />
            <Route path="/trace" element={<Trace />} />
            <Route path="/trace/:traceId" element={<Trace />} />
            <Route path="/verify" element={<Verify />} />
            <Route path="/create-batch" element={<Protected allow={['farmer']}><CreateBatch /></Protected>} />
            <Route path="/batches/:id" element={<Protected allow={ALL_ROLES}><BatchDetail /></Protected>} />
            <Route path="/handover/accept" element={<Protected allow={CUSTODY_ROLES}><HandoverAccept /></Protected>} />
            <Route path="/*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
