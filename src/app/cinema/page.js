import AppShell from '@/components/AppShell';
import CinemaStudio from '@/components/CinemaStudio';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cinema — Ateliê' };

export default function CinemaPage() {
  return <AppShell active="cinema"><CinemaStudio /></AppShell>;
}
