import { apiSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getModel, isStudio, buildParams } from '@/lib/catalog';
import { submit, sandboxFor, MuapiError } from '@/lib/muapi';
import { extractCost, syncGeneration, withSignedUrls } from '@/lib/generations';
import { signedUrl } from '@/lib/storage';

const bad = (error, status = 400) => Response.json({ error }, { status });

export async function POST(req) {
  const s = await apiSession();
  if (s.error) return s.error;
  let body;
  try { body = await req.json(); } catch { return bad('Requisição inválida.'); }

  const studio = isStudio(body.studio) ? body.studio : 'image';
  const model = getModel(studio, body.catalogId);
  if (!model) return bad('Modelo desconhecido.');
  const prompt = String(body.prompt || '').trim().slice(0, 5000);
  if (model.hasPrompt && model.promptRequired && !prompt) return bad('Escreva um prompt.');

  let payload;
  try { payload = buildParams(model, body.params); } catch (e) { return bad(e.message); }
  if (model.hasPrompt && prompt) payload.prompt = prompt;

  // Mídias de referência: só caminhos do próprio usuário no bucket "uploads", nos campos que o modelo declara.
  const admin = supabaseAdmin();
  const sandbox = sandboxFor(s.user); // usuário "só Sandbox" nunca usa a chave real
  const inputFiles = [];
  const sent = body.media && typeof body.media === 'object' ? body.media : {};
  const fromGen = body.fromGenerations && typeof body.fromGenerations === 'object' ? body.fromGenerations : {};
  for (const def of model.media) {
    const genId = typeof fromGen[def.name] === 'string' ? fromGen[def.name] : null;
    if (genId) { // ex.: áudio gerado pelo TTS no passo anterior do Lip Sync
      const { data: src } = await admin.from('atelie_generations').select('user_id,status,outputs').eq('id', genId).maybeSingle();
      const out = src?.outputs?.[0];
      if (!src || src.user_id !== s.user.id || src.status !== 'completed' || !out) return bad('A geração anterior não está disponível.');
      let url = out.remote;
      if (out.path) {
        const { data } = await signedUrl('atelie-outputs', out.path, 6 * 3600);
        url = data?.signedUrl || out.remote;
      }
      payload[def.name] = def.array ? [url] : url;
      inputFiles.push({ field: def.name, kind: def.kind, path: out.path || out.remote, bucket: out.path ? 'outputs' : 'remote' });
      continue;
    }
    const paths = Array.isArray(sent[def.name]) ? sent[def.name] : [];
    if (!paths.length) { if (def.required) return bad(`Envie: ${def.title}.`); continue; }
    const max = def.array ? def.maxItems || 20 : 1;
    if (paths.length > max) return bad(`"${def.title}" aceita no máximo ${max} arquivo(s).`);
    if (!paths.every((p) => typeof p === 'string' && p.startsWith(`${s.user.id}/`) && !p.includes('..'))) return bad('Arquivo inválido.');
    const urls = [];
    for (const p of paths) {
      const { data } = await signedUrl('atelie-uploads', p, 6 * 3600);
      if (!data?.signedUrl) return bad('Não foi possível ler o arquivo enviado.');
      urls.push(data.signedUrl);
      inputFiles.push({ field: def.name, kind: def.kind, path: p });
    }
    payload[def.name] = def.array ? urls : urls[0];
  }

  if (model.needsMedia && !inputFiles.length && !payload.draft_request_id) return bad('Este modelo exige ao menos uma mídia de referência.');

  const { data: row, error: insErr } = await admin.from('atelie_generations').insert({
    user_id: s.user.id, studio, mode: model.mode, model_id: model.id, model_name: model.name,
    endpoint: model.endpoint, prompt, params: body.params || {}, input_files: inputFiles,
    sandbox, status: 'pending',
  }).select().single();
  if (insErr) return bad('Não foi possível registrar a geração.', 500);

  try {
    const res = await submit(model.endpoint, payload, { sandbox });
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

// Histórico do próprio usuário (paginado por cursor de data). ?studio=image|video filtra.
export async function GET(req) {
  const s = await apiSession();
  if (s.error) return s.error;
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 24, 60);
  const before = url.searchParams.get('before');
  const studio = url.searchParams.get('studio');
  let q = supabaseAdmin().from('atelie_generations').select('*').eq('user_id', s.user.id).order('created_at', { ascending: false }).limit(limit);
  if (isStudio(studio)) q = q.eq('studio', studio);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) return bad('Falha ao carregar o histórico.', 500);
  const synced = await Promise.all(data.map((r) => (r.status === 'processing' || r.status === 'pending') ? syncGeneration(r) : r));
  return Response.json(await withSignedUrls(synced.filter(Boolean)));
}
