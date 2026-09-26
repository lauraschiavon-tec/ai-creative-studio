import { apiSession } from '@/lib/auth';
import { getModel, isStudio, buildParams } from '@/lib/catalog';
import { estimateCost, sandboxFor } from '@/lib/muapi';

// Estimativa de custo antes de gerar (só parâmetros; sem mídia). Best-effort: nem todo modelo suporta.
export async function POST(req) {
  const s = await apiSession();
  if (s.error) return s.error;
  try {
    const body = await req.json();
    const model = getModel(isStudio(body.studio) ? body.studio : 'image', body.catalogId);
    if (!model) return Response.json({ available: false });
    const payload = buildParams(model, body.params);
    if (model.hasPrompt) payload.prompt = String(body.prompt || '').slice(0, 5000) || 'estimate';
    const r = await estimateCost(model.endpoint, payload, { sandbox: sandboxFor(s.user) });
    const usd = typeof r.cost === 'number' ? r.cost : r.amount_usd ?? r.cost?.amount_usd;
    return Response.json(typeof usd === 'number' ? { available: true, usd } : { available: false });
  } catch {
    return Response.json({ available: false });
  }
}
