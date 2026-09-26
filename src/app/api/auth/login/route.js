import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { findForLogin, canUseAiStudio } from '@/lib/dashboard-users';
import { SESSION_COOKIE, signSession, sessionCookieOptions } from '@/lib/session-token';

export const dynamic = 'force-dynamic';

// Limite de tentativas por IP+usuário (em memória, por instância): 8 erros em 10 minutos.
const fails = new Map();
const WINDOW = 10 * 60_000;
const MAX = 8;
// Hash qualquer, só para gastar o mesmo tempo quando o usuário não existe.
const DUMMY = bcrypt.hashSync('sem-usuario', 12);

function blocked(key) {
  const f = fails.get(key);
  if (!f) return false;
  if (f.reset < Date.now()) { fails.delete(key); return false; }
  return f.n >= MAX;
}
function fail(key) {
  const f = fails.get(key);
  if (!f || f.reset < Date.now()) fails.set(key, { n: 1, reset: Date.now() + WINDOW });
  else f.n++;
  if (fails.size > 2000) fails.clear();
}

// Login direto: mesmo usuário e senha da Dashboard (dashboard_users, bcrypt).
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) return NextResponse.json({ error: 'Informe usuário e senha.' }, { status: 400 });

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'ip';
  const key = `${ip}|${username.toLowerCase()}`;
  if (blocked(key)) return NextResponse.json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429 });

  const u = await findForLogin(username);
  const ok = await bcrypt.compare(password, u?.hashed_password || DUMMY);
  if (!u || !ok) { fail(key); return NextResponse.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 }); }
  // Só depois de acertar a senha dizemos o motivo (não revela quais usuários existem).
  if (!u.is_active) return NextResponse.json({ error: 'Usuário desativado.' }, { status: 403 });
  if (!canUseAiStudio(u)) return NextResponse.json({ error: 'Você não tem acesso ao AI Studio. Peça ao administrador da Dashboard.' }, { status: 403 });

  fails.delete(key);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await signSession(u), sessionCookieOptions());
  return res;
}
