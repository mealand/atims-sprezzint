import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import Home from './pages/Home';
import Trace from './pages/Trace';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import PendingVerification from './pages/auth/PendingVerification';
import FarmerDashboard from './pages/dashboard/FarmerDashboard';
import CreateBatch from './pages/dashboard/CreateBatch';
import BatchDetail from './pages/dashboard/BatchDetail';
import HandoverAccept from './pages/handover/HandoverAccept';
import AdminDashboard from './pages/admin/AdminDashboard';
import InspectorDashboard from './pages/inspector/InspectorDashboard';
import Settings from './pages/Settings';
import Verify from './pages/Verify';
import './styles.css';

const qc = new QueryClient();

function Protected({ allow, children }: { allow: string[]; children: React.ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <p className="center muted">Loading…</p>;
  if (!me) return <Navigate to="/login" replace />;
  if (!allow.includes(me.role)) return <Navigate to="/" replace />;
  return children;
}

function HomeByRole() {
  const { me, loading } = useAuth();
  if (loading) return <p className="center muted">Loading…</p>;
  if (!me) return <Home />;
  switch (me.role) {
    case 'admin': return <AdminDashboard />;
    case 'inspector': case 'regulator': return <InspectorDashboard />;
    case 'farmer': return <FarmerDashboard />;
    default: return <FarmerDashboard />; // holder-style batches list for aggregator/processor/exporter/lab
  }
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
            <Route path="/pending" element={<PendingVerification />} />
            <Route path="/settings" element={<Protected allow={['farmer','aggregator','processor','exporter','lab','inspector','regulator','admin']}><Settings /></Protected>} />
            <Route path="/trace" element={<Trace />} />
            <Route path="/trace/:traceId" element={<Trace />} />
            <Route path="/verify" element={<Verify />} />
            <Route path="/create-batch" element={<Protected allow={['farmer']}><CreateBatch /></Protected>} />
            <Route path="/batches/:id" element={<Protected allow={['farmer','aggregator','processor','exporter','lab','inspector','admin']}><BatchDetail /></Protected>} />
            <Route path="/handover/accept" element={<Protected allow={['farmer','aggregator','processor','exporter','lab','admin']}><HandoverAccept /></Protected>} />
            <Route path="/*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
