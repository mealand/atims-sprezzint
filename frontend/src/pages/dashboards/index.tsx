import FarmerDashboard from './FarmerDashboard';
import HandlerDashboard from './HandlerDashboard';
import ExporterDashboard from './ExporterDashboard';
import ReviewerDashboard from './ReviewerDashboard';
import BuyerDashboard from './BuyerDashboard';
import RegulatorDashboard from './RegulatorDashboard';
import AdminDashboard from './AdminDashboard';

/** The signed-in home page: one dashboard per role. */
export default function RoleDashboard({ role }: { role: string }) {
  switch (role) {
    case 'farmer': return <FarmerDashboard />;
    case 'aggregator': return <HandlerDashboard role="aggregator" />;
    case 'processor': return <HandlerDashboard role="processor" />;
    case 'exporter': return <ExporterDashboard />;
    case 'lab': return <ReviewerDashboard role="lab" />;
    case 'inspector': return <ReviewerDashboard role="inspector" />;
    case 'buyer': return <BuyerDashboard />;
    case 'regulator': return <RegulatorDashboard />;
    case 'admin': return <AdminDashboard />;
    default: return <RegulatorDashboard />;
  }
}
