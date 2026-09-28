import 'server-only';
import { MuapiError } from '../muapi';
import { describeFailure } from '../generations-core';

// HTTP das APIs diretas (BytePlus, OpenAI, Google, Kling). Erros viram MuapiError, o mesmo tipo que o núcleo de geração já entende
// (retryable → tenta de novo no próximo poll; status → resposta da rota). `detail` guarda o motivo ORIGINAL do provedor.
const QUOTA = /quota|credit|balance|billing|exhausted|insufficient|free_tier|resource pack|arrears|overdue/i;
const NOT_OPEN = /ModelNotOpen|not activated|not been activated|not enabled/i;

export function detailOf(text) {
  try {
    const j = JSON.parse(text);
    const e = j?.error ?? j;
    const m = (typeof e === 'string' ? e : e?.message) ?? j?.message ?? j?.detail ?? '';
    const code = e && typeof e === 'object' && e.code != null ? String(e.code) : j?.code != null ? String(j.code) : undefined;
    return { message: String(typeof m === 'string' ? m : JSON.stringify(m)).slice(0, 400), code };
  } catch { return { message: String(text || '').slice(0, 300) }; }
}

export function directError(label, status, text) {
  const { message, code } = detailOf(text);
  const hay = `${code || ''} ${message}`;
  const e = (msg, st, extra = {}) => new MuapiError(msg, st, message, { retryable: false, kind: 'http', httpStatus: status, ...extra });
  if (status === 401 || status === 403) return e(`A chave da API direta (${label}) foi recusada. Avise o administrador.`, 502);
  if (NOT_OPEN.test(hay)) return e(`O modelo não está ativado na conta ${label}. Avise o administrador.`, 502);
  if (status === 402 || QUOTA.test(hay)) return e(`Saldo ou cota da conta ${label} insuficiente. Avise o administrador.`, 402);
  if (status === 429) return e('Muitas requisições. Aguarde alguns instantes e tente de novo.', 429, { retryable: true });
  if (status === 408 || status >= 500) return e(`${label} está indisponível ou instável. Tente novamente em instantes.`, 502, { retryable: true });
  const d = describeFailure(message);
  if (d.kind === 'moderation') return e(d.message, 400, { moderation: true }); // `detail` guarda o motivo original (o núcleo formata a mensagem uma vez só)
  return e(`Parâmetros recusados por ${label}: ${message || `HTTP ${status}`}`, status === 404 ? 502 : 400);
}

// JSON (ou multipart, com `form`). Devolve o corpo já interpretado.
export async function directFetch(label, url, { method = 'POST', headers = {}, json, form, timeout = 30000 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method, cache: 'no-store', signal: AbortSignal.timeout(timeout),
      headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : form,
    });
  } catch (err) {
    throw new MuapiError(`Não foi possível conectar a ${label} (rede ou tempo esgotado).`, 504, String(err), { retryable: true, kind: 'network' });
  }
  const text = await res.text();
  if (!res.ok) throw directError(label, res.status, text);
  try { return JSON.parse(text); } catch { throw new MuapiError(`Resposta inválida de ${label}.`, 502, text.slice(0, 200), { retryable: true, kind: 'parse' }); }
}

// Baixa um arquivo (imagem de entrada, vídeo entregue por URI…) como Buffer.
export async function downloadBuffer(label, url, { headers = {}, timeout = 120000 } = {}) {
  let res;
  try { res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout), cache: 'no-store' }); }
  catch (err) { throw new MuapiError(`Não foi possível baixar o arquivo (${label}).`, 504, String(err), { retryable: true, kind: 'network' }); }
  if (!res.ok) throw new MuapiError(`Não foi possível baixar o arquivo (${label}): HTTP ${res.status}.`, 502, `HTTP ${res.status}`, { retryable: res.status >= 500, kind: 'http', httpStatus: res.status });
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: (res.headers.get('content-type') || '').split(';')[0].trim() };
}
