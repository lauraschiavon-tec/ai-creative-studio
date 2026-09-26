// Sessão própria do AI Studio (usuários da Dashboard). Sem imports de servidor: o middleware (edge) também usa.
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'aic_session';
export const SESSION_HOURS = 12;

const enc = new TextEncoder();

// AISTUDIO_SESSION_SECRET (recomendado). Sem ela, deriva da SUPABASE_SECRET_KEY, que já é segredo do servidor.
async function sessionKey() {
  const explicit = process.env.AISTUDIO_SESSION_SECRET;
  if (explicit) return enc.encode(explicit);
  const base = process.env.SUPABASE_SECRET_KEY;
  if (!base) throw new Error('Defina AISTUDIO_SESSION_SECRET.');
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`aic-session:${base}`)));
}

export async function signSession({ id, username, role }) {
  return new SignJWT({ username, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(id))
    .setIssuer('ai-creative')
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(await sessionKey());
}

// Só a assinatura e a validade. Quem decide se o usuário ainda pode entrar é lib/auth.js (relê a Dashboard).
export async function verifySession(token) {
  try {
    const { payload } = await jwtVerify(token, await sessionKey(), { issuer: 'ai-creative', algorithms: ['HS256'] });
    return payload.sub ? payload : null;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_HOURS * 3600,
});
