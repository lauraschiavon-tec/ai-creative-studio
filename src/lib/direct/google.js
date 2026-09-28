import 'server-only';
import { MuapiError } from '../muapi';
import { directFetch, downloadBuffer } from './http';
import { startJob, readJob, jobId } from './jobs';
import { RATES, round4 } from './pricing';

// Google Gemini API (Nano Banana Pro e Gemini Omni Flash). Chave: GEMINI_API_KEY, com BILLING ativo (sem nível gratuito para estes modelos).
const BASE = () => (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
const auth = () => ({ 'x-goog-api-key': process.env.GEMINI_API_KEY });
const LABEL = 'Google';
const NO_COST = { amount_usd: 0, amount_credits: null, refunded: false };
const mimeOf = (m) => (/^image\//.test(m) ? m : 'image/png');
const inline = async (urls) => Promise.all(urls.map(async (u) => { const f = await downloadBuffer(LABEL, u); return { data: f.buffer.toString('base64'), mime: mimeOf(f.mime) }; }));

// Sem imagem na resposta = bloqueio/recusa. O motivo do Google (ex.: IMAGE_SAFETY, PROHIBITED_CONTENT) vira a mensagem.
export function blockReason(j) {
  const c = j?.candidates?.[0];
  const parts = [j?.promptFeedback?.blockReason, c?.finishReason && c.finishReason !== 'STOP' ? c.finishReason : '', c?.finishMessage,
    ...(c?.content?.parts || []).filter((p) => p.text).map((p) => p.text)].filter(Boolean);
  return parts.join(' — ').slice(0, 400);
}

// ---------- Nano Banana Pro (gemini-3-pro-image) ----------
async function runImage(cfg, p) {
  const imageSize = String(p.resolution || '1k').toUpperCase();
  const refs = cfg.edit ? await inline(Array.isArray(p.images_list) ? p.images_list.filter(Boolean) : []) : [];
  if (cfg.edit && !refs.length) throw new MuapiError('Envie ao menos uma imagem de referência.', 400);
  const body = {
    contents: [{ role: 'user', parts: [{ text: p.prompt }, ...refs.map((r) => ({ inlineData: { mimeType: r.mime, data: r.data } }))] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: p.aspect_ratio || '1:1', imageSize } },
  };
  const j = await directFetch(LABEL, `${BASE()}/models/${cfg.model}:generateContent`, { headers: auth(), json: body, timeout: 300000 });
  const img = (j.candidates?.[0]?.content?.parts || []).find((x) => x.inlineData?.data);
  if (!img) return { status: 'failed', error: blockReason(j) || 'O Google concluiu, mas não retornou nenhuma imagem.', cost: NO_COST };
  const usd = RATES.nanoBananaPro[imageSize];
  return { status: 'completed', outputs: [{ data: Buffer.from(img.inlineData.data, 'base64'), mime: img.inlineData.mimeType || 'image/png' }],
    ...(usd != null ? { cost: { amount_usd: usd, amount_credits: null, refunded: false } } : {}) };
}

export const googleImage = {
  async submit({ cfg, id, payload }) {
    const requestId = jobId('google', id);
    startJob(requestId, () => runImage(cfg, payload));
    return { requestId, cost: this.estimate(cfg, payload) };
  },
  getResult: (requestId) => readJob(requestId),
  estimate(_cfg, p = {}) {
    const usd = RATES.nanoBananaPro[String(p.resolution || '1k').toUpperCase()];
    return usd != null ? { amount_usd: usd, amount_credits: null, refunded: false } : null;
  },
};

// ---------- Gemini Omni Flash (gemini-omni-1.1-flash, Interactions API) ----------
// A API oficial NÃO tem parâmetro de duração (o modelo decide; 3–10 s). Só aspect_ratio, resolution e delivery.
export function omniBody(cfg, p, images) {
  if (p.video_url) throw new MuapiError('Vídeo de referência só existe na MuAPI. Remova o vídeo ou use a MuAPI.', 400);
  if (images.length > 3) throw new MuapiError('A API direta do Gemini Omni aceita até 3 imagens.', 400);
  const input = images.length
    ? [...images.map((i) => ({ type: 'image', data: i.data, mime_type: i.mime })), { type: 'text', text: p.prompt }]
    : p.prompt;
  return { model: cfg.model, input, response_format: { type: 'video', aspect_ratio: p.aspect_ratio || '16:9', resolution: p.resolution || '720p', delivery: 'uri' } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchVideo(uri) {
  const id = /files\/([^:/?]+)/.exec(uri)?.[1];
  for (let i = 0; id && i < 30; i++) { // o arquivo pode estar em PROCESSING logo depois de gerado
    const f = await directFetch(LABEL, `${BASE()}/files/${id}`, { method: 'GET', headers: auth(), timeout: 15000 }).catch(() => null);
    if (!f || f.state === 'ACTIVE' || !f.state) break;
    if (f.state === 'FAILED') throw new MuapiError('O Google não conseguiu preparar o vídeo.', 502, 'file state FAILED');
    await sleep(2000);
  }
  const f = await downloadBuffer(LABEL, uri, { headers: auth(), timeout: 300000 });
  return { data: f.buffer, mime: f.mime.startsWith('video/') ? f.mime : 'video/mp4' };
}

async function runOmni(cfg, p) {
  const urls = [p.first_frame_url, p.last_frame_url, ...(Array.isArray(p.image_urls) ? p.image_urls : [])].filter(Boolean);
  const j = await directFetch(LABEL, `${BASE()}/interactions`, { headers: auth(), json: omniBody(cfg, p, await inline(urls)), timeout: 600000 });
  if (j.status && !['completed', 'succeeded'].includes(String(j.status).toLowerCase())) {
    return { status: 'failed', error: j.error?.message || `status ${j.status}`, cost: NO_COST };
  }
  const items = (j.steps || []).filter((s) => s.type === 'model_output').flatMap((s) => s.content || []);
  const v = items.find((c) => c.type === 'video');
  if (!v) return { status: 'failed', error: items.filter((c) => c.text).map((c) => c.text).join(' ').slice(0, 400) || blockReason(j) || 'O Google concluiu, mas não retornou o vídeo.', cost: NO_COST };
  const out = v.data ? { data: Buffer.from(v.data, 'base64'), mime: v.mime_type || 'video/mp4' } : await fetchVideo(v.uri);
  // Cobrança por tokens de saída (US$ 17,50/1M). Sem `usage` na resposta, estima pelo tempo (~US$ 0,10/s) com duração desconhecida → não afirma valor.
  const tokens = j.usage?.total_output_tokens ?? j.usage?.output_tokens;
  return { status: 'completed', outputs: [out], ...(Number.isFinite(tokens) ? { cost: { amount_usd: round4((tokens * 17.5) / 1e6), amount_credits: null, refunded: false } } : {}) };
}

export const googleOmni = {
  async submit({ cfg, id, payload }) {
    const requestId = jobId('google', id);
    omniBody(cfg, payload, []); // valida cedo (vídeo de referência, etc.) para o erro voltar na hora e não só no fim
    startJob(requestId, () => runOmni(cfg, payload));
    return { requestId, cost: this.estimate() };
  },
  getResult: (requestId) => readJob(requestId),
  // ~US$ 0,10/s em 720p; a duração é do modelo (3–10 s) → faixa típica de 5 s como referência, marcada como estimativa.
  estimate: () => ({ amount_usd: round4(RATES.omniPerSecond * 5), amount_credits: null, refunded: false, estimated: true }),
};
