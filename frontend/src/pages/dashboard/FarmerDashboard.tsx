import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import DashboardLayout, { StatCard } from '../../components/DashboardLayout';
import { useAuth } from '../../lib/auth';

interface Batch {
  id: string; trace_id: string; commodity: string; quantity: number; unit: string;
  current_stage: string; compliance_status: string; production_date: string;
}

export default function FarmerDashboard() {
  const { me } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['my-batches'],
    queryFn: () => api<{ batches: Batch[] }>('/batches'),
  });
  const batches = data?.batches ?? [];

  return (
    <DashboardLayout
      title={`Welcome, ${me?.name}`}
      actions={
        <>
          <a href="/create-batch">New batch</a>
          <a href="/trace">Public trace</a>
        </>
      }
    >
      <div className="cards">
        <StatCard label="My batches" value={batches.length} accent="var(--brand-green)" />
        <StatCard label="In transit" value={batches.filter((b) => b.current_stage === 'IN_TRANSIT').length} accent="var(--brand-blue)" />
        <StatCard label="Compliance pending" value={batches.filter((b) => b.compliance_status === 'pending').length} accent="var(--brand-yellow)" />
      </div>

      {isLoading ? <p className="muted">Loading…</p> : (
        <table className="table">
          <thead><tr><th>Trace ID</th><th>Commodity</th><th>Quantity</th><th>Stage</th><th>Status</th></tr></thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <td><a href={`/batches/${b.id}`} className="mono">{b.trace_id}</a></td>
                <td>{b.commodity}</td>
                <td>{b.quantity} {b.unit}</td>
                <td><StageBadge stage={b.current_stage} /></td>
                <td><StatusPill status={b.compliance_status} /></td>
              </tr>
            ))}
            {batches.length === 0 && <tr><td colSpan={5} className="muted">No batches yet — create your first one.</td></tr>}
          </tbody>
        </table>
      )}
    </DashboardLayout>
  );
}

export function StageBadge({ stage }: { stage: string }) {
  return <code className="stage">{stage}</code>;
}

export function StatusPill({ status }: { status: string }) {
  const color = status === 'compliant' ? 'var(--brand-green)'
    : status === 'blocked' ? 'var(--brand-primary)'
    : 'var(--brand-yellow)';
  return <span className="pill" style={{ background: color }}>{status.replace('_', ' ')}</span>;
}
