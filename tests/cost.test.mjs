import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationService } from '../src/lib/generations-core.js';
import { getResult, billingFrom } from '../src/lib/muapi.js';
import { costAcc, costAdd } from '../src/lib/cost-totals.js';
import { handleWebhook, signWebhook } from '../src/lib/webhook.js';
import { makeStore, makeRow, T0, completed, fakePersist, fakeFetch, logs } from './helpers.mjs';

// Custo efetivo x reservado: a MuAPI informa reembolso nos HEADERS x-muapi-cost-* (inclusive nas respostas 400, sem `cost` no corpo).
const realFetch = globalThis.fetch;
beforeEach(() => { process.env.MUAPI_API_KEY_SANDBOX = 'test-key'; process.env.MUAPI_WEBHOOK_SECRET = 'segredo-de-teste'; });
afterEach(() => { globalThis.fetch = realFetch; });

function setup({ row = makeRow(), steps = [] } = {}) {
  globalThis.fetch = fakeFetch(...steps);
  const store = makeStore([row]);
  const persist = fakePersist();
  const log = logs();
  const service = createGenerationService({ store, getResult: (id, o) => getResult(id, { ...o, sleep: async () => {} }), persist, now: () => T0 + 130000, log });
  return { service, store, persist, log, row, fetch: () => globalThis.fetch, db: () => store.db.get(row.id) };
}
const failedBody = { detail: { id: 'req-abc', status: 'failed', error: 'Reference image 1 failed review. Please replace it.' } };
const REFUND = { 'x-muapi-cost-usd': '0.000000', 'x-muapi-cost-credits': '0', 'x-muapi-cost-refunded': 'true' };
// A linha como a rota de envio deixa: cost_usd = reservado; cost_reserved_* = cópia do original; refunded = false (default do banco).
const reservedRow = (over = {}) => makeRow({ refunded: false, cost_usd: 0.85, cost_credits: 67, cost_reserved_usd: 0.85, cost_reserved_credits: 67, ...over });

test('headers: parse de x-muapi-cost-*; ausentes => null; refunded ausente fica indefinido (≠ false)', () => {
  assert.deepEqual(billingFrom(new Headers(REFUND)), { usd: 0, credits: 0, refunded: true });
  assert.deepEqual(billingFrom(new Headers({ 'x-muapi-cost-usd': '1.7', 'x-muapi-cost-credits': '134' })), { usd: 1.7, credits: 134, refunded: undefined });
  assert.deepEqual(billingFrom(new Headers({ 'x-muapi-cost-refunded': 'False' })), { usd: null, credits: null, refunded: false });
  assert.deepEqual(billingFrom(new Headers({ 'x-muapi-cost-usd': 'abc' })), { usd: null, credits: null, refunded: undefined });
  assert.equal(billingFrom(new Headers({ 'content-type': 'application/json' })), null);
  assert.equal(billingFrom(undefined), null);
});

test('getResult: 400 com reembolso devolve o billing dos headers junto da falha definitiva', async () => {
  globalThis.fetch = fakeFetch([400, failedBody, REFUND]);
  const r = await getResult('req-abc', { sandbox: true, sleep: async () => {} });
  assert.equal(r.status, 'failed');
  assert.deepEqual(r.billing, { usd: 0, credits: 0, refunded: true });
  assert.equal(globalThis.fetch.calls.length, 1);
});

test('1) 400 COM reembolso: falha registrada como estornada, custo efetivo 0 e o valor original preservado', async () => {
  const t = setup({ row: reservedRow(), steps: [[400, failedBody, REFUND]] });
  const { row, outcome } = await t.service.syncGenerationDetailed(t.row);
  assert.equal(outcome, 'finalized');
  assert.equal(row.status, 'failed');
  assert.equal(row.refunded, true);
  assert.equal(row.cost_usd, 0);
  assert.equal(row.cost_credits, 0);
  assert.equal(row.cost_estimated, false);
  assert.equal(row.cost_reserved_usd, 0.85, 'o valor reservado continua no histórico');
  assert.equal(row.cost_reserved_credits, 67);
  assert.equal(row.timeline.billing.refunded, true);
  assert.equal(row.timeline.billing.source, 'header');
  assert.equal(row.timeline.failure.kind, 'moderation'); // o motivo da falha continua sendo registrado
  assert.equal(t.log.list.find((l) => l.evt === 'finalized').refunded, true);
});

test('1b) linhas de antes da migration 004 (sem cost_reserved_*): o reservado é derivado do custo gravado', async () => {
  const t = setup({ row: makeRow({ cost_usd: 1.7, cost_credits: 134 }), steps: [[400, failedBody, REFUND]] });
  const { row } = await t.service.syncGenerationDetailed(t.row);
  assert.equal(row.cost_usd, 0);
  assert.equal(row.cost_reserved_usd, 1.7);
  assert.equal(row.cost_reserved_credits, 134);
});

test('1c) o valor reservado já gravado no envio nunca é sobrescrito pelo estorno', async () => {
  const t = setup({ row: reservedRow({ cost_usd: 0.5 }), steps: [[400, failedBody, REFUND]] });
  const { row } = await t.service.syncGenerationDetailed(t.row);
  assert.equal(row.cost_reserved_usd, 0.85);
});

test('2) 400 SEM informação de reembolso: não assume estorno; mantém o valor, marca como estimado e registra "sem informação"', async () => {
  const t = setup({ row: reservedRow(), steps: [[400, failedBody]] });
  const { row } = await t.service.syncGenerationDetailed(t.row);
  assert.equal(row.status, 'failed');
  assert.equal(row.refunded, false);
  assert.equal(row.cost_usd, 0.85);
  assert.equal(row.cost_credits, 67);
  assert.equal(row.cost_estimated, true);
  assert.deepEqual(row.timeline.billing, { refunded: null, source: 'none' });
});

