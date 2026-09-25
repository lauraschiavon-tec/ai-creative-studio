import { apiSession } from '@/lib/auth';
import { listModels, isStudio, catalogMeta } from '@/lib/catalog';

// GET /api/catalog?studio=image|video
export async function GET(req) {
  const s = await apiSession();
  if (s.error) return s.error;
  const studio = new URL(req.url).searchParams.get('studio') || 'image';
  if (!isStudio(studio)) return Response.json({ error: 'Estúdio inválido.' }, { status: 400 });
  return Response.json({ studio, models: listModels(studio), meta: catalogMeta }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
}
