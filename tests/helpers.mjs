import { MuapiError } from '../src/lib/muapi.js';

export const tick = () => new Promise((r) => setImmediate(r));

// Armazenamento em memória com a MESMA semântica atômica do UPDATE condicional do Postgres (claim/finish).
export function makeStore(rows = []) {
  const db = new Map(rows.map((r) => [r.id, structuredClone(r)]));
  const calls = { claim: 0, finish: 0, update: 0, release: 0 };
  const OPEN = ['pending', 'processing'];
  const copy = (r) => (r ? structuredClone(r) : null);
  return {
    db, calls,
    async get(id) { await tick(); return copy(db.get(id)); },
    async update(id, patch) { calls.update++; await tick(); const r = db.get(id); if (!r) return null; Object.assign(r, structuredClone(patch)); return copy(r); },
    async claim(id, claimIso, staleBeforeIso) {
      calls.claim++; await tick();
      const r = db.get(id);
      if (!r || !OPEN.includes(r.status)) return null;
      if (r.finalizing_at && r.finalizing_at >= staleBeforeIso) return null; // alguém já reivindicou (e não está velha)
      r.finalizing_at = claimIso;
      return copy(r);
    },
    async finish(id, claimIso, patch) {
      await tick();
      const r = db.get(id);
      if (!r || !OPEN.includes(r.status) || r.finalizing_at !== claimIso) return null;
      calls.finish++;
      Object.assign(r, structuredClone(patch));
      return copy(r);
    },
    async release(id, claimIso) { calls.release++; const r = db.get(id); if (r && r.finalizing_at === claimIso) r.finalizing_at = null; },
  };
}

export const T0 = Date.parse('2026-09-28T15:00:00.000Z');
export const makeRow = (over = {}) => ({
  id: '11111111-2222-4333-8444-555555555555', user_id: 'user-1', studio: 'video', model_id: 'seedance-2.5-image-to-video', endpoint: 'seedance-2.5-image-to-video',
  status: 'processing', provider_request_id: 'req-abc', sandbox: true, outputs: [], created_at: new Date(T0).toISOString(), finished_at: null,
  cost_usd: 0.85, cost_credits: 67, cost_estimated: false, timeline: { provider_status: 'processing', status_seen: [{ s: 'processing', at: new Date(T0).toISOString(), src: 'submit' }] },
  ...over,
});

// getResult roteirizado: cada chamada consome o próximo item (valor = resposta; Error = lançado). O último se repete.
export function scripted(...steps) {
  const fn = async () => {
    fn.calls++;
    await tick();
    const step = steps[Math.min(fn.calls - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step() : step;
  };
  fn.calls = 0;
  return fn;
}

export const completed = (extra = {}) => ({ id: 'req-abc', status: 'completed', outputs: ['https://cdn.muapi.ai/outputs/a.mp4'], created_at: new Date(T0).toISOString(), executionTime: 125000, timings: { inference: 125000 }, cost: { amount_usd: 0.9, amount_credits: 71, refunded: false }, ...extra });

export function fakePersist() {
  const fn = async (row, url, i) => { fn.calls++; await tick(); await tick(); return { path: `${row.user_id}/${row.id}-${i}.mp4`, remote: url }; };
  fn.calls = 0;
  return fn;
}

export const noLog = () => {};
export const logs = () => { const l = []; const fn = (evt, row, extra) => l.push({ evt, gen: row?.id, ...extra }); fn.list = l; return fn; };

// fetch falso da MuAPI: cada resposta é [status, corpo, headers?] ou Error (rede).
export function fakeFetch(...steps) {
  const fn = async (url, init) => {
    fn.calls.push({ url: String(url), method: init?.method || 'GET' });
    const step = steps[Math.min(fn.calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    const [status, body, headers = {}] = step;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  };
  fn.calls = [];
  return fn;
}
export { MuapiError };
