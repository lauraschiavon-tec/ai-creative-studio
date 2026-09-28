import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationService } from '../src/lib/generations-core.js';
import { getResult } from '../src/lib/muapi.js';
import { handleWebhook, signWebhook, verifyWebhook, webhookUrl } from '../src/lib/webhook.js';
import { makeStore, makeRow, T0, completed, fakePersist, fakeFetch, logs } from './helpers.mjs';

const realFetch = globalThis.fetch;
const ENV = ['MUAPI_WEBHOOK_SECRET', 'MUAPI_WEBHOOK', 'AISTUDIO_PUBLIC_URL', 'MUAPI_API_KEY_SANDBOX'];
const saved = {};
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.MUAPI_WEBHOOK_SECRET = 'segredo-de-teste';
  process.env.MUAPI_API_KEY_SANDBOX = 'test-key';
  delete process.env.MUAPI_WEBHOOK; delete process.env.AISTUDIO_PUBLIC_URL;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const ID = makeRow().id;
function setup({ row = makeRow(), steps = [] } = {}) {
  globalThis.fetch = fakeFetch(...steps);
  const store = makeStore([row]);
  const persist = fakePersist();
  const log = logs();
  const service = createGenerationService({ store, getResult: (id, o) => getResult(id, { ...o, sleep: async () => {} }), persist, now: () => T0 + 130000, log });
  const hit = (payload, sig = signWebhook(row.id), id = row.id) => handleWebhook({ id, sig, payload }, { service, store, log });
  return { store, persist, log, service, hit, fetch: () => globalThis.fetch };
}
const ok = () => [200, completed()];
const moderation = [400, { detail: { id: 'req-abc', status: 'failed', error: 'Reference image 1 failed review. Please replace it.' } }];

test('6) webhook de sucesso: finaliza a geração, salva o resultado e responde 200', async () => {
  const t = setup({ steps: [ok()] });
  const r = await t.hit({ id: 'req-abc', status: 'completed', outputs: ['https://cdn.muapi.ai/outputs/a.mp4'] });
  assert.equal(r.status, 200);
  assert.equal(r.body.outcome, 'finalized');
  const row = t.store.db.get(ID);
  assert.equal(row.status, 'completed');
  assert.equal(row.outputs.length, 1);
  assert.equal(row.timeline.terminal_source, 'webhook');
  assert.equal(t.persist.calls, 1);
});

test('7) webhook de falha: marca como falha com o motivo da API', async () => {
  const t = setup({ steps: [moderation] });
  const r = await t.hit({ id: 'req-abc', status: 'failed', error: 'Reference image 1 failed review. Please replace it.' });
  assert.equal(r.status, 200);
  const row = t.store.db.get(ID);
  assert.equal(row.status, 'failed');
  assert.match(row.error, /failed review/);
  assert.equal(row.timeline.terminal_source, 'webhook');
  assert.equal(t.persist.calls, 0);
});

test('8) webhook duplicado (em sequência e simultâneo): salva/finaliza uma única vez, sempre 2xx', async () => {
  const t = setup({ steps: [ok()] });
  const first = await t.hit({ id: 'req-abc', status: 'completed' });
  const second = await t.hit({ id: 'req-abc', status: 'completed' });
  assert.equal(first.body.outcome, 'finalized');
  assert.equal(second.status, 200);
  assert.equal(second.body.outcome, 'already_final');
  assert.equal(t.persist.calls, 1);
  assert.equal(t.store.calls.finish, 1);
  assert.equal(t.fetch().calls.length, 1, 'o duplicado nem consulta a MuAPI de novo');

  const c = setup({ steps: [ok()] });
  const rs = await Promise.all([1, 2, 3].map(() => c.hit({ id: 'req-abc', status: 'completed' })));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(rs.filter((r) => r.body.outcome === 'finalized').length, 1);
  assert.equal(c.persist.calls, 1);
  assert.equal(c.store.calls.finish, 1);
});

test('9) usuário fecha a página antes de concluir: só o webhook finaliza; ao voltar, o histórico já vem pronto sem consultar a MuAPI', async () => {
  const t = setup({ steps: [ok()] });
  // (nenhum poll do navegador acontece)
  assert.equal(t.store.db.get(ID).status, 'processing');
  await t.hit({ id: 'req-abc', status: 'completed' });
  const fromHistory = await t.store.get(ID);
  assert.equal(fromHistory.status, 'completed');
  assert.equal(fromHistory.outputs.length, 1);
  const calls = t.fetch().calls.length;
  const again = await t.service.syncGenerationDetailed(fromHistory, { source: 'poll' }); // o que o GET /api/generations faz
  assert.equal(again.outcome, 'already_final');
  assert.equal(t.fetch().calls.length, calls);
});

