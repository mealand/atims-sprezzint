import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import DashboardLayout, { StatCard } from '../../components/DashboardLayout';
import type { AuthEntity } from '../../lib/types';

interface Entity { id: string; nexus_id: string; name: string; role: string; status: string }

export default function AdminDashboard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['entities'], queryFn: () => api<{ entities: Entity[] }>('/entities') });
  const lifecycle = useMutation({
    mutationFn: (p: { id: string; action: 'verify' | 'suspend' | 'reject' }) =>
      api(`/entities/${p.id}/lifecycle`, { method: 'POST', body: { action: p.action } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entities'] }),
  });
  const [ tab, setTab ] = useState<'pending' | 'all'>('pending');
  const entities = (data?.entities ?? []).filter((e) => (tab === 'pending' ? e.status === 'pending' : true));

  return (
    <DashboardLayout title="Administration — verification & lifecycle">
      <div className="cards">
        <StatCard label="Pending entities" value={(data?.entities ?? []).filter((e) => e.status === 'pending').length} accent="var(--brand-yellow)" />
        <StatCard label="Verified" value={(data?.entities ?? []).filter((e) => e.status === 'verified').length} accent="var(--brand-green)" />
      </div>
      <div className="row tabs">
        {(['pending', 'all'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? 'atims-primary' : ''}>{t}</button>
        ))}
      </div>
      <table className="table">
        <thead><tr><th>Nexus ID</th><th>Name</th><th>Role</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          {entities.map((e) => (
            <tr key={e.id}>
              <td className="mono">{e.nexus_id}</td>
              <td>{e.name}</td>
              <td>{e.role}</td>
              <td>{e.status}</td>
              {e.status === 'pending'
                ? <td><button className="atims-primary" onClick={() => lifecycle.mutate({ id: e.id, action: 'verify' })}>Verify</button></td>
                : <td>
                    <button onClick={() => lifecycle.mutate({ id: e.id, action: 'suspend' })}>Suspend</button>{' '}
                    <button onClick={() => lifecycle.mutate({ id: e.id, action: 'reject' })}>Reject</button>
                  </td>}
            </tr>
          ))}
        </tbody>
      </table>
    </DashboardLayout>
  );
}
