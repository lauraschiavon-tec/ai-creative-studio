import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getResult, submit, MuapiError } from '../src/lib/muapi.js';
import { fakeFetch } from './helpers.mjs';

const realFetch = globalThis.fetch;
beforeEach(() => { process.env.MUAPI_API_KEY_SANDBOX = 'test-key'; });
afterEach(() => { globalThis.fetch = realFetch; });
const noSleep = () => { const f = async (ms) => { f.waits.push(ms); }; f.waits = []; return f; };
const opts = (sleep) => ({ sandbox: true, sleep });

test('2) HTTP 400 com { detail: { status: failed } } vira falha definitiva, sem repetir a consulta', async () => {
  globalThis.fetch = fakeFetch([400, { detail: { id: 'req-abc', status: 'failed', error: 'The uploaded content contains material that violates our guidelines.' } }]);
  const r = await getResult('req-abc', opts(noSleep()));
  assert.equal(r.status, 'failed');
  assert.match(r.error, /violates our guidelines/);
  assert.equal(r.http_status, 400);
  assert.equal(globalThis.fetch.calls.length, 1); // não repetiu
});

test('2b) status:failed no topo do corpo (4xx) também é falha definitiva', async () => {
  globalThis.fetch = fakeFetch([403, { id: 'x', status: 'failed', error: { message: 'Reference image 1 failed review.' } }]);
  const r = await getResult('x', opts(noSleep()));
  assert.equal(r.status, 'failed');
  assert.match(r.error, /failed review/);
});

test('4xx sem status failed (401, 404, 422 de validação) é lançado como NÃO repetível', async () => {
  for (const [status, body] of [[401, { detail: 'Invalid API key' }], [404, { detail: 'Not found' }], [422, { detail: [{ msg: 'field required' }] }]]) {
    globalThis.fetch = fakeFetch([status, body]);
    await assert.rejects(getResult('r', opts(noSleep())), (e) => e instanceof MuapiError && e.retryable === false && !e.providerFailure);
    assert.equal(globalThis.fetch.calls.length, 1, `HTTP ${status} não deve ser repetido`);
  }
});

test('3) 429 temporário: repete respeitando Retry-After e depois conclui', async () => {
  globalThis.fetch = fakeFetch([429, { detail: 'slow down' }, { 'retry-after': '1' }], [200, { id: 'r', status: 'completed', outputs: ['u'] }]);
  const sleep = noSleep();
  const r = await getResult('r', opts(sleep));
  assert.equal(r.status, 'completed');
  assert.equal(globalThis.fetch.calls.length, 2);
  assert.deepEqual(sleep.waits, [1000]);
});

test('3b) 429 persistente: lança erro repetível (o próximo poll tenta de novo)', async () => {
  globalThis.fetch = fakeFetch([429, { detail: 'slow down' }]);
  await assert.rejects(getResult('r', opts(noSleep())), (e) => e.retryable === true && e.httpStatus === 429);
  assert.equal(globalThis.fetch.calls.length, 2); // 1 tentativa + 1 repetição curta
});

test('4) 5xx temporário: repete e conclui; 5xx persistente é repetível', async () => {
  globalThis.fetch = fakeFetch([503, 'upstream down'], [200, { id: 'r', status: 'processing' }]);
  assert.equal((await getResult('r', opts(noSleep()))).status, 'processing');
  globalThis.fetch = fakeFetch([502, 'bad gateway']);
  await assert.rejects(getResult('r', opts(noSleep())), (e) => e.retryable === true && e.httpStatus === 502);
});

test('4b) 5xx NÃO é falha do job, mesmo que o corpo diga failed', async () => {
  globalThis.fetch = fakeFetch([500, { detail: { status: 'failed', error: 'boom' } }]);
  await assert.rejects(getResult('r', opts(noSleep())), (e) => e.retryable === true && !e.providerFailure);
});

test('5) erro de rede: repete e conclui; persistente é repetível', async () => {
  globalThis.fetch = fakeFetch(new TypeError('fetch failed'), [200, { id: 'r', status: 'completed', outputs: ['u'] }]);
  assert.equal((await getResult('r', opts(noSleep()))).status, 'completed');
  globalThis.fetch = fakeFetch(new TypeError('fetch failed'));
  await assert.rejects(getResult('r', opts(noSleep())), (e) => e.retryable === true && e.kind === 'network');
});

test('POST inicial: NUNCA é repetido (5xx, 429 e rede => uma única chamada)', async () => {
  for (const step of [[503, 'down'], [429, { detail: 'x' }], new TypeError('fetch failed')]) {
    globalThis.fetch = fakeFetch(step);
    await assert.rejects(submit('seedance-2.5-image-to-video', { prompt: 'a' }, { sandbox: true }), MuapiError);
    assert.equal(globalThis.fetch.calls.length, 1);
    assert.equal(globalThis.fetch.calls[0].method, 'POST');
  }
});

test('POST inicial: sem webhook a URL é a de sempre; com webhook vai codificado na query', async () => {
  globalThis.fetch = fakeFetch([200, { request_id: 'r1' }]);
  await submit('m', { prompt: 'a' }, { sandbox: true });
  assert.equal(globalThis.fetch.calls[0].url, 'https://api.muapi.ai/api/v1/m');
  globalThis.fetch = fakeFetch([200, { request_id: 'r1' }]);
  await submit('m', { prompt: 'a' }, { sandbox: true, webhook: 'https://studio.exemplo.com/api/webhooks/muapi/abc/def?x=1' });
  assert.equal(globalThis.fetch.calls[0].url, `https://api.muapi.ai/api/v1/m?webhook=${encodeURIComponent('https://studio.exemplo.com/api/webhooks/muapi/abc/def?x=1')}`);
});
