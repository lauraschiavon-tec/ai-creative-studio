import 'server-only';
import { cookies } from 'next/headers';
import { isSandbox as appIsSandbox, envMode } from './muapi';

export const MODE_COOKIE = 'atelie_mode';

// Modo de cada usuário: Sandbox (teste, sem custo) ou Produção (gasta crédito real).
//  - App inteiro em Sandbox (MUAPI_ENV != production) → todos travados em Sandbox.
//  - Usuário "só Sandbox" (app_metadata.sandbox_only, definido pelo admin) → travado em Sandbox.
//  - Demais: escolhem pela caixa "Modo teste". Padrão = Sandbox (seguro); mude com MUAPI_DEFAULT_MODE=production.
export function resolveMode(user, cookieValue) {
  if (appIsSandbox()) return { sandbox: true, canChoose: false, reason: 'app', env: envMode() };
  if (user?.app_metadata?.sandbox_only === true) return { sandbox: true, canChoose: false, reason: 'user' };
  const defaultSandbox = process.env.MUAPI_DEFAULT_MODE !== 'production';
  const sandbox = cookieValue === 'production' ? false : cookieValue === 'sandbox' ? true : defaultSandbox;
  return { sandbox, canChoose: true, reason: null };
}

export async function getMode(user) {
  const store = await cookies();
  return resolveMode(user, store.get(MODE_COOKIE)?.value);
}
