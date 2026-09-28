import 'server-only';
import { supabaseAdmin } from './supabase/admin';

// Acesso à tabela atelie_generations usado pela finalização (polling e webhook).
// As colunas `timeline` e `finalizing_at` vêm da migration 003. Se ela ainda não foi rodada, tudo continua funcionando
// (sem telemetria no banco e sem a trava de finalização; a gravação final segue condicional ao status): nada quebra por ordem de deploy.
const OPEN = ['pending', 'processing'];
const OPTIONAL = ['timeline', 'finalizing_at'];
let warned = false;

const isMissingColumn = (e) => !!e && (e.code === 'PGRST204' || e.code === '42703' || /could not find the .* column|column .* does not exist/i.test(e.message || ''));
function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn('[gen] colunas timeline/finalizing_at ausentes: rode supabase/migrations/003_webhook_telemetria.sql (funciona sem, mas sem telemetria no banco nem trava anti-duplicidade).');
}
const strip = (patch) => Object.fromEntries(Object.entries(patch).filter(([k]) => !OPTIONAL.includes(k)));

const table = () => supabaseAdmin().from('atelie_generations');

export const store = {
  async get(id) {
    const { data } = await table().select('*').eq('id', id).maybeSingle();
    return data || null;
  },

  async update(id, patch) {
    let { data, error } = await table().update(patch).eq('id', id).select().maybeSingle();
    if (error && isMissingColumn(error)) {
      warnOnce();
      ({ data, error } = await table().update(strip(patch)).eq('id', id).select().maybeSingle());
    }
    if (error) console.error('[gen] update falhou:', id, error.message);
    return data || null;
  },

  // Reivindica a finalização. UPDATE condicional atômico: só um chamador recebe a linha; os demais recebem null.
  async claim(id, claimIso, staleBeforeIso) {
    const { data, error } = await table().update({ finalizing_at: claimIso }).eq('id', id).in('status', OPEN)
      .or(`finalizing_at.is.null,finalizing_at.lt.${staleBeforeIso}`).select().maybeSingle();
    if (error && isMissingColumn(error)) { // sem migration: sem trava, segue (a gravação final ainda é condicional)
      warnOnce();
      const { data: cur } = await table().select('*').eq('id', id).in('status', OPEN).maybeSingle();
      return cur || null;
    }
    if (error) throw error;
    return data || null;
  },

  // Grava o resultado final só se a geração ainda estiver aberta (e, com trava, se a reivindicação ainda for a nossa).
  async finish(id, claimIso, patch) {
    const run = (p, withClaim) => {
      let q = table().update(p).eq('id', id).in('status', OPEN);
      if (withClaim) q = q.eq('finalizing_at', claimIso);
      return q.select().maybeSingle();
    };
    let { data, error } = await run(patch, true);
    if (error && isMissingColumn(error)) {
      warnOnce();
      ({ data, error } = await run(strip(patch), false));
    }
    if (error) throw error;
    return data || null;
  },

  // Desfaz a reivindicação (quando a finalização falhou por erro inesperado) para o próximo poll/webhook tentar.
  async release(id, claimIso) {
    const { error } = await table().update({ finalizing_at: null }).eq('id', id).eq('finalizing_at', claimIso);
    if (error && !isMissingColumn(error)) throw error;
  },
};
