import AppShell from '@/components/AppShell';
import Studio from '@/components/Studio';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Vídeo — Ateliê' };

export default function VideoPage() {
  return <AppShell active="video"><Studio studio="video" /></AppShell>;
}
