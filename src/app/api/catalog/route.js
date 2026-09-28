import { apiSession } from '@/lib/auth';
import { listModels, isStudio, catalogMeta } from '@/lib/catalog';
import { directInfo } from '@/lib/direct';

// GET /api/catalog?studio=image|video
// Modelos com API direta (e chave configurada no servidor) trazem `direct`, que faz o Studio mostrar o seletor MuAPI / API direta.
export async function GET(req) {
  const s = await apiSession();
  if (s.error) return s.error;
  const studio = new URL(req.url).searchParams.get('studio') || 'image';
  if (!isStudio(studio)) return Response.json({ error: 'Estúdio inválido.' }, { status: 400 });
  const models = listModels(studio).map((m) => { const direct = directInfo(m.endpoint); return direct ? { ...m, direct } : m; });
  return Response.json({ studio, models, meta: catalogMeta }, { headers: { 'Cache-Control': 'private, max-age=600' } });
}
