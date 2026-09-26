import 'server-only';

const BASE = 'https://api.muapi.ai';

export const isSandbox = () => (process.env.MUAPI_ENV || 'sandbox') !== 'production';
// Sandbox para este usuário: app inteiro em Sandbox OU usuário marcado como "só Sandbox" (app_metadata.sandbox_only,
// definido pelo administrador; o usuário não consegue alterar). Nesse caso usa sempre a chave de teste: nunca gasta crédito.
export const sandboxFor = (user) => isSandbox() || user?.app_metadata?.sandbox_only === true;

function apiKey(sandbox) {
  const key = sandbox ? process.env.MUAPI_API_KEY_SANDBOX : process.env.MUAPI_API_KEY;
  if (!key) throw new MuapiError('Chave da MuAPI não configurada no servidor.', 500);
  return key;
}

export class MuapiError extends Error {
  constructor(message, status = 502, detail) { super(message); this.status = status; this.detail = detail; }
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
    throw new MuapiError('Não foi possível conectar à MuAPI (rede ou tempo esgotado).', 504, String(e));
  }
  const text = await res.text();
  if (!res.ok) { const [m, s, d] = friendly(res.status, text); throw new MuapiError(m, s, d); }
  try { return JSON.parse(text); } catch { throw new MuapiError('Resposta inválida da MuAPI.', 502, text.slice(0, 200)); }
}

export const submit = (endpoint, payload, o = {}) => call(`/api/v1/${endpoint}`, { method: 'POST', body: payload, ...o });
export const getResult = (requestId, o = {}) => call(`/api/v1/predictions/${encodeURIComponent(requestId)}/result`, o);
export const estimateCost = (endpoint, payload, o = {}) => call(`/api/v1/models/${endpoint}/estimate-cost`, { method: 'POST', body: payload, timeout: 8000, ...o });
export const getBalance = () => call('/api/v1/account/balance');
