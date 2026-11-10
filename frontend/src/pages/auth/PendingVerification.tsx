import { Link } from 'react-router-dom';
import { AuthCard } from './Register';

/** Shown when a verified-style page is visited but the account is still pending/сuspended. */
export default function PendingVerification() {
  return (
    <AuthCard>
      <h2>Account awaiting verification</h2>
      <p style={{ color: 'var(--brand-yellow)' }}>
        Your entity record exists but has not been verified by a Sprezz admin yet.
        Until verified you cannot sign batches or hand over custody.
      </p>
      <Link to="/trace">Verify a batch instead →</Link>
    </AuthCard>
  );
}
