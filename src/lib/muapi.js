import 'server-only';

const BASE = 'https://api.muapi.ai';

// Tolerante a maiúsculas, espaços e aspas (ex.: MUAPI_ENV="Production" ou ' production ').
export const envMode = () => String(process.env.MUAPI_ENV || 'sandbox').trim().replace(/^["']+|["']+$/g, '').trim().toLowerCase();
export const isSandbox = () => envMode() !== 'production';
// O modo de cada usuário (Sandbox/Produção) é resolvido em lib/mode.js; aqui só há a chave usada por requisição.

function apiKey(sandbox) {
  const key = sandbox ? process.env.MUAPI_API_KEY_SANDBOX : process.env.MUAPI_API_KEY;
  if (!key) throw new MuapiError('Chave da MuAPI não configurada no servidor.', 500);
  return key;
}

// Cobrança informada pela MuAPI nos headers x-muapi-cost-usd / -credits / -refunded. Vêm também nas respostas 4xx de job falho
// (ex.: 400 com reembolso: usd=0, credits=0, refunded=true), onde o corpo não traz `cost`. Sem nenhum desses headers → null.
// refunded: true | false | undefined (header ausente = a MuAPI não informou; NÃO significa "não reembolsado").
export function billingFrom(headers) {
  const g = (k) => headers?.get?.(k);
  const [usd, credits, refunded] = [g('x-muapi-cost-usd'), g('x-muapi-cost-credits'), g('x-muapi-cost-refunded')];
  if (usd == null && credits == null && refunded == null) return null;
  const num = (v) => (v != null && String(v).trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  return { usd: num(usd), credits: num(credits), refunded: refunded == null ? undefined : String(refunded).trim().toLowerCase() === 'true' };
}

// extra: { retryable, kind, httpStatus, retryAfterMs, providerFailure, billing }
//  - retryable: vale a pena consultar de novo (rede, 408, 429, 5xx, resposta ilegível). 4xx de verdade não é repetido.
//  - providerFailure: a MuAPI respondeu 4xx com corpo { status: 'failed', error } = o JOB falhou de forma definitiva (ex.: moderação).
export class MuapiError extends Error {
  constructor(message, status = 502, detail, extra = {}) { super(message); this.status = status; this.detail = detail; Object.assign(this, extra); }
}

export const isRetryableStatus = (s) => s === 408 || s === 429 || s >= 500;
const FAILED = new Set(['failed', 'error', 'cancelled', 'canceled']);

// 4xx cujo corpo diz que o job falhou: { detail: { id, status: 'failed', error } } (ou o mesmo no topo). Não vale para 408/429/5xx.
export function providerFailure(httpStatus, text) {
  if (httpStatus < 400 || httpStatus >= 500 || isRetryableStatus(httpStatus)) return null;
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  const o = j?.detail && typeof j.detail === 'object' && !Array.isArray(j.detail) ? j.detail : j;
  if (!o || typeof o !== 'object' || !FAILED.has(String(o.status || '').toLowerCase())) return null;
  const err = o.error ?? o.message;
  const message = typeof err === 'string' ? err : err?.message || (err ? JSON.stringify(err) : '');
  return { id: o.id, message: String(message || '').slice(0, 500) };
}

function friendly(status, text) {
  let detail = text;
  try { const j = JSON.parse(text); detail = j.detail?.[0]?.msg || j.detail || j.error || j.message || text; } catch { /* texto puro */ }
  if (typeof detail !== 'string') detail = JSON.stringify(detail);
  detail = detail.slice(0, 300);
  if (status === 401 || status === 403) return ['A chave da MuAPI foi recusada. Avise o administrador.', 502, detail];
  if (status === 402) return ['Saldo de créditos da MuAPI insuficiente. Avise o administrador.', 402, detail];
  if (status === 404) return ['Modelo indisponível na MuAPI no momento.', 502, detail];
  if (status === 422 || status === 400) return [`Parâmetros recusados pela MuAPI: ${detail}`, 400, detail];
  if (status === 429) return ['Muitas requisições. Aguarde alguns instantes e tente de novo.', 429, detail];
  return ['A MuAPI está indisponível ou instável. Tente novamente em instantes.', 502, detail];
}

async function call(path, { method = 'GET', body, timeout = 30000, sandbox = isSandbox() } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'x-api-key': apiKey(sandbox), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
      cache: 'no-store',
    });
  } catch (e) {
    if (e instanceof MuapiError) throw e;
    throw new MuapiError('Não foi possível conectar à MuAPI (rede ou tempo esgotado).', 504, String(e), { retryable: true, kind: 'network' });
  }
  const text = await res.text();
  const billing = billingFrom(res.headers);
  if (!res.ok) {
    const [m, s, d] = friendly(res.status, text);
    const ra = Number(res.headers.get('retry-after'));
    throw new MuapiError(m, s, d, {
      retryable: isRetryableStatus(res.status), kind: 'http', httpStatus: res.status,
      retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined, providerFailure: providerFailure(res.status, text), billing,
    });
  }
  try {
    const json = JSON.parse(text);
    if (billing && json && typeof json === 'object' && !Array.isArray(json)) json.billing = billing;
    return json;
  } catch { throw new MuapiError('Resposta inválida da MuAPI.', 502, text.slice(0, 200), { retryable: true, kind: 'parse' }); }
}

// Envio: NUNCA é repetido aqui (evita geração/cobrança duplicada). `webhook` (URL https pública) faz a MuAPI avisar quando terminar.
export const submit = (endpoint, payload, { webhook, ...o } = {}) =>
  call(`/api/v1/${endpoint}${webhook ? `?webhook=${encodeURIComponent(webhook)}` : ''}`, { method: 'POST', body: payload, ...o });

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// Consulta do resultado. Repete (curto) só o que é passageiro: rede, 408, 429 (respeita Retry-After) e 5xx.
// Job falho definitivo (4xx com { status: 'failed' } no corpo) NÃO é erro de consulta: volta como { status: 'failed', error }.
// Qualquer outro 4xx é lançado como MuapiError (retryable=false).
export async function getResult(requestId, { attempts = 2, sleep = sleepMs, ...o } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await call(`/api/v1/predictions/${encodeURIComponent(requestId)}/result`, { timeout: 15000, ...o });
    } catch (e) {
      if (e instanceof MuapiError && e.providerFailure) {
        return { id: e.providerFailure.id || requestId, status: 'failed', error: e.providerFailure.message, http_status: e.httpStatus, provider_failure: true, ...(e.billing ? { billing: e.billing } : {}) };
      }
      if (!(e instanceof MuapiError) || !e.retryable || i >= attempts) throw e;
      await sleep(Math.min(e.retryAfterMs ?? 500 * i, 3000));
    }
  }
}
export const estimateCost = (endpoint, payload, o = {}) => call(`/api/v1/models/${endpoint}/estimate-cost`, { method: 'POST', body: payload, timeout: 8000, ...o });
export const getBalance = () => call('/api/v1/account/balance');
