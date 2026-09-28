import 'server-only';
import { MuapiError } from '../muapi';
import { directFetch, directError } from './http';
import { RATES, round4 } from './pricing';

// Kling Open Platform (Kuaishou), modelo kling-v3. Chave: KLING_API_KEY (Authorization: Bearer). Modos aceitos: std, pro, master, 4k.
const BASE = () => (process.env.KLING_BASE_URL || 'https://api-singapore.klingai.com').replace(/\/+$/, '');
const auth = () => ({ Authorization: `Bearer ${process.env.KLING_API_KEY}` });
const LABEL = 'Kling';

export function klingBody(cfg, p) {
  const i2v = cfg.kind === 'image2video';
  if (i2v && !p.image_url) throw new MuapiError('Envie a imagem inicial.', 400);
  return {
    model_name: cfg.model_name, mode: cfg.mode, prompt: String(p.prompt || '').slice(0, 2500), duration: String(p.duration ?? 5),
    sound: p.generate_audio === false ? 'off' : 'on',
    ...(i2v ? { image: p.image_url, ...(p.last_image ? { image_tail: p.last_image } : {}) } : { aspect_ratio: p.aspect_ratio || '16:9' }),
  };
}

// Envelope da Kling: { code, message, data }. code 0 = sucesso; mesmo com HTTP 200 um code ≠ 0 é erro.
function unwrap(j) {
  if (j?.code === 0) return j.data || {};
  const status = /balance|resource pack|insufficient|quota/i.test(j?.message || '') ? 402 : 400;
  throw directError(LABEL, status, JSON.stringify({ code: j?.code, message: j?.message }));
}

// O id guarda o tipo (a consulta usa o mesmo caminho da criação): "image2video:<task_id>".
const split = (id) => { const [kind, ...rest] = String(id).split(':'); return [kind, rest.join(':')]; };

export const kling = {
  async submit({ cfg, payload }) {
    const j = await directFetch(LABEL, `${BASE()}/v1/videos/${cfg.kind}`, { headers: auth(), json: klingBody(cfg, payload) });
    const taskId = unwrap(j).task_id;
    if (!taskId) throw new MuapiError('A Kling não retornou um identificador de geração.', 502, JSON.stringify(j).slice(0, 200));
    return { requestId: `${cfg.kind}:${taskId}`, cost: null };
  },
  async getResult(requestId) {
    const [kind, taskId] = split(requestId);
    const d = unwrap(await directFetch(LABEL, `${BASE()}/v1/videos/${kind}/${encodeURIComponent(taskId)}`, { method: 'GET', headers: auth(), timeout: 15000 }));
    const st = String(d.task_status || '').toLowerCase();
    if (st === 'succeed') {
      const url = d.task_result?.videos?.[0]?.url;
      if (!url) return { id: requestId, status: 'failed', error: 'A Kling concluiu, mas não retornou o vídeo.', cost: { amount_usd: 0, amount_credits: null, refunded: false } };
      const units = Number(d.final_unit_deduction);
      // Unidades debitadas × preço da unit (pacote pré-pago): é uma conversão, não a fatura → marcado como estimado.
      return { id: requestId, status: 'completed', outputs: [url],
        ...(Number.isFinite(units) && units > 0 ? { cost: { amount_usd: round4(units * RATES.klingUnitUsd), amount_credits: null, refunded: false, estimated: true } } : {}) };
    }
    if (st === 'failed') return { id: requestId, status: 'failed', error: d.task_status_msg || 'falha na geração', cost: { amount_usd: 0, amount_credits: null, refunded: false } };
    return { id: requestId, status: 'processing' };
  },
  estimate: () => null, // o consumo em units depende de modo, duração e áudio; só há valor depois de gerar
};
