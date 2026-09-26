import 'server-only';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { supabaseServer } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';
import { SESSION_COOKIE, verifySession } from './session-token';
import { getDashboardUser, canUseAiStudio, toSession } from './dashboard-users';

// Login antigo (Supabase Auth + atelie_profiles). Fica como fallback durante a migração;
// desligue com LEGACY_LOGIN=off quando o login pela Dashboard estiver validado em produção.
export const legacyEnabled = () => (process.env.LEGACY_LOGIN || '').trim().toLowerCase() !== 'off';

// Retorna { user, profile } ou null. Sempre revalida no servidor.
export async function getSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    const claims = await verifySession(token);
    if (claims) {
      const u = await getDashboardUser(claims.sub); // relê a Dashboard: desativado ou sem permissão = fora
      return u && canUseAiStudio(u) ? toSession(u) : null;
    }
  }
  if (!legacyEnabled()) return null;
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
