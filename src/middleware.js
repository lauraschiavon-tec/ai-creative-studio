import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

// Renova a sessão do Supabase e protege as páginas (a API valida por conta própria).
export async function middleware(req) {
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
  const isLogin = req.nextUrl.pathname === '/login';
  if (!user && !isLogin) return NextResponse.redirect(new URL('/login', req.url));
  if (user && isLogin) return NextResponse.redirect(new URL('/', req.url));
  return res;
}

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] };
