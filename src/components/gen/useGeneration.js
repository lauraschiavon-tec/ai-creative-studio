'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isDone } from '../format';

export async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro inesperado. Tente novamente.');
  return data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Envia uma geração e acompanha (polling) até terminar. `run` devolve a geração final (ou null se falhou ao enviar).
export function useGeneration() {
  const [gen, setGen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sessionCost, setSessionCost] = useState({ usd: 0, credits: 0, n: 0 });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const run = useCallback(async (body) => {
    setError(''); setBusy(true); setGen(null);
    try {
      let g = await api('/api/generations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (alive.current) setGen(g);
      let failures = 0;
      while (!isDone(g.status)) {
        await sleep(3000);
        if (!alive.current) return null;
        try { g = await api(`/api/generations/${g.id}`); failures = 0; if (alive.current) setGen(g); }
        catch (e) { if (++failures >= 20) throw e; } // falha transitória de rede: tenta de novo
      }
      if (g.status === 'completed' && alive.current) {
        setSessionCost((c) => ({ usd: c.usd + Number(g.cost_usd || 0), credits: c.credits + Number(g.cost_credits || 0), n: c.n + 1 }));
      }
      return g;
    } catch (e) {
      if (alive.current) { setError(e.message); setGen(null); }
      return null;
    } finally { if (alive.current) setBusy(false); }
  }, []);

  return { gen, busy, error, setError, sessionCost, run };
}

// Estimativa de custo (debounce) — best-effort. null = calculando; { available: false } = indisponível.
export function useEstimate(studio, model, params, prompt) {
  const [estimate, setEstimate] = useState(null);
  const key = model?.id;
  useEffect(() => { setEstimate(null); }, [key]);
  useEffect(() => {
    if (!model) return;
    const t = setTimeout(() => {
      api('/api/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studio, catalogId: model.id, prompt, params }) })
        .then(setEstimate).catch(() => setEstimate({ available: false }));
    }, 700);
    return () => clearTimeout(t);
  }, [model, params, prompt, studio]);
  return estimate;
}
