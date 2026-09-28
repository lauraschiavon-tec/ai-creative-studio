import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationService } from '../src/lib/generations-core.js';
import { getResult } from '../src/lib/muapi.js';
import { makeStore, makeRow, T0, completed, fakePersist, fakeFetch, logs } from './helpers.mjs';

const realFetch = globalThis.fetch;
beforeEach(() => { process.env.MUAPI_API_KEY_SANDBOX = 'test-key'; });
afterEach(() => { globalThis.fetch = realFetch; });

// Serviço de verdade (mesmo código da produção) com: getResult real sobre um fetch falso, store em memória e relógio controlado.
function setup({ row = makeRow(), steps = [], clock = { t: T0 + 130000 } } = {}) {
  globalThis.fetch = fakeFetch(...steps);
  const store = makeStore([row]);
  const persist = fakePersist();
  const log = logs();
  const service = createGenerationService({ store, getResult: (id, o) => getResult(id, { ...o, sleep: async () => {} }), persist, now: () => clock.t, log });
  return { service, store, persist, log, clock, row, fetch: () => globalThis.fetch };
}
const ok200 = () => [200, completed()];
const moderation400 = [400, { detail: { id: 'req-abc', status: 'failed', error: 'The uploaded content contains material that violates our guidelines. Please adjust it and try again.' } }];

test('1) geração concluída: salva o resultado uma vez e registra a linha do tempo completa', async () => {
  const t = setup({ steps: [ok200()] });
  const { row, outcome } = await t.service.syncGenerationDetailed(t.row);
  assert.equal(outcome, 'finalized');
  assert.equal(row.status, 'completed');
  assert.equal(row.outputs.length, 1);
  assert.ok(row.outputs[0].path && row.outputs[0].remote);
  assert.equal(row.cost_usd, 0.9);
  assert.ok(row.finished_at);
  assert.equal(t.persist.calls, 1);
  const tl = row.timeline;
  assert.equal(tl.terminal_source, 'poll');
  assert.equal(tl.provider_status, 'completed');
  assert.equal(tl.provider_execution_ms, 125000);
  assert.equal(tl.terminal_after_ms, 130000);
  assert.ok(tl.persist_ms >= 0 && tl.result_ready_at && tl.total_ms >= 130000);
  const order = t.log.list.map((l) => l.evt).filter((e) => ['terminal', 'persisted', 'finalized'].includes(e));
  assert.deepEqual(order, ['persisted', 'terminal', 'finalized']); // salvou o arquivo → viu o terminal → gravou no banco
});

test('2) moderação HTTP 400: falha definitiva imediata, com o motivo claro, e sem novas consultas', async () => {
  const t = setup({ steps: [moderation400] });
  const { row, outcome } = await t.service.syncGenerationDetailed(t.row);
  assert.equal(outcome, 'finalized');
  assert.equal(row.status, 'failed');
  assert.match(row.error, /Reprovado pela moderação do provedor/);
  assert.match(row.error, /violates our guidelines/);
  assert.equal(row.timeline.failure.kind, 'moderation');
  assert.equal(row.timeline.failure.http_status, 400);
  assert.ok(row.finished_at);
  assert.equal(t.persist.calls, 0);
  assert.equal(t.fetch().calls.length, 1);
  // o polling seguinte (ou o histórico) não consulta mais a MuAPI
  const again = await t.service.syncGenerationDetailed(row);
  assert.equal(again.outcome, 'already_final');
  assert.equal(t.fetch().calls.length, 1);
});

test('2b) falha que não é moderação: mensagem genérica com o motivo da API', async () => {
  const t = setup({ steps: [[400, { detail: { id: 'req-abc', status: 'failed', error: 'Upstream model crashed' } }]] });
  const { row } = await t.service.syncGenerationDetailed(t.row);
  assert.equal(row.error, 'A geração falhou: Upstream model crashed');
  assert.equal(row.timeline.failure.kind, 'provider');
});

test('2c) status failed em HTTP 200 continua funcionando (com estorno zera o custo)', async () => {
  const t = setup({ steps: [[200, { id: 'req-abc', status: 'failed', error: 'render error', cost: { amount_usd: 0.85, amount_credits: 67, refunded: true } }]] });
  const { row } = await t.service.syncGenerationDetailed(t.row);
  assert.equal(row.status, 'failed');
  assert.equal(row.refunded, true);
  assert.equal(row.cost_usd, 0);
});

