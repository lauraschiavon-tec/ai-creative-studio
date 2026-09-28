import 'server-only';
import { MuapiError } from '../muapi';
import { directFetch } from './http';
import { startJob, readJob, jobId } from './jobs';
import { RATES, round4 } from './pricing';

// BytePlus ModelArk (ByteDance). Uma chave (BYTEPLUS_API_KEY) para Seedream e Seedance. Os modelos precisam estar ATIVADOS no Ark Console.
const base = () => (process.env.BYTEPLUS_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/+$/, '');
const auth = () => ({ Authorization: `Bearer ${process.env.BYTEPLUS_API_KEY}` });
const LABEL = 'BytePlus';

// ---------- Seedream 5.0 (imagem) ----------
// Tamanhos exatos por proporção. Seedream 5.0 exige ≥ ~3,7 MP: "2K" para basic, "3K" para high. (Pro: 1K→2K, 2K→3K.) Conferir após ativar o modelo.
export const SIZES = {
  '2K': { '1:1': '2048x2048', '4:3': '2304x1728', '3:4': '1728x2304', '16:9': '2560x1440', '9:16': '1440x2560', '3:2': '2496x1664', '2:3': '1664x2496', '21:9': '3024x1296' },
  '3K': { '1:1': '3072x3072', '4:3': '3456x2592', '3:4': '2592x3456', '16:9': '4096x2304', '9:16': '2304x4096', '3:2': '3744x2496', '2:3': '2496x3744', '21:9': '4704x2016' },
};
export function seedreamSize(cfg, p = {}) {
  const tier = cfg.tier === 'pro' ? (p.resolution === '2K' ? '3K' : '2K') : (p.quality === 'high' ? '3K' : '2K');
  return SIZES[tier][p.aspect_ratio] || SIZES[tier]['1:1'];
}

function seedreamBody(cfg, p) {
  const images = Array.isArray(p.images_list) ? p.images_list.filter(Boolean) : [];
  return {
    model: cfg.model, prompt: p.prompt, size: seedreamSize(cfg, p), response_format: 'url', watermark: false,
    // `sequential_image_generation` só existe no tier Lite (o Pro recusa o parâmetro com 400 InvalidParameter). Sem ele, o padrão já é 1 imagem.
    ...(cfg.tier === 'lite' ? { sequential_image_generation: 'disabled' } : {}),
    ...(images.length ? { image: images.length === 1 ? images[0] : images } : {}),
  };
}

async function runSeedream(cfg, p) {
  const j = await directFetch(LABEL, `${base()}/images/generations`, { headers: auth(), json: seedreamBody(cfg, p), timeout: 240000 });
  const urls = (j.data || []).map((d) => d?.url).filter(Boolean);
  if (!urls.length) return { status: 'failed', error: j.error?.message || 'O BytePlus concluiu, mas não retornou nenhuma imagem.', cost: { amount_usd: 0, amount_credits: null, refunded: false } };
  const unit = RATES.seedreamImage[cfg.tier];
  return { status: 'completed', outputs: urls, ...(unit != null ? { cost: { amount_usd: round4(unit * urls.length), amount_credits: null, refunded: false, estimated: true } } : {}) };
}

export const seedream = {
  async submit({ cfg, id, payload }) {
    const requestId = jobId('byteplus', id);
    startJob(requestId, () => runSeedream(cfg, payload));
    return { requestId, cost: this.estimate(cfg, payload) };
  },
  getResult: (requestId) => readJob(requestId),
  estimate(cfg) {
    const unit = RATES.seedreamImage[cfg.tier];
    return unit != null ? { amount_usd: unit, amount_credits: null, refunded: false, estimated: true } : null;
  },
};

// ---------- Seedance 2.5 (vídeo) ----------
export function seedanceBody(cfg, p) {
  if (p.draft || p.draft_request_id) throw new MuapiError('Rascunho (draft) só existe na MuAPI. Desmarque "Draft" ou use a MuAPI.', 400);
  if (p.resolution === '1080p' || p.resolution === '4k') throw new MuapiError('A API direta do Seedance 2.5 vai até 720p. Use 480p/720p ou escolha a MuAPI para 1080p/4K.', 400);
  if (!p.prompt && !p.image_url) throw new MuapiError('Escreva um prompt ou envie uma imagem.', 400);
  const content = [];
  if (p.prompt) content.push({ type: 'text', text: p.prompt });
  if (p.image_url) content.push({ type: 'image_url', image_url: { url: p.image_url }, role: 'first_frame' });
  return {
    model: cfg.model, content, resolution: p.resolution || '720p', ratio: p.aspect_ratio || '16:9', duration: p.duration ?? 5, watermark: false,
    ...(Number.isInteger(p.seed) && p.seed >= 0 ? { seed: p.seed } : {}),
  };
}
const seedanceEstimate = (p = {}) => {
  const rate = RATES.seedance.perSecond[p.resolution || '720p'];
  return rate ? { amount_usd: round4(rate * (p.duration ?? 5)), amount_credits: null, refunded: false, estimated: true } : null;
};

const TASK_OK = new Set(['succeeded']);
const TASK_FAIL = new Set(['failed', 'cancelled', 'canceled', 'expired']);

export const seedance = {
  async submit({ cfg, payload }) {
    const body = seedanceBody(cfg, payload);
    const j = await directFetch(LABEL, `${base()}/contents/generations/tasks`, { headers: auth(), json: body });
    if (!j.id) throw new MuapiError('O BytePlus não retornou um identificador de geração.', 502, JSON.stringify(j).slice(0, 200));
    return { requestId: j.id, cost: seedanceEstimate(payload) };
  },
  async getResult(requestId) {
    const j = await directFetch(LABEL, `${base()}/contents/generations/tasks/${encodeURIComponent(requestId)}`, { method: 'GET', headers: auth(), timeout: 15000 });
    const st = String(j.status || '').toLowerCase();
    if (TASK_OK.has(st)) {
      const url = j.content?.video_url;
      if (!url) return { id: requestId, status: 'failed', error: 'O BytePlus concluiu, mas não retornou o vídeo.', cost: { amount_usd: 0, amount_credits: null, refunded: false } };
      const tokens = j.usage?.completion_tokens;
      return {
        id: requestId, status: 'completed', outputs: [url],
        ...(Number.isFinite(tokens) ? { cost: { amount_usd: round4((tokens * RATES.seedance.perMillionTokens) / 1e6), amount_credits: null, refunded: false } } : {}),
      };
    }
    if (TASK_FAIL.has(st)) {
      const e = j.error || {};
      return { id: requestId, status: 'failed', error: [e.code, e.message].filter(Boolean).join(': ') || `tarefa ${st}`, cost: { amount_usd: 0, amount_credits: null, refunded: false } }; // falha não é cobrada
    }
    return { id: requestId, status: 'processing' };
  },
  estimate: (_cfg, p) => seedanceEstimate(p),
};
