import AppShell from '@/components/AppShell';
import LipSyncStudio from '@/components/LipSyncStudio';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lip Sync — ai-creative' };

export default function LipSyncPage() {
  return <AppShell active="lipsync"><LipSyncStudio /></AppShell>;
}
