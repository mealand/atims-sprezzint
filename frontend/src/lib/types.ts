export interface AuthEntity {
  id: string;
  nexus_id: string;
  name: string;
  role: 'farmer' | 'aggregator' | 'processor' | 'exporter' | 'lab' | 'inspector' | 'regulator' | 'admin';
  status: 'pending' | 'verified' | 'suspended' | 'rejected';
}