test('concluído sem nenhum arquivo vira falha (comportamento anterior)', async () => {
  const t = setup({ steps: [[200, completed({ outputs: [] })]] });
  const { row } = await t.service.syncGenerationDetailed(t.row);
  assert.equal(row.status, 'failed');
  assert.match(row.error, /não retornou nenhum arquivo/);
});

for (const [n, name, bad] of [
  ['3', '429 temporário', [429, { detail: 'slow down' }, { 'retry-after': '1' }]],
  ['4', '5xx temporário', [503, 'upstream unavailable']],
  ['5', 'erro de rede', new TypeError('fetch failed')],
]) {
  test(`${n}) ${name}: NÃO falha a geração; continua aberta e conclui no poll seguinte`, async () => {
    const t = setup({ steps: [bad, bad, ok200()] }); // 1ª consulta = tentativa + repetição curta, ambas falham
    const first = await t.service.syncGenerationDetailed(t.row);
    assert.equal(first.outcome, 'retry');
    assert.equal(first.row.status, 'processing');
    assert.equal(t.store.calls.finish, 0);
    assert.ok(t.log.list.some((l) => l.evt === 'poll_error' && l.retryable === true));
    const second = await t.service.syncGenerationDetailed(first.row);
    assert.equal(second.outcome, 'finalized');
    assert.equal(second.row.status, 'completed');
  });
}

test('4xx sem status failed (ex.: 404): não prova falha; geração segue aberta e o erro vai para o log', async () => {
  const t = setup({ steps: [[404, { detail: 'not found' }]] });
  const r = await t.service.syncGenerationDetailed(t.row);
  assert.equal(r.outcome, 'error');
  assert.equal(r.row.status, 'processing');
  assert.equal(t.log.list.find((l) => l.evt === 'poll_error').retryable, false);
});

test('timeout global de 45 min continua igual (erro de consulta após 45 min => Tempo esgotado)', async () => {
  const t = setup({ steps: [[503, 'down']], clock: { t: T0 + 46 * 60000 } });
  const { row } = await t.service.syncGenerationDetailed(t.row);
  assert.equal(row.status, 'failed');
  assert.match(row.error, /^Tempo esgotado\./);
  assert.equal(row.timeline.failure.kind, 'timeout');
  const t2 = setup({ steps: [[200, { id: 'req-abc', status: 'processing' }]], clock: { t: T0 + 46 * 60000 } });
  assert.equal((await t2.service.syncGenerationDetailed(t2.row)).row.error, 'Tempo esgotado aguardando a MuAPI.');
  const t3 = setup({ steps: [[200, { id: 'req-abc', status: 'processing' }]], clock: { t: T0 + 44 * 60000 } });
  assert.equal((await t3.service.syncGenerationDetailed(t3.row)).outcome, 'pending'); // 44 min: ainda espera
});

test('status queued → processing: registra cada transição uma vez (sem gravar a cada poll)', async () => {
  const t = setup({
    row: makeRow({ timeline: {} }),
    steps: [[200, { id: 'req-abc', status: 'queued', created_at: '2026-09-28T15:00:00.100+00:00' }], [200, { id: 'req-abc', status: 'queued' }], [200, { id: 'req-abc', status: 'processing' }]],
  });
  let row = t.row;
  for (let i = 0; i < 3; i++) row = (await t.service.syncGenerationDetailed(row)).row;
  assert.deepEqual(row.timeline.status_seen.map((x) => x.s), ['queued', 'processing']);
  assert.equal(t.store.calls.update, 2); // queued e processing; o 2º queued não gravou nada
  assert.deepEqual(t.log.list.filter((l) => l.evt === 'status').map((l) => l.to), ['queued', 'processing']);
});

