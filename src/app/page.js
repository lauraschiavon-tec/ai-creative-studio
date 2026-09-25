import AppShell from '@/components/AppShell';
import Studio from '@/components/Studio';

export const dynamic = 'force-dynamic';

export default function Home() {
  return <AppShell active="image"><Studio /></AppShell>;
}
