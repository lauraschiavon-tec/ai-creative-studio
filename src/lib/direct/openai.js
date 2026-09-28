import 'server-only';
import { MuapiError } from '../muapi';
import { directFetch, downloadBuffer } from './http';
import { startJob, readJob, jobId } from './jobs';
import { RATES, round4 } from './pricing';

// OpenAI GPT Image 2.5 (flare = rápido, sunburst = edição precisa). Chave: OPENAI_API_KEY. Pode exigir "Organization Verification".
const BASE = () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const auth = () => ({ Authorization: `Bearer ${process.env.OPENAI_API_KEY}` });
const LABEL = 'OpenAI';

// Regras do `size`: lados múltiplos de 16, maior lado ≤ 3840, proporção ≤ 3:1, 655.360 ≤ pixels ≤ 8.294.400.
const MAX_PX = 8_294_400, MIN_PX = 655_360, MAX_EDGE = 3840, LONG = { '1K': 1024, '2K': 2048, '4K': 3840 };
export function openaiSize(aspect = 'auto', resolution = '2K') {
  if (aspect === 'auto') return 'auto';
  const [a, b] = String(aspect).split(':').map(Number);
  if (!(a > 0 && b > 0)) return 'auto';
  const long = LONG[resolution] || 2048;
  let w = a >= b ? long : (long * a) / b;
  let h = a >= b ? (long * b) / a : long;
  if (w * h > MAX_PX) { const k = Math.sqrt(MAX_PX / (w * h)); w *= k; h *= k; }
  if (w * h < MIN_PX) { const k = Math.sqrt(MIN_PX / (w * h)); w *= k; h *= k; }
  // Entre os arredondamentos (para baixo/cima, múltiplos de 16) que respeitam TODOS os limites, escolhe o de proporção mais próxima.
  const want = a / b;
  let best = null;
  for (const W of [Math.floor(w / 16) * 16, Math.ceil(w / 16) * 16]) for (const H of [Math.floor(h / 16) * 16, Math.ceil(h / 16) * 16]) {
    if (W < 16 || H < 16 || W * H < MIN_PX || W * H > MAX_PX || W > MAX_EDGE || H > MAX_EDGE) continue;
    const err = Math.abs(W / H - want);
    if (!best || err < best.err) best = { W, H, err };
  }
  return best ? `${best.W}x${best.H}` : 'auto';
}

const extOf = (mime) => ({ 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime] || 'png');

async function run(cfg, p) {
  const size = openaiSize(p.aspect_ratio, p.resolution);
  const quality = p.quality || 'high';
  let j;
  if (cfg.edit) {
    const urls = Array.isArray(p.images_list) ? p.images_list.filter(Boolean) : [];
    if (!urls.length) throw new MuapiError('Envie ao menos uma imagem de referência.', 400);
    const form = new FormData();
    form.append('model', cfg.model); form.append('prompt', p.prompt); form.append('size', size); form.append('quality', quality); form.append('n', '1');
    const files = await Promise.all(urls.map((u) => downloadBuffer(LABEL, u)));
    files.forEach((f, i) => form.append('image[]', new Blob([f.buffer], { type: f.mime || 'image/png' }), `image-${i + 1}.${extOf(f.mime)}`));
    j = await directFetch(LABEL, `${BASE()}/images/edits`, { headers: auth(), form, timeout: 600000 });
  } else {
    j = await directFetch(LABEL, `${BASE()}/images/generations`, { headers: auth(), json: { model: cfg.model, prompt: p.prompt, size, quality, n: 1 }, timeout: 600000 });
  }
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) return { status: 'failed', error: 'A OpenAI concluiu, mas não retornou nenhuma imagem.', cost: { amount_usd: 0, amount_credits: null, refunded: false } };
  return { status: 'completed', outputs: [{ data: Buffer.from(b64, 'base64'), mime: `image/${j.output_format || 'png'}` }], cost: costFromUsage(j.usage) };
}

// Tokens reais devolvidos pela API × tarifas oficiais. Sem `usage`, não afirma valor.
export function costFromUsage(u) {
  if (!u) return undefined;
  const d = u.input_tokens_details || {};
  const textIn = d.text_tokens ?? Math.max(0, (u.input_tokens ?? 0) - (d.image_tokens ?? 0));
  const usd = (textIn * RATES.openai.textIn + (d.image_tokens ?? 0) * RATES.openai.imageIn + (u.output_tokens ?? 0) * RATES.openai.imageOut) / 1e6;
  return Number.isFinite(usd) ? { amount_usd: round4(usd), amount_credits: null, refunded: false } : undefined;
}

export const openai = {
  async submit({ cfg, id, payload }) {
    const requestId = jobId('openai', id);
    startJob(requestId, () => run(cfg, payload));
    return { requestId, cost: null };
  },
  getResult: (requestId) => readJob(requestId),
  estimate: () => null, // preço por tokens: só se sabe depois de gerar
};
