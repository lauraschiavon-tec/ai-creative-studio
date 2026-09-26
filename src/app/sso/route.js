import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { getDashboardUser, canUseAiStudio } from '@/lib/dashboard-users';
import { SESSION_COOKIE, signSession, sessionCookieOptions } from '@/lib/session-token';
import { publicUrl } from '@/lib/public-url';

export const dynamic = 'force-dynamic';

// Tickets já usados (jti), por instância: garante uso único dentro da vida curta do ticket (60s).
const used = new Map();

const back = (req, erro) => NextResponse.redirect(publicUrl(req, `/login?erro=${erro}`));

// Entrada vinda da Dashboard: valida o ticket, relê o usuário em dashboard_users e abre a sessão.
export async function GET(req) {
  const ticket = req.nextUrl.searchParams.get('ticket');
  const secret = process.env.AISTUDIO_SSO_SECRET;
  if (!ticket || !secret) return back(req, 'sso');

  let claims;
  try {
    ({ payload: claims } = await jwtVerify(ticket, new TextEncoder().encode(secret), {
      issuer: 'traffic-dashboard', audience: 'aistudio', algorithms: ['HS256'], clockTolerance: 5,
    }));
  } catch {
    return back(req, 'sso');
  }

  const now = Date.now();
  for (const [k, exp] of used) if (exp < now) used.delete(k);
  if (!claims.jti || !claims.sub || used.has(claims.jti)) return back(req, 'sso');
  used.set(claims.jti, now + 120_000);

  const u = await getDashboardUser(claims.sub);
  if (!u || !u.is_active) return back(req, 'desativado');
  if (!canUseAiStudio(u)) return back(req, 'sem_acesso');

  const res = NextResponse.redirect(publicUrl(req, '/'));
  res.cookies.set(SESSION_COOKIE, await signSession(u), sessionCookieOptions());
  return res;
}
