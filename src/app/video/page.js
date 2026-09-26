import AppShell from '@/components/AppShell';
import Studio from '@/components/Studio';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Vídeo — ai-creative' };

export default function VideoPage() {
  return <AppShell active="video"><Studio studio="video" /></AppShell>;
}
