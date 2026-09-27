import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session-token';

// Protege as páginas (a API valida por conta própria). Dois jeitos de estar logado:
//  1) sessão do AI Studio (usuário da Dashboard, cookie assinado): a checagem completa (ativo/permissão) é feita em lib/auth.js;
//  2) login antigo do Supabase (fallback; LEGACY_LOGIN=off desliga).
export async function middleware(req) {
  const path = req.nextUrl.pathname;
  // /login decide sozinho (server component); /sso valida o ticket da Dashboard.
  if (path === '/login' || path === '/sso') return NextResponse.next({ request: req });

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token && (await verifySession(token))) return NextResponse.next({ request: req });

  if ((process.env.LEGACY_LOGIN || '').trim().toLowerCase() === 'off') return NextResponse.redirect(new URL('/login', req.url));

  let res = NextResponse.next({ request: req });
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));
  return res;
}

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico|logo.png|icon.png).*)'] };
