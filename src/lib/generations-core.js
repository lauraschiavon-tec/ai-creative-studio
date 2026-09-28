import 'server-only';
import { MuapiError } from './muapi';

// Núcleo (sem Supabase/Storage): recebe `store`, `getResult` e `persist` por injeção, para ser testado com Sandbox/mocks.
// Quem finaliza uma geração — polling do navegador OU webhook da MuAPI — passa por aqui, e só um dos dois consegue (ver `finalize`).

export const TERMINAL = new Set(['completed', 'failed']);
export const MAX_MINUTES = 45;
const CLAIM_STALE_MS = 3 * 60 * 1000; // uma finalização "esquecida" (servidor caiu no meio) pode ser retomada depois disso
const OK = new Set(['completed', 'succeeded', 'success']);
const FAIL = new Set(['failed', 'error', 'cancelled', 'canceled']);

export const extractCost = (c) => (c && typeof c === 'object' ? {
  cost_usd: c.amount_usd ?? null,
  cost_credits: c.amount_credits ?? null,
  refunded: c.refunded === true,
} : null);

// Custo efetivamente cobrado, a partir do corpo (`cost`) e dos headers (`billing`) da resposta da MuAPI.
//  - reembolso (corpo OU header) → refunded, valor efetivo 0;
//  - senão, o corpo manda; sem corpo, os valores dos headers;
//  - nada informado → null (o chamador mantém o valor reservado e marca como estimado).
export function resolveCost(result) {
  const body = extractCost(result?.cost);
  const b = result?.billing || null;
  const bodyRefund = body?.refunded === true;
  if (bodyRefund || b?.refunded === true) {
    return { refunded: true, usd: 0, credits: 0, source: bodyRefund ? 'body' : 'header', reported_usd: body?.cost_usd ?? b?.usd ?? null, reported_credits: body?.cost_credits ?? b?.credits ?? null };
  }
  if (body) return { refunded: false, usd: body.cost_usd, credits: body.cost_credits, source: 'body' };
  if (b && (b.usd != null || b.credits != null)) return { refunded: false, usd: b.usd, credits: b.credits, source: 'header' };
  return null;
}

// Colunas de custo a gravar ao finalizar. `cost_usd`/`cost_credits` = efetivamente cobrado (é o que o painel soma);
// `cost_reserved_*` = valor original reservado no envio (histórico; não entra nos totais).
export function costPatch(c, base, { failed = false } = {}) {
  const reserved = base.cost_reserved_usd == null && base.cost_usd != null ? { cost_reserved_usd: base.cost_usd, cost_reserved_credits: base.cost_credits ?? null } : {};
  if (c?.refunded) return { ...reserved, cost_usd: 0, cost_credits: 0, refunded: true, cost_estimated: false };
  if (c) return { ...reserved, cost_usd: c.usd ?? base.cost_usd ?? null, cost_credits: c.credits ?? base.cost_credits ?? null, refunded: false, cost_estimated: false };
  // Sem informação de cobrança/reembolso: mantém o valor reservado, mas numa falha ele é apenas uma estimativa.
  return { cost_estimated: failed ? Number(base.cost_usd) > 0 : !!base.cost_estimated };
}
const billingNote = (c) => ({ billing: c ? { refunded: c.refunded, source: c.source, ...(c.refunded ? { reported_usd: c.reported_usd ?? null, reported_credits: c.reported_credits ?? null } : {}) } : { refunded: null, source: 'none' } });

// Log estruturado de uma linha (aparece nos logs do container): "[gen] {json}". Nunca inclui chaves nem URLs assinadas.
export function logEvent(evt, row, extra = {}) {
  const line = { evt, gen: row?.id, req: row?.provider_request_id || undefined, ep: row?.endpoint, sandbox: row?.sandbox, ...extra, at: new Date().toISOString() };
  (evt === 'poll_error' || evt === 'lost_race' || evt === 'webhook_rejected' ? console.warn : console.log)('[gen]', JSON.stringify(line));
}