test('gerações antigas presas em "processing" que a MuAPI já marcou failed: o histórico é corrigido com o motivo real (não "Tempo esgotado")', async () => {
  const t = setup({
    row: makeRow({ timeline: {}, created_at: new Date(T0 - 40 * 60000).toISOString() }),
    steps: [[400, { detail: { id: 'req-abc', status: 'failed', error: 'Reference image 1 failed review. Please replace it.' } }]],
    clock: { t: T0 + 60000 },
  });
  const { row } = await t.service.syncGenerationDetailed(t.row);
  assert.equal(row.status, 'failed');
  assert.match(row.error, /failed review/);
  assert.doesNotMatch(row.error, /Tempo esgotado/);
});

test('finalização reivindicada há mais de 3 min (servidor caiu) é retomada; a recente não', async () => {
  const stale = setup({ row: makeRow({ finalizing_at: new Date(T0 + 130000 - 4 * 60000).toISOString() }), steps: [ok200()] });
  assert.equal((await stale.service.syncGenerationDetailed(stale.row)).outcome, 'finalized');
  const fresh = setup({ row: makeRow({ finalizing_at: new Date(T0 + 130000 - 30000).toISOString() }), steps: [ok200()] });
  const r = await fresh.service.syncGenerationDetailed(fresh.row);
  assert.equal(r.outcome, 'in_progress_elsewhere');
  assert.equal(fresh.persist.calls, 0);
});

test('erro inesperado ao finalizar devolve a vez (libera a reivindicação) e o próximo poll conclui', async () => {
  const t = setup({ steps: [ok200()] });
  const boom = createGenerationService({ store: t.store, getResult: (id, o) => getResult(id, o), persist: async () => { throw new Error('storage exploded'); }, now: () => T0 + 130000, log: t.log });
  await assert.rejects(boom.syncGenerationDetailed(t.row), /storage exploded/);
  assert.equal(t.store.db.get(t.row.id).finalizing_at, null);
  globalThis.fetch = fakeFetch(ok200());
  assert.equal((await t.service.syncGenerationDetailed(t.row)).outcome, 'finalized');
});

test('10) polling e webhook (e outros polls) ao mesmo tempo: salva UMA vez só', async () => {
  const t = setup({ steps: [ok200()] });
  const results = await Promise.all([
    t.service.syncGenerationDetailed(t.row, { source: 'poll' }),
    t.service.syncGenerationDetailed(t.row, { source: 'webhook' }),
    t.service.syncGenerationDetailed(t.row, { source: 'poll' }),
    t.service.syncGenerationDetailed(t.row, { source: 'webhook' }),
  ]);
  assert.equal(results.filter((r) => r.outcome === 'finalized').length, 1);
  assert.ok(results.filter((r) => r.outcome !== 'finalized').every((r) => ['already_final', 'in_progress_elsewhere'].includes(r.outcome)));
  assert.equal(t.persist.calls, 1, 'o resultado só é baixado/gravado uma vez');
  assert.equal(t.store.calls.finish, 1, 'só uma gravação final');
  assert.equal(t.store.db.get(t.row.id).status, 'completed');
  assert.equal(t.store.db.get(t.row.id).outputs.length, 1);
  assert.equal(t.log.list.filter((l) => l.evt === 'finalized').length, 1);
});

test('10b) polling e webhook chegam falhos ao mesmo tempo (moderação): uma única gravação', async () => {
  const t = setup({ steps: [moderation400] });
  const rs = await Promise.all([t.service.syncGenerationDetailed(t.row, { source: 'poll' }), t.service.syncGenerationDetailed(t.row, { source: 'webhook' })]);
  assert.equal(rs.filter((r) => r.outcome === 'finalized').length, 1);
  assert.equal(t.store.calls.finish, 1);
  assert.equal(t.store.db.get(t.row.id).status, 'failed');
});

test('após ficar final, um poll atrasado (que ainda enxergava "processing") não sobrescreve nada', async () => {
  const t = setup({ steps: [ok200()] });
  const stale = structuredClone(t.row);
  const first = await t.service.syncGenerationDetailed(t.row);
  const before = structuredClone(t.store.db.get(t.row.id));
  const late = await t.service.syncGenerationDetailed(stale);
  assert.equal(first.outcome, 'finalized');
  assert.notEqual(late.outcome, 'finalized');
  assert.deepEqual(t.store.db.get(t.row.id), before);
  assert.equal(t.persist.calls, 1);
});
