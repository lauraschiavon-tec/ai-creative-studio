import 'server-only';

// Provedores SÍNCRONOS (OpenAI, Google, Seedream) só respondem quando terminam, e podem levar minutos. Para a rota não ficar presa,
// o trabalho roda em segundo plano neste processo e o resultado fica aqui até o núcleo de geração finalizar (polling do navegador
// ou o vigia do servidor). Se o servidor reiniciar no meio, o job some: a consulta seguinte devolve "interrompida" (sem custo assumido).
const jobs = new Map(); // requestId → { done, result, at }
const KEEP_MS = 20 * 60 * 1000; // depois de pronto, guarda o resultado por 20 min (tempo de sobra para salvar no Storage)
const MAX_JOBS = 200;

export const jobId = (provider, genId) => `${provider}:${genId}`;

const prune = () => {
  const now = Date.now();
  for (const [k, v] of jobs) if (v.done && now - v.at > KEEP_MS) jobs.delete(k);
  while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
};

// Erro do provedor → resultado "failed" no formato que o núcleo espera. Sem `cost`: se foi falha antes de cobrar, o valor é 0.
// Moderação: vai o motivo ORIGINAL do provedor (o núcleo monta a mensagem). Demais erros: a mensagem em português (saldo, chave, modelo não ativado…).
export function failedResult(err) {
  const raw = (err?.moderation ? err.detail : err?.message) || err?.detail || 'falha na geração';
  const billed = err?.kind === 'network'; // rede/tempo esgotado: pode ter cobrado; não afirma custo 0
  return { status: 'failed', error: String(raw), http_status: err?.httpStatus ?? 200, ...(billed ? {} : { cost: { amount_usd: 0, amount_credits: null, refunded: false } }) };
}

export function startJob(id, run) {
  prune();
  const entry = { done: false, result: null, at: Date.now() };
  jobs.set(id, entry);
  Promise.resolve().then(run).then((r) => { entry.result = r; }, (e) => { entry.result = failedResult(e); })
    .finally(() => { entry.done = true; entry.at = Date.now(); });
}

export function readJob(id) {
  const e = jobs.get(id);
  if (!e) {
    return { status: 'failed', error: 'A geração foi interrompida (o servidor reiniciou durante o processamento). Tente novamente.', http_status: 200 };
  }
  return e.done ? e.result : { status: 'processing' };
}

export const _jobsForTests = jobs;
