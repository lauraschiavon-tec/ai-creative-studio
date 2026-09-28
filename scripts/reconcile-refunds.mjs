// Corrige gerações FALHAS antigas que a MuAPI estornou mas ficaram no banco com o custo estimado e refunded=false.
// Consulta o resultado de cada uma na MuAPI (só leitura, sem custo) e lê os headers x-muapi-cost-usd/-credits/-refunded.
// Uso: npm run reconcile-refunds              → simulação (não grava nada)
//      npm run reconcile-refunds -- --apply   → grava: cost_usd/cost_credits = 0, refunded = true, cost_reserved_* = valor original
// Pré-requisito para --apply: migration 004 (colunas cost_reserved_*). Só olha gerações reais (sandbox=false) com custo > 0.
// A MuAPI guarda o resultado por ~30 dias; jobs mais antigos ficam como "sem informação" e não são alterados.
import { createClient } from '@supabase/supabase-js';

const apply = process.argv.includes('--apply');
const key = process.env.MUAPI_API_KEY;
if (!key || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  console.error('Faltam MUAPI_API_KEY / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY (rode via npm run reconcile-refunds).');
  process.exit(1);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const { data: rows, error } = await db.from('atelie_generations')
  .select('id,endpoint,created_at,provider_request_id,cost_usd,cost_credits,refunded,status')
  .eq('status', 'failed').eq('sandbox', false).eq('refunded', false).gt('cost_usd', 0).not('provider_request_id', 'is', null)
  .order('created_at', { ascending: false }).limit(5000);
if (error) { console.error('Falha ao ler o banco:', error.message); process.exit(1); }

let fixable = 0, saved = 0, unknown = 0, charged = 0;
for (const r of rows) {
  let res;
  try { res = await fetch(`https://api.muapi.ai/api/v1/predictions/${encodeURIComponent(r.provider_request_id)}/result`, { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(15000) }); }
  catch (e) { console.log(r.id, 'rede:', e.message); unknown++; continue; }
  const refunded = String(res.headers.get('x-muapi-cost-refunded') ?? '').trim().toLowerCase() === 'true';
  if (!refunded) { // sem header = sem informação; não altera
    if (res.headers.get('x-muapi-cost-refunded') == null) unknown++; else charged++;
    console.log(r.created_at, r.endpoint, `US$ ${r.cost_usd}`, '→ sem reembolso informado (mantido)');
    continue;
  }
  fixable++;
  console.log(r.created_at, r.endpoint, `US$ ${r.cost_usd} → 0 (estornado)`, apply ? '' : '[simulação]');
  if (!apply) continue;
  const { error: e } = await db.from('atelie_generations').update({
    cost_reserved_usd: r.cost_usd, cost_reserved_credits: r.cost_credits, cost_usd: 0, cost_credits: 0, refunded: true, cost_estimated: false,
  }).eq('id', r.id).eq('refunded', false);
  if (e) { console.error('  falhou:', e.message, /cost_reserved/.test(e.message) ? '(rode a migration 004 antes)' : ''); process.exit(1); }
  saved += Number(r.cost_usd);
}
console.log(`\n${rows.length} falhas com custo verificadas · ${fixable} estornadas · ${charged} cobradas · ${unknown} sem informação.`);
console.log(apply ? `Corrigidas ${fixable}; US$ ${saved.toFixed(2)} deixaram de contar como gasto.` : 'Simulação: nada foi gravado. Use --apply para gravar.');
