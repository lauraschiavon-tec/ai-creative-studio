import 'server-only';
import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';

// Retorna { user, profile } ou null. Sempre valida o token no servidor (getUser).
export async function getSession() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabaseAdmin().from('atelie_profiles').select('*').eq('id', user.id).single();
  if (!profile || !profile.active) return null;
  return { user, profile };
}

export async function requireSession({ admin = false } = {}) {
  const s = await getSession();
  if (!s) redirect('/login');
  if (admin && s.profile.role !== 'admin') redirect('/');
  return s;
}

// Para rotas de API: devolve a sessão ou uma Response 401/403.
export async function apiSession({ admin = false } = {}) {
  const s = await getSession();
  if (!s) return { error: Response.json({ error: 'Sessão expirada. Entre novamente.' }, { status: 401 }) };
  if (admin && s.profile.role !== 'admin') return { error: Response.json({ error: 'Acesso restrito a administradores.' }, { status: 403 }) };
  return s;
}
