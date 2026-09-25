import { apiSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getImageModel, buildParams } from '@/lib/catalog';
import { submit, isSandbox, MuapiError } from '@/lib/muapi';
import { extractCost, syncGeneration, withSignedUrls } from '@/lib/generations';

const bad = (error, status = 400) => Response.json({ error }, { status });

export async function POST(req) {
  const s = await apiSession();
  if (s.error) return s.error;
  let body;
  try { body = await req.json(); } catch { return bad('Requisição inválida.'); }

  const model = getImageModel(body.catalogId);
  if (!model) return bad('Modelo desconhecido.');
  const prompt = String(body.prompt || '').trim().slice(0, 5000);
  if (model.hasPrompt && (model.mode === 't2i' || model.promptRequired) && !prompt) return bad('Escreva um prompt.');

  let payload;
  try { payload = buildParams(model, body.params); } catch (e) { return bad(e.message); }
  if (prompt) payload.prompt = prompt;

  // Imagens de referência: só caminhos do próprio usuário no bucket "uploads".
  const files = Array.isArray(body.inputFiles) ? body.inputFiles : [];
  if (model.mode === 'i2i') {
    if (!files.length) return bad('Envie ao menos uma imagem de referência.');
    if (files.length > model.maxImages) return bad(`Este modelo aceita no máximo ${model.maxImages} imagem(ns).`);
    if (!files.every((p) => typeof p === 'string' && p.startsWith(`${s.user.id}/`) && !p.includes('..'))) return bad('Arquivo inválido.');
    const sb = supabaseAdmin();
    const urls = [];
    for (const p of files) {
      const { data } = await sb.storage.from('atelie-uploads').createSignedUrl(p, 6 * 3600);
      if (!data?.signedUrl) return bad('Não foi possível ler a imagem enviada.');
      urls.push(data.signedUrl);
    }
    payload[model.imageField] = model.imageField.endsWith('_list') || model.maxImages > 1 ? urls : urls[0];
  }

  const admin = supabaseAdmin();
  const { data: row, error: insErr } = await admin.from('atelie_generations').insert({
    user_id: s.user.id, studio: 'image', mode: model.mode, model_id: model.modelId, model_name: model.name,
    endpoint: model.endpoint, prompt, params: body.params || {}, input_files: model.mode === 'i2i' ? files : [],
    sandbox: isSandbox(), status: 'pending',
  }).select().single();
  if (insErr) return bad('Não foi possível registrar a geração.', 500);

  try {
    const res = await submit(model.endpoint, payload);
    const requestId = res.request_id || res.id;
    if (!requestId) throw new MuapiError('A MuAPI não retornou um identificador de geração.', 502, JSON.stringify(res).slice(0, 200));
    const cost = extractCost(res.cost);
    const { data } = await admin.from('atelie_generations').update({
      provider_request_id: requestId, status: 'processing', ...(cost || {}),
    }).eq('id', row.id).select().single();
    const synced = await syncGeneration(data); // no sandbox já conclui na hora
    return Response.json((await withSignedUrls([synced]))[0], { status: 201 });
  } catch (e) {
    const msg = e instanceof MuapiError ? e.message : 'Erro inesperado ao enviar a geração.';
    if (!(e instanceof MuapiError)) console.error(e);
    await admin.from('atelie_generations').update({ status: 'failed', error: msg, cost_usd: 0, cost_credits: 0, finished_at: new Date().toISOString() }).eq('id', row.id);
    return bad(msg, e instanceof MuapiError ? e.status : 500);
  }
}

// Histórico do próprio usuário (paginado por cursor de data).
export async function GET(req) {
  const s = await apiSession();
  if (s.error) return s.error;
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 24, 60);
  const before = url.searchParams.get('before');
  let q = supabaseAdmin().from('atelie_generations').select('*').eq('user_id', s.user.id).order('created_at', { ascending: false }).limit(limit);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) return bad('Falha ao carregar o histórico.', 500);
  const synced = await Promise.all(data.map((r) => (r.status === 'processing' || r.status === 'pending') ? syncGeneration(r) : r));
  return Response.json(await withSignedUrls(synced.filter(Boolean)));
}
