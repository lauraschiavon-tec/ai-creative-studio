import { apiSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Custos por usuário e total da empresa. Só admin. Sandbox fica separado (não é gasto real).
export async function GET(req) {
  const s = await apiSession({ admin: true });
  if (s.error) return s.error;
  const month = new URL(req.url).searchParams.get('month'); // YYYY-MM opcional
  const sb = supabaseAdmin();
  let q = sb.from('atelie_generations').select('user_id,model_name,status,cost_usd,cost_credits,sandbox,created_at').order('created_at', { ascending: false }).limit(20000);
  if (/^\d{4}-\d{2}$/.test(month || '')) {
    const start = new Date(`${month}-01T00:00:00Z`);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    q = q.gte('created_at', start.toISOString()).lt('created_at', end.toISOString());
  }
  const [{ data: rows, error }, { data: profiles }] = await Promise.all([q, sb.from('atelie_profiles').select('id,email,full_name,role,active')]);
  if (error) return Response.json({ error: 'Falha ao carregar custos.' }, { status: 500 });

  const acc = () => ({ generations: 0, completed: 0, failed: 0, usd: 0, credits: 0 });
  const add = (a, r) => {
    a.generations++;
    if (r.status === 'completed') a.completed++;
    if (r.status === 'failed') a.failed++;
    a.usd += Number(r.cost_usd || 0);
    a.credits += Number(r.cost_credits || 0);
  };
  const total = { real: acc(), sandbox: acc() };
  const byUser = new Map();
  const byModel = new Map();
  for (const r of rows) {
    add(r.sandbox ? total.sandbox : total.real, r);
    if (r.sandbox) continue;
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, acc());
    add(byUser.get(r.user_id), r);
    if (!byModel.has(r.model_name)) byModel.set(r.model_name, acc());
    add(byModel.get(r.model_name), r);
  }
  const pmap = new Map((profiles || []).map((p) => [p.id, p]));
  return Response.json({
    total,
    users: [...byUser].map(([id, v]) => ({ ...v, id, email: pmap.get(id)?.email, name: pmap.get(id)?.full_name })).sort((a, b) => b.usd - a.usd),
    models: [...byModel].map(([name, v]) => ({ ...v, name })).sort((a, b) => b.usd - a.usd),
  });
}
