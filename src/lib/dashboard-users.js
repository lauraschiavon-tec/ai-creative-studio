import 'server-only';
import { supabaseAdmin } from './supabase/admin';

// Fonte única de usuários, papéis e permissões: a tabela dashboard_users, gerida só pela Dashboard.
// Este arquivo apenas LÊ. Nunca devolva hashed_password ao navegador.
export const AISTUDIO_ROUTE = '/aistudio'; // chave dentro de dashboard_users.permissions

const COLS = 'id,username,email,role,is_active,permissions';
const CACHE_MS = 15_000; // revogação/desativação vale em até ~15s
const cache = new Map();

// Mesma regra do hasAccess da Dashboard: admin e permissions=null = acesso total.
export function canUseAiStudio(u) {
  if (!u || !u.is_active) return false;
  if (u.role === 'admin' || u.permissions == null) return true;
  return Array.isArray(u.permissions) && u.permissions.includes(AISTUDIO_ROUTE);
}

export async function getDashboardUser(id) {
  const hit = cache.get(id);
  if (hit && hit.exp > Date.now()) return hit.user;
  const { data } = await supabaseAdmin().from('dashboard_users').select(COLS).eq('id', id).maybeSingle();
  cache.set(id, { user: data || null, exp: Date.now() + CACHE_MS });
  if (cache.size > 500) cache.clear();
  return data || null;
}

export async function findForLogin(username) {
  const { data } = await supabaseAdmin().from('dashboard_users').select(`${COLS},hashed_password`).eq('username', username).maybeSingle();
  return data || null;
}

// Formato { user, profile } que o restante do app já usa.
export function toSession(u) {
  return {
    user: { id: u.id, email: u.email || null, app_metadata: {} },
    profile: { id: u.id, email: u.email || u.username, full_name: u.username, role: u.role === 'admin' ? 'admin' : 'user', active: true },
  };
}
