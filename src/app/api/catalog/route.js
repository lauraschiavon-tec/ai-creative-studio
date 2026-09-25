import { apiSession } from '@/lib/auth';
import { listImageModels } from '@/lib/catalog';

export async function GET() {
  const s = await apiSession();
  if (s.error) return s.error;
  return Response.json({ image: listImageModels() }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
}
