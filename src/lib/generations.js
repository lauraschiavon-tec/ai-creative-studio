import 'server-only';
import { supabaseAdmin } from './supabase/admin';
import { getResult } from './muapi';
import { isDirectRow, directGetResult } from './direct';
import { putObject, signedUrl } from './storage';
import { store } from './generation-store';
import { createGenerationService, extractCost, logEvent } from './generations-core';

const SIGNED_TTL = 60 * 60;
export { extractCost, logEvent };

// Reparo: se uma saída ficou só com a URL remota (Storage indisponível na hora), tenta copiar de novo (até 20h após criar).
export async function repairOutputs(row) {
  if (row.status !== 'completed' || !row.outputs?.some((o) => !o.path && o.remote)) return row;
  if (Date.now() - new Date(row.created_at).getTime() > 20 * 3600 * 1000) return row;
  const outputs = await Promise.all(row.outputs.map((o, i) => (o.path || !o.remote ? o : persistOutput(row, o.remote, i))));
  if (!outputs.some((o, i) => o.path && !row.outputs[i].path)) return row;
  return (await update(row.id, { outputs })) || row;
}

const extFrom = (url, contentType = '') => {
  if (contentType.includes('mpeg') && contentType.startsWith('audio')) return 'mp3';
  const m = /\.(png|jpe?g|webp|avif|gif|mp4|webm|mov|mp3|wav)(?:\?|$)/i.exec(url);
  if (m) return m[1].toLowerCase();
  if (contentType.includes('png')) return 'png';
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("avif")) return "avif";
  if (contentType.includes('mp4')) return 'mp4';
  return 'jpg';
};

// Copia o resultado para o nosso Storage (URLs remotas podem expirar). A saída é uma URL ou, nas APIs diretas síncronas, os bytes { data, mime }.
async function persistOutput(row, url, index) {
  if (url && typeof url === 'object' && url.data) { // os bytes só existem em memória: se falhar, LANÇA (o núcleo devolve a vez e o próximo poll tenta de novo)
    const path = `${row.user_id}/${row.id}-${index}.${extFrom('', url.mime || '')}`;
    const { error } = await putObject('atelie-outputs', path, url.data, { contentType: url.mime || undefined, upsert: true });
    if (error) throw new Error(`Falha ao salvar o resultado: ${error.message || error}`);
    return { path, remote: null };
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const path = `${row.user_id}/${row.id}-${index}.${extFrom(url, res.headers.get('content-type') || '')}`;
    const { error } = await putObject('atelie-outputs', path, buf, {
      contentType: res.headers.get('content-type') || undefined, upsert: true,
    });
    if (error) throw error;
    return { path, remote: url };
  } catch (e) {
    console.error('[persistOutput]', row.id, e.message);
    return { path: null, remote: url }; // fallback: mantém a URL remota
  }
}

// Polling e webhook usam o mesmo serviço (ver generations-core.js): consulta a MuAPI e finaliza a geração de forma atômica e idempotente.
// A consulta vai para a MuAPI ou, nas gerações de API direta (coluna provider ≠ muapi), para o adaptador do provedor.
const routedGetResult = (id, o) => (isDirectRow(o?.row) ? directGetResult(o.row, id) : getResult(id, o));
export const { syncGeneration, syncGenerationDetailed } = createGenerationService({ store, getResult: routedGetResult, persist: persistOutput });

// Vigia de servidor para API direta (não há webhook): confere a geração a cada poucos segundos até terminar, mesmo com a página fechada.
// Se o servidor reiniciar, o polling do navegador/histórico continua cobrindo os provedores assíncronos.
export function watchDirect(rowId, { every = 5000, maxMs = 50 * 60 * 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  return (async () => {
    const end = Date.now() + maxMs;
    while (Date.now() < end) {
      await sleep(every);
      try {
        const row = await store.get(rowId);
        if (!row) return;
        const r = await syncGenerationDetailed(row, { source: 'watch' });
        if (r.outcome === 'finalized' || r.outcome === 'already_final') return;
      } catch (e) { console.error('[gen] vigia:', rowId, e?.message); }
    }
  })();
}

const update = (id, patch) => store.update(id, patch);

// Tipo da mídia pela extensão; se for desconhecida, usa o tipo do estúdio como pista (URLs de CDN às vezes não têm extensão).
export function kindOf(url = '', studio = 'image') {
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) return 'video';
  if (/\.(mp3|wav|m4a|ogg|aac|flac)(\?|$)/i.test(url)) return 'audio';
  if (/\.(png|jpe?g|webp|avif|gif)(\?|$)/i.test(url)) return 'image';
  return studio === 'video' ? 'video' : studio === 'audio' ? 'audio' : 'image';
}

// Acrescenta URLs assinadas (1h) para exibir e baixar as saídas e as mídias enviadas.
export async function withSignedUrls(rows) {
  const st = supabaseAdmin().storage;
  return Promise.all(rows.map(async (r) => {
    const outputs = await Promise.all((r.outputs || []).map(async (o, i) => {
      if (!o.path) return { url: o.remote, downloadUrl: o.remote, kind: kindOf(o.remote, r.studio) };
      const [view, dl] = await Promise.all([
        signedUrl('atelie-outputs', o.path, SIGNED_TTL),
        signedUrl('atelie-outputs', o.path, SIGNED_TTL, { download: `${r.model_id}-${r.id.slice(0, 8)}-${i + 1}.${o.path.split('.').pop()}` }),
      ]);
      return { url: view.data?.signedUrl || o.remote, downloadUrl: dl.data?.signedUrl || o.remote, kind: kindOf(o.path, r.studio) };
    }));
    // input_files: [{ field, kind, path }] (linhas antigas: lista de caminhos de imagem)
    const inputs = (await Promise.all((r.input_files || []).map(async (f) => {
      const item = typeof f === 'string' ? { field: 'image', kind: 'image', path: f } : f;
      const url = item.bucket === 'remote' ? item.path
        : (await signedUrl(item.bucket === 'outputs' ? 'atelie-outputs' : 'atelie-uploads', item.path, SIGNED_TTL)).data?.signedUrl;
      return url ? { field: item.field, kind: item.kind, url } : null;
    }))).filter(Boolean);
    return { ...r, outputs, input_urls: inputs };
  }));
}
