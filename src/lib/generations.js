import 'server-only';
import { supabaseAdmin } from './supabase/admin';
import { getResult, MuapiError } from './muapi';

const TERMINAL = new Set(['completed', 'failed']);
const MAX_MINUTES = 45;
const SIGNED_TTL = 60 * 60;

export const extractCost = (c) => (c && typeof c === 'object' ? {
  cost_usd: c.amount_usd ?? null,
  cost_credits: c.amount_credits ?? null,
  refunded: c.refunded === true,
} : null);

const extFrom = (url, contentType = '') => {
  const m = /\.(png|jpe?g|webp|avif|gif|mp4|webm|mov|mp3|wav)(?:\?|$)/i.exec(url);
  if (m) return m[1].toLowerCase();
  if (contentType.includes('png')) return 'png';
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("avif")) return "avif";
  if (contentType.includes('mp4')) return 'mp4';
  return 'jpg';
};

// Copia o resultado da MuAPI para o nosso Storage (URLs remotas podem expirar).
async function persistOutput(row, url, index) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const path = `${row.user_id}/${row.id}-${index}.${extFrom(url, res.headers.get('content-type') || '')}`;
    const { error } = await supabaseAdmin().storage.from('atelie-outputs').upload(path, buf, {
      contentType: res.headers.get('content-type') || undefined, upsert: true,
    });
    if (error) throw error;
    return { path, remote: url };
  } catch (e) {
    console.error('[persistOutput]', row.id, e.message);
    return { path: null, remote: url }; // fallback: mantém a URL remota
  }
}

// Consulta a MuAPI e finaliza a geração no banco quando terminar. Idempotente.
export async function syncGeneration(row) {
  if (TERMINAL.has(row.status) || !row.provider_request_id) return row;
  const sb = supabaseAdmin();
  const ageMin = (Date.now() - new Date(row.created_at).getTime()) / 60000;
  let result;
  try {
    result = await getResult(row.provider_request_id);
  } catch (e) {
    if (e instanceof MuapiError && ageMin > MAX_MINUTES) return finish(row, { status: 'failed', error: `Tempo esgotado. ${e.message}` });
    return row; // falha transitória de consulta: tenta de novo no próximo poll
  }
  const status = String(result.status || '').toLowerCase();
  const cost = extractCost(result.cost);

  if (['completed', 'succeeded', 'success'].includes(status)) {
    const urls = (result.outputs || [result.url, result.output?.url]).filter(Boolean);
    if (!urls.length) return finish(row, { status: 'failed', error: 'A MuAPI concluiu, mas não retornou nenhum arquivo.', ...cost });
    const outputs = await Promise.all(urls.map((u, i) => persistOutput(row, u, i)));
    return finish(row, { status: 'completed', outputs, ...(cost || {}), cost_estimated: !cost && row.cost_estimated });
  }
  if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
    const msg = typeof result.error === 'string' ? result.error : result.error?.message || result.message || 'falha na geração';
    return finish(row, { status: 'failed', error: `A geração falhou: ${msg}`,
      ...(cost?.refunded ? { cost_usd: 0, cost_credits: 0, refunded: true, cost_estimated: false } : (cost || {})) });
  }
  if (ageMin > MAX_MINUTES) return finish(row, { status: 'failed', error: 'Tempo esgotado aguardando a MuAPI.' });
  if (row.status !== 'processing') return update(row.id, { status: 'processing' });
  return row;
}

async function update(id, patch) {
  const { data } = await supabaseAdmin().from('atelie_generations').update(patch).eq('id', id).select().single();
  return data;
}
const finish = (row, patch) =>
  update(row.id, { ...patch, finished_at: new Date().toISOString() });

// Acrescenta URLs assinadas (1h) para exibir e baixar as saídas e entradas.
export async function withSignedUrls(rows) {
  const st = supabaseAdmin().storage;
  return Promise.all(rows.map(async (r) => {
    const outputs = await Promise.all((r.outputs || []).map(async (o, i) => {
      if (!o.path) return { url: o.remote, downloadUrl: o.remote };
      const [view, dl] = await Promise.all([
        st.from('atelie-outputs').createSignedUrl(o.path, SIGNED_TTL),
        st.from('atelie-outputs').createSignedUrl(o.path, SIGNED_TTL, { download: `${r.model_id}-${r.id.slice(0, 8)}-${i + 1}.${o.path.split('.').pop()}` }),
      ]);
      return { url: view.data?.signedUrl || o.remote, downloadUrl: dl.data?.signedUrl || o.remote };
    }));
    const inputs = (await Promise.all((r.input_files || []).map(async (p) =>
      (await st.from('atelie-uploads').createSignedUrl(p, SIGNED_TTL)).data?.signedUrl))).filter(Boolean);
    return { ...r, outputs, input_urls: inputs };
  }));
}
