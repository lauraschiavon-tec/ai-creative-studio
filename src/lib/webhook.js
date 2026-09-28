import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { TERMINAL } from './generations-core';

// Webhook da MuAPI (https://muapi.ai/docs/webhooks): o `?webhook=<url>` do envio faz a MuAPI dar POST na nossa URL ao terminar
// (payload: id, status completed|failed, outputs, error, executionTime, timings; até 3 reenvios com backoff se não respondermos 2xx).
//
// Segurança: a MuAPI não assina o payload, então
//  1) a URL carrega um token HMAC por geração (só nós e a MuAPI a conhecemos): /api/webhooks/muapi/<geração>/<assinatura>;
//  2) o corpo NUNCA é tratado como verdade: serve de gatilho, e o resultado é buscado de novo na MuAPI (chave nossa) antes de gravar;
//  3) o `id` do corpo precisa bater com o request_id que guardamos;
//  4) finalizar é atômico e idempotente (generations-core): chamada repetida ou simultânea com o polling não salva/processa duas vezes.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// MUAPI_WEBHOOK_SECRET (opcional). Sem ela deriva da AISTUDIO_SESSION_SECRET / SUPABASE_SECRET_KEY, que já são segredos do servidor.
function secretKey() {
  const base = process.env.MUAPI_WEBHOOK_SECRET || process.env.AISTUDIO_SESSION_SECRET || process.env.SUPABASE_SECRET_KEY;
  return base ? createHmac('sha256', 'aic-muapi-webhook').update(base).digest() : null;
}

export function signWebhook(id) {
  const k = secretKey();
  return k ? createHmac('sha256', k).update(String(id)).digest('base64url') : null;
}

export function verifyWebhook(id, sig) {
  if (typeof id !== 'string' || !UUID.test(id) || typeof sig !== 'string') return false;
  const want = signWebhook(id);
  if (!want) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

const PRIVATE_HOST = /^(localhost|.*\.(local|internal|localhost))$|^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^169\.254\.|^0\.|^\[?::1?\]?$/i;

// URL que a MuAPI vai chamar, ou null quando não dá para receber webhook (dev/localhost, http, host interno, desligado).
// `baseUrl`: origem pública da requisição (public-url.js); AISTUDIO_PUBLIC_URL sobrescreve (ex.: https://studio.suaempresa.com).
export function webhookUrl(baseUrl, id) {
  if ((process.env.MUAPI_WEBHOOK || '').trim().toLowerCase() === 'off') return null;
  const sig = signWebhook(id);
  if (!sig) return null;
  let u;
  try { u = new URL((process.env.AISTUDIO_PUBLIC_URL || '').trim() || baseUrl); } catch { return null; }
  if (u.protocol !== 'https:' || !u.hostname.includes('.') || PRIVATE_HOST.test(u.hostname)) return null;
  return `${u.origin}/api/webhooks/muapi/${id}/${sig}`;
}

// Processa um webhook já lido da rota. Devolve { status, body } (HTTP). Não-2xx faz a MuAPI reenviar (até 3x); o polling é o plano B.
export async function handleWebhook({ id, sig, payload }, { service, store, log }) {
  if (!verifyWebhook(id, sig)) { log('webhook_rejected', { id }, { reason: 'bad_signature' }); return { status: 401, body: { error: 'unauthorized' } }; }
  const row = await store.get(id);
  if (!row) { log('webhook_rejected', { id }, { reason: 'unknown_generation' }); return { status: 404, body: { error: 'not_found' } }; }
  const info = { received_status: payload?.status, received_id: payload?.id };
  log('webhook_received', row, info);

  if (TERMINAL.has(row.status)) return { status: 200, body: { ok: true, outcome: 'already_final' } }; // duplicado/atrasado: nada a fazer
  if (!row.provider_request_id) return { status: 503, body: { ok: false, outcome: 'no_request_id' } }; // aviso chegou antes de gravarmos o request_id: a MuAPI reenvia
  if (payload?.id && payload.id !== row.provider_request_id) {
    log('webhook_rejected', row, { reason: 'id_mismatch', ...info });
    return { status: 409, body: { error: 'id_mismatch' } };
  }

  const { outcome } = await service.syncGenerationDetailed(row, { source: 'webhook' });
  const ok = outcome === 'finalized' || outcome === 'already_final' || outcome === 'in_progress_elsewhere';
  return { status: ok ? 200 : 503, body: { ok, outcome } };
}
