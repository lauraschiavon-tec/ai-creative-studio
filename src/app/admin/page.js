import AppShell from '@/components/AppShell';
import CostDashboard from '@/components/CostDashboard';

export const dynamic = 'force-dynamic';

export default function Admin() {
  return <AppShell active="admin" admin><CostDashboard /></AppShell>;
}