test('2b) 400 com cobrança informada e refunded=false: registra o valor cobrado (confirmado, não estimado)', async () => {
  const t = setup({ row: reservedRow(), steps: [[400, failedBody, { 'x-muapi-cost-usd': '0.5', 'x-muapi-cost-credits': '40', 'x-muapi-cost-refunded': 'false' }]] });
  const { row } = await t.service.syncGenerationDetailed(t.row);
  assert.equal(row.refunded, false);
  assert.equal(row.cost_usd, 0.5);
  assert.equal(row.cost_credits, 40);
  assert.equal(row.cost_estimated, false);
  assert.equal(row.cost_reserved_usd, 0.85);
});

test('2c) 200 com status failed e estorno só no corpo (comportamento anterior) continua zerando', async () => {
  const t = setup({ row: reservedRow(), steps: [[200, { id: 'req-abc', status: 'failed', error: 'render error', cost: { amount_usd: 0.85, amount_credits: 67, refunded: true } }]] });
  const { row } = await t.service.syncGenerationDetailed(t.row);
  assert.equal(row.refunded, true);
  assert.equal(row.cost_usd, 0);
  assert.equal(row.cost_reserved_usd, 0.85);
  assert.equal(row.timeline.billing.source, 'body');
});

test('3) sucesso normal: cobrado = corpo, sem estorno, reservado preservado; headers sem refunded não mudam nada', async () => {
  const t = setup({ row: reservedRow(), steps: [[200, completed(), { 'x-muapi-cost-usd': '0.9', 'x-muapi-cost-credits': '71' }]] });
  const { row } = await t.service.syncGenerationDetailed(t.row);
  assert.equal(row.status, 'completed');
  assert.equal(row.refunded, false);
  assert.equal(row.cost_usd, 0.9);
  assert.equal(row.cost_credits, 71);
  assert.equal(row.cost_estimated, false);
  assert.equal(row.cost_reserved_usd, 0.85);
});

test('3b) sucesso sem nenhuma informação de custo: mantém o valor do envio e não vira "estimado"', async () => {
  const { cost, ...semCusto } = completed();
  const t = setup({ row: reservedRow(), steps: [[200, semCusto]] });
  const { row } = await t.service.syncGenerationDetailed(t.row);
  assert.equal(row.cost_usd, 0.85);
  assert.equal(row.cost_estimated, false);
  assert.equal(row.refunded, false);
});

test('4) polling e webhook ao mesmo tempo num 400 com reembolso: uma gravação, estornada, reservado intacto', async () => {
  const t = setup({ row: reservedRow(), steps: [[400, failedBody, REFUND]] });
  const hit = (sig = signWebhook(t.row.id)) => handleWebhook({ id: t.row.id, sig, payload: { id: 'req-abc', status: 'failed' } }, { service: t.service, store: t.store, log: t.log });
  const rs = await Promise.all([
    t.service.syncGenerationDetailed(structuredClone(t.row), { source: 'poll' }),
    hit(), hit(),
    t.service.syncGenerationDetailed(structuredClone(t.row), { source: 'poll' }),
  ]);
  assert.equal(rs.filter((r) => (r.outcome || r.body?.outcome) === 'finalized').length, 1);
  assert.equal(t.store.calls.finish, 1);
  const db = t.db();
  assert.equal(db.refunded, true);
  assert.equal(db.cost_usd, 0);
  assert.equal(db.cost_reserved_usd, 0.85);
  assert.equal(t.log.list.filter((l) => l.evt === 'finalized').length, 1);
  // um poll atrasado (que ainda via "processing") não refaz nem desfaz nada
  const before = structuredClone(db);
  await t.service.syncGenerationDetailed(structuredClone(t.row), { source: 'poll' });
  assert.deepEqual(t.db(), before);
});

test('5) webhook: falha estornada chega pelo webhook e é registrada como estorno (página fechada)', async () => {
  const t = setup({ row: reservedRow(), steps: [[400, failedBody, REFUND]] });
  const r = await handleWebhook({ id: t.row.id, sig: signWebhook(t.row.id), payload: { id: 'req-abc', status: 'failed' } }, { service: t.service, store: t.store, log: t.log });
  assert.equal(r.status, 200);
  assert.equal(t.db().refunded, true);
  assert.equal(t.db().cost_usd, 0);
  assert.equal(t.db().timeline.terminal_source, 'webhook');
});

test('painel: gerações estornadas não somam no gasto; ficam só como histórico do reservado e devolvido', () => {
  const total = costAcc();
  const rows = [
    { status: 'completed', cost_usd: 0.9, cost_credits: 71, refunded: false, cost_reserved_usd: 0.85, cost_reserved_credits: 67 },
    { status: 'failed', cost_usd: 0, cost_credits: 0, refunded: true, cost_reserved_usd: 1.7, cost_reserved_credits: 134 },
    { status: 'failed', cost_usd: 0.6, cost_credits: 47, refunded: false, cost_estimated: true }, // sem informação: continua contando (estimado)
    { status: 'failed', cost_usd: 0.4, cost_credits: 32, refunded: true }, // sem migration 004: reservado desconhecido, mas nunca soma
  ];
  for (const r of rows) costAdd(total, r);
  assert.equal(total.generations, 4);
  assert.equal(total.completed, 1);
  assert.equal(total.failed, 3);
  assert.equal(+total.usd.toFixed(4), 1.5);
  assert.equal(total.credits, 118);
  assert.equal(total.refunded, 2);
  assert.equal(+total.refunded_usd.toFixed(4), 1.7);
  assert.equal(total.refunded_credits, 134);
});
