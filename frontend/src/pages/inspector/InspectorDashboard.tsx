import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import DashboardLayout, { StatCard } from '../../components/DashboardLayout';
import { StageBadge, StatusPill } from '../dashboard/FarmerDashboard';

interface Batch {
  id: string; trace_id: string; commodity: string; quantity: number; unit: string;
  current_stage: string; compliance_status: string; destination_country: string | null;
}

export default function InspectorDashboard() {
  const { data } = useQuery({ queryKey: ['all-batches-inspector'], queryFn: () => api<{ batches: Batch[] }>('/batches') });
  const batches = data?.batches ?? [];
  const flagged = batches.filter((b) => b.compliance_status === 'blocked');

  return (
    <DashboardLayout title="Inspector oversight">
      <div className="cards">
        <StatCard label="Batches visible" value={batches.length} accent="var(--brand-blue)" />
        <StatCard label="Blocked" value={flagged.length} accent="var(--brand-primary)" />
      </div>
      <table className="table">
        <thead><tr><th>Trace ID</th><th>Commodity</th><th>Stage</th><th>Compliance</th><th>Destination</th></tr></thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id}>
              <td><a className="mono" href={`/batches/${b.id}`}>{b.trace_id}</a></td>
              <td>{b.commodity}</td>
              <td><StageBadge stage={b.current_stage} /></td>
              <td><StatusPill status={b.compliance_status} /></td>
              <td>{b.destination_country ?? '—'}</td>
            </tr>
          ))}
          {batches.length === 0 && <tr><td colSpan={5} className="muted">No batches visible yet.</td></tr>}
        </tbody>
      </table>
      <p className="muted tiny">Streaming the local-Ollama anomaly summary (M4.2) lands here next.</p>
    </DashboardLayout>
  );
}
