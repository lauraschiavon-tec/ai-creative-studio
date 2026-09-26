import { apiSession } from '@/lib/auth';
import { getMode, MODE_COOKIE } from '@/lib/mode';

// Liga/desliga o modo teste do próprio usuário. Só vale para quem pode escolher (ver lib/mode.js).
export async function POST(req) {
  const s = await apiSession();
  if (s.error) return s.error;
  let body; try { body = await req.json(); } catch { return Response.json({ error: 'Requisição inválida.' }, { status: 400 }); }
  if (typeof body.sandbox !== 'boolean') return Response.json({ error: 'Requisição inválida.' }, { status: 400 });

  const current = await getMode(s.user);
  if (!current.canChoose) {
    return Response.json({ error: current.reason === 'user' ? 'Sua conta é somente de teste (Sandbox).' : 'O app está em modo teste para todos.', ...current }, { status: 403 });
  }
  const res = Response.json({ sandbox: body.sandbox, canChoose: true });
  res.headers.append('Set-Cookie', `${MODE_COOKIE}=${body.sandbox ? 'sandbox' : 'production'}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${req.nextUrl.protocol === 'https:' ? '; Secure' : ''}`);
  return res;
}