test('10) webhook e polling praticamente juntos (rota do webhook + poll do navegador): uma única finalização', async () => {
  const t = setup({ steps: [ok()] });
  const row = t.store.db.get(ID);
  const [w, p] = await Promise.all([t.hit({ id: 'req-abc', status: 'completed' }), t.service.syncGenerationDetailed(structuredClone(row), { source: 'poll' })]);
  assert.equal([w.body.outcome, p.outcome].filter((o) => o === 'finalized').length, 1);
  assert.equal(w.status, 200);
  assert.equal(t.persist.calls, 1);
  assert.equal(t.store.calls.finish, 1);
  assert.equal(t.store.db.get(ID).status, 'completed');
});

test('assinatura inválida, ausente ou de outra geração: 401 e nada é lido nem gravado', async () => {
  const t = setup({ steps: [ok()] });
  for (const sig of ['errada', '', signWebhook('99999999-2222-4333-8444-555555555555'), signWebhook(ID).slice(0, -1)]) {
    const r = await t.hit({ id: 'req-abc', status: 'completed' }, sig);
    assert.equal(r.status, 401);
  }
  assert.equal((await t.hit({ id: 'req-abc' }, signWebhook('nao-e-uuid'), 'nao-e-uuid')).status, 401);
  assert.equal(t.fetch().calls.length, 0);
  assert.equal(t.store.db.get(ID).status, 'processing');
  assert.ok(t.log.list.some((l) => l.evt === 'webhook_rejected' && l.reason === 'bad_signature'));
});

test('payload forjado não é confiável: diz "completed", mas a MuAPI ainda diz processing => nada é gravado e a MuAPI reenvia (503)', async () => {
  const t = setup({ steps: [[200, { id: 'req-abc', status: 'processing' }]] });
  const r = await t.hit({ id: 'req-abc', status: 'completed', outputs: ['https://evil.example/x.mp4'] });
  assert.equal(r.status, 503);
  const row = t.store.db.get(ID);
  assert.equal(row.status, 'processing');
  assert.deepEqual(row.outputs, []);
  assert.equal(t.persist.calls, 0);
});

test('id do payload diferente do request_id guardado: 409', async () => {
  const t = setup({ steps: [ok()] });
  const r = await t.hit({ id: 'outro-request', status: 'completed' });
  assert.equal(r.status, 409);
  assert.equal(t.store.db.get(ID).status, 'processing');
});

test('geração inexistente: 404; ainda sem request_id gravado: 503 (a MuAPI reenvia)', async () => {
  const t = setup({ steps: [ok()] });
  const missing = '99999999-2222-4333-8444-555555555555';
  assert.equal((await t.hit({}, signWebhook(missing), missing)).status, 404);
  const n = setup({ row: makeRow({ provider_request_id: null }), steps: [ok()] });
  assert.equal((await n.hit({ id: 'req-abc', status: 'completed' })).status, 503);
  assert.equal(n.store.db.get(ID).status, 'processing');
});

test('erro passageiro ao confirmar na MuAPI (5xx/429/rede): 503 para a MuAPI reenviar; o reenvio conclui', async () => {
  const bad = [503, 'down'];
  const t = setup({ steps: [bad, bad, ok()] });
  const first = await t.hit({ id: 'req-abc', status: 'completed' });
  assert.equal(first.status, 503);
  assert.equal(t.store.db.get(ID).status, 'processing');
  const retry = await t.hit({ id: 'req-abc', status: 'completed' });
  assert.equal(retry.status, 200);
  assert.equal(t.store.db.get(ID).status, 'completed');
});

test('URL do webhook: só https público; token por geração; dá para desligar', () => {
  const u = webhookUrl('https://studio.exemplo.com', ID);
  assert.match(u, new RegExp(`^https://studio\\.exemplo\\.com/api/webhooks/muapi/${ID}/[A-Za-z0-9_-]{43}$`));
  const sig = u.split('/').pop();
  assert.ok(verifyWebhook(ID, sig));
  assert.ok(!verifyWebhook('99999999-2222-4333-8444-555555555555', sig), 'o token de uma geração não vale para outra');
  assert.notEqual(signWebhook(ID), signWebhook('99999999-2222-4333-8444-555555555555'));
  for (const bad of ['http://studio.exemplo.com', 'https://localhost:3000', 'https://127.0.0.1', 'https://192.168.0.10', 'https://10.0.0.5', 'https://172.20.1.1', 'https://atelie', 'https://x.local', 'https://[::1]', 'nao-e-url']) {
    assert.equal(webhookUrl(bad, ID), null, bad);
  }
  process.env.AISTUDIO_PUBLIC_URL = 'https://publico.exemplo.com/';
  assert.match(webhookUrl('http://localhost:3000', ID), /^https:\/\/publico\.exemplo\.com\/api\/webhooks\/muapi\//);
  delete process.env.AISTUDIO_PUBLIC_URL;
  process.env.MUAPI_WEBHOOK = 'off';
  assert.equal(webhookUrl('https://studio.exemplo.com', ID), null);
});

test('segredo diferente => token diferente (trocar o segredo invalida webhooks antigos)', () => {
  const a = signWebhook(ID);
  process.env.MUAPI_WEBHOOK_SECRET = 'outro-segredo';
  assert.notEqual(signWebhook(ID), a);
  assert.ok(!verifyWebhook(ID, a));
});
