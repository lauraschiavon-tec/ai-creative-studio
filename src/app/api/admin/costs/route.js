import { apiSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { costAcc, costAdd } from '@/lib/cost-totals';
import { providerLabel } from '@/lib/direct';

// Custos por usuário e total da empresa. Só admin. Sandbox fica separado (não é gasto real).
export async function GET(req) {
  const s = await apiSession({ admin: true });
  if (s.error) return s.error;
  const month = new URL(req.url).searchParams.get('month'); // YYYY-MM opcional
  const sb = supabaseAdmin();
  // cost_usd/cost_credits = efetivamente cobrado (0 quando a MuAPI estornou); cost_reserved_* = valor original reservado (migration 004).
  const COLS = 'user_id,studio,model_name,status,cost_usd,cost_credits,refunded,sandbox,created_at';
  const query = (cols) => {
    let q = sb.from('atelie_generations').select(cols).order('created_at', { ascending: false }).limit(20000);
    if (/^\d{4}-\d{2}$/.test(month || '')) {
      const start = new Date(`${month}-01T00:00:00Z`);
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      q = q.gte('created_at', start.toISOString()).lt('created_at', end.toISOString());
    }
    return q;
  };
  // Colunas opcionais: cost_reserved_* (migration 004) e provider (005). Sem elas o painel segue funcionando; a que o banco não conhece é removida.
  const withOptional = async () => {
    let extras = ['cost_reserved_usd', 'cost_reserved_credits', 'provider'];
    for (let i = 0; i < 3; i++) {
      const r = await query([COLS, ...extras].join(','));
      if (!r.error) return r;
      const missing = extras.filter((c) => (r.error.message || '').includes(c));
      extras = missing.length ? extras.filter((c) => !missing.includes(c)) : [];
    }
    return query(COLS);
  };
  const [{ data: rows, error }, { data: legacy }, { data: dash }] = await Promise.all([
    withOptional(),
    sb.from('atelie_profiles').select('id,email,full_name,role,active'),
    sb.from('dashboard_users').select('id,username,email'), // usuários atuais (Dashboard)
  ]);
  if (error) return Response.json({ error: 'Falha ao carregar custos.' }, { status: 500 });
  const profiles = [...(legacy || []), ...(dash || []).map((d) => ({ id: d.id, email: d.email || d.username, full_name: d.username }))];

  const acc = costAcc;
  const add = costAdd; // estornada não é gasto (ver lib/cost-totals.js)
  const total = { real: acc(), sandbox: acc() };
  const byUser = new Map();
  const byModel = new Map();
  const byStudio = new Map();
  const byProvider = new Map();
  const provName = (p) => (p === 'muapi' ? 'MuAPI' : `API direta · ${providerLabel(p)}`);
  for (const r of rows) {
    add(r.sandbox ? total.sandbox : total.real, r);
    if (r.sandbox) continue;
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, acc());
    add(byUser.get(r.user_id), r);
    if (!byStudio.has(r.studio)) byStudio.set(r.studio, acc());
    add(byStudio.get(r.studio), r);
    const prov = r.provider || 'muapi';
    if (!byProvider.has(prov)) byProvider.set(prov, acc());
    add(byProvider.get(prov), r);
    // O mesmo modelo por MuAPI e por API direta aparece em linhas separadas: é a comparação de custo.
    const mk = prov === 'muapi' ? r.model_name : `${r.model_name} · ${provName(prov)}`;
    if (!byModel.has(mk)) byModel.set(mk, acc());
    add(byModel.get(mk), r);
  }
  const pmap = new Map((profiles || []).map((p) => [p.id, p]));
  return Response.json({
    total,
    users: [...byUser].map(([id, v]) => ({ ...v, id, email: pmap.get(id)?.email, name: pmap.get(id)?.full_name })).sort((a, b) => b.usd - a.usd),
    studios: [...byStudio].map(([name, v]) => ({ ...v, name })).sort((a, b) => b.usd - a.usd),
    providers: [...byProvider].map(([id, v]) => ({ ...v, id, name: provName(id) })).sort((a, b) => b.usd - a.usd),
    models: [...byModel].map(([name, v]) => ({ ...v, name })).sort((a, b) => b.usd - a.usd),
  });
}