const MODERATION = /violat|guideline|polic(y|ies)|moderat|review|nsfw|sensitiv|safety|prohibit|not allowed|inappropriate|unsafe|blocked|forbidden|copyright|celebrit|real person|\bface\b/i;

// Texto claro para a interface. Sempre inclui o motivo original devolvido pela API.
export function describeFailure(raw) {
  const reason = String(raw || '').trim() || 'falha na geração';
  if (MODERATION.test(reason)) {
    return { kind: 'moderation', message: `Reprovado pela moderação do provedor. Motivo informado: “${reason}” Troque a imagem ou o prompt e tente novamente.` };
  }
  return { kind: 'provider', message: `A geração falhou: ${reason}` };
}

const errText = (r) => (typeof r.error === 'string' ? r.error : r.error?.message) || r.message || '';

export function createGenerationService({ store, getResult, persist, now = () => Date.now(), log = logEvent }) {
  const iso = (t = now()) => new Date(t).toISOString();
  const noted = new Map(); // "geração → último status do provedor" já registrado por este processo (evita gravar a cada poll)

  async function noteStatus(row, status, result) {
    if (noted.get(row.id) === status) return row;
    noted.set(row.id, status);
    if (noted.size > 500) noted.delete(noted.keys().next().value);
    const tl = row.timeline || {};
    if (tl.provider_status === status && row.status === 'processing') return row;
    log('status', row, { from: tl.provider_status ?? null, to: status, elapsed_ms: now() - Date.parse(row.created_at) });
    const patch = { timeline: { ...tl, provider_status: status, status_seen: [...(tl.status_seen || []), { s: status, at: iso() }].slice(-12),
      ...(result?.created_at ? { provider_created_at: result.created_at } : {}) } };
    if (row.status !== 'processing') patch.status = 'processing';
    return (await store.update(row.id, patch)) || row;
  }

  // Finaliza de forma atômica e idempotente:
  //  1) `claim` (UPDATE condicional): só UM chamador ganha; polling e webhook simultâneos não baixam/salvam duas vezes;
  //  2) `finish` só grava se a geração ainda estiver aberta e a reivindicação for a nossa.
  async function finalize(row, source, result, build) {
    const claimIso = iso();
    const claimed = await store.claim(row.id, claimIso, iso(now() - CLAIM_STALE_MS));
    if (!claimed) {
      const cur = await store.get(row.id);
      const done = !!cur && TERMINAL.has(cur.status);
      log('lost_race', row, { source, already_final: done });
      return { row: cur || row, outcome: done ? 'already_final' : 'in_progress_elsewhere' };
    }
    const created = Date.parse(claimed.created_at);
    const seenAt = now();
    try {
      const { patch, tl: extra = {} } = await build(claimed);
      const finishedAt = iso();
      const prev = claimed.timeline || {};
      const timeline = {
        ...prev, ...extra,
        provider_status: String(result?.status || prev.provider_status || 'unknown').toLowerCase(),
        provider_created_at: result?.created_at ?? prev.provider_created_at ?? null,
        provider_execution_ms: result?.executionTime ?? result?.timings?.inference ?? null,
        terminal_seen_at: iso(seenAt), terminal_source: source, terminal_after_ms: seenAt - created,
        result_ready_at: finishedAt, total_ms: Date.parse(finishedAt) - created,
      };
      log('terminal', claimed, { status: patch.status, source, after_ms: seenAt - created, provider_execution_ms: timeline.provider_execution_ms, provider_status: timeline.provider_status });
      const done = await store.finish(row.id, claimIso, { ...patch, timeline, finished_at: finishedAt });
      if (!done) {
        const cur = await store.get(row.id);
        log('lost_race', row, { source, at: 'finish', already_final: !!cur && TERMINAL.has(cur.status) });
        return { row: cur || claimed, outcome: cur && TERMINAL.has(cur.status) ? 'already_final' : 'in_progress_elsewhere' };
      }
      log('finalized', done, { status: done.status, source, total_ms: timeline.total_ms, persist_ms: timeline.persist_ms ?? null,
        outputs: done.outputs?.length ?? 0, refunded: done.refunded, cost_usd: done.cost_usd, error: done.status === 'failed' ? String(done.error || '').slice(0, 160) : undefined });
      return { row: done, outcome: 'finalized' };
    } catch (e) {
      await store.release(row.id, claimIso).catch(() => {}); // devolve a vez para o próximo poll/webhook
      throw e;
    }
  }

  const failedBuild = (result) => (base) => {
    const d = describeFailure(errText(result));
    const c = resolveCost(result);
    return {
      patch: { status: 'failed', error: d.message, ...costPatch(c, base, { failed: true }) },
      tl: { failure: { kind: d.kind, http_status: result.http_status ?? 200, reason: errText(result).slice(0, 300) }, ...billingNote(c) },
    };
  };

  // Consulta a MuAPI e finaliza a geração no banco quando terminar. Idempotente. Devolve { row, outcome }.
  // outcome: already_final | no_request_id | pending | retry | error | finalized | in_progress_elsewhere
  async function syncGenerationDetailed(row, { source = 'poll' } = {}) {
    if (TERMINAL.has(row.status)) return { row, outcome: 'already_final' };
    if (!row.provider_request_id) return { row, outcome: 'no_request_id' };
    const ageMin = (now() - Date.parse(row.created_at)) / 60000;

    let result;
    try {
      result = await getResult(row.provider_request_id, { sandbox: !!row.sandbox }); // a consulta usa a mesma chave do envio
    } catch (e) {
      if (e instanceof MuapiError && ageMin > MAX_MINUTES) {
        return finalize(row, source, null, () => ({ patch: { status: 'failed', error: `Tempo esgotado. ${e.message}` }, tl: { failure: { kind: 'timeout', reason: String(e.message).slice(0, 300) } } }));
      }
      // Rede/429/5xx: tenta de novo no próximo poll (ou no reenvio do webhook). Outro 4xx sem "failed" no corpo: não é passageiro, mas
      // também não prova falha do job; mantém a geração aberta (o teto de 45 min continua valendo) e deixa o erro no log.
      log('poll_error', row, { source, retryable: e?.retryable ?? null, http: e?.httpStatus ?? null, kind: e?.kind ?? null, message: String(e?.message).slice(0, 200), age_min: Math.round(ageMin) });
      return { row, outcome: e instanceof MuapiError && e.retryable ? 'retry' : 'error' };
    }

    const status = String(result.status || '').toLowerCase();

    if (OK.has(status)) {
      return finalize(row, source, result, async (base) => {
        const urls = (result.outputs || [result.url, result.output?.url]).filter(Boolean);
        if (!urls.length) return failedBuild({ error: 'A MuAPI concluiu, mas não retornou nenhum arquivo.', cost: result.cost, billing: result.billing })(base);
        const t0 = now();
        const outputs = await Promise.all(urls.map((u, i) => persist(base, u, i)));
        const persistMs = now() - t0;
        log('persisted', base, { persist_ms: persistMs, files: outputs.length, stored: outputs.filter((o) => o.path).length });
        const c = resolveCost(result);
        return {
          patch: { status: 'completed', outputs, ...costPatch(c, base) },
          tl: { persist_ms: persistMs, ...billingNote(c) },
        };
      });
    }
    if (FAIL.has(status)) return finalize(row, source, result, failedBuild(result));
    if (ageMin > MAX_MINUTES) {
      return finalize(row, source, result, () => ({ patch: { status: 'failed', error: 'Tempo esgotado aguardando a MuAPI.' }, tl: { failure: { kind: 'timeout', reason: `provider_status=${status}` } } }));
    }
    return { row: await noteStatus(row, status || 'processing', result), outcome: 'pending' };
  }

  const syncGeneration = async (row, o) => (await syncGenerationDetailed(row, o)).row;
  return { syncGeneration, syncGenerationDetailed };
}
