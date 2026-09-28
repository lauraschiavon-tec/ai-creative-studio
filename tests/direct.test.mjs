import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MuapiError } from '../src/lib/muapi.js';
import { createGenerationService, describeFailure } from '../src/lib/generations-core.js';
import { directError } from '../src/lib/direct/http.js';
import { startJob, readJob, jobId } from '../src/lib/direct/jobs.js';
import { seedream, seedance, seedreamSize, seedanceBody, SIZES } from '../src/lib/direct/byteplus.js';
import { openai, openaiSize, costFromUsage } from '../src/lib/direct/openai.js';
import { googleImage, googleOmni, omniBody, blockReason } from '../src/lib/direct/google.js';
import { kling, klingBody } from '../src/lib/direct/kling.js';
import { DIRECT_MODELS, directConfig, directInfo, directGetResult, isDirectRow, providerConfigured } from '../src/lib/direct/index.js';
import { makeStore, makeRow, T0, fakePersist, logs } from './helpers.mjs';

const catalog = createRequire(import.meta.url)('../data/catalog.json');
const all = [...catalog.image, ...catalog.video];
const realFetch = globalThis.fetch;
const ENV = ['BYTEPLUS_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'KLING_API_KEY'];
const saved = {};
beforeEach(() => { for (const k of ENV) { saved[k] = process.env[k]; process.env[k] = `test-${k}`; } });
afterEach(() => { globalThis.fetch = realFetch; for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

// fetch falso: `routes` = [[teste(url, init), () => [status, corpo, headers?]], ...]. Guarda cada chamada (url, método, cabeçalhos, corpo).
function mockFetch(...routes) {
  const fn = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body };
    fn.calls.push(call);
    const hit = routes.find(([t]) => t(call.url, init));
    if (!hit) throw new Error(`sem rota para ${call.method} ${call.url}`);
    const [status, body, headers = {}] = hit[1](call);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  };
  fn.calls = [];
  return fn;
}
const on = (part, response) => [(u) => u.includes(part), () => response];
const json = (c) => JSON.parse(c.body);
async function settle(id) { for (let i = 0; i < 200; i++) { const r = readJob(id); if (r.status !== 'processing') return r; await new Promise((res) => setImmediate(res)); } throw new Error('job não terminou'); }
const gid = () => crypto.randomUUID();
const NO_COST = { amount_usd: 0, amount_credits: null, refunded: false };

// ---------------------------------------------------------------- registro
test('registro: todo modelo com API direta existe no catálogo e usa parâmetros que o catálogo declara', () => {
  for (const [ep, cfg] of Object.entries(DIRECT_MODELS)) {
    const m = all.find((x) => x.endpoint === ep);
    assert.ok(m, `${ep} não existe no catálogo`);
    assert.ok(['byteplus', 'openai', 'google', 'kling'].includes(cfg.provider));
    assert.ok(cfg.model || cfg.model_name, `${ep} sem modelo oficial`);
    if (cfg.edit) assert.ok(m.media.some((d) => d.name === 'images_list'), `${ep}: edição sem images_list`);
  }
  assert.equal(Object.keys(DIRECT_MODELS).length, 20);
  assert.equal(directConfig('flux-3-text-to-video'), null, 'o resto do catálogo continua só na MuAPI');
});

test('registro: todos os valores dos enums do catálogo viram valores que a API direta aceita', () => {
  const GOOGLE_AR = ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'];
  for (const [ep, cfg] of Object.entries(DIRECT_MODELS)) {
    const inputs = all.find((x) => x.endpoint === ep).inputs;
    const ar = inputs.aspect_ratio?.enum || [], res = inputs.resolution?.enum || [];
    if (cfg.adapter === 'google-image') { for (const a of ar) assert.ok(GOOGLE_AR.includes(a), `${ep} ${a}`); for (const r of res) assert.ok(['1K', '2K', '4K'].includes(r.toUpperCase())); }
    if (cfg.adapter === 'omni') { for (const a of ar) assert.ok(['16:9', '9:16'].includes(a)); for (const r of res) assert.ok(['360p', '720p', '1080p', '4k'].includes(r)); }
    if (cfg.adapter === 'kling') { for (const a of ar) assert.ok(['16:9', '9:16', '1:1'].includes(a)); for (const d of inputs.duration.enum) assert.ok(d >= 3 && d <= 15); assert.ok(['std', 'pro', 'master', '4k'].includes(cfg.mode)); }
    if (cfg.adapter === 'seedream') for (const a of ar) for (const q of [...(inputs.quality?.enum || [undefined]), ...(res.length ? res : [undefined])]) {
      const s = seedreamSize(cfg, { aspect_ratio: a, quality: q, resolution: q });
      assert.match(s, /^\d+x\d+$/, `${ep} ${a}`);
      const [w, h] = s.split('x').map(Number);
      assert.ok(w * h >= 3_686_400, `${ep} ${a} ${s} abaixo do mínimo de pixels`);
    }
    if (cfg.adapter === 'openai') for (const a of ar) for (const r of res) {
      const s = openaiSize(a, r);
      if (s === 'auto') { assert.equal(a, 'auto'); continue; }
      const [w, h] = s.split('x').map(Number);
      assert.ok(w % 16 === 0 && h % 16 === 0, `${a} ${r} ${s} não múltiplo de 16`);
      assert.ok(w * h <= 8_294_400 && w * h >= 655_360 && Math.max(w, h) <= 3840, `${a} ${r} ${s} fora dos limites`);
      assert.ok(Math.max(w, h) / Math.min(w, h) <= 3, `${a} ${r} ${s} proporção > 3:1`);
    }
  }
  assert.equal(SIZES['2K']['16:9'], '2560x1440');
});

test('seletor só aparece com a chave do provedor no servidor', () => {
  assert.equal(directInfo('nano-banana-pro').provider, 'google');
  assert.equal(directInfo('nano-banana-pro').providerLabel, 'Google');
  delete process.env.GEMINI_API_KEY;
  assert.equal(directInfo('nano-banana-pro'), null);
  assert.equal(providerConfigured('google'), false);
  assert.equal(directInfo('seedream-5.0').provider, 'byteplus');
  assert.equal(directInfo('modelo-inexistente'), null);
});

test('isDirectRow: só linhas com provider ≠ muapi e endpoint mapeado vão para o adaptador', () => {
  assert.equal(isDirectRow({ provider: 'kling', endpoint: 'kling-v3.0-pro-image-to-video' }), true);
  assert.equal(isDirectRow({ provider: 'muapi', endpoint: 'kling-v3.0-pro-image-to-video' }), false);
  assert.equal(isDirectRow({ endpoint: 'kling-v3.0-pro-image-to-video' }), false, 'linhas antigas (sem a coluna)');
  assert.equal(isDirectRow({ provider: 'kling', endpoint: 'outro' }), false);
});

// ---------------------------------------------------------------- erros
test('erros dos provedores viram mensagens claras e o tipo de repetição certo', () => {
  const e = (label, status, body) => directError(label, status, typeof body === 'string' ? body : JSON.stringify(body));
  let x = e('BytePlus', 404, { error: { code: 'ModelNotOpen', message: 'Your account 1 has not activated the model dreamina-seedance-2-5-260628.' } });
  assert.match(x.message, /não está ativado na conta BytePlus/); assert.equal(x.retryable, false);
  x = e('OpenAI', 429, { error: { code: 'credit_balance_exhausted', message: 'You have no credits remaining.' } });
  assert.equal(x.status, 402); assert.match(x.message, /Saldo ou cota da conta OpenAI insuficiente/); assert.equal(x.retryable, false);
  x = e('Google', 429, { error: { code: 429, message: 'You exceeded your current quota ... generate_content_free_tier_requests, limit: 0' } });
  assert.equal(x.status, 402); assert.equal(x.retryable, false);
  x = e('Google', 429, { error: { code: 429, message: 'Too many requests' } });
  assert.equal(x.status, 429); assert.equal(x.retryable, true);
  x = e('Kling', 401, { code: 1000, message: 'Auth failed' });
  assert.match(x.message, /chave da API direta \(Kling\) foi recusada/);
  x = e('Kling', 503, 'Service Unavailable');
  assert.equal(x.retryable, true); assert.equal(x.status, 502);
  x = e('OpenAI', 400, { error: { code: 'moderation_blocked', message: 'Your request was rejected by the safety system.' } });
  assert.match(x.message, /Reprovado pela moderação/); assert.match(x.detail, /safety system/);
  x = e('OpenAI', 400, { error: { message: "Invalid value: 'zzz'" } });
  assert.match(x.message, /Parâmetros recusados por OpenAI/); assert.equal(x.status, 400);
  assert.ok(x instanceof MuapiError);
});

// ---------------------------------------------------------------- jobs
test('jobs: enquanto roda → processing; termina → resultado; erro → failed com o motivo ORIGINAL; sumiu (reinício) → interrompida sem custo', async () => {
  const a = gid(), b = gid();
  let release; startJob(a, () => new Promise((r) => { release = r; }));
  assert.deepEqual(readJob(a), { status: 'processing' });
  await new Promise((r) => setImmediate(r)); // o job começa no próximo tick
  release({ status: 'completed', outputs: ['u'] });
  assert.equal((await settle(a)).status, 'completed');
  startJob(b, async () => { throw new MuapiError('msg amigável', 400, 'motivo original do provedor', { httpStatus: 400 }); });
  const f = await settle(b);
  assert.equal(f.status, 'failed'); assert.equal(f.error, 'msg amigável'); assert.deepEqual(f.cost, NO_COST);
  const mod = gid(); startJob(mod, async () => { throw new MuapiError('Reprovado pela moderação…', 400, 'motivo original do provedor', { httpStatus: 400, moderation: true }); });
  assert.equal((await settle(mod)).error, 'motivo original do provedor', 'moderação: motivo original (sem mensagem duplicada)');
  const lost = readJob(gid());
  assert.equal(lost.status, 'failed'); assert.match(lost.error, /interrompida/); assert.equal(lost.cost, undefined);
  const net = gid(); startJob(net, async () => { throw new MuapiError('rede', 504, 'x', { kind: 'network' }); });
  assert.equal((await settle(net)).cost, undefined, 'falha de rede: pode ter cobrado → não afirma custo 0');
});

// ---------------------------------------------------------------- BytePlus
test('Seedream 5.0: corpo da requisição, imagens de referência e resultado (URL + custo estimado)', async () => {
  globalThis.fetch = mockFetch(on('/images/generations', [200, { data: [{ url: 'https://ark.example/img.png?sig=1' }] }]));
  const id = gid();
  const r = await seedream.submit({ cfg: DIRECT_MODELS['seedream-5.0-edit'], id, payload: { prompt: 'um gato', aspect_ratio: '9:16', quality: 'high', images_list: ['https://s/a.png', 'https://s/b.png'] } });
  assert.equal(r.requestId, jobId('byteplus', id));
  assert.equal(r.cost.amount_usd, 0.045); assert.equal(r.cost.estimated, true);
  const res = await settle(r.requestId);
  const c = globalThis.fetch.calls[0];
  assert.equal(c.url, 'https://ark.ap-southeast.bytepluses.com/api/v3/images/generations');
  assert.equal(c.headers.Authorization, 'Bearer test-BYTEPLUS_API_KEY');
  assert.deepEqual(json(c), { model: 'seedream-5-0-260128', prompt: 'um gato', size: '2304x4096', response_format: 'url', watermark: false, sequential_image_generation: 'disabled', image: ['https://s/a.png', 'https://s/b.png'] });
  assert.equal(res.status, 'completed'); assert.deepEqual(res.outputs, ['https://ark.example/img.png?sig=1']);
  assert.equal(res.cost.estimated, true);
  // Pro: sem preço confirmado → não inventa custo
  assert.equal(seedream.estimate(DIRECT_MODELS['seedream-5.0-pro']), null);
});

test('Seedream 5.0 Pro: NÃO envia sequential_image_generation (o Pro recusa esse parâmetro com 400 InvalidParameter)', async () => {
  globalThis.fetch = mockFetch(on('/images/generations', [200, { data: [{ url: 'https://ark.example/img.png' }] }]));
  await settle((await seedream.submit({ cfg: DIRECT_MODELS['seedream-5.0-pro'], id: gid(), payload: { prompt: 'x', aspect_ratio: '16:9', resolution: '1K' } })).requestId);
  const body = json(globalThis.fetch.calls[0]);
  assert.equal(body.model, 'dola-seedream-5-0-pro-260628');
  assert.equal('sequential_image_generation' in body, false);
});

test('Seedream: recusa do provedor (moderação) volta como falha com o motivo original', async () => {
  globalThis.fetch = mockFetch(on('/images/generations', [400, { error: { code: 'OutputImageSensitiveContentDetected', message: 'The request failed because the output image may contain sensitive information.' } }]));
  const r = await seedream.submit({ cfg: DIRECT_MODELS['seedream-5.0'], id: gid(), payload: { prompt: 'x', aspect_ratio: '1:1' } });
  const res = await settle(r.requestId);
  assert.equal(res.status, 'failed'); assert.match(res.error, /sensitive information/);
  assert.equal(describeFailure(res.error).kind, 'moderation');
});

test('Seedance 2.5: corpo (content com role first_frame, ratio, duration), limites da API direta e estados da tarefa', async () => {
  const cfg = DIRECT_MODELS['seedance-2.5-image-to-video'];
  assert.deepEqual(seedanceBody(cfg, { prompt: 'fala', image_url: 'https://s/i.png', resolution: '480p', aspect_ratio: '9:16', duration: 5, seed: -1 }),
    { model: 'dreamina-seedance-2-5-260628', content: [{ type: 'text', text: 'fala' }, { type: 'image_url', image_url: { url: 'https://s/i.png' }, role: 'first_frame' }], resolution: '480p', ratio: '9:16', duration: 5, watermark: false });
  assert.equal(seedanceBody(cfg, { prompt: 'x', seed: 7 }).seed, 7);
  assert.throws(() => seedanceBody(cfg, { prompt: 'x', resolution: '1080p' }), /até 720p/);
  assert.throws(() => seedanceBody(cfg, { prompt: 'x', resolution: '4k' }), /até 720p/);
  assert.throws(() => seedanceBody(cfg, { prompt: 'x', draft: true }), /Draft|draft/);
  assert.throws(() => seedanceBody(cfg, {}), /prompt ou envie uma imagem/);

  globalThis.fetch = mockFetch(
    [(u, i) => u.endsWith('/contents/generations/tasks') && i.method === 'POST', () => [200, { id: 'cgt-2026-abc' }]],
    [(u) => u.endsWith('/tasks/cgt-2026-abc'), () => [200, { id: 'cgt-2026-abc', status: 'running' }]],
  );
  const r = await seedance.submit({ cfg, payload: { prompt: 'x', resolution: '720p', duration: 5, aspect_ratio: '16:9' } });
  assert.equal(r.requestId, 'cgt-2026-abc'); assert.equal(r.cost.amount_usd, 1.156);
  assert.deepEqual(await seedance.getResult('cgt-2026-abc'), { id: 'cgt-2026-abc', status: 'processing' });
  const done = (body) => { globalThis.fetch = mockFetch([(u) => u.includes('/tasks/'), () => [200, body]]); return seedance.getResult('t'); };
  const ok = await done({ status: 'succeeded', content: { video_url: 'https://cdn/v.mp4' }, usage: { completion_tokens: 108000 } });
  assert.equal(ok.status, 'completed'); assert.deepEqual(ok.outputs, ['https://cdn/v.mp4']); assert.equal(ok.cost.amount_usd, 1.1556); // 108000 tokens × US$ 10,70/1M
  const bad = await done({ status: 'failed', error: { code: 'InputImageSensitiveContentDetected.PrivacyInformation', message: 'The request failed because the input image may contain real person.' } });
  assert.equal(bad.status, 'failed'); assert.match(bad.error, /real person/); assert.deepEqual(bad.cost, NO_COST);
  assert.equal(describeFailure(bad.error).kind, 'moderation');
  assert.equal((await done({ status: 'expired' })).status, 'failed');
});

// ---------------------------------------------------------------- OpenAI
test('OpenAI: tamanho/qualidade, resposta em base64 e custo pelos tokens devolvidos', async () => {
  globalThis.fetch = mockFetch(on('/images/generations', [200, { data: [{ b64_json: Buffer.from('PNGBYTES').toString('base64') }], output_format: 'png', usage: { input_tokens_details: { text_tokens: 100, image_tokens: 0 }, output_tokens: 1000 } }]));
  const r = await openai.submit({ cfg: DIRECT_MODELS['gpt-image-2.5-flare-text-to-image'], id: gid(), payload: { prompt: 'x', aspect_ratio: '16:9', resolution: '2K', quality: 'xhigh' } });
  assert.equal(r.cost, null);
  const res = await settle(r.requestId);
  const c = globalThis.fetch.calls[0];
  assert.equal(c.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(c.headers.Authorization, 'Bearer test-OPENAI_API_KEY');
  assert.deepEqual(json(c), { model: 'gpt-image-2.5-flare', prompt: 'x', size: '2048x1152', quality: 'xhigh', n: 1 });
  assert.equal(res.status, 'completed');
  assert.equal(res.outputs[0].data.toString(), 'PNGBYTES'); assert.equal(res.outputs[0].mime, 'image/png');
  assert.equal(res.cost.amount_usd, 0.0305); // (100×5 + 1000×30) / 1M
  assert.equal(costFromUsage(undefined), undefined);
  assert.equal(openaiSize('auto', '2K'), 'auto');
});

test('OpenAI edição: baixa as imagens e envia multipart (image[]); sem crédito → falha "saldo insuficiente"', async () => {
  globalThis.fetch = mockFetch(
    [(u) => u.startsWith('https://s/'), () => [200, 'IMGBYTES', { 'content-type': 'image/png' }]],
    on('/images/edits', [200, { data: [{ b64_json: Buffer.from('EDITED').toString('base64') }] }]),
  );
  const cfg = DIRECT_MODELS['gpt-image-2.5-sunburst-image-to-image'];
  const r = await openai.submit({ cfg, id: gid(), payload: { prompt: 'troque o fundo', aspect_ratio: '1:1', resolution: '1K', quality: 'high', images_list: ['https://s/a.png', 'https://s/b.png'] } });
  const res = await settle(r.requestId);
  const edit = globalThis.fetch.calls.find((c) => c.url.endsWith('/images/edits'));
  assert.ok(edit.body instanceof FormData);
  assert.equal(edit.body.get('model'), 'gpt-image-2.5-sunburst'); assert.equal(edit.body.get('size'), '1024x1024');
  assert.equal(edit.body.getAll('image[]').length, 2);
  assert.equal(edit.headers['Content-Type'], undefined, 'o boundary do multipart é definido pelo fetch');
  assert.equal(res.status, 'completed'); assert.equal(res.outputs[0].data.toString(), 'EDITED'); assert.equal(res.cost, undefined, 'sem usage: não afirma valor');

  globalThis.fetch = mockFetch(on('/images/generations', [429, { error: { code: 'credit_balance_exhausted', message: 'You have no credits remaining.' } }]));
  const r2 = await openai.submit({ cfg: DIRECT_MODELS['gpt-image-2.5-flare-text-to-image'], id: gid(), payload: { prompt: 'x', aspect_ratio: 'auto', resolution: '2K', quality: 'low' } });
  const bad = await settle(r2.requestId);
  assert.equal(bad.status, 'failed'); assert.match(bad.error, /Saldo ou cota da conta OpenAI insuficiente/); assert.deepEqual(bad.cost, NO_COST);
});

// ---------------------------------------------------------------- Google
test('Nano Banana Pro: generateContent com imageConfig; imagem de entrada inline; custo tabelado por tamanho', async () => {
  globalThis.fetch = mockFetch(
    [(u) => u.startsWith('https://s/'), () => [200, 'REF', { 'content-type': 'image/jpeg' }]],
    on(':generateContent', [200, { candidates: [{ content: { parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/png', data: Buffer.from('OUT').toString('base64') } }] }, finishReason: 'STOP' }] }]),
  );
  const r = await googleImage.submit({ cfg: DIRECT_MODELS['nano-banana-pro-edit'], id: gid(), payload: { prompt: 'x', aspect_ratio: '4:5', resolution: '2k', images_list: ['https://s/a.jpg'] } });
  assert.equal(r.cost.amount_usd, 0.134);
  const res = await settle(r.requestId);
  const c = globalThis.fetch.calls.find((x) => x.url.includes(':generateContent'));
  assert.equal(c.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent');
  assert.equal(c.headers['x-goog-api-key'], 'test-GEMINI_API_KEY');
  assert.deepEqual(json(c).generationConfig, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:5', imageSize: '2K' } });
  assert.equal(json(c).contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
  assert.equal(res.status, 'completed'); assert.equal(res.outputs[0].data.toString(), 'OUT'); assert.equal(res.cost.amount_usd, 0.134);
  assert.equal(googleImage.estimate(null, { resolution: '4k' }).amount_usd, 0.24);
});

test('Nano Banana Pro: bloqueio de segurança sem imagem vira falha com o motivo (moderação)', async () => {
  globalThis.fetch = mockFetch(on(':generateContent', [200, { candidates: [{ finishReason: 'IMAGE_SAFETY', finishMessage: 'Image blocked.' }] }]));
  const r = await googleImage.submit({ cfg: DIRECT_MODELS['nano-banana-pro'], id: gid(), payload: { prompt: 'x', aspect_ratio: '1:1', resolution: '1k' } });
  const res = await settle(r.requestId);
  assert.equal(res.status, 'failed'); assert.match(res.error, /IMAGE_SAFETY/); assert.deepEqual(res.cost, NO_COST);
  assert.equal(describeFailure(res.error).kind, 'moderation');
  assert.equal(blockReason({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }), 'PROHIBITED_CONTENT');
});

test('Gemini Omni Flash: corpo (texto puro / imagens + texto), limites e vídeo entregue por URI com download autenticado', async () => {
  const cfg = DIRECT_MODELS['gemini-omni-flash-1-1-image-to-video'];
  assert.deepEqual(omniBody(cfg, { prompt: 'x', aspect_ratio: '9:16', resolution: '1080p' }, []),
    { model: 'gemini-omni-1.1-flash', input: 'x', response_format: { type: 'video', aspect_ratio: '9:16', resolution: '1080p', delivery: 'uri' } });
  const imgs = [{ data: 'AAA', mime: 'image/png' }, { data: 'BBB', mime: 'image/jpeg' }];
  assert.deepEqual(omniBody(cfg, { prompt: 'x' }, imgs).input, [{ type: 'image', data: 'AAA', mime_type: 'image/png' }, { type: 'image', data: 'BBB', mime_type: 'image/jpeg' }, { type: 'text', text: 'x' }]);
  assert.throws(() => omniBody(cfg, { prompt: 'x' }, [1, 2, 3, 4]), /até 3 imagens/);
  assert.throws(() => omniBody(cfg, { prompt: 'x', video_url: 'https://v' }, []), /Vídeo de referência só existe na MuAPI/);

  const uri = 'https://generativelanguage.googleapis.com/v1beta/files/abc123:download?alt=media';
  globalThis.fetch = mockFetch(
    [(u, i) => u.endsWith('/interactions') && i.method === 'POST', () => [200, { id: 'v1_x', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', uri }] }] }]],
    [(u) => u.endsWith('/files/abc123'), () => [200, { state: 'ACTIVE' }]],
    [(u) => u === uri, () => [200, 'VIDEOBYTES', { 'content-type': 'video/mp4' }]],
  );
  const r = await googleOmni.submit({ cfg, id: gid(), payload: { prompt: 'x', aspect_ratio: '16:9', resolution: '720p' } });
  assert.equal(r.cost.estimated, true);
  const res = await settle(r.requestId);
  assert.equal(res.status, 'completed'); assert.equal(res.outputs[0].data.toString(), 'VIDEOBYTES'); assert.equal(res.outputs[0].mime, 'video/mp4');
  const dl = globalThis.fetch.calls.find((c) => c.url === uri);
  assert.equal(dl.headers['x-goog-api-key'], 'test-GEMINI_API_KEY', 'o download usa o cabeçalho; a chave nunca vai na URL guardada');
  // erro de validação cedo (antes de gastar): vídeo de referência
  await assert.rejects(googleOmni.submit({ cfg, id: gid(), payload: { prompt: 'x', video_url: 'https://v' } }), /Vídeo de referência/);
});

// ---------------------------------------------------------------- Kling
test('Kling: corpo (texto/imagem), envelope { code, data }, estados da tarefa e custo por unidades', async () => {
  const t2v = DIRECT_MODELS['kling-v3.0-pro-text-to-video'], i2v = DIRECT_MODELS['kling-v3.0-4k-image-to-video'];
  assert.deepEqual(klingBody(t2v, { prompt: 'x', duration: 8, aspect_ratio: '9:16', generate_audio: false }),
    { model_name: 'kling-v3', mode: 'pro', prompt: 'x', duration: '8', sound: 'off', aspect_ratio: '9:16' });
  assert.deepEqual(klingBody(i2v, { prompt: 'x', image_url: 'https://s/i.png', last_image: 'https://s/l.png', generate_audio: true }),
    { model_name: 'kling-v3', mode: '4k', prompt: 'x', duration: '5', sound: 'on', image: 'https://s/i.png', image_tail: 'https://s/l.png' });
  assert.throws(() => klingBody(i2v, { prompt: 'x' }), /imagem inicial/);

  globalThis.fetch = mockFetch(
    [(u, i) => u.endsWith('/v1/videos/image2video') && i.method === 'POST', () => [200, { code: 0, message: 'SUCCEED', data: { task_id: 'k-1', task_status: 'submitted' } }]],
    [(u) => u.endsWith('/v1/videos/image2video/k-1'), () => [200, { code: 0, data: { task_status: 'processing' } }]],
  );
  const r = await kling.submit({ cfg: DIRECT_MODELS['kling-v3.0-standard-image-to-video'], payload: { prompt: 'x', image_url: 'https://s/i.png' } });
  assert.equal(r.requestId, 'image2video:k-1'); assert.equal(r.cost, null);
  assert.equal(globalThis.fetch.calls[0].url, 'https://api-singapore.klingai.com/v1/videos/image2video');
  assert.equal(globalThis.fetch.calls[0].headers.Authorization, 'Bearer test-KLING_API_KEY');
  assert.equal((await kling.getResult(r.requestId)).status, 'processing');

  const get = (data, http = 200) => { globalThis.fetch = mockFetch([(u) => u.includes('/v1/videos/'), () => [http, { code: 0, ...data }]]); return kling.getResult('text2video:k-2'); };
  const ok = await get({ data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn/k.mp4' }] }, final_unit_deduction: '2.5' } });
  assert.equal(ok.status, 'completed'); assert.deepEqual(ok.outputs, ['https://cdn/k.mp4']); assert.equal(ok.cost.amount_usd, 0.35); assert.equal(ok.cost.estimated, true);
  assert.equal((await get({ data: { task_status: 'succeed', task_result: { videos: [{ url: 'u' }] } } })).cost, undefined, 'sem unidades: não afirma valor');
  const bad = await get({ data: { task_status: 'failed', task_status_msg: 'The uploaded content contains material that violates our guidelines.' } });
  assert.equal(bad.status, 'failed'); assert.deepEqual(bad.cost, NO_COST); assert.equal(describeFailure(bad.error).kind, 'moderation');
  globalThis.fetch = mockFetch([(u) => u.includes('/v1/videos/'), () => [200, { code: 1102, message: 'Account balance not enough' }]]);
  await assert.rejects(kling.getResult('text2video:k-3'), (e) => e instanceof MuapiError && e.status === 402 && /Saldo ou cota/.test(e.message));
  globalThis.fetch = mockFetch([(u) => u.includes('/v1/videos/'), () => [400, { code: 1201, message: 'duration value is invalid' }]]);
  await assert.rejects(kling.submit({ cfg: t2v, payload: { prompt: 'x' } }), (e) => e.status === 400 && /Parâmetros recusados por Kling/.test(e.message));
});

// ---------------------------------------------------------------- integração com o núcleo de geração
function serviceFor(row) {
  const store = makeStore([row]);
  const persist = fakePersist();
  const log = logs();
  const service = createGenerationService({ store, getResult: (id, o) => directGetResult(o.row, id), persist, now: () => T0 + 60000, log });
  return { store, persist, log, service };
}
const directRow = (over = {}) => makeRow({ sandbox: false, provider: 'google', endpoint: 'nano-banana-pro', model_id: 'nano-banana-pro', cost_usd: 0.134, cost_credits: null, cost_reserved_usd: 0.134, cost_reserved_credits: null, refunded: false, ...over });

test('núcleo + API direta síncrona: processing → concluída; salva os bytes; custo tabelado; polling e vigia juntos finalizam UMA vez', async () => {
  globalThis.fetch = mockFetch(on(':generateContent', [200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('OUT').toString('base64') } }] } }] }]));
  const id = gid();
  const row = directRow({ provider_request_id: jobId('google', id) });
  const t = serviceFor(row);
  await googleImage.submit({ cfg: DIRECT_MODELS['nano-banana-pro'], id, payload: { prompt: 'x', aspect_ratio: '1:1', resolution: '1k' } });
  await settle(jobId('google', id)); // o provedor já respondeu; agora polling e vigia disputam a finalização
  const rs = await Promise.all([
    t.service.syncGenerationDetailed(structuredClone(row), { source: 'poll' }),
    t.service.syncGenerationDetailed(structuredClone(row), { source: 'watch' }),
    t.service.syncGenerationDetailed(structuredClone(row), { source: 'poll' }),
  ]);
  const later = await t.service.syncGenerationDetailed(structuredClone(row), { source: 'watch' });
  const outcomes = [...rs, later].map((r) => r.outcome);
  assert.equal(outcomes.filter((o) => o === 'finalized').length, 1, outcomes.join());
  const db = t.store.db.get(row.id);
  assert.equal(db.status, 'completed'); assert.equal(db.cost_usd, 0.134); assert.equal(db.cost_estimated, false); assert.equal(db.refunded, false);
  assert.equal(db.cost_reserved_usd, 0.134);
  assert.equal(t.persist.calls, 1); assert.equal(t.store.calls.finish, 1);
});

test('núcleo + API direta: falha do provedor → custo 0 (não cobrado), motivo registrado; custo "estimado" (Kling/Seedream) fica marcado', async () => {
  globalThis.fetch = mockFetch(on(':generateContent', [200, { candidates: [{ finishReason: 'IMAGE_SAFETY' }] }]));
  const id = gid();
  const row = directRow({ provider_request_id: jobId('google', id) });
  const t = serviceFor(row);
  await googleImage.submit({ cfg: DIRECT_MODELS['nano-banana-pro'], id, payload: { prompt: 'x', aspect_ratio: '1:1', resolution: '1k' } });
  await settle(jobId('google', id));
  const { row: done } = await t.service.syncGenerationDetailed(row);
  assert.equal(done.status, 'failed'); assert.equal(done.cost_usd, 0); assert.equal(done.refunded, false);
  assert.equal(done.cost_reserved_usd, 0.134, 'o valor reservado no envio continua no histórico');
  assert.equal(done.timeline.failure.kind, 'moderation');

  // estimado (Kling: unidades × preço da unit)
  globalThis.fetch = mockFetch([(u) => u.includes('/v1/videos/'), () => [200, { code: 0, data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn/k.mp4' }] }, final_unit_deduction: '3' } }]]);
  const krow = makeRow({ id: gid(), sandbox: false, provider: 'kling', endpoint: 'kling-v3.0-pro-image-to-video', provider_request_id: 'image2video:k-9', cost_usd: null, cost_credits: null, refunded: false });
  const kt = serviceFor(krow);
  const { row: kdone } = await kt.service.syncGenerationDetailed(krow);
  assert.equal(kdone.status, 'completed'); assert.equal(kdone.cost_usd, 0.42); assert.equal(kdone.cost_estimated, true);
});

test('núcleo + API direta: servidor reiniciou no meio (job sumiu) → falha "interrompida" mantendo o valor reservado como estimativa', async () => {
  const row = directRow({ provider_request_id: jobId('google', gid()) });
  const t = serviceFor(row);
  const { row: done } = await t.service.syncGenerationDetailed(row);
  assert.equal(done.status, 'failed'); assert.match(done.error, /interrompida/);
  assert.equal(done.cost_usd, 0.134, 'não afirma que foi grátis: o provedor pode ter cobrado');
  assert.equal(done.cost_estimated, true);
});
